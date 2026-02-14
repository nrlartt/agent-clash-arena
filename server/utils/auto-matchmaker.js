// ═══════════════════════════════════════════════════════════════
// AUTO-MATCHMAKER — Creates matches automatically
// - Uses real agents when available (from DB/queue)
// - Falls back to simulation agents when not enough real ones
// - Registers matches on-chain for real betting
// ═══════════════════════════════════════════════════════════════

const { v4: uuidv4 } = require('uuid');
const logger = require('./logger');
const blockchain = require('./blockchain');
const { generateAgentEquipment, calculateEquipmentBonus, calculateEquipmentPower, SHOP_ITEMS_BY_ID } = require('../data/shop-items');

// Simulation agents (used when not enough real agents)
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

// ── Generate equipment for each SIM_AGENT on startup ──
SIM_AGENTS.forEach(agent => {
    const { equipped, bonus, equipmentPower } = generateAgentEquipment(agent.rank, SIM_AGENTS.length);
    agent.equipment = equipped;          // { weapon: item, armor: item, ... }
    agent.equipmentBonus = bonus;        // { damage: X, defense: Y, ... }
    agent.equipmentPower = equipmentPower;
    agent.powerRating = agent.basePowerRating + Math.round(equipmentPower * 0.3); // Equipment affects power rating
    logger.info(`[AutoMatchmaker] ${agent.name} equipped (power: ${agent.basePowerRating} + ${Math.round(equipmentPower * 0.3)} = ${agent.powerRating})`);
});

// Match phases timing (milliseconds)
const BETTING_DURATION = 30000;    // 30s betting window
const FIGHT_DURATION = 195000;     // 195s fight (3 rounds × 60s + pauses + buffer)
const RESULT_DURATION = 6000;      // 6s show result (was 10s)
const COOLDOWN_DURATION = 3000;    // 3s between matches (was 5s)

class AutoMatchmaker {
    constructor(io) {
        this.io = io;
        this.currentMatch = null;
        this.phase = 'IDLE';       // IDLE | BETTING | FIGHTING | RESULT | COOLDOWN
        this.phaseTimer = null;
        this.bettingTimeLeft = 0;
        this.bettingInterval = null;
        this.matchHistory = [];
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

    /**
     * Get current state for new WebSocket connections
     */
    getState() {
        return {
            phase: this.phase,
            match: this.currentMatch,
            bettingTimeLeft: this.bettingTimeLeft,
            matchHistory: this.matchHistory.slice(0, 10),
        };
    }

    // ── Match Lifecycle ─────────────────────────────────────

    async _nextMatch() {
        // Pick two fighters
        const [agent1, agent2] = this._pickFighters();
        const matchId = `match-${uuidv4().slice(0, 8)}`;

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
        };

        // Try to create match on-chain (NON-BLOCKING — never delay match start)
        this.currentMatch.onChain = false;
        blockchain.createMatchOnChain(matchId, agent1.name, agent2.name)
            .then(() => {
                this.currentMatch.onChain = true;
                logger.info(`[AutoMatchmaker] Match ${matchId} created on-chain`);
            })
            .catch(err => {
                logger.warn(`[AutoMatchmaker] On-chain match creation failed: ${err.message}`);
            });

        // Start BETTING phase
        this.phase = 'BETTING';
        this.bettingTimeLeft = Math.floor(BETTING_DURATION / 1000);

        this.io.emit('match:new', this.currentMatch);
        this.io.emit('match:phase', { phase: 'BETTING', match: this.currentMatch, timeLeft: this.bettingTimeLeft });

        logger.info(`[AutoMatchmaker] New match: ${agent1.name} vs ${agent2.name} (${matchId})`);

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
        fightEvents.forEach((event, i) => {
            setTimeout(() => {
                try {
                    this.io.emit('match:fight_event', event);
                } catch (e) { /* ignore */ }
            }, event.delay);
        });

        // End fight after duration — always schedule next match even if _endFight fails
        this.phaseTimer = setTimeout(() => {
            this._endFight().catch(err => {
                logger.error('[AutoMatchmaker] _endFight crashed, forcing next match', { error: err.message });
                this._scheduleNextMatch();
            });
        }, FIGHT_DURATION);
    }

    /**
     * Helper: always schedule the next match (RESULT → COOLDOWN → next)
     */
    _scheduleNextMatch() {
        clearTimeout(this.phaseTimer);
        this.phase = 'COOLDOWN';
        try { this.io.emit('match:phase', { phase: 'COOLDOWN' }); } catch (e) { /* ignore */ }
        logger.info('[AutoMatchmaker] Scheduling next match in 5s');
        this.phaseTimer = setTimeout(() => {
            this._safeNextMatch();
        }, COOLDOWN_DURATION);
    }

    async _endFight() {
        // ── Determine winner based on power rating + equipment + randomness ──
        const a1 = this.currentMatch.agent1;
        const a2 = this.currentMatch.agent2;

        // Base score from power rating (already includes equipment power)
        let a1Score = a1.powerRating + Math.random() * 40;
        let a2Score = a2.powerRating + Math.random() * 40;

        // Additional combat-relevant equipment bonuses affect outcome
        const eb1 = a1.equipmentBonus || {};
        const eb2 = a2.equipmentBonus || {};

        // Offensive bonus: damage, critChance, lifesteal contribute to winning
        a1Score += (eb1.damage || 0) * 0.4 + (eb1.critChance || 0) * 0.3 + (eb1.lifesteal || 0) * 0.2;
        a2Score += (eb2.damage || 0) * 0.4 + (eb2.critChance || 0) * 0.3 + (eb2.lifesteal || 0) * 0.2;

        // Defensive bonus: defense, maxHP, dodgeChance help survive
        a1Score += (eb1.defense || 0) * 0.3 + (eb1.maxHP || 0) * 0.05 + (eb1.dodgeChance || 0) * 0.25;
        a2Score += (eb2.defense || 0) * 0.3 + (eb2.maxHP || 0) * 0.05 + (eb2.dodgeChance || 0) * 0.25;

        // Speed & utility
        a1Score += (eb1.speed || 0) * 0.15 + (eb1.attackSpeed || 0) * 0.1;
        a2Score += (eb2.speed || 0) * 0.15 + (eb2.attackSpeed || 0) * 0.1;

        const winnerId = a1Score >= a2Score ? '1' : '2';
        const winner = winnerId === '1' ? a1 : a2;
        const loser = winnerId === '1' ? a2 : a1;

        // Method: always Decision (KO removed)
        const method = 'Decision';

        const result = {
            matchId: this.currentMatch.id,
            winnerId,
            winner: { name: winner.name, avatar: winner.avatar, color: winner.color },
            loser: { name: loser.name, avatar: loser.avatar, color: loser.color },
            method,
            duration: Math.floor(FIGHT_DURATION / 1000),
            monEarned: Math.floor(this.currentMatch.totalBets * 0.75) || Math.floor(Math.random() * 500 + 100),
            totalBets: this.currentMatch.totalBets,
            timestamp: Date.now(),
        };

        // Resolve match on-chain (truly NON-BLOCKING — fire and forget)
        if (this.currentMatch.onChain) {
            const mId = this.currentMatch.id;
            const wSide = winnerId === '1' ? 1 : 2;
            blockchain.resolveMatchOnChain(mId, wSide)
                .then(() => logger.info(`[AutoMatchmaker] Match ${mId} resolved on-chain, winner: ${winner.name}`))
                .catch(err => logger.warn(`[AutoMatchmaker] On-chain resolve failed: ${err.message}`));
        }

        // RESULT phase
        this.phase = 'RESULT';
        this.currentMatch.status = 'finished';
        this.currentMatch.result = result;

        // Add to history
        this.matchHistory.unshift(result);
        if (this.matchHistory.length > 20) this.matchHistory.pop();

        // Update sim agent stats
        const simWinner = SIM_AGENTS.find(a => a.id === winner.id);
        const simLoser = SIM_AGENTS.find(a => a.id === loser.id);
        if (simWinner) simWinner.wins++;
        if (simLoser) simLoser.losses++;

        try {
            this.io.emit('match:phase', { phase: 'RESULT', match: this.currentMatch, result });
            this.io.emit('match:result', result);
        } catch (err) {
            logger.error('[AutoMatchmaker] Failed to emit result', { error: err.message });
        }

        // ALWAYS schedule next match — this is the critical part
        this.phaseTimer = setTimeout(() => {
            this._scheduleNextMatch();
        }, RESULT_DURATION);

        logger.info(`[AutoMatchmaker] Match ${this.currentMatch.id} ended. Winner: ${winner.name} by ${method}. Next match in ${RESULT_DURATION / 1000 + COOLDOWN_DURATION / 1000}s`);
    }

    // ── Helpers ─────────────────────────────────────────────

    _pickFighters() {
        // TODO: When real agents exist in queue, prioritize them
        // For now: pick 2 random sim agents
        const shuffled = [...SIM_AGENTS].sort(() => Math.random() - 0.5);
        return [shuffled[0], shuffled[1]];
    }

    _formatAgent(agent) {
        // Build equipment summary for frontend display
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
            // Equipment data — used by frontend GameEngine for combat bonuses
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

    /**
     * Record a user's bet on the current match
     */
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

        // Broadcast updated match
        this.io.emit('match:update', this.currentMatch);
        return bet;
    }
}

module.exports = AutoMatchmaker;
