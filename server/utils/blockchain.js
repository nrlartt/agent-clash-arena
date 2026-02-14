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

const TX_TIMEOUT = 15000;  // 15 seconds max for any blockchain operation

class BlockchainService {
    constructor() {
        this.provider = null;
        this.wallet = null;
        this.contract = null;
        this.enabled = false;

        this._init();
    }

    _init() {
        const rpcUrl = process.env.VITE_MONAD_RPC_URL || process.env.MONAD_RPC_URL || 'https://testnet-rpc.monad.xyz';
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
        if (!this.enabled) {
            logger.debug('[Blockchain] Skipping createMatch (disabled)');
            return null;
        }

        try {
            const matchBytes = this._toBytes32(matchId);
            const tx = await withTimeout(
                this.contract.createMatch(matchBytes, agent1Name, agent2Name, { gasLimit: 300000 }),
                TX_TIMEOUT, 'createMatch.send'
            );
            const receipt = await withTimeout(tx.wait(), TX_TIMEOUT, 'createMatch.wait');
            logger.info('[Blockchain] Match created on-chain', {
                matchId,
                txHash: receipt.hash,
                block: receipt.blockNumber,
            });
            return receipt.hash;
        } catch (err) {
            logger.error('[Blockchain] createMatch failed', {
                matchId,
                error: err.message,
            });
            return null;
        }
    }

    /**
     * Lock betting on a match (called when fight begins)
     */
    async lockMatchOnChain(matchId) {
        if (!this.enabled) return null;

        try {
            const matchBytes = this._toBytes32(matchId);
            const tx = await withTimeout(this.contract.lockMatch(matchBytes, { gasLimit: 100000 }), TX_TIMEOUT, 'lockMatch.send');
            const receipt = await withTimeout(tx.wait(), TX_TIMEOUT, 'lockMatch.wait');
            logger.info('[Blockchain] Match locked on-chain', { matchId, txHash: receipt.hash });
            return receipt.hash;
        } catch (err) {
            logger.error('[Blockchain] lockMatch failed', { matchId, error: err.message });
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
                TX_TIMEOUT, 'resolveMatch.send'
            );
            const receipt = await withTimeout(tx.wait(), TX_TIMEOUT, 'resolveMatch.wait');
            logger.info('[Blockchain] Match resolved on-chain', {
                matchId,
                winnerId,
                winningSide: winningSide === Side.AgentA ? 'AgentA' : 'AgentB',
                txHash: receipt.hash,
            });
            return receipt.hash;
        } catch (err) {
            logger.error('[Blockchain] resolveMatch failed', { matchId, error: err.message });
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
}

module.exports = new BlockchainService();
