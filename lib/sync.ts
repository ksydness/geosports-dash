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
