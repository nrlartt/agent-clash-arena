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

class ContractService {
    constructor() {
        this.contractAddress = import.meta.env.VITE_BETTING_CONTRACT_ADDRESS || null;
        this.contract = null;
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
        
        const tx = await this.contract.placeBet(matchBytes, side, {
            value,
            gasLimit: 200000,
        });
        
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
        const tx = await this.contract.claimWinnings(matchBytes, { gasLimit: 150000 });
        const receipt = await tx.wait();
        return { txHash: receipt.hash };
    }

    /**
     * Claim refund for a cancelled match
     */
    async claimRefund(matchId) {
        if (!this.contract) throw new Error('Contract not initialized');
        
        const matchBytes = this.matchIdToBytes32(matchId);
        const tx = await this.contract.claimRefund(matchBytes, { gasLimit: 150000 });
        const receipt = await tx.wait();
        return { txHash: receipt.hash };
    }

    /**
     * Get match details from the contract
     */
    async getMatchDetails(matchId) {
        if (!this.contract) return null;
        
        try {
            const matchBytes = this.matchIdToBytes32(matchId);
            const match = await this.contract.getMatch(matchBytes);
            return {
                agentAName: match.agentAName,
                agentBName: match.agentBName,
                status: Number(match.status),
                winningSide: Number(match.winningSide),
                poolA: ethers.formatEther(match.poolA),
                poolB: ethers.formatEther(match.poolB),
                totalPool: ethers.formatEther(match.totalPool),
            };
        } catch {
            return null;
        }
    }

    /**
     * Get current odds for a match
     */
    async getOdds(matchId) {
        if (!this.contract) return { oddsA: 2.0, oddsB: 2.0 };
        
        try {
            const matchBytes = this.matchIdToBytes32(matchId);
            const [oddsA, oddsB] = await this.contract.getOdds(matchBytes);
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
        if (!this.contract) return null;
        
        try {
            const matchBytes = this.matchIdToBytes32(matchId);
            const bet = await this.contract.getUserBet(matchBytes, userAddress);
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
        if (!this.contract) return null;
        
        try {
            const [totalMatches, totalBets, totalVol] = await Promise.all([
                this.contract.totalMatches(),
                this.contract.totalBetsPlaced(),
                this.contract.totalVolume(),
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
        if (!this.contract) return { min: '0.01', max: '1000' };
        
        try {
            const [min, max] = await Promise.all([
                this.contract.minBet(),
                this.contract.maxBet(),
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

export const contractService = new ContractService();
