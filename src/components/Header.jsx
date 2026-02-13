// ═══════════════════════════════════════════════════════════════
// HEADER — Navigation + Real Wallet Connect (MetaMask/Monad)
// ═══════════════════════════════════════════════════════════════

import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Wallet, Menu, X, Zap, Trophy, Swords, Users, BarChart3, LogOut, AlertCircle, ExternalLink, ShoppingBag, Droplets } from 'lucide-react';
import { useWallet } from '../context/WalletContext';
import './Header.css';

const NAV_ITEMS = [
    { path: '/', label: 'Arena', icon: Swords },
    { path: '/leaderboard', label: 'Leaderboard', icon: Trophy },
    { path: '/agents', label: 'Agents', icon: Users },
    { path: '/shop', label: 'Shop', icon: ShoppingBag },
    { path: '/stats', label: 'Stats', icon: BarChart3 },
];

export default function Header() {
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const [showWalletDropdown, setShowWalletDropdown] = useState(false);
    const location = useLocation();

    const {
        account,
        shortAddress,
        formattedBalance,
        isMonad,
        isConnecting,
        isInstalled,
        error,
        connect,
        connectCircle,
        disconnect,
        switchToMonad,
    } = useWallet();

    const liveCount = 1834 + Math.floor(Math.random() * 50);

    return (
        <header className="header">
            <div className="header__inner container">
                {/* Logo */}
                <Link to="/" className="header__logo" id="logo-link">
                    <div className="header__logo-icon">
                        <Swords size={22} />
                    </div>
                    <div className="header__logo-text">
                        <span className="header__logo-title text-display">Agent Clash</span>
                        <span className="header__logo-subtitle">Arena</span>
                    </div>
                </Link>

                {/* Navigation */}
                <nav className={`header__nav ${mobileMenuOpen ? 'header__nav--open' : ''}`} id="main-nav">
                    {NAV_ITEMS.map(item => (
                        <Link
                            key={item.path}
                            to={item.path}
                            className={`header__nav-item ${location.pathname === item.path ? 'header__nav-item--active' : ''}`}
                            onClick={() => setMobileMenuOpen(false)}
                            id={`nav-${item.label.toLowerCase()}`}
                        >
                            <item.icon size={16} />
                            <span>{item.label}</span>
                        </Link>
                    ))}
                </nav>

                {/* Right Actions */}
                <div className="header__actions">
                    {/* Live Indicator */}
                    <div className="header__live-badge" id="live-badge">
                        <span className="status-dot status-dot--live" />
                        <span className="header__live-label">{liveCount.toLocaleString()} WATCHING</span>
                    </div>

                    {/* Wallet Section */}
                    {account ? (
                        <div className="header__wallet-connected" id="wallet-connected">
                            {/* Network Warning */}
                            {!isMonad && (
                                <button className="header__network-warn" onClick={switchToMonad} title="Switch to Monad">
                                    <AlertCircle size={14} />
                                    Wrong Network
                                </button>
                            )}

                            {/* Faucet Button — Get free MON for testnet */}
                            {isMonad && (
                                <a
                                    href="https://testnet.monad.xyz/"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="header__faucet-btn"
                                    title="Get free MON tokens from Monad Testnet faucet"
                                >
                                    <Droplets size={14} />
                                    <span>Get MON</span>
                                </a>
                            )}

                            {/* Balance */}
                            <div className="header__balance" id="wallet-balance">
                                <Zap size={14} className="header__mon-icon" />
                                <span>{formattedBalance || '0.0000 MON'}</span>
                            </div>

                            {/* Address Dropdown */}
                            <div className="header__wallet-dropdown-wrap">
                                <button
                                    className="header__wallet-btn header__wallet-btn--connected"
                                    onClick={() => setShowWalletDropdown(!showWalletDropdown)}
                                    id="wallet-address-btn"
                                >
                                    <span className="header__wallet-dot" />
                                    <span>{shortAddress}</span>
                                </button>

                                {showWalletDropdown && (
                                    <div className="header__wallet-dropdown" id="wallet-dropdown">
                                        <div className="header__dropdown-header">
                                            <span className="header__dropdown-label">Connected Wallet</span>
                                            <span className="header__dropdown-address">{account}</span>
                                        </div>
                                        <div className="header__dropdown-network">
                                            <span className={`header__dropdown-chain ${isMonad ? 'header__dropdown-chain--monad' : 'header__dropdown-chain--wrong'}`}>
                                                {isMonad ? '🟣 Monad Testnet' : '⚠️ Wrong Network'}
                                            </span>
                                            {!isMonad && (
                                                <button className="btn btn-sm btn-primary" onClick={switchToMonad}>
                                                    Switch to Monad
                                                </button>
                                            )}
                                        </div>
                                        <a
                                            href={`https://testnet.monadexplorer.com/address/${account}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="header__dropdown-link"
                                        >
                                            <ExternalLink size={14} /> View on Explorer
                                        </a>
                                        <button className="header__dropdown-disconnect" onClick={() => { disconnect(); setShowWalletDropdown(false); }}>
                                            <LogOut size={14} /> Disconnect
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div style={{ position: 'relative' }}>
                            <button
                                className="btn btn-primary header__connect-btn"
                                onClick={() => setShowWalletDropdown(!showWalletDropdown)}
                                disabled={isConnecting}
                                id="connect-wallet-btn"
                            >
                                {isConnecting ? (
                                    <>
                                        <span className="spinner" /> Connecting...
                                    </>
                                ) : (
                                    <>
                                        <Wallet size={16} />
                                        Connect Wallet
                                    </>
                                )}
                            </button>

                            {/* Wallet Selection Dropdown */}
                            {showWalletDropdown && !account && (
                                <div className="header__wallet-dropdown header__wallet-dropdown--connect">
                                    <div className="header__dropdown-title">Select Wallet</div>
                                    <button
                                        className="header__connect-option"
                                        onClick={() => { connect(); setShowWalletDropdown(false); }}
                                    >
                                        <img src="https://upload.wikimedia.org/wikipedia/commons/3/36/MetaMask_Fox.svg" alt="MetaMask" width={24} />
                                        <div>
                                            <div className="header__option-name">MetaMask</div>
                                            <div className="header__option-sub">Browser Extension</div>
                                        </div>
                                    </button>
                                    <button
                                        className="header__connect-option"
                                        onClick={async () => {
                                            if (!import.meta.env.VITE_CIRCLE_APP_ID || !import.meta.env.VITE_GOOGLE_CLIENT_ID) {
                                                alert("Circle App ID or Google Client ID not configured. Check .env file.");
                                                return;
                                            }
                                            setShowWalletDropdown(false);
                                            try {
                                                const { circleService } = await import('../services/circleService');
                                                await circleService.setupAndLogin((err, result) => {
                                                    if (err) {
                                                        console.error("[Circle Login Error]", err);
                                                        alert("Google login failed: " + (err.message || 'Unknown error'));
                                                        return;
                                                    }
                                                    if (result) {
                                                        console.log("[Circle Login Success]", result);
                                                        // Connect via WalletContext
                                                        connectCircle(result.address, result.balance || '0');
                                                    }
                                                });
                                            } catch (e) {
                                                console.error("[Circle SDK Error]", e);
                                                alert("Failed to initialize Circle SDK: " + e.message);
                                            }
                                        }}
                                    >
                                        <img src="https://upload.wikimedia.org/wikipedia/commons/5/53/Google_%22G%22_Logo.svg" alt="Google" width={24} />
                                        <div>
                                            <div className="header__option-name">Google Login</div>
                                            <div className="header__option-sub">No extension needed — Powered by Circle</div>
                                        </div>
                                    </button>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Error Toast */}
                    {error && (
                        <div className="header__wallet-error" id="wallet-error">
                            <AlertCircle size={12} />
                            <span>{error}</span>
                        </div>
                    )}

                    {/* Mobile Toggle */}
                    <button className="header__mobile-toggle" onClick={() => setMobileMenuOpen(!mobileMenuOpen)} id="mobile-menu-btn">
                        {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
                    </button>
                </div>
            </div>
        </header>
    );
}
