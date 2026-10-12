#!/usr/bin/env npx tsx
/**
 * Reset a portfolio password.
 *
 * Usage:
 *   set -a; source .env.local; set +a
 *   npx tsx scripts/reset-password.ts <portfolio_id> <new_password>
 *
 * Example:
 *   npx tsx scripts/reset-password.ts vp mynewpassword123
 */

import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 10;

async function main() {
  const [portfolioId, newPassword] = process.argv.slice(2);

  if (!portfolioId || !newPassword) {
    console.error('Usage: npx tsx scripts/reset-password.ts <portfolio_id> <new_password>');
    process.exit(1);
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY || !process.env.UPSTASH_REDIS_REST_KV_REST_API_URL) {
    console.error('Missing SUPABASE_URL, SUPABASE_SERVICE_KEY or UPSTASH_REDIS_REST_KV_REST_API_URL. Run: set -a; source .env.local; set +a');
    process.exit(1);
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const id = portfolioId.toLowerCase();

  // Verify portfolio exists
  const { data: portfolio, error: fetchError } = await supabase
    .from('portfolios')
    .select('id, display_name')
    .eq('id', id)
    .single();

  if (fetchError || !portfolio) {
    console.error(`Portfolio "${id}" not found.`);
    process.exit(1);
  }

  // Hash new password
  const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

  // Update password
  const { error: updateError } = await supabase
    .from('portfolios')
    .update({ password_hash: passwordHash })
    .eq('id', id);

  if (updateError) {
    console.error('Failed to update password:', updateError.message);
    process.exit(1);
  }

  // Invalidate existing sessions, including their Redis auth-cache entries
  // (a plain DB delete would leave cached sessions valid for up to a day).
  // Imported late so the env check above runs before db.ts builds its clients.
  const { deleteSessionsForPortfolio } = await import('../api/_lib/db.js');
  try {
    await deleteSessionsForPortfolio(id);
  } catch (sessionError) {
    console.error('Warning: Failed to clear sessions:', sessionError);
  }

  console.log(`Password reset for portfolio "${id}" (${portfolio.display_name || 'no display name'}). All sessions invalidated.`);
}

main();
