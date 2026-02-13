const express = require('express');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();

// Environment variables
const CIRCLE_BASE_URL = process.env.CIRCLE_API_URL || "https://api.circle.com";
const CIRCLE_API_KEY = process.env.CIRCLE_API_KEY;

// Helper function to make Circle API requests
async function circleRequest(endpoint, method = 'GET', body = null, userToken = null) {
    if (!CIRCLE_API_KEY) {
        throw new Error('Server Circle API Key configuration missing');
    }

    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CIRCLE_API_KEY}`
    };

    if (userToken) {
        headers['X-User-Token'] = userToken;
    }

    const options = {
        method,
        headers
    };

    if (body) {
        options.body = JSON.stringify(body);
    }

    // Node.js builtin fetch (requires Node 18+)
    const response = await fetch(`${CIRCLE_BASE_URL}${endpoint}`, options);
    const data = await response.json();

    if (!response.ok) {
        const error = new Error(data.message || 'Circle API Error');
        error.status = response.status;
        error.data = data;
        throw error;
    }

    return data;
}

// 1. Create Device Token (Step 1 of social login flow)
router.post('/device-token', async (req, res) => {
    try {
        const { deviceId } = req.body;
        if (!deviceId) return res.status(400).json({ error: 'Missing deviceId' });

        // Note: The documentation example uses /v1/w3s/users/social/token specifically for social login flows
        // This creates a device token tied to the social auth process
        const data = await circleRequest('/v1/w3s/users/social/token', 'POST', {
            idempotencyKey: uuidv4(),
            deviceId
        });

        res.json(data.data);
    } catch (error) {
        console.error('Circle API Error:', error);
        res.status(error.status || 500).json(error.data || { error: error.message });
    }
});

// 2. Initialize User (Step 3: Get User Token and Challenge)
router.post('/initialize-user', async (req, res) => {
    try {
        const { userToken } = req.body;
        if (!userToken) return res.status(400).json({ error: 'Missing userToken' });

        // Initialize user on ARC-TESTNET (or Monad if supported later via chainId)
        // For now using standard testnet as placeholder
        const data = await circleRequest('/v1/w3s/user/initialize', 'POST', {
            idempotencyKey: uuidv4(),
            accountType: 'SCA',
            blockchains: ['MATIC-AMOY'], // Using a supported testnet, change to Monad when available
        }, userToken);

        res.json(data.data);
    } catch (error) {
        // Pass through specific Circle errors (like user already initialized)
        if (error.data) return res.status(error.status).json(error.data);
        res.status(500).json({ error: error.message });
    }
});

// 3. List Wallets
router.get('/wallets', async (req, res) => {
    try {
        const userToken = req.headers['x-user-token'];
        if (!userToken) return res.status(400).json({ error: 'Missing X-User-Token header' });

        const data = await circleRequest('/v1/w3s/wallets', 'GET', null, userToken);
        res.json(data.data);
    } catch (error) {
        res.status(error.status || 500).json(error.data || { error: error.message });
    }
});

// 4. Get Balances
router.get('/wallet/:id/balances', async (req, res) => {
    try {
        const userToken = req.headers['x-user-token'];
        const walletId = req.params.id;

        if (!userToken) return res.status(400).json({ error: 'Missing X-User-Token header' });

        const data = await circleRequest(`/v1/w3s/wallets/${walletId}/balances`, 'GET', null, userToken);
        res.json(data.data);
    } catch (error) {
        res.status(error.status || 500).json(error.data || { error: error.message });
    }
});

module.exports = router;
