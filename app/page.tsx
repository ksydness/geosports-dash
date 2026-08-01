'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { parseTokenPaste, keyPageUrl } from '@/lib/token-paste';

type SiteKey = 'geosports' | 'geohistory' | 'geofooty';

const SITES: { key: SiteKey; label: string; host: string; cookie: string; emoji: string; accent: string }[] = [
  { key: 'geosports',  label: 'GeoSports',  host: 'geosports.app',  cookie: '__Secure-geosports.session_token',  emoji: '🏟️', accent: '#3b82f6' },
  { key: 'geohistory', label: 'GeoHistory', host: 'geohistory.gg',  cookie: '__Secure-geohistory.session_token', emoji: '📜', accent: '#a855f7' },
  { key: 'geofooty',   label: 'GeoFooty',   host: 'geofooty.app',   cookie: '__Secure-geofooty.session_token',   emoji: '⚽', accent: '#22c55e' },
];

interface MyGroup { code: string; name: string; memberCount?: number }

export default function Home() {
  const router = useRouter();
  const [groupCode, setGroupCode] = useState('');
  const [paste, setPaste] = useState('');
  const [token, setToken] = useState('');
  const [keyStatus, setKeyStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [selected, setSelected] = useState<Record<SiteKey, boolean>>({ geosports: true, geohistory: false, geofooty: false });
  const [myGroups, setMyGroups] = useState<MyGroup[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [showManualCode, setShowManualCode] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('code');
    if (code) {
      setGroupCode(code.trim().toUpperCase().slice(0, 10));
      setShowManualCode(true);
    }
  }, []);

  const selectedSites = SITES.filter(s => selected[s.key]).map(s => s.key);

  // Parse whatever landed in the paste box. The key page's JSON is parsed
  // right here in the browser — only the extracted token ever leaves it.
  function handlePaste(value: string) {
    setPaste(value);
    setError('');
    if (!value.trim()) {
      setToken('');
      setKeyStatus(null);
      return;
    }
    const parsed = parseTokenPaste(value);
    if (!parsed.ok) {
      setToken('');
      setKeyStatus({ ok: false, msg: parsed.error });
      return;
    }
    setToken(parsed.token);
    setKeyStatus({ ok: true, msg: '✓ Key found — checking it…' });
    void lookupGroups(parsed.token);
  }

  // Validate the key and pull the member's groups for the picker. One key
  // works on all three games (shared accounts), so any site validates it.
  async function lookupGroups(tok: string) {
    setGroupsLoading(true);
    try {
      const res = await fetch('/api/token/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ site: 'geosports', token: tok }),
      });
      const data = await res.json();
      if (!res.ok) {
        setToken('');
        setKeyStatus({ ok: false, msg: data.error || 'Could not verify this key.' });
        return;
      }
      setKeyStatus({ ok: true, msg: '✓ Key verified — now pick your games and group' });
      const groups: MyGroup[] = data.groups || [];
      setMyGroups(prev => {
        const seen = new Set(prev.map(g => g.code));
        return [...prev, ...groups.filter(g => !seen.has(g.code))];
      });
      setGroupCode(prev => (prev ? prev : groups.length === 1 ? groups[0].code : prev));
    } catch {
      setKeyStatus({ ok: false, msg: 'Network error while checking the key — try again.' });
    } finally {
      setGroupsLoading(false);
    }
  }

  // One-tap paste for mobile; falls back to a hint if the browser says no.
  async function pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      if (text) handlePaste(text);
      else setKeyStatus({ ok: false, msg: 'Clipboard is empty — copy the key page first.' });
    } catch {
      setKeyStatus({ ok: false, msg: 'Tap the box and paste manually (long-press → Paste).' });
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!token) {
      setError('Paste your key first (step 1 and 2).');
      return;
    }
    if (selectedSites.length === 0) {
      setError('Tick at least one game to track.');
      return;
    }
    if (!groupCode.trim()) {
      setError('Pick your group (or enter its code).');
      return;
    }
    setLoading(true);
    // Same key for every ticked game — tokens are valid across all three sites.
    const tokenMap: Partial<Record<SiteKey, string>> = {};
    selectedSites.forEach(k => { tokenMap[k] = token; });

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
            <div style={styles.stepHead}>
              <label style={styles.label}>1 · Get your key</label>
              <button type="button" style={styles.helpToggle} onClick={() => setShowHelp(h => !h)}>
                {showHelp ? 'Hide help' : 'Help'}
              </button>
            </div>
            <p style={styles.hint}>
              Open the key page for any game you&apos;re logged into — one key works for all three.
            </p>
            <div style={styles.keyLinks}>
              {SITES.map(s => (
                <a
                  key={s.key}
                  href={keyPageUrl(s.host)}
                  target="_blank"
                  rel="noreferrer"
                  style={{ ...styles.keyBtn, borderColor: hexA(s.accent, 0.5), color: s.accent }}
                >
                  {s.emoji} {s.label} key ↗
                </a>
              ))}
            </div>

            {showHelp && (
              <div style={styles.helpBox}>
                <p style={styles.helpStep}><strong>Phone:</strong> tap-hold the text → Select All → Copy, then use the 📋 button below.</p>
                <p style={styles.helpStep}><strong>Computer:</strong> Ctrl/Cmd-A, Ctrl/Cmd-C, then paste below.</p>
                <p style={styles.helpStep}><strong>Not logged in?</strong> The key page shows &quot;null&quot; — log in to the game first and reopen it.</p>
                <p style={styles.helpStep}><strong>Old-school:</strong> pasting a session cookie value from DevTools still works.</p>
              </div>
            )}
          </div>

          <div style={styles.field}>
            <label style={styles.label}>2 · Paste it here</label>
            <div style={styles.pasteRow}>
              <input
                style={{
                  ...styles.input,
                  flex: 1,
                  borderColor: keyStatus?.ok
                    ? 'rgba(59,130,246,0.6)'
                    : keyStatus ? 'rgba(239,68,68,0.5)' : 'rgba(255,255,255,0.1)',
                }}
                type="password"
                placeholder="Paste everything from the key page"
                value={paste}
                onChange={e => handlePaste(e.target.value)}
              />
              <button type="button" title="Paste from clipboard" style={styles.clipBtn} onClick={pasteFromClipboard}>
                📋
              </button>
            </div>
            {keyStatus && (
              <p style={{ ...styles.pasteStatus, color: keyStatus.ok ? '#86efac' : '#fca5a5' }}>
                {keyStatus.msg}
              </p>
            )}
          </div>

          <div style={styles.field}>
            <label style={styles.label}>3 · Choose the games your group plays</label>
            <div style={styles.siteChecks}>
              {SITES.map(s => (
                <label
                  key={s.key}
                  style={{
                    ...styles.siteCheck,
                    borderColor: selected[s.key] ? hexA(s.accent, 0.6) : 'rgba(255,255,255,0.1)',
                    background: selected[s.key] ? hexA(s.accent, 0.08) : '#080e1a',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selected[s.key]}
                    onChange={() => setSelected(sel => ({ ...sel, [s.key]: !sel[s.key] }))}
                    style={styles.checkbox}
                  />
                  <span>{s.emoji} {s.label}</span>
                </label>
              ))}
            </div>
            <p style={styles.hint}>
              Your key connects any of them. Only tick games your group actually plays — the
              combined Sicko Mode board counts days where someone played every connected game.
            </p>
          </div>

          <div style={styles.field}>
            <label style={styles.label}>4 · Pick your group</label>
            {myGroups.length > 0 ? (
              <div style={styles.groupPick}>
                {myGroups.map(g => (
                  <button
                    key={g.code}
                    type="button"
                    onClick={() => setGroupCode(g.code)}
                    style={{
                      ...styles.groupBtn,
                      borderColor: groupCode === g.code ? '#3b82f6' : 'rgba(255,255,255,0.12)',
                      background: groupCode === g.code ? 'rgba(59,130,246,0.12)' : '#080e1a',
                    }}
                  >
                    <span style={{ fontWeight: 600 }}>{g.name}</span>
                    <span style={styles.groupMeta}>
                      {g.code}{typeof g.memberCount === 'number' ? ` · ${g.memberCount} members` : ''}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p style={styles.hint}>
                {groupsLoading
                  ? 'Finding your groups…'
                  : token
                    ? 'No groups found on that account — enter your group code below.'
                    : 'Paste your key above and your groups will appear here.'}
              </p>
            )}

            {(showManualCode || (token && myGroups.length === 0 && !groupsLoading)) ? (
              <input
                style={{ ...styles.input, marginTop: 8 }}
                type="text"
                placeholder="Group code, e.g. GRP7KX"
                value={groupCode}
                onChange={e => setGroupCode(e.target.value.toUpperCase())}
                maxLength={10}
              />
            ) : (
              <button type="button" style={styles.manualToggle} onClick={() => setShowManualCode(true)}>
                or enter a group code manually
              </button>
            )}
          </div>

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
            <p style={styles.hint}>
              Keys are stored encrypted and only used to sync your group&apos;s scores. Your email
              and other details on the key page never leave your browser. See our{' '}
              <a href="/privacy" style={styles.hintLink}>privacy policy</a>.
            </p>
          </div>

          {error && <div style={styles.errorBox}>{error}</div>}

          <button
            type="submit"
            style={{ ...styles.button, opacity: token && selectedSites.length > 0 && groupCode.trim() && !loading ? 1 : 0.6 }}
            disabled={loading}
          >
            {loading ? 'Setting up…' : 'Create My Dashboard →'}
          </button>
        </form>
      </div>

      <p style={styles.footer}>
        Scores sync automatically. Share the link with your group once it&apos;s ready.
      </p>

      <div style={{ marginTop: 14, display: 'flex', gap: 20 }}>
        <a href="/g/demo" style={{ ...styles.demoLink, marginTop: 0 }}>
          👀 See a demo first
        </a>
        <a href="/privacy" style={{ ...styles.demoLink, marginTop: 0 }}>
          Privacy &amp; Terms
        </a>
      </div>
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
  stepHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  label: { display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 },
  input: { width: '100%', background: '#080e1a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '10px 14px', color: '#f0f4ff', fontSize: 14, outline: 'none' },
  hint: { fontSize: 11, color: '#6b7a99', marginTop: 5 },
  hintLink: { color: '#6b7a99', textDecoration: 'underline' },
  helpToggle: { background: 'none', border: 'none', fontSize: 11, cursor: 'pointer', padding: 0, color: '#6b7a99' },
  helpBox: { border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '10px 12px', marginTop: 10 },
  helpStep: { fontSize: 12, lineHeight: 1.6, color: '#c7d3f0', marginBottom: 3 },
  keyLinks: { display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' },
  keyBtn: { flex: '1 1 30%', textAlign: 'center', border: '1px solid', borderRadius: 8, padding: '8px 6px', fontSize: 12, fontWeight: 600, textDecoration: 'none', background: 'rgba(255,255,255,0.02)', whiteSpace: 'nowrap' },
  pasteRow: { display: 'flex', gap: 6 },
  clipBtn: { background: '#080e1a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '0 12px', fontSize: 15, cursor: 'pointer', color: '#f0f4ff' },
  pasteStatus: { fontSize: 11, marginTop: 5 },
  siteChecks: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  siteCheck: { flex: '1 1 30%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, border: '1px solid', borderRadius: 8, padding: '9px 6px', fontSize: 12, fontWeight: 600, color: '#f0f4ff', cursor: 'pointer', whiteSpace: 'nowrap' },
  checkbox: { accentColor: '#3b82f6', cursor: 'pointer' },
  groupPick: { display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 },
  groupBtn: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, border: '1px solid', borderRadius: 8, padding: '9px 12px', fontSize: 13, color: '#f0f4ff', cursor: 'pointer', textAlign: 'left' },
  groupMeta: { fontSize: 11, color: '#6b7a99' },
  manualToggle: { background: 'none', border: 'none', color: '#6b7a99', fontSize: 11, cursor: 'pointer', padding: 0, marginTop: 8, textDecoration: 'underline', textDecorationStyle: 'dotted' },
  errorBox: { background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#fca5a5', marginBottom: 16 },
  button: { width: '100%', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 8, padding: '12px', fontSize: 14, fontWeight: 600, cursor: 'pointer' },
  footer: { fontSize: 12, color: '#6b7a99', marginTop: 20, textAlign: 'center' },
  demoLink: { display: 'inline-block', marginTop: 14, fontSize: 13, color: '#6b7a99', textDecoration: 'none', borderBottom: '1px dotted #6b7a99' },
};
