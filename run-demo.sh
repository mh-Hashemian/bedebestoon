#!/usr/bin/env bash
# Local demo launcher: reads BOT_TOKEN from stdin (never written to disk),
# expects a local PostgreSQL with db "dongapp" owned by user "dong".
set -euo pipefail
read -r BOT_TOKEN
export BOT_TOKEN
export DATABASE_URL="postgresql://dong:dong-demo-pass@127.0.0.1:5432/dongapp"
export PORT=3000
cd "$(dirname "$0")/apps/api"
exec node dist/main.js
