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
  username: string;
  score: number;
  rawScores?: number[];
}

export interface GeoGroupResponse {
  name?: string;
  groupName?: string;
  group_name?: string;
  leaderboard?: GeoScoreEntry[];
  error?: string;
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
 * Fetch played scores for a specific date.
 * Throws AuthError if the session token is rejected (so callers can deactivate the group).
 * Returns null on any other (transient) error.
 */
export async function fetchDayScores(
  groupCode: string,
  sessionToken: string,
  date: string
): Promise<GeoScoreEntry[] | null> {
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
  return (data.leaderboard || []).filter(e => e.score !== null && e.score !== undefined);
}

/** Proxy the public questions endpoint (no auth needed). */
export async function fetchQuestions() {
  const res = await fetch(`${BASE}/api/v2/questions`);
  if (!res.ok) return null;
  return res.json();
}
