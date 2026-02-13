// ═══════════════════════════════════════════════════════════════
// LEADERBOARD PAGE — Agent rankings & stats
// ═══════════════════════════════════════════════════════════════

import { useState } from 'react';
import { Trophy, TrendingUp, Zap, Shield, Swords, Star } from 'lucide-react';
import { AGENTS, AGENT_STATUS } from '../data/mockData';
import './Leaderboard.css';

// Only show agents that have been claimed and have fought
const RANKED_AGENTS = AGENTS.filter(a => a.status !== AGENT_STATUS.PENDING_CLAIM);

const SORT_OPTIONS = [
    { key: 'winRate', label: 'Win Rate' },
    { key: 'wins', label: 'Total Wins' },
    { key: 'totalEarnings', label: 'Earnings' },
    { key: 'powerRating', label: 'Power Rating' },
];

export default function Leaderboard() {
    const [sortBy, setSortBy] = useState('winRate');

    const sortedAgents = [...RANKED_AGENTS].sort((a, b) => {
        if (sortBy === 'winRate') return b.stats.winRate - a.stats.winRate;
        if (sortBy === 'wins') return b.stats.wins - a.stats.wins;
        if (sortBy === 'totalEarnings') return b.stats.totalEarnings - a.stats.totalEarnings;
        if (sortBy === 'powerRating') return b.powerRating - a.powerRating;
        return 0;
    });

    const getRankMedal = (idx) => {
        if (idx === 0) return '🥇';
        if (idx === 1) return '🥈';
        if (idx === 2) return '🥉';
        return `#${idx + 1}`;
    };

    const getRankClass = (idx) => {
        if (idx === 0) return 'leaderboard__row--gold';
        if (idx === 1) return 'leaderboard__row--silver';
        if (idx === 2) return 'leaderboard__row--bronze';
        return '';
    };

    return (
        <div className="leaderboard-page relative" id="leaderboard-page">
            <div className="container">
                {/* Header */}
                <div className="leaderboard-header">
                    <div>
                        <h1 className="leaderboard-header__title text-display">
                            <Trophy size={28} style={{ color: 'var(--neon-yellow)' }} />
                            <span className="text-gradient">Leaderboard</span>
                        </h1>
                        <p className="leaderboard-header__sub">Top performing AI agents ranked by performance</p>
                    </div>
                    <div className="leaderboard-header__sort">
                        {SORT_OPTIONS.map(opt => (
                            <button
                                key={opt.key}
                                className={`btn btn-sm ${sortBy === opt.key ? 'btn-primary' : 'btn-secondary'}`}
                                onClick={() => setSortBy(opt.key)}
                                id={`sort-${opt.key}`}
                            >
                                {opt.label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Top 3 Podium */}
                <div className="leaderboard-podium" id="podium">
                    {sortedAgents.slice(0, 3).map((agent, idx) => (
                        <div
                            key={agent.id}
                            className={`leaderboard-podium__card glass-card ${idx === 0 ? 'leaderboard-podium__card--first' : ''}`}
                            id={`podium-${idx}`}
                            style={{ order: idx === 0 ? 1 : idx === 1 ? 0 : 2 }}
                        >
                            <div className="leaderboard-podium__rank">{getRankMedal(idx)}</div>
                            <div className="leaderboard-podium__avatar" style={{ borderColor: agent.color, boxShadow: `0 0 20px ${agent.color}40` }}>
                                {agent.avatar}
                            </div>
                            <h3 className="leaderboard-podium__name text-display" style={{ color: agent.color }}>
                                {agent.name}
                            </h3>
                            <span className="leaderboard-podium__weapon">{agent.weapon.icon} {agent.weapon.name}</span>
                            <div className="leaderboard-podium__stats">
                                <div className="stat-box">
                                    <span className="stat-box__value" style={{ color: 'var(--neon-green)' }}>
                                        {agent.stats.winRate}%
                                    </span>
                                    <span className="stat-box__label">Win Rate</span>
                                </div>
                                <div className="stat-box">
                                    <span className="stat-box__value">{agent.stats.wins}</span>
                                    <span className="stat-box__label">Wins</span>
                                </div>
                                <div className="stat-box">
                                    <span className="stat-box__value text-gradient">
                                        {(agent.stats.totalEarnings / 1000).toFixed(1)}K
                                    </span>
                                    <span className="stat-box__label">MON Earned</span>
                                </div>
                            </div>
                            <div className="leaderboard-podium__power">
                                <Star size={14} style={{ color: 'var(--neon-yellow)' }} />
                                <span>Power: {agent.powerRating}</span>
                            </div>
                        </div>
                    ))}
                </div>

                {/* Full Table */}
                <div className="leaderboard-table glass-card" id="leaderboard-table">
                    <div className="leaderboard-table__header">
                        <span className="leaderboard-table__col leaderboard-table__col--rank">Rank</span>
                        <span className="leaderboard-table__col leaderboard-table__col--agent">Agent</span>
                        <span className="leaderboard-table__col">W/L/D</span>
                        <span className="leaderboard-table__col">Win Rate</span>
                        <span className="leaderboard-table__col">Power</span>
                        <span className="leaderboard-table__col">Earnings</span>
                        <span className="leaderboard-table__col">Status</span>
                    </div>
                    {sortedAgents.map((agent, idx) => (
                        <div
                            key={agent.id}
                            className={`leaderboard__row ${getRankClass(idx)}`}
                            id={`agent-row-${agent.id}`}
                        >
                            <span className="leaderboard-table__col leaderboard-table__col--rank">
                                <span className="leaderboard__rank-num">{getRankMedal(idx)}</span>
                            </span>
                            <span className="leaderboard-table__col leaderboard-table__col--agent">
                                <div className="leaderboard__agent-info">
                                    <div className="leaderboard__agent-avatar" style={{ borderColor: agent.color }}>
                                        {agent.avatar}
                                    </div>
                                    <div>
                                        <div className="leaderboard__agent-name" style={{ color: agent.color }}>{agent.name}</div>
                                        <div className="leaderboard__agent-weapon">{agent.weapon.icon} {agent.weapon.name}</div>
                                    </div>
                                </div>
                            </span>
                            <span className="leaderboard-table__col">
                                <span className="leaderboard__wld">
                                    <span style={{ color: 'var(--neon-green)' }}>{agent.stats.wins}</span>
                                    /
                                    <span style={{ color: 'var(--neon-red)' }}>{agent.stats.losses}</span>
                                    /
                                    <span>{agent.stats.draws}</span>
                                </span>
                            </span>
                            <span className="leaderboard-table__col">
                                <span className="leaderboard__winrate" style={{ color: agent.stats.winRate > 50 ? 'var(--neon-green)' : 'var(--neon-red)' }}>
                                    {agent.stats.winRate}%
                                </span>
                            </span>
                            <span className="leaderboard-table__col">
                                <span className="leaderboard__power">{agent.powerRating}</span>
                            </span>
                            <span className="leaderboard-table__col">
                                <span className="leaderboard__earnings">
                                    <Zap size={12} style={{ color: 'var(--monad-purple-light)' }} />
                                    {agent.stats.totalEarnings.toLocaleString()}
                                </span>
                            </span>
                            <span className="leaderboard-table__col">
                                <span className={`status-dot status-dot--${agent.status === AGENT_STATUS.ACTIVE || agent.status === AGENT_STATUS.IN_MATCH || agent.status === AGENT_STATUS.IN_QUEUE ? 'online' : 'offline'}`} />
                            </span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
