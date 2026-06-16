import { todayET } from './dates';

const BASE = 'https://geosports.app';

/** Thrown when the GeoSports session token is rejected (expired/invalid). */
export class AuthError extends Error {
  constructor(message = 'Session token rejected') {
    super(message);
    this.name = 'AuthError';
  }
}

function authHeaders(sessionToken: string) {
  return {
    Cookie: `__Secure-geosports.session_token=${sessionToken}`,
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Referer': 'https://geosports.app/',
    'Origin': 'https://geosports.app',
  };
}

export interface GeoScoreEntry {
  /** Stable GeoSports user id (UUID). Identity — usernames are mutable. */
  userId: string;
  username: string;
  score: number;
  rawScores?: number[];
}

export interface GeoGroupResponse {
  // Current API nests group metadata here (restructured ~2026-06-14).
  group?: { id?: string; name?: string; code?: string; memberCount?: number };
  // Legacy top-level fields — kept for backward compatibility.
  name?: string;
  groupName?: string;
  group_name?: string;
  leaderboard?: GeoScoreEntry[];
  error?: string;
}

/**
 * Pull a human-readable group name from a group response, checking the current
 * nested shape (`group.name`) first, then falling back through legacy top-level
 * fields. Returns null if no real name is present (caller can default to the code).
 */
export function extractGroupName(data: GeoGroupResponse): string | null {
  return data.group?.name || data.name || data.groupName || data.group_name || null;
}

export interface GeoDayResult {
  /** Group display name from the live API, or null if absent. */
  groupName: string | null;
  /** Played leaderboard entries for the date (filtered to valid scores). */
  played: GeoScoreEntry[];
}

/** Validate credentials + get group info. Throws if auth fails. */
export async function fetchGroupInfo(
  groupCode: string,
  sessionToken: string
): Promise<GeoGroupResponse> {
  const res = await fetch(`${BASE}/api/groups/${groupCode}?date=${todayET()}`, {
    headers: authHeaders(sessionToken),
  });
  if (res.status === 401 || res.status === 403) throw new Error('Session token rejected — make sure you copied the full value of __Secure-geosports.session_token from DevTools and that you are logged in to geosports.app');
  if (!res.ok) throw new Error(`GeoSports returned HTTP ${res.status}`);
  const data: GeoGroupResponse = await res.json();
  if (data.error === 'Not authenticated') throw new Error('Session token rejected — make sure you copied the full value of __Secure-geosports.session_token from DevTools and that you are logged in to geosports.app');
  if (data.error) throw new Error(data.error);
  return data;
}

/**
 * Fetch a group's name + played scores for a specific date in one request.
 * Throws AuthError if the session token is rejected (so callers can deactivate the group).
 * Returns null on any other (transient) error.
 */
export async function fetchGroupDay(
  groupCode: string,
  sessionToken: string,
  date: string
): Promise<GeoDayResult | null> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/api/groups/${groupCode}?date=${date}`, {
      headers: authHeaders(sessionToken),
    });
  } catch {
    return null; // network error — transient
  }
  if (res.status === 401 || res.status === 403) throw new AuthError();
  if (!res.ok) return null;
  let data: GeoGroupResponse;
  try {
    data = await res.json();
  } catch {
    return null;
  }
  if (data.error === 'Not authenticated' || data.error === 'Invalid session') throw new AuthError();
  if (data.error) return null;
  return {
    groupName: extractGroupName(data),
    played: (data.leaderboard || []).filter(e => e.userId && e.score !== null && e.score !== undefined),
  };
}

/**
 * Fetch played scores for a specific date. Thin wrapper over fetchGroupDay for
 * callers that don't need the group name (e.g. backfill). Propagates AuthError.
 */
export async function fetchDayScores(
  groupCode: string,
  sessionToken: string,
  date: string
): Promise<GeoScoreEntry[] | null> {
  const r = await fetchGroupDay(groupCode, sessionToken, date);
  return r ? r.played : null;
}

/** Proxy the public questions endpoint (no auth needed). */
export async function fetchQuestions() {
  const res = await fetch(`${BASE}/api/v2/questions`);
  if (!res.ok) return null;
  return res.json();
}
