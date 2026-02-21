const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
console.log('Initializing MEAN Backend server...');

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const TetrisGame = require('./tetris');
const Score = require('./models/Score');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/tetris', {
    dbName: 'game',
    serverSelectionTimeoutMS: 5000
}).then(() => console.log('MongoDB Connected'))
    .catch(err => console.log('MongoDB Connection Error:', err.message));

// Basic API Route
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'MEAN Backend is running' });
});

// High Scores API (from MongoDB game.score collection)
app.get('/api/scores', async (req, res) => {
    console.log('GET /api/scores request received');
    try {
        const highScores = await Score.find().sort({ score: -1 }).limit(50).select('name score').lean();
        console.log(`Found ${highScores.length} scores`);
        res.json(highScores.map(doc => ({ name: doc.name, score: doc.score })));
    } catch (err) {
        console.error('API /api/scores error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Game State
let rooms = {};
const TICK_RATE = 1000;

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    socket.on('createRoom', async (data = { mode: 'battle', username: 'Anonymous', integrated: false }) => {
        const { mode, username, integrated } = data;
        const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        rooms[roomCode] = {
            hostId: socket.id,
            players: [],
            gameState: 'waiting',
            intervals: [],
            mode: mode,
            readyPlayers: new Set(),
            playerCounter: 0
        };
        socket.join(roomCode);
        socket.emit('roomCreated', roomCode);

        /* Solo: host is the only player. Local: host is spectator (no player). Battle: host can play. */
        if (mode === 'solo') {
            rooms[roomCode].playerCounter++;
            const playerIndex = rooms[roomCode].playerCounter;
            rooms[roomCode].players.push({
                id: playerIndex,
                socketId: socket.id,
                instance: new TetrisGame(),
                username: username || 'Anonymous'
            });
            socket.emit('playerJoined', { playerIndex, username: username || 'Anonymous' });
        } else if (mode === 'local') {
            /* Host does not get a player slot; they only display boards */
        } else if (integrated) {
            rooms[roomCode].playerCounter++;
            const playerIndex = rooms[roomCode].playerCounter;
            rooms[roomCode].players.push({
                id: playerIndex,
                socketId: socket.id,
                instance: new TetrisGame(),
                username: username || 'Anonymous'
            });
            socket.emit('playerJoined', { playerIndex, username: username || 'Anonymous' });
        }
        broadcastRoomStats(roomCode);
    });

    socket.on('joinRoom', (roomCode, username) => {
        const room = rooms[roomCode];
        if (!room) {
            socket.emit('error', 'Room not found');
            return;
        }
        if (room.gameState === 'waiting') {
            if (room.mode === 'solo') {
                socket.join(roomCode);
                socket.emit('joinedRoom', { roomCode, playerIndex: 1, mode: room.mode });
                return;
            }
            /* local and battle: allow multiple players */
            if (room.players.length < 7) {
                room.playerCounter++;
                const playerIndex = room.playerCounter;
                room.players.push({
                    id: playerIndex,
                    socketId: socket.id,
                    instance: new TetrisGame(),
                    username: username || `Player ${playerIndex}`
                });
                socket.join(roomCode);
                socket.emit('joinedRoom', { roomCode, playerIndex, currentPlayers: room.players.map(p => p.id), mode: room.mode });
                io.to(roomCode).emit('playerJoined', { playerIndex, username: username || `Player ${playerIndex}` });
            } else {
                socket.emit('error', 'Room is full');
            }
            broadcastRoomStats(roomCode);
        } else {
            socket.emit('error', 'Game already started');
        }
    });

    socket.on('playerReady', (roomCode) => {
        const room = rooms[roomCode];
        if (room && (room.gameState === 'waiting' || room.gameState === 'gameover')) {
            room.readyPlayers.add(socket.id);
            if (room.mode === 'solo' || room.readyPlayers.size === room.players.length) {
                startGame(roomCode);
            }
            io.to(room.hostId).emit('playerReadyStatus', {
                socketId: socket.id,
                readyCount: room.readyPlayers.size,
                totalPlayers: room.players.length
            });
        }
    });

    socket.on('input', ({ roomCode, action }) => {
        const room = rooms[roomCode];
        if (room && room.gameState === 'playing' && !room.paused) {
            const player = room.mode === 'solo' ? room.players[0] : room.players.find(p => p.socketId === socket.id);
            if (player) {
                const game = player.instance;
                let changed = false;
                switch (action) {
                    case 'left': if (game.move(-1, 0)) changed = true; break;
                    case 'right': if (game.move(1, 0)) changed = true; break;
                    case 'down': if (game.move(0, 1)) changed = true; break;
                    case 'rotate': game.rotate(); changed = true; break;
                    case 'drop': game.hardDrop(); handlePostMove(room, player); changed = true; break;
                }
                if (changed) sendGameState(roomCode);
            }
        }
    });

    socket.on('pauseGame', (roomCode) => {
        const room = rooms[roomCode];
        if (room) {
            room.paused = true;
            io.to(roomCode).emit('gamePaused');
        }
    });

    socket.on('unpauseGame', (roomCode) => {
        const room = rooms[roomCode];
        if (room && room.gameState === 'playing') {
            room.paused = false;
            io.to(roomCode).emit('gameUnpaused');
            sendGameState(roomCode);
        }
    });

    socket.on('leaveRoom', (roomCode) => {
        const room = rooms[roomCode];
        if (!room) return;
        if (room.hostId === socket.id) {
            io.to(roomCode).emit('roomClosed');
            room.intervals.forEach(clearInterval);
            delete rooms[roomCode];
            return;
        }
        const pIdx = room.players.findIndex(p => p.socketId === socket.id);
        if (pIdx !== -1) {
            const player = room.players[pIdx];
            room.players.splice(pIdx, 1);
            socket.leave(roomCode);
            io.to(room.hostId).emit('playerLeft', { playerIndex: player.id });
            if (room.players.length === 0) {
                room.intervals.forEach(clearInterval);
                io.to(roomCode).emit('roomClosed');
                delete rooms[roomCode];
            } else if (room.gameState === 'playing' && (room.mode === 'battle' || room.mode === 'local') && room.players.length === 1) {
                /* Last Man Standing: sole remaining player wins */
                endGame(roomCode, room.players[0].id);
            } else {
                broadcastRoomStats(roomCode);
            }
        }
    });

    socket.on('restartGame', (roomCode) => {
        const room = rooms[roomCode];
        if (!room || room.hostId !== socket.id) return;
        room.gameState = 'waiting';
        room.readyPlayers.clear();
        room.intervals.forEach(clearInterval);
        room.intervals = [];
        room.paused = false;
        room.players.forEach(p => p.instance = new TetrisGame());
        io.to(roomCode).emit('gameRestarted');
        broadcastRoomStats(roomCode);
    });

    socket.on('disconnect', () => {
        for (const [code, room] of Object.entries(rooms)) {
            if (room.hostId === socket.id) {
                io.to(code).emit('roomClosed');
                delete rooms[code];
                break;
            }
            const pIdx = room.players.findIndex(p => p.socketId === socket.id);
            if (pIdx !== -1) {
                const player = room.players[pIdx];
                room.players.splice(pIdx, 1);
                io.to(room.hostId).emit('playerLeft', { playerIndex: player.id });
                if (room.mode === 'solo' || room.players.length === 0) {
                    io.to(code).emit('roomClosed');
                    delete rooms[code];
                } else if (room.gameState === 'playing' && (room.mode === 'battle' || room.mode === 'local') && room.players.length === 1) {
                    /* Last Man Standing: sole remaining player wins */
                    endGame(code, room.players[0].id);
                } else {
                    broadcastRoomStats(code);
                }
                break;
            }
        }
    });
});

function broadcastRoomStats(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;
    io.to(roomCode).emit('roomStats', {
        count: room.players.length,
        players: room.players.map(p => ({ id: p.id, username: p.username }))
    });
}

function startGame(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;
    room.gameState = 'playing';
    room.intervals.forEach(clearInterval);
    room.intervals = [];
    room.readyPlayers.clear();
    room.players.forEach(p => p.instance = new TetrisGame());
    io.to(roomCode).emit('readyToStart');
    room.players.forEach(player => {
        const interval = setInterval(() => {
            if (room.gameState !== 'playing' || room.paused) return;
            if (!player.instance.drop()) handlePostMove(room, player);
            sendGameState(roomCode);
            if (player.instance.gameOver) {
                let winner = room.players.reduce((prev, current) => (prev.instance.score > current.instance.score) ? prev : current);
                endGame(roomCode, winner.id);
            }
        }, TICK_RATE);
        room.intervals.push(interval);
    });
}

function handlePostMove(room, player) {
    const lines = player.instance.lastLinesCleared;
    /* Only battle mode sends garbage; local/solo do not */
    if (room.mode === 'battle' && room.players.length === 2 && lines > 0) {
        const opponent = room.players.find(p => p.id !== player.id);
        if (opponent) {
            let garbage = lines === 4 ? 4 : lines - 1;
            if (garbage > 0) opponent.instance.addGarbage(garbage);
        }
    }
    player.instance.lastLinesCleared = 0;
}

function sendGameState(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;
    const payload = {};
    room.players.forEach(p => {
        payload[`p${p.id}`] = {
            board: p.instance.getRenderBoard(),
            score: p.instance.score,
            username: p.username
        };
    });
    io.to(roomCode).emit('gameState', payload);
}

function endGame(roomCode, winnerId) {
    const room = rooms[roomCode];
    if (!room) return;
    console.log(`Ending game in room ${roomCode}. Winner: ${winnerId}`);
    room.gameState = 'gameover';
    room.intervals.forEach(clearInterval);
    const winner = room.players.find(p => p.id === winnerId);
    io.to(roomCode).emit('gameOver', {
        winnerId,
        winnerName: winner ? winner.username : 'Unknown',
        scores: room.players.map(p => ({ name: p.username, id: p.id, score: p.instance.score }))
    });
    if (room.mode === 'solo' && room.players[0]) {
        console.log(`Solo mode detected. Attempting to save score for ${room.players[0].username}: ${room.players[0].instance.score}`);
        saveScore(room.players[0].instance.score, room.players[0].username).then(async () => {
            const highScores = await Score.find().sort({ score: -1 }).limit(10);
            console.log('Emitting updated highScores to room');
            io.to(roomCode).emit('highScores', highScores);
        });
    }
}

async function saveScore(score, username) {
    console.log(`saveScore called with score: ${score}, username: ${username}`);
    if (score > 0) {
        try {
            const newScore = new Score({ score, name: username || 'Anonymous' });
            await newScore.save();
            console.log('Score saved successfully to MongoDB:', newScore);
        } catch (err) {
            console.error('CRITICAL: Error saving score to MongoDB:', err.message);
        }
    } else {
        console.log('Score is 0, skipping save.');
    }
}

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Backend running on port ${PORT}`);
});
