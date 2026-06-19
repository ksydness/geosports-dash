import { NextRequest, NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { supabase } from '@/lib/supabase';
import { decrypt } from '@/lib/crypto';
import { backfillGroup } from '@/lib/sync';
import { Site, isSite } from '@/lib/sites';

// Full backfill takes ~20s per site.
export const maxDuration = 60;

const THROTTLE_MS = 24 * 60 * 60 * 1000;

// Re-run the 30-day backfill for an existing group across all its active site
// connections (or one site via ?site=). Uses each connection's stored token.
// Throttled to once per 24h per site; a Bearer CRON_SECRET header bypasses it.
//   GET/POST /api/backfill/GROUPCODE[?site=geohistory]
async function handle(
  req: NextRequest,
  { params }: { params: Promise<{ group_code: string }> }
) {
  const auth = req.headers.get('authorization');
  const isAdmin = !!process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`;

  const { group_code } = await params;
  const code = group_code.toUpperCase();
  const onlySite = req.nextUrl.searchParams.get('site');

  let query = supabase
    .from('group_sites')
    .select('site, active, last_backfilled_at, session_token')
    .eq('group_code', code);
  if (onlySite && isSite(onlySite)) query = query.eq('site', onlySite);

  const { data: rows, error } = await query;
  if (error || !rows || rows.length === 0) {
    return NextResponse.json({ error: 'Group (or site) not found' }, { status: 404 });
  }

  const started: string[] = [];
  const skipped: { site: string; reason: string }[] = [];

  for (const row of rows) {
    if (!isSite(row.site)) continue;
    if (!row.active) {
      skipped.push({ site: row.site, reason: 'inactive — re-connect with a fresh token' });
      continue;
    }
    if (!isAdmin && row.last_backfilled_at) {
      const elapsed = Date.now() - new Date(row.last_backfilled_at).getTime();
      if (elapsed < THROTTLE_MS) {
        skipped.push({ site: row.site, reason: 'backfilled in the last 24h' });
        continue;
      }
    }
    const site = row.site as Site;
    waitUntil(
      backfillGroup(code, decrypt(row.session_token), site).catch(err =>
        console.error(`Manual backfill failed for ${code}/${site}:`, err)
      )
    );
    started.push(site);
  }

  if (started.length === 0) {
    return NextResponse.json({ group_code: code, started, skipped, error: 'Nothing to back fill' }, { status: 429 });
  }

  return NextResponse.json(
    { group_code: code, started, skipped, note: 'Backfill runs ~20-30s per site; refresh after' },
    { status: 202 }
  );
}

export { handle as GET, handle as POST };
