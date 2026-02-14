const DEFAULT_SPLIT = {
    platformPct: Number(process.env.PLATFORM_FEE_PCT || 10),
    winnerPct: Number(process.env.WINNER_AGENT_PCT || 15),
    bettorsPct: Number(process.env.BETTORS_PCT || 75),
};

function normalizedSplit() {
    const total = DEFAULT_SPLIT.platformPct + DEFAULT_SPLIT.winnerPct + DEFAULT_SPLIT.bettorsPct;
    if (total !== 100) {
        return { platformPct: 10, winnerPct: 15, bettorsPct: 75 };
    }
    return DEFAULT_SPLIT;
}

function splitPool(totalPool) {
    const safePool = Math.max(0, Number(totalPool) || 0);
    const split = normalizedSplit();
    const platformAmount = Number((safePool * split.platformPct / 100).toFixed(6));
    const winnerAmount = Number((safePool * split.winnerPct / 100).toFixed(6));
    const bettorsAmount = Number((safePool - platformAmount - winnerAmount).toFixed(6));
    return { ...split, totalPool: safePool, platformAmount, winnerAmount, bettorsAmount };
}

function distributeBettorsPool(bettorsAmount, winningBets) {
    const totalWinningStake = winningBets.reduce((sum, b) => sum + (Number(b.amount) || 0), 0);
    if (totalWinningStake <= 0 || bettorsAmount <= 0) {
        return {
            payoutsByBetId: {},
            payoutsByWallet: {},
            totalPayout: 0,
            winningTickets: 0,
            totalWinningStake,
            unallocated: bettorsAmount,
        };
    }

    const payoutsByBetId = {};
    const payoutsByWallet = {};
    let totalPayout = 0;

    for (const bet of winningBets) {
        const amount = Number(bet.amount) || 0;
        const payout = Number((bettorsAmount * (amount / totalWinningStake)).toFixed(6));
        payoutsByBetId[bet.id] = payout;
        payoutsByWallet[bet.walletAddress] = Number(((payoutsByWallet[bet.walletAddress] || 0) + payout).toFixed(6));
        totalPayout += payout;
    }

    return {
        payoutsByBetId,
        payoutsByWallet,
        totalPayout: Number(totalPayout.toFixed(6)),
        winningTickets: winningBets.length,
        totalWinningStake,
        unallocated: Number((bettorsAmount - totalPayout).toFixed(6)),
    };
}

module.exports = {
    splitPool,
    distributeBettorsPool,
};
