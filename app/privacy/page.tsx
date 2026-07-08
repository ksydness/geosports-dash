import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy & Terms — GeoSports Dash',
  description: 'Privacy policy and terms of use for GeoSports Dash',
};

export default function PrivacyPage() {
  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <a href="/" style={styles.back}>← Back</a>

        <h1 style={styles.h1}>Privacy &amp; Terms</h1>
        <p style={styles.updated}>Last updated: July 7, 2026</p>

        <div style={styles.tldr}>
          <strong>The short version:</strong> GeoSports Dash is a free, unofficial companion
          dashboard. We store the minimum needed to show your group&apos;s scores, your session
          tokens are encrypted, there are no ads and nothing is sold, and you can have your
          data deleted at any time by asking.
        </div>

        <h2 style={styles.h2}>1. What GeoSports Dash Is</h2>
        <p style={styles.p}>
          GeoSports Dash (geosports-dash.vercel.app, &quot;the service&quot;) is an independent,
          unofficial hobby project that provides enhanced stats and history for GeoSports,
          GeoHistory, and GeoFooty groups. It is <strong>not affiliated with, endorsed by, or
          operated by</strong> GeoSports, GeoHistory, GeoFooty, or Rhino Studios Inc. All game
          names and content belong to their respective owners.
        </p>

        <h2 style={styles.h2}>2. Information We Collect</h2>
        <p style={styles.p}>
          <strong>Group information:</strong> your group code and group name, as reported by the
          game&apos;s API.
        </p>
        <p style={styles.p}>
          <strong>Email address (optional):</strong> if you provide one at registration, it is
          used only to contact you about your dashboard (for example, if syncing stops working).
          No marketing email is ever sent.
        </p>
        <p style={styles.p}>
          <strong>Session tokens:</strong> the per-game session tokens you provide are encrypted
          at rest (AES-256-GCM) and used solely to fetch your group&apos;s scores from the
          game&apos;s API. They are never displayed, shared, or used to act on your account in any
          other way. Only submit a session token for an account you own.
        </p>
        <p style={styles.p}>
          <strong>Score data:</strong> to build the leaderboard, we store the daily scores,
          per-question scores, display names, and player IDs of your group&apos;s members, as
          returned by the game&apos;s group API. Guess locations of group members are not
          collected.
        </p>
        <p style={styles.p}>
          <strong>Analytics:</strong> we use Vercel Analytics, which collects anonymized page-view
          data and does not use cross-site tracking cookies.
        </p>

        <h2 style={styles.h2}>3. A Note About Your Group Members</h2>
        <p style={styles.p}>
          Registering a group creates a dashboard URL showing your group members&apos; scores to
          anyone who has the link. Dashboard URLs are unlisted but not password-protected. Please
          only register a group whose members are comfortable with this — the same information is
          already visible to every member inside the game&apos;s own group page.
        </p>

        <h2 style={styles.h2}>4. How We Use Information</h2>
        <p style={styles.p}>
          Information is used only to operate the service: syncing scores, rendering your
          dashboard, and contacting you about problems with your dashboard if you gave an email.
          We do not sell personal information, show ads, or share data with anyone except the
          service providers below.
        </p>

        <h2 style={styles.h2}>5. Service Providers</h2>
        <p style={styles.p}>
          The service runs on Vercel (hosting and analytics) and Supabase (database). Your data is
          stored and processed by these providers as part of operating the service. Score data is
          fetched from the respective game&apos;s servers using the token you provided.
        </p>

        <h2 style={styles.h2}>6. Data Retention &amp; Deletion</h2>
        <p style={styles.p}>
          Data is kept while your group is active. To delete your group and all associated data
          (scores, tokens, email), email the address below and it will be removed promptly. You
          can also invalidate your stored token at any time by logging out of the game website,
          which stops all syncing.
        </p>

        <h2 style={styles.h2}>7. Terms of Use</h2>
        <p style={styles.p}>
          The service is provided free of charge, <strong>&quot;as is&quot; and &quot;as
          available&quot;, without warranties of any kind</strong>. It is a hobby project: it may
          break, lose data, change, or shut down at any time without notice. Syncing depends on
          the games&apos; APIs, which may change or stop working at any time. To the fullest
          extent permitted by law, the operator of GeoSports Dash is not liable for any damages
          arising from your use of the service. You must be at least 13 years old to use the
          service.
        </p>

        <h2 style={styles.h2}>8. Changes</h2>
        <p style={styles.p}>
          This page may be updated from time to time; material changes will be reflected in the
          &quot;last updated&quot; date above.
        </p>

        <h2 style={styles.h2}>9. Contact</h2>
        <p style={styles.p}>
          Questions, or want your data deleted? Email{' '}
          <a href="mailto:kenny@coachup.com" style={styles.link}>kenny@coachup.com</a>.
        </p>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', display: 'flex', justifyContent: 'center', padding: '48px 20px' },
  container: { width: '100%', maxWidth: 640 },
  back: { fontSize: 13, color: '#6b7a99', textDecoration: 'none' },
  h1: { fontSize: 26, fontWeight: 700, letterSpacing: '-0.5px', marginTop: 18 },
  updated: { fontSize: 12, color: '#6b7a99', marginTop: 6, marginBottom: 20 },
  tldr: { background: '#0f1826', border: '1px solid rgba(59,130,246,0.25)', borderRadius: 10, padding: '14px 16px', fontSize: 13.5, lineHeight: 1.65, color: '#c7d3f0', marginBottom: 8 },
  h2: { fontSize: 16, fontWeight: 600, marginTop: 28, marginBottom: 8 },
  p: { fontSize: 13.5, lineHeight: 1.7, color: '#c7d3f0', marginBottom: 10 },
  link: { color: '#3b82f6' },
};
