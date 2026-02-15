// ═══════════════════════════════════════════════════════════════
// APP — Root component with routing + Privy wallet auth
// ═══════════════════════════════════════════════════════════════

import { Routes, Route } from 'react-router-dom';
import { PrivyProvider } from '@privy-io/react-auth';
import { WalletProvider } from './context/WalletContext';
import { InventoryProvider } from './context/InventoryContext';
import Header from './components/Header';
import Arena from './pages/Arena';
import Leaderboard from './pages/Leaderboard';
import Agents from './pages/Agents';
import Stats from './pages/Stats';
import Shop from './pages/Shop';
import Claim from './pages/Claim';

const PRIVY_APP_ID = import.meta.env.VITE_PRIVY_APP_ID || '';

// Monad Mainnet chain definition for Privy
const monadMainnet = {
  id: 143,
  name: 'Monad Mainnet',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.monad.xyz'] },
  },
  blockExplorers: {
    default: { name: 'Monadscan', url: 'https://monadscan.com' },
  },
};

export default function App() {
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        appearance: {
          theme: 'dark',
          accentColor: '#a855f7',
          logo: '/logo.svg',
          showWalletLoginFirst: true,
        },
        loginMethods: ['wallet'],
        defaultChain: monadMainnet,
        supportedChains: [monadMainnet],
        embeddedWallets: {
          createOnLogin: 'users-without-wallets',
        },
      }}
    >
      <WalletProvider>
        <InventoryProvider>
          <Header />
          <main style={{ flex: 1, position: 'relative', zIndex: 1 }}>
            <Routes>
              <Route path="/" element={<Arena />} />
              <Route path="/leaderboard" element={<Leaderboard />} />
              <Route path="/agents" element={<Agents />} />
              <Route path="/shop" element={<Shop />} />
              <Route path="/stats" element={<Stats />} />
              <Route path="/claim/:token" element={<Claim />} />
            </Routes>
          </main>

          {/* Footer */}
          <footer className="site-footer">
            <div className="container">
              <div className="footer-inner">
                {/* Brand */}
                <div className="footer-brand">
                  <span className="footer-brand__logo">⚔️</span>
                  <div className="footer-brand__text">
                    <span className="footer-brand__name">AGENT CLASH ARENA</span>
                    <span className="footer-brand__tagline">AI-powered combat on Monad</span>
                  </div>
                </div>

                {/* Links */}
                <div className="footer-links">
                  <div className="footer-links__group">
                    <span className="footer-links__heading">Platform</span>
                    <a href="/" className="footer-link">Arena</a>
                    <a href="/leaderboard" className="footer-link">Leaderboard</a>
                    <a href="/agents" className="footer-link">Agents</a>
                    <a href="/stats" className="footer-link">Stats</a>
                  </div>
                  <div className="footer-links__group">
                    <span className="footer-links__heading">Ecosystem</span>
                    <a href="https://monad.xyz" target="_blank" rel="noopener noreferrer" className="footer-link">Monad</a>
                    <a href="https://docs.openclaw.ai/" target="_blank" rel="noopener noreferrer" className="footer-link">OpenClaw Docs</a>
                    <a href="https://nad.fun/" target="_blank" rel="noopener noreferrer" className="footer-link">nad.fun</a>
                  </div>
                  <div className="footer-links__group">
                    <span className="footer-links__heading">Contract</span>
                    <a
                      href={`https://monadscan.com/address/${import.meta.env.VITE_BETTING_CONTRACT_ADDRESS || '0xad593Efa1971a2Ed7977b294efbdbB84dc23B38f'}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="footer-link footer-link--mono"
                    >
                      {(import.meta.env.VITE_BETTING_CONTRACT_ADDRESS || '0xad593Efa1971a2Ed7977b294efbdbB84dc23B38f').slice(0, 6)}...{(import.meta.env.VITE_BETTING_CONTRACT_ADDRESS || '0xad593Efa1971a2Ed7977b294efbdbB84dc23B38f').slice(-4)}
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M7 17L17 7M17 7H7M17 7v10"/></svg>
                    </a>
                    <a href="https://monadscan.com" target="_blank" rel="noopener noreferrer" className="footer-link">MonadScan</a>
                  </div>
                </div>

                {/* Social + Bottom */}
                <div className="footer-bottom">
                  <div className="footer-social">
                    <a href="https://x.com/nrlartt" target="_blank" rel="noopener noreferrer" className="footer-social__link" title="X (Twitter)">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                    </a>
                    <a href="https://nad.fun/" target="_blank" rel="noopener noreferrer" className="footer-social__link" title="nad.fun">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 12l4-8 4 8"/><path d="M8 12h8"/><path d="M10 16l2-4 2 4"/></svg>
                    </a>
                    <a
                      href={`https://monadscan.com/address/${import.meta.env.VITE_BETTING_CONTRACT_ADDRESS || '0xad593Efa1971a2Ed7977b294efbdbB84dc23B38f'}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="footer-social__link"
                      title="Smart Contract"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
                    </a>
                  </div>
                  <div className="footer-copyright">
                    Built on <span className="footer-highlight">Monad</span> &bull; Powered by <span className="footer-highlight">OpenClaw</span> &bull; 2026
                  </div>
                </div>
              </div>
            </div>
          </footer>
        </InventoryProvider>
      </WalletProvider>
    </PrivyProvider>
  );
}
