import { supabase } from './supabase';
import { decrypt } from './crypto';
import { fetchDayScores, fetchGroupDay, fetchSessionExpiry, AuthError, GeoScoreEntry } from './geosports';
import { Site } from './sites';
import { todayET, etDateMinusDays } from './dates';

/** Upsert one day's scores for a group on a given site. */
export async function upsertDayScores(
  groupCode: string,
  site: Site,
  date: string,
  played: GeoScoreEntry[]
): Promise<void> {
  if (!played.length) return;
  await supabase.from('scores').upsert(
    played
      .filter(s => s.userId)
      .map(s => ({
        group_code: groupCode,
        site,
        date,
        user_id: s.userId,
        username: s.username, // mutable display label — latest write wins
        score: s.score,
        // Only write raw_scores when present, so a later sync that lacks
        // per-question detail never clobbers detail we already captured.
        ...(s.rawScores != null ? { raw_scores: s.rawScores } : {}),
      })),
    { onConflict: 'group_code,site,date,user_id' }
  );
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

export const BACKFILL_DAYS = 30;

/** Deactivate a single site connection (e.g. after its token is rejected). */
async function deactivateSite(groupCode: string, site: Site) {
  await supabase
    .from('group_sites')
    .update({ active: false })
    .eq('group_code', groupCode)
    .eq('site', site);
}

/**
 * Backfill the last `days` days (ET) for a group on a site. Upserts only, so it
 * is safe to re-run. On AuthError the site connection is deactivated and the
 * error rethrown. Returns rows written.
 *
 * A full run takes ~20s — callers need `export const maxDuration = 60`.
 */
export async function backfillGroup(
  groupCode: string,
  sessionToken: string,
  site: Site,
  days = BACKFILL_DAYS
): Promise<number> {
  let written = 0;
  await supabase
    .from('group_sites')
    .update({ last_backfilled_at: new Date().toISOString() })
    .eq('group_code', groupCode)
    .eq('site', site);
  try {
    for (let i = 0; i < days; i++) {
      const date = etDateMinusDays(i);
      let played: GeoScoreEntry[] | null = await fetchDayScores(groupCode, sessionToken, date, site);
      if (played === null) {
        await sleep(1200);
        played = await fetchDayScores(groupCode, sessionToken, date, site);
        if (played === null) console.error(`Backfill: ${groupCode}/${site} ${date} failed after retry`);
      }
      if (played && played.length > 0) {
        await upsertDayScores(groupCode, site, date, played);
        written += played.length;
      }
      await sleep(400);
    }
  } catch (err) {
    if (err instanceof AuthError) await deactivateSite(groupCode, site);
    throw err;
  }
  const expiresAt = await fetchSessionExpiry(sessionToken, site);
  await supabase
    .from('group_sites')
    .update({
      last_synced_at: new Date().toISOString(),
      // Best-effort: only write when the site answered, so a transient
      // failure never nulls out a previously-recorded expiry.
      ...(expiresAt ? { expires_at: expiresAt } : {}),
    })
    .eq('group_code', groupCode)
    .eq('site', site);
  console.log(`Backfill complete for ${groupCode}/${site}: ${written} rows over ${days} days`);
  return written;
}

/**
 * Sync today + yesterday (ET) for a group on a site. On AuthError the site
 * connection is deactivated and the error rethrown. Returns rows synced.
 * Also refreshes the shared group name (same across sites).
 */
export async function syncGroup(
  groupCode: string,
  encryptedToken: string,
  site: Site
): Promise<number> {
  const token = decrypt(encryptedToken);
  let synced = 0;
  let liveName: string | null = null;
  try {
    for (const date of [todayET(), etDateMinusDays(1)]) {
      const day = await fetchGroupDay(groupCode, token, date, site);
      if (day) {
        if (liveName === null && day.groupName) liveName = day.groupName;
        if (day.played.length > 0) {
          await upsertDayScores(groupCode, site, date, day.played);
          synced += day.played.length;
        }
      }
    }
  } catch (err) {
    if (err instanceof AuthError) await deactivateSite(groupCode, site);
    throw err;
  }
  const expiresAt = await fetchSessionExpiry(token, site);
  await supabase
    .from('group_sites')
    .update({
      last_synced_at: new Date().toISOString(),
      // Best-effort: only write when the site answered, so a transient
      // failure never nulls out a previously-recorded expiry.
      ...(expiresAt ? { expires_at: expiresAt } : {}),
    })
    .eq('group_code', groupCode)
    .eq('site', site);
  // The group name is shared across sites — keep the groups row fresh.
  if (liveName && liveName !== groupCode) {
    await supabase.from('groups').update({ group_name: liveName }).eq('group_code', groupCode);
  }
  return synced;
}
