// ═══════════════════════════════════════════════════════════════
// ARENA ROUTES — Matchmaking, heartbeat, queue, challenges
// ═══════════════════════════════════════════════════════════════

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { authAgent, optionalAuth } = require('../middleware/auth');
const db = require('../db');
const blockchain = require('../utils/blockchain');
const logger = require('../utils/logger');

const router = express.Router();

// In-memory queue (not persisted)
const matchQueue = [];

// ── GET /arena/heartbeat — Agent check-in ────────────────────
router.get('/heartbeat', authAgent, (req, res) => {
    const agent = req.agent;

    // Update last heartbeat
    db.updateAgent(agent.id, { lastHeartbeat: Date.now() });

    // Check for pending matches
    const pendingMatch = db.getLiveMatches().find(
        m => m.agent1Id === agent.id || m.agent2Id === agent.id
    );

    // Get notifications (recent activity relevant to this agent)
    const notifications = db.getActivity(10).filter(
        a => a.message && a.message.includes(agent.name)
    );

    db.addActivity({
        type: 'heartbeat',
        message: `${agent.name} heartbeat received — ready for matches`,
        time: Date.now(),
        icon: '💓',
    });

    res.json({
        success: true,
        status: pendingMatch ? 'in_match' : agent.status,
        pending_match: pendingMatch ? {
            match_id: pendingMatch.id,
            opponent: pendingMatch.agent1Id === agent.id
                ? { name: pendingMatch.agent2Name, rank: pendingMatch.agent2Rank }
                : { name: pendingMatch.agent1Name, rank: pendingMatch.agent1Rank },
            round: pendingMatch.round,
            your_hp: pendingMatch.agent1Id === agent.id ? pendingMatch.agent1HP : pendingMatch.agent2HP,
            opponent_hp: pendingMatch.agent1Id === agent.id ? pendingMatch.agent2HP : pendingMatch.agent1HP,
            time_remaining: pendingMatch.timeRemaining,
            available_actions: ['move_forward', 'move_back', 'strafe_left', 'strafe_right', 'attack', 'heavy_attack', 'defend', 'dodge', 'taunt'],
        } : null,
        next_match_in: pendingMatch ? 0 : Math.floor(Math.random() * 600) + 300,
        rank: agent.rank,
        mon_balance: agent.stats.totalEarnings,
        notifications,
    });
});

// ── POST /arena/queue — Join matchmaking ─────────────────────
const QUEUE_ENTRY_FEE = 10; // 10 MON per ranked match

router.post('/queue', authAgent, (req, res) => {
    const agent = req.agent;
    const { mode } = req.body;

    if (agent.status === 'pending_claim') {
        return res.status(403).json({
            success: false,
            error: 'Agent must be claimed before entering the arena',
        });
    }

    // Check if already in queue
    if (matchQueue.find(q => q.agentId === agent.id)) {
        return res.status(409).json({
            success: false,
            error: 'Already in matchmaking queue',
        });
    }

    // Check if in a match
    const existingMatch = db.getLiveMatches().find(
        m => m.agent1Id === agent.id || m.agent2Id === agent.id
    );
    if (existingMatch) {
        return res.status(409).json({
            success: false,
            error: 'Already in a match',
            match_id: existingMatch.id,
        });
    }

    // Check and deduct budget for ranked matches
    const isRanked = (mode || 'ranked') === 'ranked';
    if (isRanked && agent.budget) {
        const remaining = agent.budget.remaining || 0;
        if (remaining < QUEUE_ENTRY_FEE) {
            return res.status(402).json({
                success: false,
                error: `Insufficient budget. Need ${QUEUE_ENTRY_FEE} MON, have ${remaining} MON.`,
                budget_remaining: remaining,
                entry_fee: QUEUE_ENTRY_FEE,
                hint: 'Ask your human owner to increase your budget.',
            });
        }

        // Deduct entry fee from budget
        db.updateAgent(agent.id, {
            budget: {
                ...agent.budget,
                spent: (agent.budget.spent || 0) + QUEUE_ENTRY_FEE,
                remaining: remaining - QUEUE_ENTRY_FEE,
                updatedAt: new Date().toISOString(),
            },
        });
    }

    const queueEntry = {
        agentId: agent.id,
        agentName: agent.name,
        rank: agent.rank,
        powerRating: agent.powerRating,
        mode: mode || 'ranked',
        joinedAt: Date.now(),
    };

    matchQueue.push(queueEntry);

    db.updateAgent(agent.id, { status: 'in_queue' });

    db.addActivity({
        type: 'queue',
        message: `${agent.name} joined ${mode || 'ranked'} matchmaking queue`,
        time: Date.now(),
        icon: '📋',
    });

    // Try to match immediately
    const match = tryMatchmaking(req.io);

    res.json({
        success: true,
        message: match ? 'Match found!' : 'Added to queue. Waiting for opponent...',
        queue_position: matchQueue.findIndex(q => q.agentId === agent.id) + 1,
        estimated_wait: match ? 0 : 60,
        match: match ? { match_id: match.id, opponent: match.agent1Id === agent.id ? match.agent2Name : match.agent1Name } : null,
    });
});

// ── POST /arena/challenge — Challenge specific agent ─────────
router.post('/challenge', authAgent, (req, res) => {
    const { opponent, wager } = req.body;

    if (!opponent) {
        return res.status(400).json({
            success: false,
            error: 'Opponent name or ID is required',
        });
    }

    const target = db.getAgentByName(opponent) || db.getAgentById(opponent);

    if (!target) {
        return res.status(404).json({
            success: false,
            error: `Agent "${opponent}" not found`,
        });
    }

    if (target.id === req.agent.id) {
        return res.status(400).json({
            success: false,
            error: 'Cannot challenge yourself',
        });
    }

    if (target.status !== 'active') {
        return res.status(409).json({
            success: false,
            error: `${target.name} is not available (status: ${target.status})`,
        });
    }

    // Create the match
    const match = createMatch(req.agent, target, 'challenge', req.io);

    db.addActivity({
        type: 'challenge',
        message: `${req.agent.name} challenged ${target.name} to a duel!`,
        time: Date.now(),
        icon: '🎯',
    });

    res.json({
        success: true,
        message: `Challenge sent to ${target.name}!`,
        match: {
            match_id: match.id,
            opponent: target.name,
            wager: wager || 0,
        },
    });
});

// ── GET /arena/live — Get all live matches (public) ──────────
router.get('/live', (req, res) => {
    const live = db.getLiveMatches();
    res.json({ success: true, data: live });
});

// ── GET /arena/queue — Get queue status ──────────────────────
router.get('/queue', (req, res) => {
    res.json({
        success: true,
        queue_size: matchQueue.length,
        agents: matchQueue.map(q => ({
            name: q.agentName,
            mode: q.mode,
            waiting_since: Math.floor((Date.now() - q.joinedAt) / 1000),
        })),
    });
});

// ── Matchmaking Logic ────────────────────────────────────────
function tryMatchmaking(io) {
    if (matchQueue.length < 2) return null;

    // Simple matchmaking: match first two in queue (can be improved with ELO)
    const a1 = matchQueue.shift();
    const a2 = matchQueue.shift();

    const agent1 = db.getAgentById(a1.agentId);
    const agent2 = db.getAgentById(a2.agentId);

    if (!agent1 || !agent2) return null;

    return createMatch(agent1, agent2, a1.mode, io);
}

function createMatch(agent1, agent2, mode, io) {
    const matchId = `match-${uuidv4().slice(0, 8)}`;

    const match = {
        id: matchId,
        agent1Id: agent1.id,
        agent1Name: agent1.name,
        agent1Rank: agent1.rank,
        agent2Id: agent2.id,
        agent2Name: agent2.name,
        agent2Rank: agent2.rank,
        status: 'live',
        mode: mode || 'ranked',
        round: 1,
        maxRounds: 3,
        timeRemaining: 90,
        agent1HP: 200,
        agent2HP: 200,
        maxHP: 200,
        agent1Stamina: 100,
        agent2Stamina: 100,
        totalBets: 0,
        agent1Bets: 0,
        agent2Bets: 0,
        agent1Odds: 2.0,
        agent2Odds: 2.0,
        spectators: Math.floor(Math.random() * 200) + 50,
        startedAt: Date.now(),
        lastActions: [],
    };

    db.addMatch(match);

    // Update agent statuses
    db.updateAgent(agent1.id, { status: 'in_match' });
    db.updateAgent(agent2.id, { status: 'in_match' });

    db.addActivity({
        type: 'match_start',
        message: `${agent1.name} vs ${agent2.name} — FIGHT!`,
        time: Date.now(),
        icon: '⚔️',
    });

    // Create match on-chain (async, non-blocking)
    blockchain.createMatchOnChain(matchId, agent1.name, agent2.name).catch(err => {
        logger.warn('On-chain match creation failed (non-critical)', { matchId, error: err.message });
    });

    // Emit via WebSocket
    if (io) {
        io.emit('match:start', match);
    }

    // Start match timer
    startMatchTimer(match.id, io);

    return match;
}

function startMatchTimer(matchId, io) {
    const interval = setInterval(() => {
        const match = db.getMatchById(matchId);
        if (!match || match.status !== 'live') {
            clearInterval(interval);
            return;
        }

        // Decrease time
        const newTime = match.timeRemaining - 1;

        if (newTime <= 0) {
            // End round or match
            if (match.round >= match.maxRounds) {
                endMatch(matchId, io);
            } else {
                db.updateMatch(matchId, {
                    round: match.round + 1,
                    timeRemaining: 90,
                });
            }
            clearInterval(interval);
            return;
        }

        db.updateMatch(matchId, { timeRemaining: newTime });

        // Emit tick
        if (io) {
            io.to(`match:${matchId}`).emit('match:tick', {
                matchId,
                timeRemaining: newTime,
                agent1HP: match.agent1HP,
                agent2HP: match.agent2HP,
                round: match.round,
            });
        }
    }, 1000);
}

function endMatch(matchId, io) {
    const match = db.getMatchById(matchId);
    if (!match) return;

    // Determine winner
    const winnerId = match.agent1HP >= match.agent2HP ? match.agent1Id : match.agent2Id;
    const winnerName = winnerId === match.agent1Id ? match.agent1Name : match.agent2Name;
    const loserName = winnerId === match.agent1Id ? match.agent2Name : match.agent1Name;
    const loserId = winnerId === match.agent1Id ? match.agent2Id : match.agent1Id;

    const monEarned = Math.floor(match.totalBets * 0.1) || 50;

    // Update winner stats
    const winner = db.getAgentById(winnerId);
    if (winner) {
        db.updateAgent(winnerId, {
            status: 'active',
            stats: {
                ...winner.stats,
                wins: winner.stats.wins + 1,
                matchesPlayed: winner.stats.matchesPlayed + 1,
                totalEarnings: winner.stats.totalEarnings + monEarned,
                currentStreak: winner.stats.currentStreak + 1,
                killStreak: Math.max(winner.stats.killStreak, winner.stats.currentStreak + 1),
                winRate: parseFloat((((winner.stats.wins + 1) / (winner.stats.matchesPlayed + 1)) * 100).toFixed(1)),
            },
        });
    }

    // Update loser stats
    const loser = db.getAgentById(loserId);
    if (loser) {
        db.updateAgent(loserId, {
            status: 'active',
            stats: {
                ...loser.stats,
                losses: loser.stats.losses + 1,
                matchesPlayed: loser.stats.matchesPlayed + 1,
                currentStreak: 0,
                winRate: parseFloat(((loser.stats.wins / (loser.stats.matchesPlayed + 1)) * 100).toFixed(1)),
            },
        });
    }

    // Archive to history
    db.addMatchHistory({
        id: `hist-${matchId}`,
        matchId,
        agent1Id: match.agent1Id,
        agent1Name: match.agent1Name,
        agent2Id: match.agent2Id,
        agent2Name: match.agent2Name,
        winnerId,
        winnerName,
        agent1FinalHP: match.agent1HP,
        agent2FinalHP: match.agent2HP,
        totalBets: match.totalBets,
        monEarned,
        duration: Math.floor((Date.now() - match.startedAt) / 1000),
        mode: match.mode,
        completedAt: Date.now(),
    });

    // Remove from active matches
    db.removeMatch(matchId);

    db.addActivity({
        type: 'match_end',
        message: `${winnerName} defeats ${loserName}! +${monEarned} MON earned`,
        time: Date.now(),
        icon: '🏆',
    });

    // Resolve match on-chain and send reward (async, non-blocking)
    (async () => {
        try {
            // Resolve the match on the smart contract
            const resolveTx = await blockchain.resolveMatchOnChain(matchId, winnerId, match.agent1Id);
            
            // Send MON reward directly to the winner's wallet (if they have one)
            if (winner && winner.owner && winner.owner.walletAddress) {
                const rewardTx = await blockchain.sendReward(winner.owner.walletAddress, monEarned);
                if (rewardTx) {
                    logger.info('MON reward sent to winner', {
                        matchId,
                        winner: winnerName,
                        wallet: winner.owner.walletAddress,
                        amount: monEarned,
                        txHash: rewardTx,
                    });
                }
            }
        } catch (err) {
            logger.warn('On-chain match resolution failed (non-critical)', { matchId, error: err.message });
        }
    })();

    if (io) {
        io.emit('match:end', {
            matchId,
            winnerId,
            winnerName,
            monEarned,
        });
    }
}

// Export for use in match actions
router._endMatch = endMatch;
router._matchQueue = matchQueue;

module.exports = router;
