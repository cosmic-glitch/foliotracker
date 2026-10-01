#!/bin/bash
# Market pulse generator — the landing page's 2–3 sentence market snapshot.
#
# Fired by cron at :00/:30 on weekdays; prepare-pulse-input.ts self-gates to
# trading days 8:30–16:30 ET (exit 10 = skip). Each live tick: fetch quotes →
# one `claude -p` session (web search for the "why") replies with JSON →
# save-pulse.ts appends it to market_pulse.
#
# The session is sandboxed to WebSearch only: no file, shell, or MCP access,
# and no permission bypass. The market data is inlined into the prompt and the
# wrapper (not the model) writes the reply to disk, so untrusted web content
# can't steer it into doing anything but answering.
#
# Required env (from .env.local): SUPABASE_URL, SUPABASE_SERVICE_KEY.
# Required on PATH: claude, npx, node. FORCE=1 bypasses the time gate.

set -euo pipefail

export PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

# Pinned for the same reason as NEWS_MODEL in generate-news.sh (a usage cap on
# the ambient default would kill this job too). Override for one run with
# PULSE_MODEL=... bash scripts/generate-pulse.sh
PULSE_MODEL="${PULSE_MODEL:-claude-sonnet-5-5}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

OUT_DIR="$PROJECT_DIR/scripts/pulse-output"
LOG_FILE="$PROJECT_DIR/scripts/pulse.log"
LOCK_FILE="$PROJECT_DIR/scripts/pulse.lock"
log() { echo "[$(date -u +%FT%TZ)] generate-pulse: $*" >> "$LOG_FILE"; }

# A slow session must not overlap the next tick.
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  log "previous run still going, skipping"
  exit 0
fi

set -a
# shellcheck source=/dev/null
source "$PROJECT_DIR/.env.local"
set +a

# Gate first (cheap) so off-window ticks don't git pull or call the model.
FORCE_FLAG=()
[ "${FORCE:-}" = "1" ] && FORCE_FLAG=(--force)
set +e
npx tsx "$PROJECT_DIR/scripts/prepare-pulse-input.ts" ${FORCE_FLAG[@]+"${FORCE_FLAG[@]}"} >> "$LOG_FILE" 2>&1
RC=$?
set -e
if [ "$RC" -eq 10 ]; then exit 0; fi
if [ "$RC" -ne 0 ]; then log "prepare failed (rc=$RC)"; exit "$RC"; fi

# Self-sync with main so prompt edits propagate without SSH. Done after the
# gate, so this run uses the checkout's prompt and the next one the pulled one.
if git pull --ff-only origin main >> "$LOG_FILE" 2>&1; then
  log "git pull OK at $(git rev-parse --short HEAD)"
else
  log "git pull FAILED at $(git rev-parse --short HEAD); proceeding"
fi

# Clear the previous reply so a failed session can't re-save a stale pulse.
rm -f "$OUT_DIR/response.txt"

log "starting claude session ($PULSE_MODEL)"
PROMPT="$(cat "$PROJECT_DIR/scripts/pulse-prompt.md")
$(cat "$OUT_DIR/input.json")"
claude -p "$PROMPT" \
  --model "$PULSE_MODEL" \
  --tools WebSearch \
  --allowedTools WebSearch \
  --strict-mcp-config \
  --disable-slash-commands \
  < /dev/null \
  > "$OUT_DIR/response.txt" 2>> "$LOG_FILE"
log "claude session exited"

npx tsx "$PROJECT_DIR/scripts/save-pulse.ts" "$PULSE_MODEL" >> "$LOG_FILE" 2>&1
log "done"
