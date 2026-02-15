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
ARG VITE_PRIVY_APP_ID
ARG VITE_MONAD_RPC_URL=https://rpc.monad.xyz
ARG VITE_BETTING_CONTRACT_ADDRESS
ARG VITE_SENTRY_DSN

# Make build args available as env vars for Vite
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_PRIVY_APP_ID=$VITE_PRIVY_APP_ID
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

# Note: Railway uses its own healthcheck from railway.json
# No Docker HEALTHCHECK needed — it conflicts with Railway's networking probe

# Start
CMD ["node", "server/index.js"]
