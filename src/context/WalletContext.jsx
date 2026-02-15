// ═══════════════════════════════════════════════════════════════
// WALLET CONTEXT — Privy-powered wallet integration for Monad
// Provides useWallet() hook compatible with existing components
// Prefers external wallets (MetaMask) over embedded wallets
// ═══════════════════════════════════════════════════════════════

import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { usePrivy, useWallets, useActiveWallet } from '@privy-io/react-auth';
import { BrowserProvider, formatEther, JsonRpcProvider } from 'ethers';

const MONAD_CHAIN_ID = 143;
const MONAD_CHAIN_ID_HEX = '0x8F';
const DEFAULT_MONAD_RPC_URL = 'https://rpc.monad.xyz';
const RAW_MONAD_RPC_URL = String(import.meta.env.VITE_MONAD_RPC_URL || '').trim();
const MONAD_RPC_URL = (import.meta.env.PROD && /testnet/i.test(RAW_MONAD_RPC_URL))
    ? DEFAULT_MONAD_RPC_URL
    : (RAW_MONAD_RPC_URL || DEFAULT_MONAD_RPC_URL);
const MANUAL_DISCONNECT_KEY = 'aca_wallet_manually_disconnected';

// Monad Explorer URL
export const MONAD_EXPLORER_URL = 'https://monadscan.com';

const WalletContext = createContext(null);

// Shared RPC provider (singleton to avoid creating many connections)
let _rpcProvider = null;
function getRpcProvider() {
    if (!_rpcProvider) {
        _rpcProvider = new JsonRpcProvider(MONAD_RPC_URL);
    }
    return _rpcProvider;
}

export function WalletProvider({ children }) {
    const privy = usePrivy();
    const { wallets } = useWallets();
    const { wallet: selectedWallet } = useActiveWallet();

    const [balance, setBalance] = useState(null);
    const [chainId, setChainId] = useState(null);
    const [provider, setProvider] = useState(null);
    const [error, setError] = useState(null);
    const [isDisconnecting, setIsDisconnecting] = useState(false);
    const [manualDisconnected, setManualDisconnected] = useState(() => {
        if (typeof window === 'undefined') return false;
        return window.sessionStorage.getItem(MANUAL_DISCONNECT_KEY) === '1';
    });
    const setupRef = useRef(false);

    // Pick the BEST wallet: prefer external (MetaMask, Coinbase, etc.) over embedded
    const activeWallet = (() => {
        if (!privy.authenticated || manualDisconnected || isDisconnecting || !wallets || wallets.length === 0) return null;
        if (selectedWallet && selectedWallet.address) {
            return selectedWallet;
        }
        // Find the first external (injected) wallet
        const external = wallets.find(w =>
            w.walletClientType === 'metamask' ||
            w.walletClientType === 'coinbase_wallet' ||
            w.walletClientType === 'rainbow' ||
            w.walletClientType === 'wallet_connect' ||
            w.connectorType === 'injected'
        );
        if (external) return external;
        // Fallback to first wallet (could be embedded)
        return wallets[0];
    })();

    const account = activeWallet?.address || null;
    const activeWalletKey = activeWallet
        ? `${activeWallet.address || ''}:${activeWallet.walletClientType || activeWallet.connectorType || ''}`
        : null;
    const isConnecting = !privy.ready;
    const isMonad = chainId === MONAD_CHAIN_ID;

    // Fetch balance from Monad RPC
    const fetchBalance = useCallback(async (addr) => {
        if (!addr) { setBalance(null); return; }
        const walletAddress = String(addr);
        try {
            const rpc = getRpcProvider();
            const rpcNetwork = await rpc.getNetwork();
            if (Number(rpcNetwork.chainId) !== MONAD_CHAIN_ID) {
                throw new Error(`Configured RPC chain mismatch: expected ${MONAD_CHAIN_ID}, got ${Number(rpcNetwork.chainId)}`);
            }
            const bal = await rpc.getBalance(walletAddress);
            const formatted = formatEther(bal);
            setBalance(formatted);
            return;
        } catch (err) {
            console.warn('[Wallet] Balance fetch error:', err.message);
        }

        // Fallback to the connected wallet provider if public RPC is unavailable.
        try {
            if (!activeWallet) return;
            const ethProvider = await activeWallet.getEthereumProvider();
            const rawBalance = await ethProvider.request({
                method: 'eth_getBalance',
                params: [walletAddress, 'latest'],
            });
            const wei = typeof rawBalance === 'string' ? BigInt(rawBalance) : 0n;
            setBalance(formatEther(wei));
        } catch (fallbackErr) {
            console.warn('[Wallet] Balance fallback error:', fallbackErr.message);
            // Keep previous value on transient errors instead of showing incorrect 0.
        }
    }, [activeWallet]);

    // Switch to Monad network
    const switchToMonad = useCallback(async () => {
        if (!activeWallet) return;
        try {
            await activeWallet.switchChain(MONAD_CHAIN_ID);
            setChainId(MONAD_CHAIN_ID);
        } catch (err) {
            console.warn('[Wallet] Switch chain failed, trying to add:', err.message);
            try {
                const ethProvider = await activeWallet.getEthereumProvider();
                await ethProvider.request({
                    method: 'wallet_addEthereumChain',
                    params: [{
                        chainId: MONAD_CHAIN_ID_HEX,
                        chainName: 'Monad Mainnet',
                        rpcUrls: [MONAD_RPC_URL],
                        nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
                        blockExplorerUrls: ['https://monadscan.com'],
                    }],
                });
                setChainId(MONAD_CHAIN_ID);
            } catch (addErr) {
                console.error('[Wallet] Add chain failed:', addErr.message);
                setError('Failed to add Monad network');
            }
        }
    }, [activeWallet]);

    // Set up provider and chain when wallet connects/changes
    useEffect(() => {
        if (!activeWallet) {
            setProvider(null);
            setChainId(null);
            setBalance(null);
            setupRef.current = false;
            return;
        }

        let cancelled = false;
        let ethProviderRef = null;
        let onChainChanged = null;
        let onAccountsChanged = null;

        async function setup() {
            try {
                const ethProvider = await activeWallet.getEthereumProvider();
                ethProviderRef = ethProvider;
                const web3Provider = new BrowserProvider(ethProvider);
                if (cancelled) return;
                setProvider(web3Provider);

                // Get chain ID
                const network = await web3Provider.getNetwork();
                const currentChainId = Number(network.chainId);
                if (cancelled) return;
                setChainId(currentChainId);

                // Auto-switch to Monad if not on it
                if (currentChainId !== MONAD_CHAIN_ID) {
                    try {
                        await activeWallet.switchChain(MONAD_CHAIN_ID);
                        if (!cancelled) setChainId(MONAD_CHAIN_ID);
                    } catch {
                        // User sees "Wrong Network" UI
                    }
                }

                // Fetch balance immediately
                if (activeWallet.address) {
                    setBalance(null);
                    await fetchBalance(activeWallet.address);
                }

                // Listen for account/chain changes
                if (ethProvider.on) {
                    onChainChanged = (newChainId) => {
                        if (!cancelled) setChainId(Number(newChainId));
                    };
                    onAccountsChanged = (accounts) => {
                        if (cancelled) return;
                        if (!accounts || accounts.length === 0) {
                            setBalance(null);
                            setChainId(null);
                            return;
                        }
                        fetchBalance(accounts[0]);
                    };
                    ethProvider.on('chainChanged', onChainChanged);
                    ethProvider.on('accountsChanged', onAccountsChanged);
                }

                setupRef.current = true;
            } catch (err) {
                console.error('[Wallet] Setup error:', err);
                if (!cancelled) setError(err.message);
            }
        }

        setup();
        return () => {
            cancelled = true;
            if (ethProviderRef?.removeListener && onChainChanged) {
                ethProviderRef.removeListener('chainChanged', onChainChanged);
            }
            if (ethProviderRef?.removeListener && onAccountsChanged) {
                ethProviderRef.removeListener('accountsChanged', onAccountsChanged);
            }
        };
    }, [activeWallet, activeWalletKey, fetchBalance]);

    // Refresh balance periodically (every 15 seconds)
    useEffect(() => {
        if (!account) return;
        fetchBalance(account);
        const interval = setInterval(() => fetchBalance(account), 15000);
        return () => clearInterval(interval);
    }, [account, fetchBalance, activeWallet]);

    // Connect (opens Privy login modal — wallet only)
    const connect = useCallback(() => {
        setError(null);
        setIsDisconnecting(false);
        setManualDisconnected(false);
        if (typeof window !== 'undefined') {
            window.sessionStorage.removeItem(MANUAL_DISCONNECT_KEY);
        }
        privy.login();
    }, [privy]);

    // Disconnect — fully clear session
    const disconnect = useCallback(async () => {
        setIsDisconnecting(true);
        setManualDisconnected(true);
        if (typeof window !== 'undefined') {
            window.sessionStorage.setItem(MANUAL_DISCONNECT_KEY, '1');
        }
        // Force clear local state immediately for UI consistency.
        setBalance(null);
        setChainId(null);
        setProvider(null);
        setError(null);
        setupRef.current = false;

        try {
            // Disconnect all wallets first
            if (wallets && wallets.length > 0) {
                for (const w of wallets) {
                    try { await w.disconnect(); } catch { /* ignore */ }
                }
            }
            // Then logout from Privy
            await privy.logout();
        } catch (err) {
            console.warn('[Wallet] Disconnect error:', err.message);
        } finally {
            setIsDisconnecting(false);
        }
    }, [privy, wallets]);

    // Format balance for display
    const formattedBalance = (() => {
        if (!balance) return null;
        const num = parseFloat(balance);
        if (isNaN(num)) return '0 MON';
        if (num >= 1000) return `${num.toFixed(2)} MON`;
        if (num >= 1) return `${num.toFixed(4)} MON`;
        return `${num.toFixed(6)} MON`;
    })();

    const value = {
        account,
        balance,
        chainId,
        isMonad,
        isConnecting,
        isDisconnecting,
        isInstalled: true,
        walletType: activeWallet?.walletClientType || null,
        error,
        provider,
        connect,
        disconnect,
        switchToMonad,
        fetchBalance: () => account && fetchBalance(account),
        shortAddress: account ? `${account.slice(0, 6)}...${account.slice(-4)}` : null,
        formattedBalance,
    };

    return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
    const ctx = useContext(WalletContext);
    if (!ctx) throw new Error('useWallet must be used within WalletProvider');
    return ctx;
}

export default WalletContext;
