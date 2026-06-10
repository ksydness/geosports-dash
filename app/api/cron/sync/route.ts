import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { decrypt } from '@/lib/crypto';
import { AuthError } from '@/lib/geosports';
import { syncGroup, backfillGroup } from '@/lib/sync';
import { todayET } from '@/lib/dates';

// Backfills for new groups take ~20s each
export const maxDuration = 60;

// Groups registered within this window get a full backfill instead of a daily
// sync — a second pass to repair any holes the registration backfill left
// (GeoSports errors intermittently under rapid sequential requests).
const NEW_GROUP_WINDOW_MS = 48 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  // Vercel cron sends Authorization: Bearer <CRON_SECRET>
  const auth = req.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: groups, error } = await supabase
    .from('groups')
    .select('group_code, session_token, created_at')
    .eq('active', true);

  if (error || !groups) {
    return NextResponse.json({ error: 'Failed to fetch groups' }, { status: 500 });
  }

  const results: { group_code: string; synced?: number; backfilled?: boolean; error?: string; deactivated?: boolean }[] = [];

  for (const group of groups) {
    try {
      const isNew =
        group.created_at &&
        Date.now() - new Date(group.created_at).getTime() < NEW_GROUP_WINDOW_MS;
      const synced = isNew
        ? await backfillGroup(group.group_code, decrypt(group.session_token))
        : await syncGroup(group.group_code, group.session_token);
      results.push({ group_code: group.group_code, synced, ...(isNew && { backfilled: true }) });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      // syncGroup already deactivated the group on AuthError
      results.push({
        group_code: group.group_code,
        error: message,
        deactivated: err instanceof AuthError,
      });
    }
  }

  return NextResponse.json({ date: todayET(), results });
}
