// ═══════════════════════════════════════════════════════════════
// BET PANEL v2 — Boxing Match Betting Interface
// ═══════════════════════════════════════════════════════════════

import { useState, useEffect, useRef } from 'react';
import { Zap, TrendingUp, Lock, ArrowRight, AlertTriangle, Trophy, Flame } from 'lucide-react';
import { playSound } from '../utils/audio';
import './BetPanel.css';

const QUICK_AMOUNTS = [10, 50, 100, 500, 1000];

export default function BetPanel({ match, walletConnected = false, disabled = false, timer = null }) {
    const [selectedSide, setSelectedSide] = useState(null);
    const [betAmount, setBetAmount] = useState('');
    const [isPlacing, setIsPlacing] = useState(false);
    const [showWinPreview, setShowWinPreview] = useState(false);
    const prevTimer = useRef(timer);

    // Timer tick sound when < 10s
    useEffect(() => {
        if (timer !== null && timer <= 10 && timer > 0 && timer !== prevTimer.current) {
            playSound('tick');
        }
        prevTimer.current = timer;
    }, [timer]);

    // Animate win preview
    useEffect(() => {
        if (selectedSide && betAmount && parseFloat(betAmount) > 0) {
            setShowWinPreview(true);
        } else {
            setShowWinPreview(false);
        }
    }, [selectedSide, betAmount]);

    if (!match) return null;

    const { agent1, agent2, agent1Bets, agent2Bets, totalBets, agent1Odds, agent2Odds } = match;

    const agent1Pct = totalBets > 0 ? (agent1Bets / totalBets * 100).toFixed(1) : 50;
    const agent2Pct = totalBets > 0 ? (agent2Bets / totalBets * 100).toFixed(1) : 50;

    const potentialWin = selectedSide
        ? (parseFloat(betAmount || 0) * (selectedSide === '1' ? agent1Odds : agent2Odds)).toFixed(2)
        : '0.00';

    const handleSelectSide = (side) => {
        if (disabled) return;
        setSelectedSide(side);
        playSound('tick');
    };

    const handlePlaceBet = () => {
        if (disabled || !selectedSide || !betAmount || parseFloat(betAmount) <= 0) return;
        setIsPlacing(true);
        playSound('bet');

        setTimeout(() => {
            setIsPlacing(false);
            setBetAmount('');
            setSelectedSide(null);
            playSound('cheer');
        }, 2000);
    };

    const timerUrgent = timer !== null && timer <= 10;
    const timerCritical = timer !== null && timer <= 5;

    return (
        <div className={`bet-panel ${disabled ? 'bet-panel--disabled' : ''}`} id="bet-panel">
            {disabled && (
                <div className="bet-panel__overlay">
                    <Lock size={32} />
                    <h3>Betting Closed</h3>
                    <p>Match is in progress or ended</p>
                </div>
            )}

            {/* Header */}
            <div className="bet-panel__header">
                <div className="bet-panel__title-row">
                    <div className="bet-panel__icon-box">🥊</div>
                    <div>
                        <h3 className="bet-panel__title">PLACE YOUR BET</h3>
                        <span className="bet-panel__subtitle">Pick your fighter</span>
                    </div>
                </div>
                {timer !== null && (
                    <div className={`bet-panel__timer ${timerUrgent ? 'urgent' : ''} ${timerCritical ? 'critical' : ''}`}>
                        <span className="bet-panel__timer-label">TIME</span>
                        <span className="bet-panel__timer-value">{timer}s</span>
                    </div>
                )}
            </div>

            {/* Pool Distribution */}
            <div className="bet-panel__pool">
                <div className="bet-panel__pool-header">
                    <span className="bet-panel__pool-name" style={{ color: agent1.color }}>
                        {agent1.avatar} {agent1.name}
                    </span>
                    <div className="bet-panel__pool-total">
                        <Flame size={12} />
                        {totalBets.toLocaleString()} MON
                    </div>
                    <span className="bet-panel__pool-name" style={{ color: agent2.color }}>
                        {agent2.name} {agent2.avatar}
                    </span>
                </div>
                <div className="bet-panel__pool-bar-wrap">
                    <span className="bet-panel__pct" style={{ color: agent1.color }}>{agent1Pct}%</span>
                    <div className="bet-panel__pool-bar">
                        <div
                            className="bet-panel__pool-fill bet-panel__pool-fill--left"
                            style={{ width: `${agent1Pct}%`, '--fill-color': agent1.color }}
                        />
                        <div className="bet-panel__pool-divider" />
                        <div
                            className="bet-panel__pool-fill bet-panel__pool-fill--right"
                            style={{ width: `${agent2Pct}%`, '--fill-color': agent2.color }}
                        />
                    </div>
                    <span className="bet-panel__pct" style={{ color: agent2.color }}>{agent2Pct}%</span>
                </div>
            </div>

            {/* Fighter Selection — Corner Buttons */}
            <div className="bet-panel__fighters">
                <button
                    type="button"
                    className={`bet-panel__fighter ${selectedSide === '1' ? 'selected' : ''}`}
                    onClick={() => handleSelectSide('1')}
                    style={{ '--fighter-color': agent1.color }}
                    id="bet-side-1"
                    disabled={disabled}
                >
                    <div className="bet-panel__fighter-corner">RED</div>
                    <span className="bet-panel__fighter-avatar">{agent1.avatar}</span>
                    <span className="bet-panel__fighter-name">{agent1.name}</span>
                    <div className="bet-panel__fighter-odds">
                        <TrendingUp size={11} />
                        <span>{agent1Odds}x</span>
                    </div>
                    {selectedSide === '1' && <div className="bet-panel__fighter-check">✓</div>}
                </button>

                <div className="bet-panel__vs">
                    <span>VS</span>
                </div>

                <button
                    type="button"
                    className={`bet-panel__fighter ${selectedSide === '2' ? 'selected' : ''}`}
                    onClick={() => handleSelectSide('2')}
                    style={{ '--fighter-color': agent2.color }}
                    id="bet-side-2"
                    disabled={disabled}
                >
                    <div className="bet-panel__fighter-corner">BLUE</div>
                    <span className="bet-panel__fighter-avatar">{agent2.avatar}</span>
                    <span className="bet-panel__fighter-name">{agent2.name}</span>
                    <div className="bet-panel__fighter-odds">
                        <TrendingUp size={11} />
                        <span>{agent2Odds}x</span>
                    </div>
                    {selectedSide === '2' && <div className="bet-panel__fighter-check">✓</div>}
                </button>
            </div>

            {/* Amount Input */}
            <div className="bet-panel__amount-section">
                <label className="bet-panel__label">
                    <Zap size={12} />
                    BET AMOUNT
                </label>
                <div className="bet-panel__input-wrap">
                    <span className="bet-panel__input-currency">MON</span>
                    <input
                        type="number"
                        placeholder="0.00"
                        value={betAmount}
                        onChange={e => setBetAmount(e.target.value)}
                        className="bet-panel__input"
                        id="bet-amount-input"
                        min="1"
                        disabled={disabled}
                    />
                </div>
                <div className="bet-panel__quick-amounts">
                    {QUICK_AMOUNTS.map(amount => (
                        <button
                            key={amount}
                            className={`bet-panel__quick-btn ${betAmount === String(amount) ? 'active' : ''}`}
                            onClick={() => {
                                if (disabled) return;
                                setBetAmount(String(amount));
                                playSound('tick');
                            }}
                            id={`quick-bet-${amount}`}
                            disabled={disabled}
                        >
                            {amount >= 1000 ? `${amount / 1000}K` : amount}
                        </button>
                    ))}
                </div>
            </div>

            {/* Potential Win Preview */}
            <div className={`bet-panel__win-preview ${showWinPreview ? 'visible' : ''}`}>
                <div className="bet-panel__win-row">
                    <span className="bet-panel__win-label">
                        <Trophy size={14} />
                        Potential Win
                    </span>
                    <span className="bet-panel__win-value">
                        {potentialWin} MON
                    </span>
                </div>
                <div className="bet-panel__win-multiplier">
                    {selectedSide === '1' ? agent1Odds : agent2Odds}x multiplier
                </div>
            </div>

            {/* Place Bet Button */}
            {walletConnected ? (
                <button
                    className={`bet-panel__submit ${isPlacing ? 'loading' : ''} ${selectedSide && betAmount ? 'ready' : ''}`}
                    onClick={handlePlaceBet}
                    disabled={disabled || !selectedSide || !betAmount || parseFloat(betAmount) <= 0 || isPlacing}
                    id="place-bet-btn"
                >
                    {isPlacing ? (
                        <span className="bet-panel__submit-loading">
                            <span className="spinner" />
                            Processing on Monad...
                        </span>
                    ) : (
                        <span className="bet-panel__submit-content">
                            🥊 PLACE BET <ArrowRight size={16} />
                        </span>
                    )}
                </button>
            ) : (
                <button className="bet-panel__submit bet-panel__submit--connect" disabled id="connect-to-bet-btn">
                    <Lock size={14} /> Connect Wallet to Bet
                </button>
            )}

            {/* Disclaimer */}
            <div className="bet-panel__disclaimer">
                <AlertTriangle size={11} />
                <span>Bets are final. Rewards via smart contract on Monad.</span>
            </div>
        </div>
    );
}
