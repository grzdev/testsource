# ── Node ─────────────────────────────────────────────────────────────────────
FROM node:20-bullseye-slim

# Install git + Playwright system-level dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    ca-certificates \
    lsof \
    procps \
    # Chromium / Playwright deps
    libgbm-dev \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libglib2.0-0 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    libxshmfence1 \
    libx11-xcb1 \
    libxcb-dri3-0 \
    libxext6 \
    libxi6 \
    libxtst6 \
  && rm -rf /var/lib/apt/lists/*

# Fake `open` command: TestSprite MCP tries to open a browser dashboard via the
# macOS `open` binary. In a headless Linux container that command does not exist,
# causing the entire test run to abort with "open: not found". This no-op shim
# prevents the crash while still letting tests generate and collect results.
RUN printf '#!/bin/sh\nexit 0\n' > /usr/local/bin/open     && chmod +x /usr/local/bin/open \
 && printf '#!/bin/sh\nexit 0\n' > /usr/local/bin/xdg-open && chmod +x /usr/local/bin/xdg-open

# pnpm is not pre-installed; yarn ships with the node image already
RUN npm install -g pnpm

# ── App ──────────────────────────────────────────────────────────────────────
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Remove dev dependencies
RUN npm prune --omit=dev

# ── Data volume mount point ───────────────────────────────────────────────────
RUN mkdir -p /data/jobs

ENV PORT=3001
ENV RUNNER_BASE_DIR=/data/jobs

EXPOSE 3001

CMD ["node", "dist/index.js"]
