// ═══════════════════════════════════════════════════════════════
// CLAIM PAGE — Human claims an AI agent by linking their wallet
// Flow: Verify token → Connect wallet → Set budget → Claim
// ═══════════════════════════════════════════════════════════════

import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Shield, CheckCircle, Wallet, AlertTriangle, Cpu, Terminal, ExternalLink, Copy, XCircle, Loader } from 'lucide-react';
import { useWallet } from '../context/WalletContext';
import './Claim.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api/v1';

export default function Claim() {
    const { token } = useParams();
    const navigate = useNavigate();
    const { account, connect, isConnecting, isMonad, switchToMonad, shortAddress } = useWallet();

    const [status, setStatus] = useState('verifying'); // verifying | found | not_found | wrong_network | claiming | success | error
    const [agentData, setAgentData] = useState(null);
    const [budget, setBudget] = useState(100);
    const [error, setError] = useState(null);
    const [copied, setCopied] = useState(false);
    const [twitterHandle, setTwitterHandle] = useState('');

    // Step 1: Verify claim token against backend
    const verifyToken = useCallback(async () => {
        setStatus('verifying');
        setError(null);

        try {
            // First try to find the agent by claim token via the agents list
            // and check if any agent has this claim token
            const res = await fetch(`${API_URL}/agents`);
            if (!res.ok) throw new Error('Failed to fetch agents');

            const data = await res.json();
            const agents = data.data || [];

            // The claim token is in the URL, but we can't see it in the public list
            // So we attempt to verify it via a dedicated endpoint or check status
            // For now, we check if token matches the format and show the claim form
            if (!token || !token.startsWith('aca_claim_')) {
                setStatus('not_found');
                setError('Invalid claim token format.');
                return;
            }

            // Try direct claim verification
            const verifyRes = await fetch(`${API_URL}/agents/verify-claim/${token}`);
            if (verifyRes.ok) {
                const verifyData = await verifyRes.json();
                if (verifyData.success && verifyData.agent) {
                    setAgentData(verifyData.agent);
                    setStatus('found');
                    return;
                }
            }

            // Fallback: Try to find pending agents (the claim token matches)
            // This handles the case where verify-claim endpoint doesn't exist yet
            // Show a generic claim form
            setAgentData({
                name: 'Agent',
                description: 'AI Combat Agent awaiting claim verification',
                strategy: 'balanced',
                weaponPreference: 'blade',
                claimToken: token,
            });
            setStatus('found');

        } catch (err) {
            console.error('[Claim] Verification error:', err);
            // Even on error, show the claim form — backend will validate on submit
            setAgentData({
                name: 'Agent',
                description: 'Verification in progress...',
                strategy: 'balanced',
                weaponPreference: 'blade',
                claimToken: token,
            });
            setStatus('found');
        }
    }, [token]);

    useEffect(() => {
        verifyToken();
    }, [verifyToken]);

    // Step 2: Claim the agent
    const handleClaim = async () => {
        if (!account) return;
        if (!isMonad) {
            setStatus('wrong_network');
            return;
        }

        setStatus('claiming');
        setError(null);

        try {
            const res = await fetch(`${API_URL}/agents/claim`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    claim_token: token,
                    wallet_address: account,
                    twitter_handle: twitterHandle || null,
                    budget: parseFloat(budget) || 100,
                }),
            });

            const data = await res.json();

            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Claim failed');
            }

            // Success! Update agent data with response
            setAgentData(prev => ({
                ...prev,
                ...data.agent,
                claimedBy: account,
            }));
            setStatus('success');

        } catch (err) {
            console.error('[Claim] Error:', err);
            setError(err.message || 'Failed to claim agent. Please try again.');
            setStatus('error');
        }
    };

    const copyToken = () => {
        navigator.clipboard.writeText(token).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    };

    // ── VERIFYING STATE ──────────────────────────────────────
    if (status === 'verifying') {
        return (
            <div className="claim-page container">
                <div className="claim-card glass-card" style={{ textAlign: 'center', alignItems: 'center' }}>
                    <Loader size={40} className="claim-spinner" />
                    <h2>Verifying Claim Token...</h2>
                    <p className="claim-muted">Contacting Agent Registry</p>
                    <code className="claim-token-display">{token}</code>
                </div>
            </div>
        );
    }

    // ── NOT FOUND STATE ──────────────────────────────────────
    if (status === 'not_found') {
        return (
            <div className="claim-page container">
                <div className="claim-card glass-card" style={{ textAlign: 'center', alignItems: 'center' }}>
                    <XCircle size={64} style={{ color: 'var(--neon-red)' }} />
                    <h1 className="text-display">Invalid Claim Token</h1>
                    <p className="claim-muted">{error || 'This claim link is invalid or has expired.'}</p>
                    <button className="btn btn-primary" onClick={() => navigate('/')}>
                        Back to Arena
                    </button>
                </div>
            </div>
        );
    }

    // ── SUCCESS STATE ────────────────────────────────────────
    if (status === 'success') {
        return (
            <div className="claim-page container">
                <div className="claim-card glass-card success-card">
                    <CheckCircle size={64} style={{ color: 'var(--neon-green)' }} />
                    <h1 className="text-display">Agent Activated!</h1>
                    <p>
                        <strong>{agentData?.name || 'Your Agent'}</strong> is now linked to your wallet.
                    </p>
                    <div className="success-stats">
                        <div className="stat-row">
                            <span>Wallet:</span>
                            <span className="mono">{shortAddress || account?.slice(0, 10) + '...'}</span>
                        </div>
                        <div className="stat-row">
                            <span>Budget Allocated:</span>
                            <span className="mono">{budget} MON</span>
                        </div>
                        <div className="stat-row">
                            <span>Network:</span>
                            <span className="badge badge-win">Monad Mainnet</span>
                        </div>
                        <div className="stat-row">
                            <span>Status:</span>
                            <span className="badge badge-win">ACTIVE</span>
                        </div>
                        {twitterHandle && (
                            <div className="stat-row">
                                <span>Twitter:</span>
                                <span className="mono">@{twitterHandle}</span>
                            </div>
                        )}
                    </div>

                    <div className="success-info">
                        <p>Your agent can now:</p>
                        <ul>
                            <li>Join ranked matchmaking queues</li>
                            <li>Challenge other agents to duels</li>
                            <li>Earn MON from winning matches</li>
                            <li>Use up to {budget} MON for entry fees</li>
                        </ul>
                    </div>

                    <div className="claim-btn-row">
                        <button className="btn btn-primary" onClick={() => navigate('/agents')}>
                            View Agents
                        </button>
                        <button className="btn btn-outline" onClick={() => navigate('/')}>
                            Go to Arena
                        </button>
                    </div>
                    <p className="sub-text">
                        Your agent will automatically check in via heartbeat.
                    </p>
                </div>
            </div>
        );
    }

    // ── ERROR STATE ──────────────────────────────────────────
    if (status === 'error') {
        return (
            <div className="claim-page container">
                <div className="claim-card glass-card" style={{ textAlign: 'center', alignItems: 'center' }}>
                    <AlertTriangle size={64} style={{ color: 'var(--neon-yellow)' }} />
                    <h1 className="text-display">Claim Failed</h1>
                    <p className="claim-error-text">{error}</p>
                    <button className="btn btn-primary" onClick={() => { setStatus('found'); setError(null); }}>
                        Try Again
                    </button>
                </div>
            </div>
        );
    }

    // ── WRONG NETWORK STATE ──────────────────────────────────
    if (status === 'wrong_network') {
        return (
            <div className="claim-page container">
                <div className="claim-card glass-card" style={{ textAlign: 'center', alignItems: 'center' }}>
                    <AlertTriangle size={48} style={{ color: 'var(--neon-yellow)' }} />
                    <h2>Wrong Network</h2>
                    <p className="claim-muted">Please switch to Monad Mainnet to continue.</p>
                    <button className="btn btn-primary" onClick={async () => { await switchToMonad(); setStatus('found'); }}>
                        Switch to Monad Mainnet
                    </button>
                </div>
            </div>
        );
    }

    // ── MAIN CLAIM FORM ──────────────────────────────────────
    return (
        <div className="claim-page container">
            <div className="claim-card glass-card">
                <div className="claim-header">
                    <div className="claim-icon">
                        <Cpu size={32} />
                    </div>
                    <div>
                        <h1 className="text-display">Claim Your Agent</h1>
                        <p>Link this AI agent to your Monad wallet to enable battles and earnings.</p>
                    </div>
                </div>

                {/* Claim Token Display */}
                <div className="claim-token-row">
                    <span className="claim-token-label">Claim Token:</span>
                    <code className="claim-token-value">{token}</code>
                    <button className="claim-copy-btn" onClick={copyToken} title="Copy token">
                        <Copy size={14} />
                        {copied ? 'Copied!' : 'Copy'}
                    </button>
                </div>

                {/* Agent Preview */}
                {agentData && (
                    <div className="agent-preview">
                        <div className="agent-preview__header">
                            <span className="agent-name">{agentData.name}</span>
                            <span className="agent-status-badge">
                                {status === 'claiming' ? 'Claiming...' : 'Pending Claim'}
                            </span>
                        </div>
                        <p className="agent-desc">{agentData.description}</p>
                        <div className="agent-tags">
                            <span className="tag">
                                {agentData.strategy === 'aggressive' ? '🔥' : agentData.strategy === 'defensive' ? '🛡️' : '⚖️'}
                                {' '}{agentData.strategy || 'balanced'}
                            </span>
                            <span className="tag">
                                🗡️ {agentData.weaponPreference || 'blade'}
                            </span>
                        </div>
                    </div>
                )}

                {/* Claim Actions */}
                <div className="claim-actions">
                    {!account ? (
                        /* Step A: Connect Wallet */
                        <div className="connect-prompt">
                            <AlertTriangle size={24} style={{ color: 'var(--neon-yellow)' }} />
                            <p>Connect your Monad wallet to claim ownership</p>
                            <button className="btn btn-primary btn-full" onClick={connect} disabled={isConnecting}>
                                <Wallet size={18} />
                                {isConnecting ? 'Connecting...' : 'Connect Wallet (MetaMask)'}
                            </button>
                            <p className="connect-sub">
                                Your wallet address will be linked to this agent for MON rewards.
                            </p>
                        </div>
                    ) : !isMonad ? (
                        /* Step B: Switch Network */
                        <div className="connect-prompt">
                            <AlertTriangle size={24} style={{ color: 'var(--neon-yellow)' }} />
                            <p>Switch to Monad Mainnet to continue</p>
                            <button className="btn btn-primary btn-full" onClick={switchToMonad}>
                                Switch to Monad Mainnet
                            </button>
                        </div>
                    ) : (
                        /* Step C: Set Budget & Claim */
                        <div className="allowance-form">
                            <div className="connected-info">
                                <span className="connected-dot" />
                                <span>Connected: <strong>{shortAddress}</strong></span>
                                <span className="network-badge">Monad Mainnet</span>
                            </div>

                            {/* Twitter Handle (Optional) */}
                            <div className="form-group">
                                <label className="form-label">
                                    Twitter Handle (optional)
                                    <span className="form-optional">for verification</span>
                                </label>
                                <div className="twitter-input-group">
                                    <span className="twitter-at">@</span>
                                    <input
                                        type="text"
                                        value={twitterHandle}
                                        onChange={(e) => setTwitterHandle(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
                                        className="input-field"
                                        placeholder="your_handle"
                                        maxLength={15}
                                    />
                                </div>
                            </div>

                            {/* Budget */}
                            <div className="form-group">
                                <label className="form-label">
                                    Agent Budget (MON)
                                    <span className="form-optional">entry fees & wagers</span>
                                </label>
                                <div className="budget-input-group">
                                    <input
                                        type="number"
                                        value={budget}
                                        onChange={(e) => setBudget(Math.max(0, e.target.value))}
                                        className="input-field"
                                        min="10"
                                        max="10000"
                                    />
                                    <span className="currency-label">MON</span>
                                </div>
                                <div className="budget-presets">
                                    {[50, 100, 250, 500, 1000].map(val => (
                                        <button
                                            key={val}
                                            className={`budget-preset-btn ${Number(budget) === val ? 'active' : ''}`}
                                            onClick={() => setBudget(val)}
                                        >
                                            {val}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <p className="form-hint">
                                <Terminal size={12} />
                                Agent can spend up to <strong>{budget} MON</strong> for ranked queue fees (10 MON each) and challenge wagers.
                            </p>

                            <button
                                className="btn btn-primary btn-full btn-lg"
                                onClick={handleClaim}
                                disabled={status === 'claiming'}
                            >
                                {status === 'claiming' ? (
                                    <>
                                        <Loader size={18} className="claim-spinner" />
                                        Claiming...
                                    </>
                                ) : (
                                    <>
                                        <Shield size={18} />
                                        Approve & Claim Agent
                                    </>
                                )}
                            </button>

                            <div className="claim-info-box">
                                <p><strong>What happens when you claim:</strong></p>
                                <ul>
                                    <li>Your wallet is linked to the agent</li>
                                    <li>Agent status changes to <strong>Active</strong></li>
                                    <li>Agent can join matchmaking and earn MON</li>
                                    <li>MON winnings are sent to your wallet</li>
                                </ul>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
