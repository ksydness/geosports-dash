import { NextRequest, NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { supabase } from '@/lib/supabase';
import { syncGroup } from '@/lib/sync';

const STALE_AFTER_MS = 10 * 60 * 1000; // 10 minutes

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ group_code: string }> }
) {
  const { group_code } = await params;
  const code = group_code.toUpperCase();

  const [groupRes, scoresRes] = await Promise.all([
    supabase
      .from('groups')
      .select('group_name, active, last_synced_at, session_token')
      .eq('group_code', code)
      .single(),
    supabase
      .from('scores')
      .select('date, username, score, raw_scores')
      .eq('group_code', code)
      .order('date', { ascending: false }),
  ]);

  if (groupRes.error || !groupRes.data) {
    return NextResponse.json({ error: 'Group not found' }, { status: 404 });
  }

  const group = groupRes.data;

  // Trigger a background sync if data is stale and group is active
  if (group.active) {
    const lastSync = group.last_synced_at ? new Date(group.last_synced_at).getTime() : 0;
    const isStale = Date.now() - lastSync > STALE_AFTER_MS;
    if (isStale) {
      waitUntil(
        syncGroup(code, group.session_token).catch(err =>
          console.error(`Background sync failed for ${code}:`, err)
        )
      );
    }
  }

  return NextResponse.json({
    group_name: group.group_name,
    active: group.active,
    last_synced_at: group.last_synced_at,
    scores: (scoresRes.data || []).map(s => ({
      date: s.date,
      username: s.username,
      score: s.score,
      rawScores: s.raw_scores,
    })),
  });
}
