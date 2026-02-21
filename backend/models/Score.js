const mongoose = require('mongoose');

const scoreSchema = new mongoose.Schema({
    name: { type: String, default: 'Anonymous' },
    score: { type: Number, required: true },
    date: { type: Date, default: Date.now }
}, { collection: 'score' });

// Index for sorting by score descending
scoreSchema.index({ score: -1 });

module.exports = mongoose.model('Score', scoreSchema);
