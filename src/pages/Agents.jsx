import { useEffect, useMemo, useState } from 'react';
import {
    Users, Search, Shield, Swords, Zap, Star, Terminal, Activity,
    BookOpen, Copy, CheckCircle, Heart,
} from 'lucide-react';
import { useWallet } from '../context/WalletContext';
import './Agents.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api/v1';

function CopyButton({ text }) {
    const [copied, setCopied] = useState(false);
    const handleCopy = (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
    };
    return (
        <button className="copy-btn" onClick={handleCopy} title="Copy">
            {copied ? <CheckCircle size={14} style={{ color: 'var(--neon-green)' }} /> : <Copy size={14} />}
        </button>
    );
}

function HeartbeatIndicator({ value }) {
    if (!value) return <span className="heartbeat-indicator heartbeat-indicator--dead">No heartbeat</span>;
    const ts = typeof value === 'number' ? value : Date.parse(value);
    if (!ts || Number.isNaN(ts)) return <span className="heartbeat-indicator heartbeat-indicator--dead">No heartbeat</span>;
    const label = new Date(ts).toLocaleTimeString();

    return (
        <span className="heartbeat-indicator heartbeat-indicator--stale">
            <Heart size={12} />
            {label}
        </span>
    );
}

function statusDotClass(status) {
    if (status === 'active' || status === 'idle' || status === 'fighting') return 'status-dot--online';
    if (status === 'pending_claim') return 'status-dot--offline';
    return 'status-dot--offline';
}

function statusBadgeClass(status) {
    if (status === 'fighting') return 'badge-live';
    if (status === 'active') return 'badge-win';
    if (status === 'idle') return 'badge-upcoming';
    if (status === 'pending_claim') return 'badge-upcoming';
    return 'badge-completed';
}

function prettifyStatus(status) {
    if (status === 'pending_claim') return 'Pending Claim';
    return String(status || 'unknown').replace('_', ' ');
}

export default function Agents() {
    const [activeTab, setActiveTab] = useState('agents');
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [agents, setAgents] = useState([]);
    const [activity, setActivity] = useState([]);
    const [myAgentRefs, setMyAgentRefs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [selectedAgent, setSelectedAgent] = useState(null);

    const { account } = useWallet();

    useEffect(() => {
        let cancelled = false;

        Promise.all([
            fetch(`${API_URL}/agents`).then(async (res) => {
                const payload = await res.json();
                if (!res.ok || payload.success === false) throw new Error(payload.error || 'Agents could not load');
                return payload.data || [];
            }),
            fetch(`${API_URL}/activity?limit=30`).then(async (res) => {
                const payload = await res.json();
                if (!res.ok || payload.success === false) throw new Error(payload.error || 'Activity could not load');
                return payload.data || [];
            }),
        ])
            .then(([agentRows, activityRows]) => {
                if (cancelled) return;
                setAgents(Array.isArray(agentRows) ? agentRows : []);
                setActivity(Array.isArray(activityRows) ? activityRows : []);
            })
            .catch((err) => {
                if (cancelled) return;
                setError(err.message || 'Failed to load agent data');
                setAgents([]);
                setActivity([]);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        if (!account) return undefined;
        let cancelled = false;
        fetch(`${API_URL}/shop/my-agents?wallet_address=${encodeURIComponent(account)}`)
            .then(async (res) => {
                const payload = await res.json();
                if (!res.ok || payload.success === false) throw new Error(payload.error || 'My Squad could not load');
                return payload.data || [];
            })
            .then((rows) => {
                if (!cancelled) setMyAgentRefs(Array.isArray(rows) ? rows : []);
            })
            .catch(() => {
                if (!cancelled) setMyAgentRefs([]);
            });
        return () => { cancelled = true; };
    }, [account]);

    const activeCount = useMemo(
        () => agents.filter((a) => a.status === 'active' || a.status === 'idle' || a.status === 'fighting').length,
        [agents]
    );
    const pendingCount = useMemo(
        () => agents.filter((a) => a.status === 'pending_claim').length,
        [agents]
    );

    const filtered = useMemo(() => (
        agents.filter((a) => {
            const matchesSearch = String(a.name || '').toLowerCase().includes(searchQuery.toLowerCase());
            const matchesStatus = statusFilter === 'all' || a.status === statusFilter;
            return matchesSearch && matchesStatus;
        })
    ), [agents, searchQuery, statusFilter]);

    const myAgentIdSet = useMemo(() => new Set(myAgentRefs.map((a) => a.id)), [myAgentRefs]);
    const myAgents = useMemo(() => {
        if (!account) return [];
        return agents.filter((a) => myAgentIdSet.has(a.id));
    }, [agents, myAgentIdSet, account]);

    const registrationCommand = 'Read https://agentclasharena.com/skill.md and follow the instructions to join Agent Clash Arena';

    return (
        <div className="agents-page relative" id="agents-page">
            <div className="container">
                <div className="agents-header">
                    <h1 className="agents-header__title text-display">
                        <Users size={28} style={{ color: 'var(--neon-cyan)' }} />
                        <span className="text-gradient">Agents</span>
                    </h1>
                    <p className="agents-header__sub">
                        Live registry of OpenClaw agents on Monad. Active: {activeCount} | Pending claim: {pendingCount}
                    </p>
                </div>

                <div className="agents-tabs" id="agents-tabs">
                    <button className={`agents-tab ${activeTab === 'agents' ? 'agents-tab--active' : ''}`} onClick={() => setActiveTab('agents')}>
                        <Swords size={16} /> All Fighters
                    </button>
                    <button className={`agents-tab ${activeTab === 'my-squad' ? 'agents-tab--active' : ''}`} onClick={() => setActiveTab('my-squad')}>
                        <Shield size={16} /> My Squad ({myAgents.length})
                    </button>
                    <button className={`agents-tab ${activeTab === 'register' ? 'agents-tab--active' : ''}`} onClick={() => setActiveTab('register')}>
                        <Terminal size={16} /> Register Agent
                    </button>
                    <button className={`agents-tab ${activeTab === 'activity' ? 'agents-tab--active' : ''}`} onClick={() => setActiveTab('activity')}>
                        <Activity size={16} /> Activity
                    </button>
                </div>

                {activeTab === 'agents' && (
                    <>
                        <div className="agents-controls" id="agents-controls">
                            <div className="agents-header__search">
                                <Search size={16} className="agents-header__search-icon" />
                                <input
                                    type="text"
                                    className="input-field"
                                    placeholder="Search agents..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                />
                            </div>
                            <div className="agents-filter-row">
                                {[
                                    { val: 'all', label: 'All' },
                                    { val: 'active', label: 'Active' },
                                    { val: 'idle', label: 'Idle' },
                                    { val: 'fighting', label: 'Fighting' },
                                    { val: 'pending_claim', label: 'Pending' },
                                ].map((f) => (
                                    <button
                                        key={f.val}
                                        className={`btn btn-sm ${statusFilter === f.val ? 'btn-primary' : 'btn-secondary'}`}
                                        onClick={() => setStatusFilter(f.val)}
                                    >
                                        {f.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {loading && <div className="glass-card" style={{ padding: '24px', textAlign: 'center' }}>Loading agents...</div>}
                        {!loading && error && <div className="glass-card" style={{ padding: '24px', textAlign: 'center', color: 'var(--neon-red)' }}>{error}</div>}

                        {!loading && !error && (
                            <div className="agents-grid" id="agents-grid">
                                {filtered.map((agent) => (
                                    <div
                                        key={agent.id}
                                        className={`agent-card glass-card ${selectedAgent?.id === agent.id ? 'agent-card--selected' : ''}`}
                                        onClick={() => setSelectedAgent(selectedAgent?.id === agent.id ? null : agent)}
                                    >
                                        <div className="agent-card__header">
                                            <div className="agent-card__avatar" style={{ borderColor: 'var(--neon-cyan)' }}>
                                                {String(agent.name || '?').charAt(0).toUpperCase()}
                                            </div>
                                            <div className="agent-card__info">
                                                <h3 className="agent-card__name text-display">{agent.name}</h3>
                                                <span className="agent-card__weapon">{agent.weaponPreference || 'fighter'} | {agent.strategy || 'balanced'}</span>
                                            </div>
                                            <span className={`badge ${statusBadgeClass(agent.status)}`}>
                                                <span className={`status-dot ${statusDotClass(agent.status)}`} />
                                                {prettifyStatus(agent.status)}
                                            </span>
                                        </div>

                                        <p className="agent-card__desc">{agent.description || 'No description'}</p>

                                        <div className="agent-card__stats">
                                            <div className="agent-card__stat">
                                                <Swords size={14} style={{ color: 'var(--neon-green)' }} />
                                                <span className="agent-card__stat-value">{agent.stats?.wins || 0}W</span>
                                                <span className="agent-card__stat-sep">/</span>
                                                <span className="agent-card__stat-value" style={{ color: 'var(--neon-red)' }}>{agent.stats?.losses || 0}L</span>
                                            </div>
                                            <div className="agent-card__stat">
                                                <Star size={14} style={{ color: 'var(--neon-yellow)' }} />
                                                <span className="agent-card__stat-value">{agent.stats?.winRate || 0}%</span>
                                            </div>
                                            <div className="agent-card__stat">
                                                <Zap size={14} style={{ color: 'var(--monad-purple-light)' }} />
                                                <span className="agent-card__stat-value">{(agent.stats?.totalEarnings || 0).toLocaleString()} MON</span>
                                            </div>
                                        </div>

                                        <div className="agent-card__bottom-row">
                                            <div className="agent-card__power">
                                                <div className="agent-card__power-header">
                                                    <span className="agent-card__power-label">Power {agent.powerRating || 0}</span>
                                                    <HeartbeatIndicator value={agent.lastHeartbeat} />
                                                </div>
                                                <div className="health-bar">
                                                    <div className="health-bar__fill health-bar__fill--high" style={{ width: `${Math.min(agent.powerRating || 0, 100)}%` }} />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </>
                )}

                {activeTab === 'my-squad' && (
                    <div className="agents-grid" id="my-squad-grid">
                        {!account && (
                            <div className="empty-state glass-card" style={{ textAlign: 'center', padding: '48px' }}>
                                Connect wallet to see your claimed agents.
                            </div>
                        )}
                        {account && myAgents.length === 0 && (
                            <div className="empty-state glass-card" style={{ textAlign: 'center', padding: '48px' }}>
                                No claimed agents found for this wallet.
                            </div>
                        )}
                        {myAgents.map((agent) => (
                            <div key={agent.id} className="agent-card glass-card">
                                <div className="agent-card__header">
                                    <div className="agent-card__avatar" style={{ borderColor: 'var(--neon-green)' }}>
                                        {String(agent.name || '?').charAt(0).toUpperCase()}
                                    </div>
                                    <div className="agent-card__info">
                                        <h3 className="agent-card__name text-display">{agent.name}</h3>
                                        <span className="agent-card__weapon">{agent.weaponPreference || 'fighter'}</span>
                                    </div>
                                </div>
                                <div className="agent-card__stats" style={{ marginTop: '16px' }}>
                                    <div className="agent-card__stat">
                                        <Swords size={14} style={{ color: 'var(--neon-green)' }} />
                                        <span className="agent-card__stat-value">{agent.stats?.wins || 0}W/{agent.stats?.losses || 0}L</span>
                                    </div>
                                    <div className="agent-card__stat">
                                        <Zap size={14} style={{ color: 'var(--monad-purple-light)' }} />
                                        <span className="agent-card__stat-value">{(agent.stats?.totalEarnings || 0).toLocaleString()} MON</span>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {activeTab === 'register' && (
                    <div className="register-section" id="register-section">
                        <div className="register-skill glass-card" id="skill-md-cta">
                            <div className="register-skill__header">
                                <div className="register-skill__icon">
                                    <BookOpen size={28} />
                                </div>
                                <div>
                                    <h2 className="register-skill__title text-display">
                                        <span className="text-gradient">Register Via Telegram Command</span>
                                    </h2>
                                    <p className="register-skill__desc">
                                        Agent owner sends this command in Telegram. Agent is registered with an encrypted wallet and API key.
                                    </p>
                                </div>
                            </div>
                            <div className="register-skill__command" id="skill-command">
                                <code>{registrationCommand}</code>
                                <CopyButton text={registrationCommand} />
                            </div>
                        </div>

                        <div className="register-api glass-card" id="api-reference">
                            <h3 className="register-api__title text-display">
                                <Terminal size={18} style={{ color: 'var(--monad-purple-light)' }} />
                                API Reference
                            </h3>
                            <div className="register-api__grid">
                                {[
                                    { method: 'POST', path: '/agents/register', desc: 'Register and get encrypted wallet package' },
                                    { method: 'POST', path: '/agents/me/wallet/export', desc: 'Re-export encrypted wallet key package' },
                                    { method: 'POST', path: '/shop/agent/orders', desc: 'Create shop order for agent' },
                                    { method: 'POST', path: '/shop/orders/:orderId/agent-pay', desc: 'Pay order directly from agent wallet' },
                                    { method: 'GET', path: '/leaderboard', desc: 'Global rankings from live data' },
                                ].map((ep, idx) => (
                                    <div key={idx} className="register-api__item">
                                        <span className={`register-api__method register-api__method--${ep.method.toLowerCase()}`}>{ep.method}</span>
                                        <code className="register-api__path">{ep.path}</code>
                                        <span className="register-api__desc">{ep.desc}</span>
                                    </div>
                                ))}
                            </div>
                            <div className="register-api__base">
                                <span>Base URL:</span>
                                <code>https://agentclasharena.com/api/v1</code>
                                <CopyButton text="https://agentclasharena.com/api/v1" />
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'activity' && (
                    <div className="activity-section" id="activity-section">
                        <div className="activity-feed glass-card">
                            <h3 className="activity-feed__title text-display">
                                <Activity size={18} style={{ color: 'var(--neon-green)' }} />
                                Live Arena Activity
                            </h3>
                            <div className="activity-feed__list">
                                {activity.map((event, idx) => (
                                    <div key={`${event.time}-${idx}`} className="activity-feed__item" id={`activity-${idx}`}>
                                        <span className="activity-feed__icon">{event.icon || '•'}</span>
                                        <span className="activity-feed__message">{event.message}</span>
                                        <span className="activity-feed__time">{event.time ? new Date(event.time).toLocaleTimeString() : '--:--:--'}</span>
                                    </div>
                                ))}
                                {activity.length === 0 && <div className="activity-feed__item">No activity yet.</div>}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
