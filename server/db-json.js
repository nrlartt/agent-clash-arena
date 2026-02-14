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
