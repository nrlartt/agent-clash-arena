// ═══════════════════════════════════════════════════════════════
// BLOCKCHAIN — On-chain interaction utilities for Monad
// Handles: Match creation, resolution, reward distribution
// ═══════════════════════════════════════════════════════════════

const { ethers } = require('ethers');
const logger = require('./logger');

// Contract ABI (operator functions only)
const BETTING_ABI = [
    "function createMatch(bytes32 _matchId, string calldata _agentAName, string calldata _agentBName) external",
    "function lockMatch(bytes32 _matchId) external",
    "function resolveMatch(bytes32 _matchId, uint8 _winningSide) external",
    "function cancelMatch(bytes32 _matchId) external",
    "function getMatch(bytes32 _matchId) external view returns (tuple(bytes32 matchId, string agentAName, string agentBName, uint8 status, uint8 winningSide, uint256 poolA, uint256 poolB, uint256 totalPool, uint256 createdAt, uint256 resolvedAt))",
    "function totalMatches() external view returns (uint256)",
    "function totalVolume() external view returns (uint256)",
];

const Side = { None: 0, AgentA: 1, AgentB: 2 };

// Helper: race a promise against a timeout
function withTimeout(promise, ms, label) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms))
    ]);
}

const TX_SEND_TIMEOUT = Number.parseInt(process.env.CHAIN_TX_SEND_TIMEOUT_MS || '30000', 10);
const TX_WAIT_TIMEOUT = Number.parseInt(process.env.CHAIN_TX_WAIT_TIMEOUT_MS || '180000', 10);

class BlockchainService {
    constructor() {
        this.provider = null;
        this.wallet = null;
        this.contract = null;
        this.enabled = false;
        this.lastError = null;
        this.lastErrorAt = null;
        this.lastErrorOp = null;

        this._init();
    }

    _normalizeError(err) {
        const raw = String(err?.shortMessage || err?.reason || err?.message || err || 'Unknown blockchain error');
        const lowered = raw.toLowerCase();
        if (lowered.includes('insufficient funds')) {
            return { code: 'INSUFFICIENT_FUNDS', message: raw };
        }
        if (lowered.includes('only operator') || lowered.includes('unauthorized')) {
            return { code: 'UNAUTHORIZED_OPERATOR', message: raw };
        }
        if (lowered.includes('match already exists')) {
            return { code: 'MATCH_EXISTS', message: raw };
        }
        if (lowered.includes('network') || lowered.includes('timeout') || lowered.includes('timed out')) {
            return { code: 'NETWORK_TIMEOUT', message: raw };
        }
        if (lowered.includes('execution reverted')) {
            return { code: 'EVM_REVERT', message: raw };
        }
        return { code: 'CHAIN_ERROR', message: raw };
    }

    _setLastError(op, err) {
        const normalized = this._normalizeError(err);
        this.lastError = normalized.message;
        this.lastErrorAt = Date.now();
        this.lastErrorOp = op;
        return normalized;
    }

    _init() {
        const rpcUrl = process.env.VITE_MONAD_RPC_URL || process.env.MONAD_RPC_URL || 'https://rpc.monad.xyz';
        const privateKey = process.env.OPERATOR_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY;
        const contractAddress = process.env.BETTING_CONTRACT_ADDRESS || process.env.VITE_BETTING_CONTRACT_ADDRESS;

        if (!privateKey || !contractAddress) {
            logger.info('[Blockchain] No operator key or contract address configured. On-chain features disabled.');
            return;
        }

        try {
            this.provider = new ethers.JsonRpcProvider(rpcUrl);
            this.wallet = new ethers.Wallet(privateKey, this.provider);
            this.contract = new ethers.Contract(contractAddress, BETTING_ABI, this.wallet);
            this.enabled = true;
            logger.info('[Blockchain] On-chain service initialized', {
                operator: this.wallet.address,
                contract: contractAddress,
                rpc: rpcUrl,
            });
        } catch (err) {
            logger.error('[Blockchain] Init failed', { error: err.message });
        }
    }

    /**
     * Convert match ID string to bytes32
     */
    _toBytes32(matchId) {
        // Pad/truncate to 31 chars max (bytes32 = 32 bytes, ethers uses 1 for length)
        const str = matchId.slice(0, 31);
        return ethers.encodeBytes32String(str);
    }

    /**
     * Create a match on-chain (called when a new match starts)
     */
    async createMatchOnChain(matchId, agent1Name, agent2Name) {
        const result = await this.createMatchOnChainWithResult(matchId, agent1Name, agent2Name);
        return result.ok ? result.txHash : null;
    }

    async createMatchOnChainWithResult(matchId, agent1Name, agent2Name) {
        if (!this.enabled) {
            logger.debug('[Blockchain] Skipping createMatch (disabled)');
            return { ok: false, errorCode: 'DISABLED', errorMessage: 'Blockchain service is disabled (missing key or contract)' };
        }

        try {
            const matchBytes = this._toBytes32(matchId);
            const tx = await withTimeout(
                this.contract.createMatch(matchBytes, agent1Name, agent2Name, { gasLimit: 300000 }),
                TX_SEND_TIMEOUT, 'createMatch.send'
            );
            const receipt = await withTimeout(tx.wait(), TX_WAIT_TIMEOUT, 'createMatch.wait');
            logger.info('[Blockchain] Match created on-chain', {
                matchId,
                txHash: receipt.hash,
                block: receipt.blockNumber,
            });
            this.lastError = null;
            this.lastErrorAt = null;
            this.lastErrorOp = null;
            return { ok: true, txHash: receipt.hash, blockNumber: receipt.blockNumber };
        } catch (err) {
            const normalized = this._setLastError('createMatch', err);
            logger.error('[Blockchain] createMatch failed', {
                matchId,
                error: normalized.message,
                code: normalized.code,
            });
            return { ok: false, errorCode: normalized.code, errorMessage: normalized.message };
        }
    }

    /**
     * Lock betting on a match (called when fight begins)
     */
    async lockMatchOnChain(matchId) {
        if (!this.enabled) return null;

        try {
            const matchBytes = this._toBytes32(matchId);
            const tx = await withTimeout(this.contract.lockMatch(matchBytes, { gasLimit: 100000 }), TX_SEND_TIMEOUT, 'lockMatch.send');
            const receipt = await withTimeout(tx.wait(), TX_WAIT_TIMEOUT, 'lockMatch.wait');
            logger.info('[Blockchain] Match locked on-chain', { matchId, txHash: receipt.hash });
            this.lastError = null;
            this.lastErrorAt = null;
            this.lastErrorOp = null;
            return receipt.hash;
        } catch (err) {
            const normalized = this._setLastError('lockMatch', err);
            logger.error('[Blockchain] lockMatch failed', { matchId, error: normalized.message, code: normalized.code });
            return null;
        }
    }

    /**
     * Resolve a match on-chain (called when fight ends)
     * @param {string} matchId 
     * @param {string} winnerId - The winning agent ID
     * @param {string} agent1Id - ID of agent in slot 1 (AgentA)
     */
    async resolveMatchOnChain(matchId, winnerId, agent1Id) {
        if (!this.enabled) return null;

        try {
            const matchBytes = this._toBytes32(matchId);
            const winningSide = winnerId === agent1Id ? Side.AgentA : Side.AgentB;

            const tx = await withTimeout(
                this.contract.resolveMatch(matchBytes, winningSide, { gasLimit: 200000 }),
                TX_SEND_TIMEOUT, 'resolveMatch.send'
            );
            const receipt = await withTimeout(tx.wait(), TX_WAIT_TIMEOUT, 'resolveMatch.wait');
            logger.info('[Blockchain] Match resolved on-chain', {
                matchId,
                winnerId,
                winningSide: winningSide === Side.AgentA ? 'AgentA' : 'AgentB',
                txHash: receipt.hash,
            });
            this.lastError = null;
            this.lastErrorAt = null;
            this.lastErrorOp = null;
            return receipt.hash;
        } catch (err) {
            const normalized = this._setLastError('resolveMatch', err);
            logger.error('[Blockchain] resolveMatch failed', { matchId, error: normalized.message, code: normalized.code });
            return null;
        }
    }

    /**
     * Cancel a match on-chain
     */
    async cancelMatchOnChain(matchId) {
        if (!this.enabled) return null;

        try {
            const matchBytes = this._toBytes32(matchId);
            const tx = await this.contract.cancelMatch(matchBytes, { gasLimit: 100000 });
            const receipt = await tx.wait();
            logger.info('[Blockchain] Match cancelled on-chain', { matchId, txHash: receipt.hash });
            return receipt.hash;
        } catch (err) {
            logger.error('[Blockchain] cancelMatch failed', { matchId, error: err.message });
            return null;
        }
    }

    /**
     * Send MON reward directly to a wallet address
     */
    async sendReward(toAddress, amountMON) {
        if (!this.enabled) return null;

        try {
            const tx = await this.wallet.sendTransaction({
                to: toAddress,
                value: ethers.parseEther(String(amountMON)),
                gasLimit: 21000,
            });
            const receipt = await tx.wait();
            logger.info('[Blockchain] Reward sent', {
                to: toAddress,
                amount: `${amountMON} MON`,
                txHash: receipt.hash,
            });
            return receipt.hash;
        } catch (err) {
            logger.error('[Blockchain] sendReward failed', {
                to: toAddress,
                amount: amountMON,
                error: err.message,
            });
            return null;
        }
    }

    /**
     * Get operator wallet balance
     */
    async getOperatorBalance() {
        if (!this.enabled) return '0';
        try {
            const balance = await this.provider.getBalance(this.wallet.address);
            return ethers.formatEther(balance);
        } catch {
            return '0';
        }
    }

    async getRuntimeStatus() {
        const base = {
            enabled: this.enabled,
            walletAddress: this.wallet?.address || null,
            contractAddress: this.contract?.target || null,
            lastError: this.lastError || null,
            lastErrorAt: this.lastErrorAt || null,
            lastErrorOp: this.lastErrorOp || null,
        };

        if (!this.enabled) return base;

        let operatorBalance = null;
        let owner = null;
        let operator = null;
        let signerIsOwner = null;
        let signerIsOperator = null;

        try {
            operatorBalance = await this.getOperatorBalance();
        } catch {
            operatorBalance = null;
        }

        try {
            owner = await this.contract.owner();
        } catch {
            owner = null;
        }
        try {
            operator = await this.contract.operator();
        } catch {
            operator = null;
        }

        if (owner && this.wallet?.address) {
            signerIsOwner = owner.toLowerCase() === this.wallet.address.toLowerCase();
        }
        if (operator && this.wallet?.address) {
            signerIsOperator = operator.toLowerCase() === this.wallet.address.toLowerCase();
        }

        return {
            ...base,
            owner,
            operator,
            operatorBalance,
            signerIsOwner,
            signerIsOperator,
        };
    }
}

module.exports = new BlockchainService();
