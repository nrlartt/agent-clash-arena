// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title AgentClashBetting
 * @notice On-chain betting contract for Agent Clash Arena on Monad
 * @dev Supports native MON token betting on AI agent matches
 * 
 * Flow:
 * 1. Backend creates a match → createMatch(matchId, agentA, agentB)
 * 2. Users place bets → placeBet(matchId, agentSide) with MON attached
 * 3. Backend resolves match → resolveMatch(matchId, winningSide)
 * 4. Winners claim rewards → claimWinnings(matchId)
 */
contract AgentClashBetting {

    // ══════════════════════════════════════════════════════
    // TYPES
    // ══════════════════════════════════════════════════════

    enum MatchStatus { Open, Locked, Resolved, Cancelled }
    enum Side { None, AgentA, AgentB }

    struct MatchInfo {
        bytes32 matchId;
        string agentAName;
        string agentBName;
        MatchStatus status;
        Side winningSide;
        uint256 poolA;          // Total MON bet on Agent A
        uint256 poolB;          // Total MON bet on Agent B
        uint256 totalPool;
        uint256 createdAt;
        uint256 resolvedAt;
    }

    struct BetInfo {
        address bettor;
        bytes32 matchId;
        Side side;
        uint256 amount;
        bool claimed;
    }

    // ══════════════════════════════════════════════════════
    // STATE
    // ══════════════════════════════════════════════════════

    address public owner;
    address public operator;   // Backend server address (can create/resolve matches)
    
    uint256 public platformFeePercent = 3; // 3% platform fee on winnings
    uint256 public minBet = 0.01 ether;    // Minimum bet: 0.01 MON
    uint256 public maxBet = 1000 ether;    // Maximum bet: 1000 MON
    
    uint256 public totalMatches;
    uint256 public totalBetsPlaced;
    uint256 public totalVolume;
    uint256 public platformEarnings;

    mapping(bytes32 => MatchInfo) public matches;
    mapping(bytes32 => BetInfo[]) public matchBets;
    mapping(bytes32 => mapping(address => uint256)) public userBetIndex; // matchId => user => betIndex+1
    
    bytes32[] public matchIds;

    // ══════════════════════════════════════════════════════
    // EVENTS
    // ══════════════════════════════════════════════════════

    event MatchCreated(bytes32 indexed matchId, string agentA, string agentB, uint256 timestamp);
    event BetPlaced(bytes32 indexed matchId, address indexed bettor, Side side, uint256 amount);
    event MatchLocked(bytes32 indexed matchId);
    event MatchResolved(bytes32 indexed matchId, Side winningSide, uint256 totalPool);
    event MatchCancelled(bytes32 indexed matchId);
    event WinningsClaimed(bytes32 indexed matchId, address indexed bettor, uint256 payout);
    event RefundClaimed(bytes32 indexed matchId, address indexed bettor, uint256 amount);
    event PlatformFeeWithdrawn(address indexed to, uint256 amount);

    // ══════════════════════════════════════════════════════
    // MODIFIERS
    // ══════════════════════════════════════════════════════

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    modifier onlyOperator() {
        require(msg.sender == operator || msg.sender == owner, "Only operator");
        _;
    }

    // ══════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ══════════════════════════════════════════════════════

    constructor(address _operator) {
        owner = msg.sender;
        operator = _operator;
    }

    // ══════════════════════════════════════════════════════
    // MATCH MANAGEMENT (Operator/Backend only)
    // ══════════════════════════════════════════════════════

    /**
     * @notice Create a new match for betting
     * @param _matchId Unique match identifier (from backend)
     * @param _agentAName Name of Agent A (Red corner)
     * @param _agentBName Name of Agent B (Blue corner)
     */
    function createMatch(
        bytes32 _matchId,
        string calldata _agentAName,
        string calldata _agentBName
    ) external onlyOperator {
        require(matches[_matchId].createdAt == 0, "Match already exists");
        
        matches[_matchId] = MatchInfo({
            matchId: _matchId,
            agentAName: _agentAName,
            agentBName: _agentBName,
            status: MatchStatus.Open,
            winningSide: Side.None,
            poolA: 0,
            poolB: 0,
            totalPool: 0,
            createdAt: block.timestamp,
            resolvedAt: 0
        });
        
        matchIds.push(_matchId);
        totalMatches++;
        
        emit MatchCreated(_matchId, _agentAName, _agentBName, block.timestamp);
    }

    /**
     * @notice Lock a match (no more bets accepted) — called when fight starts
     */
    function lockMatch(bytes32 _matchId) external onlyOperator {
        MatchInfo storage m = matches[_matchId];
        require(m.createdAt > 0, "Match does not exist");
        require(m.status == MatchStatus.Open, "Match not open");
        
        m.status = MatchStatus.Locked;
        emit MatchLocked(_matchId);
    }

    /**
     * @notice Resolve a match with the winning side
     */
    function resolveMatch(bytes32 _matchId, Side _winningSide) external onlyOperator {
        MatchInfo storage m = matches[_matchId];
        require(m.createdAt > 0, "Match does not exist");
        require(m.status == MatchStatus.Open || m.status == MatchStatus.Locked, "Cannot resolve");
        require(_winningSide == Side.AgentA || _winningSide == Side.AgentB, "Invalid side");
        
        m.status = MatchStatus.Resolved;
        m.winningSide = _winningSide;
        m.resolvedAt = block.timestamp;
        
        // Calculate platform fee
        uint256 fee = (m.totalPool * platformFeePercent) / 100;
        platformEarnings += fee;
        
        emit MatchResolved(_matchId, _winningSide, m.totalPool);
    }

    /**
     * @notice Cancel a match and allow all bettors to reclaim funds
     */
    function cancelMatch(bytes32 _matchId) external onlyOperator {
        MatchInfo storage m = matches[_matchId];
        require(m.createdAt > 0, "Match does not exist");
        require(m.status != MatchStatus.Resolved, "Already resolved");
        
        m.status = MatchStatus.Cancelled;
        emit MatchCancelled(_matchId);
    }

    // ══════════════════════════════════════════════════════
    // USER FUNCTIONS
    // ══════════════════════════════════════════════════════

    /**
     * @notice Place a bet on a match
     * @param _matchId The match to bet on
     * @param _side Which agent to bet on (AgentA or AgentB)
     */
    function placeBet(bytes32 _matchId, Side _side) external payable {
        MatchInfo storage m = matches[_matchId];
        require(m.createdAt > 0, "Match does not exist");
        require(m.status == MatchStatus.Open, "Betting closed");
        require(_side == Side.AgentA || _side == Side.AgentB, "Invalid side");
        require(msg.value >= minBet, "Below minimum bet");
        require(msg.value <= maxBet, "Above maximum bet");
        require(userBetIndex[_matchId][msg.sender] == 0, "Already bet on this match");
        
        // Record the bet
        matchBets[_matchId].push(BetInfo({
            bettor: msg.sender,
            matchId: _matchId,
            side: _side,
            amount: msg.value,
            claimed: false
        }));
        userBetIndex[_matchId][msg.sender] = matchBets[_matchId].length; // 1-indexed
        
        // Update pools
        if (_side == Side.AgentA) {
            m.poolA += msg.value;
        } else {
            m.poolB += msg.value;
        }
        m.totalPool += msg.value;
        
        totalBetsPlaced++;
        totalVolume += msg.value;
        
        emit BetPlaced(_matchId, msg.sender, _side, msg.value);
    }

    /**
     * @notice Claim winnings after a match is resolved
     */
    function claimWinnings(bytes32 _matchId) external {
        MatchInfo storage m = matches[_matchId];
        require(m.status == MatchStatus.Resolved, "Match not resolved");
        
        uint256 betIdx = userBetIndex[_matchId][msg.sender];
        require(betIdx > 0, "No bet found");
        
        BetInfo storage bet = matchBets[_matchId][betIdx - 1];
        require(!bet.claimed, "Already claimed");
        require(bet.side == m.winningSide, "You did not win");
        
        bet.claimed = true;
        
        // Calculate payout: (userBet / winnerPool) * totalPool * (1 - fee)
        uint256 winnerPool = m.winningSide == Side.AgentA ? m.poolA : m.poolB;
        uint256 netPool = m.totalPool - (m.totalPool * platformFeePercent / 100);
        uint256 payout = (bet.amount * netPool) / winnerPool;
        
        require(payout > 0, "No payout");
        
        (bool success, ) = payable(msg.sender).call{value: payout}("");
        require(success, "Transfer failed");
        
        emit WinningsClaimed(_matchId, msg.sender, payout);
    }

    /**
     * @notice Claim refund if match was cancelled
     */
    function claimRefund(bytes32 _matchId) external {
        MatchInfo storage m = matches[_matchId];
        require(m.status == MatchStatus.Cancelled, "Match not cancelled");
        
        uint256 betIdx = userBetIndex[_matchId][msg.sender];
        require(betIdx > 0, "No bet found");
        
        BetInfo storage bet = matchBets[_matchId][betIdx - 1];
        require(!bet.claimed, "Already refunded");
        
        bet.claimed = true;
        
        (bool success, ) = payable(msg.sender).call{value: bet.amount}("");
        require(success, "Refund transfer failed");
        
        emit RefundClaimed(_matchId, msg.sender, bet.amount);
    }

    // ══════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ══════════════════════════════════════════════════════

    function getMatch(bytes32 _matchId) external view returns (MatchInfo memory) {
        return matches[_matchId];
    }

    function getMatchBets(bytes32 _matchId) external view returns (BetInfo[] memory) {
        return matchBets[_matchId];
    }

    function getUserBet(bytes32 _matchId, address _user) external view returns (BetInfo memory) {
        uint256 idx = userBetIndex[_matchId][_user];
        require(idx > 0, "No bet found");
        return matchBets[_matchId][idx - 1];
    }

    function getOdds(bytes32 _matchId) external view returns (uint256 oddsA, uint256 oddsB) {
        MatchInfo storage m = matches[_matchId];
        if (m.totalPool == 0) return (100, 100);
        // Return as percentages (multiplied by 100 for precision)
        oddsA = m.poolA > 0 ? (m.totalPool * 10000) / m.poolA : 0;
        oddsB = m.poolB > 0 ? (m.totalPool * 10000) / m.poolB : 0;
    }

    function getRecentMatchIds(uint256 _count) external view returns (bytes32[] memory) {
        uint256 len = matchIds.length;
        uint256 count = _count > len ? len : _count;
        bytes32[] memory result = new bytes32[](count);
        for (uint256 i = 0; i < count; i++) {
            result[i] = matchIds[len - 1 - i];
        }
        return result;
    }

    // ══════════════════════════════════════════════════════
    // ADMIN FUNCTIONS
    // ══════════════════════════════════════════════════════

    function setOperator(address _operator) external onlyOwner {
        operator = _operator;
    }

    function setPlatformFee(uint256 _feePercent) external onlyOwner {
        require(_feePercent <= 10, "Fee too high"); // Max 10%
        platformFeePercent = _feePercent;
    }

    function setBetLimits(uint256 _min, uint256 _max) external onlyOwner {
        require(_min < _max, "Invalid limits");
        minBet = _min;
        maxBet = _max;
    }

    function withdrawFees(address _to) external onlyOwner {
        require(platformEarnings > 0, "No fees to withdraw");
        uint256 amount = platformEarnings;
        platformEarnings = 0;
        (bool success, ) = payable(_to).call{value: amount}("");
        require(success, "Withdraw failed");
        emit PlatformFeeWithdrawn(_to, amount);
    }

    function transferOwnership(address _newOwner) external onlyOwner {
        require(_newOwner != address(0), "Zero address");
        owner = _newOwner;
    }

    // Emergency withdraw — only if contract needs to be deprecated
    function emergencyWithdraw() external onlyOwner {
        (bool success, ) = payable(owner).call{value: address(this).balance}("");
        require(success, "Emergency withdraw failed");
    }

    receive() external payable {}
}
