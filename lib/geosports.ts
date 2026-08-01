import { todayET } from './dates';
import { Site, SITES, DEFAULT_SITE } from './sites';
import { isRawSessionToken } from './token-paste';

/** Thrown when a site session token is rejected (expired/invalid). */
export class AuthError extends Error {
  constructor(message = 'Session token rejected') {
    super(message);
    this.name = 'AuthError';
  }
}

// A token authenticates over one of two transports:
//   - `Authorization: Bearer <token>` — works for RAW session tokens (the
//     `session.token` value from get-session; better-auth's bearer plugin,
//     verified 2026-07-31)
//   - `Cookie: <name>=<token>` — works for pasted cookie VALUES (legacy
//     DevTools flow); the right cookie name varies per site.
// BEARER is a sentinel in the same candidate list as the cookie names.
const BEARER = ':bearer';

// Once we learn which transport a site accepts for this invocation's token,
// remember it (a backfill makes ~30 sequential requests; only the first pays
// the candidate-probing cost).
const resolvedTransport: Partial<Record<Site, string>> = {};

function baseHeaders(site: Site, transport: string, token: string): Record<string, string> {
  const { base } = SITES[site];
  const common = {
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    Accept: 'application/json, text/plain, */*',
    Referer: `${base}/`,
    Origin: base,
  };
  return transport === BEARER
    ? { ...common, Authorization: `Bearer ${token}` }
    : { ...common, Cookie: `${transport}=${token}` };
}

/**
 * Fetch a path on a site's API with the group's session token, trying each
 * candidate transport (Bearer header / cookie names) until one authenticates.
 * Raw tokens try Bearer first; cookie-shaped tokens try cookies first. Returns
 * the Response for the authenticated transport (or the last response if every
 * candidate was rejected). Throws only on network error.
 */
async function siteFetch(site: Site, token: string, path: string): Promise<Response> {
  const { base, cookieNames } = SITES[site];
  const url = `${base}${path}`;

  const candidates = isRawSessionToken(token)
    ? [BEARER, ...cookieNames]
    : [...cookieNames, BEARER];

  // Use the previously-resolved transport first if we have one.
  const resolved = resolvedTransport[site];
  const order = resolved ? [resolved, ...candidates.filter(n => n !== resolved)] : candidates;

  let last: Response | null = null;
  for (const transport of order) {
    const res = await fetch(url, { headers: baseHeaders(site, transport, token) });
    if (res.status !== 401 && res.status !== 403) {
      resolvedTransport[site] = transport; // this transport is accepted by the server
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
  `${SITES[site].label} session key rejected — make sure you are logged in at ${SITES[site].base.replace('https://', '')}, then open ${SITES[site].base}/api/auth/get-session, copy the whole page, and paste it again`;

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

export interface GeoMyGroup {
  id?: string;
  name: string;
  code: string;
  role?: string;
  memberCount?: number;
}

/**
 * List the groups the token's owner belongs to on a site (GET /api/groups).
 * Powers the group picker in the connect flow. Throws if the token is bad.
 */
export async function fetchMyGroups(
  sessionToken: string,
  site: Site = DEFAULT_SITE
): Promise<GeoMyGroup[]> {
  const res = await siteFetch(site, sessionToken, '/api/groups');
  if (res.status === 401 || res.status === 403) throw new Error(tokenRejected(site));
  if (!res.ok) throw new Error(`${SITES[site].label} returned HTTP ${res.status}`);
  const data: { groups?: GeoMyGroup[]; error?: string } = await res.json();
  if (data.error === 'Not authenticated') throw new Error(tokenRejected(site));
  if (data.error) throw new Error(data.error);
  return (data.groups || []).filter(g => g && typeof g.code === 'string' && g.code);
}

/** Proxy a site's public questions endpoint (no auth needed). */
export async function fetchQuestions(site: Site = DEFAULT_SITE) {
  const res = await fetch(`${SITES[site].base}/api/v2/questions`);
  if (!res.ok) return null;
  return res.json();
}

/**
 * Ask a site how long a session token lives. Returns the ISO `expiresAt`
 * string from /api/auth/get-session, or null on any failure (never throws —
 * expiry tracking is best-effort and must not break a sync).
 * Better-auth appears to slide expiry forward on authenticated use, so this
 * also doubles as a keep-alive signal: watch expires_at advance day over day.
 */
export async function fetchSessionExpiry(
  sessionToken: string,
  site: Site = DEFAULT_SITE
): Promise<string | null> {
  try {
    const res = await siteFetch(site, sessionToken, '/api/auth/get-session');
    if (!res.ok) return null;
    const data = await res.json();
    return data?.session?.expiresAt ?? null;
  } catch {
    return null;
  }
}
