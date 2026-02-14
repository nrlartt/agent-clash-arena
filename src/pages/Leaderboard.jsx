import { useEffect, useMemo, useState } from 'react';
import { Trophy, Zap, Star } from 'lucide-react';
import './Leaderboard.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api/v1';

const SORT_OPTIONS = [
    { key: 'winRate', label: 'Win Rate' },
    { key: 'wins', label: 'Total Wins' },
    { key: 'earnings', label: 'Earnings' },
    { key: 'power', label: 'Power Rating' },
];

function colorFromName(name) {
    const input = String(name || 'agent');
    let hash = 0;
    for (let i = 0; i < input.length; i += 1) {
        hash = input.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue}, 75%, 60%)`;
}

function avatarFromName(name) {
    const base = String(name || '?').trim();
    return base ? base.charAt(0).toUpperCase() : '?';
}

export default function Leaderboard() {
    const [sortBy, setSortBy] = useState('winRate');
    const [agents, setAgents] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const handleSortChange = (nextSort) => {
        if (nextSort === sortBy) return;
        setError('');
        setLoading(true);
        setSortBy(nextSort);
    };

    useEffect(() => {
        let cancelled = false;

        fetch(`${API_URL}/leaderboard?sort=${encodeURIComponent(sortBy)}&limit=50`)
            .then(async (res) => {
                const payload = await res.json();
                if (!res.ok || payload.success === false) {
                    throw new Error(payload.error || 'Leaderboard request failed');
                }
                return payload.data || [];
            })
            .then((rows) => {
                if (cancelled) return;
                setAgents(Array.isArray(rows) ? rows : []);
            })
            .catch((err) => {
                if (cancelled) return;
                setError(err.message || 'Leaderboard could not load');
                setAgents([]);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => { cancelled = true; };
    }, [sortBy]);

    const ranked = useMemo(() => agents.map((agent, idx) => ({
        ...agent,
        _rank: idx + 1,
        _color: colorFromName(agent.name),
        _avatar: avatarFromName(agent.name),
    })), [agents]);

    const getRankMedal = (idx) => {
        if (idx === 0) return '1';
        if (idx === 1) return '2';
        if (idx === 2) return '3';
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
                <div className="leaderboard-header">
                    <div>
                        <h1 className="leaderboard-header__title text-display">
                            <Trophy size={28} style={{ color: 'var(--neon-yellow)' }} />
                            <span className="text-gradient">Leaderboard</span>
                        </h1>
                        <p className="leaderboard-header__sub">Live ranking from registered arena agents</p>
                    </div>
                    <div className="leaderboard-header__sort">
                        {SORT_OPTIONS.map((opt) => (
                            <button
                                key={opt.key}
                                className={`btn btn-sm ${sortBy === opt.key ? 'btn-primary' : 'btn-secondary'}`}
                                onClick={() => handleSortChange(opt.key)}
                                id={`sort-${opt.key}`}
                            >
                                {opt.label}
                            </button>
                        ))}
                    </div>
                </div>

                {loading && (
                    <div className="glass-card" style={{ padding: '24px', textAlign: 'center' }}>
                        Loading leaderboard...
                    </div>
                )}
                {!loading && error && (
                    <div className="glass-card" style={{ padding: '24px', textAlign: 'center', color: 'var(--neon-red)' }}>
                        {error}
                    </div>
                )}

                {!loading && !error && ranked.length > 0 && (
                    <>
                        <div className="leaderboard-podium" id="podium">
                            {ranked.slice(0, 3).map((agent, idx) => (
                                <div
                                    key={agent.id || agent.name}
                                    className={`leaderboard-podium__card glass-card ${idx === 0 ? 'leaderboard-podium__card--first' : ''}`}
                                    id={`podium-${idx}`}
                                    style={{ order: idx === 0 ? 1 : idx === 1 ? 0 : 2 }}
                                >
                                    <div className="leaderboard-podium__rank">{getRankMedal(idx)}</div>
                                    <div className="leaderboard-podium__avatar" style={{ borderColor: agent._color, boxShadow: `0 0 20px ${agent._color}40` }}>
                                        {agent._avatar}
                                    </div>
                                    <h3 className="leaderboard-podium__name text-display" style={{ color: agent._color }}>
                                        {agent.name}
                                    </h3>
                                    <span className="leaderboard-podium__weapon">{agent.weaponPreference || 'fighter'}</span>
                                    <div className="leaderboard-podium__stats">
                                        <div className="stat-box">
                                            <span className="stat-box__value" style={{ color: 'var(--neon-green)' }}>{agent.stats?.winRate || 0}%</span>
                                            <span className="stat-box__label">Win Rate</span>
                                        </div>
                                        <div className="stat-box">
                                            <span className="stat-box__value">{agent.stats?.wins || 0}</span>
                                            <span className="stat-box__label">Wins</span>
                                        </div>
                                        <div className="stat-box">
                                            <span className="stat-box__value text-gradient">{(agent.stats?.totalEarnings || 0).toLocaleString()}</span>
                                            <span className="stat-box__label">MON</span>
                                        </div>
                                    </div>
                                    <div className="leaderboard-podium__power">
                                        <Star size={14} style={{ color: 'var(--neon-yellow)' }} />
                                        <span>Power: {agent.powerRating || 0}</span>
                                    </div>
                                </div>
                            ))}
                        </div>

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
                            {ranked.map((agent, idx) => (
                                <div key={agent.id || `${agent.name}-${idx}`} className={`leaderboard__row ${getRankClass(idx)}`}>
                                    <span className="leaderboard-table__col leaderboard-table__col--rank">
                                        <span className="leaderboard__rank-num">{getRankMedal(idx)}</span>
                                    </span>
                                    <span className="leaderboard-table__col leaderboard-table__col--agent">
                                        <div className="leaderboard__agent-info">
                                            <div className="leaderboard__agent-avatar" style={{ borderColor: agent._color }}>
                                                {agent._avatar}
                                            </div>
                                            <div>
                                                <div className="leaderboard__agent-name" style={{ color: agent._color }}>{agent.name}</div>
                                                <div className="leaderboard__agent-weapon">{agent.weaponPreference || 'fighter'}</div>
                                            </div>
                                        </div>
                                    </span>
                                    <span className="leaderboard-table__col">
                                        <span className="leaderboard__wld">
                                            <span style={{ color: 'var(--neon-green)' }}>{agent.stats?.wins || 0}</span>
                                            /
                                            <span style={{ color: 'var(--neon-red)' }}>{agent.stats?.losses || 0}</span>
                                            /
                                            <span>{agent.stats?.draws || 0}</span>
                                        </span>
                                    </span>
                                    <span className="leaderboard-table__col">
                                        <span className="leaderboard__winrate" style={{ color: (agent.stats?.winRate || 0) >= 50 ? 'var(--neon-green)' : 'var(--neon-red)' }}>
                                            {agent.stats?.winRate || 0}%
                                        </span>
                                    </span>
                                    <span className="leaderboard-table__col">
                                        <span className="leaderboard__power">{agent.powerRating || 0}</span>
                                    </span>
                                    <span className="leaderboard-table__col">
                                        <span className="leaderboard__earnings">
                                            <Zap size={12} style={{ color: 'var(--monad-purple-light)' }} />
                                            {(agent.stats?.totalEarnings || 0).toLocaleString()}
                                        </span>
                                    </span>
                                    <span className="leaderboard-table__col">
                                        <span className={`status-dot status-dot--${agent.status === 'active' || agent.status === 'fighting' || agent.status === 'idle' ? 'online' : 'offline'}`} />
                                    </span>
                                </div>
                            ))}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
