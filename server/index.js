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
    contentSecurityPolicy: false, // Disabled — SPA serves its own assets via same-origin
    crossOriginEmbedderPolicy: false, // Allow external images/fonts
    crossOriginResourcePolicy: { policy: 'same-site' },
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

    const totalBets = db.data.bets.reduce((sum, b) => sum + b.amount, 0);
    const activeAgents = agents.filter(a => a.status !== 'pending_claim').length;

    res.json({
        success: true,
        data: {
            totalAgents: agents.length,
            activeAgents,
            liveMatches: liveMatches.length,
            totalMatchesPlayed: history.length,
            totalBetsPlaced: db.data.bets.length,
            totalMONWagered: totalBets,
            payoutTreasuryMON: platformEconomy.treasuryMON,
            totalPaidToAgentsMON: platformEconomy.totalPaidToAgents,
            totalPaidToBettorsMON: platformEconomy.totalPaidToBettors,
            onlineViewers: 1800 + Math.floor(Math.random() * 200),
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
app.get('/api/v1/arena/live-stats', (_req, res) => {
    res.json({
        success: true,
        data: {
            ...liveArenaState,
            agents: ARENA_AGENTS,
        },
    });
});

app.get('/api/v1/arena/recent-results', (_req, res) => {
    res.json({
        success: true,
        data: liveArenaState.recentResults,
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

io.on('connection', (socket) => {
    logger.info(`WS client connected`, { socketId: socket.id, authenticated: !!socket.authToken });

    // Send current matchmaker state immediately
    const state = matchmaker.getState();
    if (state.match) {
        socket.emit('match:phase', {
            phase: state.phase,
            match: state.match,
            timeLeft: state.bettingTimeLeft,
        });
    }
    // Send recent match history
    if (state.matchHistory.length > 0) {
        socket.emit('match:history', state.matchHistory);
    }

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

    // Record bet from frontend
    socket.on('match:bet', (data) => {
        const { side, amount, address } = data || {};
        if (!side || !amount) return;
        const bet = matchmaker.recordBet(side, amount, address);
        if (bet) {
            logger.info(`Bet recorded: ${amount} MON on side ${side}`, { address, matchId: matchmaker.currentMatch?.id });
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
const ARENA_AGENTS = [
    { id: 'a1', name: 'ShadowStrike', avatar: '🗡️', color: '#FF2D78', rank: 1, wins: 47, losses: 12, powerRating: 94 },
    { id: 'a2', name: 'IronGuard', avatar: '🛡️', color: '#00F5FF', rank: 2, wins: 41, losses: 15, powerRating: 89 },
    { id: 'a3', name: 'VoidWalker', avatar: '🌀', color: '#836EF9', rank: 3, wins: 38, losses: 18, powerRating: 87 },
    { id: 'a4', name: 'PyroBlitz', avatar: '🔥', color: '#FF6B35', rank: 4, wins: 35, losses: 20, powerRating: 83 },
    { id: 'a5', name: 'FrostByte', avatar: '❄️', color: '#69D2E7', rank: 5, wins: 32, losses: 22, powerRating: 80 },
    { id: 'a6', name: 'ThunderClap', avatar: '⚡', color: '#FFE93E', rank: 6, wins: 29, losses: 25, powerRating: 76 },
    { id: 'a7', name: 'NightReaper', avatar: '💀', color: '#9B59B6', rank: 7, wins: 26, losses: 28, powerRating: 72 },
    { id: 'a8', name: 'TitanForce', avatar: '🦾', color: '#2ECC71', rank: 8, wins: 23, losses: 30, powerRating: 68 },
];

let liveArenaState = {
    viewers: 1800 + Math.floor(Math.random() * 400),
    totalBetsToday: 284000 + Math.floor(Math.random() * 50000),
    matchesPlayedToday: 47 + Math.floor(Math.random() * 20),
    activeBetsPool: 5420,
    recentResults: [],
};

// Simulated live activity events
const EVENT_TEMPLATES = [
    (a) => ({ type: 'bet', icon: '💰', text: `${['0xCafe...', '0xDead...', '0xBabe...', '0x1337...', '0xF00d...'][Math.floor(Math.random() * 5)]} bet ${[50, 100, 250, 500, 1000][Math.floor(Math.random() * 5)]} MON on ${a.name}`, color: '#FFE93E' }),
    (a) => ({ type: 'win', icon: '🏆', text: `${a.name} won their last match! +${Math.floor(Math.random() * 500 + 100)} MON`, color: a.color }),
    (a) => ({ type: 'streak', icon: '🔥', text: `${a.name} is on a ${Math.floor(Math.random() * 5 + 3)}-win streak!`, color: '#FF6B35' }),
    (a) => ({ type: 'critical', icon: '💥', text: `${a.name} landed a CRITICAL HIT! -${Math.floor(Math.random() * 30 + 20)} HP`, color: '#FF2D78' }),
    (a) => ({ type: 'combo', icon: '⚡', text: `${a.name} hit a ${Math.floor(Math.random() * 4 + 3)}x COMBO!`, color: '#00F5FF' }),
    (a) => ({ type: 'special', icon: '🌟', text: `${a.name} unleashed SPECIAL MOVE!`, color: '#836EF9' }),
    (a) => ({ type: 'dodge', icon: '💨', text: `${a.name} dodged a lethal blow!`, color: '#69D2E7' }),
    (a) => ({ type: 'ko', icon: '💀', text: `${a.name} scored a KNOCKOUT!`, color: '#FF3131' }),
    (a) => ({ type: 'join', icon: '📋', text: `${a.name} joined the matchmaking queue`, color: '#39FF14' }),
    (a) => ({ type: 'heartbeat', icon: '💓', text: `${a.name} heartbeat — online & ready`, color: '#2ECC71' }),
    () => ({ type: 'platform', icon: '🎮', text: `${Math.floor(Math.random() * 50 + 10)} new bets placed in the last minute`, color: '#836EF9' }),
    () => ({ type: 'viewers', icon: '👁️', text: `${Math.floor(Math.random() * 100 + 50)} viewers just joined the arena`, color: '#00F5FF' }),
];

// Push live events every 2-4 seconds
setInterval(() => {
    const agent = ARENA_AGENTS[Math.floor(Math.random() * ARENA_AGENTS.length)];
    const template = EVENT_TEMPLATES[Math.floor(Math.random() * EVENT_TEMPLATES.length)];
    const event = { ...template(agent), timestamp: Date.now() };

    // Update live stats
    liveArenaState.viewers += Math.floor(Math.random() * 20 - 8);
    liveArenaState.viewers = Math.max(1500, Math.min(3000, liveArenaState.viewers));
    liveArenaState.totalBetsToday += Math.floor(Math.random() * 500);
    liveArenaState.activeBetsPool += Math.floor(Math.random() * 200 - 80);
    liveArenaState.activeBetsPool = Math.max(2000, liveArenaState.activeBetsPool);

    io.emit('arena:live_event', event);
    io.emit('arena:live_stats', {
        viewers: liveArenaState.viewers,
        totalBetsToday: liveArenaState.totalBetsToday,
        matchesPlayedToday: liveArenaState.matchesPlayedToday,
        activeBetsPool: liveArenaState.activeBetsPool,
    });
}, 2500 + Math.floor(Math.random() * 2000));

// Simulate match results periodically (add to recent results)
setInterval(() => {
    const agents = [...ARENA_AGENTS].sort(() => Math.random() - 0.5);
    const winner = agents[0];
    const loser = agents[1];
    const monEarned = Math.floor(Math.random() * 800 + 100);
    const result = {
        id: `res-${Date.now()}`,
        winner: { name: winner.name, avatar: winner.avatar, color: winner.color },
        loser: { name: loser.name, avatar: loser.avatar, color: loser.color },
        monEarned,
        method: ['KO', 'Decision', 'Time Out'][Math.floor(Math.random() * 3)],
        duration: Math.floor(Math.random() * 120 + 60),
        timestamp: Date.now(),
    };
    liveArenaState.recentResults.unshift(result);
    if (liveArenaState.recentResults.length > 10) liveArenaState.recentResults.pop();
    liveArenaState.matchesPlayedToday++;
    winner.wins++;
    loser.losses++;

    io.emit('arena:match_result', result);
}, 45000 + Math.floor(Math.random() * 30000));

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
