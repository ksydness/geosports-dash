import { todayET } from './dates';
import { Site, SITES, DEFAULT_SITE } from './sites';

/** Thrown when a site session token is rejected (expired/invalid). */
export class AuthError extends Error {
  constructor(message = 'Session token rejected') {
    super(message);
    this.name = 'AuthError';
  }
}

// Once we learn which cookie name a site authenticates with, remember it for
// the rest of this serverless invocation (a backfill makes ~30 sequential
// requests; only the first pays the candidate-probing cost).
const resolvedCookieName: Partial<Record<Site, string>> = {};

function baseHeaders(site: Site, cookieName: string, token: string) {
  const { base } = SITES[site];
  return {
    Cookie: `${cookieName}=${token}`,
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    Accept: 'application/json, text/plain, */*',
    Referer: `${base}/`,
    Origin: base,
  };
}

/**
 * Fetch a path on a site's API with the group's session token, trying each
 * candidate cookie name until one authenticates. Returns the Response for the
 * authenticated name (or the last response if every candidate was rejected).
 * Throws only on network error.
 */
async function siteFetch(site: Site, token: string, path: string): Promise<Response> {
  const { base, cookieNames } = SITES[site];
  const url = `${base}${path}`;

  // Use the previously-resolved name first if we have one.
  const order = resolvedCookieName[site]
    ? [resolvedCookieName[site]!, ...cookieNames.filter(n => n !== resolvedCookieName[site])]
    : cookieNames;

  let last: Response | null = null;
  for (const name of order) {
    const res = await fetch(url, { headers: baseHeaders(site, name, token) });
    if (res.status !== 401 && res.status !== 403) {
      resolvedCookieName[site] = name; // this name is accepted by the server
      return res;
    }
    last = res;
  }
  return last as Response; // all candidates rejected — caller treats as AuthError
}

export interface GeoScoreEntry {
  /** Stable user id (UUID) — shared across all three sites. Usernames are mutable. */
  userId: string;
  username: string;
  score: number;
  rawScores?: number[];
}

export interface GeoGroupResponse {
  group?: { id?: string; name?: string; code?: string; memberCount?: number };
  name?: string;
  groupName?: string;
  group_name?: string;
  leaderboard?: GeoScoreEntry[];
  error?: string;
}

/** Pull a human-readable group name from a group response (nested shape first). */
export function extractGroupName(data: GeoGroupResponse): string | null {
  return data.group?.name || data.name || data.groupName || data.group_name || null;
}

export interface GeoDayResult {
  groupName: string | null;
  played: GeoScoreEntry[];
}

const tokenRejected = (site: Site) =>
  `${SITES[site].label} session token rejected — make sure you copied the full value of the ${SITES[site].cookieNames[0]} cookie from DevTools and that you are logged in to ${SITES[site].base.replace('https://', '')}`;

/** Validate credentials + get group info for a site. Throws if auth fails. */
export async function fetchGroupInfo(
  groupCode: string,
  sessionToken: string,
  site: Site = DEFAULT_SITE
): Promise<GeoGroupResponse> {
  const res = await siteFetch(site, sessionToken, `/api/groups/${groupCode}?date=${todayET()}`);
  if (res.status === 401 || res.status === 403) throw new Error(tokenRejected(site));
  if (!res.ok) throw new Error(`${SITES[site].label} returned HTTP ${res.status}`);
  const data: GeoGroupResponse = await res.json();
  if (data.error === 'Not authenticated') throw new Error(tokenRejected(site));
  if (data.error) throw new Error(data.error);
  return data;
}

/**
 * Fetch a group's name + played scores for a date on a site. Throws AuthError
 * if the token is rejected; returns null on any other (transient) error.
 */
export async function fetchGroupDay(
  groupCode: string,
  sessionToken: string,
  date: string,
  site: Site = DEFAULT_SITE
): Promise<GeoDayResult | null> {
  let res: Response;
  try {
    res = await siteFetch(site, sessionToken, `/api/groups/${groupCode}?date=${date}`);
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

/** Fetch played scores for a date on a site. Propagates AuthError. */
export async function fetchDayScores(
  groupCode: string,
  sessionToken: string,
  date: string,
  site: Site = DEFAULT_SITE
): Promise<GeoScoreEntry[] | null> {
  const r = await fetchGroupDay(groupCode, sessionToken, date, site);
  return r ? r.played : null;
}

/** Proxy a site's public questions endpoint (no auth needed). */
export async function fetchQuestions(site: Site = DEFAULT_SITE) {
  const res = await fetch(`${SITES[site].base}/api/v2/questions`);
  if (!res.ok) return null;
  return res.json();
}
