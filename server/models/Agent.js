const mongoose = require('mongoose');

const agentSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true, trim: true, maxlength: 32 },
    apiKey: { type: String, required: true, unique: true, index: true },
    claimToken: { type: String, index: true },
    verificationCode: { type: String, default: null },
    status: {
        type: String,
        enum: ['active', 'idle', 'fighting', 'pending_claim', 'suspended'],
        default: 'active',
    },

    // Profile
    avatar: { type: String, default: '' },
    description: { type: String, default: '', maxlength: 256 },
    strategy: { type: String, enum: ['aggressive', 'defensive', 'balanced'], default: 'balanced' },
    weaponPreference: { type: String, default: 'blade' },
    fighterClass: { type: String, enum: ['brawler', 'tank', 'speedster', 'tactician'], default: 'brawler' },
    battleCry: { type: String, default: null, maxlength: 128 },

    // Owner (human who claims the agent)
    owner: {
        walletAddress: { type: String, default: null },
        twitterHandle: { type: String, default: null },
        verified: { type: Boolean, default: false },
    },
    claimedBy: { type: String, default: null },  // legacy field
    claimedAt: { type: Date, default: null },

    // Progression
    rank: { type: Number, default: null },
    level: { type: Number, default: 1 },
    xp: { type: Number, default: 0 },
    powerRating: { type: Number, default: 50 },

    // Agent wallet (private key is stored encrypted only)
    wallet: {
        address: { type: String, default: null },
        encryption: {
            algorithm: { type: String, default: null },
            version: { type: String, default: null },
        },
        encryptedPrivateKey: { type: String, default: null, select: false },
        createdAt: { type: Date, default: null },
    },

    // Stats
    stats: {
        wins: { type: Number, default: 0 },
        losses: { type: Number, default: 0 },
        draws: { type: Number, default: 0 },
        winRate: { type: Number, default: 0 },
        totalEarnings: { type: Number, default: 0 },
        matchesPlayed: { type: Number, default: 0 },
        killStreak: { type: Number, default: 0 },
        currentStreak: { type: Number, default: 0 },
        totalDamageDealt: { type: Number, default: 0 },
        totalDamageTaken: { type: Number, default: 0 },
        criticalHits: { type: Number, default: 0 },
        combos: { type: Number, default: 0 },
        specialMoves: { type: Number, default: 0 },
    },

    // Budget (set during claim)
    budget: {
        totalAllowance: { type: Number, default: 0 },
        spent: { type: Number, default: 0 },
        remaining: { type: Number, default: 0 },
        autoRefill: { type: Boolean, default: false },
        updatedAt: { type: Date, default: null },
    },

    // Onboarding
    onboarding: {
        source: { type: String, default: null },
        telegramUsername: { type: String, default: null },
        telegramChatId: { type: String, default: null },
    },

    // Misc
    registeredAt: { type: Date, default: Date.now },
    lastHeartbeat: { type: Date, default: null },
    equippedItems: { type: [String], default: [] },
}, {
    timestamps: true,
    // Disable strict to allow any extra fields from registration
    strict: false,
});

// Virtual for isOnline check
agentSchema.virtual('isOnline').get(function () {
    if (!this.lastHeartbeat) return false;
    return (Date.now() - this.lastHeartbeat.getTime()) < 60000;
});

agentSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('Agent', agentSchema);
