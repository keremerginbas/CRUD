#!/usr/bin/env bash
# macOS / Linux için tek tık başlatıcı
set -e
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Node.js 22 kurun: https://nodejs.org"; exit 1; }
command -v pnpm >/dev/null || npm install -g pnpm@10.15.1
[ -d node_modules/express ] || pnpm install --frozen-lockfile
[ -f .env ] || cp .env.example .env
[ -f dist/server.js ] || pnpm build
( sleep 4; (command -v open >/dev/null && open http://localhost:3000) || xdg-open http://localhost:3000 ) >/dev/null 2>&1 &
node scripts/start-local.mjs
