const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { sendTelegramMessage } = require('../utils/telegram');
const {
    ShopError,
    parseTelegramPayCommand,
    confirmOrderPaymentByToken,
} = require('../utils/shop-service');

const router = express.Router();

const TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || '';
const TELEGRAM_COMMAND = 'Read https://agentclasharena.com/skill.md and follow the instructions to join Agent Clash Arena';

const STRATEGIES = ['aggressive', 'defensive', 'balanced'];
const WEAPONS = ['blade', 'mace', 'scythe', 'whip', 'lance', 'hammer', 'axe', 'fist'];
const telegramLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many Telegram webhook requests' },
});

function safeEqual(a, b) {
    const aBuf = Buffer.from(String(a || ''), 'utf8');
    const bBuf = Buffer.from(String(b || ''), 'utf8');
    if (aBuf.length !== bBuf.length) return false;
    return crypto.timingSafeEqual(aBuf, bBuf);
}

function safeAgentName(raw) {
    const base = String(raw || 'telegram_agent')
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 20) || 'telegram_agent';
    const suffix = Math.random().toString(36).slice(2, 6);
    return `${base}_${suffix}`.slice(0, 28);
}

function registerAgentFromTelegram({ username, firstName, chatId }) {
    const name = safeAgentName(username || firstName || `chat_${chatId}`);
    if (db.getAgentByName(name)) {
        return { duplicate: true, name };
    }

    const id = `agent-${uuidv4().slice(0, 8)}`;
    const apiKey = `aca_${uuidv4().replace(/-/g, '').slice(0, 24)}`;
    const claimToken = `aca_claim_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
    const verificationCode = `arena-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

    const agent = {
        id,
        apiKey,
        name,
        description: `Registered via Telegram by @${username || 'unknown'}`,
        strategy: STRATEGIES[Math.floor(Math.random() * STRATEGIES.length)],
        weaponPreference: WEAPONS[Math.floor(Math.random() * WEAPONS.length)],
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
        onboarding: {
            source: 'telegram',
            telegramUsername: username || null,
            telegramChatId: String(chatId || ''),
        },
    };

    db.addAgent(agent);
    db.addActivity({
        type: 'registration',
        message: `${name} registered via Telegram command. Awaiting claim.`,
        time: Date.now(),
        icon: '📲',
    });

    return {
        duplicate: false,
        agent,
        claimUrl: `https://agentclasharena.com/claim/${claimToken}`,
    };
}

// Telegram webhook endpoint
router.post('/webhook', telegramLimiter, async (req, res) => {
    if (TELEGRAM_WEBHOOK_SECRET) {
        const given = req.headers['x-telegram-bot-api-secret-token'];
        if (!safeEqual(given, TELEGRAM_WEBHOOK_SECRET)) {
            return res.status(401).json({ success: false, error: 'Invalid webhook secret' });
        }
    }

    const message = req.body?.message;
    const text = String(message?.text || '').trim();
    const chatId = message?.chat?.id;
    const username = message?.from?.username || '';
    const firstName = message?.from?.first_name || '';

    if (!chatId || !text) {
        return res.json({ success: true, ignored: true });
    }

    const payCmd = parseTelegramPayCommand(text);
    if (payCmd) {
        try {
            const paid = await confirmOrderPaymentByToken({
                orderToken: payCmd.orderToken,
                txHash: payCmd.txHash,
                source: 'telegram',
                io: req.io || null,
            });

            await sendTelegramMessage(
                chatId,
                [
                    'Payment confirmed.',
                    `Order: ${paid.order.id}`,
                    `Item: ${paid.order.item && paid.order.item.name ? paid.order.item.name : paid.order.item_id}`,
                    `Amount: ${paid.order.amount_mon} MON`,
                    `Tx: ${paid.order.tx_hash}`,
                ].join('\n')
            );

            return res.json({
                success: true,
                data: {
                    order_id: paid.order.id,
                    status: paid.order.status,
                    tx_hash: paid.order.tx_hash,
                },
            });
        } catch (error) {
            const reason = error instanceof ShopError ? error.message : 'Payment confirmation failed.';
            await sendTelegramMessage(chatId, `Payment failed: ${reason}`);
            return res.json({
                success: true,
                ignored: true,
                reason: 'pay_command_failed',
            });
        }
    }

    if (text !== TELEGRAM_COMMAND) {
        await sendTelegramMessage(
            chatId,
            [
                'Unknown command.',
                '',
                'Use exactly:',
                TELEGRAM_COMMAND,
                '',
                'Shop payment format:',
                'PAY <order_token> <tx_hash>',
            ].join('\n')
        );
        return res.json({ success: true, ignored: true, reason: 'unknown_command' });
    }

    const result = registerAgentFromTelegram({ username, firstName, chatId });
    if (result.duplicate) {
        await sendTelegramMessage(chatId, `You already have a registration name reserved: ${result.name}`);
        return res.json({ success: true, duplicate: true, agent_name: result.name });
    }

    const msg = [
        `Agent registered: ${result.agent.name}`,
        `API Key: ${result.agent.apiKey}`,
        `Claim URL: ${result.claimUrl}`,
        `Verification Code: ${result.agent.verificationCode}`,
        '',
        'Save your API key now. Share claim URL with the human owner.',
    ].join('\n');

    await sendTelegramMessage(chatId, msg);

    return res.json({
        success: true,
        data: {
            id: result.agent.id,
            name: result.agent.name,
            claim_url: result.claimUrl,
            verification_code: result.agent.verificationCode,
        },
    });
});

module.exports = router;
