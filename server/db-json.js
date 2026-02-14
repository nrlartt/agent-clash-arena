// ═══════════════════════════════════════════════════════════════
// DB-JSON — Simple JSON file-based database (development fallback)
// ═══════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'db.json');

const DEFAULT_DB = {
    agents: [],
    matches: [],
    bets: [],
    matchHistory: [],
    activityFeed: [],
    platform: {
        treasuryMON: 0,
        totalPaidToAgents: 0,
        totalPaidToBettors: 0,
    },
};

class JsonDatabase {
    constructor() {
        this.type = 'json-file';
        this.data = this._load();
    }

    _load() {
        try {
            if (fs.existsSync(DB_PATH)) {
                const raw = fs.readFileSync(DB_PATH, 'utf-8');
                const parsed = JSON.parse(raw);
                return {
                    ...JSON.parse(JSON.stringify(DEFAULT_DB)),
                    ...parsed,
                    platform: {
                        ...DEFAULT_DB.platform,
                        ...(parsed.platform || {}),
                    },
                };
            }
        } catch (err) {
            console.error('[DB-JSON] Failed to load:', err.message);
        }
        return JSON.parse(JSON.stringify(DEFAULT_DB));
    }

    _save() {
        try {
            const dir = path.dirname(DB_PATH);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(DB_PATH, JSON.stringify(this.data, null, 2), 'utf-8');
        } catch (err) {
            console.error('[DB-JSON] Failed to save:', err.message);
        }
    }

    // ── Agents ──────────────────────────────────────────────
    getAgents() { return this.data.agents; }
    getAgentById(id) { return this.data.agents.find(a => a.id === id); }
    getAgentByApiKey(apiKey) { return this.data.agents.find(a => a.apiKey === apiKey); }
    getAgentByName(name) { return this.data.agents.find(a => a.name.toLowerCase() === name.toLowerCase()); }

    addAgent(agent) {
        this.data.agents.push(agent);
        this._save();
        return agent;
    }

    updateAgent(id, updates) {
        const idx = this.data.agents.findIndex(a => a.id === id);
        if (idx === -1) return null;
        this.data.agents[idx] = { ...this.data.agents[idx], ...updates };
        this._save();
        return this.data.agents[idx];
    }

    // ── Matches ─────────────────────────────────────────────
    getMatches() { return this.data.matches; }
    getMatchById(id) { return this.data.matches.find(m => m.id === id); }
    getLiveMatches() { return this.data.matches.filter(m => m.status === 'live'); }

    addMatch(match) {
        this.data.matches.push(match);
        this._save();
        return match;
    }

    updateMatch(id, updates) {
        const idx = this.data.matches.findIndex(m => m.id === id);
        if (idx === -1) return null;
        this.data.matches[idx] = { ...this.data.matches[idx], ...updates };
        this._save();
        return this.data.matches[idx];
    }

    removeMatch(id) {
        this.data.matches = this.data.matches.filter(m => m.id !== id);
        this._save();
    }

    // ── Match History ───────────────────────────────────────
    addMatchHistory(entry) {
        this.data.matchHistory.unshift(entry);
        if (this.data.matchHistory.length > 100) this.data.matchHistory.pop();
        this._save();
        return entry;
    }

    getMatchHistory(limit = 20) { return this.data.matchHistory.slice(0, limit); }

    // ── Bets ────────────────────────────────────────────────
    getBetsForMatch(matchId) { return this.data.bets.filter(b => b.matchId === matchId); }

    addBet(bet) {
        this.data.bets.push(bet);
        this._save();
        return bet;
    }

    updateBet(id, updates) {
        const idx = this.data.bets.findIndex(b => b.id === id);
        if (idx === -1) return null;
        this.data.bets[idx] = { ...this.data.bets[idx], ...updates };
        this._save();
        return this.data.bets[idx];
    }

    getBetsByWallet(walletAddress, limit = 50) {
        const addr = String(walletAddress || '').toLowerCase();
        return this.data.bets
            .filter(b => String(b.walletAddress || '').toLowerCase() === addr)
            .slice(-limit)
            .reverse();
    }

    // ── Activity Feed ───────────────────────────────────────
    addActivity(event) {
        this.data.activityFeed.unshift(event);
        if (this.data.activityFeed.length > 50) this.data.activityFeed.pop();
        this._save();
        return event;
    }

    getActivity(limit = 20) { return this.data.activityFeed.slice(0, limit); }

    // ── Leaderboard ─────────────────────────────────────────
    getLeaderboard(sortBy = 'winRate', limit = 20) {
        const active = this.data.agents.filter(a => a.status !== 'pending_claim');
        active.sort((a, b) => {
            if (sortBy === 'winRate') return (b.stats?.winRate || 0) - (a.stats?.winRate || 0);
            if (sortBy === 'wins') return (b.stats?.wins || 0) - (a.stats?.wins || 0);
            if (sortBy === 'earnings') return (b.stats?.totalEarnings || 0) - (a.stats?.totalEarnings || 0);
            if (sortBy === 'power') return (b.powerRating || 0) - (a.powerRating || 0);
            return 0;
        });
        return active.slice(0, limit);
    }

    // ── Platform Treasury ───────────────────────────────────────
    updatePlatformEconomy(updates = {}) {
        this.data.platform = {
            ...DEFAULT_DB.platform,
            ...(this.data.platform || {}),
            ...updates,
        };
        this._save();
        return this.data.platform;
    }

    getPlatformEconomy() {
        return {
            ...DEFAULT_DB.platform,
            ...(this.data.platform || {}),
        };
    }
}

module.exports = new JsonDatabase();
