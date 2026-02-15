// ═══════════════════════════════════════════════════════════════
// CONTRACT SERVICE — AgentClashBetting Smart Contract Integration
// Handles: placing bets, claiming winnings, reading match data
// ═══════════════════════════════════════════════════════════════

import { ethers } from 'ethers';

// Contract ABI (only the functions we need on frontend)
const BETTING_ABI = [
    // Write functions
    "function placeBet(bytes32 _matchId, uint8 _side) external payable",
    "function claimWinnings(bytes32 _matchId) external",
    "function claimRefund(bytes32 _matchId) external",
    
    // Read functions
    "function getMatch(bytes32 _matchId) external view returns (tuple(bytes32 matchId, string agentAName, string agentBName, uint8 status, uint8 winningSide, uint256 poolA, uint256 poolB, uint256 totalPool, uint256 createdAt, uint256 resolvedAt))",
    "function getUserBet(bytes32 _matchId, address _user) external view returns (tuple(address bettor, bytes32 matchId, uint8 side, uint256 amount, bool claimed))",
    "function getOdds(bytes32 _matchId) external view returns (uint256 oddsA, uint256 oddsB)",
    "function minBet() external view returns (uint256)",
    "function maxBet() external view returns (uint256)",
    "function totalMatches() external view returns (uint256)",
    "function totalBetsPlaced() external view returns (uint256)",
    "function totalVolume() external view returns (uint256)",
    
    // Events
    "event BetPlaced(bytes32 indexed matchId, address indexed bettor, uint8 side, uint256 amount)",
    "event MatchResolved(bytes32 indexed matchId, uint8 winningSide, uint256 totalPool)",
    "event WinningsClaimed(bytes32 indexed matchId, address indexed bettor, uint256 payout)",
];

// Side enum matching the contract
export const BetSide = {
    None: 0,
    AgentA: 1,  // Red corner
    AgentB: 2,  // Blue corner
};

// Match status enum
export const MatchStatus = {
    Open: 0,
    Locked: 1,
    Resolved: 2,
    Cancelled: 3,
};

const STATUS_LABELS = ['Open', 'Locked', 'Resolved', 'Cancelled'];

class ContractService {
    constructor() {
        this.contractAddress = import.meta.env.VITE_BETTING_CONTRACT_ADDRESS || null;
        this.contract = null;
        this.readContract = null; // Read-only contract (via RPC, no signer needed)
        this.provider = null;
        this.signer = null;
    }

    get isConfigured() {
        return !!this.contractAddress;
    }

    /**
     * Initialize the contract with the user's connected wallet
     */
    async init(walletProvider) {
        if (!this.contractAddress) {
            console.warn('[Contract] No contract address configured. On-chain betting disabled.');
            return false;
        }

        try {
            this.provider = walletProvider;
            this.signer = await walletProvider.getSigner();
            this.contract = new ethers.Contract(
                this.contractAddress,
                BETTING_ABI,
                this.signer
            );
            // Also create a read-only contract via default RPC for pre-flight checks
            const rpcUrl = import.meta.env.VITE_MONAD_RPC_URL || 'https://rpc.monad.xyz';
            const rpcProvider = new ethers.JsonRpcProvider(rpcUrl);
            this.readContract = new ethers.Contract(this.contractAddress, BETTING_ABI, rpcProvider);
            console.log('[Contract] Initialized at', this.contractAddress);
            return true;
        } catch (err) {
            console.error('[Contract] Init failed:', err);
            return false;
        }
    }

    /**
     * Convert a match ID string to bytes32
     */
    matchIdToBytes32(matchId) {
        return ethers.encodeBytes32String(matchId.slice(0, 31));
    }

    /**
     * Pre-flight: check match status on-chain before placing a bet.
     * Returns { ok, status, reason } where ok means betting is allowed.
     */
    async checkMatchStatus(matchId, userAddress) {
        const reader = this.readContract || this.contract;
        if (!reader) return { ok: false, reason: 'Contract not initialized' };

        try {
            const matchBytes = this.matchIdToBytes32(matchId);
            const m = await reader.getMatch(matchBytes);
            const status = Number(m.status);
            const createdAt = Number(m.createdAt);

            if (createdAt === 0) {
                return { ok: false, status: -1, reason: `Match "${matchId}" does not exist on-chain. The match may not have been registered yet.` };
            }
            if (status !== MatchStatus.Open) {
                return { ok: false, status, reason: `Match is ${STATUS_LABELS[status] || 'unknown'} (not Open). Betting is closed.` };
            }

            // Check if user already bet
            if (userAddress) {
                try {
                    const bet = await reader.getUserBet(matchBytes, userAddress);
                    if (Number(bet.amount) > 0) {
                        return { ok: false, status, reason: 'You have already placed a bet on this match.' };
                    }
                } catch {
                    // getUserBet reverts with "No bet found" if user hasn't bet — that's fine
                }
            }

            return { ok: true, status, poolA: ethers.formatEther(m.poolA), poolB: ethers.formatEther(m.poolB) };
        } catch (err) {
            console.warn('[Contract] checkMatchStatus failed:', err.message);
            // Don't block — let the actual placeBet handle errors
            return { ok: true, reason: 'Could not verify match on-chain (proceeding anyway)' };
        }
    }

    /**
     * Place a bet on-chain
     * @param {string} matchId - Match identifier
     * @param {number} side - BetSide.AgentA or BetSide.AgentB
     * @param {string} amountMON - Amount in MON (e.g. "10.5")
     * @returns {object} Transaction receipt
     */
    async placeBet(matchId, side, amountMON) {
        if (!this.contract) throw new Error('Contract not initialized');
        
        const matchBytes = this.matchIdToBytes32(matchId);
        const value = ethers.parseEther(amountMON);

        // Estimate gas FIRST — if this fails, the tx would revert on-chain.
        // Do NOT fall back to a hardcoded gasLimit to avoid wasting gas on revert.
        let gasLimit;
        try {
            const estimatedGas = await this.contract.placeBet.estimateGas(matchBytes, side, { value });
            gasLimit = (estimatedGas * 130n) / 100n; // +30% headroom
            console.log('[Contract] Gas estimate for placeBet:', Number(estimatedGas), '→ using', Number(gasLimit));
        } catch (estimateErr) {
            // Gas estimation failed = the tx WILL revert. Surface the reason.
            console.error('[Contract] placeBet gas estimation failed:', estimateErr);
            
            // Try to extract the revert reason
            const reason = estimateErr?.reason 
                || estimateErr?.revert?.args?.[0]
                || estimateErr?.info?.error?.message
                || estimateErr?.error?.message
                || estimateErr?.shortMessage
                || estimateErr?.message
                || 'Unknown reason';
            
            const enrichedError = new Error(`Contract would revert: ${reason}`);
            enrichedError.code = 'CALL_EXCEPTION';
            enrichedError.originalError = estimateErr;
            throw enrichedError;
        }

        const tx = await this.contract.placeBet(matchBytes, side, { value, gasLimit });
        const receipt = await tx.wait();
        return {
            txHash: receipt.hash,
            blockNumber: receipt.blockNumber,
        };
    }

    /**
     * Claim winnings after match resolution
     */
    async claimWinnings(matchId) {
        if (!this.contract) throw new Error('Contract not initialized');
        
        const matchBytes = this.matchIdToBytes32(matchId);
        
        // Estimate gas first
        let gasLimit;
        try {
            const est = await this.contract.claimWinnings.estimateGas(matchBytes);
            gasLimit = (est * 130n) / 100n;
        } catch (err) {
            throw new Error(`Cannot claim winnings: ${err.reason || err.message}`);
        }
        
        const tx = await this.contract.claimWinnings(matchBytes, { gasLimit });
        const receipt = await tx.wait();
        return { txHash: receipt.hash };
    }

    /**
     * Claim refund for a cancelled match
     */
    async claimRefund(matchId) {
        if (!this.contract) throw new Error('Contract not initialized');
        
        const matchBytes = this.matchIdToBytes32(matchId);
        
        let gasLimit;
        try {
            const est = await this.contract.claimRefund.estimateGas(matchBytes);
            gasLimit = (est * 130n) / 100n;
        } catch (err) {
            throw new Error(`Cannot claim refund: ${err.reason || err.message}`);
        }
        
        const tx = await this.contract.claimRefund(matchBytes, { gasLimit });
        const receipt = await tx.wait();
        return { txHash: receipt.hash };
    }

    /**
     * Get match details from the contract
     */
    async getMatchDetails(matchId) {
        const reader = this.readContract || this.contract;
        if (!reader) return null;
        
        try {
            const matchBytes = this.matchIdToBytes32(matchId);
            const match = await reader.getMatch(matchBytes);
            return {
                agentAName: match.agentAName,
                agentBName: match.agentBName,
                status: Number(match.status),
                statusLabel: STATUS_LABELS[Number(match.status)] || 'Unknown',
                winningSide: Number(match.winningSide),
                poolA: ethers.formatEther(match.poolA),
                poolB: ethers.formatEther(match.poolB),
                totalPool: ethers.formatEther(match.totalPool),
                createdAt: Number(match.createdAt),
            };
        } catch {
            return null;
        }
    }

    /**
     * Get current odds for a match
     */
    async getOdds(matchId) {
        const reader = this.readContract || this.contract;
        if (!reader) return { oddsA: 2.0, oddsB: 2.0 };
        
        try {
            const matchBytes = this.matchIdToBytes32(matchId);
            const [oddsA, oddsB] = await reader.getOdds(matchBytes);
            return {
                oddsA: Number(oddsA) / 10000,
                oddsB: Number(oddsB) / 10000,
            };
        } catch {
            return { oddsA: 2.0, oddsB: 2.0 };
        }
    }

    /**
     * Get the user's bet on a match
     */
    async getUserBet(matchId, userAddress) {
        const reader = this.readContract || this.contract;
        if (!reader) return null;
        
        try {
            const matchBytes = this.matchIdToBytes32(matchId);
            const bet = await reader.getUserBet(matchBytes, userAddress);
            return {
                side: Number(bet.side),
                amount: ethers.formatEther(bet.amount),
                claimed: bet.claimed,
            };
        } catch {
            return null;
        }
    }

    /**
     * Get platform stats from contract
     */
    async getPlatformStats() {
        const reader = this.readContract || this.contract;
        if (!reader) return null;
        
        try {
            const [totalMatches, totalBets, totalVol] = await Promise.all([
                reader.totalMatches(),
                reader.totalBetsPlaced(),
                reader.totalVolume(),
            ]);
            return {
                totalMatches: Number(totalMatches),
                totalBetsPlaced: Number(totalBets),
                totalVolume: ethers.formatEther(totalVol),
            };
        } catch {
            return null;
        }
    }

    /**
     * Get min/max bet limits
     */
    async getBetLimits() {
        const reader = this.readContract || this.contract;
        if (!reader) return { min: '0.01', max: '1000' };
        
        try {
            const [min, max] = await Promise.all([
                reader.minBet(),
                reader.maxBet(),
            ]);
            return {
                min: ethers.formatEther(min),
                max: ethers.formatEther(max),
            };
        } catch {
            return { min: '0.01', max: '1000' };
        }
    }
}

const contractService = new ContractService();
export default contractService;
