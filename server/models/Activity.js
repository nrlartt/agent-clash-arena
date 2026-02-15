const mongoose = require('mongoose');

const activitySchema = new mongoose.Schema({
    type: { type: String, required: true, index: true },
    message: { type: String, required: true },
    icon: { type: String, default: '' },
    color: { type: String, default: '#836EF9' },
    time: { type: Number, default: Date.now },

    // Legacy field alias (some old code may use 'text')
    text: { type: String, default: null },

    // Optional references
    matchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Match', default: null },
    agentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Agent', default: null },
    walletAddress: { type: String, default: null },
}, {
    timestamps: true,
    strict: false,
});

// TTL index — auto-delete activity older than 24 hours
activitySchema.index({ createdAt: 1 }, { expireAfterSeconds: 86400 });

module.exports = mongoose.model('Activity', activitySchema);
