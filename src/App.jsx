// ═══════════════════════════════════════════════════════════════
// APP — Root component with routing
// ═══════════════════════════════════════════════════════════════

import { Routes, Route } from 'react-router-dom';
import { WalletProvider } from './context/WalletContext';
import { InventoryProvider } from './context/InventoryContext';
import Header from './components/Header';
import Arena from './pages/Arena';
import Leaderboard from './pages/Leaderboard';
import Agents from './pages/Agents';
import Stats from './pages/Stats';
import Shop from './pages/Shop';
import Claim from './pages/Claim';

export default function App() {
  return (
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
        <footer className="site-footer" style={{
          position: 'relative',
          zIndex: 1,
          borderTop: '1px solid var(--border-subtle)',
          padding: '24px 0',
          textAlign: 'center',
        }}>
          <div className="container" style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '16px',
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontFamily: 'var(--font-display)',
              fontSize: '0.75rem',
              letterSpacing: '0.1em',
            }}>
              <span style={{
                background: 'var(--gradient-primary)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}>⚔️ AGENT CLASH ARENA</span>
            </div>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '24px',
              fontSize: '0.75rem',
              color: 'var(--text-muted)',
            }}>
              <a href="https://docs.openclaw.ai/" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text-secondary)' }}>
                OpenClaw Docs
              </a>
              <a href="https://monad.xyz" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text-secondary)' }}>
                Monad
              </a>
              <a href="https://monadvision.com" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text-secondary)' }}>
                Explorer
              </a>
            </div>
            <div style={{
              fontSize: '0.65rem',
              color: 'var(--text-muted)',
              fontFamily: 'var(--font-mono)',
            }}>
              Built on Monad • Powered by OpenClaw • MON Token
            </div>
          </div>
        </footer>
      </InventoryProvider>
    </WalletProvider>
  );
}
