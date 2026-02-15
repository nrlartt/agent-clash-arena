// ═══════════════════════════════════════════════════════════════
// WALLET CONTEXT — Privy-powered wallet integration for Monad
// Provides useWallet() hook compatible with existing components
// ═══════════════════════════════════════════════════════════════

import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { BrowserProvider, formatEther, JsonRpcProvider } from 'ethers';

const MONAD_CHAIN_ID = 143;
const MONAD_RPC_URL = import.meta.env.VITE_MONAD_RPC_URL || 'https://rpc.monad.xyz';

// Monad Explorer URL
export const MONAD_EXPLORER_URL = 'https://monadscan.com';

const WalletContext = createContext(null);

export function WalletProvider({ children }) {
    const { ready, authenticated, login, logout, user } = usePrivy();
    const { wallets } = useWallets();

    const [balance, setBalance] = useState(null);
    const [chainId, setChainId] = useState(null);
    const [provider, setProvider] = useState(null);
    const [error, setError] = useState(null);

    // Get the first connected wallet
    const activeWallet = wallets?.[0] || null;
    const account = activeWallet?.address || null;
    const isConnecting = !ready;
    const isMonad = chainId === MONAD_CHAIN_ID;

    // Fetch balance using RPC
    const fetchBalance = useCallback(async (addr) => {
        try {
            const rpcProvider = new JsonRpcProvider(MONAD_RPC_URL);
            const bal = await rpcProvider.getBalance(addr);
            setBalance(formatEther(bal));
        } catch {
            setBalance('0');
        }
    }, []);

    // Switch to Monad network
    const switchToMonad = useCallback(async () => {
        if (!activeWallet) return;
        try {
            await activeWallet.switchChain(MONAD_CHAIN_ID);
            setChainId(MONAD_CHAIN_ID);
        } catch (err) {
            console.warn('[Wallet] Switch chain failed, trying to add:', err);
            // If switch fails, try adding the chain
            try {
                const ethProvider = await activeWallet.getEthereumProvider();
                await ethProvider.request({
                    method: 'wallet_addEthereumChain',
                    params: [{
                        chainId: '0x8F',
                        chainName: 'Monad Mainnet',
                        rpcUrls: [MONAD_RPC_URL],
                        nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
                        blockExplorerUrls: ['https://monadscan.com'],
                    }],
                });
                setChainId(MONAD_CHAIN_ID);
            } catch (addErr) {
                setError('Failed to add Monad network');
            }
        }
    }, [activeWallet]);

    // Set up provider and chain when wallet connects
    useEffect(() => {
        if (!activeWallet) {
            setProvider(null);
            setChainId(null);
            setBalance(null);
            return;
        }

        let cancelled = false;

        async function setup() {
            try {
                const ethProvider = await activeWallet.getEthereumProvider();
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
                        // Silent fail — user sees "Wrong Network" UI
                    }
                }

                // Fetch balance
                if (activeWallet.address) {
                    fetchBalance(activeWallet.address);
                }
            } catch (err) {
                console.error('[Wallet] Setup error:', err);
                if (!cancelled) setError(err.message);
            }
        }

        setup();
        return () => { cancelled = true; };
    }, [activeWallet, fetchBalance]);

    // Refresh balance periodically
    useEffect(() => {
        if (!account) return;
        const interval = setInterval(() => fetchBalance(account), 30000);
        return () => clearInterval(interval);
    }, [account, fetchBalance]);

    // Connect (opens Privy login modal — wallet only)
    const connect = useCallback(() => {
        setError(null);
        login();
    }, [login]);

    // Disconnect
    const disconnect = useCallback(async () => {
        try {
            await logout();
        } catch {
            // ignore
        }
        setBalance(null);
        setChainId(null);
        setProvider(null);
        setError(null);
    }, [logout]);

    const value = {
        account,
        balance,
        chainId,
        isMonad,
        isConnecting,
        isInstalled: true, // Privy handles wallet availability
        walletType: activeWallet?.walletClientType || null,
        error,
        provider,
        connect,
        disconnect,
        switchToMonad,
        // Helpers
        shortAddress: account ? `${account.slice(0, 6)}...${account.slice(-4)}` : null,
        formattedBalance: balance ? `${parseFloat(balance).toFixed(4)} MON` : null,
    };

    return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
    const ctx = useContext(WalletContext);
    if (!ctx) throw new Error('useWallet must be used within WalletProvider');
    return ctx;
}

export default WalletContext;
