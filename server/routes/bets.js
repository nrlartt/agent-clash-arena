// ═══════════════════════════════════════════════════════════════
// BETS ROUTES — Betting on matches
// ═══════════════════════════════════════════════════════════════

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');

const router = express.Router();

// ── POST /bets — Place a bet on a match ──────────────────────
router.post('/', (req, res) => {
    const { match_id, agent_id, wallet_address, amount } = req.body;

    if (!match_id || !agent_id || !wallet_address || !amount) {
        return res.status(400).json({
            success: false,
            error: 'match_id, agent_id, wallet_address, and amount are required',
        });
    }

    const betAmount = parseFloat(amount);
    if (isNaN(betAmount) || betAmount <= 0) {
        return res.status(400).json({
            success: false,
            error: 'Amount must be a positive number',
        });
    }

    if (betAmount > 10000) {
        return res.status(400).json({
            success: false,
            error: 'Maximum bet is 10,000 MON',
        });
    }

    if (!/^0x[a-fA-F0-9]{40}$/.test(wallet_address)) {
        return res.status(400).json({
            success: false,
            error: 'Invalid wallet address format',
        });
    }

    const match = db.getMatchById(match_id);
    if (!match) {
        return res.status(404).json({
            success: false,
            error: 'Match not found or already completed',
        });
    }

    if (match.status !== 'live' && match.status !== 'upcoming') {
        return res.status(409).json({
            success: false,
            error: 'Betting is closed for this match',
        });
    }

    // Verify the agent is in the match
    if (agent_id !== match.agent1Id && agent_id !== match.agent2Id) {
        return res.status(400).json({
            success: false,
            error: 'Agent not in this match',
        });
    }

    // One bet per wallet per match
    const existingBet = db.getBetsForMatch(match_id).find(
        b => String(b.walletAddress || '').toLowerCase() === wallet_address.toLowerCase()
    );
    if (existingBet) {
        return res.status(409).json({
            success: false,
            error: 'This wallet already placed a bet for this match',
            existing_bet_id: existingBet.id,
        });
    }

    // Create bet
    const bet = {
        id: `bet-${uuidv4().slice(0, 8)}`,
        matchId: match_id,
        agentId: agent_id,
        walletAddress: wallet_address,
        amount: betAmount,
        odds: agent_id === match.agent1Id ? match.agent1Odds : match.agent2Odds,
        potentialWin: betAmount * (agent_id === match.agent1Id ? match.agent1Odds : match.agent2Odds),
        status: 'pending',
        payout: 0,
        resolvedAt: null,
        claimedAt: null,
        placedAt: Date.now(),
    };

    db.addBet(bet);

    // Update match totals
    const betsField = agent_id === match.agent1Id ? 'agent1Bets' : 'agent2Bets';
    const updates = {
        totalBets: match.totalBets + betAmount,
        [betsField]: (agent_id === match.agent1Id ? match.agent1Bets : match.agent2Bets) + betAmount,
    };

    // Recalculate odds
    const newTotal = updates.totalBets;
    const a1Total = agent_id === match.agent1Id ? updates.agent1Bets : match.agent1Bets;
    const a2Total = agent_id === match.agent2Id ? updates.agent2Bets : match.agent2Bets;

    if (a1Total > 0 && a2Total > 0) {
        updates.agent1Odds = parseFloat((newTotal / a1Total).toFixed(2));
        updates.agent2Odds = parseFloat((newTotal / a2Total).toFixed(2));
    }

    db.updateMatch(match_id, updates);

    db.addActivity({
        type: 'bet',
        message: `${wallet_address.slice(0, 6)}...${wallet_address.slice(-4)} bet ${betAmount} MON on ${agent_id === match.agent1Id ? match.agent1Name : match.agent2Name}`,
        time: Date.now(),
        icon: '💰',
    });

    // Emit via WebSocket
    if (req.io) {
        req.io.to(`match:${match_id}`).emit('match:bet', {
            matchId: match_id,
            betAmount,
            agentId: agent_id,
            newOdds: { agent1: updates.agent1Odds || match.agent1Odds, agent2: updates.agent2Odds || match.agent2Odds },
            totalBets: updates.totalBets,
        });
    }

    res.json({
        success: true,
        bet: {
            id: bet.id,
            amount: betAmount,
            odds: bet.odds,
            potential_win: bet.potentialWin,
        },
        message: `Bet placed! Potential win: ${bet.potentialWin.toFixed(2)} MON`,
    });
});

// ── GET /bets/wallet/:walletAddress — User bet history ────────
router.get('/wallet/:walletAddress', (req, res) => {
    const walletAddress = req.params.walletAddress;
    if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
        return res.status(400).json({ success: false, error: 'Invalid wallet address format' });
    }

    if (typeof db.getBetsByWallet !== 'function') {
        return res.status(501).json({ success: false, error: 'Wallet bet history is unavailable in this DB mode' });
    }

    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const data = db.getBetsByWallet(walletAddress, limit);
    return res.json({ success: true, data, count: data.length });
});

// ── GET /bets/:matchId — Get bets for a match (public) ───────
router.get('/:matchId', (req, res) => {
    const bets = db.getBetsForMatch(req.params.matchId);
    res.json({
        success: true,
        data: bets.map(b => ({
            id: b.id,
            agentId: b.agentId,
            amount: b.amount,
            odds: b.odds,
            wallet: `${b.walletAddress.slice(0, 6)}...${b.walletAddress.slice(-4)}`,
            placedAt: b.placedAt,
        })),
    });
});

module.exports = router;
