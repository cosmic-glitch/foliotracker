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
