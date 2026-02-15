// ═══════════════════════════════════════════════════════════════
// AUTO-MATCHMAKER — Creates matches automatically
// - Uses REAL agents when available (from DB)
// - Falls back to simulation agents when not enough real ones
// - Registers matches on-chain for real betting
// - Updates real agent stats in DB after each match
// ═══════════════════════════════════════════════════════════════

const { v4: uuidv4 } = require('uuid');
const logger = require('./logger');
const blockchain = require('./blockchain');
const db = require('../db');
const { generateAgentEquipment } = require('../data/shop-items');

// Simulation agents (used ONLY when not enough real agents)
const SIM_AGENTS = [
    { id: 'sim-a1', name: 'ShadowStrike', avatar: '🗡️', color: '#FF2D78', rank: 1, wins: 47, losses: 12, basePowerRating: 94, weapon: { name: 'Dark Blade', icon: '🗡️' }, isSimulated: true },
    { id: 'sim-a2', name: 'IronGuard', avatar: '🛡️', color: '#00F5FF', rank: 2, wins: 41, losses: 15, basePowerRating: 89, weapon: { name: 'Iron Shield', icon: '🛡️' }, isSimulated: true },
    { id: 'sim-a3', name: 'VoidWalker', avatar: '🌀', color: '#836EF9', rank: 3, wins: 38, losses: 18, basePowerRating: 87, weapon: { name: 'Void Staff', icon: '🌀' }, isSimulated: true },
    { id: 'sim-a4', name: 'PyroBlitz', avatar: '🔥', color: '#FF6B35', rank: 4, wins: 35, losses: 20, basePowerRating: 83, weapon: { name: 'Flame Gauntlet', icon: '🔥' }, isSimulated: true },
    { id: 'sim-a5', name: 'FrostByte', avatar: '❄️', color: '#69D2E7', rank: 5, wins: 32, losses: 22, basePowerRating: 80, weapon: { name: 'Ice Shard', icon: '❄️' }, isSimulated: true },
    { id: 'sim-a6', name: 'ThunderClap', avatar: '⚡', color: '#FFE93E', rank: 6, wins: 29, losses: 25, basePowerRating: 76, weapon: { name: 'Storm Hammer', icon: '⚡' }, isSimulated: true },
    { id: 'sim-a7', name: 'NightReaper', avatar: '💀', color: '#9B59B6', rank: 7, wins: 26, losses: 28, basePowerRating: 72, weapon: { name: 'Soul Scythe', icon: '💀' }, isSimulated: true },
    { id: 'sim-a8', name: 'TitanForce', avatar: '🦾', color: '#2ECC71', rank: 8, wins: 23, losses: 30, basePowerRating: 68, weapon: { name: 'Power Fist', icon: '🦾' }, isSimulated: true },
];

// Assign equipment to sim agents
SIM_AGENTS.forEach(agent => {
    const { equipped, bonus, equipmentPower } = generateAgentEquipment(agent.rank, SIM_AGENTS.length);
    agent.equipment = equipped;
    agent.equipmentBonus = bonus;
    agent.equipmentPower = equipmentPower;
    agent.powerRating = agent.basePowerRating + Math.round(equipmentPower * 0.3);
});

// Agent colors for real agents
const AGENT_COLORS = ['#FF2D78', '#00F5FF', '#836EF9', '#FF6B35', '#69D2E7', '#FFE93E', '#9B59B6', '#2ECC71', '#E74C3C', '#1ABC9C'];

// Weapon map
const WEAPON_MAP = {
    blade: { name: 'Blade', icon: '🗡️' },
    mace: { name: 'Mace', icon: '🔨' },
    scythe: { name: 'Scythe', icon: '💀' },
    whip: { name: 'Whip', icon: '🪢' },
    lance: { name: 'Lance', icon: '🔱' },
    hammer: { name: 'Hammer', icon: '⚡' },
    axe: { name: 'Axe', icon: '🪓' },
    fist: { name: 'Fists', icon: '👊' },
};

// Strategy avatar map
const STRATEGY_AVATAR = {
    aggressive: '🔥',
    defensive: '🛡️',
    balanced: '⚖️',
};

// Match phases timing (milliseconds)
const BETTING_DURATION = 30000;    // 30s betting window
const FIGHT_DURATION = 195000;     // 195s fight (3 rounds × 60s + pauses + buffer)
const RESULT_DURATION = 6000;      // 6s show result
const COOLDOWN_DURATION = 3000;    // 3s between matches

class AutoMatchmaker {
    constructor(io) {
        this.io = io;
        this.currentMatch = null;
        this.phase = 'IDLE';
        this.phaseTimer = null;
        this.bettingTimeLeft = 0;
        this.bettingInterval = null;
        this.matchHistory = [];
        this._realAgentsCache = [];
        this._lastAgentFetch = 0;
    }

    start() {
        logger.info('[AutoMatchmaker] Starting automatic match cycle');
        this._safeNextMatch();
    }

    async _safeNextMatch() {
        try {
            await this._nextMatch();
        } catch (err) {
            logger.error('[AutoMatchmaker] Match cycle error, retrying in 5s', { error: err.message, stack: err.stack });
            clearTimeout(this.phaseTimer);
            this.phaseTimer = setTimeout(() => this._safeNextMatch(), 5000);
        }
    }

    stop() {
        clearTimeout(this.phaseTimer);
        clearInterval(this.bettingInterval);
        this.phase = 'IDLE';
        logger.info('[AutoMatchmaker] Stopped');
    }

    getState() {
        return {
            phase: this.phase,
            match: this.currentMatch,
            bettingTimeLeft: this.bettingTimeLeft,
            matchHistory: this.matchHistory.slice(0, 10),
        };
    }

    // ── Fetch real agents from DB ────────────────────────────
    async _fetchRealAgents() {
        const now = Date.now();
        // Cache for 30 seconds to avoid hammering DB every match cycle
        if (now - this._lastAgentFetch < 30000 && this._realAgentsCache.length > 0) {
            return this._realAgentsCache;
        }

        try {
            const allAgents = await db.getAgents();
            this._realAgentsCache = allAgents.filter(a =>
                a.status === 'active' && a.name && a.wallet && a.wallet.address
            );
            this._lastAgentFetch = now;
            logger.info(`[AutoMatchmaker] Fetched ${this._realAgentsCache.length} active real agents from DB`);
            return this._realAgentsCache;
        } catch (err) {
            logger.error('[AutoMatchmaker] Failed to fetch agents from DB', { error: err.message });
            return this._realAgentsCache; // Return stale cache on error
        }
    }

    // ── Convert DB agent to matchmaker format ────────────────
    _dbAgentToFighter(agent) {
        const colorIndex = (agent.name || '').length % AGENT_COLORS.length;
        const weaponKey = agent.weaponPreference || 'fist';
        const weapon = WEAPON_MAP[weaponKey] || WEAPON_MAP.fist;
        const avatar = STRATEGY_AVATAR[agent.strategy] || '⚔️';

        return {
            id: String(agent._id || agent.id),
            dbId: agent._id || agent.id,  // Keep original DB ID for updates
            name: agent.name,
            avatar,
            color: AGENT_COLORS[colorIndex],
            rank: agent.rank || 0,
            wins: agent.stats?.wins || 0,
            losses: agent.stats?.losses || 0,
            basePowerRating: agent.powerRating || 50,
            powerRating: agent.powerRating || 50,
            weapon,
            isSimulated: false,
            isReal: true,
            strategy: agent.strategy || 'balanced',
            ownerWallet: agent.owner?.walletAddress || null,
            agentWallet: agent.wallet?.address || null,
            equipment: null,
            equipmentBonus: {},
            equipmentPower: 0,
        };
    }

    // ── Match Lifecycle ─────────────────────────────────────

    async _nextMatch() {
        const [agent1, agent2] = await this._pickFighters();
        const matchId = `match-${uuidv4().slice(0, 8)}`;
        const hasRealAgent = !agent1.isSimulated || !agent2.isSimulated;

        this.currentMatch = {
            id: matchId,
            agent1: this._formatAgent(agent1),
            agent2: this._formatAgent(agent2),
            status: 'betting',
            agent1Bets: 0,
            agent2Bets: 0,
            totalBets: 0,
            agent1Odds: 2.0,
            agent2Odds: 2.0,
            bets: [],
            createdAt: Date.now(),
            isSimulated: agent1.isSimulated && agent2.isSimulated,
            hasRealAgent,
            onChain: false,
            onChainTxHash: null,
        };

        // Try to create match on-chain (NON-BLOCKING)
        blockchain.createMatchOnChain(matchId, agent1.name, agent2.name)
            .then((txHash) => {
                if (!this.currentMatch || this.currentMatch.id !== matchId) return;
                if (!txHash) {
                    logger.warn(`[AutoMatchmaker] Match ${matchId} could not be created on-chain; keeping off-chain mode`);
                    return;
                }

                this.currentMatch.onChain = true;
                this.currentMatch.onChainTxHash = txHash;
                this.io.emit('match:update', this.currentMatch);
                logger.info(`[AutoMatchmaker] Match ${matchId} created on-chain`, { txHash });
            })
            .catch(err => {
                logger.warn(`[AutoMatchmaker] On-chain match creation failed: ${err.message}`);
            });

        // Start BETTING phase
        this.phase = 'BETTING';
        this.bettingTimeLeft = Math.floor(BETTING_DURATION / 1000);

        this.io.emit('match:new', this.currentMatch);
        this.io.emit('match:phase', { phase: 'BETTING', match: this.currentMatch, timeLeft: this.bettingTimeLeft });

        const realLabel = hasRealAgent ? ' [REAL AGENTS]' : ' [SIM]';
        logger.info(`[AutoMatchmaker] New match: ${agent1.name} vs ${agent2.name} (${matchId})${realLabel}`);

        // Countdown timer
        this.bettingInterval = setInterval(() => {
            this.bettingTimeLeft--;
            this.io.emit('match:timer', { timeLeft: this.bettingTimeLeft });

            if (this.bettingTimeLeft <= 0) {
                clearInterval(this.bettingInterval);
                this._startFight();
            }
        }, 1000);
    }

    _startFight() {
        this.phase = 'FIGHTING';
        this.currentMatch.status = 'fighting';

        // Lock match on-chain (no more bets)
        if (this.currentMatch.onChain) {
            blockchain.lockMatchOnChain(this.currentMatch.id).catch(err => {
                logger.warn(`[AutoMatchmaker] On-chain lock failed: ${err.message}`);
            });
        }

        this.io.emit('match:phase', { phase: 'FIGHTING', match: this.currentMatch });

        // Simulate fight events during the fight
        const fightEvents = this._generateFightEvents();
        fightEvents.forEach((event) => {
            setTimeout(() => {
                try {
                    this.io.emit('match:fight_event', event);
                } catch (e) { /* ignore */ }
            }, event.delay);
        });

        // End fight after duration
        this.phaseTimer = setTimeout(() => {
            this._endFight().catch(err => {
                logger.error('[AutoMatchmaker] _endFight crashed, forcing next match', { error: err.message });
                this._scheduleNextMatch();
            });
        }, FIGHT_DURATION);
    }

    _scheduleNextMatch() {
        clearTimeout(this.phaseTimer);
        this.phase = 'COOLDOWN';
        try { this.io.emit('match:phase', { phase: 'COOLDOWN' }); } catch (e) { /* ignore */ }
        logger.info('[AutoMatchmaker] Scheduling next match in cooldown');
        this.phaseTimer = setTimeout(() => {
            this._safeNextMatch();
        }, COOLDOWN_DURATION);
    }

    async _endFight() {
        const a1 = this.currentMatch.agent1;
        const a2 = this.currentMatch.agent2;

        // Determine winner based on power rating + randomness
        let a1Score = a1.powerRating + Math.random() * 40;
        let a2Score = a2.powerRating + Math.random() * 40;

        // Strategy modifiers
        if (a1.strategy === 'aggressive') a1Score += 5;
        if (a1.strategy === 'defensive') a1Score += 3;
        if (a2.strategy === 'aggressive') a2Score += 5;
        if (a2.strategy === 'defensive') a2Score += 3;

        // Equipment bonuses
        const eb1 = a1.equipmentBonus || {};
        const eb2 = a2.equipmentBonus || {};
        a1Score += (eb1.damage || 0) * 0.4 + (eb1.critChance || 0) * 0.3 + (eb1.lifesteal || 0) * 0.2;
        a2Score += (eb2.damage || 0) * 0.4 + (eb2.critChance || 0) * 0.3 + (eb2.lifesteal || 0) * 0.2;
        a1Score += (eb1.defense || 0) * 0.3 + (eb1.maxHP || 0) * 0.05 + (eb1.dodgeChance || 0) * 0.25;
        a2Score += (eb2.defense || 0) * 0.3 + (eb2.maxHP || 0) * 0.05 + (eb2.dodgeChance || 0) * 0.25;
        a1Score += (eb1.speed || 0) * 0.15 + (eb1.attackSpeed || 0) * 0.1;
        a2Score += (eb2.speed || 0) * 0.15 + (eb2.attackSpeed || 0) * 0.1;

        const winnerId = a1Score >= a2Score ? '1' : '2';
        const winner = winnerId === '1' ? a1 : a2;
        const loser = winnerId === '1' ? a2 : a1;
        const method = 'Decision';

        const monEarned = Math.floor(this.currentMatch.totalBets * 0.75) || Math.floor(Math.random() * 500 + 100);

        const result = {
            matchId: this.currentMatch.id,
            winnerId,
            winner: { name: winner.name, avatar: winner.avatar, color: winner.color, isReal: !!winner.isReal },
            loser: { name: loser.name, avatar: loser.avatar, color: loser.color, isReal: !!loser.isReal },
            method,
            duration: Math.floor(FIGHT_DURATION / 1000),
            monEarned,
            totalBets: this.currentMatch.totalBets,
            timestamp: Date.now(),
            hasRealAgent: this.currentMatch.hasRealAgent,
        };

        // ── Update REAL agent stats in database ──────────────
        if (winner.isReal && winner.dbId) {
            try {
                const winnerAgent = await db.getAgentById(winner.dbId);
                if (winnerAgent) {
                    const stats = winnerAgent.stats || {};
                    const newWins = (stats.wins || 0) + 1;
                    const newMatchesPlayed = (stats.matchesPlayed || 0) + 1;
                    const newStreak = (stats.currentStreak || 0) + 1;
                    await db.updateAgent(winnerAgent._id || winner.dbId, {
                        stats: {
                            ...stats,
                            wins: newWins,
                            matchesPlayed: newMatchesPlayed,
                            totalEarnings: (stats.totalEarnings || 0) + monEarned,
                            currentStreak: newStreak,
                            killStreak: Math.max(stats.killStreak || 0, newStreak),
                            winRate: parseFloat(((newWins / newMatchesPlayed) * 100).toFixed(1)),
                        },
                        powerRating: Math.min((winnerAgent.powerRating || 50) + 2, 100),
                    });
                    logger.info(`[AutoMatchmaker] Updated winner stats: ${winner.name} (wins: ${newWins}, streak: ${newStreak})`);
                }
            } catch (err) {
                logger.error(`[AutoMatchmaker] Failed to update winner stats: ${err.message}`);
            }
        }

        if (loser.isReal && loser.dbId) {
            try {
                const loserAgent = await db.getAgentById(loser.dbId);
                if (loserAgent) {
                    const stats = loserAgent.stats || {};
                    const newLosses = (stats.losses || 0) + 1;
                    const newMatchesPlayed = (stats.matchesPlayed || 0) + 1;
                    await db.updateAgent(loserAgent._id || loser.dbId, {
                        stats: {
                            ...stats,
                            losses: newLosses,
                            matchesPlayed: newMatchesPlayed,
                            currentStreak: 0,
                            winRate: parseFloat(((stats.wins || 0) / newMatchesPlayed * 100).toFixed(1)),
                        },
                        powerRating: Math.max((loserAgent.powerRating || 50) - 1, 10),
                    });
                    logger.info(`[AutoMatchmaker] Updated loser stats: ${loser.name} (losses: ${newLosses})`);
                }
            } catch (err) {
                logger.error(`[AutoMatchmaker] Failed to update loser stats: ${err.message}`);
            }
        }

        // ── Send on-chain reward to winner's owner wallet ────
        if (winner.isReal && winner.ownerWallet && monEarned > 0) {
            const rewardMON = monEarned * 0.15; // 15% of pool to winning agent owner
            if (rewardMON > 0.001) {
                blockchain.sendReward(winner.ownerWallet, rewardMON)
                    .then(txHash => {
                        if (txHash) logger.info(`[AutoMatchmaker] Reward sent: ${rewardMON} MON to ${winner.ownerWallet} (${txHash})`);
                    })
                    .catch(err => logger.warn(`[AutoMatchmaker] Reward failed: ${err.message}`));
            }
        }

        // Resolve match on-chain
        if (this.currentMatch.onChain) {
            const mId = this.currentMatch.id;
            const winnerAgentId = winnerId === '1' ? a1.id : a2.id;
            const agent1Id = a1.id;
            blockchain.resolveMatchOnChain(mId, winnerAgentId, agent1Id)
                .then(() => logger.info(`[AutoMatchmaker] Match ${mId} resolved on-chain, winner: ${winner.name}`))
                .catch(err => logger.warn(`[AutoMatchmaker] On-chain resolve failed: ${err.message}`));
        }

        // Update sim agent stats (for simulated agents only)
        const simWinner = SIM_AGENTS.find(a => a.id === winner.id);
        const simLoser = SIM_AGENTS.find(a => a.id === loser.id);
        if (simWinner) simWinner.wins++;
        if (simLoser) simLoser.losses++;

        // Activity log
        try {
            await db.addActivity({
                type: 'match_end',
                message: `${winner.name} defeats ${loser.name}${winner.isReal ? ' [REAL]' : ''}! +${monEarned} MON`,
                time: Date.now(),
                icon: '🏆',
            });
        } catch (err) {
            logger.error('[AutoMatchmaker] Activity log failed:', err.message);
        }

        // RESULT phase
        this.phase = 'RESULT';
        this.currentMatch.status = 'finished';
        this.currentMatch.result = result;

        this.matchHistory.unshift(result);
        if (this.matchHistory.length > 20) this.matchHistory.pop();

        try {
            this.io.emit('match:phase', { phase: 'RESULT', match: this.currentMatch, result });
            this.io.emit('match:result', result);
        } catch (err) {
            logger.error('[AutoMatchmaker] Failed to emit result', { error: err.message });
        }

        // ALWAYS schedule next match
        this.phaseTimer = setTimeout(() => {
            this._scheduleNextMatch();
        }, RESULT_DURATION);

        logger.info(`[AutoMatchmaker] Match ${this.currentMatch.id} ended. Winner: ${winner.name}${winner.isReal ? ' [REAL]' : ''} by ${method}. Next match soon.`);
    }

    // ── Helpers ─────────────────────────────────────────────

    async _pickFighters() {
        const realAgents = await this._fetchRealAgents();
        const activeReal = realAgents.filter(a => a.status === 'active');

        if (activeReal.length >= 2) {
            // Pick 2 random real agents
            const shuffled = [...activeReal].sort(() => Math.random() - 0.5);
            const fighter1 = this._dbAgentToFighter(shuffled[0]);
            const fighter2 = this._dbAgentToFighter(shuffled[1]);
            logger.info(`[AutoMatchmaker] Picked REAL agents: ${fighter1.name} vs ${fighter2.name}`);
            return [fighter1, fighter2];
        }

        if (activeReal.length === 1) {
            // 1 real agent vs 1 simulated
            const fighter1 = this._dbAgentToFighter(activeReal[0]);
            const simShuffled = [...SIM_AGENTS].sort(() => Math.random() - 0.5);
            const fighter2 = simShuffled[0];
            logger.info(`[AutoMatchmaker] Mixed match: ${fighter1.name} (REAL) vs ${fighter2.name} (SIM)`);
            return [fighter1, fighter2];
        }

        // No real agents — use sim agents
        const shuffled = [...SIM_AGENTS].sort(() => Math.random() - 0.5);
        return [shuffled[0], shuffled[1]];
    }

    _formatAgent(agent) {
        const equippedItems = [];
        if (agent.equipment) {
            for (const [slot, item] of Object.entries(agent.equipment)) {
                if (item) {
                    equippedItems.push({
                        slot,
                        id: item.id,
                        name: item.name,
                        rarity: item.rarity,
                        icon: item.icon || '📦',
                        category: item.category,
                    });
                }
            }
        }

        return {
            id: agent.id,
            dbId: agent.dbId || null,
            name: agent.name,
            avatar: agent.avatar,
            color: agent.color,
            rank: agent.rank || 0,
            wins: agent.wins || 0,
            losses: agent.losses || 0,
            powerRating: agent.powerRating || 50,
            basePowerRating: agent.basePowerRating || agent.powerRating || 50,
            weapon: agent.weapon || { name: 'Fists', icon: '👊' },
            isSimulated: !!agent.isSimulated,
            isReal: !!agent.isReal,
            strategy: agent.strategy || 'balanced',
            ownerWallet: agent.ownerWallet || null,
            agentWallet: agent.agentWallet || null,
            equipmentBonus: agent.equipmentBonus || null,
            equipmentPower: agent.equipmentPower || 0,
            equippedItems,
        };
    }

    _generateFightEvents() {
        const events = [];
        const a1 = this.currentMatch.agent1;
        const a2 = this.currentMatch.agent2;
        const count = 8 + Math.floor(Math.random() * 6);

        for (let i = 0; i < count; i++) {
            const attacker = Math.random() > 0.5 ? a1 : a2;
            const defender = attacker === a1 ? a2 : a1;
            const damage = Math.floor(Math.random() * 25 + 5);
            const types = ['hit', 'critical', 'combo', 'dodge', 'special', 'block'];
            const type = types[Math.floor(Math.random() * types.length)];
            const icons = { hit: '👊', critical: '💥', combo: '⚡', dodge: '💨', special: '🌟', block: '🛡️' };

            events.push({
                type,
                icon: icons[type],
                attacker: attacker.name,
                defender: defender.name,
                damage: type === 'dodge' || type === 'block' ? 0 : damage,
                text: type === 'dodge'
                    ? `${defender.name} dodged ${attacker.name}'s attack!`
                    : type === 'block'
                    ? `${defender.name} blocked! No damage.`
                    : `${attacker.name} ${type === 'critical' ? 'CRITICAL HIT' : type === 'combo' ? 'COMBO' : type === 'special' ? 'SPECIAL MOVE' : 'hit'} ${defender.name} for ${damage} DMG!`,
                delay: Math.floor((i / count) * FIGHT_DURATION * 0.9) + Math.floor(Math.random() * 2000),
            });
        }

        return events.sort((a, b) => a.delay - b.delay);
    }

    recordBet(side, amount, address) {
        if (!this.currentMatch || this.phase !== 'BETTING') return null;

        const bet = { side, amount: parseFloat(amount), address, timestamp: Date.now() };
        this.currentMatch.bets.push(bet);

        if (side === '1') {
            this.currentMatch.agent1Bets += bet.amount;
        } else {
            this.currentMatch.agent2Bets += bet.amount;
        }
        this.currentMatch.totalBets = this.currentMatch.agent1Bets + this.currentMatch.agent2Bets;

        // Recalculate odds
        const total = this.currentMatch.totalBets;
        if (total > 0 && this.currentMatch.agent1Bets > 0 && this.currentMatch.agent2Bets > 0) {
            this.currentMatch.agent1Odds = parseFloat((total / this.currentMatch.agent1Bets).toFixed(2));
            this.currentMatch.agent2Odds = parseFloat((total / this.currentMatch.agent2Bets).toFixed(2));
        }

        this.io.emit('match:update', this.currentMatch);
        return bet;
    }
}

module.exports = AutoMatchmaker;
