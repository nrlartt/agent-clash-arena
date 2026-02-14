const crypto = require('crypto');
const { ethers } = require('ethers');

const ENCRYPTION_ALGO = 'aes-256-gcm';
const KEY_VERSION = 'aca-wallet-v1';
const EXPORT_VERSION = 'aca-wallet-export-v1';

class AgentWalletError extends Error {
    constructor(message, code = 'agent_wallet_error') {
        super(message);
        this.name = 'AgentWalletError';
        this.code = code;
    }
}

function parseMasterKey() {
    const raw = String(process.env.AGENT_WALLET_ENCRYPTION_KEY || '').trim();
    if (!raw) {
        throw new AgentWalletError(
            'AGENT_WALLET_ENCRYPTION_KEY is not configured',
            'wallet_master_key_missing'
        );
    }

    if (/^[a-fA-F0-9]{64}$/.test(raw)) {
        return Buffer.from(raw, 'hex');
    }

    try {
        const buf = Buffer.from(raw, 'base64');
        if (buf.length === 32) return buf;
    } catch {
        // no-op
    }

    throw new AgentWalletError(
        'AGENT_WALLET_ENCRYPTION_KEY must be 32 bytes in hex(64) or base64',
        'wallet_master_key_invalid'
    );
}

function encodeCiphertext({ version, iv, tag, encrypted }) {
    return [
        version,
        iv.toString('base64'),
        tag.toString('base64'),
        encrypted.toString('base64'),
    ].join('.');
}

function decodeCiphertext(ciphertext, expectedVersion) {
    const parts = String(ciphertext || '').split('.');
    if (parts.length !== 4) {
        throw new AgentWalletError('Invalid encrypted payload format', 'wallet_payload_invalid');
    }

    const [version, ivB64, tagB64, ctB64] = parts;
    if (expectedVersion && version !== expectedVersion) {
        throw new AgentWalletError('Unsupported encrypted payload version', 'wallet_payload_version');
    }

    try {
        return {
            version,
            iv: Buffer.from(ivB64, 'base64'),
            tag: Buffer.from(tagB64, 'base64'),
            encrypted: Buffer.from(ctB64, 'base64'),
        };
    } catch {
        throw new AgentWalletError('Encrypted payload decoding failed', 'wallet_payload_decode');
    }
}

function encryptWithKey(plainText, keyBuffer, version) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ENCRYPTION_ALGO, keyBuffer, iv);
    const encrypted = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return encodeCiphertext({ version, iv, tag, encrypted });
}

function decryptWithKey(ciphertext, keyBuffer, expectedVersion) {
    const parsed = decodeCiphertext(ciphertext, expectedVersion);
    const decipher = crypto.createDecipheriv(ENCRYPTION_ALGO, keyBuffer, parsed.iv);
    decipher.setAuthTag(parsed.tag);
    const decrypted = Buffer.concat([decipher.update(parsed.encrypted), decipher.final()]);
    return decrypted.toString('utf8');
}

function createAgentWalletRecord() {
    const wallet = ethers.Wallet.createRandom();
    const masterKey = parseMasterKey();

    return {
        address: wallet.address,
        encryption: {
            algorithm: ENCRYPTION_ALGO,
            version: KEY_VERSION,
        },
        encryptedPrivateKey: encryptWithKey(wallet.privateKey, masterKey, KEY_VERSION),
        createdAt: new Date().toISOString(),
    };
}

function decryptAgentPrivateKey(agent) {
    if (!agent || !agent.wallet || !agent.wallet.encryptedPrivateKey) {
        throw new AgentWalletError('Agent wallet is not configured', 'wallet_not_configured');
    }

    const masterKey = parseMasterKey();
    return decryptWithKey(agent.wallet.encryptedPrivateKey, masterKey, KEY_VERSION);
}

function exportAgentWalletKeyPackage(agent, secretToken) {
    const token = String(secretToken || '').trim();
    if (token.length < 16) {
        throw new AgentWalletError('Secret token must be at least 16 chars', 'wallet_export_token_short');
    }

    const privateKey = decryptAgentPrivateKey(agent);
    const salt = crypto.randomBytes(16);
    const exportKey = crypto.scryptSync(token, salt, 32);
    const payload = encryptWithKey(privateKey, exportKey, EXPORT_VERSION);

    return {
        format: EXPORT_VERSION,
        encrypted_private_key: payload,
        salt: salt.toString('base64'),
    };
}

function generateOneTimeWalletSecret() {
    return crypto.randomBytes(16).toString('hex');
}

function createSignerForAgent(agent, provider) {
    const privateKey = decryptAgentPrivateKey(agent);
    return new ethers.Wallet(privateKey, provider);
}

module.exports = {
    AgentWalletError,
    createAgentWalletRecord,
    exportAgentWalletKeyPackage,
    generateOneTimeWalletSecret,
    createSignerForAgent,
};

