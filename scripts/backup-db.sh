#!/bin/bash
# Local Supabase database backup script

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="$PROJECT_DIR/backups"
DATE=$(date +%Y-%m-%d)
RETENTION_DAYS=30

# Source credentials
source "$PROJECT_DIR/.env.local"

# Create backup directory
mkdir -p "$BACKUP_DIR/$DATE"

echo "$(date): Starting backup to $BACKUP_DIR/$DATE"

# Find pg_dump (check Homebrew keg-only location first)
PG_DUMP=""
if [ -x "/opt/homebrew/opt/libpq/bin/pg_dump" ]; then
    PG_DUMP="/opt/homebrew/opt/libpq/bin/pg_dump"
    PG_DUMPALL="/opt/homebrew/opt/libpq/bin/pg_dumpall"
elif command -v pg_dump &> /dev/null; then
    PG_DUMP="pg_dump"
    PG_DUMPALL="pg_dumpall"
fi

# Check if pg_dump is available
if [ -n "$PG_DUMP" ]; then
    echo "Using pg_dump directly..."

    # Dump roles (requires superuser, may fail on Supabase - that's OK)
    "$PG_DUMPALL" --roles-only -d "$SUPABASE_DB_URL" -f "$BACKUP_DIR/$DATE/roles.sql" 2>/dev/null || echo "Note: Role dump skipped (requires superuser)"

    # Dump schema
    "$PG_DUMP" --schema-only "$SUPABASE_DB_URL" -f "$BACKUP_DIR/$DATE/schema.sql"

    # Dump data
    "$PG_DUMP" --data-only "$SUPABASE_DB_URL" -f "$BACKUP_DIR/$DATE/data.sql"
else
    echo "Using supabase CLI (requires Docker)..."

    # Check if Docker is running
    if ! docker info &> /dev/null; then
        echo "ERROR: Docker is not running. Either:"
        echo "  1. Start Docker Desktop, or"
        echo "  2. Install pg_dump: brew install libpq && brew link --force libpq"
        exit 1
    fi

    # Run backups using supabase CLI
    supabase db dump --db-url "$SUPABASE_DB_URL" -f "$BACKUP_DIR/$DATE/roles.sql" --role-only
    supabase db dump --db-url "$SUPABASE_DB_URL" -f "$BACKUP_DIR/$DATE/schema.sql"
    supabase db dump --db-url "$SUPABASE_DB_URL" -f "$BACKUP_DIR/$DATE/data.sql" --use-copy --data-only
fi

echo "$(date): Backup complete"

# Clean up old backups
find "$BACKUP_DIR" -type d -mtime +$RETENTION_DAYS -exec rm -rf {} + 2>/dev/null || true

echo "$(date): Cleaned up backups older than $RETENTION_DAYS days"
