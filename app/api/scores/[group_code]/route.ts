import { NextRequest, NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { supabase } from '@/lib/supabase';
import { AuthError } from '@/lib/geosports';
import { syncGroup } from '@/lib/sync';
import { Site, isSite } from '@/lib/sites';

const STALE_AFTER_MS = 3 * 60 * 1000; // 3 minutes

// Live sync may touch up to 3 sites — give it room beyond the 10s default.
export const maxDuration = 60;

interface SiteRow {
  site: string;
  active: boolean;
  last_synced_at: string | null;
  session_token: string;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ group_code: string }> }
) {
  const { group_code } = await params;
  const code = group_code.toUpperCase();
  const forceSync = req.nextUrl.searchParams.get('sync') === '1';

  const groupRes = await supabase
    .from('groups')
    .select('group_name')
    .eq('group_code', code)
    .single();

  if (groupRes.error || !groupRes.data) {
    return NextResponse.json({ error: 'Group not found' }, { status: 404 });
  }

  const sitesRes = await supabase
    .from('group_sites')
    .select('site, active, last_synced_at, session_token')
    .eq('group_code', code);

  const siteRows: SiteRow[] = (sitesRes.data || []).filter(r => isSite(r.site));

  // Sync helper for one site; updates the in-memory row's last_synced_at/active.
  async function liveSync(row: SiteRow) {
    try {
      await syncGroup(code, row.session_token, row.site as Site);
      row.last_synced_at = new Date().toISOString();
    } catch (err) {
      if (err instanceof AuthError) row.active = false;
      else console.error(`Sync failed for ${code}/${row.site}:`, err);
    }
  }

  const activeRows = siteRows.filter(r => r.active);
  if (forceSync) {
    // Block until every active site has been pulled, so a fresh play shows up
    // in a single refresh.
    await Promise.all(activeRows.map(liveSync));
  } else {
    // Stale-while-revalidate — return cached data, sync stale sites in the bg.
    const stale = activeRows.filter(r => {
      const last = r.last_synced_at ? new Date(r.last_synced_at).getTime() : 0;
      return Date.now() - last > STALE_AFTER_MS;
    });
    if (stale.length) {
      waitUntil(
        Promise.all(stale.map(liveSync)).catch(err =>
          console.error(`Background sync failed for ${code}:`, err)
        )
      );
    }
  }

  const scoresRes = await supabase
    .from('scores')
    .select('date, site, user_id, username, score, raw_scores')
    .eq('group_code', code)
    .order('date', { ascending: false });

  // Manual score corrections (e.g. GeoSports answer-key errors). Overrides are
  // merged at read time so daily syncs never clobber them.
  const overridesRes = await supabase
    .from('score_overrides')
    .select('date, site, user_id, score, raw_scores')
    .eq('group_code', code);

  const overrides = new Map(
    (overridesRes.data || []).map(o => [`${o.date}|${o.site}|${o.user_id}`, o])
  );

  return NextResponse.json({
    group_name: groupRes.data.group_name,
    sites: siteRows.map(r => ({
      site: r.site,
      active: r.active,
      last_synced_at: r.last_synced_at,
    })),
    scores: (scoresRes.data || []).map(s => {
      const o = overrides.get(`${s.date}|${s.site}|${s.user_id}`);
      return {
        date: s.date,
        site: s.site,
        userId: s.user_id,
        username: s.username,
        score: o ? o.score : s.score,
        rawScores: o?.raw_scores ?? s.raw_scores,
        corrected: !!o,
      };
    }),
  });
}
