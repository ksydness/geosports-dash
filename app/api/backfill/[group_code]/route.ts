import { NextRequest, NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { supabase } from '@/lib/supabase';
import { decrypt } from '@/lib/crypto';
import { backfillGroup } from '@/lib/sync';

// Full backfill takes ~20s
export const maxDuration = 60;

const THROTTLE_MS = 24 * 60 * 60 * 1000;

// Re-run the 30-day backfill for an existing group, e.g. when the registration
// backfill left holes. Uses the group's stored session token. Open to anyone,
// but throttled to once per 24h per group; a Bearer CRON_SECRET header bypasses
// the throttle. Runs in the background — returns 202 immediately.
//   GET/POST https://geosports-dash.vercel.app/api/backfill/GROUPCODE
async function handle(
  req: NextRequest,
  { params }: { params: Promise<{ group_code: string }> }
) {
  const auth = req.headers.get('authorization');
  const isAdmin = !!process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`;

  const { group_code } = await params;
  const code = group_code.toUpperCase();

  const { data: group, error } = await supabase
    .from('groups')
    .select('session_token, active, last_backfilled_at')
    .eq('group_code', code)
    .single();

  if (error || !group) {
    return NextResponse.json({ error: 'Group not found' }, { status: 404 });
  }
  if (!group.active) {
    return NextResponse.json(
      { error: 'Group is inactive — re-register with a fresh session token' },
      { status: 409 }
    );
  }
  if (!isAdmin && group.last_backfilled_at) {
    const elapsed = Date.now() - new Date(group.last_backfilled_at).getTime();
    if (elapsed < THROTTLE_MS) {
      return NextResponse.json(
        { error: 'Backfill already ran in the last 24 hours — try again later' },
        { status: 429 }
      );
    }
  }

  waitUntil(
    backfillGroup(code, decrypt(group.session_token)).catch(err =>
      console.error(`Manual backfill failed for ${code}:`, err)
    )
  );

  return NextResponse.json(
    { group_code: code, status: 'started', note: 'Backfill runs ~20-30s; refresh the dashboard after' },
    { status: 202 }
  );
}

export { handle as GET, handle as POST };
