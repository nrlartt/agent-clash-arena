# ════════════════════════════════════════════════════════════════
# Agent Clash Arena — Production Dockerfile
# Multi-stage: build frontend → serve with Express backend
# ════════════════════════════════════════════════════════════════

# Stage 1: Build frontend
FROM node:20-alpine AS builder

WORKDIR /app

# Install frontend dependencies
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# Copy source
COPY . .

# Build args for Vite (VITE_ prefixed vars needed at build time)
ARG VITE_API_URL=/api/v1
ARG VITE_CIRCLE_APP_ID
ARG VITE_GOOGLE_CLIENT_ID
ARG VITE_MONAD_RPC_URL=https://testnet-rpc.monad.xyz
ARG VITE_BETTING_CONTRACT_ADDRESS
ARG VITE_SENTRY_DSN

# Make build args available as env vars for Vite
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_CIRCLE_APP_ID=$VITE_CIRCLE_APP_ID
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID
ENV VITE_MONAD_RPC_URL=$VITE_MONAD_RPC_URL
ENV VITE_BETTING_CONTRACT_ADDRESS=$VITE_BETTING_CONTRACT_ADDRESS
ENV VITE_SENTRY_DSN=$VITE_SENTRY_DSN

# Build frontend
RUN npm run build

# Stage 2: Production server
FROM node:20-alpine AS production

WORKDIR /app

# Install server dependencies only
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --production

# Copy server code
COPY server/ ./server/

# Copy built frontend from builder stage
COPY --from=builder /app/dist ./dist

# Copy public assets
COPY public/ ./public/

# Environment
ENV NODE_ENV=production
ENV PORT=3001

EXPOSE ${PORT}

# Health check (uses $PORT which Railway overrides)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT}/api/v1/health || exit 1

# Start
CMD ["node", "server/index.js"]
