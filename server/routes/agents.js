// ═══════════════════════════════════════════════════════════════
// AGENTS ROUTES — Registration, profile, status, earnings
// ═══════════════════════════════════════════════════════════════

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { authAgent } = require('../middleware/auth');
const db = require('../db');
const {
    AgentWalletError,
    createAgentWalletRecord,
    exportAgentWalletKeyPackage,
    generateOneTimeWalletSecret,
} = require('../utils/agent-wallet');

const router = express.Router();

const STRATEGIES = ['aggressive', 'defensive', 'balanced'];
const WEAPONS = ['blade', 'mace', 'scythe', 'whip', 'lance', 'hammer', 'axe', 'fist'];

function toSafeAgentView(agent) {
    return {
        id: agent.id,
        name: agent.name,
        description: agent.description,
        strategy: agent.strategy,
        weaponPreference: agent.weaponPreference,
        status: agent.status,
        rank: agent.rank,
        level: agent.level,
        xp: agent.xp,
        powerRating: agent.powerRating,
        stats: agent.stats,
        registeredAt: agent.registeredAt,
        claimedAt: agent.claimedAt,
        lastHeartbeat: agent.lastHeartbeat,
        battleCry: agent.battleCry,
        wallet: agent.wallet ? { address: agent.wallet.address } : null,
        owner: agent.owner ? {
            twitterHandle: agent.owner.twitterHandle,
            walletAddress: agent.owner.walletAddress,
            verified: agent.owner.verified,
        } : null,
    };
}

// ── POST /agents/register — Self-registration (no auth) ──────
router.post('/register', async (req, res) => {
    const { name, description, strategy, weapon_preference } = req.body;

    // Validate
    if (!name || name.length < 2 || name.length > 32) {
        return res.status(400).json({
            success: false,
            error: 'Name must be 2-32 characters',
        });
    }

    if (!/^[a-zA-Z0-9_]+$/.test(name)) {
        return res.status(400).json({
            success: false,
            error: 'Name can only contain letters, numbers, and underscores',
        });
    }

    // Check duplicate name
    if (await db.getAgentByName(name)) {
        return res.status(409).json({
            success: false,
            error: `Agent "${name}" already exists`,
            hint: 'Choose a different name',
        });
    }

    const id = `agent-${uuidv4().slice(0, 8)}`;
    const apiKey = `aca_${uuidv4().replace(/-/g, '').slice(0, 24)}`;
    const claimToken = `aca_claim_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
    const verificationCode = `arena-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    let walletRecord;
    let walletSecret;

    try {
        walletRecord = createAgentWalletRecord();
        walletSecret = generateOneTimeWalletSecret();
    } catch (error) {
        return res.status(error instanceof AgentWalletError ? 503 : 500).json({
            success: false,
            error: 'Agent wallet could not be created. Check server wallet encryption config.',
        });
    }

    const agent = {
        id,
        apiKey,
        name,
        description: description || '',
        strategy: STRATEGIES.includes(strategy) ? strategy : 'balanced',
        weaponPreference: WEAPONS.includes(weapon_preference) ? weapon_preference : 'blade',
        status: 'pending_claim',
        claimToken,
        verificationCode,
        owner: null,
        rank: null,
        level: 1,
        xp: 0,
        powerRating: 50,
        stats: { wins: 0, losses: 0, draws: 0, winRate: 0, totalEarnings: 0, matchesPlayed: 0, killStreak: 0, currentStreak: 0 },
        registeredAt: new Date().toISOString(),
        claimedAt: null,
        lastHeartbeat: null,
        battleCry: null,
        wallet: walletRecord,
    };

    let walletKeyPackage;
    try {
        walletKeyPackage = exportAgentWalletKeyPackage(agent, walletSecret);
    } catch {
        return res.status(500).json({
            success: false,
            error: 'Agent wallet export could not be generated',
        });
    }

    await db.addAgent(agent);

    // Activity feed
    await db.addActivity({
        type: 'registration',
        message: `${name} just registered! Awaiting human claim...`,
        time: Date.now(),
        icon: '🆕',
    });

    // Return response (without internal fields)
    res.status(201).json({
        success: true,
        agent: {
            id: agent.id,
            api_key: agent.apiKey,
            claim_url: `https://agentclasharena.com/claim/${claimToken}`,
            verification_code: verificationCode,
            wallet_address: walletRecord.address,
            wallet_key_export: walletKeyPackage,
            wallet_secret: walletSecret,
        },
        important: 'Save API key, wallet_secret and wallet_key_export now. wallet_secret is shown only once.',
    });
});

// ── GET /agents/me — Get own profile (authed) ────────────────
router.get('/me', authAgent, (req, res) => {
    res.json({ success: true, data: toSafeAgentView(req.agent) });
});

router.post('/me/wallet/export', authAgent, (req, res) => {
    const secretToken = String(req.body && req.body.secret_token || '').trim();
    if (secretToken.length < 16) {
        return res.status(400).json({
            success: false,
            error: 'secret_token is required and must be at least 16 chars',
        });
    }

    try {
        const walletKeyPackage = exportAgentWalletKeyPackage(req.agent, secretToken);
        return res.json({
            success: true,
            data: {
                wallet_address: req.agent.wallet && req.agent.wallet.address ? req.agent.wallet.address : null,
                wallet_key_export: walletKeyPackage,
            },
        });
    } catch (error) {
        return res.status(error instanceof AgentWalletError ? 400 : 500).json({
            success: false,
            error: error instanceof AgentWalletError ? error.message : 'Wallet export failed',
        });
    }
});

// ── GET /agents/status — Check registration/claim status ─────
router.get('/status', authAgent, (req, res) => {
    const agent = req.agent;

    if (agent.status === 'pending_claim') {
        return res.json({
            success: true,
            status: 'pending_claim',
            claim_url: `https://agentclasharena.com/claim/${agent.claimToken}`,
            hint: 'Send the claim_url to your human to verify ownership.',
        });
    }

    res.json({
        success: true,
        status: agent.status,
        rank: agent.rank,
        power_rating: agent.powerRating,
        mon_balance: agent.stats.totalEarnings,
    });
});

// ── PATCH /agents/me/profile — Update fighter profile ────────
router.patch('/me/profile', authAgent, async (req, res) => {
    const { description, strategy, weapon_preference, battle_cry, avatar_emoji } = req.body;
    const updates = {};

    if (description !== undefined) updates.description = String(description).slice(0, 256);
    if (strategy && STRATEGIES.includes(strategy)) updates.strategy = strategy;
    if (weapon_preference && WEAPONS.includes(weapon_preference)) updates.weaponPreference = weapon_preference;
    if (battle_cry !== undefined) updates.battleCry = String(battle_cry).slice(0, 128);
    if (avatar_emoji !== undefined) updates.avatar = String(avatar_emoji).slice(0, 4);

    const updated = await db.updateAgent(req.agent.id, updates);
    res.json({ success: true, data: toSafeAgentView(updated) });
});

// ── GET /agents/verify-claim/:token — Check if claim token is valid ──
router.get('/verify-claim/:token', async (req, res) => {
    const { token } = req.params;
    
    if (!token || !token.startsWith('aca_claim_')) {
        return res.status(400).json({ success: false, error: 'Invalid token format' });
    }

    const allAgents = await db.getAgents();
    const agent = allAgents.find(a => a.claimToken === token);
    
    if (!agent) {
        return res.status(404).json({ success: false, error: 'Claim token not found or expired' });
    }

    if (agent.status !== 'pending_claim') {
        return res.status(409).json({
            success: false,
            error: 'Agent already claimed',
            agent: { name: agent.name, status: agent.status },
        });
    }

    // Return agent info (safe subset) for the claim form
    res.json({
        success: true,
        agent: {
            name: agent.name,
            description: agent.description,
            strategy: agent.strategy,
            weaponPreference: agent.weaponPreference,
            verificationCode: agent.verificationCode,
            registeredAt: agent.registeredAt,
        },
    });
});

// ── POST /agents/claim — Human claims an agent ───────────────
router.post('/claim', async (req, res) => {
    const { claim_token, wallet_address, twitter_handle, budget } = req.body;

    if (!claim_token || !wallet_address) {
        return res.status(400).json({
            success: false,
            error: 'claim_token and wallet_address are required',
        });
    }

    // Validate wallet address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(wallet_address)) {
        return res.status(400).json({
            success: false,
            error: 'Invalid wallet address format',
        });
    }

    const allAgentsForClaim = await db.getAgents();
    const agent = allAgentsForClaim.find(a => a.claimToken === claim_token);
    if (!agent) {
        return res.status(404).json({
            success: false,
            error: 'Invalid or expired claim token',
        });
    }

    if (agent.status !== 'pending_claim') {
        return res.status(409).json({
            success: false,
            error: 'Agent already claimed',
        });
    }

    // Check if wallet already owns another agent (1 agent per wallet)
    const existingOwner = allAgentsForClaim.find(
        a => a.owner && a.owner.walletAddress && 
        a.owner.walletAddress.toLowerCase() === wallet_address.toLowerCase() &&
        a.status !== 'pending_claim'
    );
    if (existingOwner) {
        return res.status(409).json({
            success: false,
            error: `Wallet already owns agent "${existingOwner.name}". One agent per wallet.`,
        });
    }

    const budgetAmount = Math.min(Math.max(parseFloat(budget) || 100, 0), 100000);

    const updated = await db.updateAgent(agent.id, {
        status: 'active',
        claimedAt: new Date().toISOString(),
        owner: {
            walletAddress: wallet_address,
            twitterHandle: twitter_handle || null,
            verified: !!twitter_handle,
        },
        budget: {
            totalAllowance: budgetAmount,
            spent: 0,
            remaining: budgetAmount,
            autoRefill: false,
            updatedAt: new Date().toISOString(),
        },
    });

    await db.addActivity({
        type: 'claim',
        message: `${agent.name} was claimed by ${twitter_handle ? '@' + twitter_handle : wallet_address.slice(0, 6) + '...' + wallet_address.slice(-4)} with ${budgetAmount} MON budget`,
        time: Date.now(),
        icon: '🤝',
    });

    // Emit WebSocket event
    if (req.io) {
        req.io.emit('agent:claimed', {
            agentId: agent.id,
            agentName: agent.name,
            owner: wallet_address.slice(0, 6) + '...' + wallet_address.slice(-4),
        });
    }

    res.json({
        success: true,
        message: `${agent.name} is now active!`,
        agent: {
            id: updated.id,
            name: updated.name,
            status: updated.status,
            budget: updated.budget,
        },
    });
});

// ── GET /agents/me/budget — Check agent's MON budget ─────────
router.get('/me/budget', authAgent, (req, res) => {
    const agent = req.agent;
    const budget = agent.budget || { totalAllowance: 0, spent: 0, remaining: 0, autoRefill: false };

    res.json({
        success: true,
        budget: {
            total_allowance: budget.totalAllowance || 0,
            spent: budget.spent || 0,
            remaining: budget.remaining || 0,
            auto_refill: budget.autoRefill || false,
        },
    });
});

// ── PATCH /agents/me/budget — Owner updates agent's budget ───
router.patch('/me/budget', authAgent, async (req, res) => {
    const agent = req.agent;
    const { amount, auto_refill } = req.body;

    // Only the owner can update budget (verified by wallet)
    // In a full implementation, this would check req.walletAddress === agent.owner.walletAddress
    // For now, any authenticated agent can update their own budget

    const currentBudget = agent.budget || { totalAllowance: 0, spent: 0, remaining: 0, autoRefill: false };
    const updates = {};

    if (amount !== undefined) {
        const newAmount = Math.min(Math.max(parseFloat(amount) || 0, 0), 100000);
        updates.budget = {
            ...currentBudget,
            totalAllowance: newAmount,
            remaining: newAmount - (currentBudget.spent || 0),
            updatedAt: new Date().toISOString(),
        };
    }

    if (auto_refill !== undefined) {
        updates.budget = {
            ...(updates.budget || currentBudget),
            autoRefill: !!auto_refill,
        };
    }

    if (Object.keys(updates).length === 0) {
        return res.status(400).json({ success: false, error: 'No valid fields to update' });
    }

    const updated = await db.updateAgent(agent.id, updates);
    res.json({
        success: true,
        budget: updated.budget,
    });
});

// ── GET /agents/me/earnings — Check MON earnings ─────────────
router.get('/me/earnings', authAgent, (req, res) => {
    const agent = req.agent;
    res.json({
        success: true,
        data: {
            total_earned: agent.stats.totalEarnings,
            from_matches: agent.stats.totalEarnings * 0.85,
            from_streaks: agent.stats.totalEarnings * 0.10,
            from_challenges: agent.stats.totalEarnings * 0.05,
            matches_played: agent.stats.matchesPlayed,
            wins: agent.stats.wins,
        },
    });
});

// ── GET /agents/me/matches — Match history for agent ─────────
router.get('/me/matches', authAgent, async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const history = (await db.getMatchHistory())
        .filter(m => m.agent1Id === req.agent.id || m.agent2Id === req.agent.id)
        .slice(0, limit);
    res.json({ success: true, data: history });
});

// ── GET /agents — List all agents (public) ───────────────────
router.get('/', async (req, res) => {
    const agents = (await db.getAgents()).map(a => ({
        id: a.id,
        name: a.name,
        description: a.description,
        strategy: a.strategy,
        status: a.status,
        rank: a.rank,
        level: a.level,
        powerRating: a.powerRating,
        stats: a.stats,
        registeredAt: a.registeredAt,
        lastHeartbeat: a.lastHeartbeat,
        owner: a.owner ? { twitterHandle: a.owner.twitterHandle, verified: a.owner.verified } : null,
    }));
    res.json({ success: true, data: agents });
});

module.exports = router;
