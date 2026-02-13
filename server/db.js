// ═══════════════════════════════════════════════════════════════
// DB — Dual-mode database: MongoDB (production) + JSON file (dev fallback)
// Exports the same interface regardless of which backend is used
// ═══════════════════════════════════════════════════════════════

const MONGODB_URI = process.env.MONGODB_URI;

// Decide which backend to use
if (MONGODB_URI) {
    module.exports = require('./db-mongo');
} else {
    module.exports = require('./db-json');
}
