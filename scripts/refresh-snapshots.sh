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

set -a
# shellcheck source=/dev/null
source "$PROJECT_DIR/.env.local"
set +a

npx tsx "$PROJECT_DIR/scripts/refresh-snapshots.ts" >> "$LOG_FILE" 2>&1
