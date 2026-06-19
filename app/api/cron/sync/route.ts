import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { decrypt } from '@/lib/crypto';
import { AuthError } from '@/lib/geosports';
import { syncGroup, backfillGroup } from '@/lib/sync';
import { Site, isSite } from '@/lib/sites';
import { todayET } from '@/lib/dates';

// Backfills for new connections take ~20s each.
export const maxDuration = 60;

// Site connections created within this window get a full backfill instead of a
// daily sync — a second pass to repair any holes the registration backfill left.
const NEW_SITE_WINDOW_MS = 48 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: sites, error } = await supabase
    .from('group_sites')
    .select('group_code, site, session_token, created_at')
    .eq('active', true);

  if (error || !sites) {
    return NextResponse.json({ error: 'Failed to fetch site connections' }, { status: 500 });
  }

  const results: {
    group_code: string;
    site: string;
    synced?: number;
    backfilled?: boolean;
    error?: string;
    deactivated?: boolean;
  }[] = [];

  for (const row of sites) {
    if (!isSite(row.site)) continue;
    const site = row.site as Site;
    try {
      const isNew =
        row.created_at &&
        Date.now() - new Date(row.created_at).getTime() < NEW_SITE_WINDOW_MS;
      const synced = isNew
        ? await backfillGroup(row.group_code, decrypt(row.session_token), site)
        : await syncGroup(row.group_code, row.session_token, site);
      results.push({ group_code: row.group_code, site, synced, ...(isNew && { backfilled: true }) });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      results.push({
        group_code: row.group_code,
        site,
        error: message,
        deactivated: err instanceof AuthError,
      });
    }
  }

  return NextResponse.json({ date: todayET(), results });
}
