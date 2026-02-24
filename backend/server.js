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
const PongScore = require('./models/PongScore');
const PongGame = require('./games/pong');
const app = express();
const allowedOrigins = [
    "https://mean-stack-rcxt.onrender.com",
    "http://localhost:4200",
    "http://localhost:3000"
];

const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/tetris';
console.log('MongoDB URI is set:', !!process.env.MONGO_URI);

app.use(cors({
    origin: allowedOrigins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: allowedOrigins,
        methods: ["GET", "POST"],
        credentials: true
    },
    transports: ['websocket', 'polling'],
    allowEIO3: true
});

// MongoDB Connection
mongoose.connect(mongoUri, {
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

// High Scores API (Pong)
app.get('/api/pong-scores', async (req, res) => {
    console.log('GET /api/pong-scores request received');
    try {
        const highScores = await PongScore.find().sort({ score: -1 }).limit(50).select('name score').lean();
        console.log(`Found ${highScores.length} pong scores`);
        res.json(highScores.map(doc => ({ name: doc.name, score: doc.score })));
    } catch (err) {
        console.error('API /api/pong-scores error:', err);
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

        // Pong initialization
        if (mode.startsWith('pong_')) {
            rooms[roomCode].pong = new PongGame(io, roomCode, mode, (data) => handlePongGameOver(roomCode, data));
            if (mode === 'pong_solo' || (mode === 'pong_battle' && integrated)) {
                addPlayerToRoom(roomCode, socket.id, username);
            }
        } else {
            // Tetris initialization (Solo or Integrated Battle)
            if (mode === 'solo' || integrated) {
                addPlayerToRoom(roomCode, socket.id, username);
                socket.emit('playerJoined', { playerIndex: rooms[roomCode].playerCounter, username: username || 'Anonymous' });
            }
        }
        broadcastRoomStats(roomCode);
    });

    socket.on('joinRoom', (roomCode, username) => {
        const room = rooms[roomCode];
        if (!room) return socket.emit('error', 'Room not found');
        if (room.gameState !== 'waiting' && !room.mode.startsWith('pong_')) return socket.emit('error', 'Game already started');

        const playerCount = room.players.length;
        if (room.mode.startsWith('pong_')) {
            if (playerCount >= 2) return socket.emit('error', 'Pong room is full');
            addPlayerToRoom(roomCode, socket.id, username);
            socket.join(roomCode);
            socket.emit('joinedRoom', { roomCode, playerIndex: room.playerCounter, mode: room.mode });
            io.to(roomCode).emit('playerJoined', { playerIndex: room.playerCounter, username: username || `P${room.playerCounter}` });
        } else if (room.mode === 'solo') {
            socket.join(roomCode);
            socket.emit('joinedRoom', { roomCode, playerIndex: 1, mode: room.mode });
        } else if (playerCount < 7) {
            addPlayerToRoom(roomCode, socket.id, username);
            socket.join(roomCode);
            socket.emit('joinedRoom', { roomCode, playerIndex: room.playerCounter, currentPlayers: room.players.map(p => p.id), mode: room.mode });
            io.to(roomCode).emit('playerJoined', { playerIndex: room.playerCounter, username: username || `Player ${room.playerCounter}` });
        } else {
            socket.emit('error', 'Room is full');
        }
        broadcastRoomStats(roomCode);
    });

    socket.on('playerReady', (roomCode) => {
        const room = rooms[roomCode];
        if (!room) return;

        if (room.mode.startsWith('pong_')) {
            room.readyPlayers.add(socket.id);
            const needed = room.mode === 'pong_solo' ? 1 : Math.min(2, room.players.length);
            if (room.readyPlayers.size >= needed && room.players.length >= (room.mode === 'pong_solo' ? 1 : 2)) {
                room.gameState = 'playing';
                room.pong.start();
                io.to(roomCode).emit('pongStarted');

                // Emit high scores for solo mode
                if (room.mode === 'pong_solo') {
                    PongScore.find().sort({ score: -1 }).limit(10).then(scores => {
                        io.to(roomCode).emit('highScores', scores);
                    });
                }
            }
            io.to(roomCode).emit('playerReadyStatus', {
                socketId: socket.id,
                readyCount: room.readyPlayers.size,
                totalPlayers: room.mode === 'pong_solo' ? 1 : 2
            });
            return;
        }

        if (room.gameState === 'waiting' || room.gameState === 'gameover') {
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
            if (room.mode.startsWith('pong_')) return; // Pong uses pongInput

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

    socket.on('pongInput', ({ roomCode, type, pressed }) => {
        const room = rooms[roomCode];
        if (room && room.pong && room.gameState === 'playing' && !room.paused) {
            room.pong.handleInput(socket.id, { type, pressed });
        }
    });

    socket.on('pauseGame', (roomCode) => {
        const room = rooms[roomCode];
        if (room) {
            room.paused = true;
            if (room.pong) room.pong.paused = true;
            io.to(roomCode).emit('gamePaused');

            // Emit high scores on pause for solo mode
            if (room.mode === 'solo' || room.mode === 'pong_solo') {
                const Model = room.mode === 'pong_solo' ? PongScore : Score;
                Model.find().sort({ score: -1 }).limit(10).then(scores => {
                    io.to(roomCode).emit('highScores', scores);
                });
            }
        }
    });

    socket.on('unpauseGame', (roomCode) => {
        const room = rooms[roomCode];
        if (room) {
            room.paused = false;
            if (room.pong) {
                room.pong.paused = false;
            } else if (room.gameState === 'playing') {
                sendGameState(roomCode);
            }
            io.to(roomCode).emit('gameUnpaused');
        }
    });

    socket.on('endGameManual', (roomCode) => {
        const room = rooms[roomCode];
        if (room && room.gameState === 'playing') {
            if (room.mode.startsWith('pong_')) {
                // Find player with highest score
                const players = Object.values(room.pong.players);
                let winner = players[0];
                players.forEach(p => {
                    if (p.score > winner.score) winner = p;
                });

                room.gameState = 'gameover';
                room.pong.gameOver = true;
                const endGameData = { winnerId: winner.id, side: winner.side };
                io.to(roomCode).emit('pongGameOver', endGameData);

                // Save score for solo mode
                if (room.mode === 'pong_solo') {
                    const pongPlayer = room.pong.players[winner.socketId];
                    const finalScore = pongPlayer ? pongPlayer.score : winner.score;
                    savePongScore(finalScore, winner.username).then(async () => {
                        const highScores = await PongScore.find().sort({ score: -1 }).limit(10);
                        io.to(roomCode).emit('highScores', highScores);
                    });
                }
                return;
            }
            const player = room.players.find(p => p.socketId === socket.id);
            if (player) {
                console.log(`Manual end game requested by ${player.username} in room ${roomCode}`);
                endGame(roomCode, player.id);
            }
        }
    });

    socket.on('leaveRoom', (roomCode) => {
        const room = rooms[roomCode];
        if (!room) return;
        if (room.hostId === socket.id) {
            io.to(roomCode).emit('roomClosed');
            room.intervals.forEach(clearInterval);
            if (room.pong) room.pong.destroy();
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
        if (!room) return;

        // Allow host to restart, OR anyone if it's local/solo mode
        const isHost = room.hostId === socket.id;
        const isLocalOrSolo = room.mode === 'solo' || room.mode === 'local' || room.mode === 'pong_solo' || room.mode === 'pong_local';

        if (!isHost && !isLocalOrSolo) return;

        room.gameState = 'waiting';
        room.readyPlayers.clear();
        room.intervals.forEach(clearInterval);
        room.intervals = [];
        room.paused = false;

        if (room.mode.startsWith('pong_')) {
            if (room.pong) room.pong.destroy();
            room.pong = new PongGame(io, roomCode, room.mode);
            // Re-add players to the new instance to reset paddles and scores
            room.players.forEach((p, idx) => {
                const side = idx === 0 ? 'left' : 'right';
                room.pong.addPlayer(p.socketId, side, p.username);
            });
        } else {
            room.players.forEach(p => p.instance = new TetrisGame());
        }

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
        if (p.instance) {
            payload[`p${p.id}`] = {
                board: p.instance.getRenderBoard(),
                score: p.instance.score,
                username: p.username
            };
        }
    });
    if (Object.keys(payload).length > 0) {
        io.to(roomCode).emit('gameState', payload);
    }
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

function addPlayerToRoom(roomCode, socketId, username) {
    const room = rooms[roomCode];
    if (!room) return;
    room.playerCounter++;
    const player = {
        id: room.playerCounter,
        socketId: socketId,
        username: username || (room.mode.startsWith('pong_') ? `P${room.playerCounter}` : `Player ${room.playerCounter}`)
    };
    if (!room.mode.startsWith('pong_')) {
        player.instance = new TetrisGame();
    }
    room.players.push(player);
    if (room.pong) {
        const side = room.players.length === 1 ? 'left' : 'right';
        room.pong.addPlayer(socketId, side, player.username);
    }
    return player;
}

async function handlePongGameOver(roomCode, data) {
    const room = rooms[roomCode];
    if (!room || !room.pong) return;

    if (room.mode === 'pong_solo') {
        const player = room.players[0]; // In solo, there's only one player
        if (player) {
            // Get score from PongGame instance
            const pongPlayer = room.pong.players[player.socketId];
            const score = pongPlayer ? pongPlayer.score : 0;

            await savePongScore(score, player.username);
            const highScores = await PongScore.find().sort({ score: -1 }).limit(10);
            io.to(roomCode).emit('highScores', highScores);
        }
    }
}

async function savePongScore(score, username) {
    if (score > 0) {
        try {
            const newScore = new PongScore({ score, name: username || 'Anonymous' });
            await newScore.save();
            console.log('Pong Score saved successfully:', newScore);
        } catch (err) {
            console.error('Error saving pong score:', err.message);
        }
    }
}

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Backend running on port ${PORT}`);
});
