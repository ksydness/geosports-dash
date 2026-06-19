'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

type SiteKey = 'geosports' | 'geohistory' | 'geofooty';

const SITES: { key: SiteKey; label: string; host: string; cookie: string; emoji: string; accent: string }[] = [
  { key: 'geosports',  label: 'GeoSports',  host: 'geosports.app',  cookie: '__Secure-geosports.session_token',  emoji: '🏟️', accent: '#3b82f6' },
  { key: 'geohistory', label: 'GeoHistory', host: 'geohistory.gg',  cookie: '__Secure-geohistory.session_token', emoji: '📜', accent: '#a855f7' },
  { key: 'geofooty',   label: 'GeoFooty',   host: 'geofooty.app',   cookie: '__Secure-geofooty.session_token',   emoji: '⚽', accent: '#22c55e' },
];

export default function Home() {
  const router = useRouter();
  const [groupCode, setGroupCode] = useState('');
  const [tokens, setTokens] = useState<Record<SiteKey, string>>({ geosports: '', geohistory: '', geofooty: '' });
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [helpFor, setHelpFor] = useState<SiteKey | null>(null);

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('code');
    if (code) setGroupCode(code.trim().toUpperCase().slice(0, 10));
  }, []);

  const anyToken = SITES.some(s => tokens[s.key].trim());

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!anyToken) {
      setError('Add a session token for at least one game to connect.');
      return;
    }
    setLoading(true);
    const tokenMap: Partial<Record<SiteKey, string>> = {};
    SITES.forEach(s => { if (tokens[s.key].trim()) tokenMap[s.key] = tokens[s.key].trim(); });

    try {
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          group_code: groupCode.trim().toUpperCase(),
          tokens: tokenMap,
          email: email.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Something went wrong. Please try again.');
        return;
      }
      router.push(data.url);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.hero}>
        <div style={styles.logo}>🌍</div>
        <h1 style={styles.title}>GeoSports Dash</h1>
        <p style={styles.subtitle}>
          Enhanced stats and history for your GeoSports, GeoHistory &amp; GeoFooty group
        </p>
      </div>

      <div style={styles.card}>
        <form onSubmit={handleSubmit}>
          <div style={styles.field}>
            <label style={styles.label}>Group Code</label>
            <input
              style={styles.input}
              type="text"
              placeholder="e.g. GRP7KX"
              value={groupCode}
              onChange={e => setGroupCode(e.target.value.toUpperCase())}
              maxLength={10}
              required
              autoFocus
            />
            <p style={styles.hint}>The same code works across all three games.</p>
          </div>

          <div style={{ marginBottom: 8 }}>
            <label style={styles.label}>Connect your games</label>
            <p style={styles.hint}>
              Add a token for any game you want to track — one is enough, and you can add the
              others later from your dashboard.
            </p>
          </div>

          {SITES.map(s => (
            <div key={s.key} style={styles.siteCard}>
              <div style={styles.siteHead}>
                <span style={styles.siteName}>
                  <span style={{ marginRight: 6 }}>{s.emoji}</span>{s.label}
                  <span style={styles.optional}>optional</span>
                </span>
                <button
                  type="button"
                  style={{ ...styles.helpToggle, color: s.accent }}
                  onClick={() => setHelpFor(h => (h === s.key ? null : s.key))}
                >
                  {helpFor === s.key ? 'Hide' : 'How to find this'}
                </button>
              </div>

              {helpFor === s.key && (
                <div style={{ ...styles.helpBox, borderColor: hexA(s.accent, 0.3), background: hexA(s.accent, 0.06) }}>
                  <p style={styles.helpStep}><strong>1.</strong> Open <a href={`https://${s.host}`} target="_blank" rel="noreferrer" style={{ color: s.accent }}>{s.host}</a> and log in</p>
                  <p style={styles.helpStep}><strong>2.</strong> Press <kbd style={styles.kbd}>F12</kbd> → <strong>Application</strong> → <strong>Cookies</strong> → <code style={styles.code}>https://{s.host}</code></p>
                  <p style={styles.helpStep}><strong>3.</strong> Copy the value of <code style={styles.code}>{s.cookie}</code></p>
                </div>
              )}

              <input
                style={{ ...styles.input, borderColor: tokens[s.key].trim() ? hexA(s.accent, 0.6) : 'rgba(255,255,255,0.1)' }}
                type="password"
                placeholder={`Paste ${s.label} session token`}
                value={tokens[s.key]}
                onChange={e => setTokens(t => ({ ...t, [s.key]: e.target.value }))}
              />
            </div>
          ))}

          <div style={{ ...styles.field, marginTop: 16 }}>
            <label style={styles.label}>
              Email <span style={{ color: '#6b7a99', fontWeight: 400 }}>(optional)</span>
            </label>
            <input
              style={styles.input}
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
            />
            <p style={styles.hint}>Tokens are stored encrypted and only used to sync your group&apos;s scores.</p>
          </div>

          {error && <div style={styles.errorBox}>{error}</div>}

          <button type="submit" style={{ ...styles.button, opacity: anyToken && !loading ? 1 : 0.6 }} disabled={loading}>
            {loading ? 'Setting up…' : 'Create My Dashboard →'}
          </button>
        </form>
      </div>

      <p style={styles.footer}>
        Scores sync automatically. Share the link with your group once it&apos;s ready.
      </p>

      <a href="/g/demo" style={styles.demoLink}>
        👀 See a demo first
      </a>
    </div>
  );
}

// rgba() from a hex color + alpha.
function hexA(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px 20px' },
  hero: { textAlign: 'center', marginBottom: 28 },
  logo: { fontSize: 40, marginBottom: 12 },
  title: { fontSize: 28, fontWeight: 700, letterSpacing: '-0.5px' },
  subtitle: { fontSize: 15, color: '#6b7a99', marginTop: 8, maxWidth: 360 },
  card: { width: '100%', maxWidth: 440, background: '#0f1826', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 16, padding: '28px 24px' },
  field: { marginBottom: 20 },
  label: { display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 },
  input: { width: '100%', background: '#080e1a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '10px 14px', color: '#f0f4ff', fontSize: 14, outline: 'none' },
  hint: { fontSize: 11, color: '#6b7a99', marginTop: 5 },
  siteCard: { background: '#0b1320', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, padding: '12px 12px 14px', marginBottom: 10 },
  siteHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  siteName: { fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center' },
  optional: { fontSize: 10, fontWeight: 500, color: '#6b7a99', marginLeft: 8, textTransform: 'uppercase', letterSpacing: '0.06em' },
  helpToggle: { background: 'none', border: 'none', fontSize: 11, cursor: 'pointer', padding: 0 },
  helpBox: { border: '1px solid', borderRadius: 8, padding: '10px 12px', marginBottom: 10 },
  helpStep: { fontSize: 12, lineHeight: 1.6, color: '#c7d3f0', marginBottom: 3 },
  kbd: { background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 3, padding: '1px 4px', fontSize: 11, fontFamily: 'monospace' },
  code: { background: 'rgba(255,255,255,0.08)', borderRadius: 3, padding: '1px 4px', fontSize: 11, fontFamily: 'monospace' },
  errorBox: { background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#fca5a5', marginBottom: 16 },
  button: { width: '100%', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 8, padding: '12px', fontSize: 14, fontWeight: 600, cursor: 'pointer' },
  footer: { fontSize: 12, color: '#6b7a99', marginTop: 20, textAlign: 'center' },
  demoLink: { display: 'inline-block', marginTop: 14, fontSize: 13, color: '#6b7a99', textDecoration: 'none', borderBottom: '1px dotted #6b7a99' },
};
