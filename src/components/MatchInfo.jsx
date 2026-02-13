// ═══════════════════════════════════════════════════════════════
// MATCH INFO v2 — Enhanced with combo, special meter, stats
// ═══════════════════════════════════════════════════════════════

import { Eye, Trophy, Zap, Target, Shield } from 'lucide-react';
import './MatchInfo.css';

export default function MatchInfo({ match, liveAgentState, liveMatchState }) {
    if (!match) return null;

    const { agent1, agent2 } = match;

    // Use live state if available
    const a1 = liveAgentState?.['1'];
    const a2 = liveAgentState?.['2'];

    const a1HP = a1?.hp ?? match.agent1HP;
    const a2HP = a2?.hp ?? match.agent2HP;
    const a1MaxHP = a1?.maxHp ?? match.maxHP;
    const a2MaxHP = a2?.maxHp ?? match.maxHP;

    const a1HPPct = (a1HP / a1MaxHP) * 100;
    const a2HPPct = (a2HP / a2MaxHP) * 100;

    // Live timer from engine
    const roundTimer = liveMatchState?.roundTimer ?? match.timeRemaining ?? 90;
    const currentRound = liveMatchState?.currentRound ?? match.round ?? 1;
    const maxRounds = liveMatchState?.maxRounds ?? match.maxRounds ?? 3;
    const isFinished = liveMatchState?.isFinished ?? false;

    const minutes = Math.floor(roundTimer / 60);
    const seconds = roundTimer % 60;
    const timerText = `${minutes}:${String(seconds).padStart(2, '0')}`;

    const getHPClass = (pct) => {
        if (pct > 50) return 'health-bar__fill--high';
        if (pct > 25) return 'health-bar__fill--medium';
        return 'health-bar__fill--low';
    };

    return (
        <div className="match-info" id="match-info">
            {/* Agent 1 Side */}
            <div className="match-info__fighter match-info__fighter--left animate-slide-left">
                <div className="match-info__fighter-top">
                    <div className="match-info__avatar" style={{ borderColor: agent1.color }}>
                        {agent1.avatar}
                    </div>
                    <div className="match-info__fighter-details">
                        <h2 className="match-info__name text-display" style={{ color: agent1.color }}>
                            {agent1.name}
                        </h2>
                        <div className="match-info__meta">
                            <span className="match-info__weapon">{agent1.weapon.icon} {agent1.weapon.name}</span>
                            <span className="match-info__rank">Rank #{agent1.rank}</span>
                        </div>
                    </div>
                </div>
                <div className="match-info__hp-section">
                    <div className="match-info__hp-text">
                        <span className="match-info__hp-value" style={{ color: agent1.color }}>{Math.round(a1HP)}</span>
                        <span className="match-info__hp-max">/ {a1MaxHP}</span>
                    </div>
                    <div className="health-bar">
                        <div className={`health-bar__fill ${getHPClass(a1HPPct)}`} style={{ width: `${a1HPPct}%` }} />
                    </div>
                </div>
                {/* Combat Stats */}
                {a1 && (
                    <div className="match-info__combat-stats">
                        {a1.combo >= 2 && (
                            <span className="match-info__combo-badge" style={{ '--combo-color': a1.combo >= 5 ? '#FFE93E' : a1.combo >= 3 ? '#FF6B35' : '#00F5FF' }}>
                                🔥 {a1.combo}x Combo
                            </span>
                        )}
                        {a1.specialReady && (
                            <span className="match-info__special-badge">⚡ Special Ready!</span>
                        )}
                        <div className="match-info__mini-stats">
                            <span title="Hits Landed"><Target size={10} /> {a1.hitsLanded || 0}</span>
                            <span title="Crit Hits"><Zap size={10} /> {a1.critHits || 0}</span>
                        </div>
                        {/* Special Meter */}
                        <div className="match-info__special-bar">
                            <div
                                className={`match-info__special-fill ${a1.specialReady ? 'match-info__special-fill--ready' : ''}`}
                                style={{ width: `${a1.specialMeter || 0}%` }}
                            />
                        </div>
                    </div>
                )}
            </div>

            {/* Center - VS + Timer */}
            <div className="match-info__center animate-slide-up">
                <div className="match-info__round">
                    <Trophy size={14} />
                    Round {currentRound}/{maxRounds}
                </div>
                <div className="vs-badge">{isFinished ? '🏆' : 'VS'}</div>
                <div className={`match-info__timer ${roundTimer <= 10 ? 'match-info__timer--danger' : ''} ${isFinished ? 'match-info__timer--finished' : ''}`}>
                    {isFinished ? (
                        <span className="match-info__finished-text">MATCH OVER</span>
                    ) : (
                        <>
                            <span>⏱️</span>
                            <span>{timerText}</span>
                        </>
                    )}
                </div>
                <div className="match-info__spectators">
                    <Eye size={14} />
                    <span>{match.spectators}</span>
                </div>
            </div>

            {/* Agent 2 Side */}
            <div className="match-info__fighter match-info__fighter--right animate-slide-right">
                <div className="match-info__fighter-top">
                    <div className="match-info__fighter-details" style={{ textAlign: 'right' }}>
                        <h2 className="match-info__name text-display" style={{ color: agent2.color }}>
                            {agent2.name}
                        </h2>
                        <div className="match-info__meta">
                            <span className="match-info__rank">Rank #{agent2.rank}</span>
                            <span className="match-info__weapon">{agent2.weapon.icon} {agent2.weapon.name}</span>
                        </div>
                    </div>
                    <div className="match-info__avatar" style={{ borderColor: agent2.color }}>
                        {agent2.avatar}
                    </div>
                </div>
                <div className="match-info__hp-section">
                    <div className="match-info__hp-text" style={{ justifyContent: 'flex-end' }}>
                        <span className="match-info__hp-max">{a2MaxHP} /</span>
                        <span className="match-info__hp-value" style={{ color: agent2.color }}>{Math.round(a2HP)}</span>
                    </div>
                    <div className="health-bar">
                        <div className={`health-bar__fill ${getHPClass(a2HPPct)}`} style={{ width: `${a2HPPct}%` }} />
                    </div>
                </div>
                {/* Combat Stats */}
                {a2 && (
                    <div className="match-info__combat-stats match-info__combat-stats--right">
                        {a2.combo >= 2 && (
                            <span className="match-info__combo-badge" style={{ '--combo-color': a2.combo >= 5 ? '#FFE93E' : a2.combo >= 3 ? '#FF6B35' : '#00F5FF' }}>
                                🔥 {a2.combo}x Combo
                            </span>
                        )}
                        {a2.specialReady && (
                            <span className="match-info__special-badge">⚡ Special Ready!</span>
                        )}
                        <div className="match-info__mini-stats">
                            <span title="Hits Landed"><Target size={10} /> {a2.hitsLanded || 0}</span>
                            <span title="Crit Hits"><Zap size={10} /> {a2.critHits || 0}</span>
                        </div>
                        <div className="match-info__special-bar">
                            <div
                                className={`match-info__special-fill ${a2.specialReady ? 'match-info__special-fill--ready' : ''}`}
                                style={{ width: `${a2.specialMeter || 0}%` }}
                            />
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
