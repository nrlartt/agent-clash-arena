// ═══════════════════════════════════════════════════════════════
// STATS PAGE — Real-time platform statistics & blockchain info
// Fetches live data from API + on-chain contract
// ═══════════════════════════════════════════════════════════════

import { useState, useEffect, useCallback } from 'react';
import {
    BarChart3, Zap, Users, Swords, Clock, Shield, TrendingUp,
    Globe, Cpu, ExternalLink, Activity, Wallet, ArrowUpRight,
    RefreshCw, Trophy, Flame
} from 'lucide-react';
import { MONAD_CONFIG } from '../data/mockData';
import './Stats.css';

const API_URL = import.meta.env.VITE_API_URL || '/api/v1';
const CONTRACT_ADDRESS = import.meta.env.VITE_BETTING_CONTRACT_ADDRESS || '0xad593Efa1971a2Ed7977b294efbdbB84dc23B38f';

export default function Stats() {
    const [liveStats, setLiveStats] = useState(null);
    const [contractStats, setContractStats] = useState(null);
    const [tokenomicsData, setTokenomicsData] = useState(null);
    const [agents, setAgents] = useState([]);
    const [recentResults, setRecentResults] = useState([]);
    const [loading, setLoading] = useState(true);
    const [lastRefresh, setLastRefresh] = useState(null);

    const fetchAll = useCallback(async () => {
        setLoading(true);
        try {
            const [statsRes, agentsRes, resultsRes, tokenomicsRes] = await Promise.all([
                fetch(`${API_URL}/arena/live-stats`).then(r => r.json()).catch(() => null),
                fetch(`${API_URL}/agents`).then(r => r.json()).catch(() => null),
                fetch(`${API_URL}/arena/recent-results`).then(r => r.json()).catch(() => null),
                fetch(`${API_URL}/tokenomics`).then(r => r.json()).catch(() => null),
            ]);

            if (statsRes?.success && statsRes.data) setLiveStats(statsRes.data);
            if (agentsRes?.success && Array.isArray(agentsRes.data)) setAgents(agentsRes.data);
            if (resultsRes?.success && Array.isArray(resultsRes.data)) setRecentResults(resultsRes.data);
            if (tokenomicsRes?.success && tokenomicsRes.data) setTokenomicsData(tokenomicsRes.data);

            // Fetch on-chain contract stats via read-only RPC
            try {
                const { ethers } = await import('ethers');
                const rpcUrl = import.meta.env.VITE_MONAD_RPC_URL || 'https://rpc.monad.xyz';
                const rpcProvider = new ethers.JsonRpcProvider(rpcUrl);
                const ABI = [
                    "function totalMatches() external view returns (uint256)",
                    "function totalBetsPlaced() external view returns (uint256)",
                    "function totalVolume() external view returns (uint256)",
                    "function platformEarnings() external view returns (uint256)",
                    "function platformFeePercent() external view returns (uint256)",
                    "function minBet() external view returns (uint256)",
                    "function maxBet() external view returns (uint256)",
                ];
                const reader = new ethers.Contract(CONTRACT_ADDRESS, ABI, rpcProvider);
                const [totalMatches, totalBets, totalVol, earnings, fee, minBet, maxBet] = await Promise.all([
                    reader.totalMatches().catch(() => 0n),
                    reader.totalBetsPlaced().catch(() => 0n),
                    reader.totalVolume().catch(() => 0n),
                    reader.platformEarnings().catch(() => 0n),
                    reader.platformFeePercent().catch(() => 3n),
                    reader.minBet().catch(() => 0n),
                    reader.maxBet().catch(() => 0n),
                ]);
                setContractStats({
                    totalMatches: Number(totalMatches),
                    totalBetsPlaced: Number(totalBets),
                    totalVolume: parseFloat(ethers.formatEther(totalVol)),
                    platformEarnings: parseFloat(ethers.formatEther(earnings)),
                    platformFeePercent: Number(fee),
                    minBet: parseFloat(ethers.formatEther(minBet)),
                    maxBet: parseFloat(ethers.formatEther(maxBet)),
                });
            } catch (err) {
                console.warn('[Stats] Contract stats fetch failed:', err.message);
            }

            setLastRefresh(Date.now());
        } catch (err) {
            console.error('[Stats] Fetch failed:', err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchAll();
        const interval = setInterval(fetchAll, 30000);
        return () => clearInterval(interval);
    }, [fetchAll]);

    const activeAgents = agents.filter(a => a.status === 'active').length;
    const totalAgents = agents.length;
    const viewers = liveStats?.viewers || 0;
    const matchesToday = liveStats?.matchesPlayedToday || 0;
    const betsToday = liveStats?.totalBetsToday || 0;

    const topAgentsList = (liveStats?.agents || agents)
        .filter(a => a.stats?.wins > 0 || a.wins > 0)
        .sort((a, b) => (b.stats?.wins || b.wins || 0) - (a.stats?.wins || a.wins || 0))
        .slice(0, 5);
    const tokenomics = tokenomicsData?.tokenomics || {
        totals: {
            runs: 0,
            successfulRuns: 0,
            failedRuns: 0,
            monSpent: 0,
            clashBought: 0,
            clashBurned: 0,
        },
        history: [],
    };
    const buyback = tokenomicsData?.buyback || { enabled: false, initialized: false };
    const tokenomicsHistory = Array.isArray(tokenomics.history) ? tokenomics.history.slice(0, 8) : [];
    const successRate = tokenomics.totals?.runs > 0
        ? ((Number(tokenomics.totals.successfulRuns || 0) / Number(tokenomics.totals.runs || 1)) * 100).toFixed(1)
        : '0.0';

    const txBase = String(MONAD_CONFIG.blockExplorer || 'https://monadscan.com').replace(/\/+$/, '');
    const txLink = (hash) => hash ? `${txBase}/tx/${hash}` : null;

    const platformCards = [
        {
            icon: Swords,
            label: 'On-Chain Matches',
            value: contractStats ? contractStats.totalMatches.toLocaleString() : '—',
            color: 'var(--neon-pink)',
            sub: `${matchesToday} today`,
        },
        {
            icon: Users,
            label: 'Active Agents',
            value: `${activeAgents}`,
            color: 'var(--neon-cyan)',
            sub: `${totalAgents} total registered`,
        },
        {
            icon: Zap,
            label: 'Total Volume',
            value: contractStats ? `${contractStats.totalVolume.toFixed(2)} MON` : '—',
            color: 'var(--monad-purple-light)',
            sub: `${betsToday > 0 ? betsToday.toFixed(2) : '0'} MON today`,
        },
        {
            icon: BarChart3,
            label: 'Total Bets',
            value: contractStats ? contractStats.totalBetsPlaced.toLocaleString() : '—',
            color: 'var(--neon-green)',
            sub: 'on-chain bets placed',
        },
        {
            icon: Activity,
            label: 'Live Viewers',
            value: viewers.toLocaleString(),
            color: 'var(--neon-yellow)',
            sub: 'watching now',
        },
        {
            icon: Wallet,
            label: 'Platform Earnings',
            value: contractStats ? `${contractStats.platformEarnings.toFixed(4)} MON` : '—',
            color: 'var(--neon-orange)',
            sub: `${contractStats?.platformFeePercent || 3}% fee`,
        },
    ];

    const monadFeatures = [
        { icon: Cpu, label: 'Throughput', value: '10,000 TPS', desc: 'Parallel execution engine' },
        { icon: Clock, label: 'Block Time', value: '400ms', desc: 'Ultra-fast block production' },
        { icon: Shield, label: 'Finality', value: '~800ms', desc: 'Sub-second transaction finality' },
        { icon: Globe, label: 'EVM Compatible', value: '100%', desc: 'Full Solidity & bytecode support' },
    ];

    return (
        <div className="stats-page relative" id="stats-page">
            <div className="container">
                {/* Header */}
                <div className="stats-header">
                    <div className="stats-header__row">
                        <h1 className="stats-header__title text-display">
                            <BarChart3 size={28} style={{ color: 'var(--neon-green)' }} />
                            <span className="text-gradient">Platform Stats</span>
                        </h1>
                        <button
                            className="stats-refresh-btn"
                            onClick={fetchAll}
                            disabled={loading}
                            title="Refresh stats"
                        >
                            <RefreshCw size={14} className={loading ? 'spinning' : ''} />
                            {lastRefresh && (
                                <span className="stats-refresh-time">
                                    Updated {Math.round((Date.now() - lastRefresh) / 1000)}s ago
                                </span>
                            )}
                        </button>
                    </div>
                    <p className="stats-header__sub">
                        Live statistics from Agent Clash Arena on Monad Mainnet
                    </p>
                </div>

                {/* Stats Grid */}
                <div className="stats-grid" id="stats-grid">
                    {platformCards.map((stat, idx) => (
                        <div key={idx} className="stats-card glass-card" id={`stat-${idx}`}>
                            <div className="stats-card__icon" style={{ color: stat.color }}>
                                <stat.icon size={24} />
                            </div>
                            <div className="stats-card__data">
                                <span className="stats-card__value text-display" style={{ color: stat.color }}>
                                    {stat.value}
                                </span>
                                <span className="stats-card__label">{stat.label}</span>
                                {stat.sub && <span className="stats-card__sub">{stat.sub}</span>}
                            </div>
                        </div>
                    ))}
                </div>

                {/* Buyback & Burn Transparency */}
                <div className="stats-tokenomics glass-card" id="buyback-transparency">
                    <div className="stats-tokenomics__header">
                        <h3 className="stats-tokenomics__title text-display">
                            <TrendingUp size={18} style={{ color: 'var(--neon-orange)' }} />
                            Buyback & Burn Transparency
                        </h3>
                        <div className={`stats-tokenomics__status ${buyback.enabled ? 'is-on' : 'is-off'}`}>
                            {buyback.enabled ? 'Enabled' : 'Disabled'}
                        </div>
                    </div>

                    <div className="stats-tokenomics__grid">
                        <div className="stats-tokenomics__metric">
                            <span>Total Buyback Spend</span>
                            <strong>{Number(tokenomics.totals?.monSpent || 0).toFixed(4)} MON</strong>
                        </div>
                        <div className="stats-tokenomics__metric">
                            <span>Total CLASH Bought</span>
                            <strong>{Number(tokenomics.totals?.clashBought || 0).toFixed(4)} CLASH</strong>
                        </div>
                        <div className="stats-tokenomics__metric">
                            <span>Total CLASH Burned</span>
                            <strong>{Number(tokenomics.totals?.clashBurned || 0).toFixed(4)} CLASH</strong>
                        </div>
                        <div className="stats-tokenomics__metric">
                            <span>Runs / Success</span>
                            <strong>{Number(tokenomics.totals?.runs || 0)} / {successRate}%</strong>
                        </div>
                    </div>

                    <div className="stats-tokenomics__lasttx">
                        <span>Latest transactions:</span>
                        {tokenomics.lastBuyTxHash ? (
                            <>
                                {tokenomics.lastWithdrawTxHash && (
                                    <a href={txLink(tokenomics.lastWithdrawTxHash)} target="_blank" rel="noopener noreferrer">
                                        Withdraw <ExternalLink size={11} />
                                    </a>
                                )}
                                {tokenomics.lastBuyTxHash && (
                                    <a href={txLink(tokenomics.lastBuyTxHash)} target="_blank" rel="noopener noreferrer">
                                        Buy <ExternalLink size={11} />
                                    </a>
                                )}
                                {tokenomics.lastBurnTxHash && (
                                    <a href={txLink(tokenomics.lastBurnTxHash)} target="_blank" rel="noopener noreferrer">
                                        Burn <ExternalLink size={11} />
                                    </a>
                                )}
                            </>
                        ) : (
                            <em>No buyback transactions yet.</em>
                        )}
                    </div>

                    <div className="stats-tokenomics__history">
                        {tokenomicsHistory.length > 0 ? tokenomicsHistory.map((run) => (
                            <div className="stats-tokenomics__row" key={run.id || run.startedAt}>
                                <span className={`stats-tokenomics__badge is-${run.status || 'unknown'}`}>
                                    {String(run.status || 'unknown').toUpperCase()}
                                </span>
                                <span>{Number(run.monSpentMON || 0).toFixed(4)} MON</span>
                                <span>{Number(run.clashBurned || 0).toFixed(4)} CLASH burned</span>
                                <span>{run.finishedAt ? new Date(run.finishedAt).toLocaleString() : '-'}</span>
                            </div>
                        )) : (
                            <div className="stats-tokenomics__empty">
                                Buyback history will appear here after first successful run.
                            </div>
                        )}
                    </div>
                </div>

                {/* Top Agents Leaderboard */}
                {topAgentsList.length > 0 && (
                    <div className="stats-leaderboard glass-card" id="top-agents">
                        <h3 className="stats-leaderboard__title text-display">
                            <Trophy size={18} style={{ color: '#FFE93E' }} />
                            Top Fighters
                        </h3>
                        <div className="stats-leaderboard__list">
                            {topAgentsList.map((agent, idx) => {
                                const wins = agent.stats?.wins || agent.wins || 0;
                                const losses = agent.stats?.losses || agent.losses || 0;
                                const wr = wins + losses > 0 ? ((wins / (wins + losses)) * 100).toFixed(1) : '0';
                                const earnings = agent.stats?.totalEarnings || 0;
                                return (
                                    <div key={agent.id || idx} className="stats-leaderboard__item">
                                        <span className="stats-leaderboard__rank">
                                            {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`}
                                        </span>
                                        <span className="stats-leaderboard__avatar" style={{ color: agent.color }}>{agent.avatar || '⚔️'}</span>
                                        <div className="stats-leaderboard__info">
                                            <span className="stats-leaderboard__name" style={{ color: agent.color }}>{agent.name}</span>
                                            <span className="stats-leaderboard__record">{wins}W / {losses}L ({wr}%)</span>
                                        </div>
                                        <div className="stats-leaderboard__earnings">
                                            <Flame size={12} />
                                            <span>{earnings > 0 ? earnings.toLocaleString() : '0'} MON</span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Recent Matches */}
                {recentResults.length > 0 && (
                    <div className="stats-recent glass-card" id="recent-matches">
                        <h3 className="stats-recent__title text-display">
                            <Swords size={18} style={{ color: 'var(--neon-pink)' }} />
                            Recent Matches
                        </h3>
                        <div className="stats-recent__list">
                            {recentResults.slice(0, 8).map((match, idx) => (
                                <div key={match.matchId || idx} className="stats-recent__item">
                                    <span className="stats-recent__winner" style={{ color: match.winner?.color || '#FFE93E' }}>
                                        {match.winner?.avatar || '🏆'} {match.winner?.name || 'Unknown'}
                                    </span>
                                    <span className="stats-recent__vs">defeated</span>
                                    <span className="stats-recent__loser" style={{ color: match.loser?.color || '#888' }}>
                                        {match.loser?.name || 'Unknown'}
                                    </span>
                                    <span className="stats-recent__method">{match.method || 'Decision'}</span>
                                    {match.totalBets > 0 && (
                                        <span className="stats-recent__pool">{match.totalBets} MON</span>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Monad Network Info */}
                <div className="stats-monad" id="monad-info">
                    <div className="stats-monad__header">
                        <h2 className="stats-monad__title text-display">
                            <span className="text-gradient">Powered by Monad</span>
                        </h2>
                        <p className="stats-monad__sub">
                            Agent Clash Arena runs on Monad Layer-1 — extreme performance with full EVM compatibility
                        </p>
                    </div>

                    <div className="stats-monad__features">
                        {monadFeatures.map((feat, idx) => (
                            <div key={idx} className="stats-monad__feature glass-card" id={`monad-feat-${idx}`}>
                                <feat.icon size={20} style={{ color: 'var(--monad-purple-light)' }} />
                                <span className="stats-monad__feat-value text-display">{feat.value}</span>
                                <span className="stats-monad__feat-label">{feat.label}</span>
                                <span className="stats-monad__feat-desc">{feat.desc}</span>
                            </div>
                        ))}
                    </div>

                    <div className="stats-monad__info glass-card" id="monad-network-info">
                        <h3 className="stats-monad__info-title text-display">Network Details</h3>
                        <div className="stats-monad__info-grid">
                            <div className="stats-monad__info-item">
                                <span className="stats-monad__info-label">Chain ID</span>
                                <span className="stats-monad__info-value">{MONAD_CONFIG.chainId}</span>
                            </div>
                            <div className="stats-monad__info-item">
                                <span className="stats-monad__info-label">Network</span>
                                <span className="stats-monad__info-value">{MONAD_CONFIG.chainName}</span>
                            </div>
                            <div className="stats-monad__info-item">
                                <span className="stats-monad__info-label">Native Currency</span>
                                <span className="stats-monad__info-value">{MONAD_CONFIG.nativeCurrency.symbol}</span>
                            </div>
                            <div className="stats-monad__info-item">
                                <span className="stats-monad__info-label">RPC</span>
                                <span className="stats-monad__info-value" style={{ fontSize: '0.7rem' }}>{MONAD_CONFIG.rpcUrl}</span>
                            </div>
                            <div className="stats-monad__info-item">
                                <span className="stats-monad__info-label">Block Explorer</span>
                                <a href={MONAD_CONFIG.blockExplorer} target="_blank" rel="noopener noreferrer" className="stats-monad__info-link">
                                    MonadScan <ExternalLink size={10} />
                                </a>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Smart Contract Section */}
                <div className="stats-contracts glass-card" id="contracts-section">
                    <h3 className="stats-contracts__title text-display">
                        <Shield size={18} style={{ color: 'var(--neon-cyan)' }} />
                        Smart Contract
                    </h3>
                    <p className="stats-contracts__desc">
                        All bets and rewards are managed by a verified smart contract on Monad.
                        Every transaction is transparent and verifiable on-chain.
                    </p>
                    <div className="stats-contracts__list">
                        <div className="stats-contracts__item">
                            <span className="stats-contracts__name">AgentClashBetting</span>
                            <a
                                href={`${MONAD_CONFIG.blockExplorer}/address/${CONTRACT_ADDRESS}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="stats-contracts__address-link"
                            >
                                {CONTRACT_ADDRESS.slice(0, 10)}...{CONTRACT_ADDRESS.slice(-8)}
                                <ArrowUpRight size={10} />
                            </a>
                        </div>
                    </div>

                    {contractStats && (
                        <div className="stats-contracts__details">
                            <div className="stats-contracts__detail-item">
                                <span>Min Bet</span>
                                <span>{contractStats.minBet} MON</span>
                            </div>
                            <div className="stats-contracts__detail-item">
                                <span>Max Bet</span>
                                <span>{contractStats.maxBet.toLocaleString()} MON</span>
                            </div>
                            <div className="stats-contracts__detail-item">
                                <span>Platform Fee</span>
                                <span>{contractStats.platformFeePercent}%</span>
                            </div>
                        </div>
                    )}

                    <div className="stats-contracts__reward">
                        <h4 className="text-display" style={{ fontSize: '0.75rem', color: 'var(--monad-purple-light)' }}>
                            Reward Distribution
                        </h4>
                        <div className="stats-contracts__reward-bars">
                            <div className="stats-contracts__reward-bar">
                                <div className="stats-contracts__reward-fill" style={{ width: '75%', background: 'var(--gradient-success)' }} />
                                <span className="stats-contracts__reward-label">75% Bettors</span>
                            </div>
                            <div className="stats-contracts__reward-bar">
                                <div className="stats-contracts__reward-fill" style={{ width: '15%', background: 'var(--gradient-primary)' }} />
                                <span className="stats-contracts__reward-label">15% Agent Owner</span>
                            </div>
                            <div className="stats-contracts__reward-bar">
                                <div className="stats-contracts__reward-fill" style={{ width: '10%', background: 'var(--gradient-gold)' }} />
                                <span className="stats-contracts__reward-label">10% Platform</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
