const mongoose = require('mongoose');

const tokenomicsSchema = new mongoose.Schema({
    key: { type: String, unique: true, index: true, default: 'global' },
    totals: { type: mongoose.Schema.Types.Mixed, default: {} },
    history: { type: [mongoose.Schema.Types.Mixed], default: [] },
    lastRunAt: { type: Number, default: null },
    lastSuccessAt: { type: Number, default: null },
    lastError: { type: String, default: null },
    lastErrorAt: { type: Number, default: null },
    lastWithdrawTxHash: { type: String, default: null },
    lastBuyTxHash: { type: String, default: null },
    lastBurnTxHash: { type: String, default: null },
    lastRouter: { type: String, default: null },
    lastSpendMON: { type: Number, default: 0 },
    lastBoughtCLASH: { type: Number, default: 0 },
    lastBurnedCLASH: { type: Number, default: 0 },
}, {
    timestamps: true,
    strict: false,
});

module.exports = mongoose.model('Tokenomics', tokenomicsSchema);
