#!/bin/bash
# Daily Claude-Code-driven news summary generator.
#
# Runs on the Hetzner VM via cron. Enumerates unique single-stock tickers
# across all portfolios, then invokes a single `claude -p` agentic session that
# researches each ticker and persists per-ticker summaries to Supabase.
#
# Required env (from .env.local): SUPABASE_URL, SUPABASE_SERVICE_KEY.
# Required on PATH: claude, npx, node.

set -euo pipefail

# Ensure user-local installs (e.g. `claude` in ~/.local/bin) are findable
# under cron's minimal PATH.
export PATH="$HOME/.local/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

set -a
# shellcheck source=/dev/null
source "$PROJECT_DIR/.env.local"
set +a

OUT_DIR="$PROJECT_DIR/scripts/news-output"
LOG_FILE="$PROJECT_DIR/scripts/news.log"

echo "[$(date -u +%FT%TZ)] generate-news: starting" >> "$LOG_FILE"

# Self-sync with main so prompt/script edits propagate without manual SSH.
# Non-fatal: on pull failure, proceed with the current checkout.
if git pull --ff-only origin main >> "$LOG_FILE" 2>&1; then
  echo "[$(date -u +%FT%TZ)] generate-news: git pull OK at $(git rev-parse --short HEAD)" >> "$LOG_FILE"
else
  echo "[$(date -u +%FT%TZ)] generate-news: git pull FAILED at $(git rev-parse --short HEAD); proceeding" >> "$LOG_FILE"
fi

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

# 1. Build the ticker input file.
npx tsx "$PROJECT_DIR/scripts/prepare-news-input.ts" > "$OUT_DIR/tickers.json"
TICKER_COUNT=$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).filter(t=>!t.already_generated_today).length)" "$OUT_DIR/tickers.json")
TOTAL=$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).length)" "$OUT_DIR/tickers.json")
echo "[$(date -u +%FT%TZ)] generate-news: $TICKER_COUNT of $TOTAL tickers need generation" >> "$LOG_FILE"

if [ "$TICKER_COUNT" = "0" ]; then
  echo "[$(date -u +%FT%TZ)] generate-news: nothing to do, exiting" >> "$LOG_FILE"
  exit 0
fi

# 2. Invoke Claude headless. A single session drives all tickers.
PROMPT=$(cat "$PROJECT_DIR/scripts/news-prompt.md")
claude -p "$PROMPT" \
  --dangerously-skip-permissions \
  >> "$LOG_FILE" 2>&1

echo "[$(date -u +%FT%TZ)] generate-news: claude session exited" >> "$LOG_FILE"
