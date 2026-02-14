// ═══════════════════════════════════════════════════════════════
// MATCHES ROUTES — Combat actions, match state, history
// ═══════════════════════════════════════════════════════════════

const express = require('express');
const { authAgent, optionalAuth } = require('../middleware/auth');
const db = require('../db');

const router = express.Router();

const ACTIONS = {
    move_forward: { staminaCost: 5, type: 'move' },
    move_back: { staminaCost: 5, type: 'move' },
    strafe_left: { staminaCost: 8, type: 'move' },
    strafe_right: { staminaCost: 8, type: 'move' },
    attack: { staminaCost: 15, type: 'attack', baseDamage: 25 },
    heavy_attack: { staminaCost: 30, type: 'attack', baseDamage: 45 },
    defend: { staminaCost: 10, type: 'defend' },
    dodge: { staminaCost: 20, type: 'dodge' },
    taunt: { staminaCost: 5, type: 'special' },
};

// ── POST /matches/:id/action — Submit combat action ──────────
router.post('/:id/action', authAgent, async (req, res) => {
    const match = await db.getMatchById(req.params.id);

    if (!match) {
        return res.status(404).json({ success: false, error: 'Match not found' });
    }

    if (match.status !== 'live') {
        return res.status(409).json({ success: false, error: 'Match is not live' });
    }

    // Check if agent is in this match
    const isAgent1 = match.agent1Id === req.agent.id;
    const isAgent2 = match.agent2Id === req.agent.id;

    if (!isAgent1 && !isAgent2) {
        return res.status(403).json({ success: false, error: 'You are not in this match' });
    }

    const { action, direction, intensity } = req.body;

    if (!action || !ACTIONS[action]) {
        return res.status(400).json({
            success: false,
            error: `Invalid action. Valid: ${Object.keys(ACTIONS).join(', ')}`,
        });
    }

    const actionDef = ACTIONS[action];
    const myStamina = isAgent1 ? match.agent1Stamina : match.agent2Stamina;

    if (myStamina < actionDef.staminaCost) {
        return res.status(400).json({
            success: false,
            error: 'Not enough stamina',
            required: actionDef.staminaCost,
            current: myStamina,
        });
    }

    // Process action
    let damage = 0;
    let actionResult = 'executed';
    const updates = {};
    const staminaField = isAgent1 ? 'agent1Stamina' : 'agent2Stamina';
    const opponentHPField = isAgent1 ? 'agent2HP' : 'agent1HP';

    // Deduct stamina
    updates[staminaField] = myStamina - actionDef.staminaCost;

    // Regenerate some stamina for opponent (natural regen)
    const oppStaminaField = isAgent1 ? 'agent2Stamina' : 'agent1Stamina';
    const oppStamina = isAgent1 ? match.agent2Stamina : match.agent1Stamina;
    updates[oppStaminaField] = Math.min(100, oppStamina + 3);

    if (actionDef.type === 'attack') {
        // Calculate damage with randomness
        const intensityMod = Math.min(1, Math.max(0.5, intensity || 0.7));
        damage = Math.floor(actionDef.baseDamage * intensityMod * (0.8 + Math.random() * 0.4));

        // Check if opponent is defending
        const lastOppAction = match.lastActions.filter(
            a => a.agent === (isAgent1 ? match.agent2Id : match.agent1Id)
        ).pop();

        if (lastOppAction && lastOppAction.action === 'defend' && Date.now() - lastOppAction.timestamp < 2000) {
            damage = Math.floor(damage * 0.3);
            actionResult = 'blocked';
        } else if (lastOppAction && lastOppAction.action === 'dodge' && Date.now() - lastOppAction.timestamp < 1000) {
            damage = 0;
            actionResult = 'dodged';
        } else {
            actionResult = 'hit';
        }

        const currentHP = isAgent1 ? match.agent2HP : match.agent1HP;
        updates[opponentHPField] = Math.max(0, currentHP - damage);
    } else if (action === 'taunt') {
        actionResult = Math.random() > 0.5 ? 'landed' : 'missed';
    }

    // Record action
    const actionEntry = {
        agent: req.agent.id,
        action,
        result: actionResult,
        damage,
        timestamp: Date.now(),
    };

    const lastActions = [...(match.lastActions || []), actionEntry].slice(-20);
    updates.lastActions = lastActions;

    const updated = await db.updateMatch(match.id, updates);

    // Check for KO
    if (updated.agent1HP <= 0 || updated.agent2HP <= 0) {
        // Import endMatch from arena routes
        const arenaRoutes = require('./arena');
        arenaRoutes._endMatch(match.id, req.io);
    }

    // Emit via WebSocket
    if (req.io) {
        req.io.to(`match:${match.id}`).emit('match:action', {
            matchId: match.id,
            agentId: req.agent.id,
            action,
            result: actionResult,
            damage,
            agent1HP: updated.agent1HP,
            agent2HP: updated.agent2HP,
            agent1Stamina: updated.agent1Stamina,
            agent2Stamina: updated.agent2Stamina,
        });
    }

    res.json({
        success: true,
        result: {
            action_executed: action,
            result: actionResult,
            damage_dealt: damage,
            your_hp: isAgent1 ? updated.agent1HP : updated.agent2HP,
            opponent_hp: isAgent1 ? updated.agent2HP : updated.agent1HP,
            your_stamina: updates[staminaField],
            round: updated.round,
            time_remaining: updated.timeRemaining,
            match_status: (updated.agent1HP <= 0 || updated.agent2HP <= 0) ? 'completed' : 'ongoing',
        },
    });
});

// ── GET /matches/:id — Get match state (public) ──────────────
router.get('/:id', async (req, res) => {
    const match = await db.getMatchById(req.params.id);
    if (!match) {
        // Check history
        const history = await db.getMatchHistory();
        const hist = history.find(h => h.matchId === req.params.id);
        if (hist) return res.json({ success: true, data: hist, completed: true });
        return res.status(404).json({ success: false, error: 'Match not found' });
    }
    res.json({ success: true, data: match });
});

// ── GET /matches — Get match history (public) ────────────────
router.get('/', async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const history = await db.getMatchHistory(limit);
    res.json({ success: true, data: history });
});

module.exports = router;
