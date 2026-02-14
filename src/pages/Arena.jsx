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
import { io as socketIO } from 'socket.io-client';
import { useWallet } from '../context/WalletContext';
import GameCanvas from '../components/GameCanvas';
import BetPanel from '../components/BetPanel';
import LiveChat from '../components/LiveChat';
import { PLATFORM_STATS, AGENTS } from '../data/mockData';
import { calculateEquipmentBonus } from '../data/inventory';
import { useInventory } from '../context/InventoryContext';
import { playSound } from '../utils/audio';
import './Arena.css';

// ── API Config ──
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api/v1';
const SOCKET_URL = API_URL.replace('/api/v1', '') || window.location.origin;

export default function Arena() {
    // ── Game Loop State (driven by backend matchmaker) ──
    const [gameState, setGameState] = useState('WAITING');
    const [timeLeft, setTimeLeft] = useState(0);
    const [currentMatch, setCurrentMatch] = useState(null);

    // ── Simulation State (for GameCanvas) ──
    const [liveAgentState, setLiveAgentState] = useState(null);
    const [liveMatchState, setLiveMatchState] = useState(null);
    const [matchResult, setMatchResult] = useState(null);
    const [matchKey, setMatchKey] = useState(0);

    // ── Live Data State ──
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
    const socketRef = useRef(null);
    const activityFeedRef = useRef(null);
    const gameStateRef = useRef(gameState);

    // Keep gameStateRef in sync
    useEffect(() => {
        gameStateRef.current = gameState;
    }, [gameState]);

    // ── Socket.IO Connection to Backend Matchmaker ──
    useEffect(() => {
        const socket = socketIO(SOCKET_URL, {
            transports: ['websocket', 'polling'],
            reconnectionDelay: 2000,
            reconnectionAttempts: Infinity,
        });
        socketRef.current = socket;

        socket.on('connect', () => {
            setWsConnected(true);
            console.log('[Socket.IO] Connected to Arena');
        });

        socket.on('disconnect', () => {
            setWsConnected(false);
        });

        // ── Match phase updates from backend matchmaker ──
        socket.on('match:phase', (data) => {
            const { phase, match, timeLeft: tl, result } = data;

            if (match) {
                setCurrentMatch(match);
            }

            if (phase === 'BETTING') {
                setGameState('BETTING');
                setTimeLeft(tl || 30);
                setMatchResult(null);
                setLiveAgentState(null);
                setLiveMatchState(null);
                setMatchKey(k => k + 1);
            } else if (phase === 'FIGHTING') {
                setGameState('LIVE');
            } else if (phase === 'RESULT') {
                if (result) setMatchResult(result);
                setGameState('FINISHED');
                setTimeLeft(10);
                setMatchCount(c => c + 1);
            } else if (phase === 'COOLDOWN') {
                setGameState('WAITING');
                setTimeLeft(5);
            }
        });

        // New match announced
        socket.on('match:new', (match) => {
            setCurrentMatch(match);
        });

        // Match data updated (bets changed)
        socket.on('match:update', (match) => {
            setCurrentMatch(match);
        });

        // Betting timer countdown
        socket.on('match:timer', ({ timeLeft: tl }) => {
            setTimeLeft(tl);
        });

        // Fight events (hits, combos, etc.)
        socket.on('match:fight_event', (event) => {
            setActivityFeed(prev => [
                { ...event, id: Date.now() + Math.random(), timestamp: Date.now() },
                ...prev,
            ].slice(0, 30));
        });

        // Match result
        socket.on('match:result', (result) => {
            setRecentResults(prev => [result, ...prev].slice(0, 10));
        });

        // Match history on initial connect
        socket.on('match:history', (history) => {
            setRecentResults(history);
        });

        // Live stats from backend
        socket.on('arena:live_stats', (stats) => {
            setLiveStats(prev => ({ ...prev, ...stats }));
        });

        // Live activity events from backend
        socket.on('arena:live_event', (event) => {
            setActivityFeed(prev => [
                { ...event, id: Date.now() + Math.random(), timestamp: Date.now() },
                ...prev,
            ].slice(0, 30));
        });

        return () => {
            socket.disconnect();
        };
    }, []);

    // ── Countdown timer for WAITING and FINISHED states ──
    useEffect(() => {
        if (gameState === 'WAITING' || gameState === 'FINISHED') {
            const interval = setInterval(() => {
                setTimeLeft(prev => Math.max(0, prev - 1));
            }, 1000);
            return () => clearInterval(interval);
        }
    }, [gameState]);

    // ── Sound Effects ──
    useEffect(() => {
        if (gameState === 'LIVE') playSound('bell');
        else if (gameState === 'FINISHED') playSound('cheer');
    }, [gameState]);

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

    // GameCanvas may fire its own match end - ignore it.
    // We rely solely on backend matchmaker's match:phase RESULT event.
    const handleMatchEnd = useCallback(() => {
        // No-op: backend controls match lifecycle
    }, []);

    // ── Computed ──
    const winnerAgent = useMemo(() => {
        if (!matchResult || !currentMatch) return null;
        // matchResult.winnerId is '1' or '2', matchResult.winner is { name, avatar, color }
        if (matchResult.winnerId === '1') return currentMatch.agent1;
        if (matchResult.winnerId === '2') return currentMatch.agent2;
        // Fallback: use the winner object from the result directly
        return matchResult.winner || null;
    }, [matchResult, currentMatch]);

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
                            {recentResults.slice(0, 5).map((r, idx) => (
                                <div key={r.matchId || r.id || idx} className="arena-results__item">
                                    <div className="arena-results__fighters">
                                        <span className="arena-results__winner" style={{ color: r.winner?.color || '#FFE93E' }}>
                                            {r.winner?.avatar} {r.winner?.name || 'Unknown'}
                                        </span>
                                        <span className="arena-results__vs">beat</span>
                                        <span className="arena-results__loser">
                                            {r.loser?.avatar} {r.loser?.name || 'Unknown'}
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

                    {/* Recent Matchups */}
                    <div className="arena-upcoming-panel">
                        <div className="arena-upcoming-panel__header">
                            <Swords size={14} />
                            <span>Recent Matchups</span>
                        </div>
                        <div className="arena-upcoming-panel__list">
                            {recentResults.slice(0, 4).map((m, idx) => (
                                <div key={m.matchId || idx} className="arena-upcoming-panel__item">
                                    <span className="arena-upcoming-panel__num">#{idx + 1}</span>
                                    <div className="arena-upcoming-panel__matchup">
                                        <span style={{ color: m.winner?.color || '#FFE93E' }}>{m.winner?.avatar} {m.winner?.name}</span>
                                        <span className="arena-upcoming-panel__vs-small">vs</span>
                                        <span style={{ color: m.loser?.color || '#888' }}>{m.loser?.name} {m.loser?.avatar}</span>
                                    </div>
                                    <span className="arena-upcoming-panel__odds">{m.method}</span>
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
                                        <span className="competitor-weapon">{currentMatch.agent1.weapon?.icon || '👊'}</span>
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
                                        <span className="competitor-weapon">{currentMatch.agent2.weapon?.icon || '👊'}</span>
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
                                                    {(matchResult.method || matchResult.reason || '').toLowerCase().includes('ko') ? '💀 KNOCKOUT' 
                                                        : (matchResult.method || matchResult.reason || '').toLowerCase().includes('decision') ? '⚖️ DECISION' 
                                                        : '⏱️ TIME OUT'}
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
                        onBetPlaced={(bet) => {
                            if (socketRef.current) {
                                socketRef.current.emit('match:bet', bet);
                            }
                        }}
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
