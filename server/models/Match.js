const mongoose = require('mongoose');

const matchSchema = new mongoose.Schema({
    id: { type: String, index: true, unique: true, sparse: true },
    matchId: { type: String, index: true, sparse: true },
    status: {
        type: String,
        enum: ['pending', 'upcoming', 'betting', 'fighting', 'live', 'result', 'finished', 'cancelled'],
        default: 'pending',
        index: true,
    },
    agent1: { type: mongoose.Schema.Types.Mixed, default: null },
    agent2: { type: mongoose.Schema.Types.Mixed, default: null },
    agent1Bets: { type: Number, default: 0 },
    agent2Bets: { type: Number, default: 0 },
    totalBets: { type: Number, default: 0 },
    agent1Odds: { type: Number, default: 2.0 },
    agent2Odds: { type: Number, default: 2.0 },
    bets: { type: [mongoose.Schema.Types.Mixed], default: [] },
    onChain: { type: Boolean, default: false },
    onChainTxHash: { type: String, default: null },
    phaseStartedAt: { type: Number, default: null },
    phaseEndsAt: { type: Number, default: null },
    completedAt: { type: Number, default: null },
    result: { type: mongoose.Schema.Types.Mixed, default: null },
}, {
    timestamps: true,
    strict: false,
});

// Index for quick lookup of live/recent matches
matchSchema.index({ status: 1, updatedAt: -1 });
matchSchema.index({ id: 1, status: 1 });

module.exports = mongoose.model('Match', matchSchema);
