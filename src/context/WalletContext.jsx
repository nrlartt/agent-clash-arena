// ═══════════════════════════════════════════════════════════════
// WALLET CONTEXT — MetaMask + Monad network integration
// ═══════════════════════════════════════════════════════════════

import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { BrowserProvider, formatEther } from 'ethers';

const MONAD_CHAIN = {
    chainId: '0x279F',  // 10143 decimal
    chainName: 'Monad Testnet',
    rpcUrls: [import.meta.env.VITE_MONAD_RPC_URL || 'https://testnet-rpc.monad.xyz'],
    nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
    blockExplorerUrls: ['https://testnet.monadexplorer.com'],
};

// Monad Testnet Faucet URL (for reference)
export const MONAD_FAUCET_URL = 'https://testnet.monad.xyz/';
// Monad Explorer URL  
export const MONAD_EXPLORER_URL = 'https://testnet.monadexplorer.com';

const WalletContext = createContext(null);

export function WalletProvider({ children }) {
    const [account, setAccount] = useState(null);
    const [balance, setBalance] = useState(null);
    const [chainId, setChainId] = useState(null);
    const [isConnecting, setIsConnecting] = useState(false);
    const [error, setError] = useState(null);
    const [provider, setProvider] = useState(null);
    const [walletType, setWalletType] = useState(null); // 'metamask' | 'circle'

    const isMonad = chainId === 10143;
    const isInstalled = typeof window !== 'undefined' && !!window.ethereum;

    // Fetch balance
    const fetchBalance = useCallback(async (addr, prov) => {
        try {
            const bal = await prov.getBalance(addr);
            setBalance(formatEther(bal));
        } catch {
            setBalance('0');
        }
    }, []);

    // Switch to Monad network
    const switchToMonad = useCallback(async () => {
        if (walletType === 'circle') return; // Circle handles networks internally
        if (!window.ethereum) return;
        try {
            await window.ethereum.request({
                method: 'wallet_switchEthereumChain',
                params: [{ chainId: MONAD_CHAIN.chainId }],
            });
        } catch (switchErr) {
            // Chain not added — add it
            if (switchErr.code === 4902) {
                try {
                    await window.ethereum.request({
                        method: 'wallet_addEthereumChain',
                        params: [MONAD_CHAIN],
                    });
                } catch (addErr) {
                    setError('Failed to add Monad network');
                }
            }
        }
    }, [walletType]);

    // Connect MetaMask
    const connect = useCallback(async () => {
        if (!isInstalled) {
            setError('MetaMask is not installed');
            window.open('https://metamask.io/download/', '_blank');
            return;
        }

        setIsConnecting(true);
        setError(null);

        try {
            const prov = new BrowserProvider(window.ethereum);
            setProvider(prov);

            // Request accounts
            const accounts = await window.ethereum.request({
                method: 'eth_requestAccounts',
            });

            if (accounts.length === 0) {
                setError('No accounts found');
                setIsConnecting(false);
                return;
            }

            const addr = accounts[0];
            setAccount(addr);
            setWalletType('metamask');

            // Get chain id
            const network = await prov.getNetwork();
            const currentChainId = Number(network.chainId);
            setChainId(currentChainId);

            // Switch to Monad if not on it
            if (currentChainId !== 10143) {
                await switchToMonad();
            }

            // Fetch balance
            await fetchBalance(addr, prov);
        } catch (err) {
            if (err.code === 4001) {
                setError('Connection rejected by user');
            } else {
                setError(err.message || 'Failed to connect');
            }
        } finally {
            setIsConnecting(false);
        }
    }, [isInstalled, switchToMonad, fetchBalance]);

    // Connect Circle Wallet
    const connectCircle = useCallback((address, balance) => {
        setAccount(address);
        setBalance(balance);
        setChainId(10143); // Assume Monad for now
        setWalletType('circle');
        setProvider(null); // Circle handled via SDK service
    }, []);

    // Disconnect
    const disconnect = useCallback(() => {
        setAccount(null);
        setBalance(null);
        setChainId(null);
        setProvider(null);
        setWalletType(null);
        setError(null);
    }, []);

    // Listen for account/chain changes
    useEffect(() => {
        if (!window.ethereum || walletType === 'circle') return;

        const handleAccountsChanged = (accounts) => {
            if (accounts.length === 0) {
                disconnect();
            } else {
                setAccount(accounts[0]);
                if (provider) fetchBalance(accounts[0], provider);
            }
        };

        const handleChainChanged = (newChainId) => {
            setChainId(parseInt(newChainId, 16));
            // Refresh balance on chain change
            if (account && provider) fetchBalance(account, provider);
        };

        window.ethereum.on('accountsChanged', handleAccountsChanged);
        window.ethereum.on('chainChanged', handleChainChanged);

        return () => {
            window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
            window.ethereum.removeListener('chainChanged', handleChainChanged);
        };
    }, [account, provider, disconnect, fetchBalance, walletType]);

    // Auto-reconnect if previously connected
    useEffect(() => {
        if (!window.ethereum) return;
        // Only auto-connect metamask
        window.ethereum.request({ method: 'eth_accounts' }).then((accounts) => {
            if (accounts.length > 0) {
                connect();
            }
        }).catch(() => { });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const value = {
        account,
        balance,
        chainId,
        isMonad,
        isConnecting,
        isInstalled,
        walletType,
        error,
        provider,
        connect,
        connectCircle,
        disconnect,
        switchToMonad,
        // Helpers
        shortAddress: account ? `${account.slice(0, 6)}...${account.slice(-4)}` : null,
        formattedBalance: balance ? `${parseFloat(balance).toFixed(4)} ${walletType === 'circle' ? 'USDC' : 'MON'}` : null,
    };

    return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
    const ctx = useContext(WalletContext);
    if (!ctx) throw new Error('useWallet must be used within WalletProvider');
    return ctx;
}

export default WalletContext;
