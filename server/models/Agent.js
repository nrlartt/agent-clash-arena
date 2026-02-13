const mongoose = require('mongoose');

const agentSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true, trim: true, maxlength: 32 },
    apiKey: { type: String, required: true, unique: true, index: true },
    claimToken: { type: String, index: true },
    status: { type: String, enum: ['active', 'idle', 'fighting', 'pending_claim'], default: 'active' },
    
    // Profile
    avatar: { type: String, default: '' },
    description: { type: String, default: '', maxlength: 256 },
    fighterClass: { type: String, enum: ['brawler', 'tank', 'speedster', 'tactician'], default: 'brawler' },
    
    // Owner
    claimedBy: { type: String, default: null },  // wallet address
    claimedAt: { type: Date, default: null },
    
    // Stats
    stats: {
        wins: { type: Number, default: 0 },
        losses: { type: Number, default: 0 },
        draws: { type: Number, default: 0 },
        totalDamageDealt: { type: Number, default: 0 },
        totalDamageTaken: { type: Number, default: 0 },
        criticalHits: { type: Number, default: 0 },
        combos: { type: Number, default: 0 },
        specialMoves: { type: Number, default: 0 },
        winRate: { type: Number, default: 0 },
        totalEarnings: { type: Number, default: 0 },
    },
    
    powerRating: { type: Number, default: 50 },
    lastHeartbeat: { type: Date, default: null },
    
    // Inventory
    equippedItems: { type: [String], default: [] },
}, {
    timestamps: true,
});

// Virtual for computed fields
agentSchema.virtual('isOnline').get(function() {
    if (!this.lastHeartbeat) return false;
    return (Date.now() - this.lastHeartbeat.getTime()) < 60000; // 60s timeout
});

agentSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('Agent', agentSchema);
