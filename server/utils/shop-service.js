const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { ethers } = require('ethers');

const db = require('../db');
const logger = require('./logger');
const blockchain = require('./blockchain');
const { sendTelegramMessage } = require('./telegram');
const { SHOP_ITEMS, SHOP_ITEMS_BY_ID, EQUIPPABLE_SLOTS } = require('../data/shop-items');

const MONAD_RPC_URL = process.env.VITE_MONAD_RPC_URL || process.env.MONAD_RPC_URL || 'https://testnet-rpc.monad.xyz';
const MONAD_CHAIN_ID = 10143;
const MONAD_EXPLORER_TX_BASE = process.env.MONAD_EXPLORER_TX_BASE || 'https://testnet.monadexplorer.com/tx/';
const TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || '';
const ORDER_TTL_MINUTES = Math.min(Math.max(parseInt(process.env.SHOP_ORDER_TTL_MINUTES || '30', 10), 5), 180);

let provider = null;

class ShopError extends Error {
    constructor(message, status = 400, code = 'shop_error') {
        super(message);
        this.name = 'ShopError';
        this.status = status;
        this.code = code;
    }
}

function getProvider() {
    if (provider) return provider;
    provider = new ethers.JsonRpcProvider(MONAD_RPC_URL);
    return provider;
}

function normalizeAddress(address) {
    return String(address || '').toLowerCase();
}

function isValidWalletAddress(address) {
    return /^0x[a-fA-F0-9]{40}$/.test(String(address || ''));
}

function isValidTxHash(txHash) {
    return /^0x[a-fA-F0-9]{64}$/.test(String(txHash || ''));
}

function resolveTreasuryAddress() {
    const explicitAddress =
        process.env.SHOP_TREASURY_ADDRESS ||
        process.env.OPERATOR_WALLET_ADDRESS ||
        process.env.TREASURY_WALLET_ADDRESS ||
        '';

    if (isValidWalletAddress(explicitAddress)) return explicitAddress;

    if (blockchain && blockchain.wallet && isValidWalletAddress(blockchain.wallet.address)) {
        return blockchain.wallet.address;
    }

    return null;
}

function getAgentById(agentId) {
    if (typeof db.getAgentById === 'function') {
        return db.getAgentById(agentId);
    }
    const agents = typeof db.getAgents === 'function' ? db.getAgents() : [];
    return agents.find((agent) => agent.id === agentId) || null;
}

function ensureOwnedAgent(agentId, walletAddress) {
    const agent = getAgentById(agentId);
    if (!agent) {
        throw new ShopError('Agent not found', 404, 'agent_not_found');
    }

    const ownerWallet = normalizeAddress(agent.owner && agent.owner.walletAddress);
    if (!ownerWallet) {
        throw new ShopError('Agent has no claimed owner wallet', 409, 'agent_not_claimed');
    }

    if (normalizeAddress(walletAddress) !== ownerWallet) {
        throw new ShopError('Wallet is not the owner of this agent', 403, 'wallet_not_owner');
    }

    return agent;
}

function buildOrderToken() {
    return `shop_${crypto.randomBytes(8).toString('hex')}`;
}

function isExpired(order) {
    return order && order.status === 'pending_payment' && Number(order.expiresAt || 0) > 0 && Date.now() > Number(order.expiresAt);
}

function maybeExpireOrder(order) {
    if (!order || !isExpired(order)) return order;
    if (typeof db.updateShopOrder !== 'function') return order;
    return db.updateShopOrder(order.id, {
        status: 'expired',
        expiredAt: Date.now(),
    });
}

function orderToPublic(order) {
    return {
        id: order.id,
        order_token: order.orderToken,
        status: order.status,
        amount_mon: order.amountMON,
        item_id: order.itemId,
        item: order.item,
        agent_id: order.agentId,
        buy_and_equip: !!order.buyAndEquip,
        created_at: order.createdAt,
        expires_at: order.expiresAt,
        paid_at: order.paidAt || null,
        tx_hash: order.payment && order.payment.txHash ? order.payment.txHash : null,
        tx_explorer: order.payment && order.payment.txHash ? `${MONAD_EXPLORER_TX_BASE}${order.payment.txHash}` : null,
        treasury_address: order.payment ? order.payment.treasuryAddress : null,
        payment_confirm_command: `PAY ${order.orderToken} <tx_hash>`,
        telegram_bot_username: TELEGRAM_BOT_USERNAME || null,
    };
}

function ensureShopDbCapabilities() {
    const required = ['addShopOrder', 'getShopOrderById', 'getShopOrderByToken', 'updateShopOrder', 'findShopOrderByTxHash', 'applyShopPurchase', 'getAgentInventory', 'equipInventoryItem', 'unequipInventorySlot'];
    const missing = required.filter((fn) => typeof db[fn] !== 'function');
    if (missing.length > 0) {
        throw new ShopError(`Database mode does not support shop operations (${missing.join(', ')})`, 501, 'shop_not_supported');
    }
}

function getShopConfig() {
    const treasuryAddress = resolveTreasuryAddress();
    return {
        payment_enabled: !!treasuryAddress,
        treasury_address: treasuryAddress,
        chain_id: MONAD_CHAIN_ID,
        rpc_url: MONAD_RPC_URL,
        tx_explorer_base: MONAD_EXPLORER_TX_BASE,
        order_ttl_minutes: ORDER_TTL_MINUTES,
        telegram_bot_username: TELEGRAM_BOT_USERNAME || null,
        payment_confirm_command_format: 'PAY <order_token> <tx_hash>',
    };
}

function listOwnedAgents(walletAddress) {
    if (!isValidWalletAddress(walletAddress)) {
        throw new ShopError('Invalid wallet address format', 400, 'invalid_wallet');
    }

    const normalized = normalizeAddress(walletAddress);
    const agents = typeof db.getAgents === 'function' ? db.getAgents() : [];

    return agents
        .filter((agent) => normalizeAddress(agent.owner && agent.owner.walletAddress) === normalized)
        .map((agent) => ({
            id: agent.id,
            name: agent.name,
            status: agent.status,
            powerRating: agent.powerRating,
            hasTelegramLinked: !!(agent.onboarding && agent.onboarding.telegramChatId),
            telegramUsername: agent.onboarding && agent.onboarding.telegramUsername ? agent.onboarding.telegramUsername : null,
        }));
}

function getAgentInventoryForOwner(agentId, walletAddress) {
    ensureShopDbCapabilities();
    ensureOwnedAgent(agentId, walletAddress);
    return db.getAgentInventory(agentId);
}

async function createShopOrder({ agentId, itemId, walletAddress, buyAndEquip = false, ipAddress = '' }) {
    ensureShopDbCapabilities();

    if (!isValidWalletAddress(walletAddress)) {
        throw new ShopError('Invalid wallet address format', 400, 'invalid_wallet');
    }

    const agent = ensureOwnedAgent(agentId, walletAddress);
    const item = SHOP_ITEMS_BY_ID[itemId];
    if (!item) {
        throw new ShopError('Unknown shop item', 400, 'unknown_item');
    }

    if (buyAndEquip && !EQUIPPABLE_SLOTS.has(item.category)) {
        throw new ShopError('This item cannot be auto-equipped', 400, 'item_not_equippable');
    }

    const treasuryAddress = resolveTreasuryAddress();
    if (!treasuryAddress) {
        throw new ShopError('Treasury wallet is not configured. Set SHOP_TREASURY_ADDRESS.', 503, 'treasury_missing');
    }

    const createdAt = Date.now();
    const expiresAt = createdAt + ORDER_TTL_MINUTES * 60 * 1000;
    const orderToken = buildOrderToken();
    const chatId = agent.onboarding && agent.onboarding.telegramChatId ? String(agent.onboarding.telegramChatId) : null;

    const order = {
        id: `ord-${uuidv4().slice(0, 8)}`,
        orderToken,
        status: 'pending_payment',
        agentId: agent.id,
        agentName: agent.name,
        ownerWallet: normalizeAddress(walletAddress),
        itemId: item.id,
        item: {
            id: item.id,
            name: item.name,
            category: item.category,
            rarity: item.rarity,
            price: item.price,
        },
        amountMON: item.price,
        buyAndEquip: !!buyAndEquip,
        createdAt,
        expiresAt,
        paidAt: null,
        expiredAt: null,
        payment: {
            treasuryAddress,
            txHash: null,
            fromWallet: null,
            valueMON: null,
            blockNumber: null,
            source: null,
            verifiedAt: null,
        },
        telegram: {
            chatId,
            username: agent.onboarding && agent.onboarding.telegramUsername ? agent.onboarding.telegramUsername : null,
        },
        audit: {
            ip: ipAddress || null,
            createdBy: 'shop_ui',
        },
    };

    const savedOrder = db.addShopOrder(order);

    if (chatId) {
        const messageLines = [
            `Shop order created for ${agent.name}`,
            `Order Token: ${orderToken}`,
            `Item: ${item.name}`,
            `Amount: ${item.price} MON`,
            `Pay to: ${treasuryAddress}`,
            '',
            'After payment, send this command:',
            `PAY ${orderToken} <tx_hash>`,
            '',
            `Order expires in ${ORDER_TTL_MINUTES} minutes.`,
        ];
        await sendTelegramMessage(chatId, messageLines.join('\n'));
    }

    return {
        order: orderToPublic(savedOrder),
        telegram_linked: !!chatId,
    };
}

async function verifyPaymentTx({ txHash, expectedFromWallet, expectedTreasury, minAmountMON }) {
    if (!isValidTxHash(txHash)) {
        throw new ShopError('Invalid transaction hash format', 400, 'invalid_tx_hash');
    }

    const rpcProvider = getProvider();
    let tx;
    let receipt;
    try {
        [tx, receipt] = await Promise.all([
            rpcProvider.getTransaction(txHash),
            rpcProvider.getTransactionReceipt(txHash),
        ]);
    } catch (error) {
        logger.warn('Shop payment verification RPC error', { error: error.message, txHash });
        throw new ShopError('Could not verify transaction from Monad RPC', 503, 'rpc_unavailable');
    }

    if (!tx) {
        throw new ShopError('Transaction not found', 404, 'tx_not_found');
    }

    if (!receipt) {
        throw new ShopError('Transaction found but not mined yet', 409, 'tx_not_mined');
    }

    if (Number(receipt.status) !== 1) {
        throw new ShopError('Transaction failed on-chain', 400, 'tx_failed');
    }

    if (!tx.to || normalizeAddress(tx.to) !== normalizeAddress(expectedTreasury)) {
        throw new ShopError('Transaction destination does not match treasury wallet', 400, 'tx_wrong_destination');
    }

    if (expectedFromWallet && normalizeAddress(tx.from) !== normalizeAddress(expectedFromWallet)) {
        throw new ShopError('Transaction sender does not match owner wallet', 400, 'tx_wrong_sender');
    }

    const expectedWei = ethers.parseEther(String(minAmountMON));
    if (tx.value < expectedWei) {
        throw new ShopError(`Transaction value is below required amount (${minAmountMON} MON)`, 400, 'tx_underpaid');
    }

    return {
        txHash: tx.hash,
        from: tx.from,
        to: tx.to,
        valueMON: Number(ethers.formatEther(tx.value)),
        blockNumber: receipt.blockNumber,
        verifiedAt: Date.now(),
    };
}

async function settleOrderPayment({ order, txHash, walletAddress, source = 'web', io = null }) {
    const activeOrder = maybeExpireOrder(order);
    if (!activeOrder) {
        throw new ShopError('Order not found', 404, 'order_not_found');
    }

    if (activeOrder.status === 'paid') {
        if (activeOrder.payment && activeOrder.payment.txHash && normalizeAddress(activeOrder.payment.txHash) !== normalizeAddress(txHash)) {
            throw new ShopError('Order is already paid with a different transaction', 409, 'order_already_paid');
        }
        return {
            order: orderToPublic(activeOrder),
            inventory: db.getAgentInventory(activeOrder.agentId),
            already_paid: true,
        };
    }

    if (activeOrder.status !== 'pending_payment') {
        throw new ShopError(`Order cannot be paid in status "${activeOrder.status}"`, 409, 'order_not_payable');
    }

    if (walletAddress && normalizeAddress(walletAddress) !== normalizeAddress(activeOrder.ownerWallet)) {
        throw new ShopError('Wallet does not match order owner', 403, 'wallet_not_order_owner');
    }

    const existingOrderWithTx = db.findShopOrderByTxHash(txHash);
    if (existingOrderWithTx && existingOrderWithTx.id !== activeOrder.id) {
        throw new ShopError('This transaction hash is already used by another order', 409, 'tx_already_used');
    }

    const verification = await verifyPaymentTx({
        txHash,
        expectedFromWallet: activeOrder.ownerWallet,
        expectedTreasury: activeOrder.payment.treasuryAddress,
        minAmountMON: activeOrder.amountMON,
    });

    const paidOrder = db.updateShopOrder(activeOrder.id, {
        status: 'paid',
        paidAt: Date.now(),
        payment: {
            ...activeOrder.payment,
            txHash: verification.txHash,
            fromWallet: verification.from,
            valueMON: verification.valueMON,
            blockNumber: verification.blockNumber,
            source,
            verifiedAt: verification.verifiedAt,
        },
    });

    const inventory = db.applyShopPurchase(activeOrder.agentId, activeOrder.itemId, {
        buyAndEquip: !!activeOrder.buyAndEquip,
        orderId: activeOrder.id,
        txHash: verification.txHash,
        paidAt: Date.now(),
        amountMON: activeOrder.amountMON,
    });

    db.addActivity({
        type: 'shop_purchase',
        message: `${activeOrder.agentName} bought ${activeOrder.item.name} for ${activeOrder.amountMON} MON`,
        time: Date.now(),
        icon: 'shop',
    });

    if (io) {
        io.emit('shop:order_paid', {
            orderId: activeOrder.id,
            agentId: activeOrder.agentId,
            itemId: activeOrder.itemId,
            txHash: verification.txHash,
        });
    }

    if (activeOrder.telegram && activeOrder.telegram.chatId) {
        await sendTelegramMessage(
            activeOrder.telegram.chatId,
            [
                `Payment confirmed for ${activeOrder.agentName}`,
                `Item: ${activeOrder.item.name}`,
                `Amount: ${activeOrder.amountMON} MON`,
                `Tx: ${verification.txHash}`,
            ].join('\n')
        );
    }

    return {
        order: orderToPublic(paidOrder),
        inventory,
        verification: {
            tx_hash: verification.txHash,
            from_wallet: verification.from,
            value_mon: verification.valueMON,
            block_number: verification.blockNumber,
        },
        already_paid: false,
    };
}

async function confirmOrderPayment({ orderId, txHash, walletAddress, source = 'web', io = null }) {
    ensureShopDbCapabilities();

    if (!isValidWalletAddress(walletAddress)) {
        throw new ShopError('Invalid wallet address format', 400, 'invalid_wallet');
    }
    if (!isValidTxHash(txHash)) {
        throw new ShopError('Invalid transaction hash format', 400, 'invalid_tx_hash');
    }

    const order = db.getShopOrderById(orderId);
    if (!order) {
        throw new ShopError('Order not found', 404, 'order_not_found');
    }

    return settleOrderPayment({ order, txHash, walletAddress, source, io });
}

async function confirmOrderPaymentByToken({ orderToken, txHash, source = 'telegram', io = null }) {
    ensureShopDbCapabilities();

    if (!orderToken || String(orderToken).length < 8) {
        throw new ShopError('Invalid order token', 400, 'invalid_order_token');
    }
    if (!isValidTxHash(txHash)) {
        throw new ShopError('Invalid transaction hash format', 400, 'invalid_tx_hash');
    }

    const order = db.getShopOrderByToken(orderToken);
    if (!order) {
        throw new ShopError('Order token not found', 404, 'order_not_found');
    }

    return settleOrderPayment({
        order,
        txHash,
        walletAddress: order.ownerWallet,
        source,
        io,
    });
}

function getOrderForWallet(orderId, walletAddress) {
    ensureShopDbCapabilities();

    if (!isValidWalletAddress(walletAddress)) {
        throw new ShopError('Invalid wallet address format', 400, 'invalid_wallet');
    }

    const order = maybeExpireOrder(db.getShopOrderById(orderId));
    if (!order) {
        throw new ShopError('Order not found', 404, 'order_not_found');
    }

    if (normalizeAddress(order.ownerWallet) !== normalizeAddress(walletAddress)) {
        throw new ShopError('Wallet is not the owner of this order', 403, 'wallet_not_order_owner');
    }

    return {
        order: orderToPublic(order),
        inventory: db.getAgentInventory(order.agentId),
    };
}

function equipBackpackItem({ agentId, walletAddress, itemId }) {
    ensureShopDbCapabilities();
    ensureOwnedAgent(agentId, walletAddress);
    const inventory = db.equipInventoryItem(agentId, itemId);
    if (!inventory) {
        throw new ShopError('Item not found in backpack or item is not equippable', 400, 'equip_failed');
    }
    return inventory;
}

function unequipSlot({ agentId, walletAddress, slot }) {
    ensureShopDbCapabilities();
    ensureOwnedAgent(agentId, walletAddress);
    if (!EQUIPPABLE_SLOTS.has(slot)) {
        throw new ShopError('Invalid equipment slot', 400, 'invalid_slot');
    }
    return db.unequipInventorySlot(agentId, slot);
}

function parseTelegramPayCommand(text) {
    const raw = String(text || '').trim();
    const match = raw.match(/^(?:\/pay|pay)\s+([a-zA-Z0-9_-]+)\s+(0x[a-fA-F0-9]{64})$/i);
    if (!match) return null;
    return {
        orderToken: match[1],
        txHash: match[2],
    };
}

module.exports = {
    ShopError,
    SHOP_ITEMS,
    getShopConfig,
    listOwnedAgents,
    getAgentInventoryForOwner,
    createShopOrder,
    getOrderForWallet,
    confirmOrderPayment,
    confirmOrderPaymentByToken,
    equipBackpackItem,
    unequipSlot,
    parseTelegramPayCommand,
};
