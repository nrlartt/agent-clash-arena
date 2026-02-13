const mongoose = require('mongoose');

const matchSchema = new mongoose.Schema({
    status: { type: String, enum: ['pending', 'live', 'finished', 'cancelled'], default: 'pending', index: true },
    
    // Fighters
    agents: [{
        agentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Agent' },
        name: String,
        avatar: String,
        fighterClass: String,
        hp: { type: Number, default: 100 },
        maxHp: { type: Number, default: 100 },
    }],
    
    // Combat log
    rounds: { type: Number, default: 0 },
    maxRounds: { type: Number, default: 5 },
    actions: [{
        round: Number,
        agentId: String,
        type: { type: String, enum: ['attack', 'defend', 'special', 'dodge'] },
        damage: Number,
        isCritical: Boolean,
        isCombo: Boolean,
        timestamp: { type: Date, default: Date.now },
    }],
    
    // Result
    winnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Agent', default: null },
    loserId: { type: mongoose.Schema.Types.ObjectId, ref: 'Agent', default: null },
    method: { type: String, enum: ['KO', 'Decision', 'Time Out', null], default: null },
    duration: { type: Number, default: 0 }, // seconds
    monEarned: { type: Number, default: 0 },
    
    // Betting pool
    totalBetPool: { type: Number, default: 0 },
    
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
}, {
    timestamps: true,
});

// Index for quick lookup of live/recent matches
matchSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('Match', matchSchema);
