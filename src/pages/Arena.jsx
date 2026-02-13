// ═══════════════════════════════════════════════════════════════
// ARENA PAGE v3 — Modernized with live data, WebSocket,
// real-time stats, activity feed, enhanced visuals
// ═══════════════════════════════════════════════════════════════

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
    Zap, TrendingUp, Flame, Eye, Trophy, Clock,
    Activity, Radio, ChevronRight, Swords, BarChart3,
    Users, ArrowUpRight, Sparkles, Shield, Target, Timer
} from 'lucide-react';
import { useWallet } from '../context/WalletContext';
import GameCanvas from '../components/GameCanvas';
import BetPanel from '../components/BetPanel';
import LiveChat from '../components/LiveChat';
import { MATCHES, PLATFORM_STATS, AGENTS } from '../data/mockData';
import { calculateEquipmentBonus } from '../data/inventory';
import { useInventory } from '../context/InventoryContext';
import { playSound } from '../utils/audio';
import './Arena.css';

// ── API Config ──
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api/v1';
const WS_URL = API_URL.replace('/api/v1', '').replace('http', 'ws');
const HTTP_URL = API_URL.replace('/api/v1', '').replace('ws', 'http');

export default function Arena() {
    // ── Game Loop State ──
    const [gameState, setGameState] = useState('WAITING');
    const [timeLeft, setTimeLeft] = useState(10);
    const [matchQueue, setMatchQueue] = useState(MATCHES);
    const [currentMatch, setCurrentMatch] = useState(MATCHES[0]);

    // ── Simulation State ──
    const [liveAgentState, setLiveAgentState] = useState(null);
    const [liveMatchState, setLiveMatchState] = useState(null);
    const [matchResult, setMatchResult] = useState(null);
    const [matchKey, setMatchKey] = useState(0);

    // ── Live Data State (from backend) ──
    const [liveStats, setLiveStats] = useState({
        viewers: PLATFORM_STATS.onlineViewers,
        totalBetsToday: PLATFORM_STATS.totalMONWagered,
        matchesPlayedToday: PLATFORM_STATS.totalMatches,
        activeBetsPool: 5420,
    });
    const [activityFeed, setActivityFeed] = useState([]);
    const [recentResults, setRecentResults] = useState([]);
    const [wsConnected, setWsConnected] = useState(false);
    const [matchCount, setMatchCount] = useState(0);

    const { account } = useWallet();
    const { inventories } = useInventory();
    const wsRef = useRef(null);
    const activityFeedRef = useRef(null);

    // ── WebSocket Connection ──
    useEffect(() => {
        let ws;
        let reconnectTimer;

        const connect = () => {
            try {
                ws = new WebSocket(HTTP_URL.replace('http', 'ws'));
                wsRef.current = ws;

                ws.onopen = () => {
                    setWsConnected(true);
                    console.log('[WS] Connected to Arena');
                };

                ws.onclose = () => {
                    setWsConnected(false);
                    reconnectTimer = setTimeout(connect, 3000);
                };

                ws.onerror = () => {
                    setWsConnected(false);
                };

                ws.onmessage = () => {};
            } catch (e) {
                console.warn('[WS] Connection failed, using polling');
            }
        };

        // Use Socket.IO-like events via EventSource or polling
        // Since backend uses Socket.IO, we'll use polling for simplicity
        const pollInterval = setInterval(async () => {
            try {
                const [statsRes, resultsRes] = await Promise.all([
                    fetch(`${API_URL}/arena/live-stats`),
                    fetch(`${API_URL}/arena/recent-results`),
                ]);
                if (statsRes.ok) {
                    const statsData = await statsRes.json();
                    if (statsData.success) {
                        setLiveStats(statsData.data);
                    }
                }
                if (resultsRes.ok) {
                    const resultsData = await resultsRes.json();
                    if (resultsData.success) {
                        setRecentResults(resultsData.data);
                    }
                }
                setWsConnected(true);
            } catch {
                setWsConnected(false);
            }
        }, 3000);

        // Initial fetch
        (async () => {
            try {
                const res = await fetch(`${API_URL}/arena/live-stats`);
                if (res.ok) {
                    const data = await res.json();
                    if (data.success) setLiveStats(data.data);
                    setWsConnected(true);
                }
            } catch { /* ignore */ }
        })();

        return () => {
            clearInterval(pollInterval);
            clearTimeout(reconnectTimer);
            if (ws) ws.close();
        };
    }, []);

    // ── Simulated Activity Feed (client-side, enhanced) ──
    useEffect(() => {
        const agentList = liveStats.agents || AGENTS;
        const eventTypes = [
            (a) => ({ icon: '💰', text: `${['0xCafe...', '0xDead...', '0xBabe...', '0x1337...', '0xF00d...', '0xAce1...'][Math.floor(Math.random() * 6)]} bet ${[25, 50, 100, 250, 500, 1000, 2500][Math.floor(Math.random() * 7)]} MON on ${a.name}`, color: '#FFE93E', type: 'bet' }),
            (a) => ({ icon: '💥', text: `${a.name} landed a CRITICAL HIT!`, color: '#FF2D78', type: 'hit' }),
            (a) => ({ icon: '⚡', text: `${a.name} hit a ${Math.floor(Math.random() * 4 + 3)}x COMBO!`, color: '#00F5FF', type: 'combo' }),
            (a) => ({ icon: '🌟', text: `${a.name} unleashed SPECIAL MOVE!`, color: '#836EF9', type: 'special' }),
            (a) => ({ icon: '💨', text: `${a.name} dodged a lethal blow!`, color: '#69D2E7', type: 'dodge' }),
            (a) => ({ icon: '🔥', text: `${a.name} is on a ${Math.floor(Math.random() * 5 + 3)}-win streak!`, color: '#FF6B35', type: 'streak' }),
            () => ({ icon: '👁️', text: `${Math.floor(Math.random() * 80 + 20)} new viewers joined`, color: '#00F5FF', type: 'viewers' }),
            () => ({ icon: '🎮', text: `${Math.floor(Math.random() * 30 + 5)} bets placed this minute`, color: '#836EF9', type: 'bets' }),
            (a) => ({ icon: '📋', text: `${a.name} joined matchmaking queue`, color: '#39FF14', type: 'queue' }),
            (a) => ({ icon: '💓', text: `${a.name} heartbeat — online`, color: '#2ECC71', type: 'heartbeat' }),
        ];

        const interval = setInterval(() => {
            const agent = agentList[Math.floor(Math.random() * Math.min(agentList.length, 8))];
            const template = eventTypes[Math.floor(Math.random() * eventTypes.length)];
            const event = { ...template(agent || { name: 'Unknown' }), id: Date.now() + Math.random(), timestamp: Date.now() };

            setActivityFeed(prev => {
                const next = [event, ...prev];
                return next.slice(0, 30);
            });
        }, 2000 + Math.floor(Math.random() * 2000));

        return () => clearInterval(interval);
    }, [liveStats.agents]);

    // ── Sound Effects ──
    useEffect(() => {
        if (gameState === 'LIVE') playSound('bell');
        else if (gameState === 'FINISHED') playSound('cheer');
    }, [gameState]);

    useEffect(() => {
        if (liveMatchState?.currentRound > 1) playSound('round');
    }, [liveMatchState?.currentRound]);

    // ── Timer Ref for stale closure fix ──
    const gameStateRef = useRef(gameState);
    useEffect(() => { gameStateRef.current = gameState; }, [gameState]);

    const handleTimerComplete = useCallback(() => {
        const currentState = gameStateRef.current;
        if (currentState === 'WAITING') {
            setGameState('BETTING');
            setTimeLeft(30);
        } else if (currentState === 'BETTING') {
            setGameState('LIVE');
        } else if (currentState === 'FINISHED') {
            setMatchResult(null);
            setLiveAgentState(null);
            setLiveMatchState(null);
            setMatchQueue(prevQueue => {
                const nextQueue = [...prevQueue];
                const oldMatch = nextQueue.shift();
                nextQueue.push(oldMatch);
                setCurrentMatch(nextQueue[0]);
                return nextQueue;
            });
            setMatchKey(k => k + 1);
            setMatchCount(c => c + 1);
            setGameState('WAITING');
            setTimeLeft(8);
        }
    }, []);

    useEffect(() => {
        let interval;
        if (gameState !== 'LIVE') {
            interval = setInterval(() => {
                setTimeLeft((prev) => {
                    if (prev <= 1) {
                        setTimeout(handleTimerComplete, 0);
                        return 0;
                    }
                    return prev - 1;
                });
            }, 1000);
        }
        return () => clearInterval(interval);
    }, [gameState, handleTimerComplete]);

    // ── Canvas Callbacks ──
    const handleStateUpdate = useCallback((update) => {
        if (gameStateRef.current !== 'LIVE') return;
        if (update.type === 'tick') {
            setLiveAgentState(update.agents);
            setLiveMatchState({
                roundTimer: update.roundTimer,
                currentRound: update.currentRound,
                maxRounds: update.maxRounds,
            });
        }
    }, []);

    const handleMatchEnd = useCallback((result) => {
        if (gameStateRef.current !== 'LIVE') return;
        setMatchResult(result);
        setGameState('FINISHED');
        setTimeLeft(12);
    }, []);

    // ── Computed ──
    const upcomingMatches = matchQueue.slice(1, 8);
    const winnerAgent = matchResult
        ? (matchResult.winner === '1' ? currentMatch.agent1 : currentMatch.agent2)
        : null;

    const getEquipmentBonus = (agentId) => {
        const inv = inventories[agentId];
        return inv ? calculateEquipmentBonus(Object.values(inv.equipped).filter(Boolean)) : null;
    };

    // Format number with K suffix
    const formatNum = (n) => {
        if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
        if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
        return n?.toLocaleString() || '0';
    };

    // Time ago helper
    const timeAgo = (ts) => {
        const s = Math.floor((Date.now() - ts) / 1000);
        if (s < 5) return 'now';
        if (s < 60) return `${s}s`;
        if (s < 3600) return `${Math.floor(s / 60)}m`;
        return `${Math.floor(s / 3600)}h`;
    };

    return (
        <div className="arena-page" id="arena-page">
            {/* ═══ LIVE STATS TICKER ═══ */}
            <div className="arena-ticker">
                <div className="arena-ticker__inner">
                    <div className="arena-ticker__item arena-ticker__status">
                        <span className={`arena-ticker__dot ${wsConnected ? 'arena-ticker__dot--live' : ''}`} />
                        <span className="arena-ticker__label">
                            {wsConnected ? 'LIVE' : 'CONNECTING...'}
                        </span>
                    </div>
                    <div className="arena-ticker__divider" />
                    <div className="arena-ticker__item">
                        <Eye size={13} />
                        <span className="arena-ticker__value">{formatNum(liveStats.viewers)}</span>
                        <span className="arena-ticker__label">Watching</span>
                    </div>
                    <div className="arena-ticker__divider" />
                    <div className="arena-ticker__item">
                        <Zap size={13} />
                        <span className="arena-ticker__value">{formatNum(liveStats.activeBetsPool)}</span>
                        <span className="arena-ticker__label">Pool</span>
                    </div>
                    <div className="arena-ticker__divider" />
                    <div className="arena-ticker__item">
                        <Trophy size={13} />
                        <span className="arena-ticker__value">{liveStats.matchesPlayedToday}</span>
                        <span className="arena-ticker__label">Matches</span>
                    </div>
                    <div className="arena-ticker__divider" />
                    <div className="arena-ticker__item">
                        <TrendingUp size={13} />
                        <span className="arena-ticker__value">{formatNum(liveStats.totalBetsToday)}</span>
                        <span className="arena-ticker__label">Volume</span>
                    </div>
                    <div className="arena-ticker__divider" />
                    <div className="arena-ticker__item arena-ticker__game-state">
                        <Flame size={13} />
                        <span className={`arena-ticker__badge arena-ticker__badge--${gameState.toLowerCase()}`}>
                            {gameState === 'LIVE' ? '⚔️ FIGHTING' : gameState === 'BETTING' ? '🎰 BETS OPEN' : gameState === 'WAITING' ? '⏳ NEXT MATCH' : '🏆 FINISHED'}
                        </span>
                    </div>
                </div>
            </div>

            {/* ═══ MAIN CONTENT GRID ═══ */}
            <div className="arena-content">

                {/* ─── LEFT: Activity Feed + Recent Results ─── */}
                <div className="arena-left-panel">
                    {/* Activity Feed */}
                    <div className="arena-feed">
                        <div className="arena-feed__header">
                            <Activity size={14} />
                            <span>Live Feed</span>
                            <span className="arena-feed__count">{activityFeed.length}</span>
                        </div>
                        <div className="arena-feed__list" ref={activityFeedRef}>
                            {activityFeed.slice(0, 20).map((event) => (
                                <div key={event.id} className="arena-feed__item" style={{ '--feed-color': event.color }}>
                                    <span className="arena-feed__icon">{event.icon}</span>
                                    <span className="arena-feed__text">{event.text}</span>
                                    <span className="arena-feed__time">{timeAgo(event.timestamp)}</span>
                                </div>
                            ))}
                            {activityFeed.length === 0 && (
                                <div className="arena-feed__empty">
                                    <Radio size={16} />
                                    <span>Waiting for events...</span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Recent Results */}
                    <div className="arena-results">
                        <div className="arena-results__header">
                            <Trophy size={14} />
                            <span>Recent Results</span>
                        </div>
                        <div className="arena-results__list">
                            {recentResults.slice(0, 5).map((r) => (
                                <div key={r.id} className="arena-results__item">
                                    <div className="arena-results__fighters">
                                        <span className="arena-results__winner" style={{ color: r.winner.color }}>
                                            {r.winner.avatar} {r.winner.name}
                                        </span>
                                        <span className="arena-results__vs">beat</span>
                                        <span className="arena-results__loser">
                                            {r.loser.avatar} {r.loser.name}
                                        </span>
                                    </div>
                                    <div className="arena-results__meta">
                                        <span className="arena-results__method">{r.method}</span>
                                        <span className="arena-results__reward">+{r.monEarned} MON</span>
                                    </div>
                                </div>
                            ))}
                            {recentResults.length === 0 && (
                                <div className="arena-feed__empty">
                                    <Clock size={14} />
                                    <span>No results yet</span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Upcoming Matches */}
                    <div className="arena-upcoming-panel">
                        <div className="arena-upcoming-panel__header">
                            <Swords size={14} />
                            <span>Up Next</span>
                        </div>
                        <div className="arena-upcoming-panel__list">
                            {upcomingMatches.slice(0, 4).map((m, idx) => (
                                <div key={m.id} className="arena-upcoming-panel__item">
                                    <span className="arena-upcoming-panel__num">#{idx + 2}</span>
                                    <div className="arena-upcoming-panel__matchup">
                                        <span style={{ color: m.agent1.color }}>{m.agent1.avatar} {m.agent1.name}</span>
                                        <span className="arena-upcoming-panel__vs-small">vs</span>
                                        <span style={{ color: m.agent2.color }}>{m.agent2.name} {m.agent2.avatar}</span>
                                    </div>
                                    <span className="arena-upcoming-panel__odds">{m.agent1Odds}x</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* ─── CENTER: Main Arena ─── */}
                <div className="arena-main">

                    {/* Match Header */}
                    {currentMatch && (
                        <div className={`arena-match-header arena-match-header--${gameState.toLowerCase()}`}>
                            {/* Agent 1 */}
                            <div className="match-competitor competitor--left">
                                <div className="competitor-avatar" style={{
                                    borderColor: currentMatch.agent1.color,
                                    boxShadow: `0 0 20px ${currentMatch.agent1.color}40`
                                }}>
                                    {currentMatch.agent1.avatar}
                                </div>
                                <div className="competitor-info">
                                    <h2 className="competitor-name" style={{ color: currentMatch.agent1.color }}>
                                        {currentMatch.agent1.name}
                                    </h2>
                                    <div className="competitor-meta">
                                        <span className="competitor-rank">#{currentMatch.agent1.rank}</span>
                                        <span className="competitor-weapon">{currentMatch.agent1.weapon.icon}</span>
                                        <span className="competitor-power">
                                            <Zap size={10} /> {currentMatch.agent1.powerRating}
                                        </span>
                                    </div>
                                    {liveAgentState?.['1'] && (
                                        <div className="competitor-hp-bar">
                                            <div className="competitor-hp-fill" style={{
                                                width: `${(liveAgentState['1'].hp / liveAgentState['1'].maxHp) * 100}%`,
                                                background: liveAgentState['1'].hp / liveAgentState['1'].maxHp > 0.5 ? 'var(--gradient-success)' : liveAgentState['1'].hp / liveAgentState['1'].maxHp > 0.25 ? 'var(--gradient-gold)' : 'var(--gradient-danger)',
                                            }} />
                                            <span className="competitor-hp-text">{Math.round(liveAgentState['1'].hp)} HP</span>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Center */}
                            <div className="match-center-display">
                                <div className={`match-timer-large ${gameState === 'LIVE' && liveMatchState?.roundTimer <= 10 ? 'match-timer--danger' : ''}`}>
                                    {gameState === 'LIVE' && liveMatchState
                                        ? Math.floor(liveMatchState.roundTimer)
                                        : timeLeft}
                                    <span className="timer-unit">s</span>
                                </div>
                                <div className={`match-status-pill match-status-pill--${gameState.toLowerCase()}`}>
                                    {gameState === 'FINISHED' ? '🏆 FINISHED' :
                                        gameState === 'LIVE' && liveMatchState ? `⚔️ ROUND ${liveMatchState.currentRound}/${liveMatchState.maxRounds}` :
                                            gameState === 'BETTING' ? '🎰 PLACE BETS' : '⏳ STARTING SOON'}
                                </div>
                                {gameState === 'LIVE' && liveAgentState && (
                                    <div className="match-live-stats">
                                        <span><Target size={10} /> {(liveAgentState['1']?.hitsLanded || 0) + (liveAgentState['2']?.hitsLanded || 0)} hits</span>
                                        <span><Sparkles size={10} /> {(liveAgentState['1']?.critHits || 0) + (liveAgentState['2']?.critHits || 0)} crits</span>
                                    </div>
                                )}
                            </div>

                            {/* Agent 2 */}
                            <div className="match-competitor competitor--right">
                                <div className="competitor-info">
                                    <h2 className="competitor-name" style={{ color: currentMatch.agent2.color }}>
                                        {currentMatch.agent2.name}
                                    </h2>
                                    <div className="competitor-meta">
                                        <span className="competitor-power">
                                            <Zap size={10} /> {currentMatch.agent2.powerRating}
                                        </span>
                                        <span className="competitor-weapon">{currentMatch.agent2.weapon.icon}</span>
                                        <span className="competitor-rank">#{currentMatch.agent2.rank}</span>
                                    </div>
                                    {liveAgentState?.['2'] && (
                                        <div className="competitor-hp-bar">
                                            <div className="competitor-hp-fill" style={{
                                                width: `${(liveAgentState['2'].hp / liveAgentState['2'].maxHp) * 100}%`,
                                                background: liveAgentState['2'].hp / liveAgentState['2'].maxHp > 0.5 ? 'var(--gradient-success)' : liveAgentState['2'].hp / liveAgentState['2'].maxHp > 0.25 ? 'var(--gradient-gold)' : 'var(--gradient-danger)',
                                            }} />
                                            <span className="competitor-hp-text">{Math.round(liveAgentState['2'].hp)} HP</span>
                                        </div>
                                    )}
                                </div>
                                <div className="competitor-avatar" style={{
                                    borderColor: currentMatch.agent2.color,
                                    boxShadow: `0 0 20px ${currentMatch.agent2.color}40`
                                }}>
                                    {currentMatch.agent2.avatar}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Match Content Area */}
                    <div className="arena-match-content">
                        {/* WAITING or BETTING */}
                        {(gameState === 'WAITING' || gameState === 'BETTING') && (
                            <div className="arena-placeholder">
                                <div className={`arena-placeholder__state arena-placeholder__state--${gameState.toLowerCase()}`}>
                                    <div className="arena-placeholder__icon">
                                        {gameState === 'BETTING' ? '🎰' : '⚔️'}
                                    </div>
                                    <h2 className="arena-placeholder__title text-display">
                                        {gameState === 'BETTING' ? 'BETS ARE OPEN' : 'PREPARING MATCH'}
                                    </h2>
                                    <div className="arena-placeholder__timer">{timeLeft}</div>
                                    <p className="arena-placeholder__subtitle">
                                        {gameState === 'BETTING'
                                            ? 'Place your bets before the timer runs out!'
                                            : `Match #${matchCount + 1} starting soon...`
                                        }
                                    </p>
                                    {gameState === 'WAITING' && currentMatch && (
                                        <div className="arena-placeholder__preview">
                                            <div className="arena-placeholder__fighter" style={{ color: currentMatch.agent1.color }}>
                                                <span className="arena-placeholder__fighter-avatar">{currentMatch.agent1.avatar}</span>
                                                <span>{currentMatch.agent1.name}</span>
                                            </div>
                                            <span className="arena-placeholder__vs text-display">VS</span>
                                            <div className="arena-placeholder__fighter" style={{ color: currentMatch.agent2.color }}>
                                                <span className="arena-placeholder__fighter-avatar">{currentMatch.agent2.avatar}</span>
                                                <span>{currentMatch.agent2.name}</span>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* LIVE or FINISHED */}
                        {(gameState === 'LIVE' || gameState === 'FINISHED') && (
                            <div className="game-canvas-container">
                                {gameState === 'FINISHED' && matchResult && winnerAgent && (
                                    <div className="arena-result-banner" style={{ '--winner-color': winnerAgent.color }}>
                                        <div className="arena-result-banner__content">
                                            <span className="arena-result-banner__trophy">🏆</span>
                                            <div className="arena-result-banner__info">
                                                <span className="arena-result-banner__winner" style={{ color: winnerAgent.color }}>
                                                    {winnerAgent.name} WINS!
                                                </span>
                                                <span className="arena-result-banner__reason">
                                                    {matchResult.reason === 'ko' ? '💀 KNOCKOUT' : matchResult.reason === 'decision' ? '⚖️ DECISION' : '⏱️ TIME OUT'}
                                                    {matchResult.duration ? ` · ${matchResult.duration}s` : ''}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                )}
                                    <GameCanvas
                                        key={`${currentMatch?.id}-${matchKey}`}
                                        agent1={currentMatch?.agent1}
                                        agent2={currentMatch?.agent2}
                                        onStateUpdate={handleStateUpdate}
                                        onMatchEnd={handleMatchEnd}
                                        isPlaying={gameState === 'LIVE'}
                                        agent1Equipment={getEquipmentBonus(currentMatch?.agent1?.id)}
                                        agent2Equipment={getEquipmentBonus(currentMatch?.agent2?.id)}
                                    />
                            </div>
                        )}
                    </div>

                    {/* Live Chat */}
                    <div className="arena-chat-section">
                        <LiveChat gameState={gameState} walletConnected={!!account} />
                    </div>
                </div>

                {/* ─── RIGHT: Betting Panel ─── */}
                <div className="arena-sidebar">
                    <BetPanel
                        match={currentMatch}
                        walletConnected={!!account}
                        disabled={gameState !== 'BETTING'}
                        timer={gameState === 'BETTING' ? timeLeft : null}
                    />

                    {/* Mini Leaderboard */}
                    <div className="arena-mini-leaderboard">
                        <div className="arena-mini-leaderboard__header">
                            <BarChart3 size={14} />
                            <span>Top Fighters</span>
                        </div>
                        <div className="arena-mini-leaderboard__list">
                            {(liveStats.agents || AGENTS).slice(0, 5).map((a, idx) => (
                                <div key={a.id} className="arena-mini-leaderboard__item">
                                    <span className="arena-mini-leaderboard__rank">
                                        {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`}
                                    </span>
                                    <span className="arena-mini-leaderboard__avatar">{a.avatar}</span>
                                    <span className="arena-mini-leaderboard__name" style={{ color: a.color }}>{a.name}</span>
                                    <span className="arena-mini-leaderboard__stats">{a.wins}W</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
