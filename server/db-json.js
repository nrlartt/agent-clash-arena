// ═══════════════════════════════════════════════════════════════
// DB-JSON — Simple JSON file-based database (development fallback)
// ═══════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { SHOP_ITEMS_BY_ID, EQUIPPABLE_SLOTS } = require('./data/shop-items');

const DB_PATH = path.join(__dirname, 'data', 'db.json');

const DEFAULT_DB = {
    agents: [],
    matches: [],
    bets: [],
    matchHistory: [],
    activityFeed: [],
    shopOrders: [],
    agentInventories: {},
    platform: {
        treasuryMON: 0,
        totalPaidToAgents: 0,
        totalPaidToBettors: 0,
    },
    tokenomics: {
        totals: {
            runs: 0,
            successfulRuns: 0,
            failedRuns: 0,
            monSpent: 0,
            clashBought: 0,
            clashBurned: 0,
        },
        history: [],
        lastRunAt: null,
        lastSuccessAt: null,
        lastError: null,
        lastErrorAt: null,
        lastWithdrawTxHash: null,
        lastBuyTxHash: null,
        lastBurnTxHash: null,
        lastRouter: null,
        lastSpendMON: 0,
        lastBoughtCLASH: 0,
        lastBurnedCLASH: 0,
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
                    shopOrders: Array.isArray(parsed.shopOrders) ? parsed.shopOrders : [],
                    agentInventories: parsed.agentInventories && typeof parsed.agentInventories === 'object'
                        ? parsed.agentInventories
                        : {},
                    platform: {
                        ...DEFAULT_DB.platform,
                        ...(parsed.platform || {}),
                    },
                    tokenomics: {
                        ...JSON.parse(JSON.stringify(DEFAULT_DB.tokenomics)),
                        ...(parsed.tokenomics || {}),
                        totals: {
                            ...DEFAULT_DB.tokenomics.totals,
                            ...(parsed.tokenomics?.totals || {}),
                        },
                        history: Array.isArray(parsed.tokenomics?.history) ? parsed.tokenomics.history : [],
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

    _createEmptyInventory(agentId) {
        return {
            agentId,
            equipped: {
                weapon: null,
                armor: null,
                boots: null,
                amulet: null,
                rune: null,
            },
            backpack: [],
            purchaseHistory: [],
            updatedAt: Date.now(),
        };
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
    getMatchById(id) { return this.data.matches.find(m => String(m.id || m.matchId) === String(id)); }
    getLiveMatches() {
        const activeStatuses = new Set(['live', 'betting', 'fighting', 'upcoming']);
        return this.data.matches.filter(m => activeStatuses.has(String(m.status || '').toLowerCase()));
    }

    addMatch(match) {
        const key = String(match.id || match.matchId || '');
        const idx = this.data.matches.findIndex(m => String(m.id || m.matchId || '') === key);
        if (idx === -1) {
            this.data.matches.push(match);
        } else {
            this.data.matches[idx] = {
                ...this.data.matches[idx],
                ...match,
            };
        }
        this._save();
        return match;
    }

    updateMatch(id, updates) {
        const idx = this.data.matches.findIndex(m => String(m.id || m.matchId) === String(id));
        if (idx === -1) return null;
        this.data.matches[idx] = { ...this.data.matches[idx], ...updates };
        this._save();
        return this.data.matches[idx];
    }

    removeMatch(id) {
        this.data.matches = this.data.matches.filter(m => String(m.id || m.matchId) !== String(id));
        this._save();
    }

    // ── Match History ───────────────────────────────────────
    addMatchHistory(entry) {
        const key = String(entry.id || entry.matchId || '');
        const idx = this.data.matchHistory.findIndex(h => String(h.id || h.matchId || '') === key);
        if (idx === -1) {
            this.data.matchHistory.unshift(entry);
        } else {
            this.data.matchHistory[idx] = { ...this.data.matchHistory[idx], ...entry };
        }
        this.data.matchHistory.sort((a, b) =>
            Number(b.timestamp || b.completedAt || b.finishedAt || b.createdAt || 0)
            - Number(a.timestamp || a.completedAt || a.finishedAt || a.createdAt || 0)
        );
        if (this.data.matchHistory.length > 200) {
            this.data.matchHistory = this.data.matchHistory.slice(0, 200);
        }
        this._save();
        return entry;
    }

    getMatchHistory(limit = 20) { return this.data.matchHistory.slice(0, limit); }

    // ── Bets ────────────────────────────────────────────────
    getBetsForMatch(matchId) { return this.data.bets.filter(b => String(b.matchId) === String(matchId)); }

    addBet(bet) {
        const key = String(bet.id || '');
        const idx = this.data.bets.findIndex(b => String(b.id || '') === key);
        if (idx === -1) {
            this.data.bets.push(bet);
        } else {
            this.data.bets[idx] = { ...this.data.bets[idx], ...bet };
        }
        this._save();
        return bet;
    }

    updateBet(id, updates) {
        const idx = this.data.bets.findIndex(b => String(b.id || '') === String(id));
        if (idx === -1) return null;
        this.data.bets[idx] = { ...this.data.bets[idx], ...updates };
        this._save();
        return this.data.bets[idx];
    }

    getBetsByWallet(walletAddress, limit = 50) {
        const addr = String(walletAddress || '').toLowerCase();
        return this.data.bets
            .filter(b =>
                String(b.walletAddress || '').toLowerCase() === addr
                || String(b.bettor || '').toLowerCase() === addr
            )
            .slice(-limit)
            .reverse();
    }

    getBetStats() {
        const totalCount = this.data.bets.length;
        const totalVolume = this.data.bets.reduce((sum, b) => sum + (Number(b.amount) || 0), 0);
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const todayTs = startOfDay.getTime();

        const today = this.data.bets.filter((b) => {
            const ts = Number(b.placedAt || b.createdAt || b.timestamp || 0);
            return ts >= todayTs;
        });
        const todayCount = today.length;
        const todayVolume = today.reduce((sum, b) => sum + (Number(b.amount) || 0), 0);

        return {
            totalCount,
            totalVolume: Number(totalVolume.toFixed(6)),
            todayCount,
            todayVolume: Number(todayVolume.toFixed(6)),
        };
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
    // ── Shop Orders ───────────────────────────────────────────
    addShopOrder(order) {
        this.data.shopOrders.unshift(order);
        if (this.data.shopOrders.length > 5000) this.data.shopOrders.pop();
        this._save();
        return order;
    }

    getShopOrderById(id) {
        return this.data.shopOrders.find(order => order.id === id) || null;
    }

    getShopOrderByToken(orderToken) {
        return this.data.shopOrders.find(order => order.orderToken === orderToken) || null;
    }

    updateShopOrder(id, updates) {
        const idx = this.data.shopOrders.findIndex(order => order.id === id);
        if (idx === -1) return null;

        this.data.shopOrders[idx] = {
            ...this.data.shopOrders[idx],
            ...updates,
            payment: {
                ...(this.data.shopOrders[idx].payment || {}),
                ...(updates.payment || {}),
            },
            updatedAt: Date.now(),
        };
        this._save();
        return this.data.shopOrders[idx];
    }

    findShopOrderByTxHash(txHash) {
        const normalized = String(txHash || '').toLowerCase();
        return this.data.shopOrders.find(
            order => String(order.payment && order.payment.txHash || '').toLowerCase() === normalized
        ) || null;
    }

    listShopOrdersByAgent(agentId, limit = 50) {
        return this.data.shopOrders
            .filter(order => order.agentId === agentId)
            .slice(0, limit);
    }

    // ── Shop Inventories ──────────────────────────────────────
    getAgentInventory(agentId) {
        if (!agentId) return null;
        if (!this.data.agentInventories[agentId]) {
            this.data.agentInventories[agentId] = this._createEmptyInventory(agentId);
            this._save();
        }
        return this.data.agentInventories[agentId];
    }

    applyShopPurchase(agentId, itemId, options = {}) {
        const item = SHOP_ITEMS_BY_ID[itemId];
        if (!item) return null;

        const inventory = this.getAgentInventory(agentId);
        if (!inventory) return null;

        const itemEntry = {
            itemId: item.id,
            category: item.category,
            purchasedAt: options.paidAt || Date.now(),
            orderId: options.orderId || null,
            txHash: options.txHash || null,
            amountMON: options.amountMON || item.price,
        };

        if (options.buyAndEquip && EQUIPPABLE_SLOTS.has(item.category)) {
            const existing = inventory.equipped[item.category];
            if (existing) {
                inventory.backpack.push(existing);
            }
            inventory.equipped[item.category] = itemEntry;
        } else {
            inventory.backpack.push(itemEntry);
        }

        inventory.purchaseHistory.unshift({
            itemId: item.id,
            orderId: options.orderId || null,
            txHash: options.txHash || null,
            buyAndEquip: !!options.buyAndEquip,
            amountMON: options.amountMON || item.price,
            paidAt: options.paidAt || Date.now(),
        });
        if (inventory.purchaseHistory.length > 200) inventory.purchaseHistory.pop();

        inventory.updatedAt = Date.now();
        this.data.agentInventories[agentId] = inventory;
        this._save();
        return inventory;
    }

    equipInventoryItem(agentId, itemId) {
        const inventory = this.getAgentInventory(agentId);
        if (!inventory) return null;

        const idx = inventory.backpack.findIndex(entry => entry.itemId === itemId);
        if (idx === -1) return null;

        const entry = inventory.backpack[idx];
        if (!EQUIPPABLE_SLOTS.has(entry.category)) return null;

        inventory.backpack.splice(idx, 1);
        const oldEquipped = inventory.equipped[entry.category];
        if (oldEquipped) inventory.backpack.push(oldEquipped);
        inventory.equipped[entry.category] = entry;
        inventory.updatedAt = Date.now();

        this.data.agentInventories[agentId] = inventory;
        this._save();
        return inventory;
    }

    unequipInventorySlot(agentId, slot) {
        const inventory = this.getAgentInventory(agentId);
        if (!inventory) return null;
        if (!EQUIPPABLE_SLOTS.has(slot)) return inventory;

        const equippedEntry = inventory.equipped[slot];
        if (!equippedEntry) return inventory;

        inventory.backpack.push(equippedEntry);
        inventory.equipped[slot] = null;
        inventory.updatedAt = Date.now();

        this.data.agentInventories[agentId] = inventory;
        this._save();
        return inventory;
    }

    resetAllAgentData() {
        const summary = {
            agentsDeleted: this.data.agents.length,
            matchesDeleted: this.data.matches.length,
            betsDeleted: this.data.bets.length,
            matchHistoryDeleted: this.data.matchHistory.length,
            activityDeleted: this.data.activityFeed.length,
            shopOrdersDeleted: this.data.shopOrders.length,
            inventoriesDeleted: Object.keys(this.data.agentInventories || {}).length,
        };

        this.data.agents = [];
        this.data.matches = [];
        this.data.bets = [];
        this.data.matchHistory = [];
        this.data.activityFeed = [];
        this.data.shopOrders = [];
        this.data.agentInventories = {};

        this._save();
        return summary;
    }

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

    getTokenomics() {
        return {
            ...JSON.parse(JSON.stringify(DEFAULT_DB.tokenomics)),
            ...(this.data.tokenomics || {}),
            totals: {
                ...DEFAULT_DB.tokenomics.totals,
                ...(this.data.tokenomics?.totals || {}),
            },
            history: Array.isArray(this.data.tokenomics?.history) ? this.data.tokenomics.history : [],
        };
    }

    updateTokenomics(updates = {}) {
        const current = this.getTokenomics();
        const next = {
            ...current,
            ...updates,
            totals: {
                ...current.totals,
                ...(updates.totals || {}),
            },
            history: Array.isArray(updates.history) ? updates.history.slice(0, 100) : current.history,
        };
        this.data.tokenomics = next;
        this._save();
        return next;
    }

    recordTokenomicsRun(run = {}) {
        const current = this.getTokenomics();
        const status = run.status === 'success' ? 'success' : (run.status === 'failed' ? 'failed' : 'skipped');
        const monSpent = Number(run.monSpentMON || 0);
        const clashBought = Number(run.clashBought || 0);
        const clashBurned = Number(run.clashBurned || 0);

        const totals = {
            runs: Number(current.totals.runs || 0) + 1,
            successfulRuns: Number(current.totals.successfulRuns || 0) + (status === 'success' ? 1 : 0),
            failedRuns: Number(current.totals.failedRuns || 0) + (status === 'failed' ? 1 : 0),
            monSpent: Number((Number(current.totals.monSpent || 0) + monSpent).toFixed(6)),
            clashBought: Number((Number(current.totals.clashBought || 0) + clashBought).toFixed(6)),
            clashBurned: Number((Number(current.totals.clashBurned || 0) + clashBurned).toFixed(6)),
        };

        const history = [run, ...(Array.isArray(current.history) ? current.history : [])].slice(0, 100);
        const next = {
            ...current,
            totals,
            history,
            lastRunAt: run.finishedAt || Date.now(),
            lastWithdrawTxHash: run.withdrawTxHash || current.lastWithdrawTxHash || null,
            lastBuyTxHash: run.buyTxHash || current.lastBuyTxHash || null,
            lastBurnTxHash: run.burnTxHash || current.lastBurnTxHash || null,
            lastRouter: run.router || current.lastRouter || null,
            lastSpendMON: monSpent,
            lastBoughtCLASH: clashBought,
            lastBurnedCLASH: clashBurned,
        };

        if (status === 'success') {
            next.lastSuccessAt = run.finishedAt || Date.now();
            next.lastError = null;
            next.lastErrorAt = null;
        } else if (status === 'failed') {
            next.lastError = run.error || 'Buyback run failed';
            next.lastErrorAt = run.finishedAt || Date.now();
        }

        this.data.tokenomics = next;
        this._save();
        return next;
    }
}

module.exports = new JsonDatabase();
