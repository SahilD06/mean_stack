const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const PongScore = require('./models/PongScore');
const Score = require('./models/Score');

async function check() {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/tetris', {
        dbName: 'game'
    });

    const tetrisCount = await Score.countDocuments();
    const pongCount = await PongScore.countDocuments();

    console.log('Tetris Scores Count:', tetrisCount);
    console.log('Pong Scores Count:', pongCount);

    if (pongCount > 0) {
        const topPong = await PongScore.find().sort({ score: -1 }).limit(5);
        console.log('Top 5 Pong Scores:', JSON.stringify(topPong, null, 2));
    }

    await mongoose.connection.close();
}

check();
