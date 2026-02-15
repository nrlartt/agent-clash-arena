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
        return await Agent.findOneAndUpdate(query, updates, { returnDocument: 'after' }).lean();
    }

    // ── Matches ─────────────────────────────────────────────
    async getMatches() {
        return await Match.find().sort({ createdAt: -1 }).limit(100).lean();
    }

    async getMatchById(id) {
        const isObjectId = mongoose.Types.ObjectId.isValid(id) && String(new mongoose.Types.ObjectId(id)) === String(id);
        const query = isObjectId
            ? { _id: id }
            : { $or: [{ id }, { matchId: id }] };
        return await Match.findOne(query).lean();
    }

    async getLiveMatches() {
        return await Match.find({ status: { $in: ['upcoming', 'live', 'betting', 'fighting'] } }).sort({ createdAt: -1 }).lean();
    }

    async addMatch(matchData) {
        if (matchData.id || matchData.matchId) {
            const matchKey = matchData.id || matchData.matchId;
            return await Match.findOneAndUpdate(
                { $or: [{ id: matchKey }, { matchId: matchKey }] },
                { ...matchData, id: matchData.id || matchKey, matchId: matchData.matchId || matchKey },
                { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true }
            ).lean();
        }
        const match = new Match(matchData);
        await match.save();
        return match.toJSON();
    }

    async updateMatch(id, updates) {
        const isObjectId = mongoose.Types.ObjectId.isValid(id) && String(new mongoose.Types.ObjectId(id)) === String(id);
        const query = isObjectId
            ? { _id: id }
            : { $or: [{ id }, { matchId: id }] };
        return await Match.findOneAndUpdate(query, updates, { returnDocument: 'after' }).lean();
    }

    async removeMatch(id) {
        const isObjectId = mongoose.Types.ObjectId.isValid(id) && String(new mongoose.Types.ObjectId(id)) === String(id);
        const query = isObjectId
            ? { _id: id }
            : { $or: [{ id }, { matchId: id }] };
        await Match.findOneAndDelete(query);
    }

    // ── Match History ───────────────────────────────────────
    async addMatchHistory(entry) {
        const key = entry.id || entry.matchId;
        if (key) {
            return await Match.findOneAndUpdate(
                { $or: [{ id: key }, { matchId: key }] },
                { status: 'finished', id: entry.id || key, matchId: entry.matchId || key, ...entry },
                { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true }
            ).lean();
        }
        const match = new Match({ ...entry, status: 'finished' });
        await match.save();
        return match.toJSON();
    }

    async getMatchHistory(limit = 20) {
        return await Match.find({
            $or: [
                { status: 'finished' },
                { completedAt: { $exists: true, $ne: null } },
            ],
        }).sort({ completedAt: -1, finishedAt: -1, createdAt: -1 }).limit(limit).lean();
    }

    // ── Bets ────────────────────────────────────────────────
    async getBetsForMatch(matchId) {
        return await Bet.find({ matchId }).lean();
    }

    async addBet(betData) {
        const payload = {
            ...betData,
            bettor: betData.bettor || betData.walletAddress || null,
            placedAt: betData.placedAt || Date.now(),
        };
        if (payload.id) {
            return await Bet.findOneAndUpdate(
                { id: payload.id },
                payload,
                { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true }
            ).lean();
        }
        const bet = new Bet(payload);
        await bet.save();
        return bet.toJSON();
    }

    async updateBet(id, updates) {
        const isObjectId = mongoose.Types.ObjectId.isValid(id) && String(new mongoose.Types.ObjectId(id)) === String(id);
        const query = isObjectId ? { _id: id } : { id };
        return await Bet.findOneAndUpdate(query, updates, { returnDocument: 'after' }).lean();
    }

    async resetAllAgentData() {
        const [agents, matches, bets, activity] = await Promise.all([
            Agent.deleteMany({}),
            Match.deleteMany({}),
            Bet.deleteMany({}),
            Activity.deleteMany({}),
        ]);

        return {
            agentsDeleted: Number(agents?.deletedCount || 0),
            matchesDeleted: Number(matches?.deletedCount || 0),
            betsDeleted: Number(bets?.deletedCount || 0),
            matchHistoryDeleted: 0,
            activityDeleted: Number(activity?.deletedCount || 0),
            shopOrdersDeleted: 0,
            inventoriesDeleted: 0,
        };
    }

    async getBetsByWallet(walletAddress) {
        return await Bet.find({
            $or: [{ walletAddress }, { bettor: walletAddress }],
        }).sort({ createdAt: -1 }).lean();
    }

    async getBetStats() {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);

        const [totalAgg, todayAgg, totalCount, todayCount] = await Promise.all([
            Bet.aggregate([{ $group: { _id: null, volume: { $sum: '$amount' } } }]),
            Bet.aggregate([
                {
                    $match: {
                        $or: [
                            { placedAt: { $gte: startOfDay.getTime() } },
                            { createdAt: { $gte: startOfDay } },
                        ],
                    },
                },
                { $group: { _id: null, volume: { $sum: '$amount' } } },
            ]),
            Bet.countDocuments({}),
            Bet.countDocuments({
                $or: [
                    { placedAt: { $gte: startOfDay.getTime() } },
                    { createdAt: { $gte: startOfDay } },
                ],
            }),
        ]);

        return {
            totalCount: Number(totalCount || 0),
            totalVolume: Number(totalAgg?.[0]?.volume || 0),
            todayCount: Number(todayCount || 0),
            todayVolume: Number(todayAgg?.[0]?.volume || 0),
        };
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
