// ═══════════════════════════════════════════════════════════════
// HEADER — Navigation + Privy Wallet Connect
// ═══════════════════════════════════════════════════════════════

import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Wallet, Menu, X, Zap, Trophy, Swords, Users, BarChart3, LogOut, AlertCircle, ExternalLink, ShoppingBag } from 'lucide-react';
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
        error,
        connect,
        disconnect,
        switchToMonad,
    } = useWallet();

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
                                                {isMonad ? '🟣 Monad Mainnet' : '⚠️ Wrong Network'}
                                            </span>
                                            {!isMonad && (
                                                <button className="btn btn-sm btn-primary" onClick={switchToMonad}>
                                                    Switch to Monad
                                                </button>
                                            )}
                                        </div>
                                        <a
                                            href={`https://monadscan.com/address/${account}`}
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
                        <button
                            className="btn btn-primary header__connect-btn"
                            onClick={connect}
                            disabled={isConnecting}
                            id="connect-wallet-btn"
                        >
                            {isConnecting ? (
                                <>
                                    <span className="spinner" /> Loading...
                                </>
                            ) : (
                                <>
                                    <Wallet size={16} />
                                    Connect Wallet
                                </>
                            )}
                        </button>
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
