import { supabase } from './supabase';
import { decrypt } from './crypto';
import { fetchDayScores, AuthError, GeoScoreEntry } from './geosports';
import { todayET, etDateMinusDays } from './dates';

/** Upsert one day's scores for a group. */
export async function upsertDayScores(
  groupCode: string,
  date: string,
  played: GeoScoreEntry[]
): Promise<void> {
  if (!played.length) return;
  await supabase.from('scores').upsert(
    played.map(s => ({
      group_code: groupCode,
      date,
      username: s.username,
      score: s.score,
      raw_scores: s.rawScores ?? null,
    })),
    { onConflict: 'group_code,date,username' }
  );
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

export const BACKFILL_DAYS = 30;

/**
 * Backfill the last `days` days (ET) from GeoSports. Each day retries once on
 * transient failure — GeoSports errors intermittently under rapid sequential
 * requests, which previously left silent holes in a new group's history.
 * Upserts only, so it is always safe to re-run. On AuthError the group is
 * deactivated and the error rethrown. Returns the number of rows written.
 *
 * NOTE: a full run takes ~20s — callers need `export const maxDuration = 60`.
 */
export async function backfillGroup(
  groupCode: string,
  sessionToken: string,
  days = BACKFILL_DAYS
): Promise<number> {
  let written = 0;
  try {
    for (let i = 0; i < days; i++) {
      const date = etDateMinusDays(i);
      let played: GeoScoreEntry[] | null = await fetchDayScores(groupCode, sessionToken, date);
      if (played === null) {
        // transient failure — back off and retry once
        await sleep(1200);
        played = await fetchDayScores(groupCode, sessionToken, date);
        if (played === null) console.error(`Backfill: ${groupCode} ${date} failed after retry`);
      }
      if (played && played.length > 0) {
        await upsertDayScores(groupCode, date, played);
        written += played.length;
      }
      await sleep(400); // polite pacing for GeoSports
    }
  } catch (err) {
    if (err instanceof AuthError) {
      await supabase.from('groups').update({ active: false }).eq('group_code', groupCode);
    }
    throw err;
  }
  await supabase
    .from('groups')
    .update({ last_synced_at: new Date().toISOString() })
    .eq('group_code', groupCode);
  console.log(`Backfill complete for ${groupCode}: ${written} rows over ${days} days`);
  return written;
}

/**
 * Sync today and yesterday (Eastern time) for a group. Yesterday is included so
 * plays made between the previous day's last sync and midnight ET are still
 * captured after rollover.
 *
 * On AuthError (expired/invalid token) the group is deactivated and the error
 * is rethrown. Returns the number of score rows synced.
 */
export async function syncGroup(groupCode: string, encryptedToken: string): Promise<number> {
  const token = decrypt(encryptedToken);
  let synced = 0;
  try {
    for (const date of [todayET(), etDateMinusDays(1)]) {
      const played = await fetchDayScores(groupCode, token, date);
      if (played && played.length > 0) {
        await upsertDayScores(groupCode, date, played);
        synced += played.length;
      }
    }
  } catch (err) {
    if (err instanceof AuthError) {
      await supabase.from('groups').update({ active: false }).eq('group_code', groupCode);
    }
    throw err;
  }
  await supabase
    .from('groups')
    .update({ last_synced_at: new Date().toISOString() })
    .eq('group_code', groupCode);
  return synced;
}
