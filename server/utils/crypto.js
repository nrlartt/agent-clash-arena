// ═══════════════════════════════════════════════════════════════
// CRYPTO UTILS — Shared cryptographic utilities
// ═══════════════════════════════════════════════════════════════

const crypto = require('crypto');

/**
 * Timing-safe string comparison to prevent timing attacks.
 * @param {string} a 
 * @param {string} b 
 * @returns {boolean}
 */
function safeEqual(a, b) {
    const aBuf = Buffer.from(String(a || ''), 'utf8');
    const bBuf = Buffer.from(String(b || ''), 'utf8');
    if (aBuf.length !== bBuf.length) return false;
    return crypto.timingSafeEqual(aBuf, bBuf);
}

module.exports = { safeEqual };
