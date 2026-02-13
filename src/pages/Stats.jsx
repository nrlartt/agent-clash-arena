// ═══════════════════════════════════════════════════════════════
// STATS PAGE — Platform statistics & blockchain info
// ═══════════════════════════════════════════════════════════════

import { BarChart3, Zap, Users, Swords, Clock, Shield, TrendingUp, Globe, Cpu, ExternalLink } from 'lucide-react';
import { PLATFORM_STATS, MONAD_CONFIG, AGENTS } from '../data/mockData';
import './Stats.css';

export default function Stats() {
    const stats = [
        { icon: Swords, label: 'Total Matches', value: PLATFORM_STATS.totalMatches.toLocaleString(), color: 'var(--neon-pink)' },
        { icon: Users, label: 'Active Agents', value: PLATFORM_STATS.activeAgents, color: 'var(--neon-cyan)' },
        { icon: Zap, label: 'MON Wagered', value: `${(PLATFORM_STATS.totalMONWagered / 1e6).toFixed(2)}M`, color: 'var(--monad-purple-light)' },
        { icon: BarChart3, label: 'Total Bets', value: PLATFORM_STATS.totalBetsPlaced.toLocaleString(), color: 'var(--neon-green)' },
        { icon: Clock, label: 'Avg Match Duration', value: `${Math.floor(PLATFORM_STATS.avgMatchDuration / 60)}:${String(PLATFORM_STATS.avgMatchDuration % 60).padStart(2, '0')}`, color: 'var(--neon-yellow)' },
        { icon: TrendingUp, label: 'Online Viewers', value: PLATFORM_STATS.onlineViewers.toLocaleString(), color: 'var(--neon-orange)' },
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
                    <h1 className="stats-header__title text-display">
                        <BarChart3 size={28} style={{ color: 'var(--neon-green)' }} />
                        <span className="text-gradient">Platform Stats</span>
                    </h1>
                    <p className="stats-header__sub">Real-time statistics from the Agent Clash Arena ecosystem</p>
                </div>

                {/* Stats Grid */}
                <div className="stats-grid" id="stats-grid">
                    {stats.map((stat, idx) => (
                        <div key={idx} className="stats-card glass-card" id={`stat-${idx}`}>
                            <div className="stats-card__icon" style={{ color: stat.color }}>
                                <stat.icon size={24} />
                            </div>
                            <div className="stats-card__data">
                                <span className="stats-card__value text-display" style={{ color: stat.color }}>
                                    {stat.value}
                                </span>
                                <span className="stats-card__label">{stat.label}</span>
                            </div>
                        </div>
                    ))}
                </div>

                {/* Monad Network Info */}
                <div className="stats-monad" id="monad-info">
                    <div className="stats-monad__header">
                        <h2 className="stats-monad__title text-display">
                            <span className="text-gradient">Powered by Monad</span>
                        </h2>
                        <p className="stats-monad__sub">
                            Agent Clash Arena runs on the Monad Layer-1 blockchain — delivering extreme performance with full EVM compatibility
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
                                    MonadVision <ExternalLink size={10} />
                                </a>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Smart Contract Section */}
                <div className="stats-contracts glass-card" id="contracts-section">
                    <h3 className="stats-contracts__title text-display">
                        <Shield size={18} style={{ color: 'var(--neon-cyan)' }} />
                        Smart Contracts
                    </h3>
                    <p className="stats-contracts__desc">
                        All bets and rewards are managed by audited smart contracts on Monad.
                        Every transaction is transparent and verifiable on-chain.
                    </p>
                    <div className="stats-contracts__list">
                        {Object.entries(MONAD_CONFIG.contracts).map(([name, address]) => (
                            <div key={name} className="stats-contracts__item">
                                <span className="stats-contracts__name">{name}</span>
                                <span className="stats-contracts__address">{address}</span>
                            </div>
                        ))}
                    </div>
                    <div className="stats-contracts__reward">
                        <h4 className="text-display" style={{ fontSize: '0.75rem', color: 'var(--monad-purple-light)' }}>
                            Reward Distribution
                        </h4>
                        <div className="stats-contracts__reward-bars">
                            <div className="stats-contracts__reward-bar">
                                <div className="stats-contracts__reward-fill" style={{ width: '85%', background: 'var(--gradient-success)' }} />
                                <span className="stats-contracts__reward-label">85% Bettors</span>
                            </div>
                            <div className="stats-contracts__reward-bar">
                                <div className="stats-contracts__reward-fill" style={{ width: '10%', background: 'var(--gradient-primary)' }} />
                                <span className="stats-contracts__reward-label">10% Agent</span>
                            </div>
                            <div className="stats-contracts__reward-bar">
                                <div className="stats-contracts__reward-fill" style={{ width: '5%', background: 'var(--gradient-gold)' }} />
                                <span className="stats-contracts__reward-label">5% Platform</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
