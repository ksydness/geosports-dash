// Client-side parsing for the "key page" connect flow.
//
// Users connect a game by visiting `https://<site>/api/auth/get-session` while
// logged in (the "key page"), selecting everything, and pasting it into the
// dashboard. That JSON contains `session.token` — the only piece we keep.
// Everything else on the page (email, IP, user agent) is parsed HERE, in the
// browser, and never sent to our server.
//
// For continuity we also accept what users pasted historically: a raw
// better-auth session token, or the signed session-cookie value from DevTools.

export type TokenPasteResult =
  | { ok: true; token: string; kind: 'key-page' | 'raw' | 'cookie' }
  | { ok: false; error: string };

const NOT_LOGGED_IN =
  'That key page says you are not logged in — log in to the game in this browser, then open the key page again.';

/** Raw better-auth session tokens are plain alphanumeric strings (~32 chars). */
export function isRawSessionToken(text: string): boolean {
  return /^[A-Za-z0-9]{20,64}$/.test(text);
}

export function parseTokenPaste(pasted: string): TokenPasteResult {
  const text = (pasted || '').trim();
  if (!text) return { ok: false, error: 'Nothing pasted yet.' };

  // Unauthenticated key page renders as the literal text "null".
  if (text === 'null') return { ok: false, error: NOT_LOGGED_IN };

  // Whole key page (or any JSON blob containing session.token). Tolerate junk
  // around the JSON — some browsers wrap it in viewer chrome when copying.
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      const data: unknown = JSON.parse(text.slice(start, end + 1));
      if (data && typeof data === 'object') {
        const session = (data as { session?: unknown }).session;
        if (session === null) return { ok: false, error: NOT_LOGGED_IN };
        const token = (session as { token?: unknown } | undefined)?.token;
        if (typeof token === 'string' && token.length >= 16) {
          return { ok: true, token, kind: 'key-page' };
        }
        if (session !== undefined) return { ok: false, error: NOT_LOGGED_IN };
      }
    } catch {
      // Not valid JSON — fall through to the raw/cookie formats.
    }
  }

  // Raw session token (e.g. re-pasted from a previous setup).
  if (isRawSessionToken(text)) return { ok: true, token: text, kind: 'raw' };

  // Legacy: the signed session-cookie value copied from DevTools
  // (URL-encoded, contains a `.` signature separator).
  if (/^[\w.%~+-]{20,300}$/.test(text)) return { ok: true, token: text, kind: 'cookie' };

  return {
    ok: false,
    error:
      "That doesn't look like a session key — open the key page, select ALL the text on it, copy, and paste it here.",
  };
}

/** The per-site "key page" URL users copy their session key from. */
export function keyPageUrl(host: string): string {
  return `https://${host}/api/auth/get-session`;
}
