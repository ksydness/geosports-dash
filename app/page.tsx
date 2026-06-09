'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function Home() {
  const router = useRouter();
  const [groupCode, setGroupCode] = useState('');
  const [sessionToken, setSessionToken] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showTokenHelp, setShowTokenHelp] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          group_code: groupCode.trim().toUpperCase(),
          session_token: sessionToken.trim(),
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
          Enhanced stats and history for your GeoSports group
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
          </div>

          <div style={styles.field}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <label style={styles.label}>GeoSports Session Token</label>
              <button
                type="button"
                style={styles.helpToggle}
                onClick={() => setShowTokenHelp(h => !h)}
              >
                {showTokenHelp ? 'Hide' : 'How to find this'}
              </button>
            </div>

            {showTokenHelp && (
              <div style={styles.helpBox}>
                <p style={styles.helpStep}><strong>1.</strong> Open <a href="https://geosports.app" target="_blank" rel="noreferrer" style={styles.link}>geosports.app</a> and log in</p>
                <p style={styles.helpStep}><strong>2.</strong> Press <kbd style={styles.kbd}>F12</kbd> to open DevTools</p>
                <p style={styles.helpStep}><strong>3.</strong> Go to <strong>Application</strong> → <strong>Cookies</strong> → <code style={styles.code}>https://geosports.app</code></p>
                <p style={styles.helpStep}><strong>4.</strong> Find <code style={styles.code}>__Secure-geosports.session_token</code> and copy its value</p>
              </div>
            )}

            <input
              style={styles.input}
              type="password"
              placeholder="Paste your session token"
              value={sessionToken}
              onChange={e => setSessionToken(e.target.value)}
              required
            />
            <p style={styles.hint}>Stored securely and only used to sync your group&apos;s scores.</p>
          </div>

          <div style={styles.field}>
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
            <p style={styles.hint}>We&apos;ll notify you if your token expires and syncing stops.</p>
          </div>

          {error && <div style={styles.errorBox}>{error}</div>}

          <button type="submit" style={styles.button} disabled={loading}>
            {loading ? 'Setting up…' : 'Create My Dashboard →'}
          </button>
        </form>
      </div>

      <p style={styles.footer}>
        Scores sync automatically. Share the link with your group once it&apos;s ready.
      </p>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '32px 20px',
  },
  hero: {
    textAlign: 'center',
    marginBottom: 32,
  },
  logo: { fontSize: 40, marginBottom: 12 },
  title: { fontSize: 28, fontWeight: 700, letterSpacing: '-0.5px' },
  subtitle: { fontSize: 15, color: '#6b7a99', marginTop: 8 },
  card: {
    width: '100%',
    maxWidth: 440,
    background: '#0f1826',
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: 16,
    padding: '28px 24px',
  },
  field: { marginBottom: 20 },
  label: { display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 },
  input: {
    width: '100%',
    background: '#080e1a',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 8,
    padding: '10px 14px',
    color: '#f0f4ff',
    fontSize: 14,
    outline: 'none',
  },
  hint: { fontSize: 11, color: '#6b7a99', marginTop: 5 },
  helpToggle: {
    background: 'none',
    border: 'none',
    color: '#3b82f6',
    fontSize: 11,
    cursor: 'pointer',
    padding: 0,
  },
  helpBox: {
    background: 'rgba(59,130,246,0.06)',
    border: '1px solid rgba(59,130,246,0.2)',
    borderRadius: 8,
    padding: '12px 14px',
    marginBottom: 10,
  },
  helpStep: { fontSize: 12, lineHeight: 1.6, color: '#c7d3f0', marginBottom: 4 },
  link: { color: '#3b82f6' },
  kbd: {
    background: 'rgba(255,255,255,0.1)',
    border: '1px solid rgba(255,255,255,0.2)',
    borderRadius: 3,
    padding: '1px 4px',
    fontSize: 11,
    fontFamily: 'monospace',
  },
  code: {
    background: 'rgba(255,255,255,0.08)',
    borderRadius: 3,
    padding: '1px 4px',
    fontSize: 11,
    fontFamily: 'monospace',
  },
  errorBox: {
    background: 'rgba(239,68,68,0.08)',
    border: '1px solid rgba(239,68,68,0.2)',
    borderRadius: 8,
    padding: '10px 14px',
    fontSize: 13,
    color: '#fca5a5',
    marginBottom: 16,
  },
  button: {
    width: '100%',
    background: '#3b82f6',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    padding: '12px',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },
  footer: {
    fontSize: 12,
    color: '#6b7a99',
    marginTop: 20,
    textAlign: 'center',
  },
};
