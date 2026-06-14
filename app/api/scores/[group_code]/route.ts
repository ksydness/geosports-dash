import { NextRequest, NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { supabase } from '@/lib/supabase';
import { AuthError } from '@/lib/geosports';
import { syncGroup } from '@/lib/sync';

const STALE_AFTER_MS = 3 * 60 * 1000; // 3 minutes

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ group_code: string }> }
) {
  const { group_code } = await params;
  const code = group_code.toUpperCase();
  // ?sync=1 (the dashboard Refresh button) = sync from GeoSports *before* responding,
  // so a fresh play shows up in a single refresh.
  const forceSync = req.nextUrl.searchParams.get('sync') === '1';

  const groupRes = await supabase
    .from('groups')
    .select('group_name, active, last_synced_at, session_token')
    .eq('group_code', code)
    .single();

  if (groupRes.error || !groupRes.data) {
    return NextResponse.json({ error: 'Group not found' }, { status: 404 });
  }

  const group = groupRes.data;
  let active = group.active;
  let lastSyncedAt = group.last_synced_at;

  if (active) {
    if (forceSync) {
      // Live sync — block until GeoSports has been fetched
      try {
        await syncGroup(code, group.session_token);
        lastSyncedAt = new Date().toISOString();
      } catch (err) {
        if (err instanceof AuthError) active = false; // syncGroup already deactivated the row
        else console.error(`Live sync failed for ${code}:`, err);
      }
    } else {
      // Stale-while-revalidate — return cached data, sync in the background
      const lastSync = lastSyncedAt ? new Date(lastSyncedAt).getTime() : 0;
      const isStale = Date.now() - lastSync > STALE_AFTER_MS;
      if (isStale) {
        waitUntil(
          syncGroup(code, group.session_token).catch(err =>
            console.error(`Background sync failed for ${code}:`, err)
          )
        );
      }
    }
  }

  const scoresRes = await supabase
    .from('scores')
    .select('date, user_id, username, score, raw_scores')
    .eq('group_code', code)
    .order('date', { ascending: false });

  return NextResponse.json({
    group_name: group.group_name,
    active,
    last_synced_at: lastSyncedAt,
    scores: (scoresRes.data || []).map(s => ({
      date: s.date,
      userId: s.user_id,
      username: s.username,
      score: s.score,
      rawScores: s.raw_scores,
    })),
  });
}
