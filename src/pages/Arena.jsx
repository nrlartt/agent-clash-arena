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
import { AGENTS } from '../data/mockData';
import { calculateEquipmentBonus } from '../data/inventory';
import { useInventory } from '../context/InventoryContext';
import { playSound } from '../utils/audio';
import contractService from '../services/contractService';
import './Arena.css';

// ── API Config ──
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api/v1';
const SOCKET_URL = API_URL.replace('/api/v1', '') || window.location.origin;
const WAITING_REASON_LABELS = {
    NO_REAL_AGENTS: 'Not enough real agents. Waiting for new registrations.',
    CHAIN_NOT_CONFIGURED: 'On-chain service is not configured. Waiting for contract setup.',
    CHAIN_CREATE_FAILED: 'Could not create the match on-chain. Retrying shortly.',
};

export default function Arena() {
    // ── Game Loop State (driven by backend matchmaker) ──
    const [gameState, setGameState] = useState('WAITING');
    const [timeLeft, setTimeLeft] = useState(0);
    const [currentMatch, setCurrentMatch] = useState(null);

    // ── Simulation State (for GameCanvas) ──
    const [liveAgentState, setLiveAgentState] = useState(null);
    const [matchResult, setMatchResult] = useState(null);
    const [matchKey, setMatchKey] = useState(0);
    const [finalStats, setFinalStats] = useState(null); // Captured at match end

    // ── Server-authoritative fight state ──
    const [serverFightState, setServerFightState] = useState(null);
    const [fightRound, setFightRound] = useState(1);
    const [fightMaxRounds, setFightMaxRounds] = useState(3);
    const [fightRoundPaused, setFightRoundPaused] = useState(false);
    const receivingServerTicks = useRef(false);

    // ── Live Data State ──
    const [liveStats, setLiveStats] = useState({
        viewers: 0,
        totalBetsToday: 0,
        matchesPlayedToday: 0,
        activeBetsPool: 0,
        minPoolMON: 0,
        poolRemainingMON: 0,
        poolReady: false,
    });
    const [activityFeed, setActivityFeed] = useState([]);
    const [recentResults, setRecentResults] = useState([]);
    const [wsConnected, setWsConnected] = useState(false);
    const [waitingReason, setWaitingReason] = useState(null);
    const [waitingMessage, setWaitingMessage] = useState(null);

    // ── User Bet Tracking & Claim ──
    // pendingClaim persists across match transitions so the claim button stays visible
    const [pendingClaim, setPendingClaim] = useState(null); // { matchId, side, amount, agentName, winnerId, status, txHash, error }
    const [currentBetSide, setCurrentBetSide] = useState(null); // side bet on current match

    const { account, provider, isMonad, fetchBalance } = useWallet();
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

        // Load current live state once from REST for quick hydration.
        const loadInitialArenaState = async () => {
            try {
                const [statsRes, resultsRes, currentRes] = await Promise.all([
                    fetch(`${API_URL}/arena/live-stats`),
                    fetch(`${API_URL}/arena/recent-results`),
                    fetch(`${API_URL}/arena/current`),
                ]);

                const [statsJson, resultsJson, currentJson] = await Promise.all([
                    statsRes.json().catch(() => null),
                    resultsRes.json().catch(() => null),
                    currentRes.json().catch(() => null),
                ]);

                if (statsJson?.success && statsJson.data) {
                    setLiveStats(prev => ({ ...prev, ...statsJson.data }));
                }
                if (resultsJson?.success && Array.isArray(resultsJson.data)) {
                    setRecentResults(resultsJson.data);
                }
                if (currentJson?.success && currentJson.data) {
                    const { phase, match, timeLeft: tl, waitingReason: reason, waitingMessage: message, fightTick } = currentJson.data;
                    setCurrentMatch(match || null);
                    setWaitingReason(reason || null);
                    setWaitingMessage(message || null);
                    if (phase === 'BETTING') {
                        setGameState('BETTING');
                        setTimeLeft(tl || 0);
                    } else if (phase === 'FIGHTING' || phase === 'LIVE') {
                        setGameState('LIVE');
                        // Hydrate fight tick state if available
                        if (fightTick) {
                            receivingServerTicks.current = true;
                            setServerFightState(fightTick);
                            if (fightTick.fighters) setLiveAgentState(fightTick.fighters);
                            if (fightTick.round) setFightRound(fightTick.round);
                            if (fightTick.maxRounds) setFightMaxRounds(fightTick.maxRounds);
                            if (typeof fightTick.roundTimer === 'number') setTimeLeft(fightTick.roundTimer);
                            setFightRoundPaused(!!fightTick.roundPaused);
                        } else if (typeof tl === 'number') {
                            setTimeLeft(tl);
                        }
                    } else if (phase === 'RESULT') {
                        setGameState('FINISHED');
                    } else {
                        setGameState('WAITING');
                        setTimeLeft(typeof tl === 'number' ? tl : 0);
                    }
                }
            } catch {
                // WebSocket stream still handles live state.
            }
        };
        loadInitialArenaState();

        // ── Match phase updates from backend matchmaker ──
        socket.on('match:phase', (data) => {
            const { phase, match, timeLeft: tl, result, reason, message } = data;

            if (Object.prototype.hasOwnProperty.call(data, 'match')) {
                setCurrentMatch(match || null);
            }

            if (phase === 'BETTING') {
                setWaitingReason(null);
                setWaitingMessage(null);
                setGameState('BETTING');
                setTimeLeft(tl || 30);
                setMatchResult(null);
                setFinalStats(null);
                setLiveAgentState(null);
                setServerFightState(null);
                receivingServerTicks.current = false;
                setFightRound(1);
                setFightMaxRounds(3);
                setFightRoundPaused(false);
                setMatchKey(k => k + 1);
                // Reset current-match bet tracking, but keep pendingClaim alive
                setCurrentBetSide(null);
                // Auto-clear claimed/lost claims after match ends
                setPendingClaim(prev => {
                    if (!prev) return null;
                    if (prev.status === 'claimed' || prev.status === 'lost') return null;
                    return prev; // Keep 'ready', 'claiming', 'error' alive
                });
            } else if (phase === 'FIGHTING') {
                setWaitingReason(null);
                setWaitingMessage(null);
                setGameState('LIVE');
                receivingServerTicks.current = true;
                if (typeof tl === 'number') setTimeLeft(tl);
            } else if (phase === 'RESULT') {
                setWaitingReason(null);
                setWaitingMessage(null);
                if (result) setMatchResult(result);
                // Capture final combat stats from server fight result or live state
                if (result?.fightStats) {
                    setFinalStats(result.fightStats);
                } else {
                    setFinalStats(prev => prev);
                    setLiveAgentState(current => {
                        if (current) setFinalStats(current);
                        return current;
                    });
                }
                receivingServerTicks.current = false;
                setServerFightState(null);
                setGameState('FINISHED');
                setTimeLeft(10);

                // Determine claim state based on user's bet on this match
                setCurrentBetSide(prevSide => {
                    if (prevSide && result && match) {
                        const userWon = prevSide === result.winnerId;
                        const betAgent = prevSide === '1' ? match.agent1 : match.agent2;
                        if (userWon && result.onChainResolved) {
                            setPendingClaim({
                                matchId: match.id || result.matchId,
                                side: prevSide,
                                amount: null, // will be read from contract if needed
                                agentName: betAgent?.name || 'Winner',
                                winnerId: result.winnerId,
                                status: 'ready',
                                txHash: null,
                                error: null,
                            });
                        } else if (userWon && !result.onChainResolved) {
                            setPendingClaim({
                                matchId: match.id || result.matchId,
                                side: prevSide,
                                agentName: betAgent?.name || 'Winner',
                                winnerId: result.winnerId,
                                status: 'error',
                                txHash: null,
                                error: 'Match could not be resolved on-chain. Please contact support.',
                            });
                        } else {
                            setPendingClaim({
                                matchId: match.id || result.matchId,
                                side: prevSide,
                                agentName: betAgent?.name || '',
                                winnerId: result.winnerId,
                                status: 'lost',
                                txHash: null,
                                error: null,
                            });
                        }
                    }
                    return prevSide;
                });
            } else if (phase === 'COOLDOWN' || phase === 'WAITING' || phase === 'IDLE') {
                setWaitingReason(reason || null);
                setWaitingMessage(message || null);
                setGameState('WAITING');
                setTimeLeft(typeof tl === 'number' ? tl : 0);
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
        socket.on('match:timer', ({ timeLeft: tl, currentPool, minPool }) => {
            setTimeLeft(tl);
            if (typeof currentPool === 'number' || typeof minPool === 'number') {
                setCurrentMatch(prev => {
                    if (!prev) return prev;
                    return {
                        ...prev,
                        totalBets: typeof currentPool === 'number' ? currentPool : prev.totalBets,
                        poolMinMON: typeof minPool === 'number' ? minPool : prev.poolMinMON,
                    };
                });
            }
        });

        // ── Server-authoritative fight ticks (every 500ms during FIGHTING) ──
        socket.on('match:fight_tick', (tick) => {
            if (!tick || !tick.fighters) return;
            receivingServerTicks.current = true;
            setServerFightState(tick);
            setLiveAgentState(tick.fighters);
            if (typeof tick.roundTimer === 'number') setTimeLeft(tick.roundTimer);
            if (tick.round) setFightRound(tick.round);
            if (tick.maxRounds) setFightMaxRounds(tick.maxRounds);
            setFightRoundPaused(!!tick.roundPaused);
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

        socket.on('bet:error', ({ error }) => {
            setActivityFeed(prev => [
                {
                    id: Date.now() + Math.random(),
                    type: 'bet_error',
                    icon: '⚠️',
                    text: error || 'Bet rejected',
                    color: '#FF6B35',
                    timestamp: Date.now(),
                },
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
        // When receiving server fight ticks, skip local engine ticks for liveAgentState
        // Server ticks are authoritative for HP, stats, etc.
        if (receivingServerTicks.current) return;
        if (update.type === 'tick') {
            setLiveAgentState(update.agents);
        }
    }, []);

    // ── Claim Winnings Handler ──
    const handleClaimWinnings = useCallback(async () => {
        if (!pendingClaim?.matchId || (pendingClaim.status !== 'ready' && pendingClaim.status !== 'error')) return;
        setPendingClaim(prev => ({ ...prev, status: 'claiming', error: null }));
        try {
            // Initialize contract if needed
            if (provider && isMonad && contractService.isConfigured && !contractService.contract) {
                await contractService.init(provider);
            }
            const result = await contractService.claimWinnings(pendingClaim.matchId);
            setPendingClaim(prev => ({ ...prev, status: 'claimed', txHash: result.txHash }));
            playSound('cheer');
            if (fetchBalance) fetchBalance();
        } catch (err) {
            console.error('[Arena] claimWinnings failed:', err);
            setPendingClaim(prev => ({
                ...prev,
                status: 'error',
                error: err?.reason || err?.shortMessage || err?.message || 'Failed to claim winnings.',
            }));
        }
    }, [pendingClaim, provider, isMonad, fetchBalance]);

    // Keep timer synchronized across clients by using phase end timestamp.
    // During LIVE state, fight ticks from server provide the round timer instead.
    useEffect(() => {
        const phaseEndsAt = Number(currentMatch?.phaseEndsAt || 0);
        if (!phaseEndsAt) return undefined;
        // Only sync from phaseEndsAt during BETTING; LIVE uses server fight ticks
        if (gameState !== 'BETTING') return undefined;

        const syncTimer = () => {
            const remaining = Math.max(0, Math.ceil((phaseEndsAt - Date.now()) / 1000));
            setTimeLeft(remaining);
        };
        syncTimer();
        const interval = setInterval(syncTimer, 1000);
        return () => clearInterval(interval);
    }, [gameState, currentMatch?.id, currentMatch?.phaseEndsAt]);

    // GameCanvas may fire its own match end - ignore it.
    // We rely solely on backend matchmaker's match:phase RESULT event.
    const handleMatchEnd = useCallback(() => {
        // No-op: backend controls match lifecycle
    }, []);

    const sendBetToBackend = useCallback((bet) => (
        new Promise((resolve) => {
            const socket = socketRef.current;
            if (!socket || !wsConnected) {
                resolve({ ok: false, error: 'Live connection lost. Please retry.' });
                return;
            }

            // Track user's bet for claim UI
            if (bet.side && currentMatch?.id) {
                setCurrentBetSide(bet.side);
            }

            let settled = false;
            const timeout = setTimeout(() => {
                if (settled) return;
                settled = true;
                resolve({ ok: false, error: 'Arena server confirmation timed out.' });
            }, 10000);

            socket.emit('match:bet', bet, (response) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                resolve(response || { ok: false, error: 'No response from arena server.' });
            });
        })
    ), [wsConnected, currentMatch?.id]);

    // ── Computed ──
    const winnerAgent = useMemo(() => {
        if (!matchResult || !currentMatch) return null;
        // matchResult.winnerId is '1' or '2', matchResult.winner is { name, avatar, color }
        if (matchResult.winnerId === '1') return currentMatch.agent1;
        if (matchResult.winnerId === '2') return currentMatch.agent2;
        // Fallback: use the winner object from the result directly
        return matchResult.winner || null;
    }, [matchResult, currentMatch]);

    const poolMinMON = Number(currentMatch?.poolMinMON || liveStats.minPoolMON || 0);
    const poolCurrentMON = Number(currentMatch?.totalBets || liveStats.activeBetsPool || 0);
    const poolRemainingMON = Math.max(0, poolMinMON - poolCurrentMON);
    const poolProgressPct = poolMinMON > 0 ? Math.min(100, (poolCurrentMON / poolMinMON) * 100) : 0;

    // Equipment bonus now comes from backend match data (real equipment system)
    const getEquipmentBonus = (agent) => {
        if (!agent) return null;
        // Backend sends equipmentBonus directly from the agent's real equipment
        if (agent.equipmentBonus) return agent.equipmentBonus;
        // Fallback: try frontend inventory context (for user-owned agents)
        const inv = inventories[agent.id];
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
                            {gameState === 'LIVE' ? `⚔️ R${fightRound}/${fightMaxRounds}` : gameState === 'BETTING' ? '🎰 BETS OPEN' : gameState === 'WAITING' ? '⏳ NEXT MATCH' : '🏆 FINISHED'}
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
                                    {currentMatch.agent1.equippedItems?.length > 0 && (
                                        <div className="competitor-equipment">
                                            {currentMatch.agent1.equippedItems.map(item => (
                                                <span key={item.slot} className={`equipment-icon equipment-icon--${item.rarity}`} title={`${item.name} (${item.rarity})`}>
                                                    {item.icon}
                                                </span>
                                            ))}
                                            {currentMatch.agent1.equipmentPower > 0 && (
                                                <span className="equipment-power-badge">
                                                    <Shield size={9} /> +{currentMatch.agent1.equipmentPower}
                                                </span>
                                            )}
                                        </div>
                                    )}
                                    {liveAgentState?.['1'] && (() => {
                                        const hp = liveAgentState['1'].hp;
                                        const maxHp = liveAgentState['1'].maxHp;
                                        const pct = Math.max(0, hp / maxHp);
                                        const hpClass = pct > 0.6 ? 'hp-high' : pct > 0.3 ? 'hp-mid' : 'hp-low';
                                        return (
                                            <div className={`competitor-hp-container ${hpClass}`}>
                                                <div className="competitor-hp-header">
                                                    <span className="competitor-hp-label">HP</span>
                                                    <span className="competitor-hp-value">{Math.round(hp)} / {maxHp}</span>
                                                    <span className={`competitor-hp-pct ${hpClass}`}>{Math.round(pct * 100)}%</span>
                                                </div>
                                                <div className="competitor-hp-bar">
                                                    <div className="competitor-hp-fill" style={{ width: `${pct * 100}%` }} />
                                                    <div className="competitor-hp-shine" />
                                                </div>
                                                {liveAgentState['1'].specialMeter > 0 && (
                                                    <div className="competitor-special-bar">
                                                        <div className={`competitor-special-fill ${liveAgentState['1'].specialReady ? 'special-ready' : ''}`}
                                                             style={{ width: `${liveAgentState['1'].specialMeter}%` }} />
                                                        {liveAgentState['1'].specialReady && <span className="special-ready-text">SPECIAL</span>}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })()}
                                </div>
                            </div>

                            {/* Center */}
                            <div className="match-center-display">
                                <div className={`match-timer-large ${gameState === 'LIVE' && timeLeft <= 10 ? 'match-timer--danger' : ''}`}>
                                    {Math.max(0, timeLeft)}
                                    <span className="timer-unit">s</span>
                                </div>
                                <div className={`match-status-pill match-status-pill--${gameState.toLowerCase()}`}>
                                    {gameState === 'FINISHED' ? '🏆 FINISHED' :
                                        gameState === 'LIVE' ? (
                                            fightRoundPaused
                                                ? `🔔 ROUND ${fightRound}`
                                                : `⚔️ ROUND ${fightRound}/${fightMaxRounds}`
                                        ) :
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
                                    {currentMatch.agent2.equippedItems?.length > 0 && (
                                        <div className="competitor-equipment">
                                            {currentMatch.agent2.equippedItems.map(item => (
                                                <span key={item.slot} className={`equipment-icon equipment-icon--${item.rarity}`} title={`${item.name} (${item.rarity})`}>
                                                    {item.icon}
                                                </span>
                                            ))}
                                            {currentMatch.agent2.equipmentPower > 0 && (
                                                <span className="equipment-power-badge">
                                                    <Shield size={9} /> +{currentMatch.agent2.equipmentPower}
                                                </span>
                                            )}
                                        </div>
                                    )}
                                    {liveAgentState?.['2'] && (() => {
                                        const hp = liveAgentState['2'].hp;
                                        const maxHp = liveAgentState['2'].maxHp;
                                        const pct = Math.max(0, hp / maxHp);
                                        const hpClass = pct > 0.6 ? 'hp-high' : pct > 0.3 ? 'hp-mid' : 'hp-low';
                                        return (
                                            <div className={`competitor-hp-container ${hpClass}`}>
                                                <div className="competitor-hp-header">
                                                    <span className="competitor-hp-label">HP</span>
                                                    <span className="competitor-hp-value">{Math.round(hp)} / {maxHp}</span>
                                                    <span className={`competitor-hp-pct ${hpClass}`}>{Math.round(pct * 100)}%</span>
                                                </div>
                                                <div className="competitor-hp-bar">
                                                    <div className="competitor-hp-fill" style={{ width: `${pct * 100}%` }} />
                                                    <div className="competitor-hp-shine" />
                                                </div>
                                                {liveAgentState['2'].specialMeter > 0 && (
                                                    <div className="competitor-special-bar">
                                                        <div className={`competitor-special-fill ${liveAgentState['2'].specialReady ? 'special-ready' : ''}`}
                                                             style={{ width: `${liveAgentState['2'].specialMeter}%` }} />
                                                        {liveAgentState['2'].specialReady && <span className="special-ready-text">SPECIAL</span>}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })()}
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
                                        {gameState === 'BETTING' ? 'BETS ARE OPEN' : 'MATCH WAITING'}
                                    </h2>
                                    <div className="arena-placeholder__timer">{Math.max(0, timeLeft)}</div>
                                    <p className="arena-placeholder__subtitle">
                                        {gameState === 'BETTING'
                                            ? 'The match starts automatically when the pool threshold is reached.'
                                            : waitingMessage || WAITING_REASON_LABELS[waitingReason] || (currentMatch?.id ? `${currentMatch.id} starting soon...` : 'Waiting for match conditions...')
                                        }
                                    </p>
                                    {gameState === 'BETTING' && poolMinMON > 0 && (
                                        <div className="arena-placeholder__pool-progress">
                                            <div className="arena-placeholder__pool-header">
                                                <span>Pool</span>
                                                <span>{poolCurrentMON.toFixed(2)} / {poolMinMON.toFixed(2)} MON</span>
                                            </div>
                                            <div className="arena-placeholder__pool-bar">
                                                <div
                                                    className="arena-placeholder__pool-fill"
                                                    style={{ width: `${poolProgressPct}%` }}
                                                />
                                            </div>
                                            <div className="arena-placeholder__pool-meta">
                                                {poolRemainingMON > 0
                                                    ? `${poolRemainingMON.toFixed(2)} MON more needed`
                                                    : 'Pool ready, match starting...'}
                                            </div>
                                        </div>
                                    )}
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
                                {gameState === 'FINISHED' && matchResult && winnerAgent && currentMatch && (
                                    <div className="match-result-overlay" style={{ '--winner-color': winnerAgent.color }}>
                                        {/* Winner Announcement */}
                                        <div className="result-header">
                                            <div className="result-header__trophy">🏆</div>
                                            <div className="result-header__text">
                                                <h2 className="result-header__winner" style={{ color: winnerAgent.color }}>
                                                    {winnerAgent.avatar} {winnerAgent.name} WINS!
                                                </h2>
                                                <div className="result-header__method">
                                                    {(matchResult.method || '').toLowerCase().includes('ko') ? '💀 KNOCKOUT' 
                                                        : (matchResult.method || '').toLowerCase().includes('technical') ? '🔥 TECHNICAL KO'
                                                        : '⚖️ DECISION'}
                                                    <span className="result-header__duration">
                                                        <Timer size={11} /> {matchResult.duration || '—'}s
                                                    </span>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Fighter Comparison */}
                                        <div className="result-comparison">
                                            {/* Agent 1 Column */}
                                            <div className={`result-fighter ${matchResult.winnerId === '1' ? 'result-fighter--winner' : 'result-fighter--loser'}`}>
                                                <div className="result-fighter__avatar" style={{ borderColor: currentMatch.agent1.color }}>
                                                    {currentMatch.agent1.avatar}
                                                </div>
                                                <span className="result-fighter__name" style={{ color: currentMatch.agent1.color }}>
                                                    {currentMatch.agent1.name}
                                                </span>
                                                {matchResult.winnerId === '1' && <span className="result-fighter__crown">👑</span>}
                                            </div>

                                            {/* Stats Label Column */}
                                            <div className="result-stats-labels">
                                                <span className="result-stat-label">HP Remaining</span>
                                                <span className="result-stat-label">Power Rating</span>
                                                <span className="result-stat-label">Equipment Power</span>
                                                <span className="result-stat-label">Hits Landed</span>
                                                <span className="result-stat-label">Critical Hits</span>
                                                <span className="result-stat-label">Max Combo</span>
                                                <span className="result-stat-label">Dodges</span>
                                            </div>

                                            {/* Agent 2 Column */}
                                            <div className={`result-fighter ${matchResult.winnerId === '2' ? 'result-fighter--winner' : 'result-fighter--loser'}`}>
                                                <div className="result-fighter__avatar" style={{ borderColor: currentMatch.agent2.color }}>
                                                    {currentMatch.agent2.avatar}
                                                </div>
                                                <span className="result-fighter__name" style={{ color: currentMatch.agent2.color }}>
                                                    {currentMatch.agent2.name}
                                                </span>
                                                {matchResult.winnerId === '2' && <span className="result-fighter__crown">👑</span>}
                                            </div>
                                        </div>

                                        {/* Stat Bars */}
                                        {(() => {
                                            const s1 = finalStats?.['1'] || liveAgentState?.['1'] || {};
                                            const s2 = finalStats?.['2'] || liveAgentState?.['2'] || {};
                                            const a1 = currentMatch.agent1;
                                            const a2 = currentMatch.agent2;

                                            const stats = [
                                                {
                                                    label: 'HP Remaining',
                                                    v1: Math.round(s1.hp || 0),
                                                    v2: Math.round(s2.hp || 0),
                                                    max: Math.max(s1.maxHp || 400, s2.maxHp || 400),
                                                    format: (v, agent, side) => {
                                                        const maxHp = side === 1 ? (s1.maxHp || 400) : (s2.maxHp || 400);
                                                        return `${v} / ${maxHp}`;
                                                    },
                                                },
                                                {
                                                    label: 'Power Rating',
                                                    v1: a1.powerRating || 0,
                                                    v2: a2.powerRating || 0,
                                                    max: Math.max(a1.powerRating || 1, a2.powerRating || 1) * 1.2,
                                                },
                                                {
                                                    label: 'Equipment Power',
                                                    v1: a1.equipmentPower || 0,
                                                    v2: a2.equipmentPower || 0,
                                                    max: Math.max(a1.equipmentPower || 1, a2.equipmentPower || 1, 1) * 1.2,
                                                },
                                                {
                                                    label: 'Hits Landed',
                                                    v1: s1.hitsLanded || 0,
                                                    v2: s2.hitsLanded || 0,
                                                    max: Math.max(s1.hitsLanded || 1, s2.hitsLanded || 1) * 1.2,
                                                },
                                                {
                                                    label: 'Critical Hits',
                                                    v1: s1.critHits || 0,
                                                    v2: s2.critHits || 0,
                                                    max: Math.max(s1.critHits || 1, s2.critHits || 1, 1) * 1.2,
                                                },
                                                {
                                                    label: 'Max Combo',
                                                    v1: s1.maxCombo || 0,
                                                    v2: s2.maxCombo || 0,
                                                    max: Math.max(s1.maxCombo || 1, s2.maxCombo || 1, 1) * 1.2,
                                                },
                                                {
                                                    label: 'Dodges',
                                                    v1: s1.dodges || 0,
                                                    v2: s2.dodges || 0,
                                                    max: Math.max(s1.dodges || 1, s2.dodges || 1, 1) * 1.2,
                                                },
                                            ];

                                            return (
                                                <div className="result-stat-bars">
                                                    {stats.map((stat) => {
                                                        const w1 = stat.max > 0 ? (stat.v1 / stat.max) * 100 : 0;
                                                        const w2 = stat.max > 0 ? (stat.v2 / stat.max) * 100 : 0;
                                                        const lead1 = stat.v1 > stat.v2;
                                                        const lead2 = stat.v2 > stat.v1;
                                                        const display1 = stat.format ? stat.format(stat.v1, a1, 1) : stat.v1;
                                                        const display2 = stat.format ? stat.format(stat.v2, a2, 2) : stat.v2;

                                                        return (
                                                            <div key={stat.label} className="result-stat-row">
                                                                <div className="result-stat-row__left">
                                                                    <span className={`result-stat-row__val ${lead1 ? 'result-stat-row__val--lead' : ''}`}
                                                                          style={lead1 ? { color: a1.color } : {}}>
                                                                        {display1}
                                                                    </span>
                                                                    <div className="result-stat-row__bar result-stat-row__bar--left">
                                                                        <div className="result-stat-row__fill result-stat-row__fill--left"
                                                                             style={{ width: `${Math.min(100, w1)}%`, background: a1.color }} />
                                                                    </div>
                                                                </div>
                                                                <span className="result-stat-row__label">{stat.label}</span>
                                                                <div className="result-stat-row__right">
                                                                    <div className="result-stat-row__bar result-stat-row__bar--right">
                                                                        <div className="result-stat-row__fill result-stat-row__fill--right"
                                                                             style={{ width: `${Math.min(100, w2)}%`, background: a2.color }} />
                                                                    </div>
                                                                    <span className={`result-stat-row__val ${lead2 ? 'result-stat-row__val--lead' : ''}`}
                                                                          style={lead2 ? { color: a2.color } : {}}>
                                                                        {display2}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            );
                                        })()}

                                        {/* Deciding Factors */}
                                        <div className="result-factors">
                                            <span className="result-factors__title">
                                                <BarChart3 size={12} /> Deciding Factors
                                            </span>
                                            <div className="result-factors__list">
                                                {(() => {
                                                    const factors = [];
                                                    const s1 = finalStats?.['1'] || liveAgentState?.['1'] || {};
                                                    const s2 = finalStats?.['2'] || liveAgentState?.['2'] || {};
                                                    const a1 = currentMatch.agent1;
                                                    const a2 = currentMatch.agent2;
                                                    const wId = matchResult.winnerId;
                                                    const w = wId === '1' ? a1 : a2;
                                                    const ws = wId === '1' ? s1 : s2;
                                                    const ls = wId === '1' ? s2 : s1;

                                                    if ((matchResult.method || '').toLowerCase().includes('ko')) {
                                                        factors.push({ icon: '💀', text: `${w.name} delivered a devastating knockout blow` });
                                                    } else {
                                                        factors.push({ icon: '⚖️', text: `Winner decided by remaining HP and damage score` });
                                                    }

                                                    if ((ws.hitsLanded || 0) > (ls.hitsLanded || 0)) {
                                                        factors.push({ icon: '🎯', text: `${w.name} landed more hits (${ws.hitsLanded || 0} vs ${ls.hitsLanded || 0})` });
                                                    }
                                                    if ((ws.critHits || 0) > (ls.critHits || 0)) {
                                                        factors.push({ icon: '💥', text: `Superior critical hit rate (${ws.critHits || 0} crits)` });
                                                    }
                                                    if ((w.equipmentPower || 0) > 30) {
                                                        factors.push({ icon: '⚔️', text: `Strong equipment loadout (+${w.equipmentPower} power)` });
                                                    }
                                                    if ((ws.maxCombo || 0) >= 3) {
                                                        factors.push({ icon: '🔥', text: `${ws.maxCombo}x max combo dealt massive burst damage` });
                                                    }
                                                    if (factors.length < 3) {
                                                        factors.push({ icon: '🏆', text: `Higher overall combat effectiveness determined the outcome` });
                                                    }

                                                    return factors.slice(0, 4).map((f, i) => (
                                                        <div key={i} className="result-factor">
                                                            <span className="result-factor__icon">{f.icon}</span>
                                                            <span className="result-factor__text">{f.text}</span>
                                                        </div>
                                                    ));
                                                })()}
                                            </div>
                                        </div>

                                        {/* Reward Info */}
                                        {(matchResult.monEarned > 0 || matchResult.totalBets > 0) && (
                                            <div className="result-rewards">
                                                {matchResult.totalBets > 0 && (
                                                    <div className="result-reward-item">
                                                        <TrendingUp size={12} />
                                                        <span>Total Pool: <strong>{matchResult.totalBets} MON</strong></span>
                                                    </div>
                                                )}
                                                {matchResult.onChainResolved && (
                                                    <div className="result-reward-item result-reward-item--onchain">
                                                        <Shield size={12} />
                                                        <span>Resolved on-chain</span>
                                                        {matchResult.onChainResolveTx && (
                                                            <a
                                                                href={`https://monadscan.com/tx/${matchResult.onChainResolveTx}`}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className="result-reward-item__tx-link"
                                                            >
                                                                TX <ArrowUpRight size={10} />
                                                            </a>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {/* Claim Winnings Inline (brief summary — persistent widget is in sidebar) */}
                                        {pendingClaim && pendingClaim.status === 'ready' && (
                                            <div className="result-claim-section">
                                                <button
                                                    className="result-claim-btn result-claim-btn--ready"
                                                    onClick={handleClaimWinnings}
                                                >
                                                    <Trophy size={16} />
                                                    CLAIM WINNINGS
                                                </button>
                                            </div>
                                        )}
                                        {pendingClaim && pendingClaim.status === 'claiming' && (
                                            <div className="result-claim-section">
                                                <button className="result-claim-btn result-claim-btn--loading" disabled>
                                                    <span className="spinner" />
                                                    Claiming on Monad...
                                                </button>
                                            </div>
                                        )}
                                        {pendingClaim && pendingClaim.status === 'claimed' && (
                                            <div className="result-claim-section">
                                                <div className="result-claim-success">
                                                    <Zap size={14} />
                                                    <span>Winnings claimed!</span>
                                                </div>
                                            </div>
                                        )}
                                        {pendingClaim && pendingClaim.status === 'lost' && (
                                            <div className="result-claim-section">
                                                <div className="result-claim-lost">
                                                    <span>Better luck next time!</span>
                                                </div>
                                            </div>
                                        )}

                                        {/* Next Match Timer */}
                                        <div className="result-next-match">
                                            <Clock size={12} />
                                            <span>Next match in <strong>{timeLeft}s</strong></span>
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
                                        agent1Equipment={getEquipmentBonus(currentMatch?.agent1)}
                                        agent2Equipment={getEquipmentBonus(currentMatch?.agent2)}
                                        serverFightState={serverFightState}
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
                    {/* Persistent Claim Widget — stays visible until claimed/dismissed */}
                    {pendingClaim && pendingClaim.status !== 'lost' && (
                        <div className={`sidebar-claim-widget sidebar-claim-widget--${pendingClaim.status}`}>
                            <div className="sidebar-claim-widget__header">
                                <Trophy size={14} />
                                <span>
                                    {pendingClaim.status === 'ready' && 'You Won!'}
                                    {pendingClaim.status === 'claiming' && 'Claiming...'}
                                    {pendingClaim.status === 'claimed' && 'Claimed!'}
                                    {pendingClaim.status === 'error' && 'Claim Issue'}
                                </span>
                                {pendingClaim.status === 'claimed' && (
                                    <button
                                        className="sidebar-claim-widget__dismiss"
                                        onClick={() => setPendingClaim(null)}
                                        title="Dismiss"
                                    >
                                        &times;
                                    </button>
                                )}
                            </div>

                            {pendingClaim.status === 'ready' && (
                                <>
                                    <p className="sidebar-claim-widget__desc">
                                        Your bet on <strong>{pendingClaim.agentName}</strong> won! Claim your winnings from the smart contract.
                                    </p>
                                    <button
                                        className="sidebar-claim-widget__btn sidebar-claim-widget__btn--claim"
                                        onClick={handleClaimWinnings}
                                    >
                                        <Zap size={14} />
                                        CLAIM WINNINGS
                                    </button>
                                </>
                            )}

                            {pendingClaim.status === 'claiming' && (
                                <div className="sidebar-claim-widget__loading">
                                    <span className="spinner" />
                                    <span>Processing on Monad...</span>
                                </div>
                            )}

                            {pendingClaim.status === 'claimed' && (
                                <div className="sidebar-claim-widget__success">
                                    <Zap size={14} />
                                    <span>Winnings received!</span>
                                    {pendingClaim.txHash && (
                                        <a
                                            href={`https://monadscan.com/tx/${pendingClaim.txHash}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="sidebar-claim-widget__tx"
                                        >
                                            View TX <ArrowUpRight size={10} />
                                        </a>
                                    )}
                                </div>
                            )}

                            {pendingClaim.status === 'error' && (
                                <>
                                    <p className="sidebar-claim-widget__error-msg">
                                        {pendingClaim.error || 'Failed to claim. Please try again.'}
                                    </p>
                                    <button
                                        className="sidebar-claim-widget__btn sidebar-claim-widget__btn--retry"
                                        onClick={handleClaimWinnings}
                                    >
                                        Retry Claim
                                    </button>
                                </>
                            )}
                        </div>
                    )}

                    <BetPanel
                        match={currentMatch}
                        walletConnected={!!account}
                        liveConnected={wsConnected}
                        disabled={gameState !== 'BETTING'}
                        timer={gameState === 'BETTING' ? timeLeft : null}
                        onBetPlaced={sendBetToBackend}
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
