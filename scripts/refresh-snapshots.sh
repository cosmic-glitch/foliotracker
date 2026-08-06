#!/bin/bash
# Cron wrapper for scripts/refresh-snapshots.ts.
# Sources .env.local, runs under flock so overlapping ticks cannot double-run,
# and appends to scripts/refresh-snapshots.log.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

# Make user-local installs (node/npx) findable under cron's minimal PATH.
export PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

LOG_FILE="$PROJECT_DIR/scripts/refresh-snapshots.log"
LOCK_FILE="$PROJECT_DIR/scripts/refresh-snapshots.lock"

# If a previous tick is still running, skip this one rather than pile up.
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "[$(date -u +%FT%TZ)] previous refresh still running, skipping" >> "$LOG_FILE"
  exit 0
fi

# Self-sync with main so code changes propagate without manual SSH (same
# pattern as generate-news.sh / generate-events.sh). Runs every tick, so a
# bad push to main reaches the refresh within a minute — revert on main to
# undo. Failures are logged and non-fatal: a network hiccup shouldn't skip
# the refresh. Quiet on no-op ticks to keep the every-minute log readable —
# detected by comparing HEAD before/after, since git pull's fetch chatter
# makes its output non-empty even when nothing changed.
PRE_PULL_HEAD="$(git rev-parse HEAD)"
if PULL_OUT="$(git pull --ff-only origin main 2>&1)"; then
  if [ "$(git rev-parse HEAD)" != "$PRE_PULL_HEAD" ]; then
    echo "[$(date -u +%FT%TZ)] git pull updated to $(git rev-parse --short HEAD)" >> "$LOG_FILE"
  fi
else
  echo "[$(date -u +%FT%TZ)] git pull FAILED at $(git rev-parse --short HEAD); proceeding: $PULL_OUT" >> "$LOG_FILE"
fi

set -a
# shellcheck source=/dev/null
source "$PROJECT_DIR/.env.local"
set +a

# TEMPORARY (2026-08-06): Yahoo's EU quote backend is serving this VM data
# frozen at the prior session's close, while US vantage points get live quotes.
# Until that recovers, drive the refresh through the Vercel endpoint (US
# region) instead of pulling Yahoo from here. Revert this commit to restore
# the normal local refresh. Note: this bypasses the off-hours 30-min gating in
# refresh-snapshots.ts, so the refresh runs every minute 24/7 while active.
# npx tsx "$PROJECT_DIR/scripts/refresh-snapshots.ts" >> "$LOG_FILE" 2>&1
if [ -z "${REFRESH_SECRET:-}" ]; then
  echo "[$(date -u +%FT%TZ)] REFRESH_SECRET missing from .env.local; cannot call refresh API" >> "$LOG_FILE"
  exit 1
fi
RESPONSE_FILE="$PROJECT_DIR/scripts/refresh-prices-response.json"
if HTTP_CODE="$(curl -sS -o "$RESPONSE_FILE" -w '%{http_code}' --max-time 240 -X POST \
    -H "Authorization: Bearer $REFRESH_SECRET" \
    https://foliotracker.vercel.app/api/refresh-prices)"; then
  echo "[$(date -u +%FT%TZ)] refresh via Vercel API: HTTP $HTTP_CODE $(cat "$RESPONSE_FILE")" >> "$LOG_FILE"
else
  echo "[$(date -u +%FT%TZ)] refresh via Vercel API FAILED (curl error)" >> "$LOG_FILE"
  exit 1
fi
