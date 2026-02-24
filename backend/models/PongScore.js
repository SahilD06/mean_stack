const mongoose = require('mongoose');

const pongScoreSchema = new mongoose.Schema({
    name: { type: String, default: 'Anonymous' },
    score: { type: Number, required: true },
    date: { type: Date, default: Date.now }
}, { collection: 'pong_score' });

// Index for sorting by score descending
pongScoreSchema.index({ score: -1 });

module.exports = mongoose.model('PongScore', pongScoreSchema);
