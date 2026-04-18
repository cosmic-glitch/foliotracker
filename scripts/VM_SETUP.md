# Ubuntu VM setup for daily Claude-generated news

The daily `generate-news.sh` job runs on the Digital Ocean Ubuntu VM, not on
the dev Mac. This is a one-time setup guide for that VM.

## 1. Clone the repo and install Node deps

```bash
cd ~
git clone https://github.com/<user>/foliotracker.git
cd ~/foliotracker
npm ci
```

The rest of this guide assumes the repo lives at `~/foliotracker`. The
script uses paths relative to its own location, so any directory works as
long as the crontab entry points there.

## 2. Provide secrets

Copy the dev Mac's `.env.local` to `~/foliotracker/.env.local`:

```bash
scp .env.local vm:~/foliotracker/.env.local
ssh vm "chmod 600 ~/foliotracker/.env.local"
```

Required keys: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_DB_URL`.

## 3. Install Claude Code CLI

```bash
curl -fsSL https://claude.ai/install.sh | bash
claude --version   # sanity check
```

## 4. Authenticate to the Max subscription on the VM

`claude login` normally opens a browser. On a headless VM, try these in
order until one works:

1. **Device flow:** run `claude login` and follow the prompt — recent CLI
   versions print a code + URL you open on any other machine.
2. **SSH with X-forwarding:** `ssh -X vm` and run `claude login` inside that
   session so the browser pops on your local display.
3. **Copy credentials from your Mac:** after `claude login` on the Mac,
   `scp -r ~/.claude vm:~/` (verify the Linux path at first install — it may
   be `~/.claude/` or `~/.config/claude/`).

Verify auth by running a trivial prompt:
```bash
claude -p "say hello" --dangerously-skip-permissions
```

## 5. Set the timezone (or rely on `CRON_TZ`)

Either set the VM system timezone:
```bash
sudo timedatectl set-timezone America/New_York
```

…or prepend `CRON_TZ=America/New_York` to the crontab entry in step 7.

## 6. Run the migration

From a machine with `SUPABASE_DB_URL` (Mac or VM is fine — same DB):

```bash
source .env.local && npx tsx scripts/migrate-ticker-news.ts
```

## 7. Install the cron entry

On the VM, `crontab -e`:

```
50 5 * * * $HOME/foliotracker/scripts/generate-news.sh >> $HOME/foliotracker/scripts/news.log 2>&1
```

05:50 UTC = 22:50 PT, daily — fires after the US after-hours session so
the next morning's view has the previous trading day's news. Adjust the
time or add a `* * 1-5` weekday filter if you want to skip weekends.

Cron invokes the command via `/bin/sh -c`, which expands `$HOME`. The
script itself prepends `~/.local/bin` to `PATH` so that `claude` resolves
under cron's minimal environment — no `PATH=` line needed in the crontab.

The script runs `git pull --ff-only origin main` before each generation so
prompt/script edits propagate without manual SSH. Pull failures are logged
and non-fatal — a network hiccup won't skip the day's news, but it also
means a broken push on `main` will start affecting the cron run the next
day. If you ever push something you want the VM to skip, revert on `main`
before the next 05:50 UTC slot.

## 8. Smoke test

Kick it off once manually to confirm the whole pipeline:

```bash
~/foliotracker/scripts/generate-news.sh
tail -200 ~/foliotracker/scripts/news.log
```

Then verify in Supabase:
```sql
SELECT ticker, summary_date, left(summary_markdown, 80) AS preview,
       jsonb_array_length(sources_json) AS sources
FROM ticker_news_summaries
WHERE summary_date = CURRENT_DATE
ORDER BY ticker;
```

## 9. Daily DB backup cron

The same VM hosts the daily `pg_dump` backup that previously ran on the
dev Mac via launchd. The Mac's lid-closed sleep kept missing the 3-day
cadence, so we moved it here where the box is always up.

```bash
# Install postgres client so pg_dump is on PATH.
# Ubuntu 24.04's default postgresql-client is v16, but Supabase runs
# PG 17 and pg_dump refuses to dump from a newer server. Add the PGDG
# apt repo and install the matching major version.
sudo install -d /usr/share/postgresql-common/pgdg
sudo curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
  -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
  | sudo tee /etc/apt/sources.list.d/pgdg.list
sudo apt-get update
sudo apt-get install -y postgresql-client-17
pg_dump --version   # must report 17.x to match the Supabase server

# backup-db.sh already reads SUPABASE_DB_URL from .env.local (set in step 2).
# Kick it off once manually to prove it works end-to-end:
bash ~/foliotracker/scripts/backup-db.sh
ls ~/foliotracker/backups/   # should have today's dated folder

# Install the cron entry (every 3rd day of the month at 06:30 UTC,
# 40 min after the news slot)
crontab -e
```

Append (keep the news line above it):
```
30 6 */3 * * $HOME/foliotracker/scripts/backup-db.sh >> $HOME/foliotracker/backups/backup.log 2>&1
```

`*/3` fires on days 1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31 of each
month. At month boundaries the gap compresses (e.g. Jan 31 → Feb 1
is a single day) — acceptable here because the DB changes slowly and
30-day retention leaves plenty of coverage.

Backups land at `~/foliotracker/backups/<YYYY-MM-DD>/` with 30-day retention
(the script's `find -mtime +30 -exec rm -rf` prunes automatically).

**Caveat:** backups live only on the VM. If the VM is destroyed, they go
with it. Same single-point-of-failure as the Mac setup had — just with
better uptime. For off-box durability, append an `rclone`/`aws s3 cp`
step at the end of `backup-db.sh` to push the new date folder to remote
storage.

## 10. Snapshot refresh cron

Portfolio snapshot refresh moved off Vercel (formerly driven by
cron-job.org hitting `/api/refresh-prices`) and onto this VM, so the
Vercel deployment no longer needs the Pro plan's 60s function window.

`scripts/refresh-snapshots.sh` sources `.env.local`, takes a `flock` so
overlapping ticks can't double-run, and invokes
`scripts/refresh-snapshots.ts`. The tsx script calls
`refreshAllSnapshots()` and `deleteExpiredSessions()` directly against
Supabase, and gates cadence via `isLiveMarketSession`: every tick during
live US sessions, otherwise only UTC minute `0` or `30` does work.

Smoke test manually first (`--force` bypasses the gate):
```bash
source ~/foliotracker/.env.local && \
  npx tsx ~/foliotracker/scripts/refresh-snapshots.ts --force
```

Then install the cron entry (keep the existing lines above it):
```
* * * * * $HOME/foliotracker/scripts/refresh-snapshots.sh
```

Verify it's firing:
```bash
tail -f ~/foliotracker/scripts/refresh-snapshots.log
```

Off-hours you'll see `off-hours tick, skipping (minute=N)` most minutes
and a full refresh line at `:00` and `:30`. During live sessions every
tick runs the full refresh (~6–8s for ~40 tickers / 7 portfolios; the
lockfile skips if the previous tick is still running).

Once this is running reliably, disable the cron-job.org trigger that
previously hit `/api/refresh-prices` to avoid double-refreshing.
