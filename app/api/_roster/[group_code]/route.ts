import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { decrypt } from '@/lib/crypto';
import { fetchDayScores } from '@/lib/geosports';

// TEMPORARY one-off migration helper — READ ONLY. Returns the stable userId for
// every (date, played-score) we have stored for a group, so a backfill of the
// `scores.user_id` column can be computed. Remove after the migration.
export const maxDuration = 60;

async function handle(
  _req: NextRequest,
  { params }: { params: Promise<{ group_code: string }> }
) {
  const { group_code } = await params;
  const code = group_code.toUpperCase();

  const { data: group, error } = await supabase
    .from('groups')
    .select('session_token, active')
    .eq('group_code', code)
    .single();
  if (error || !group) return NextResponse.json({ error: 'Group not found' }, { status: 404 });

  const { data: rows } = await supabase
    .from('scores')
    .select('date')
    .eq('group_code', code);
  const dates = [...new Set((rows || []).map(r => r.date as string))].sort();

  const token = decrypt(group.session_token);
  const days: Record<string, { userId: string; username: string; score: number }[]> = {};
  for (const date of dates) {
    const played = await fetchDayScores(code, token, date);
    if (played) {
      days[date] = played.map(p => ({ userId: p.userId, username: p.username, score: p.score }));
    }
    await new Promise(r => setTimeout(r, 250)); // polite pacing
  }
  return NextResponse.json({ group_code: code, dates, days });
}

export { handle as GET };
