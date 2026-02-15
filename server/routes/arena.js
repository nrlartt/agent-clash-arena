// ═══════════════════════════════════════════════════════════════
// ARENA ROUTES — Matchmaking, heartbeat, queue, challenges
// ═══════════════════════════════════════════════════════════════

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { authAgent, optionalAuth } = require('../middleware/auth');
const db = require('../db');
const blockchain = require('../utils/blockchain');
const logger = require('../utils/logger');
const { splitPool, distributeBettorsPool } = require('../utils/economy');
const { safeEqual } = require('../utils/crypto');

const router = express.Router();

// In-memory queue (not persisted)
const matchQueue = [];
const TOURNAMENT_MIN_AGENTS = Math.max(2, parseInt(process.env.TOURNAMENT_MIN_AGENTS || '8', 10));
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || '';
let tournamentState = {
    active: false,
    id: null,
    createdAt: null,
    minAgents: TOURNAMENT_MIN_AGENTS,
    currentRound: 0,
    participants: [],
    rounds: [],
    champion: null,
};

async function getEligibleTournamentAgents() {
    return (await db.getAgents())
        .filter(a => a.status === 'active')
        .sort((a, b) => {
            const rankA = Number.isFinite(a.rank) ? a.rank : 99999;
            const rankB = Number.isFinite(b.rank) ? b.rank : 99999;
            if (rankA !== rankB) return rankA - rankB;
            return (b.powerRating || 0) - (a.powerRating || 0);
        });
}

function maxPowerOfTwo(n) {
    let p = 1;
    while (p * 2 <= n) p *= 2;
    return p;
}

function requireAdmin(req, res, next) {
    if (!ADMIN_API_KEY) {
        if (process.env.NODE_ENV === 'production') {
            return res.status(503).json({
                success: false,
                error: 'Admin API key is not configured',
            });
        }
        return next();
    }

    const given = req.headers['x-admin-key'];
    if (!safeEqual(given, ADMIN_API_KEY)) {
        return res.status(401).json({
            success: false,
            error: 'Unauthorized admin action',
        });
    }
    return next();
}

// ── GET /arena/heartbeat — Agent check-in ────────────────────
router.get('/heartbeat', authAgent, async (req, res) => {
    const agent = req.agent;

    // Update last heartbeat
    await db.updateAgent(agent._id || agent.id, { lastHeartbeat: Date.now() });

    // Check for pending matches
    const liveMatches = await db.getLiveMatches();
    const pendingMatch = liveMatches.find(
        m => m.agent1Id === agent.id || m.agent2Id === agent.id
    );

    // Get notifications (recent activity relevant to this agent)
    const notifications = (await db.getActivity(10)).filter(
        a => a.message && a.message.includes(agent.name)
    );

    await db.addActivity({
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

router.post('/queue', authAgent, async (req, res) => {
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
    const currentLiveMatches = await db.getLiveMatches();
    const existingMatch = currentLiveMatches.find(
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
        await db.updateAgent(agent._id || agent.id, {
            budget: {
                ...agent.budget,
                spent: (agent.budget.spent || 0) + QUEUE_ENTRY_FEE,
                remaining: remaining - QUEUE_ENTRY_FEE,
                updatedAt: new Date().toISOString(),
            },
        });
    }

    const queueEntry = {
        agentId: agent._id || agent.id,
        agentName: agent.name,
        rank: agent.rank,
        powerRating: agent.powerRating,
        mode: mode || 'ranked',
        joinedAt: Date.now(),
    };

    matchQueue.push(queueEntry);

    await db.updateAgent(agent._id || agent.id, { status: 'in_queue' });

    await db.addActivity({
        type: 'queue',
        message: `${agent.name} joined ${mode || 'ranked'} matchmaking queue`,
        time: Date.now(),
        icon: '📋',
    });

    // Try to match immediately
    const match = await tryMatchmaking(req.io);

    res.json({
        success: true,
        message: match ? 'Match found!' : 'Added to queue. Waiting for opponent...',
        queue_position: matchQueue.findIndex(q => q.agentId === agent.id) + 1,
        estimated_wait: match ? 0 : 60,
        match: match ? { match_id: match.id, opponent: match.agent1Id === agent.id ? match.agent2Name : match.agent1Name } : null,
    });
});

// ── POST /arena/challenge — Challenge specific agent ─────────
router.post('/challenge', authAgent, async (req, res) => {
    const { opponent, wager } = req.body;

    if (!opponent) {
        return res.status(400).json({
            success: false,
            error: 'Opponent name or ID is required',
        });
    }

    const target = (await db.getAgentByName(opponent)) || (await db.getAgentById(opponent));

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
    const match = await createMatch(req.agent, target, 'challenge', req.io);

    await db.addActivity({
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
router.get('/live', async (req, res) => {
    const live = await db.getLiveMatches();
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

// ── GET /arena/tournament/status — Tournament readiness/status ─
router.get('/tournament/status', async (_req, res) => {
    const eligibleAgents = await getEligibleTournamentAgents();
    const nextBracketSize = maxPowerOfTwo(eligibleAgents.length);
    res.json({
        success: true,
        data: {
            ...tournamentState,
            eligibleAgents: eligibleAgents.length,
            nextBracketSize,
            ready: eligibleAgents.length >= tournamentState.minAgents,
            upcomingParticipants: eligibleAgents.slice(0, nextBracketSize).map(a => ({
                id: a.id,
                name: a.name,
                rank: a.rank,
                powerRating: a.powerRating,
            })),
        },
    });
});

async function createTournamentRound(participantIds, io) {
    const roundMatchIds = [];
    for (let i = 0; i < participantIds.length; i += 2) {
        const aId = participantIds[i];
        const bId = participantIds[i + 1];
        const a = await db.getAgentById(aId);
        const b = await db.getAgentById(bId);
        if (!a || !b) continue;
        const match = await createMatch(a, b, 'tournament', io);
        roundMatchIds.push(match.id);
    }
    return roundMatchIds;
}

// ── POST /arena/tournament/start — Start bracket by active agent count ─
router.post('/tournament/start', requireAdmin, async (_req, res) => {
    if (tournamentState.active) {
        return res.status(409).json({
            success: false,
            error: 'Tournament already running',
            tournament: tournamentState,
        });
    }

    const eligibleAgents = await getEligibleTournamentAgents();
    if (eligibleAgents.length < TOURNAMENT_MIN_AGENTS) {
        return res.status(400).json({
            success: false,
            error: `Not enough active agents for tournament. Need ${TOURNAMENT_MIN_AGENTS}, got ${eligibleAgents.length}`,
        });
    }

    const bracketSize = Math.min(16, maxPowerOfTwo(eligibleAgents.length));
    const participants = eligibleAgents.slice(0, bracketSize).map(a => a.id);
    const tournamentId = `tournament-${Date.now()}`;
    const roundMatchIds = await createTournamentRound(participants, _req.io);

    tournamentState = {
        ...tournamentState,
        active: true,
        id: tournamentId,
        createdAt: Date.now(),
        champion: null,
        currentRound: 1,
        participants,
        rounds: [{
            round: 1,
            participantIds: participants,
            matchIds: roundMatchIds,
            winners: [],
        }],
    };

    await db.addActivity({
        type: 'tournament',
        message: `Tournament ${tournamentId} started with ${participants.length} agents`,
        time: Date.now(),
        icon: '🏆',
    });

    if (_req.io) {
        _req.io.emit('tournament:start', {
            id: tournamentId,
            participants: participants.length,
            round: 1,
            matchIds: roundMatchIds,
        });
    }

    return res.json({
        success: true,
        message: 'Tournament started',
        data: tournamentState,
    });
});

// ── Matchmaking Logic ────────────────────────────────────────
async function tryMatchmaking(io) {
    if (matchQueue.length < 2) return null;

    // Simple matchmaking: match first two in queue (can be improved with ELO)
    const a1 = matchQueue.shift();
    const a2 = matchQueue.shift();

    const agent1 = await db.getAgentById(a1.agentId);
    const agent2 = await db.getAgentById(a2.agentId);

    if (!agent1 || !agent2) return null;

    return await createMatch(agent1, agent2, a1.mode, io);
}

async function createMatch(agent1, agent2, mode, io) {
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

    await db.addMatch(match);

    // Update agent statuses
    await db.updateAgent(agent1._id || agent1.id, { status: 'in_match' });
    await db.updateAgent(agent2._id || agent2.id, { status: 'in_match' });

    await db.addActivity({
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
    const interval = setInterval(async () => {
        try {
            const match = await db.getMatchById(matchId);
            if (!match || match.status !== 'live') {
                clearInterval(interval);
                return;
            }

            // Decrease time
            const newTime = match.timeRemaining - 1;

            if (newTime <= 0) {
                // End round or match
                if (match.round >= match.maxRounds) {
                    await endMatch(matchId, io);
                } else {
                    await db.updateMatch(matchId, {
                        round: match.round + 1,
                        timeRemaining: 90,
                    });
                }
                clearInterval(interval);
                return;
            }

            await db.updateMatch(matchId, { timeRemaining: newTime });

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
        } catch (err) {
            logger.error('Match timer error', { matchId, error: err.message });
            clearInterval(interval);
        }
    }, 1000);
}

async function endMatch(matchId, io) {
    const match = await db.getMatchById(matchId);
    if (!match) return;

    // Determine winner
    const winnerId = match.agent1HP >= match.agent2HP ? match.agent1Id : match.agent2Id;
    const winnerName = winnerId === match.agent1Id ? match.agent1Name : match.agent2Name;
    const loserName = winnerId === match.agent1Id ? match.agent2Name : match.agent1Name;
    const loserId = winnerId === match.agent1Id ? match.agent2Id : match.agent1Id;

    const totalPool = Number(match.totalBets || 0);
    const split = splitPool(totalPool);
    const allBets = (await db.getBetsForMatch(matchId)) || [];
    const winningBets = allBets.filter(b => b.agentId === winnerId);
    const bettorsDistribution = distributeBettorsPool(split.bettorsAmount, winningBets);
    const platformCarry = split.platformAmount + Math.max(0, bettorsDistribution.unallocated || 0);
    const winnerReward = split.winnerAmount;

    // Update winner stats
    const winner = await db.getAgentById(winnerId);
    if (winner) {
        await db.updateAgent(winnerId, {
            status: 'active',
            stats: {
                ...winner.stats,
                wins: winner.stats.wins + 1,
                matchesPlayed: winner.stats.matchesPlayed + 1,
                totalEarnings: winner.stats.totalEarnings + winnerReward,
                currentStreak: winner.stats.currentStreak + 1,
                killStreak: Math.max(winner.stats.killStreak, winner.stats.currentStreak + 1),
                winRate: parseFloat((((winner.stats.wins + 1) / (winner.stats.matchesPlayed + 1)) * 100).toFixed(1)),
            },
        });
    }

    // Update loser stats
    const loser = await db.getAgentById(loserId);
    if (loser) {
        await db.updateAgent(loserId, {
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

    if (typeof db.updateBet === 'function') {
        for (const bet of allBets) {
            const isWinnerTicket = bet.agentId === winnerId;
            await db.updateBet(bet.id, {
                status: isWinnerTicket ? 'won' : 'lost',
                payout: isWinnerTicket ? (bettorsDistribution.payoutsByBetId[bet.id] || 0) : 0,
                resolvedAt: Date.now(),
            });
        }
    }

    if (typeof db.getPlatformEconomy === 'function' && typeof db.updatePlatformEconomy === 'function') {
        const economy = await db.getPlatformEconomy();
        await db.updatePlatformEconomy({
            treasuryMON: Number((economy.treasuryMON + platformCarry).toFixed(6)),
            totalPaidToAgents: Number((economy.totalPaidToAgents + winnerReward).toFixed(6)),
            totalPaidToBettors: Number((economy.totalPaidToBettors + bettorsDistribution.totalPayout).toFixed(6)),
        });
    }

    // Archive to history
    await db.addMatchHistory({
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
        totalBets: totalPool,
        monEarned: winnerReward,
        payout: {
            split: {
                platformPct: split.platformPct,
                winnerPct: split.winnerPct,
                bettorsPct: split.bettorsPct,
            },
            platformAmount: platformCarry,
            winnerAmount: winnerReward,
            bettorsAmount: bettorsDistribution.totalPayout,
            winningTickets: bettorsDistribution.winningTickets,
            winningWallets: Object.keys(bettorsDistribution.payoutsByWallet || {}).length,
        },
        duration: Math.floor((Date.now() - match.startedAt) / 1000),
        mode: match.mode,
        completedAt: Date.now(),
    });

    // Remove from active matches
    await db.removeMatch(matchId);

    await db.addActivity({
        type: 'match_end',
        message: `${winnerName} defeats ${loserName}! Agent +${winnerReward} MON, Bettors +${bettorsDistribution.totalPayout.toFixed(2)} MON`,
        time: Date.now(),
        icon: '🏆',
    });

    // Resolve match on-chain and send reward (async, non-blocking)
    (async () => {
        try {
            // Resolve the match on the smart contract
            await blockchain.resolveMatchOnChain(matchId, winnerId, match.agent1Id);
            
            // Send MON reward directly to the winner's wallet (if they have one)
            if (winner && winner.owner && winner.owner.walletAddress) {
                const rewardTx = await blockchain.sendReward(winner.owner.walletAddress, winnerReward);
                if (rewardTx) {
                    logger.info('MON reward sent to winner', {
                        matchId,
                        winner: winnerName,
                        wallet: winner.owner.walletAddress,
                        amount: winnerReward,
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
            monEarned: winnerReward,
            payout: {
                platform: platformCarry,
                winner: winnerReward,
                bettors: bettorsDistribution.totalPayout,
            },
        });
    }

    await maybeAdvanceTournament(matchId, winnerId, io);
}

async function maybeAdvanceTournament(matchId, winnerId, io) {
    if (!tournamentState.active || tournamentState.currentRound < 1) return;
    const current = tournamentState.rounds[tournamentState.currentRound - 1];
    if (!current || !current.matchIds.includes(matchId)) return;
    if (!current.winners.includes(winnerId)) current.winners.push(winnerId);

    if (current.winners.length < current.matchIds.length) return;

    if (current.winners.length === 1) {
        tournamentState.active = false;
        tournamentState.champion = current.winners[0];
        const champAgent = await db.getAgentById(current.winners[0]);
        await db.addActivity({
            type: 'tournament',
            message: `Tournament ${tournamentState.id} ended. Champion: ${champAgent?.name || current.winners[0]}`,
            time: Date.now(),
            icon: '🏅',
        });
        if (io) {
            io.emit('tournament:end', {
                id: tournamentState.id,
                championId: tournamentState.champion,
            });
        }
        return;
    }

    const nextRoundParticipants = [...current.winners];
    const nextRound = tournamentState.currentRound + 1;
    const matchIds = await createTournamentRound(nextRoundParticipants, io);
    tournamentState.currentRound = nextRound;
    tournamentState.rounds.push({
        round: nextRound,
        participantIds: nextRoundParticipants,
        matchIds,
        winners: [],
    });

    await db.addActivity({
        type: 'tournament',
        message: `Tournament ${tournamentState.id} advanced to round ${nextRound}`,
        time: Date.now(),
        icon: '🎯',
    });

    if (io) {
        io.emit('tournament:round', {
            id: tournamentState.id,
            round: nextRound,
            participants: nextRoundParticipants.length,
            matchIds,
        });
    }
}

// Export for use in match actions
router._endMatch = endMatch;
router._matchQueue = matchQueue;
router._tournamentState = () => tournamentState;

module.exports = router;
