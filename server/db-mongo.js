// ═══════════════════════════════════════════════════════════════
// DB-MONGO — MongoDB database backend with Mongoose
// Same interface as db-json.js for seamless switching
// ═══════════════════════════════════════════════════════════════

const mongoose = require('mongoose');
const logger = require('./utils/logger');

const Agent = require('./models/Agent');
const Match = require('./models/Match');
const Bet = require('./models/Bet');
const Activity = require('./models/Activity');

const MONGODB_URI = process.env.MONGODB_URI;

class MongoDatabase {
    constructor() {
        this.type = 'mongodb';
        this.connected = false;
        this._connect();
    }

    async _connect() {
        try {
            await mongoose.connect(MONGODB_URI, {
                tls: true,
                tlsAllowInvalidCertificates: false,
                serverSelectionTimeoutMS: 10000,
                connectTimeoutMS: 10000,
            });
            this.connected = true;
            logger.info('MongoDB connected successfully', { uri: MONGODB_URI.replace(/\/\/.*@/, '//<credentials>@') });
        } catch (err) {
            logger.error('MongoDB connection failed', { error: err.message });
            // Retry after 5 seconds
            setTimeout(() => this._connect(), 5000);
        }

        mongoose.connection.on('error', (err) => {
            logger.error('MongoDB connection error', { error: err.message });
        });

        mongoose.connection.on('disconnected', () => {
            logger.warn('MongoDB disconnected. Attempting reconnect...');
        });
    }

    // ── Agents ──────────────────────────────────────────────
    async getAgents() {
        return await Agent.find().lean();
    }

    async getAgentById(id) {
        // Support both MongoDB _id and custom agent id (e.g. "agent-xxx")
        const isObjectId = mongoose.Types.ObjectId.isValid(id) && String(new mongoose.Types.ObjectId(id)) === String(id);
        const query = isObjectId ? { _id: id } : { id: id };
        return await Agent.findOne(query).select('+wallet.encryptedPrivateKey').lean();
    }

    async getAgentByApiKey(apiKey) {
        return await Agent.findOne({ apiKey }).select('+wallet.encryptedPrivateKey').lean();
    }

    async getAgentByName(name) {
        return await Agent.findOne({ name: new RegExp(`^${name}$`, 'i') }).lean();
    }

    async addAgent(agentData) {
        const agent = new Agent(agentData);
        await agent.save();
        return agent.toJSON();
    }

    async updateAgent(id, updates) {
        // Support both MongoDB _id and custom agent id (e.g. "agent-xxx")
        const isObjectId = mongoose.Types.ObjectId.isValid(id) && String(new mongoose.Types.ObjectId(id)) === String(id);
        const query = isObjectId ? { _id: id } : { id: id };
        return await Agent.findOneAndUpdate(query, updates, { new: true }).lean();
    }

    // ── Matches ─────────────────────────────────────────────
    async getMatches() {
        return await Match.find().sort({ createdAt: -1 }).limit(100).lean();
    }

    async getMatchById(id) {
        return await Match.findById(id).lean();
    }

    async getLiveMatches() {
        return await Match.find({ status: 'live' }).lean();
    }

    async addMatch(matchData) {
        const match = new Match(matchData);
        await match.save();
        return match.toJSON();
    }

    async updateMatch(id, updates) {
        return await Match.findByIdAndUpdate(id, updates, { new: true }).lean();
    }

    async removeMatch(id) {
        await Match.findByIdAndDelete(id);
    }

    // ── Match History ───────────────────────────────────────
    async addMatchHistory(entry) {
        // In MongoDB, match history is just finished matches
        // We store it as a regular match with status 'finished'
        if (entry._id || entry.id) {
            return await Match.findByIdAndUpdate(entry._id || entry.id, { status: 'finished', ...entry }, { new: true }).lean();
        }
        const match = new Match({ ...entry, status: 'finished' });
        await match.save();
        return match.toJSON();
    }

    async getMatchHistory(limit = 20) {
        return await Match.find({ status: 'finished' }).sort({ finishedAt: -1 }).limit(limit).lean();
    }

    // ── Bets ────────────────────────────────────────────────
    async getBetsForMatch(matchId) {
        return await Bet.find({ matchId }).lean();
    }

    async addBet(betData) {
        const bet = new Bet(betData);
        await bet.save();
        return bet.toJSON();
    }

    async updateBet(id, updates) {
        return await Bet.findByIdAndUpdate(id, updates, { new: true }).lean();
    }

    async getBetsByWallet(walletAddress) {
        return await Bet.find({ bettor: walletAddress }).sort({ createdAt: -1 }).lean();
    }

    // ── Activity Feed ───────────────────────────────────────
    async addActivity(event) {
        const activity = new Activity(event);
        await activity.save();
        return activity.toJSON();
    }

    async getActivity(limit = 20) {
        return await Activity.find().sort({ createdAt: -1 }).limit(limit).lean();
    }

    // ── Leaderboard ─────────────────────────────────────────
    async getLeaderboard(sortBy = 'winRate', limit = 20) {
        const sortField = {
            winRate: { 'stats.winRate': -1 },
            wins: { 'stats.wins': -1 },
            earnings: { 'stats.totalEarnings': -1 },
            power: { powerRating: -1 },
        }[sortBy] || { 'stats.winRate': -1 };

        return await Agent.find({ status: { $ne: 'pending_claim' } })
            .sort(sortField)
            .limit(limit)
            .lean();
    }

    // ── Stats helpers (for compatibility with server/index.js) ──
    get data() {
        // Proxy for backward compat — returns a promise-like
        return {
            bets: { reduce: () => 0 }, // Will be replaced by proper async calls
        };
    }
}

module.exports = new MongoDatabase();
