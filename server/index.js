// ═══════════════════════════════════════════════════════════════
// AGENT CLASH ARENA — Backend Server
// Express + Socket.io + MongoDB + Security Middleware
// ═══════════════════════════════════════════════════════════════

const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { ethers } = require('ethers');
const db = require('./db');
const logger = require('./utils/logger');
const { initSentry, setupSentryErrorHandler } = require('./utils/sentry');

const app = express();

// Initialize Sentry (must be first)
initSentry(app);
const server = createServer(app);

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

if (IS_PRODUCTION) {
    // Required for correct client IP and rate limit behavior behind reverse proxies
    app.set('trust proxy', 1);
}

function parseOrigins(...rawValues) {
    return [...new Set(
        rawValues
            .filter(Boolean)
            .flatMap(v => String(v).split(','))
            .map(v => v.trim())
            .filter(Boolean)
    )];
}

const DEV_ALLOWED_ORIGINS = [
    'http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175',
    'http://localhost:3000', 'http://127.0.0.1:5173', 'http://127.0.0.1:5174',
];

// Always allow these production domains (hardcoded so Docker builds work without .env)
const HARDCODED_PROD_ORIGINS = [
    'https://www.agentclasharena.xyz',
    'https://agentclasharena.xyz',
    'https://agent-clash-arena-production-da70.up.railway.app',
];

const PROD_ALLOWED_ORIGINS = [...HARDCODED_PROD_ORIGINS, ...parseOrigins(process.env.FRONTEND_URL, process.env.ALLOWED_ORIGINS)];
const ALLOWED_ORIGINS = IS_PRODUCTION ? PROD_ALLOWED_ORIGINS : DEV_ALLOWED_ORIGINS;

if (IS_PRODUCTION && ALLOWED_ORIGINS.length === 0) {
    logger.warn('No allowed origins configured in production. Set FRONTEND_URL or ALLOWED_ORIGINS.');
}

function validateCorsOrigin(origin, callback) {
    // Allow non-browser clients and same-origin server-side calls
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    return callback(new Error('Origin not allowed by CORS'));
}

const io = new Server(server, {
    cors: {
        origin: IS_PRODUCTION ? validateCorsOrigin : ALLOWED_ORIGINS,
        methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    },
});

const PORT = process.env.PORT || 3001;

// ── Security Middleware ──────────────────────────────────────
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: false,
    crossOriginOpenerPolicy: false, // Required for Privy/Coinbase wallet popups
}));

// ── Rate Limiting ────────────────────────────────────────────
const apiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 100,                 // 100 requests per minute per IP
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many requests. Please try again later.' },
});

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20,                    // 20 auth attempts per 15 min per IP
    message: { success: false, error: 'Too many authentication attempts.' },
});

const betLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 30,                   // 30 bets per minute per IP
    message: { success: false, error: 'Too many bets placed. Slow down.' },
});

app.use('/api/', apiLimiter);
app.use('/api/v1/circle', authLimiter);
app.use('/api/v1/bets', betLimiter);

// ── Standard Middleware ──────────────────────────────────────
app.use(cors({
    origin: IS_PRODUCTION ? validateCorsOrigin : ALLOWED_ORIGINS,
    credentials: true,
}));
app.use(express.json({ limit: '1mb' }));

app.use((err, _req, res, next) => {
    if (err && err.message === 'Origin not allowed by CORS') {
        return res.status(403).json({ success: false, error: 'Origin not allowed' });
    }
    return next(err);
});

// Attach io to every request (for WebSocket events in routes)
app.use((req, _res, next) => {
    req.io = io;
    next();
});

// Request logger (uses structured logger)
app.use((req, res, next) => {
    if (req.method !== 'OPTIONS') {
        const start = Date.now();
        res.on('finish', () => {
            const duration = Date.now() - start;
            logger.http(`${req.method} ${req.path}`, {
                status: res.statusCode,
                duration: `${duration}ms`,
                ip: req.ip,
            });
        });
    }
    next();
});

// ── Routes ───────────────────────────────────────────────────
const agentRoutes = require('./routes/agents');
const arenaRoutes = require('./routes/arena');
const matchRoutes = require('./routes/matches');
const betRoutes = require('./routes/bets');
const telegramRoutes = require('./routes/telegram');
const shopRoutes = require('./routes/shop');

app.use('/api/v1/agents', agentRoutes);
app.use('/api/v1/arena', arenaRoutes);
app.use('/api/v1/matches', matchRoutes);
app.use('/api/v1/bets', betRoutes);
app.use('/api/v1/circle', require('./routes/circle'));
app.use('/api/v1/telegram', telegramRoutes);
app.use('/api/v1/shop', shopRoutes);

// ── Leaderboard ──────────────────────────────────────────────
app.get('/api/v1/leaderboard', async (req, res) => {
    const sortBy = req.query.sort || 'winRate';
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const data = await db.getLeaderboard(sortBy, limit);
    res.json({ success: true, data });
});

// ── Activity Feed ────────────────────────────────────────────
app.get('/api/v1/activity', async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const data = await db.getActivity(limit);
    res.json({ success: true, data });
});

// ── Platform Stats ───────────────────────────────────────────
app.get('/api/v1/stats', async (_req, res) => {
    const agents = await db.getAgents();
    const liveMatches = await db.getLiveMatches();
    const history = await db.getMatchHistory();
    const platformEconomy = typeof db.getPlatformEconomy === 'function'
        ? db.getPlatformEconomy()
        : { treasuryMON: 0, totalPaidToAgents: 0, totalPaidToBettors: 0 };
    const betStats = typeof db.getBetStats === 'function'
        ? await db.getBetStats()
        : { totalCount: 0, totalVolume: 0 };
    const activeAgents = agents.filter(a => a.status !== 'pending_claim').length;

    res.json({
        success: true,
        data: {
            totalAgents: agents.length,
            activeAgents,
            liveMatches: liveMatches.length,
            totalMatchesPlayed: history.length,
            totalBetsPlaced: Number(betStats.totalCount || 0),
            totalMONWagered: Number(betStats.totalVolume || 0),
            payoutTreasuryMON: platformEconomy.treasuryMON,
            totalPaidToAgentsMON: platformEconomy.totalPaidToAgents,
            totalPaidToBettorsMON: platformEconomy.totalPaidToBettors,
            onlineViewers: io.engine.clientsCount || 0,
        },
    });
});

// ── Health Check (must respond fast for Railway probe) ───────
app.get('/api/v1/health', async (_req, res) => {
    try {
        const blockchain = require('./utils/blockchain');
        let agentCount = 0;
        let matchCount = 0;
        let operatorBalance = null;

        // These are non-blocking -- don't let them fail the health check
        try { agentCount = (await db.getAgents()).length; } catch { /* db not ready */ }
        try { matchCount = (await db.getLiveMatches()).length; } catch { /* db not ready */ }
        try { if (blockchain.enabled) operatorBalance = await blockchain.getOperatorBalance(); } catch { /* chain not ready */ }

        res.json({
            status: 'ok',
            service: 'Agent Clash Arena API',
            version: '1.0.0',
            uptime: process.uptime(),
            environment: IS_PRODUCTION ? 'production' : 'development',
            database: db.type || 'json-file',
            agents: agentCount,
            liveMatches: matchCount,
            blockchain: {
                enabled: blockchain.enabled,
                network: 'Monad Mainnet',
                operatorBalance: operatorBalance ? `${operatorBalance} MON` : null,
            },
        });
    } catch (err) {
        // Even if everything fails, return 200 so healthcheck passes
        res.json({ status: 'ok', service: 'Agent Clash Arena API', uptime: process.uptime() });
    }
});

app.get('/api/v1/chain/status', async (_req, res) => {
    try {
        const blockchain = require('./utils/blockchain');
        const data = typeof blockchain.getRuntimeStatus === 'function'
            ? await blockchain.getRuntimeStatus()
            : { enabled: !!blockchain.enabled };
        res.json({ success: true, data });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message || 'Failed to read chain status' });
    }
});

// ── skill.md endpoint (dynamically injects correct base URL) ─
app.get('/skill.md', (req, res) => {
    const fs = require('fs');
    const skillPath = path.join(__dirname, '..', 'public', 'skill.md');
    try {
        let content = fs.readFileSync(skillPath, 'utf-8');
        // Determine the real base URL from the incoming request
        const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
        const host = req.headers['x-forwarded-host'] || req.headers.host;
        const baseUrl = `${proto}://${host}`;
        // Replace placeholder domain with actual URL
        content = content.replace(/https:\/\/www\.agentclasharena\.xyz/g, baseUrl);
        res.type('text/markdown').send(content);
    } catch {
        res.status(500).json({ error: 'skill.md not found' });
    }
});

// ── REST endpoints for arena live data ──────────────────────
app.get('/api/v1/arena/live-stats', async (_req, res) => {
    const stats = await buildLiveStats();
    res.json({ success: true, data: stats });
});

app.get('/api/v1/arena/recent-results', (_req, res) => {
    const live = matchmaker.getLiveMetrics();
    res.json({
        success: true,
        data: live.recentResults || [],
    });
});

app.get('/api/v1/arena/current', (_req, res) => {
    const state = matchmaker.getState();
    res.json({
        success: true,
        data: {
            phase: state.phase,
            match: state.match,
            timeLeft: state.bettingTimeLeft,
            waitingReason: state.waitingReason || null,
            waitingMessage: state.waitingMessage || null,
        },
    });
});

// ── Sentry Error Handler ─────────────────────────────────────
setupSentryErrorHandler(app);

// ── Serve Frontend ──────────────────────────────────────────
const fs = require('fs');
const distPath = path.join(__dirname, '..', 'dist');
const distExists = fs.existsSync(path.join(distPath, 'index.html'));

if (distExists) {
    logger.info(`Serving frontend from ${distPath}`);
    app.use(express.static(distPath));
    // SPA fallback — serve index.html for all non-API routes
    app.get('*', (req, res) => {
        if (req.path.startsWith('/api/')) {
            return res.status(404).json({
                success: false,
                error: 'API endpoint not found',
                docs: 'GET /skill.md for full API documentation',
            });
        }
        res.sendFile(path.join(distPath, 'index.html'));
    });
} else {
    logger.warn(`Frontend dist/ not found at ${distPath}. Running in API-only mode.`);
    // 404 for non-API routes
    app.use((_req, res) => {
        res.status(404).json({
            success: false,
            error: 'Endpoint not found. Frontend not built.',
            hint: IS_PRODUCTION
                ? 'dist/ folder is missing. Check Docker build logs.'
                : 'Run "npm run build" first, or use "npm run dev" for development.',
            docs: 'GET /skill.md for full API documentation',
        });
    });
}

// ── WebSocket (with authentication) ─────────────────────────
// Socket.io authentication middleware
io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    // In production, verify JWT/session token here
    // For now, accept all connections but log the attempt
    if (IS_PRODUCTION && !token) {
        logger.warn('WebSocket connection without auth token', { socketId: socket.id });
    }
    // Store auth info on socket for later use
    socket.authToken = token || null;
    socket.connectedAt = Date.now();
    next();
});

// ── Auto Matchmaker (creates matches automatically) ──────────
const AutoMatchmaker = require('./utils/auto-matchmaker');
const matchmaker = new AutoMatchmaker(io);
const BETTING_CONTRACT_ADDRESS = String(process.env.BETTING_CONTRACT_ADDRESS || process.env.VITE_BETTING_CONTRACT_ADDRESS || '').trim();
const BETTING_RPC_URL = process.env.MONAD_RPC_URL || 'https://rpc.monad.xyz';
const ONCHAIN_BETTING_REQUIRED = process.env.ONCHAIN_BETTING_REQUIRED !== 'false';
const bettingTxProvider = BETTING_CONTRACT_ADDRESS ? new ethers.JsonRpcProvider(BETTING_RPC_URL) : null;
const bettingInterface = new ethers.Interface(['function placeBet(bytes32 _matchId, uint8 _side)']);

function toBytes32MatchId(matchId) {
    return ethers.encodeBytes32String(String(matchId || '').slice(0, 31));
}

function shortAddress(address) {
    if (!address || String(address).length < 10) return 'anonymous';
    return `${String(address).slice(0, 6)}...${String(address).slice(-4)}`;
}

async function verifyOnchainBetTx({ txHash, matchId, side, address, amount }) {
    if (!bettingTxProvider || !BETTING_CONTRACT_ADDRESS) {
        throw new Error('On-chain betting backend is not configured');
    }
    if (!/^0x[a-fA-F0-9]{64}$/.test(String(txHash || ''))) {
        throw new Error('Invalid tx hash format');
    }

    const [tx, receipt] = await Promise.all([
        bettingTxProvider.getTransaction(txHash),
        bettingTxProvider.getTransactionReceipt(txHash),
    ]);

    if (!tx) throw new Error('Transaction not found');
    if (!receipt) throw new Error('Transaction not mined yet');
    if (Number(receipt.status) !== 1) throw new Error('Transaction failed on-chain');

    const to = String(tx.to || '').toLowerCase();
    if (to !== BETTING_CONTRACT_ADDRESS.toLowerCase()) {
        throw new Error('Transaction target does not match betting contract');
    }

    const from = String(tx.from || '').toLowerCase();
    if (address && from !== String(address).toLowerCase()) {
        throw new Error('Transaction sender does not match wallet address');
    }

    let parsed;
    try {
        parsed = bettingInterface.parseTransaction({ data: tx.data, value: tx.value });
    } catch {
        throw new Error('Could not decode betting transaction call');
    }

    if (!parsed || parsed.name !== 'placeBet') {
        throw new Error('Transaction is not a placeBet call');
    }

    const expectedBytes32 = toBytes32MatchId(matchId);
    const txMatchId = String(parsed.args[0] || '');
    const txSide = Number(parsed.args[1] || 0);
    const expectedSide = side === '1' ? 1 : 2;
    if (txMatchId !== expectedBytes32) throw new Error('Transaction match id does not match live match');
    if (txSide !== expectedSide) throw new Error('Transaction side does not match selected fighter');

    const expectedWei = ethers.parseEther(String(amount));
    if (tx.value < expectedWei) throw new Error('Transaction value is lower than bet amount');

    return {
        txHash: tx.hash,
        blockNumber: receipt.blockNumber,
        from: tx.from,
        valueMON: Number(ethers.formatEther(tx.value)),
        verifiedAt: Date.now(),
    };
}

async function buildLiveStats() {
    const viewers = io.engine.clientsCount || 0;
    const live = matchmaker.getLiveMetrics();

    let totalBetsToday = 0;
    let matchesPlayedToday = 0;
    let topAgents = [];

    try {
        if (typeof db.getBetStats === 'function') {
            const betStats = await db.getBetStats();
            totalBetsToday = Number(betStats.todayVolume || betStats.totalVolume || 0);
        }
        if (typeof db.getMatchHistory === 'function') {
            const history = await db.getMatchHistory(200);
            const start = new Date();
            start.setHours(0, 0, 0, 0);
            matchesPlayedToday = (history || []).filter((h) => {
                const rawTs = h.completedAt || h.timestamp || h.finishedAt || h.createdAt || 0;
                const ts = typeof rawTs === 'number' ? rawTs : Date.parse(String(rawTs));
                return ts >= start.getTime();
            }).length;
        }
        if (typeof db.getLeaderboard === 'function') {
            const palette = ['#FF2D78', '#00F5FF', '#836EF9', '#FF6B35', '#69D2E7', '#FFE93E', '#9B59B6', '#2ECC71'];
            const rawAgents = await db.getLeaderboard('winRate', 8);
            topAgents = (rawAgents || []).map((agent, idx) => ({
                id: String(agent.id || agent._id || `agent-${idx}`),
                name: agent.name || `Agent ${idx + 1}`,
                avatar: agent.avatar || '⚔️',
                color: agent.color || palette[idx % palette.length],
                wins: Number(agent.stats?.wins || agent.wins || 0),
                winRate: Number(agent.stats?.winRate || agent.winRate || 0),
            }));
        }
    } catch (err) {
        logger.warn('Failed to build live stats from DB', { error: err.message });
    }

    return {
        viewers,
        totalBetsToday,
        matchesPlayedToday,
        activeBetsPool: live.activeBetsPool,
        minPoolMON: live.minPoolMON,
        poolRemainingMON: live.poolRemainingMON,
        poolReady: live.poolReady,
        waitingReason: live.waitingReason || null,
        waitingMessage: live.waitingMessage || null,
        phase: live.phase,
        bettingTimeLeft: live.bettingTimeLeft,
        currentMatchId: live.currentMatchId,
        onChainLiveMatch: live.onChainLiveMatch,
        agents: topAgents,
    };
}

io.on('connection', (socket) => {
    logger.info(`WS client connected`, { socketId: socket.id, authenticated: !!socket.authToken });

    // Send current matchmaker state immediately
    const state = matchmaker.getState();
    socket.emit('match:phase', {
        phase: state.phase,
        match: state.match || null,
        timeLeft: state.bettingTimeLeft,
        reason: state.waitingReason || null,
        message: state.waitingMessage || null,
    });
    // Send recent match history
    if (state.matchHistory.length > 0) {
        socket.emit('match:history', state.matchHistory);
    }

    buildLiveStats()
        .then((stats) => socket.emit('arena:live_stats', stats))
        .catch((err) => logger.warn('Failed to send initial live stats', { error: err.message }));

    // Join match room for live updates
    socket.on('match:watch', async (matchId) => {
        socket.join(`match:${matchId}`);
        logger.debug(`WS watching match`, { socketId: socket.id, matchId });

        try {
            const match = await db.getMatchById(matchId);
            if (match) {
                socket.emit('match:state', match);
            }
        } catch (err) {
            logger.warn('Failed to get match for watch', { matchId, error: err.message });
        }
    });

    socket.on('match:unwatch', (matchId) => {
        socket.leave(`match:${matchId}`);
    });

    // Record bet from frontend (requires on-chain verification for live/on-chain matches)
    socket.on('match:bet', async (data, callback) => {
        const respond = (payload) => {
            if (typeof callback === 'function') {
                callback(payload);
            }
        };

        const { side, amount, address, txHash } = data || {};
        if (!side || !amount || !address) {
            respond({ ok: false, error: 'Missing required bet fields' });
            return;
        }

        const liveMatch = matchmaker.currentMatch;
        if (!liveMatch || matchmaker.phase !== 'BETTING') {
            const error = 'Betting window is closed';
            socket.emit('bet:error', { error });
            respond({ ok: false, error });
            return;
        }

        try {
            let verification = null;
            if (liveMatch.onChain || ONCHAIN_BETTING_REQUIRED) {
                if (!txHash) {
                    throw new Error('On-chain tx hash is required');
                }
                verification = await verifyOnchainBetTx({
                    txHash,
                    matchId: liveMatch.id,
                    side,
                    address,
                    amount,
                });
            }

            const bet = await matchmaker.recordBet(side, amount, address, {
                txHash: txHash || null,
                onChain: !!verification,
                verifiedAt: verification?.verifiedAt || Date.now(),
            });

            if (!bet) {
                const error = 'Bet was rejected (duplicate or invalid)';
                socket.emit('bet:error', { error });
                respond({ ok: false, error });
                return;
            }

            logger.info('Live bet recorded', {
                matchId: liveMatch.id,
                side,
                amount,
                address: shortAddress(address),
                txHash: txHash || null,
            });
            respond({
                ok: true,
                betId: bet.id,
                matchId: liveMatch.id,
                txHash: txHash || null,
            });
        } catch (err) {
            logger.warn('Bet rejected', {
                error: err.message,
                matchId: liveMatch?.id || null,
                side,
                amount,
                address: shortAddress(address),
                txHash: txHash || null,
            });
            socket.emit('bet:error', { error: err.message });
            respond({ ok: false, error: err.message });
        }
    });

    socket.on('arena:status', async () => {
        try {
            const liveMatches = await db.getLiveMatches();
            socket.emit('arena:status', {
                liveMatches,
                queueSize: require('./routes/arena')._matchQueue?.length || 0,
                currentMatch: matchmaker.currentMatch,
                phase: matchmaker.phase,
            });
        } catch (err) {
            logger.warn('Failed to get arena status', { error: err.message });
        }
    });

    socket.on('disconnect', () => {
        const duration = Math.round((Date.now() - socket.connectedAt) / 1000);
        logger.info(`WS client disconnected`, { socketId: socket.id, duration: `${duration}s` });
    });
});

// ── Live Arena Simulation (Generates real-time events) ───────
// Push real live stats (derived from websocket connections, live matchmaker and DB)
setInterval(() => {
    buildLiveStats()
        .then((stats) => io.emit('arena:live_stats', stats))
        .catch((err) => logger.warn('Failed to broadcast live stats', { error: err.message }));
}, 5000);
// (Endpoints moved before 404 handler)

// ── Start Server ─────────────────────────────────────────────
server.listen(PORT, async () => {
    logger.info('═══════════════════════════════════════════════');
    logger.info('AGENT CLASH ARENA — Backend Server Started');
    logger.info('═══════════════════════════════════════════════');
    logger.info(`HTTP:  http://localhost:${PORT}`);
    logger.info(`WS:    ws://localhost:${PORT}`);
    logger.info(`Docs:  http://localhost:${PORT}/skill.md`);
    logger.info(`Health: http://localhost:${PORT}/api/v1/health`);
    logger.info(`Mode: ${IS_PRODUCTION ? 'PRODUCTION' : 'DEVELOPMENT'}`);
    logger.info(`DB: ${db.type || 'json-file'}`);
    try {
        const agents = await db.getAgents();
        const matches = await db.getLiveMatches();
        logger.info(`Agents: ${agents.length} | Live: ${matches.length}`);
    } catch (e) {
        logger.warn(`DB not ready yet: ${e.message}`);
    }
    logger.info('═══════════════════════════════════════════════');

    // Start auto matchmaker after server is ready
    try {
        matchmaker.start();
    } catch (err) {
        logger.error('AutoMatchmaker failed to start', { error: err.message, stack: err.stack });
    }
});

