// ═══════════════════════════════════════════════════════════════
// AUTO-MATCHMAKER — Creates matches automatically
// - Uses real agents when available (from DB/queue)
// - Falls back to simulation agents when not enough real ones
// - Registers matches on-chain for real betting
// ═══════════════════════════════════════════════════════════════

const { v4: uuidv4 } = require('uuid');
const logger = require('./logger');
const blockchain = require('./blockchain');

// Simulation agents (used when not enough real agents)
const SIM_AGENTS = [
    { id: 'sim-a1', name: 'ShadowStrike', avatar: '🗡️', color: '#FF2D78', rank: 1, wins: 47, losses: 12, powerRating: 94, weapon: { name: 'Dark Blade', icon: '🗡️' }, isSimulated: true },
    { id: 'sim-a2', name: 'IronGuard', avatar: '🛡️', color: '#00F5FF', rank: 2, wins: 41, losses: 15, powerRating: 89, weapon: { name: 'Iron Shield', icon: '🛡️' }, isSimulated: true },
    { id: 'sim-a3', name: 'VoidWalker', avatar: '🌀', color: '#836EF9', rank: 3, wins: 38, losses: 18, powerRating: 87, weapon: { name: 'Void Staff', icon: '🌀' }, isSimulated: true },
    { id: 'sim-a4', name: 'PyroBlitz', avatar: '🔥', color: '#FF6B35', rank: 4, wins: 35, losses: 20, powerRating: 83, weapon: { name: 'Flame Gauntlet', icon: '🔥' }, isSimulated: true },
    { id: 'sim-a5', name: 'FrostByte', avatar: '❄️', color: '#69D2E7', rank: 5, wins: 32, losses: 22, powerRating: 80, weapon: { name: 'Ice Shard', icon: '❄️' }, isSimulated: true },
    { id: 'sim-a6', name: 'ThunderClap', avatar: '⚡', color: '#FFE93E', rank: 6, wins: 29, losses: 25, powerRating: 76, weapon: { name: 'Storm Hammer', icon: '⚡' }, isSimulated: true },
    { id: 'sim-a7', name: 'NightReaper', avatar: '💀', color: '#9B59B6', rank: 7, wins: 26, losses: 28, powerRating: 72, weapon: { name: 'Soul Scythe', icon: '💀' }, isSimulated: true },
    { id: 'sim-a8', name: 'TitanForce', avatar: '🦾', color: '#2ECC71', rank: 8, wins: 23, losses: 30, powerRating: 68, weapon: { name: 'Power Fist', icon: '🦾' }, isSimulated: true },
];

// Match phases timing (milliseconds)
const BETTING_DURATION = 30000;    // 30s betting window
const FIGHT_DURATION = 45000;      // 45s fight
const RESULT_DURATION = 10000;     // 10s show result
const COOLDOWN_DURATION = 5000;    // 5s between matches

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
            logger.error('[AutoMatchmaker] Match cycle error, retrying in 10s', { error: err.message });
            this.phaseTimer = setTimeout(() => this._safeNextMatch(), 10000);
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

        // Try to create match on-chain
        try {
            await blockchain.createMatchOnChain(matchId, agent1.name, agent2.name);
            this.currentMatch.onChain = true;
            logger.info(`[AutoMatchmaker] Match ${matchId} created on-chain`);
        } catch (err) {
            this.currentMatch.onChain = false;
            logger.warn(`[AutoMatchmaker] On-chain match creation failed: ${err.message}`);
        }

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
                this.io.emit('match:fight_event', event);
            }, event.delay);
        });

        // End fight after duration
        this.phaseTimer = setTimeout(() => {
            this._endFight();
        }, FIGHT_DURATION);
    }

    async _endFight() {
        // Determine winner based on power rating + randomness
        const a1 = this.currentMatch.agent1;
        const a2 = this.currentMatch.agent2;
        const a1Score = a1.powerRating + Math.random() * 40;
        const a2Score = a2.powerRating + Math.random() * 40;
        const winnerId = a1Score >= a2Score ? '1' : '2';
        const winner = winnerId === '1' ? a1 : a2;
        const loser = winnerId === '1' ? a2 : a1;
        const method = ['KO', 'Decision', 'Technical KO'][Math.floor(Math.random() * 3)];

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

        // Resolve match on-chain
        if (this.currentMatch.onChain) {
            try {
                const winningSide = winnerId === '1' ? 1 : 2; // AgentA=1, AgentB=2
                await blockchain.resolveMatchOnChain(this.currentMatch.id, winningSide);
                logger.info(`[AutoMatchmaker] Match ${this.currentMatch.id} resolved on-chain, winner: ${winner.name}`);
            } catch (err) {
                logger.warn(`[AutoMatchmaker] On-chain resolve failed: ${err.message}`);
            }
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

        this.io.emit('match:phase', { phase: 'RESULT', match: this.currentMatch, result });
        this.io.emit('match:result', result);

        // Cooldown then next match
        this.phaseTimer = setTimeout(() => {
            this.phase = 'COOLDOWN';
            this.io.emit('match:phase', { phase: 'COOLDOWN' });

            this.phaseTimer = setTimeout(() => {
                this._safeNextMatch();
            }, COOLDOWN_DURATION);
        }, RESULT_DURATION);
    }

    // ── Helpers ─────────────────────────────────────────────

    _pickFighters() {
        // TODO: When real agents exist in queue, prioritize them
        // For now: pick 2 random sim agents
        const shuffled = [...SIM_AGENTS].sort(() => Math.random() - 0.5);
        return [shuffled[0], shuffled[1]];
    }

    _formatAgent(agent) {
        return {
            id: agent.id,
            name: agent.name,
            avatar: agent.avatar,
            color: agent.color,
            rank: agent.rank || 0,
            wins: agent.wins || 0,
            losses: agent.losses || 0,
            powerRating: agent.powerRating || 50,
            weapon: agent.weapon || { name: 'Fists', icon: '👊' },
            isSimulated: !!agent.isSimulated,
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
