const mongoose = require('mongoose');

const betSchema = new mongoose.Schema({
    id: { type: String, index: true, sparse: true },
    matchId: { type: String, required: true, index: true },
    walletAddress: { type: String, index: true, default: null },
    bettor: { type: String, index: true, default: null }, // legacy alias of walletAddress
    agentId: { type: String, required: true, index: true },
    amount: { type: Number, required: true, min: 0 },
    
    // On-chain reference
    txHash: { type: String, default: null },       // blockchain transaction hash
    contractBetId: { type: String, default: null }, // smart contract bet ID
    
    // Result
    status: { type: String, enum: ['pending', 'won', 'lost', 'refunded', 'claimed'], default: 'pending' },
    payout: { type: Number, default: 0 },
    claimTxHash: { type: String, default: null },
    odds: { type: Number, default: null },
    potentialWin: { type: Number, default: null },
    placedAt: { type: Number, default: () => Date.now(), index: true },
}, {
    timestamps: true,
    strict: false,
});

// Compound index for quick lookups
betSchema.index({ matchId: 1, walletAddress: 1 });
betSchema.index({ walletAddress: 1, status: 1 });
betSchema.index({ bettor: 1, status: 1 });

module.exports = mongoose.model('Bet', betSchema);
