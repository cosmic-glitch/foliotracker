// scripts/refresh-snapshots.ts
// VM-side replacement for the cron-job.org hit on /api/refresh-prices.
// Refreshes every portfolio's snapshot + cleans expired sessions, talking
// directly to Supabase. Lets the Vercel deployment stay on Hobby.
//
// Self-gates so that a plain `* * * * *` crontab produces the same cadence as
// the old external cron: every minute during live US sessions, every 30
// minutes otherwise.
//
// Usage:
//   source .env.local && npx tsx scripts/refresh-snapshots.ts
//   source .env.local && npx tsx scripts/refresh-snapshots.ts --force   # bypass gating

import { refreshAllSnapshots } from '../api/_lib/snapshot.js';
import { deleteExpiredSessions } from '../api/_lib/db.js';
import { isLiveMarketSession } from '../api/_lib/cache.js';

function shouldRunNow(now: Date): boolean {
  if (isLiveMarketSession(now)) return true;
  const minute = now.getUTCMinutes();
  return minute === 0 || minute === 30;
}

async function main(): Promise<void> {
  const force = process.argv.includes('--force');
  const now = new Date();

  if (!force && !shouldRunNow(now)) {
    console.log(`[${now.toISOString()}] off-hours tick, skipping (minute=${now.getUTCMinutes()})`);
    return;
  }

  const started = Date.now();
  console.log(`[${now.toISOString()}] refresh starting (live=${isLiveMarketSession(now)})`);

  await refreshAllSnapshots();
  await deleteExpiredSessions();

  console.log(`[${new Date().toISOString()}] refresh done in ${Date.now() - started}ms`);
}

main().catch((err) => {
  console.error('refresh-snapshots failed:', err);
  process.exit(1);
});
