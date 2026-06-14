#!/bin/bash
# Upcoming Events generator — landing-page macro calendar + held-ticker earnings.
#
# Mirrors generate-news.sh: builds the held-stock input file, invokes a single
# `claude -p` agentic session that researches the macro calendar + upcoming
# earnings and writes scripts/events-output/events.json + events.md, then
# persists the feed to Supabase (upcoming_events table) via save-events.ts.
#
# Required env (from .env.local): SUPABASE_URL, SUPABASE_SERVICE_KEY.
# Required on PATH: claude, npx, node.

set -euo pipefail

export PATH="$HOME/.local/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

set -a
# shellcheck source=/dev/null
source "$PROJECT_DIR/.env.local"
set +a

OUT_DIR="$PROJECT_DIR/scripts/events-output"
LOG_FILE="$PROJECT_DIR/scripts/events.log"

echo "[$(date -u +%FT%TZ)] generate-events: starting" >> "$LOG_FILE"

# Self-sync with main so prompt/script edits propagate without manual SSH.
# Non-fatal: on pull failure, proceed with the current checkout.
if git pull --ff-only origin main >> "$LOG_FILE" 2>&1; then
  echo "[$(date -u +%FT%TZ)] generate-events: git pull OK at $(git rev-parse --short HEAD)" >> "$LOG_FILE"
else
  echo "[$(date -u +%FT%TZ)] generate-events: git pull FAILED at $(git rev-parse --short HEAD); proceeding" >> "$LOG_FILE"
fi

# Keep the holdings.json fresh (visibility filter may have changed) but leave
# any prior events.json/.md in place until the new run overwrites them.
npx tsx "$PROJECT_DIR/scripts/prepare-events-input.ts" \
  --out "$OUT_DIR/holdings.json" >> "$LOG_FILE" 2>&1

EVENTS_PROMPT=$(cat "$PROJECT_DIR/scripts/events-prompt.md")
claude -p "$EVENTS_PROMPT" \
  --dangerously-skip-permissions \
  >> "$LOG_FILE" 2>&1
echo "[$(date -u +%FT%TZ)] generate-events: claude session exited" >> "$LOG_FILE"

# Persist the generated feed (replaces the whole upcoming_events set). Skipped
# automatically if the session produced no events.json.
if [ -f "$OUT_DIR/events.json" ]; then
  npx tsx "$PROJECT_DIR/scripts/save-events.ts" "$OUT_DIR/events.json" >> "$LOG_FILE" 2>&1
  echo "[$(date -u +%FT%TZ)] generate-events: persisted events.json" >> "$LOG_FILE"
else
  echo "[$(date -u +%FT%TZ)] generate-events: no events.json produced, skipping save" >> "$LOG_FILE"
fi

echo "[$(date -u +%FT%TZ)] generate-events: done" >> "$LOG_FILE"
