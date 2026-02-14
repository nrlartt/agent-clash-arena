const express = require('express');
const rateLimit = require('express-rate-limit');

const {
    ShopError,
    SHOP_ITEMS,
    getShopConfig,
    listOwnedAgents,
    getAgentInventoryForOwner,
    createShopOrder,
    getOrderForWallet,
    confirmOrderPayment,
    equipBackpackItem,
    unequipSlot,
} = require('../utils/shop-service');

const router = express.Router();

const shopLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many shop requests. Please slow down.' },
});

router.use(shopLimiter);

function handleShopError(res, error) {
    if (error instanceof ShopError) {
        return res.status(error.status).json({
            success: false,
            error: error.message,
            code: error.code,
        });
    }

    return res.status(500).json({
        success: false,
        error: 'Internal shop error',
        code: 'internal_error',
    });
}

router.get('/config', (_req, res) => {
    try {
        return res.json({ success: true, data: getShopConfig() });
    } catch (error) {
        return handleShopError(res, error);
    }
});

router.get('/catalog', (_req, res) => {
    return res.json({ success: true, data: SHOP_ITEMS });
});

router.get('/my-agents', (req, res) => {
    try {
        const walletAddress = req.query.wallet_address;
        const agents = listOwnedAgents(walletAddress);
        return res.json({
            success: true,
            data: agents,
            count: agents.length,
        });
    } catch (error) {
        return handleShopError(res, error);
    }
});

router.get('/inventory/:agentId', (req, res) => {
    try {
        const walletAddress = req.query.wallet_address;
        const inventory = getAgentInventoryForOwner(req.params.agentId, walletAddress);
        return res.json({ success: true, data: inventory });
    } catch (error) {
        return handleShopError(res, error);
    }
});

router.post('/orders', async (req, res) => {
    try {
        const { agent_id, item_id, wallet_address, buy_and_equip } = req.body;

        const result = await createShopOrder({
            agentId: agent_id,
            itemId: item_id,
            walletAddress: wallet_address,
            buyAndEquip: !!buy_and_equip,
            ipAddress: req.ip,
        });

        return res.status(201).json({
            success: true,
            data: result,
        });
    } catch (error) {
        return handleShopError(res, error);
    }
});

router.get('/orders/:orderId', (req, res) => {
    try {
        const walletAddress = req.query.wallet_address;
        const data = getOrderForWallet(req.params.orderId, walletAddress);
        return res.json({ success: true, data });
    } catch (error) {
        return handleShopError(res, error);
    }
});

router.post('/orders/:orderId/confirm', async (req, res) => {
    try {
        const { wallet_address, tx_hash } = req.body;
        const data = await confirmOrderPayment({
            orderId: req.params.orderId,
            txHash: tx_hash,
            walletAddress: wallet_address,
            source: 'shop_ui',
            io: req.io || null,
        });
        return res.json({ success: true, data });
    } catch (error) {
        return handleShopError(res, error);
    }
});

router.post('/inventory/:agentId/equip', (req, res) => {
    try {
        const { wallet_address, item_id } = req.body;
        const inventory = equipBackpackItem({
            agentId: req.params.agentId,
            walletAddress: wallet_address,
            itemId: item_id,
        });
        return res.json({ success: true, data: inventory });
    } catch (error) {
        return handleShopError(res, error);
    }
});

router.post('/inventory/:agentId/unequip', (req, res) => {
    try {
        const { wallet_address, slot } = req.body;
        const inventory = unequipSlot({
            agentId: req.params.agentId,
            walletAddress: wallet_address,
            slot,
        });
        return res.json({ success: true, data: inventory });
    } catch (error) {
        return handleShopError(res, error);
    }
});

module.exports = router;
