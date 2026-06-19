// The three sister games share one backend (same user IDs, same group codes,
// same API shape) but live on separate domains with separate session cookies.
// Everything site-specific lives here so the rest of the app stays generic.

export type Site = 'geosports' | 'geohistory' | 'geofooty';

export interface SiteConfig {
  key: Site;
  label: string; // human label, e.g. "GeoHistory"
  base: string; // origin, e.g. "https://geohistory.gg"
  /**
   * Candidate session-cookie names, most-likely first. better-auth names the
   * cookie `__Secure-<prefix>.session_token`; each site sets its own prefix.
   * We fall back to the geosports prefix in case a site reused that config.
   * `siteFetch` tries these in order and memoises the one that authenticates.
   */
  cookieNames: string[];
  accent: string; // theme color for the site switcher
  emoji: string;
}

export const SITES: Record<Site, SiteConfig> = {
  geosports: {
    key: 'geosports',
    label: 'GeoSports',
    base: 'https://geosports.app',
    cookieNames: ['__Secure-geosports.session_token'],
    accent: '#3b82f6',
    emoji: '🏟️',
  },
  geohistory: {
    key: 'geohistory',
    label: 'GeoHistory',
    base: 'https://geohistory.gg',
    cookieNames: ['__Secure-geohistory.session_token', '__Secure-geosports.session_token'],
    accent: '#a855f7',
    emoji: '📜',
  },
  geofooty: {
    key: 'geofooty',
    label: 'GeoFooty',
    base: 'https://geofooty.app',
    cookieNames: ['__Secure-geofooty.session_token', '__Secure-geosports.session_token'],
    accent: '#22c55e',
    emoji: '⚽',
  },
};

export const SITE_KEYS = Object.keys(SITES) as Site[];

export function isSite(s: string): s is Site {
  return Object.prototype.hasOwnProperty.call(SITES, s);
}

/** Default site for legacy callers (single-token registration, old dashboard). */
export const DEFAULT_SITE: Site = 'geosports';
