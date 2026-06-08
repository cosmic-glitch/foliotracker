#!/bin/bash
# Daily Claude-Code-driven news summary generator.
#
# Runs on the Hetzner VM via cron. Enumerates unique single-stock tickers
# across all portfolios (and ETF/MF tickers for pilot portfolios), then
# invokes one `claude -p` agentic session per asset class that researches
# each ticker and persists per-ticker summaries to Supabase.
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
STOCK_TICKERS="$OUT_DIR/tickers.json"
ETF_TICKERS="$OUT_DIR/etf-tickers.json"

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

# 1. Build both ticker input files.
npx tsx "$PROJECT_DIR/scripts/prepare-news-input.ts" \
  --stocks-out "$STOCK_TICKERS" \
  --etfs-out "$ETF_TICKERS" >> "$LOG_FILE" 2>&1

count_pending() {
  node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).filter(t=>!t.already_generated_today).length)" "$1"
}
count_total() {
  node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).length)" "$1"
}

STOCK_PENDING=$(count_pending "$STOCK_TICKERS")
STOCK_TOTAL=$(count_total "$STOCK_TICKERS")
ETF_PENDING=$(count_pending "$ETF_TICKERS")
ETF_TOTAL=$(count_total "$ETF_TICKERS")
echo "[$(date -u +%FT%TZ)] generate-news: stocks $STOCK_PENDING of $STOCK_TOTAL pending, etfs $ETF_PENDING of $ETF_TOTAL pending" >> "$LOG_FILE"

# 2. Stock pass.
if [ "$STOCK_PENDING" != "0" ]; then
  STOCK_PROMPT=$(cat "$PROJECT_DIR/scripts/news-prompt.md")
  claude -p "$STOCK_PROMPT" \
    --dangerously-skip-permissions \
    >> "$LOG_FILE" 2>&1
  echo "[$(date -u +%FT%TZ)] generate-news: stock claude session exited" >> "$LOG_FILE"
else
  echo "[$(date -u +%FT%TZ)] generate-news: skipping stock pass (nothing pending)" >> "$LOG_FILE"
fi

# 3. ETF pass (pilot — currently only `baxter` portfolio's ETFs/MFs).
if [ "$ETF_PENDING" != "0" ]; then
  ETF_PROMPT=$(cat "$PROJECT_DIR/scripts/news-prompt-etf.md")
  claude -p "$ETF_PROMPT" \
    --dangerously-skip-permissions \
    >> "$LOG_FILE" 2>&1
  echo "[$(date -u +%FT%TZ)] generate-news: etf claude session exited" >> "$LOG_FILE"
else
  echo "[$(date -u +%FT%TZ)] generate-news: skipping etf pass (nothing pending)" >> "$LOG_FILE"
fi

echo "[$(date -u +%FT%TZ)] generate-news: done" >> "$LOG_FILE"
