import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import * as Sentry from '@sentry/react'
import App from './App.jsx'
import './index.css'

// Initialize Sentry (only if DSN is configured)
if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({ maskAllText: false, blockAllMedia: false }),
    ],
    tracesSampleRate: import.meta.env.PROD ? 0.2 : 1.0,
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
  })
}

const SentryErrorBoundary = import.meta.env.VITE_SENTRY_DSN
  ? Sentry.ErrorBoundary
  : ({ children }) => children

createRoot(document.getElementById('root')).render(
  <SentryErrorBoundary fallback={<div style={{ padding: '2rem', textAlign: 'center', color: '#ff4444' }}>Something went wrong. Please refresh the page.</div>}>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </SentryErrorBoundary>,
)
