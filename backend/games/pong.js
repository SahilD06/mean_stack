const Matter = require('matter-js');

class PongGame {
    constructor(io, roomCode, mode, onGameOver) {
        this.io = io;
        this.roomCode = roomCode;
        this.mode = mode; // 'solo', 'local', 'battle' (prefixed with 'pong_')
        this.onGameOver = onGameOver;
        this.isSolo = mode === 'pong_solo';

        this.engine = Matter.Engine.create({ gravity: { x: 0, y: 0 } });
        this.world = this.engine.world;

        this.width = 800;
        this.height = 500;

        this.ballSize = 12;
        this.paddleWidth = 12;
        this.paddleHeight = 80;
        this.paddleSpeed = 10;

        this.players = {}; // { id: { body, score, side, inputs } }
        this.walls = [];   // Used for solo mode "breaking walls"
        this.lives = 3;    // Hearts for solo mode
        this.started = false;
        this.gameOver = false;
        this.paused = false;

        this.setupArena();

        this.tickRate = 1000 / 60;
        this.gameLoop = setInterval(() => this.update(), this.tickRate);

        // Collision Events
        Matter.Events.on(this.engine, 'collisionStart', (event) => {
            event.pairs.forEach(pair => {
                this.handleCollision(pair.bodyA, pair.bodyB);
            });
        });
    }
    setupArena() {
        // Top and Bottom walls
        const wallOpts = { isStatic: true, restitution: 1, friction: 0 };
        const topWall = Matter.Bodies.rectangle(this.width / 2, -10, this.width, 20, wallOpts);
        const bottomWall = Matter.Bodies.rectangle(this.width / 2, this.height + 10, this.width, 20, wallOpts);

        Matter.World.add(this.world, [topWall, bottomWall]);

        if (this.isSolo) {
            // Add a right wall in solo mode so the ball doesn't escape past bricks
            const rightWall = Matter.Bodies.rectangle(this.width + 10, this.height / 2, 20, this.height, wallOpts);
            Matter.World.add(this.world, rightWall);
            this.createBreakingWalls();
        }
    }

    createBreakingWalls() {
        // Create a grid of bricks on the right side for solo practice
        const brickWidth = 20;
        const cols = 3;
        const rows = 10;
        const brickHeight = this.height / rows;

        for (let c = 0; c < cols; c++) {
            for (let r = 0; r < rows; r++) {
                const x = this.width - 60 - (c * (brickWidth + 5));
                const y = r * brickHeight + brickHeight / 2;
                const brick = Matter.Bodies.rectangle(x, y, brickWidth, brickHeight, {
                    isStatic: true,
                    label: 'brick'
                });
                this.walls.push(brick);
            }
        }
        Matter.World.add(this.world, this.walls);
    }

    addPlayer(id, side, username) {
        const x = side === 'left' ? 30 : this.width - 30;
        const y = this.height / 2;

        const paddle = Matter.Bodies.rectangle(x, y, this.paddleWidth, this.paddleHeight, {
            isStatic: true,
            label: 'paddle',
            restitution: 1,
            friction: 0
        });

        this.players[id] = {
            id,
            body: paddle,
            score: 0,
            side,
            username: username || (side === 'left' ? 'LEFT' : 'RIGHT'),
            inputs: { up: false, down: false }
        };

        Matter.World.add(this.world, paddle);
    }

    createBall() {
        if (this.ball) Matter.World.remove(this.world, this.ball);

        this.ball = Matter.Bodies.rectangle(this.width / 2, this.height / 2, this.ballSize, this.ballSize, {
            inertia: Infinity,
            restitution: 1.05, // Slight speed increase on bounce
            friction: 0,
            frictionAir: 0,
            label: 'ball'
        });

        const angle = (Math.random() * 0.5 - 0.25) * Math.PI; // -45 to 45 deg
        const speed = 7;
        const vx = (Math.random() > 0.5 ? 1 : -1) * speed * Math.cos(angle);
        const vy = speed * Math.sin(angle);

        Matter.Body.setVelocity(this.ball, { x: vx, y: vy });
        Matter.World.add(this.world, this.ball);
    }

    start() {
        if (this.started) return;
        this.started = true;
        this.createBall();
    }

    handleInput(id, input) {
        const player = this.players[id];
        if (!player) return;

        // Unified input handling like Tetris/Smash
        const { type, pressed } = input;
        if (type === 'up') player.inputs.up = pressed;
        if (type === 'down') player.inputs.down = pressed;
    }

    handleCollision(bodyA, bodyB) {
        const labels = [bodyA.label, bodyB.label];
        if (labels.includes('ball') && labels.includes('brick')) {
            const brick = bodyA.label === 'brick' ? bodyA : bodyB;
            // Remove brick
            Matter.World.remove(this.world, brick);
            this.walls = this.walls.filter(w => w !== brick);

            // In solo mode, left player gets points for breaking bricks
            const leftPlayer = Object.values(this.players).find(p => p.side === 'left');
            if (leftPlayer) leftPlayer.score += 50;
        }

        if (labels.includes('ball') && labels.includes('paddle')) {
            // Speed up ball slightly after paddle hit
            const velocity = this.ball.velocity;
            Matter.Body.setVelocity(this.ball, {
                x: velocity.x * 1.12,
                y: velocity.y * 1.12
            });
        }
    }

    update() {
        if (this.gameOver || this.paused) {
            this.emitState();
            return;
        }

        if (!this.started) {
            this.emitState();
            return;
        }

        // Move paddles based on inputs
        Object.values(this.players).forEach(p => {
            let dy = 0;
            if (p.inputs.up) dy -= this.paddleSpeed;
            if (p.inputs.down) dy += this.paddleSpeed;

            const newY = Math.max(this.paddleHeight / 2, Math.min(this.height - this.paddleHeight / 2, p.body.position.y + dy));
            Matter.Body.setPosition(p.body, { x: p.body.position.x, y: newY });
        });

        Matter.Engine.update(this.engine, 16.66);

        // Check for goals
        if (this.ball) {
            const pos = this.ball.position;
            if (pos.x < 0) {
                if (this.isSolo) {
                    this.lives--;
                    if (this.lives <= 0) {
                        this.gameOver = true;
                        this.io.to(this.roomCode).emit('pongGameOver', { soloWin: false, side: 'left' });
                    } else {
                        this.resetBall();
                    }
                } else {
                    // Right player scores
                    const rightPlayer = Object.values(this.players).find(p => p.side === 'right');
                    if (rightPlayer) rightPlayer.score++;
                    this.resetBall();
                }
            } else if (pos.x > this.width && !this.isSolo) {
                // Left player scores
                const leftPlayer = Object.values(this.players).find(p => p.side === 'left');
                if (leftPlayer) leftPlayer.score++;
                this.resetBall();
            }
        }

        this.checkWinCondition();
        this.emitState();
    }

    resetBall() {
        this.createBall();
    }

    checkWinCondition() {
        Object.values(this.players).forEach(p => {
            if (!this.isSolo && p.score >= 10) {
                this.gameOver = true;
                const data = { winnerId: p.id, side: p.side };
                this.io.to(this.roomCode).emit('pongGameOver', data);
                if (this.onGameOver) this.onGameOver(data);
            }
        });

        if (this.isSolo && this.walls.length === 0) {
            this.gameOver = true;
            const data = { soloWin: true };
            this.io.to(this.roomCode).emit('pongGameOver', data);
            if (this.onGameOver) this.onGameOver(data);
        }

        if (this.isSolo && this.lives <= 0) {
            this.gameOver = true;
            const data = { soloWin: false, side: 'left' };
            this.io.to(this.roomCode).emit('pongGameOver', data);
            if (this.onGameOver) this.onGameOver(data);
        }
    }

    emitState() {
        const state = {
            ball: this.ball ? { x: this.ball.position.x, y: this.ball.position.y } : null,
            players: Object.values(this.players).map(p => ({
                id: p.id,
                y: p.body.position.y,
                score: p.score,
                side: p.side,
                username: p.username
            })),
            walls: this.walls.map(w => ({ x: w.position.x, y: w.position.y })),
            isSolo: this.isSolo,
            lives: this.lives,
            started: this.started
        };
        this.io.to(this.roomCode).emit('pongState', state);
    }

    destroy() {
        clearInterval(this.gameLoop);
        Matter.World.clear(this.world);
        Matter.Engine.clear(this.engine);
    }
}

module.exports = PongGame;
