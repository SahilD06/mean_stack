const SHAPES = {
    I: [[1, 1, 1, 1]],
    J: [[1, 0, 0], [1, 1, 1]],
    L: [[0, 0, 1], [1, 1, 1]],
    O: [[1, 1], [1, 1]],
    S: [[0, 1, 1], [1, 1, 0]],
    T: [[0, 1, 0], [1, 1, 1]],
    Z: [[1, 1, 0], [0, 1, 1]]
};

const COLORS = {
    I: 'cyan', J: 'blue', L: 'orange', O: 'yellow', S: 'green', T: 'purple', Z: 'red'
};

class TetrisGame {
    constructor() {
        this.cols = 10;
        this.rows = 20;
        this.board = Array.from({ length: this.rows }, () => Array(this.cols).fill(0));
        this.score = 0;
        this.linesCleared = 0;
        this.level = 1;
        this.gameOver = false;

        this.currentPiece = null;
        this.nextPiece = null;
        this.lastLinesCleared = 0;

        this.spawnPiece();
    }

    spawnPiece() {
        if (!this.nextPiece) {
            this.nextPiece = this.randomPiece();
        }

        this.currentPiece = this.nextPiece;
        this.nextPiece = this.randomPiece();

        // Center the piece
        this.currentPiece.x = Math.floor((this.cols - this.currentPiece.shape[0].length) / 2);
        this.currentPiece.y = 0;

        // Check for immediate collision (Game Over)
        if (this.checkCollision(this.currentPiece.x, this.currentPiece.y, this.currentPiece.shape)) {
            this.gameOver = true;
        }
    }

    randomPiece() {
        const keys = Object.keys(SHAPES);
        const type = keys[Math.floor(Math.random() * keys.length)];
        return {
            type,
            shape: SHAPES[type],
            color: COLORS[type],
            x: 0,
            y: 0
        };
    }

    move(dx, dy) {
        if (this.gameOver) return false;

        if (!this.checkCollision(this.currentPiece.x + dx, this.currentPiece.y + dy, this.currentPiece.shape)) {
            this.currentPiece.x += dx;
            this.currentPiece.y += dy;
            return true;
        }
        return false;
    }

    rotate() {
        if (this.gameOver) return;

        const originalShape = this.currentPiece.shape;
        // Transpose + Reverse for 90 deg rotation
        const newShape = originalShape[0].map((val, index) => originalShape.map(row => row[index]).reverse());

        // Simple wall kick: try to move left/right if it collides
        if (!this.checkCollision(this.currentPiece.x, this.currentPiece.y, newShape)) {
            this.currentPiece.shape = newShape;
        } else if (!this.checkCollision(this.currentPiece.x - 1, this.currentPiece.y, newShape)) {
            this.currentPiece.x -= 1;
            this.currentPiece.shape = newShape;
        } else if (!this.checkCollision(this.currentPiece.x + 1, this.currentPiece.y, newShape)) {
            this.currentPiece.x += 1;
            this.currentPiece.shape = newShape;
        }
        // If still collides, do nothing
    }

    drop() {
        if (this.gameOver) return false;

        if (!this.move(0, 1)) {
            this.lockPiece();
            this.clearLines();
            this.spawnPiece();
            return false; // Landed
        }
        return true; // Still falling
    }

    hardDrop() {
        while (this.move(0, 1)) { }
        this.lockPiece();
        this.clearLines();
        this.spawnPiece();
    }

    checkCollision(x, y, shape) {
        for (let row = 0; row < shape.length; row++) {
            for (let col = 0; col < shape[row].length; col++) {
                if (shape[row][col]) {
                    const newX = x + col;
                    const newY = y + row;

                    // Walls and Floor
                    if (newX < 0 || newX >= this.cols || newY >= this.rows) return true;

                    // Locked pieces
                    if (newY >= 0 && this.board[newY][newX]) return true;
                }
            }
        }
        return false;
    }

    lockPiece() {
        const { x, y, shape, type } = this.currentPiece;
        for (let row = 0; row < shape.length; row++) {
            for (let col = 0; col < shape[row].length; col++) {
                if (shape[row][col]) {
                    // Ignore parts above the board (game over condition usually, but handle gracefully)
                    if (y + row >= 0) {
                        this.board[y + row][x + col] = type;
                    }
                }
            }
        }
    }

    clearLines() {
        let lines = 0;
        for (let row = this.rows - 1; row >= 0; row--) {
            if (this.board[row].every(cell => cell !== 0)) {
                this.board.splice(row, 1);
                this.board.unshift(Array(this.cols).fill(0));
                lines++;
                row++;
            }
        }
        if (lines > 0) {
            this.score += lines * 100 * this.level;
            this.linesCleared += lines;
            this.level = Math.floor(this.linesCleared / 10) + 1;
        }
        this.lastLinesCleared = lines; // Store for external check
        return lines;
    }

    getRenderBoard() {
        // Return board with current piece overlay
        // Deep copy board
        const renderBoard = this.board.map(row => [...row]);

        if (this.currentPiece) {
            const { x, y, shape, type } = this.currentPiece;
            for (let row = 0; row < shape.length; row++) {
                for (let col = 0; col < shape[row].length; col++) {
                    if (shape[row][col]) {
                        if (y + row >= 0 && y + row < this.rows && x + col >= 0 && x + col < this.cols) {
                            renderBoard[y + row][x + col] = type;
                        }
                    }
                }
            }
        }
        return renderBoard;
    }

    addGarbage(lines) {
        for (let i = 0; i < lines; i++) {
            this.board.shift(); // Remove top line
            const garbageRow = Array(this.cols).fill('garbage');
            garbageRow[Math.floor(Math.random() * this.cols)] = 0; // One empty spot
            this.board.push(garbageRow);
        }
    }
}

module.exports = TetrisGame;
