// ═══════════════════════════════════════════════════════════════
// SENTRY — Error monitoring for backend
// Only initializes if SENTRY_DSN is configured
// ═══════════════════════════════════════════════════════════════

const Sentry = require('@sentry/node');

const SENTRY_DSN = process.env.SENTRY_DSN;

function initSentry(app) {
    if (!SENTRY_DSN) {
        console.log('[Sentry] No DSN configured. Error monitoring disabled.');
        return;
    }

    Sentry.init({
        dsn: SENTRY_DSN,
        environment: process.env.NODE_ENV || 'development',
        tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
        integrations: [
            // HTTP integration for request tracking
            Sentry.httpIntegration(),
            // Express integration
            Sentry.expressIntegration(),
        ],
    });

    // Request handler must be the first middleware
    app.use(Sentry.expressRequestHandler());

    console.log('[Sentry] Error monitoring initialized');
}

function setupSentryErrorHandler(app) {
    if (!SENTRY_DSN) return;
    // Error handler must be before any other error middleware
    app.use(Sentry.expressErrorHandler());
}

function captureException(error, context = {}) {
    if (SENTRY_DSN) {
        Sentry.captureException(error, { extra: context });
    }
}

function captureMessage(message, level = 'info') {
    if (SENTRY_DSN) {
        Sentry.captureMessage(message, level);
    }
}

module.exports = { initSentry, setupSentryErrorHandler, captureException, captureMessage };
