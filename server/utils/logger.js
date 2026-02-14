// ═══════════════════════════════════════════════════════════════
// LOGGER — Structured logging with Winston
// ═══════════════════════════════════════════════════════════════

const winston = require('winston');
const path = require('path');

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// Custom format for development (colorful, readable)
const devFormat = winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp({ format: 'HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
        const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
        return `[${timestamp}] ${level}: ${message}${metaStr}`;
    })
);

// Production format (JSON for log aggregation services)
const prodFormat = winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
);

const transports = [
    new winston.transports.Console({
        format: IS_PRODUCTION ? prodFormat : devFormat,
    }),
];

// In production, also log to files (skip if dir creation fails - e.g. Docker readonly)
if (IS_PRODUCTION) {
    const fs = require('fs');
    const logsDir = path.join(__dirname, '..', 'logs');
    
    try {
        if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
        
        transports.push(
            new winston.transports.File({
                filename: path.join(logsDir, 'error.log'),
                level: 'error',
                maxsize: 5 * 1024 * 1024,
                maxFiles: 5,
                format: prodFormat,
            }),
            new winston.transports.File({
                filename: path.join(logsDir, 'combined.log'),
                maxsize: 10 * 1024 * 1024,
                maxFiles: 5,
                format: prodFormat,
            })
        );
    } catch {
        // Can't write to filesystem -- console only
    }
}

const logger = winston.createLogger({
    level: IS_PRODUCTION ? 'info' : 'debug',
    defaultMeta: { service: 'agent-clash-arena' },
    transports,
    // Don't exit on uncaught exceptions — log them
    exitOnError: false,
});

// Catch unhandled promise rejections
process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled Promise Rejection', { reason: reason?.message || reason });
});

process.on('uncaughtException', (err) => {
    logger.error('Uncaught Exception', { error: err.message, stack: err.stack });
    // Don't exit -- keep the server running
});

module.exports = logger;
