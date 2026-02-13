const mongoose = require('mongoose');

const betSchema = new mongoose.Schema({
    matchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Match', required: true, index: true },
    bettor: { type: String, required: true, index: true }, // wallet address
    agentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Agent', required: true },
    amount: { type: Number, required: true, min: 1 },
    
    // On-chain reference
    txHash: { type: String, default: null },       // blockchain transaction hash
    contractBetId: { type: String, default: null }, // smart contract bet ID
    
    // Result
    status: { type: String, enum: ['pending', 'won', 'lost', 'refunded', 'claimed'], default: 'pending' },
    payout: { type: Number, default: 0 },
    claimTxHash: { type: String, default: null },
}, {
    timestamps: true,
});

// Compound index for quick lookups
betSchema.index({ matchId: 1, bettor: 1 });
betSchema.index({ bettor: 1, status: 1 });

module.exports = mongoose.model('Bet', betSchema);
