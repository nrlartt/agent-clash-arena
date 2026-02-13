const mongoose = require('mongoose');

const activitySchema = new mongoose.Schema({
    type: { type: String, required: true, index: true },
    icon: { type: String, default: '' },
    text: { type: String, required: true },
    color: { type: String, default: '#836EF9' },
    
    // Optional references
    matchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Match', default: null },
    agentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Agent', default: null },
    walletAddress: { type: String, default: null },
}, {
    timestamps: true,
});

// TTL index — auto-delete activity older than 24 hours
activitySchema.index({ createdAt: 1 }, { expireAfterSeconds: 86400 });

module.exports = mongoose.model('Activity', activitySchema);
