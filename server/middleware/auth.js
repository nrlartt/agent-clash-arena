// ═══════════════════════════════════════════════════════════════
// AUTH MIDDLEWARE — API Key authentication for agents
// ═══════════════════════════════════════════════════════════════

const db = require('../db');

function authAgent(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
            success: false,
            error: 'Missing or invalid Authorization header',
            hint: 'Use: Authorization: Bearer YOUR_API_KEY',
        });
    }

    const apiKey = authHeader.slice(7).trim();
    const agent = db.getAgentByApiKey(apiKey);

    if (!agent) {
        return res.status(401).json({
            success: false,
            error: 'Invalid API key',
            hint: 'Check your API key or register at POST /api/v1/agents/register',
        });
    }

    if (agent.status === 'suspended') {
        return res.status(403).json({
            success: false,
            error: 'Agent suspended',
            hint: 'Contact support for more information.',
        });
    }

    // Attach agent to request
    req.agent = agent;
    next();
}

// Optional auth — doesn't fail if no key, just sets req.agent if present
function optionalAuth(req, _res, next) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const apiKey = authHeader.slice(7).trim();
        req.agent = db.getAgentByApiKey(apiKey);
    }
    next();
}

module.exports = { authAgent, optionalAuth };
