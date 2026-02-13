// ═══════════════════════════════════════════════════════════════
// MATCH CARD — Preview card for match listing
// ═══════════════════════════════════════════════════════════════

import { Eye, Clock, Zap } from 'lucide-react';
import './MatchCard.css';

export default function MatchCard({ match, onClick }) {
    if (!match) return null;

    const { agent1, agent2, status, totalBets, spectators, agent1Odds, agent2Odds, timeRemaining, startsIn } = match;

    const agent1HPPct = (match.agent1HP / match.maxHP) * 100;
    const agent2HPPct = (match.agent2HP / match.maxHP) * 100;

    const formatTime = (sec) => {
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        return `${m}:${String(s).padStart(2, '0')}`;
    };

    return (
        <div
            className={`match-card glass-card ${status === 'live' ? 'match-card--live' : ''}`}
            onClick={onClick}
            id={`match-card-${match.id}`}
            role="button"
            tabIndex={0}
        >
            {/* Status Badge */}
            <div className="match-card__status-row">
                <span className={`badge badge-${status === 'live' ? 'live' : status === 'upcoming' ? 'upcoming' : 'completed'}`}>
                    {status === 'live' && <span className="status-dot status-dot--live" />}
                    {status === 'live' ? 'LIVE' : status === 'upcoming' ? 'UPCOMING' : 'ENDED'}
                </span>
                {status === 'live' && (
                    <span className="match-card__viewers">
                        <Eye size={12} /> {spectators}
                    </span>
                )}
                {status === 'upcoming' && startsIn && (
                    <span className="match-card__timer">
                        <Clock size={12} /> Starts in {formatTime(startsIn)}
                    </span>
                )}
            </div>

            {/* Fighters */}
            <div className="match-card__fighters">
                {/* Agent 1 */}
                <div className="match-card__fighter match-card__fighter--left">
                    <div className="match-card__avatar" style={{ borderColor: agent1.color, boxShadow: `0 0 15px ${agent1.color}40` }}>
                        <span>{agent1.avatar}</span>
                    </div>
                    <span className="match-card__name" style={{ color: agent1.color }}>{agent1.name}</span>
                    {status === 'live' && (
                        <div className="health-bar" style={{ width: '100%' }}>
                            <div
                                className={`health-bar__fill ${agent1HPPct > 50 ? 'health-bar__fill--high' : agent1HPPct > 25 ? 'health-bar__fill--medium' : 'health-bar__fill--low'}`}
                                style={{ width: `${agent1HPPct}%` }}
                            />
                        </div>
                    )}
                    <span className="match-card__odds">{agent1Odds}x</span>
                </div>

                {/* VS */}
                <div className="match-card__vs">
                    <span>VS</span>
                </div>

                {/* Agent 2 */}
                <div className="match-card__fighter match-card__fighter--right">
                    <div className="match-card__avatar" style={{ borderColor: agent2.color, boxShadow: `0 0 15px ${agent2.color}40` }}>
                        <span>{agent2.avatar}</span>
                    </div>
                    <span className="match-card__name" style={{ color: agent2.color }}>{agent2.name}</span>
                    {status === 'live' && (
                        <div className="health-bar" style={{ width: '100%' }}>
                            <div
                                className={`health-bar__fill ${agent2HPPct > 50 ? 'health-bar__fill--high' : agent2HPPct > 25 ? 'health-bar__fill--medium' : 'health-bar__fill--low'}`}
                                style={{ width: `${agent2HPPct}%` }}
                            />
                        </div>
                    )}
                    <span className="match-card__odds">{agent2Odds}x</span>
                </div>
            </div>

            {/* Footer */}
            <div className="match-card__footer">
                <div className="match-card__pool">
                    <Zap size={14} />
                    <span>{totalBets.toLocaleString()} MON</span>
                </div>
                {status === 'live' && (
                    <div className="match-card__time">
                        <Clock size={14} />
                        <span>{formatTime(timeRemaining)}</span>
                    </div>
                )}
            </div>
        </div>
    );
}
