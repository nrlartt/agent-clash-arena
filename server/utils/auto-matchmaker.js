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

function parseDurationMs(value, fallback, min = 1000) {
    const parsed = parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed) || parsed < min) return fallback;
    return parsed;
}

function parseAmount(value, fallback, min = 0) {
    const parsed = Number.parseFloat(String(value ?? ''));
    if (!Number.isFinite(parsed) || parsed < min) return fallback;
    return parsed;
}

// Match phases timing and pool gating
const BETTING_DURATION = parseDurationMs(process.env.MATCH_BETTING_DURATION_MS, 120000); // 2m default
const BETTING_EXTENSION_DURATION = parseDurationMs(process.env.MATCH_POOL_EXTENSION_MS, BETTING_DURATION);
const MATCH_MIN_POOL_MON = parseAmount(process.env.MATCH_MIN_POOL_MON, 100, 0);
const WAITING_RETRY_MS = parseDurationMs(process.env.MATCH_WAITING_RETRY_MS, 10000, 1000);
const POOL_READY_START_DELAY_MS = parseDurationMs(process.env.MATCH_POOL_READY_DELAY_MS, 2000, 250);
const FIGHT_DURATION = 195000;     // 195s fight (3 rounds × 60s + pauses + buffer)
const RESULT_DURATION = 6000;      // 6s show result
const COOLDOWN_DURATION = 3000;    // 3s between matches

function toTimestamp(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (value instanceof Date) return value.getTime();
    const parsed = Date.parse(String(value || ''));
    return Number.isFinite(parsed) ? parsed : 0;
}

class AutoMatchmaker {
    constructor(io) {
        this.io = io;
        this.currentMatch = null;
        this.phase = 'IDLE';
        this.phaseTimer = null;
        this.bettingTimeLeft = 0;
        this.bettingInterval = null;
        this.waitingReason = null;
        this.waitingMessage = null;
        this._fightStartPending = false;
        this.matchHistory = [];
        this._realAgentsCache = [];
        this._lastAgentFetch = 0;
    }

    start() {
        logger.info('[AutoMatchmaker] Starting automatic match cycle');
        this._bootstrapHistory()
            .catch((err) => logger.warn('[AutoMatchmaker] Failed to bootstrap history', { error: err.message }))
            .then(() => this._restoreOrStartLiveMatch())
            .catch((err) => {
                logger.warn('[AutoMatchmaker] Could not restore live match state; starting fresh', { error: err.message });
                this._safeNextMatch();
            });
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
        const now = Date.now();
        const phaseTimeLeft = this.currentMatch?.phaseEndsAt
            ? Math.max(0, Math.ceil((toTimestamp(this.currentMatch.phaseEndsAt) - now) / 1000))
            : this.bettingTimeLeft;

        return {
            phase: this.phase,
            match: this.currentMatch,
            bettingTimeLeft: phaseTimeLeft,
            waitingReason: this.waitingReason,
            waitingMessage: this.waitingMessage,
            matchHistory: this.matchHistory.slice(0, 10),
        };
    }

    _isRealOnlyMatch(match) {
        if (!match?.agent1 || !match?.agent2) return false;
        const a1Real = !match.agent1.isSimulated && !!match.agent1.isReal;
        const a2Real = !match.agent2.isSimulated && !!match.agent2.isReal;
        return a1Real && a2Real;
    }

    _enterWaitingState(reason, message, retryMs = WAITING_RETRY_MS) {
        clearInterval(this.bettingInterval);
        clearTimeout(this.phaseTimer);
        this._fightStartPending = false;
        this.phase = 'WAITING';
        this.waitingReason = reason;
        this.waitingMessage = message || null;
        this.currentMatch = null;
        this.bettingTimeLeft = Math.ceil(retryMs / 1000);

        this.io.emit('match:phase', {
            phase: 'WAITING',
            match: null,
            timeLeft: this.bettingTimeLeft,
            reason,
            message,
        });

        if (message) {
            this.io.emit('arena:live_event', {
                type: 'waiting',
                icon: '⏳',
                text: message,
                color: '#FFE93E',
                timestamp: Date.now(),
            });
        }

        this.phaseTimer = setTimeout(() => this._safeNextMatch(), retryMs);
        logger.info('[AutoMatchmaker] Waiting for real match conditions', { reason, retryMs, message });
    }

    async _restoreOrStartLiveMatch() {
        if (typeof db.getLiveMatches !== 'function') {
            this._safeNextMatch();
            return;
        }

        const liveMatches = await db.getLiveMatches();
        if (!Array.isArray(liveMatches) || liveMatches.length === 0) {
            this._safeNextMatch();
            return;
        }

        const candidate = [...liveMatches]
            .filter((m) => ['betting', 'fighting', 'live'].includes(String(m.status || '').toLowerCase()))
            .sort((a, b) => toTimestamp(b.createdAt || b.timestamp || b.updatedAt) - toTimestamp(a.createdAt || a.timestamp || a.updatedAt))[0];

        if (!candidate) {
            this._safeNextMatch();
            return;
        }

        const restoredMatch = this._normalizeRestoredMatch(candidate);
        if (!restoredMatch) {
            this._safeNextMatch();
            return;
        }
        if (!this._isRealOnlyMatch(restoredMatch)) {
            logger.info('[AutoMatchmaker] Ignoring non-real restored match and waiting for real agents', { matchId: restoredMatch.id });
            if (typeof db.removeMatch === 'function') {
                Promise.resolve(db.removeMatch(restoredMatch.id)).catch(() => {});
            }
            this._safeNextMatch();
            return;
        }
        if (!restoredMatch.onChain || !restoredMatch.onChainTxHash) {
            logger.info('[AutoMatchmaker] Ignoring restored match without on-chain registration', { matchId: restoredMatch.id });
            if (typeof db.removeMatch === 'function') {
                Promise.resolve(db.removeMatch(restoredMatch.id)).catch(() => {});
            }
            this._safeNextMatch();
            return;
        }

        this.currentMatch = restoredMatch;
        this.waitingReason = null;
        this.waitingMessage = null;
        const status = String(candidate.status || 'betting').toLowerCase();
        const now = Date.now();
        const savedPhaseEnd = toTimestamp(candidate.phaseEndsAt);

        if (status === 'betting') {
            this.phase = 'BETTING';
            this.currentMatch.status = 'betting';
            this.currentMatch.poolMinMON = Number(this.currentMatch.poolMinMON || MATCH_MIN_POOL_MON);
            this.currentMatch.poolTargetMet = Number(this.currentMatch.totalBets || 0) >= this.currentMatch.poolMinMON;
            this.currentMatch.bettingDurationMs = Number(this.currentMatch.bettingDurationMs || BETTING_DURATION);
            this.currentMatch.bettingExtensionMs = Number(this.currentMatch.bettingExtensionMs || BETTING_EXTENSION_DURATION);
            this.currentMatch.phaseStartedAt = toTimestamp(candidate.phaseStartedAt || candidate.createdAt || now);
            this.currentMatch.phaseEndsAt = savedPhaseEnd > now ? savedPhaseEnd : (now + this.currentMatch.bettingDurationMs);
            this.bettingTimeLeft = Math.max(0, Math.ceil((this.currentMatch.phaseEndsAt - now) / 1000));
            this.io.emit('match:new', this.currentMatch);
            this.io.emit('match:phase', { phase: 'BETTING', match: this.currentMatch, timeLeft: this.bettingTimeLeft });
            this._startBettingCountdown();
            logger.info('[AutoMatchmaker] Restored betting phase from DB', {
                matchId: this.currentMatch.id,
                timeLeft: this.bettingTimeLeft,
            });
            return;
        }

        this.phase = 'FIGHTING';
        this.currentMatch.status = 'fighting';
        this.currentMatch.phaseStartedAt = toTimestamp(candidate.phaseStartedAt || candidate.createdAt || now);
        this.currentMatch.phaseEndsAt = savedPhaseEnd > now ? savedPhaseEnd : (now + 5000);
        this.io.emit('match:new', this.currentMatch);
        this._startFight({ restored: true });
        logger.info('[AutoMatchmaker] Restored fighting phase from DB', { matchId: this.currentMatch.id });
    }

    _normalizeRestoredMatch(match) {
        const matchKey = match?.id || match?.matchId;
        if (!match || !matchKey || !match.agent1 || !match.agent2) return null;

        return {
            id: String(matchKey),
            agent1: this._formatAgent(match.agent1),
            agent2: this._formatAgent(match.agent2),
            status: String(match.status || 'betting'),
            agent1Bets: Number(match.agent1Bets || 0),
            agent2Bets: Number(match.agent2Bets || 0),
            totalBets: Number(match.totalBets || 0),
            agent1Odds: Number(match.agent1Odds || 2.0),
            agent2Odds: Number(match.agent2Odds || 2.0),
            bets: Array.isArray(match.bets) ? match.bets : [],
            createdAt: toTimestamp(match.createdAt || Date.now()),
            isSimulated: !!match.isSimulated,
            hasRealAgent: !!match.hasRealAgent,
            onChain: !!match.onChain,
            onChainTxHash: match.onChainTxHash || null,
            poolMinMON: Number(match.poolMinMON || MATCH_MIN_POOL_MON),
            poolTargetMet: Number(match.totalBets || 0) >= Number(match.poolMinMON || MATCH_MIN_POOL_MON),
            extensionCount: Number(match.extensionCount || 0),
            bettingDurationMs: Number(match.bettingDurationMs || BETTING_DURATION),
            bettingExtensionMs: Number(match.bettingExtensionMs || BETTING_EXTENSION_DURATION),
            phaseStartedAt: toTimestamp(match.phaseStartedAt || Date.now()),
            phaseEndsAt: toTimestamp(match.phaseEndsAt || Date.now()),
        };
    }

    _startBettingCountdown() {
        clearInterval(this.bettingInterval);
        this.bettingInterval = setInterval(() => {
            if (!this.currentMatch || this.phase !== 'BETTING') {
                clearInterval(this.bettingInterval);
                return;
            }

            const now = Date.now();
            const requiredPool = Number(this.currentMatch.poolMinMON || MATCH_MIN_POOL_MON);
            this.bettingTimeLeft = Math.max(0, Math.ceil((toTimestamp(this.currentMatch.phaseEndsAt) - now) / 1000));
            this.io.emit('match:timer', {
                timeLeft: this.bettingTimeLeft,
                currentPool: Number(this.currentMatch.totalBets || 0),
                minPool: requiredPool,
            });

            if (this._fightStartPending) {
                return;
            }

            const currentPool = Number(this.currentMatch.totalBets || 0);
            if (currentPool >= requiredPool) {
                this.currentMatch.poolTargetMet = true;
                this._queueFightStart(currentPool, requiredPool);
                return;
            }

            if (this.bettingTimeLeft <= 0) {
                this._extendBettingWindow(currentPool, requiredPool);
            }
        }, 1000);
    }

    _queueFightStart(currentPool, requiredPool) {
        if (!this.currentMatch || this.phase !== 'BETTING' || this._fightStartPending) return;
        this._fightStartPending = true;
        clearTimeout(this.phaseTimer);

        const now = Date.now();
        this.currentMatch.poolTargetMet = true;
        this.currentMatch.phaseStartedAt = now;
        this.currentMatch.phaseEndsAt = now + POOL_READY_START_DELAY_MS;
        this.bettingTimeLeft = Math.ceil(POOL_READY_START_DELAY_MS / 1000);
        this._persistCurrentMatch();

        this.io.emit('match:update', this.currentMatch);
        this.io.emit('match:timer', {
            timeLeft: this.bettingTimeLeft,
            currentPool: Number(currentPool || this.currentMatch.totalBets || 0),
            minPool: Number(requiredPool || this.currentMatch.poolMinMON || MATCH_MIN_POOL_MON),
        });

        this.phaseTimer = setTimeout(() => {
            this._fightStartPending = false;
            if (!this.currentMatch || this.phase !== 'BETTING') return;
            const minPool = Number(this.currentMatch.poolMinMON || MATCH_MIN_POOL_MON);
            const pool = Number(this.currentMatch.totalBets || 0);
            if (pool < minPool) return;
            this._startFight();
        }, POOL_READY_START_DELAY_MS);
    }

    _extendBettingWindow(currentPool, requiredPool) {
        if (!this.currentMatch || this.phase !== 'BETTING') return;

        this._fightStartPending = false;
        clearTimeout(this.phaseTimer);
        const now = Date.now();
        const extensionMs = Number(this.currentMatch.bettingExtensionMs || BETTING_EXTENSION_DURATION);
        this.currentMatch.status = 'betting';
        this.currentMatch.phaseStartedAt = now;
        this.currentMatch.phaseEndsAt = now + extensionMs;
        this.currentMatch.extensionCount = Number(this.currentMatch.extensionCount || 0) + 1;
        this.currentMatch.poolTargetMet = false;
        this.bettingTimeLeft = Math.ceil(extensionMs / 1000);
        this._persistCurrentMatch();

        const missing = Math.max(0, requiredPool - currentPool);
        const extensionText = `Pool ${currentPool.toFixed(2)} / ${requiredPool.toFixed(2)} MON. Extending betting by ${Math.ceil(extensionMs / 1000)}s. Need ${missing.toFixed(2)} MON more.`;

        this.io.emit('match:update', this.currentMatch);
        this.io.emit('match:timer', {
            timeLeft: this.bettingTimeLeft,
            currentPool,
            minPool: requiredPool,
        });
        this.io.emit('arena:live_event', {
            type: 'pool_extension',
            icon: '⏳',
            text: extensionText,
            color: '#FFE93E',
            timestamp: now,
        });

        Promise.resolve(db.addActivity({
            type: 'pool_extension',
            message: extensionText,
            time: now,
            icon: '⏳',
        })).catch((err) => logger.warn('[AutoMatchmaker] Could not persist pool extension activity', { error: err.message }));

        logger.info('[AutoMatchmaker] Betting window extended due to insufficient pool', {
            matchId: this.currentMatch.id,
            requiredPool,
            currentPool,
            extensionCount: this.currentMatch.extensionCount,
            extensionMs,
        });
    }

    async _persistCurrentMatch() {
        if (!this.currentMatch || typeof db.addMatch !== 'function') return;
        try {
            await db.addMatch({
                ...this.currentMatch,
                id: this.currentMatch.id,
                matchId: this.currentMatch.id,
                updatedAt: Date.now(),
            });
        } catch (err) {
            logger.warn('[AutoMatchmaker] Failed to persist current match', { error: err.message });
        }
    }

    async _bootstrapHistory() {
        if (typeof db.getMatchHistory !== 'function') return;
        const history = await db.getMatchHistory(20);
        if (!Array.isArray(history) || history.length === 0) return;

        const normalized = history
            .map((h) => ({
                matchId: h.matchId || h.id || null,
                winnerId: h.winnerId || null,
                winner: h.winner || (h.winnerName ? { name: h.winnerName, avatar: 'ðŸ†', color: '#FFE93E' } : null),
                loser: h.loser || (h.loserName ? { name: h.loserName, avatar: 'âš”ï¸', color: '#888888' } : null),
                method: h.method || 'Decision',
                duration: h.duration || 0,
                monEarned: Number(h.monEarned || 0),
                totalBets: Number(h.totalBets || 0),
                timestamp: Number(h.timestamp || h.completedAt || h.finishedAt || h.createdAt || Date.now()),
                hasRealAgent: !!h.hasRealAgent,
            }))
            .filter((h) => h.matchId && h.winner && h.loser)
            .slice(0, 20);

        if (normalized.length > 0) {
            this.matchHistory = normalized;
            logger.info(`[AutoMatchmaker] Loaded ${normalized.length} historical matches from DB`);
        }
    }

    getLiveMetrics() {
        const requiredPool = Number(this.currentMatch?.poolMinMON || MATCH_MIN_POOL_MON);
        const activePool = Number(this.currentMatch?.totalBets || 0);
        return {
            phase: this.phase,
            activeBetsPool: activePool,
            bettingTimeLeft: this.bettingTimeLeft,
            currentMatchId: this.currentMatch?.id || null,
            onChainLiveMatch: !!this.currentMatch?.onChain,
            minPoolMON: requiredPool,
            poolRemainingMON: Math.max(0, requiredPool - activePool),
            poolReady: activePool >= requiredPool,
            waitingReason: this.waitingReason,
            waitingMessage: this.waitingMessage,
            recentResults: this.matchHistory.slice(0, 10),
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
        const fighters = await this._pickFighters();
        if (!fighters) {
            this._enterWaitingState(
                'NO_REAL_AGENTS',
                'Not enough active real agents. Waiting for registrations to start a real match.',
                WAITING_RETRY_MS
            );
            return;
        }

        if (!blockchain.enabled) {
            this._enterWaitingState(
                'CHAIN_NOT_CONFIGURED',
                'On-chain match service is not configured. Waiting for contract/operator setup.',
                WAITING_RETRY_MS
            );
            return;
        }

        const [agent1, agent2] = fighters;
        const matchId = `match-${uuidv4().slice(0, 8)}`;
        const hasRealAgent = true;

        // Hard requirement: every match must exist on-chain before betting opens.
        let creation;
        if (typeof blockchain.createMatchOnChainWithResult === 'function') {
            creation = await blockchain.createMatchOnChainWithResult(matchId, agent1.name, agent2.name);
        } else {
            const hash = await blockchain.createMatchOnChain(matchId, agent1.name, agent2.name);
            creation = { ok: !!hash, txHash: hash || null };
        }

        if (!creation?.ok) {
            const detail = String(creation?.errorMessage || blockchain.lastError || 'unknown error').slice(0, 160);
            this._enterWaitingState(
                'CHAIN_CREATE_FAILED',
                `Could not create the next match on-chain (${detail}). Retrying shortly.`,
                WAITING_RETRY_MS
            );
            return;
        }
        const onChainTxHash = creation.txHash;

        this.waitingReason = null;
        this.waitingMessage = null;
        this._fightStartPending = false;

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
            isSimulated: false,
            hasRealAgent,
            onChain: true,
            onChainTxHash,
            poolMinMON: MATCH_MIN_POOL_MON,
            poolTargetMet: false,
            extensionCount: 0,
            bettingDurationMs: BETTING_DURATION,
            bettingExtensionMs: BETTING_EXTENSION_DURATION,
            phaseStartedAt: Date.now(),
            phaseEndsAt: Date.now() + BETTING_DURATION,
        };

        await this._persistCurrentMatch();

        // Start BETTING phase
        this.phase = 'BETTING';
        this.bettingTimeLeft = Math.ceil(this.currentMatch.bettingDurationMs / 1000);

        this.io.emit('match:new', this.currentMatch);
        this.io.emit('match:phase', { phase: 'BETTING', match: this.currentMatch, timeLeft: this.bettingTimeLeft });
        this.io.emit('arena:live_event', {
            type: 'match_start',
            icon: 'âš”ï¸',
            text: `${agent1.name} vs ${agent2.name} pool opened. Min ${MATCH_MIN_POOL_MON} MON (REAL)`,
            color: '#00F5FF',
            timestamp: Date.now(),
        });

        Promise.resolve(db.addActivity({
            type: 'match_start',
            message: `${agent1.name} vs ${agent2.name} pool opened. Min ${MATCH_MIN_POOL_MON} MON (REAL)`,
            time: Date.now(),
            icon: 'âš”ï¸',
        })).catch((err) => logger.warn('[AutoMatchmaker] Could not persist match_start activity', { error: err.message }));

        logger.info(`[AutoMatchmaker] New REAL match: ${agent1.name} vs ${agent2.name} (${matchId}) | minPool=${MATCH_MIN_POOL_MON} MON | bettingWindow=${Math.ceil(BETTING_DURATION / 1000)}s | tx=${onChainTxHash}`);

        // Countdown timer
        this._startBettingCountdown();
    }

    _startFight({ restored = false } = {}) {
        if (!this.currentMatch) return;
        clearInterval(this.bettingInterval);
        this._fightStartPending = false;
        const requiredPool = Number(this.currentMatch.poolMinMON || MATCH_MIN_POOL_MON);
        const currentPool = Number(this.currentMatch.totalBets || 0);
        if (!restored && currentPool < requiredPool) {
            this._extendBettingWindow(currentPool, requiredPool);
            return;
        }

        this.phase = 'FIGHTING';
        this.currentMatch.status = 'fighting';
        this.currentMatch.poolTargetMet = currentPool >= requiredPool;
        const now = Date.now();
        const fallbackEnd = now + FIGHT_DURATION;
        this.currentMatch.phaseStartedAt = restored ? toTimestamp(this.currentMatch.phaseStartedAt || now) : now;
        this.currentMatch.phaseEndsAt = restored
            ? toTimestamp(this.currentMatch.phaseEndsAt || fallbackEnd)
            : fallbackEnd;
        if (this.currentMatch.phaseEndsAt <= now) {
            this.currentMatch.phaseEndsAt = now + 1000;
        }
        this._persistCurrentMatch();

        // Lock match on-chain (no more bets)
        if (this.currentMatch.onChain) {
            blockchain.lockMatchOnChain(this.currentMatch.id).catch(err => {
                logger.warn(`[AutoMatchmaker] On-chain lock failed: ${err.message}`);
            });
        }

        this.io.emit('match:phase', {
            phase: 'FIGHTING',
            match: this.currentMatch,
            timeLeft: Math.max(0, Math.ceil((this.currentMatch.phaseEndsAt - now) / 1000)),
        });
        if (!restored) this.io.emit('arena:live_event', {
            type: 'fight_start',
            icon: 'ðŸ¥Š',
            text: `Fight started: ${this.currentMatch.agent1.name} vs ${this.currentMatch.agent2.name}`,
            color: '#FF6B35',
            timestamp: Date.now(),
        });

        // Simulate fight events during the fight
        const fightEvents = restored ? [] : this._generateFightEvents();
        fightEvents.forEach((event) => {
            setTimeout(() => {
                try {
                    this.io.emit('match:fight_event', event);
                } catch { /* ignore */ }
            }, event.delay);
        });

        // End fight after duration
        const remaining = Math.max(1000, this.currentMatch.phaseEndsAt - now);
        this.phaseTimer = setTimeout(() => {
            this._endFight().catch(err => {
                logger.error('[AutoMatchmaker] _endFight crashed, forcing next match', { error: err.message });
                this._scheduleNextMatch();
            });
        }, remaining);
    }

    _scheduleNextMatch() {
        clearTimeout(this.phaseTimer);
        clearInterval(this.bettingInterval);
        this._fightStartPending = false;
        this.waitingReason = null;
        this.waitingMessage = null;
        this.phase = 'COOLDOWN';
        this.bettingTimeLeft = 0;
        try { this.io.emit('match:phase', { phase: 'COOLDOWN' }); } catch { /* ignore */ }
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

        try {
            await db.addMatchHistory({
                id: `hist-${this.currentMatch.id}`,
                matchId: this.currentMatch.id,
                winnerId,
                winner: result.winner,
                loser: result.loser,
                winnerName: winner.name,
                loserName: loser.name,
                method,
                duration: result.duration,
                monEarned,
                totalBets: this.currentMatch.totalBets,
                timestamp: Date.now(),
                completedAt: Date.now(),
                hasRealAgent: this.currentMatch.hasRealAgent,
            });
        } catch (err) {
            logger.warn('[AutoMatchmaker] Failed to persist match history', { error: err.message });
        }

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
        this.currentMatch.phaseEndsAt = Date.now();
        this.currentMatch.completedAt = Date.now();
        await this._persistCurrentMatch();

        this.matchHistory.unshift(result);
        if (this.matchHistory.length > 20) this.matchHistory.pop();

        try {
            this.io.emit('match:phase', { phase: 'RESULT', match: this.currentMatch, result });
            this.io.emit('match:result', result);
            this.io.emit('arena:live_event', {
                type: 'match_end',
                icon: 'ðŸ†',
                text: `${winner.name} defeated ${loser.name}. Pool: ${this.currentMatch.totalBets.toFixed(2)} MON`,
                color: winner.color,
                timestamp: Date.now(),
            });
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

        if (activeReal.length < 2) {
            return null;
        }

        // Pick 2 random real agents only.
        const shuffled = [...activeReal].sort(() => Math.random() - 0.5);
        const fighter1 = this._dbAgentToFighter(shuffled[0]);
        const fighter2 = this._dbAgentToFighter(shuffled[1]);
        logger.info(`[AutoMatchmaker] Picked REAL agents: ${fighter1.name} vs ${fighter2.name}`);
        return [fighter1, fighter2];
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

    async recordBet(side, amount, address, meta = {}) {
        if (!this.currentMatch || this.phase !== 'BETTING') return null;

        const numericAmount = parseFloat(amount);
        if (!Number.isFinite(numericAmount) || numericAmount <= 0) return null;
        const normalizedAddress = String(address || '').toLowerCase();
        const normalizedTxHash = meta.txHash ? String(meta.txHash).toLowerCase() : null;

        if (normalizedTxHash && this.currentMatch.bets.some((b) => String(b.txHash || '').toLowerCase() === normalizedTxHash)) {
            return null;
        }
        if (!normalizedTxHash && normalizedAddress && this.currentMatch.bets.some((b) => String(b.address || '').toLowerCase() === normalizedAddress)) {
            return null;
        }

        const bet = {
            id: `bet-${uuidv4().slice(0, 8)}`,
            side,
            amount: numericAmount,
            address,
            txHash: meta.txHash || null,
            onChain: !!meta.onChain,
            verifiedAt: meta.verifiedAt || Date.now(),
            timestamp: Date.now(),
        };
        this.currentMatch.bets.push(bet);

        if (side === '1') {
            this.currentMatch.agent1Bets += bet.amount;
        } else {
            this.currentMatch.agent2Bets += bet.amount;
        }
        this.currentMatch.totalBets = this.currentMatch.agent1Bets + this.currentMatch.agent2Bets;
        const requiredPool = Number(this.currentMatch.poolMinMON || MATCH_MIN_POOL_MON);
        const wasPoolReady = !!this.currentMatch.poolTargetMet;
        this.currentMatch.poolTargetMet = this.currentMatch.totalBets >= requiredPool;

        // Recalculate odds
        const total = this.currentMatch.totalBets;
        if (total > 0 && this.currentMatch.agent1Bets > 0 && this.currentMatch.agent2Bets > 0) {
            this.currentMatch.agent1Odds = parseFloat((total / this.currentMatch.agent1Bets).toFixed(2));
            this.currentMatch.agent2Odds = parseFloat((total / this.currentMatch.agent2Bets).toFixed(2));
        }

        const selectedAgent = side === '1' ? this.currentMatch.agent1 : this.currentMatch.agent2;
        const short = address ? `${String(address).slice(0, 6)}...${String(address).slice(-4)}` : 'anonymous';

        this.io.emit('arena:live_event', {
            type: 'bet',
            icon: 'ðŸ’°',
            text: `${short} bet ${numericAmount} MON on ${selectedAgent.name}`,
            color: '#FFE93E',
            timestamp: Date.now(),
        });

        if (!wasPoolReady && this.currentMatch.poolTargetMet) {
            const now = Date.now();
            const poolText = `Minimum pool reached (${this.currentMatch.totalBets.toFixed(2)} / ${requiredPool.toFixed(2)} MON). Match starting now.`;
            this.io.emit('arena:live_event', {
                type: 'pool_ready',
                icon: 'POOL',
                text: poolText,
                color: '#2ECC71',
                timestamp: now,
            });

            if (typeof db.addActivity === 'function') {
                Promise.resolve(db.addActivity({
                    type: 'pool_ready',
                    message: poolText,
                    time: now,
                    icon: 'POOL',
                })).catch((err) => logger.warn('[AutoMatchmaker] Failed to persist pool_ready activity', { error: err.message }));
            }

            this._queueFightStart(this.currentMatch.totalBets, requiredPool);
        }

        if (typeof db.addBet === 'function') {
            Promise.resolve(db.addBet({
                id: bet.id,
                matchId: this.currentMatch.id,
                agentId: selectedAgent.id,
                walletAddress: address,
                amount: numericAmount,
                odds: side === '1' ? this.currentMatch.agent1Odds : this.currentMatch.agent2Odds,
                status: 'pending',
                txHash: bet.txHash,
                onChain: bet.onChain,
                placedAt: Date.now(),
            })).catch((err) => logger.warn('[AutoMatchmaker] Failed to persist bet', { error: err.message }));
        }

        if (typeof db.addActivity === 'function') {
            Promise.resolve(db.addActivity({
                type: 'bet',
                message: `${short} bet ${numericAmount} MON on ${selectedAgent.name}`,
                time: Date.now(),
                icon: 'ðŸ’°',
            })).catch((err) => logger.warn('[AutoMatchmaker] Failed to persist bet activity', { error: err.message }));
        }

        this.io.emit('match:update', this.currentMatch);
        this._persistCurrentMatch();
        return bet;
    }
}

module.exports = AutoMatchmaker;

