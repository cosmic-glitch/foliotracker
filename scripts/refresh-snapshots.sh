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
# the refresh. Quiet on no-op ticks to keep the every-minute log readable.
PULL_OUT="$(git pull --ff-only origin main 2>&1)" || \
  echo "[$(date -u +%FT%TZ)] git pull FAILED at $(git rev-parse --short HEAD); proceeding: $PULL_OUT" >> "$LOG_FILE"
if [ -n "${PULL_OUT:-}" ] && [ "$PULL_OUT" != "Already up to date." ]; then
  echo "[$(date -u +%FT%TZ)] git pull updated to $(git rev-parse --short HEAD)" >> "$LOG_FILE"
fi

set -a
# shellcheck source=/dev/null
source "$PROJECT_DIR/.env.local"
set +a

npx tsx "$PROJECT_DIR/scripts/refresh-snapshots.ts" >> "$LOG_FILE" 2>&1
