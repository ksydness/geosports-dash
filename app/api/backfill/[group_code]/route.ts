import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { decrypt } from '@/lib/crypto';
import { backfillGroup } from '@/lib/sync';

// Full backfill takes ~20s
export const maxDuration = 60;

// Manually re-run the 30-day backfill for an existing group, e.g. when the
// registration backfill left holes. Uses the group's stored session token.
// Protected by CRON_SECRET:
//   curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
//     https://geosports-dash.vercel.app/api/backfill/GROUPCODE
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ group_code: string }> }
) {
  const auth = req.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { group_code } = await params;
  const code = group_code.toUpperCase();

  const { data: group, error } = await supabase
    .from('groups')
    .select('session_token')
    .eq('group_code', code)
    .single();

  if (error || !group) {
    return NextResponse.json({ error: 'Group not found' }, { status: 404 });
  }

  try {
    const written = await backfillGroup(code, decrypt(group.session_token));
    return NextResponse.json({ group_code: code, rows_written: written });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
