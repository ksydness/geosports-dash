'use client';

import { useEffect, useRef } from 'react';
import { milesToRawScore, haversineMiles, scoreTier, greatCirclePoints } from '@/lib/scoring';

interface ScoreEntry {
  date: string;
  userId?: string;
  username: string;
  score: number;
  rawScores?: number[];
}

interface InitialData {
  group_name: string;
  scores: ScoreEntry[];
  active: boolean;
}

interface Props {
  groupCode: string;
  initialData?: InitialData;
}

export default function Dashboard({ groupCode, initialData }: Props) {
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    initDashboard(groupCode, initialData);
  }, [groupCode, initialData]);

  return (
    <>
      <style>{CSS}</style>
      <div id="app">
        <div className="header">
          <div className="header-logo" onClick={() => (window as any).openGame && (window as any).openGame()}>🌍</div>
          <h1 id="groupTitle">Loading…</h1>
          <p>GeoSports Dashboard</p>
        </div>
        <div className="tabs">
          <div className="tab active" data-tab="today" onClick={() => (window as any).switchTab('today')}>Today</div>
          <div className="tab" data-tab="week" onClick={() => (window as any).switchTab('week')}>Week</div>
          <div className="tab" data-tab="month" onClick={() => (window as any).switchTab('month')}>Month</div>
          <div className="tab" data-tab="alltime" onClick={() => (window as any).switchTab('alltime')}>All Time</div>
          <div className="tab" data-tab="stats" onClick={() => (window as any).switchTab('stats')}>Stats</div>
        </div>
        <div className="content">
          <div id="tabContent"><div className="loading">Loading scores…</div></div>
          <div className="footer" id="footer"></div>
        </div>
      </div>

      {/* Map review modal */}
      <div id="mapModal" className="map-modal" style={{display:'none'}}>
        <div className="map-modal-bar">
          <span id="mapModalTitle" className="map-modal-title"></span>
          <button className="map-modal-close" onClick={() => (window as any).closeMapReview()}>✕</button>
        </div>
        <div id="mapContainer" className="map-container"></div>
        <div id="mapInfoPanel" className="map-info-panel"></div>
      </div>

      {/* Secret practice game (globe-icon easter egg) */}
      <div id="gameModal" className="game-modal" style={{display:'none'}}>
        <div className="game-bar">
          <div className="game-score-box">
            <div className="game-score-lbl">SCORE</div>
            <div id="gameScore" className="game-score-val">000</div>
          </div>
          <div className="game-head">
            <div id="gameProgress" className="game-progress"></div>
            <div id="gamePrompt" className="game-prompt"></div>
          </div>
          <button className="game-close" onClick={() => (window as any).closeGame()}>✕</button>
        </div>
        <div className="game-map-wrap">
          <div id="gameMap" className="map-container"></div>
          <div id="gameToast" className="game-toast" style={{display:'none'}}></div>
        </div>
        <div id="gamePanel" className="game-panel"></div>
        <div id="gameResults" className="game-results" style={{display:'none'}}></div>
      </div>

    </>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Escape untrusted strings for safe interpolation into innerHTML.
function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Encode a value as a JS string literal that is safe inside an inline
// event-handler attribute (the HTML parser decodes entities before JS runs).
function attrJs(s: string): string {
  return esc(JSON.stringify(s));
}

// The game rolls over at midnight Eastern — "today" must match the server.
const ET_FORMAT = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' });
function todayETStr(): string {
  return ET_FORMAT.format(new Date());
}

// ─── Dashboard logic ──────────────────────────────────────────────────────────

// Players are identified by a stable GeoSports userId; the display username is
// mutable (people rename themselves mid-season). Collapse every row for a given
// userId onto that user's most-recent username so renames don't fragment one
// player into many. Rows without a userId (legacy) keep their own username.
function canonicalizeNames<T extends {date:string;userId?:string;username:string}>(scores: T[]): T[] {
  const latest: Record<string,{date:string;username:string}> = {};
  for (const s of scores) {
    if (!s.userId) continue;
    if (!latest[s.userId] || s.date > latest[s.userId].date) {
      latest[s.userId] = { date: s.date, username: s.username };
    }
  }
  // Resolve display-name collisions across distinct userIds deterministically.
  const display: Record<string,string> = {};
  const seen = new Set<string>();
  for (const id of Object.keys(latest).sort()) {
    const base = latest[id].username;
    display[id] = seen.has(base) ? `${base} (${id.slice(0,4)})` : base;
    seen.add(base);
  }
  return scores.map(s => (s.userId && display[s.userId]) ? { ...s, username: display[s.userId] } : s);
}

function initDashboard(groupCode: string, initialData?: InitialData) {
  const Q_MULTIPLIERS = [1, 1, 2, 3, 3];
  const Q_MAX_PTS     = [100, 100, 200, 300, 300];

  let allScores: {date:string;userId?:string;username:string;score:number;rawScores?:number[]}[] = [];
  let questionsCache: Record<string, string[]> = {};
  let currentTab = 'today';
  let lastFetched: Date | null = null;
  let openEntry: string | null = null;

  // ── Data loading ─────────────────────────────────────────────────────────────

  // forceSync = true (Refresh button) asks the server to pull from GeoSports
  // before responding, so a new play appears in a single refresh.
  async function loadScores(forceSync = false) {
    // If pre-loaded demo data was provided, use it directly — no fetch needed
    if (initialData) {
      allScores = canonicalizeNames(initialData.scores || []);
      lastFetched = new Date();
      const title = document.getElementById('groupTitle');
      if (title) title.textContent = initialData.group_name || groupCode;
      renderTab(currentTab);
      renderFooter();
      return;
    }

    // Keep the current view visible while a live sync runs
    if (!forceSync) setContent('<div class="loading">Loading scores…</div>');
    try {
      const res = await fetch(`/api/scores/${groupCode}${forceSync ? '?sync=1' : ''}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load');
      allScores = canonicalizeNames(data.scores || []);
      lastFetched = new Date();
      const title = document.getElementById('groupTitle');
      if (title) title.textContent = data.group_name || groupCode;
      renderTab(currentTab);
      renderFooter();
      // Show AFTER renderTab — renderTab overwrites #tabContent's innerHTML,
      // which would wipe a banner prepended beforehand.
      if (!data.active) showInactiveBanner();
    } catch (e: any) {
      setContent(`<div class="error-box">Could not load scores.<br><small>${esc(e.message)}</small></div>`);
    }
  }

  async function loadQuestions() {
    try {
      const res = await fetch('/api/questions');
      if (!res.ok) return;
      const data = await res.json();
      for (const round of (data.rounds || [])) {
        questionsCache[round.date] = round.questions.map((q: any) => q.prompt);
      }
    } catch { /* non-fatal */ }
  }

  function showInactiveBanner() {
    // Insert as a sibling BEFORE #tabContent (not inside it) so it survives the
    // innerHTML resets that renderTab/setContent perform on every tab switch.
    if (document.getElementById('inactiveBanner')) return; // dedupe
    const content = document.getElementById('tabContent');
    if (!content || !content.parentNode) return;
    const banner = document.createElement('div');
    banner.id = 'inactiveBanner';
    banner.style.cssText = 'background:rgba(251,191,36,0.1);border:1px solid rgba(251,191,36,0.3);border-radius:8px;padding:12px 14px;font-size:13px;color:#fde68a;margin-bottom:12px;';
    // Static markup only (no user input) — safe to set as innerHTML. The buttons
    // call window-scoped handlers defined below. Submitting updates THIS group via
    // the register endpoint (upsert on group_code), so it never creates a duplicate.
    banner.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">
        <span>⚠️ Sync paused — your GeoSports session token expired.</span>
        <button id="tokenToggleBtn" onclick="toggleTokenForm()" style="background:rgba(251,191,36,0.2);border:1px solid rgba(251,191,36,0.5);color:#fde68a;border-radius:6px;padding:5px 10px;font-size:12px;cursor:pointer;white-space:nowrap;">Update token →</button>
      </div>
      <div id="tokenForm" style="display:none;margin-top:10px;border-top:1px solid rgba(251,191,36,0.25);padding-top:10px;">
        <div style="font-size:12px;line-height:1.55;color:#fcd9a0;margin-bottom:8px;">
          Grab a fresh token — this <b>updates your existing group</b>, it does not create a new one:<br>
          1. Log in at <a href="https://geosports.app" target="_blank" rel="noopener" style="color:#fde68a;">geosports.app</a><br>
          2. Open DevTools (F12, or ⌥⌘I on Mac) → <b>Application</b> ▸ <b>Cookies</b> ▸ https://geosports.app<br>
          3. Copy the value of <code style="background:rgba(0,0,0,0.3);padding:1px 4px;border-radius:3px;">__Secure-geosports.session_token</code><br>
          4. Paste it below and resume.
        </div>
        <textarea id="tokenInput" rows="2" placeholder="Paste your __Secure-geosports.session_token value" style="width:100%;box-sizing:border-box;background:rgba(0,0,0,0.25);border:1px solid rgba(251,191,36,0.4);border-radius:6px;color:#fff;font-size:12px;padding:7px;resize:vertical;"></textarea>
        <div style="display:flex;align-items:center;gap:10px;margin-top:8px;flex-wrap:wrap;">
          <button id="tokenSubmitBtn" onclick="submitTokenUpdate()" style="background:#f59e0b;border:none;color:#1a1a1a;font-weight:600;border-radius:6px;padding:7px 14px;font-size:12px;cursor:pointer;">Resume syncing</button>
          <span id="tokenStatus" style="font-size:12px;"></span>
        </div>
      </div>`;
    content.parentNode.insertBefore(banner, content);
  }

  // ── Exposed globals ───────────────────────────────────────────────────────────

  (window as any).switchTab = function(tab: string) {
    currentTab = tab;
    openEntry = null;
    document.querySelectorAll('.tab').forEach(t => {
      (t as HTMLElement).classList.toggle('active', (t as HTMLElement).dataset.tab === tab);
    });
    if (tab === 'stats') renderStats();
    else renderTab(tab);
  };

  (window as any).toggleBreakdown = function(username: string) {
    const isOpen = openEntry === username;
    openEntry = isOpen ? null : username;
    document.querySelectorAll('.entry-wrap').forEach(wrap => {
      const u = (wrap as HTMLElement).dataset.username;
      const entry = wrap.querySelector('.entry');
      const panel = wrap.querySelector('.breakdown');
      if (!panel) return;
      const open = u === openEntry;
      panel.classList.toggle('open', open);
      entry?.classList.toggle('expanded', open);
    });
  };

  (window as any).refreshNow = async function() {
    const btn = document.querySelector('.sync-btn') as HTMLButtonElement;
    if (btn) { btn.textContent = '↻ Syncing…'; btn.disabled = true; }
    await loadScores(true);
    if (btn) { btn.textContent = '↻ Refresh'; btn.disabled = false; }
  };

  (window as any).toggleTokenForm = function() {
    const form = document.getElementById('tokenForm');
    if (!form) return;
    const isOpen = form.style.display !== 'none';
    form.style.display = isOpen ? 'none' : 'block';
    const toggle = document.getElementById('tokenToggleBtn');
    if (toggle) toggle.textContent = isOpen ? 'Update token →' : 'Cancel';
    if (!isOpen) (document.getElementById('tokenInput') as HTMLElement | null)?.focus();
  };

  // Submit a new token for THIS group. /api/register upserts on group_code, so it
  // re-activates and re-backfills the existing group rather than creating a new one.
  (window as any).submitTokenUpdate = async function() {
    const input = document.getElementById('tokenInput') as HTMLTextAreaElement | null;
    const status = document.getElementById('tokenStatus');
    const btn = document.getElementById('tokenSubmitBtn') as HTMLButtonElement | null;
    const token = (input?.value || '').trim();
    const setStatus = (msg: string, color: string) => {
      if (status) { status.textContent = msg; status.style.color = color; }
    };
    if (!token) { setStatus('Paste your session token first.', '#fca5a5'); return; }
    if (btn) { btn.disabled = true; btn.textContent = 'Verifying…'; }
    setStatus('Verifying token and resuming sync…', '#fde68a');
    try {
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ group_code: groupCode, session_token: token }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not verify token');
      setStatus('✓ Token updated — reloading…', '#86efac');
      setTimeout(() => location.reload(), 900);
    } catch (e: any) {
      setStatus(e?.message || 'Could not verify token', '#fca5a5');
      if (btn) { btn.disabled = false; btn.textContent = 'Resume syncing'; }
    }
  };

  // ── Date utils ────────────────────────────────────────────────────────────────

  function toDateStr(d: Date) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  function getDateRange(tab: string) {
    const todayStr = todayETStr();
    const today = new Date(todayStr + 'T00:00:00');
    if (tab === 'today') return { start: todayStr, end: todayStr, label: todayStr };
    if (tab === 'week') {
      const d = new Date(today);
      const dow = d.getDay();
      d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow));
      const s = toDateStr(d);
      return { start: s, end: todayStr, label: `${s} – ${todayStr}` };
    }
    if (tab === 'month') {
      const s = toDateStr(new Date(today.getFullYear(), today.getMonth(), 1));
      return { start: s, end: todayStr, label: `${s} – ${todayStr}` };
    }
    const dates = allScores.map(s => s.date).sort();
    const s = dates[0] || '2020-01-01';
    return { start: s, end: todayStr, label: `${s} – ${todayStr}` };
  }
  function formatDisplayDate(dateStr: string) {
    const [, m, d] = dateStr.split('-').map(Number);
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${months[m-1]} ${d}`;
  }

  // ── Tier helpers ──────────────────────────────────────────────────────────────

  function tierClass(r: number) {
    if (r >= 100) return 'tier-perfect';
    if (r >= 90)  return 'tier-great';
    if (r >= 50)  return 'tier-good';
    if (r >= 1)   return 'tier-ok';
    return 'tier-low';
  }
  function dotClass(r: number) {
    if (r >= 100) return 'dot-perfect';
    if (r >= 90)  return 'dot-great';
    if (r >= 50)  return 'dot-good';
    if (r >= 1)   return 'dot-ok';
    return 'dot-zero';
  }
  function barClass(r: number) {
    if (r >= 90) return 'bar-green';
    if (r >= 50) return 'bar-yellow';
    return 'bar-red';
  }
  function totalTierClass(score: number, max: number) {
    const p = score / max;
    if (p >= 0.97) return 'tier-perfect';
    if (p >= 0.90) return 'tier-great';
    if (p >= 0.75) return 'tier-good';
    if (p >= 0.55) return 'tier-ok';
    return 'tier-low';
  }

  // ── Breakdown builders ────────────────────────────────────────────────────────

  function buildTodayBreakdown(rawScores: number[], date: string, groupAvgs: number[] | null, username: string) {
    if (rawScores.length !== 5) return '';
    const prompts = questionsCache[date] || [];
    const dots = rawScores.map(r => `<div class="dot ${dotClass(r)}"></div>`).join('');
    const bars = rawScores.map((r, i) => {
      const pts = r * Q_MULTIPLIERS[i];
      const pct = Math.round((pts / Q_MAX_PTS[i]) * 100);
      const prompt = prompts[i] || '';
      const grpPts = groupAvgs ? groupAvgs[i] * Q_MULTIPLIERS[i] : null;
      return `<div class="q-row ${prompt ? 'has-prompt' : 'no-prompt'}">
        <div class="q-label">Q${i+1}</div>
        <div class="q-middle">
          ${prompt ? `<div class="q-prompt-text">${esc(prompt)}</div>` : ''}
          <div class="q-bar-row"><div class="q-bar-track"><div class="q-bar-fill ${barClass(r)}" style="width:${pct}%"></div></div></div>
        </div>
        <div class="q-pts-col">
          <div class="q-pts ${tierClass(r)}">${pts}</div>
          ${grpPts !== null ? `<div class="q-group-avg">grp ${grpPts}</div>` : ''}
        </div>
      </div>`;
    }).join('');
    const mapBtn = `<button class="user-map-btn" onclick="event.stopPropagation();openUserMap('${date}',${attrJs(username)})">\ud83c\udfaf See ${esc(username)}'s guesses on the map</button>`;
    return `<div class="breakdown-inner"><div class="dot-row">${dots}</div>${bars}${mapBtn}</div>`;
  }

  function buildDayList(days: {date:string;score:number;rawScores?:number[]|null}[], username: string) {
    const rows = [...days].reverse().map(d => {
      const tc = totalTierClass(d.score, 1000);
      const dots = (d.rawScores || []).map(r => `<div class="mini-dot ${dotClass(r)}"></div>`).join('');
      const mapIcon = `<button class="day-map-icon" onclick="event.stopPropagation();openMapReview('${d.date}')" title="View on map">📍</button>`;
      const ringIcon = `<button class="day-map-icon" onclick="event.stopPropagation();openUserMap('${d.date}',${attrJs(username)})" title="See this player\u2019s distance rings">\ud83c\udfaf</button>`;
      return `<div class="day-row">
        <div class="day-date-lbl">${formatDisplayDate(d.date)}</div>
        <div class="day-score-num ${tc}">${d.score}</div>
        ${dots ? `<div class="day-mini-dots">${dots}</div>` : ''}
        ${mapIcon}${ringIcon}
      </div>`;
    }).join('');
    return `<div class="breakdown-inner">${rows}</div>`;
  }

  function computeQAvgs(days: {rawScores?:number[]|null}[]) {
    const valid = days.filter(d => d.rawScores && d.rawScores.length === 5);
    if (!valid.length) return null;
    const sums = [0,0,0,0,0];
    valid.forEach(d => d.rawScores!.forEach((r,i) => sums[i] += r));
    return sums.map(v => Math.round(v / valid.length));
  }

  function buildQAvgBreakdown(qAvgs: number[], daysWithRaw: number) {
    const dots = qAvgs.map(r => `<div class="dot ${dotClass(r)}"></div>`).join('');
    const bars = qAvgs.map((r, i) => {
      const pts = r * Q_MULTIPLIERS[i];
      const pct = Math.round((pts / Q_MAX_PTS[i]) * 100);
      return `<div class="q-row no-prompt">
        <div class="q-label">Q${i+1}</div>
        <div class="q-middle"><div class="q-bar-row"><div class="q-bar-track"><div class="q-bar-fill ${barClass(r)}" style="width:${pct}%"></div></div></div></div>
        <div class="q-pts-col"><div class="q-pts ${tierClass(r)}">${pts}</div><div class="q-group-avg">avg</div></div>
      </div>`;
    }).join('');
    return `<div class="breakdown-inner">
      <div class="breakdown-section-label">Avg over ${daysWithRaw} day${daysWithRaw !== 1 ? 's' : ''}</div>
      <div class="dot-row">${dots}</div>${bars}
    </div>`;
  }

  // ── Stats ─────────────────────────────────────────────────────────────────────

  function getWeekKey(dateStr: string) {
    const d = new Date(dateStr + 'T00:00:00');
    const dow = d.getDay();
    const mon = new Date(d);
    mon.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow));
    return toDateStr(mon);
  }

  function computeAllStats() {
    const allUsers = [...new Set(allScores.map(s => s.username))];
    type Stat = { username:string;daysPlayed:number;daysWon:number;weeksWon:number;monthsWon:number;totalScore:number;bestScore:number;avg:number;currentStreak:number;bestStreak:number;lastPlace:number;currentLosingStreak:number;worstScore:number;h2h:Record<string,{w:number;l:number;t:number}> };
    const stats: Record<string, Stat> = {};
    allUsers.forEach(u => {
      stats[u] = { username:u,daysPlayed:0,daysWon:0,weeksWon:0,monthsWon:0,totalScore:0,bestScore:0,avg:0,currentStreak:0,bestStreak:0,lastPlace:0,currentLosingStreak:0,worstScore:999999,h2h:{} };
      allUsers.forEach(v => { if (v !== u) stats[u].h2h[v] = {w:0,l:0,t:0}; });
    });
    const byDate: Record<string, typeof allScores> = {};
    allScores.forEach(s => { if (!byDate[s.date]) byDate[s.date]=[]; byDate[s.date].push(s); });
    Object.values(byDate).forEach(players => {
      const top = Math.max(...players.map(p => p.score));
      const bot = Math.min(...players.map(p => p.score));
      players.forEach(p => {
        if (!stats[p.username]) return;
        const u = stats[p.username];
        u.daysPlayed++; u.totalScore += p.score;
        if (p.score > u.bestScore) u.bestScore = p.score;
        if (p.score < u.worstScore) u.worstScore = p.score;
        // Solo days don't count as wins — beating nobody is no victory
        if (players.length >= 2 && p.score >= top) u.daysWon++;
        // Wooden spoon: last place only counts when there's someone to lose to
        if (players.length >= 2 && p.score <= bot) u.lastPlace++;
        players.forEach(q => {
          if (q.username === p.username || !u.h2h[q.username]) return;
          if (p.score > q.score) u.h2h[q.username].w++;
          else if (p.score < q.score) u.h2h[q.username].l++;
          else u.h2h[q.username].t++;
        });
      });
    });
    function daysBetween(a: string, b: string) {
      const [y1,m1,d1] = a.split('-').map(Number);
      const [y2,m2,d2] = b.split('-').map(Number);
      return Math.round((new Date(y2,m2-1,d2).getTime() - new Date(y1,m1-1,d1).getTime()) / 86400000);
    }
    allUsers.forEach(u => {
      const dates = [...new Set(allScores.filter(s=>s.username===u).map(s=>s.date))].sort();
      if (!dates.length) return;
      let best=1,run=1;
      for (let i=1;i<dates.length;i++) { run = daysBetween(dates[i-1],dates[i])===1?run+1:1; if(run>best)best=run; }
      stats[u].bestStreak = best;
      const today = todayETStr();
      const yestD = new Date(today + 'T00:00:00'); yestD.setDate(yestD.getDate()-1);
      const yest = toDateStr(yestD);
      const last = dates[dates.length-1];
      let curr = 0;
      if (last===today||last===yest) { curr=1; for(let i=dates.length-2;i>=0;i--){if(daysBetween(dates[i],dates[i+1])===1)curr++;else break;} }
      stats[u].currentStreak = curr;
    });
    const byWeek: Record<string,Record<string,number>> = {};
    allScores.forEach(s => { const wk=getWeekKey(s.date); if(!byWeek[wk])byWeek[wk]={}; byWeek[wk][s.username]=(byWeek[wk][s.username]||0)+s.score; });
    Object.values(byWeek).forEach(wk => { if(Object.keys(wk).length<2)return; const top=Math.max(...Object.values(wk)); Object.entries(wk).forEach(([u,sc])=>{if(sc>=top&&stats[u])stats[u].weeksWon++;}); });
    const byMonth: Record<string,Record<string,number>> = {};
    allScores.forEach(s => { const mk=s.date.slice(0,7); if(!byMonth[mk])byMonth[mk]={}; byMonth[mk][s.username]=(byMonth[mk][s.username]||0)+s.score; });
    Object.values(byMonth).forEach(mk => { if(Object.keys(mk).length<2)return; const top=Math.max(...Object.values(mk)); Object.entries(mk).forEach(([u,sc])=>{if(sc>=top&&stats[u])stats[u].monthsWon++;}); });
    allUsers.forEach(u => { stats[u].avg = stats[u].daysPlayed>0?Math.round(stats[u].totalScore/stats[u].daysPlayed):0; });
    // Current (active) losing streak: consecutive most-recent played days without a win.
    // A win requires a 2+ player day; solo days don't break the streak.
    const wonByUser: Record<string, Set<string>> = {};
    Object.entries(byDate).forEach(([date, players]) => {
      if (players.length < 2) return;
      const dayTop = Math.max(...players.map(p => p.score));
      players.forEach(p => {
        if (p.score >= dayTop) {
          if (!wonByUser[p.username]) wonByUser[p.username] = new Set();
          wonByUser[p.username].add(date);
        }
      });
    });
    allUsers.forEach(u => {
      const dates = [...new Set(allScores.filter(s=>s.username===u).map(s=>s.date))].sort();
      let streak = 0;
      for (let i=dates.length-1; i>=0; i--) {
        if (wonByUser[u] && wonByUser[u].has(dates[i])) break;
        streak++;
      }
      stats[u].currentLosingStreak = streak;
    });
    return stats;
  }

  // ── Renderers ─────────────────────────────────────────────────────────────────

  function setContent(html: string) {
    const el = document.getElementById('tabContent');
    if (el) el.innerHTML = html;
  }

  function renderTab(tab: string) {
    if (tab === 'stats') { renderStats(); return; }
    const { start, end, label } = getDateRange(tab);
    const isToday = tab === 'today';
    const filtered = allScores.filter(s => s.date >= start && s.date <= end);
    const allUsers = [...new Set(allScores.map(s => s.username))].sort();
    type UserBucket = { total:number;count:number;best:number;days:{date:string;score:number;rawScores?:number[]|null}[] };
    const byUser: Record<string, UserBucket> = {};
    filtered.forEach(s => {
      if (!byUser[s.username]) byUser[s.username]={total:0,count:0,best:0,days:[]};
      byUser[s.username].total += s.score;
      byUser[s.username].count++;
      if (s.score > byUser[s.username].best) byUser[s.username].best = s.score;
      byUser[s.username].days.push({date:s.date,score:s.score,rawScores:s.rawScores||null});
    });
    Object.values(byUser).forEach(u => u.days.sort((a,b)=>b.date.localeCompare(a.date)));
    let groupAvgs: number[] | null = null;
    if (isToday) {
      const withRaw = allScores.filter(s=>s.date===start&&s.rawScores&&s.rawScores.length===5);
      if (withRaw.length>0) {
        const sums=[0,0,0,0,0];
        withRaw.forEach(s=>s.rawScores!.forEach((r,i)=>sums[i]+=r));
        groupAvgs = sums.map(v=>Math.round(v/withRaw.length));
      }
    }
    const entries = allUsers.map(u => ({
      username:u, played:!!byUser[u],
      total:byUser[u]?.total??null, count:byUser[u]?.count??0,
      avg:byUser[u]?Math.round(byUser[u].total/byUser[u].count):null,
      best:byUser[u]?.best??null, days:byUser[u]?.days??[],
    }));
    entries.sort((a,b)=>{ if(a.total===null&&b.total===null)return 0; if(a.total===null)return 1; if(b.total===null)return -1; return b.total-a.total; });
    const played = entries.filter(e=>e.played);
    const totalDays = isToday?null:[...new Set(filtered.map(s=>s.date))].length;
    const avgScore = played.length?Math.round(played.reduce((s,e)=>s+(e.avg??0),0)/played.length):null;
    const mapBtn = `<button class="map-review-btn" onclick="openMapReview('${start}')">🗺 Map</button>`;
    let html = `<div class="period-label-row"><span class="period-label">${label}</span>${isToday ? mapBtn : ''}</div>`;
    if (!isToday && played.length>0) {
      html += `<div class="stats-strip">
        <div class="stat"><div class="stat-val">${totalDays}</div><div class="stat-lbl">Days</div></div>
        <div class="stat"><div class="stat-val">${played.length}</div><div class="stat-lbl">Active</div></div>
        <div class="stat"><div class="stat-val">${avgScore}</div><div class="stat-lbl">Avg/Day</div></div>
      </div>`;
    }
    html += '<div class="card">';
    if (entries.length===0) {
      html += '<div class="empty">No scores recorded yet.</div>';
    } else {
      let playedRank = 0;
      entries.forEach(e => {
        let rankStr: string;
        if (e.played) { playedRank++; rankStr = playedRank===1?'🥇':playedRank===2?'🥈':playedRank===3?'🥉':`${playedRank}`; }
        else rankStr = '—';
        const initials = e.username.split(/\s+/).map((w:string)=>w[0]).join('').slice(0,2).toUpperCase();
        const tClass = e.total!==null?totalTierClass(isToday?e.total:e.avg??0,1000):'';
        let breakdownContent = '';
        if (e.played) {
          if (isToday) { const raw=e.days[0]?.rawScores; if(raw&&raw.length===5)breakdownContent=buildTodayBreakdown(raw,start,groupAvgs,e.username); }
          else if (tab==='week') { if(e.days.length>0)breakdownContent=buildDayList(e.days,e.username); }
          else { const qAvgs=computeQAvgs(e.days); if(qAvgs){const n=e.days.filter(d=>d.rawScores&&d.rawScores.length===5).length;breakdownContent=buildQAvgBreakdown(qAvgs,n);} }
        }
        const hasBreak = breakdownContent.length>0;
        let scoreHtml: string;
        if (e.played) {
          if (isToday) scoreHtml=`<div class="score-col"><div class="score-main ${tClass}">${e.total}</div><div class="score-sub">/ 1,000</div></div>`;
          else scoreHtml=`<div class="score-col"><div class="score-main ${tClass}">${(e.total??0).toLocaleString()}</div><div class="score-sub">${e.count} day${e.count!==1?'s':''} · avg ${e.avg}</div></div>`;
        } else {
          scoreHtml=`<div class="score-col no-played">Not played</div>`;
        }
        const isExpanded = openEntry===e.username;
        html += `<div class="entry-wrap" data-username="${esc(e.username)}">
          <div class="entry${hasBreak?' expandable':''}${isExpanded?' expanded':''}" ${hasBreak?`onclick="toggleBreakdown(${attrJs(e.username)})"`:''}>
            <div class="rank">${rankStr}</div>
            <div class="avatar">${esc(initials)}</div>
            <div class="info"><div class="name">${esc(e.username)}</div>${!isToday&&e.played?`<div class="sub">Best: ${e.best}</div>`:''}</div>
            ${scoreHtml}
            ${hasBreak?'<div class="chevron">▾</div>':''}
          </div>
          ${hasBreak?`<div class="breakdown${isExpanded?' open':''}">${breakdownContent}</div>`:''}
        </div>`;
      });
    }
    html += '</div>';
    setContent(html);
    if (openEntry) {
      // note: window.CSS — the module-level CSS string constant shadows the global
      const wrap = document.querySelector(`.entry-wrap[data-username="${window.CSS.escape(openEntry)}"]`);
      if (wrap) { wrap.querySelector('.breakdown')?.classList.add('open'); wrap.querySelector('.entry')?.classList.add('expanded'); }
    }
  }

  function renderStats() {
    if (!allScores.length) { setContent('<div class="empty">No scores recorded yet.</div>'); return; }
    const stats = computeAllStats();
    const users = Object.values(stats).filter(u=>u.daysPlayed>0);
    const minAvg = 5;
    const mostWon = users.reduce((b,u)=>(!b||u.daysWon>b.daysWon)?u:b, null as typeof users[0]|null);
    const bestScr = users.reduce((b,u)=>(!b||u.bestScore>b.bestScore)?u:b, null as typeof users[0]|null);
    const qualAvg = users.filter(u=>u.daysPlayed>=minAvg);
    const bestAvg = (qualAvg.length?qualAvg:users).reduce((b,u)=>(!b||u.avg>b.avg)?u:b, null as typeof users[0]|null);
    const bestStrk = users.reduce((b,u)=>(!b||u.bestStreak>b.bestStreak)?u:b, null as typeof users[0]|null);
    const records = [
      {emoji:'🏆',val:mostWon?.daysWon??0,name:mostWon?.username??'—',lbl:'Most Days Won'},
      {emoji:'💯',val:bestScr?.bestScore??0,name:bestScr?.username??'—',lbl:'Best Score'},
      {emoji:'📊',val:bestAvg?.avg??0,name:bestAvg?.username??'—',lbl:'Best Average'},
      {emoji:'🔥',val:bestStrk?.bestStreak??0,name:bestStrk?.username??'—',lbl:'Longest Streak'},
    ];
    const recordsHtml = records.map(r=>`<div class="record-card"><div class="record-emoji">${r.emoji}</div><div class="record-val">${r.val}</div><div class="record-name">${esc(r.name)}</div><div class="record-lbl">${r.lbl}</div></div>`).join('');
    // ── Wooden Spoon — group-specific inside joke, only for Crank Drive, Putt off Green ──
    // Bad-stat mirror of the four record cards, same order (Days Won→Wooden Spoon, Best Score→Lowest Score,
    // Best Average→Lowest Average, Longest Streak→Cold Streak). Group-specific to Crank Drive, Putt off Green.
    let spoonHtml = '';
    if (groupCode === 'TXA6HQ') {
      const spoon = users.reduce((b,u)=>(!b||u.lastPlace>b.lastPlace)?u:b, null as typeof users[0]|null);
      if (spoon && spoon.lastPlace>0) {
        spoonHtml += `<div class="record-card wooden-spoon"><div class="record-emoji">🥄</div><div class="record-val">${spoon.lastPlace}</div><div class="record-name">${esc(spoon.username)}</div><div class="record-lbl">Wooden Spoon · Most Last-Place Finishes</div></div>`;
      }
      const worst = users.reduce((b,u)=>(!b||u.worstScore<b.worstScore)?u:b, null as typeof users[0]|null);
      if (worst) {
        spoonHtml += `<div class="record-card wooden-spoon"><div class="record-emoji">💀</div><div class="record-val">${worst.worstScore}</div><div class="record-name">${esc(worst.username)}</div><div class="record-lbl">Lowest Score</div></div>`;
      }
      const minLowAvg = 10; // mirror of Best Average but stricter, so it reflects regular players
      const qualLow = users.filter(u=>u.daysPlayed>=minLowAvg);
      const lowAvg = (qualLow.length?qualLow:users).reduce((b,u)=>(!b||u.avg<b.avg)?u:b, null as typeof users[0]|null);
      if (lowAvg) {
        spoonHtml += `<div class="record-card wooden-spoon"><div class="record-emoji">📉</div><div class="record-val">${lowAvg.avg}</div><div class="record-name">${esc(lowAvg.username)}</div><div class="record-lbl">Lowest Average</div></div>`;
      }
      const cold = users.reduce((b,u)=>(!b||u.currentLosingStreak>b.currentLosingStreak)?u:b, null as typeof users[0]|null);
      if (cold && cold.currentLosingStreak>0) {
        spoonHtml += `<div class="record-card wooden-spoon"><div class="record-emoji">🥶</div><div class="record-val">${cold.currentLosingStreak}</div><div class="record-name">${esc(cold.username)}</div><div class="record-lbl">Cold Streak · Longest Active No-Win Streak</div></div>`;
      }
    }
    const sorted = [...users].sort((a,b)=>b.daysWon-a.daysWon||b.avg-a.avg);
    let html = `<div class="period-label">ALL TIME</div><div class="stats-records">${recordsHtml}${spoonHtml}</div><div class="stats-section-lbl">Player Stats</div><div class="card">`;
    sorted.forEach(u => {
      const initials = u.username.split(/\s+/).map((w:string)=>w[0]).join('').slice(0,2).toUpperCase();
      const h2hEntries = Object.entries(u.h2h).filter(([,r])=>r.w+r.l+r.t>0);
      const h2hHtml = h2hEntries.length?`<div class="h2h-section-title">Head-to-Head</div>${h2hEntries.sort((a,b)=>b[1].w-a[1].w).map(([opp,r])=>`<div class="h2h-row"><div class="h2h-name">${esc(opp)}</div><div class="h2h-record"><span class="h2h-w">${r.w}W</span><span class="h2h-t" style="margin:0 3px">·</span><span class="h2h-l">${r.l}L</span>${r.t>0?`<span class="h2h-t" style="margin:0 3px">·</span><span class="h2h-t">${r.t}T</span>`:''}</div></div>`).join('')}`:'';
      const key = `stats-${u.username}`;
      const isExpanded = openEntry===key;
      const panelHtml = `<div class="breakdown-inner"><div class="stats-grid">
        <div class="sg-item"><div class="sg-val">${u.daysWon}</div><div class="sg-lbl">Days Won</div></div>
        <div class="sg-item"><div class="sg-val">${u.daysPlayed}</div><div class="sg-lbl">Played</div></div>
        <div class="sg-item"><div class="sg-val">${u.avg}</div><div class="sg-lbl">Avg Score</div></div>
        <div class="sg-item"><div class="sg-val">${u.bestScore}</div><div class="sg-lbl">Best Score</div></div>
        <div class="sg-item"><div class="sg-val">🔥 ${u.currentStreak}</div><div class="sg-lbl">Cur Streak</div></div>
        <div class="sg-item"><div class="sg-val">${u.bestStreak}</div><div class="sg-lbl">Best Streak</div></div>
        <div class="sg-item"><div class="sg-val">${u.weeksWon}</div><div class="sg-lbl">Weeks Won</div></div>
        <div class="sg-item"><div class="sg-val">${u.monthsWon}</div><div class="sg-lbl">Months Won</div></div>
      </div>${h2hHtml}</div>`;
      html += `<div class="entry-wrap" data-username="${esc(key)}">
        <div class="entry expandable${isExpanded?' expanded':''}" onclick="toggleBreakdown(${attrJs(key)})">
          <div class="avatar">${esc(initials)}</div>
          <div class="info"><div class="name">${esc(u.username)}</div><div class="sub">${u.daysWon} day${u.daysWon!==1?'s':''} won · ${u.daysPlayed} played</div></div>
          <div class="score-col"><div class="score-main">${u.avg}</div><div class="score-sub">avg</div></div>
          <div class="chevron">▾</div>
        </div>
        <div class="breakdown${isExpanded?' open':''}">${panelHtml}</div>
      </div>`;
    });
    html += '</div>';
    setContent(html);
  }

  function renderFooter() {
    const el = document.getElementById('footer');
    if (!el) return;
    if (initialData) {
      el.innerHTML = `<span style="color:#3b82f6;font-weight:600;">Demo Mode</span> · <a href="/" style="color:var(--muted);text-decoration:none;">Set up your group →</a>`;
    } else {
      const t = lastFetched?.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) || '';
      el.innerHTML = `Updated ${t} · <button class="sync-btn" onclick="refreshNow()">↻ Refresh</button>`;
    }
  }

  // ── Map review ────────────────────────────────────────────────────────────────

  let maplibreLoaded = false;
  let mapInstance: any = null;

  async function loadMapLibre(): Promise<void> {
    if (maplibreLoaded) return;
    return new Promise((resolve) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.css';
      document.head.appendChild(link);
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.js';
      script.onload = () => { maplibreLoaded = true; resolve(); };
      document.head.appendChild(script);
    });
  }

  const PIN_COLORS = ['#3b82f6','#8b5cf6','#ec4899','#f59e0b','#10b981'];

  // Invert the published scoring curve: raw per-question points (0-100) -> miles off.
  const SCORE_CURVE: [number, number][] = [[0,100],[500,70],[1000,56],[2000,45],[3000,36],[4000,28],[5000,22],[12450,0]];
  function pointsToMiles(p: number): number {
    if (p >= 100) return 0;
    if (p <= 0) return 12450;
    for (let i = 0; i < SCORE_CURVE.length - 1; i++) {
      const [m1, p1] = SCORE_CURVE[i];
      const [m2, p2] = SCORE_CURVE[i + 1];
      if (p <= p1 && p >= p2) return m1 + ((p1 - p) / (p1 - p2)) * (m2 - m1);
    }
    return 12450;
  }
  // Geodesic circle polygon (lng/lat ring) around a point.
  function circleCoords(lat: number, lng: number, radiusMiles: number, n = 96): number[][] {
    const R = 3958.8, d = radiusMiles / R;
    const la = lat * Math.PI / 180, lo = lng * Math.PI / 180;
    const out: number[][] = [];
    for (let i = 0; i <= n; i++) {
      const b = 2 * Math.PI * i / n;
      const la2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(b));
      const lo2 = lo + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(la2));
      out.push([lo2 * 180 / Math.PI, la2 * 180 / Math.PI]);
    }
    return out;
  }

  function showMapInfoPanel(guess: any, prompt: string, index: number, ring?: { miles: number; pts: number } | null) {
    const panel = document.getElementById('mapInfoPanel');
    if (!panel) return;
    const color = PIN_COLORS[index];
    const ringLine = ring ? `<div class="map-info-dist" style="color:${color}">≈ ${ring.miles.toLocaleString()} mi off · ${ring.pts} pts</div>` : '';
    panel.innerHTML = `
      <div class="map-info-inner">
        <div class="map-info-qnum" style="color:${color}">Q${index + 1}</div>
        <div class="map-info-prompt">${esc(prompt || '')}</div>
        <div class="map-info-answer">📍 ${esc(guess.answer.name)}</div>
        ${ringLine}
        ${guess.answer.story ? `<div class="map-info-story">${esc(guess.answer.story)}</div>` : ''}
      </div>`;
  }

  // Shared renderer. userRawScores null = plain answer-key map; array = per-user distance rings.
  async function renderMap(date: string, modalTitle: string, userRawScores: number[] | null) {
    const modal = document.getElementById('mapModal');
    const title = document.getElementById('mapModalTitle');
    const container = document.getElementById('mapContainer');
    const panel = document.getElementById('mapInfoPanel');
    if (!modal || !container || !panel) return;

    if (title) title.textContent = modalTitle;
    panel.innerHTML = '<div class="map-info-loading">Loading…</div>';
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    let data: any;
    try {
      const res = await fetch(`/api/answers?date=${date}`);
      if (res.status === 404) {
        panel.innerHTML = '<div class="map-info-loading">No answers available for this date yet.</div>';
        return;
      }
      if (!res.ok) throw new Error('fetch failed');
      data = await res.json();
    } catch {
      panel.innerHTML = '<div class="map-info-loading">Could not load answers.</div>';
      return;
    }
    const guesses: any[] = data.guesses || [];
    if (!guesses.length) {
      panel.innerHTML = '<div class="map-info-loading">No answer data for this date.</div>';
      return;
    }

    await loadMapLibre();
    const maplibregl = (window as any).maplibregl;
    if (mapInstance) { mapInstance.remove(); mapInstance = null; }
    container.innerHTML = '';

    const map = new maplibregl.Map({
      container,
      style: '/map-style.json',
      center: [0, 20],
      zoom: 1,
      minZoom: -1,
      maxZoom: 10,
      projection: { type: 'globe' },
    });
    mapInstance = map;

    const prompts = questionsCache[date] || [];
    const ringFor = (i: number): { miles: number; pts: number } | null => {
      if (!userRawScores || userRawScores.length <= i) return null;
      const pts = userRawScores[i];
      return { miles: Math.round(pointsToMiles(pts)), pts };
    };

    map.on('load', () => {
      const bounds = new maplibregl.LngLatBounds();

      guesses.forEach((g: any, i: number) => {
        const color = PIN_COLORS[i];
        const ring = ringFor(i);

        if (ring) {
          const coords = circleCoords(g.answer.lat, g.answer.lng, ring.miles);
          map.addSource(`ring-${i}`, { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [coords] } } });
          map.addLayer({ id: `ring-fill-${i}`, type: 'fill', source: `ring-${i}`, paint: { 'fill-color': color, 'fill-opacity': 0.12 } });
          map.addLayer({ id: `ring-line-${i}`, type: 'line', source: `ring-${i}`, paint: { 'line-color': color, 'line-width': 2, 'line-opacity': 0.7 } });
          coords.forEach(c => bounds.extend(c as [number, number]));
        }

        const el = document.createElement('div');
        el.style.cssText = `width:28px;height:28px;border-radius:50%;background:${color};border:2px solid #fff;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#fff;box-shadow:0 2px 6px rgba(0,0,0,0.5);cursor:pointer`;
        el.textContent = String(i + 1);
        el.addEventListener('click', () => showMapInfoPanel(g, prompts[i] || '', i, ring));
        new maplibregl.Marker({ element: el }).setLngLat([g.answer.lng, g.answer.lat]).addTo(map);
        bounds.extend([g.answer.lng, g.answer.lat]);
      });

      try { map.fitBounds(bounds, { padding: 60, maxZoom: 5, duration: 1000 }); } catch { /* noop */ }
      showMapInfoPanel(guesses[0], prompts[0] || '', 0, ringFor(0));
    });
  }

  (window as any).openMapReview = function(date: string) {
    renderMap(date, `${formatDisplayDate(date)} answers`, null);
  };

  (window as any).openUserMap = function(date: string, username: string) {
    const rec = allScores.find(s => s.username === username && s.date === date);
    const raw = rec && rec.rawScores && rec.rawScores.length === 5 ? rec.rawScores : null;
    renderMap(date, `${username} · ${formatDisplayDate(date)}`, raw);
  };

  (window as any).closeMapReview = function() {
    const modal = document.getElementById('mapModal');
    if (modal) modal.style.display = 'none';
    document.body.style.overflow = '';
    if (mapInstance) { mapInstance.remove(); mapInstance = null; }
  };


  // ── Secret practice game (triggered by the globe icon) ──────────────────────
  // One persistent globe for the round: reveal eases to frame guess + answer,
  // draws the arc slowly, then the next question keeps that camera. Cities stay
  // hidden the whole time. Scoring is replicated locally from the live curve.
  let gameRound: any[] = [];
  let gameIdx = 0;
  let gameTotal = 0;
  let gameRaw: number[] = [];
  let gameMap: any = null;
  let gameLocked = false;
  let gameMarkers: any[] = [];
  let gameAnimId = 0;
  let gameScoreAnimId = 0;
  const GAME_HIDE_LAYERS = ['label-city', 'label-town'];
  // Original quips (not GeoSports' copy), keyed loosely to score tier.
  const GAME_QUIPS: Record<string, string[]> = {
    perfect: ['Bullseye.', 'Nailed it.', 'Pinpoint.'],
    great: ['Razor sharp.', 'So close.', 'Basically perfect.'],
    good: ['In the ballpark.', 'Not bad at all.', 'Respectable tap.'],
    poor: ['Way off.', 'The globe is big.', 'Wrong neighborhood.', 'Not even close.'],
    zero: ['Other side of the planet.', 'Wrong hemisphere entirely.'],
  };
  function quipFor(raw: number): string {
    const k = raw >= 100 ? 'perfect' : raw >= 90 ? 'great' : raw >= 50 ? 'good' : raw >= 1 ? 'poor' : 'zero';
    const arr = GAME_QUIPS[k];
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function setGameScore() {
    const s = document.getElementById('gameScore');
    if (s) s.textContent = String(gameTotal).padStart(3, '0');
  }
  function animateGameScore(from: number, to: number) {
    if (gameScoreAnimId) cancelAnimationFrame(gameScoreAnimId);
    const el = document.getElementById('gameScore');
    if (!el) return;
    const start = performance.now(), dur = 600;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      el.textContent = String(Math.round(from + (to - from) * t)).padStart(3, '0');
      if (t < 1) gameScoreAnimId = requestAnimationFrame(step); else gameScoreAnimId = 0;
    };
    gameScoreAnimId = requestAnimationFrame(step);
  }

  function clearGameOverlays() {
    if (gameAnimId) { cancelAnimationFrame(gameAnimId); gameAnimId = 0; }
    if (gameScoreAnimId) { cancelAnimationFrame(gameScoreAnimId); gameScoreAnimId = 0; }
    gameMarkers.forEach(m => m.remove());
    gameMarkers = [];
    const toast = document.getElementById('gameToast');
    if (toast) { toast.style.display = 'none'; toast.textContent = ''; }
    if (!gameMap) return;
    ['gc-line', 'region-fill', 'region-line'].forEach(id => { if (gameMap.getLayer(id)) gameMap.removeLayer(id); });
    ['gc', 'answer-region'].forEach(id => { if (gameMap.getSource(id)) gameMap.removeSource(id); });
  }

  function startGameQuestion() {
    // No map recreation, no camera reset — just clear the previous overlays.
    gameLocked = false;
    clearGameOverlays();
    const results = document.getElementById('gameResults');
    if (results) results.style.display = 'none';
    const q = gameRound[gameIdx];
    const prog = document.getElementById('gameProgress');
    const prompt = document.getElementById('gamePrompt');
    const panel = document.getElementById('gamePanel');
    if (prog) prog.textContent = `Question ${gameIdx + 1} of ${gameRound.length}`;
    if (prompt) prompt.textContent = q.prompt;
    if (panel) panel.innerHTML = '<div class="game-hint">Tap the globe where you think the answer is</div>';
  }

  function animateGameLine(coords: number[][], durationMs: number, onDone: () => void) {
    const src = gameMap.getSource('gc');
    if (!src) { onDone(); return; }
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const count = Math.max(2, Math.floor(ease * (coords.length - 1)) + 1);
      src.setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords.slice(0, count) } });
      if (t < 1) gameAnimId = requestAnimationFrame(step);
      else { gameAnimId = 0; onDone(); }
    };
    gameAnimId = requestAnimationFrame(step);
  }

  function handleGameGuess(lng: number, lat: number) {
    if (gameLocked || !gameMap) return;
    gameLocked = true;
    const maplibregl = (window as any).maplibregl;
    const map = gameMap;
    const q = gameRound[gameIdx];
    const miles = haversineMiles(lat, lng, q.answer.lat, q.answer.lng);
    const raw = milesToRawScore(miles);
    const mult = q.multiplier || 1;
    const pts = raw * mult;
    const tier = scoreTier(raw);
    const lineColor = raw >= 50 ? '#22c55e' : '#ef4444';
    const prevTotal = gameTotal;
    gameRaw.push(raw);
    gameTotal += pts;

    const gp = document.createElement('div');
    gp.className = 'game-pin guess';
    gameMarkers.push(new maplibregl.Marker({ element: gp }).setLngLat([lng, lat]).addTo(map));

    // Highlight the answer's US state in green (skipped for non-US answers).
    const region = usStatesGeo ? stateFeatureAt(q.answer.lng, q.answer.lat, usStatesGeo) : null;
    if (region) {
      map.addSource('answer-region', { type: 'geojson', data: region });
      map.addLayer({ id: 'region-fill', type: 'fill', source: 'answer-region', paint: { 'fill-color': '#22c55e', 'fill-opacity': 0.18 } });
      map.addLayer({ id: 'region-line', type: 'line', source: 'answer-region', paint: { 'line-color': '#22c55e', 'line-width': 1.5, 'line-opacity': 0.85 } });
    }

    const coords = greatCirclePoints(lat, lng, q.answer.lat, q.answer.lng, 96);
    map.addSource('gc', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [coords[0], coords[0]] } } });
    map.addLayer({ id: 'gc-line', type: 'line', source: 'gc', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': lineColor, 'line-width': 2.5 } });

    try {
      const b = new maplibregl.LngLatBounds();
      b.extend([lng, lat]); b.extend([q.answer.lng, q.answer.lat]);
      const padBottom = Math.round(window.innerHeight * 0.44) + 30;
      map.fitBounds(b, { padding: { top: 90, bottom: padBottom, left: 70, right: 70 }, maxZoom: 5, duration: 1300, essential: true });
    } catch { /* noop */ }

    const panel = document.getElementById('gamePanel');
    if (panel) panel.innerHTML = '<div class="game-revealing">Revealing…</div>';

    animateGameLine(coords, 1300, () => {
      const ap = document.createElement('div');
      ap.className = 'game-pin answer';
      gameMarkers.push(new maplibregl.Marker({ element: ap }).setLngLat([q.answer.lng, q.answer.lat]).addTo(map));

      const toast = document.getElementById('gameToast');
      if (toast) { toast.textContent = quipFor(raw); toast.style.color = tier.color; toast.style.display = 'block'; }

      animateGameScore(prevTotal, gameTotal);

      const last = gameIdx >= gameRound.length - 1;
      const ptsLabel = mult > 1 ? `${raw} (×${mult}) = ${pts}` : `${raw}`;
      const glow = raw >= 100 ? `box-shadow:0 0 10px ${tier.color};` : '';
      if (panel) panel.innerHTML = `
        <div class="map-info-inner">
          <div class="game-result-line">
            <span class="game-dot" style="background:${tier.color};${glow}"></span>
            <span class="game-result-pts" style="color:${tier.color}">${tier.emoji} ${ptsLabel} pts</span>
            <span class="game-result-dist">${Math.round(miles).toLocaleString()} mi off</span>
          </div>
          <div class="map-info-answer">📍 ${esc(q.answer.name)}</div>
          ${q.answer.story ? `<div class="map-info-story">${esc(q.answer.story)}</div>` : ''}
          <button class="game-next-btn" onclick="${last ? 'gameFinish()' : 'gameNext()'}">${last ? 'See results →' : 'Next question →'}</button>
        </div>`;
    });
  }

  (window as any).gameNext = function () { gameIdx++; startGameQuestion(); };

  (window as any).gameFinish = function () {
    const maxes = gameRound.map(q => 100 * (q.multiplier || 1));
    const totalMax = maxes.reduce((a, b) => a + b, 0);
    const dots = gameRaw.map(r => `<span class="d" style="background:${scoreTier(r).color}"></span>`).join('');
    const rows = gameRaw.map((r, i) => {
      const m = gameRound[i].multiplier || 1;
      const pts = r * m;
      const t = scoreTier(r);
      const pct = Math.max(2, Math.round((pts / maxes[i]) * 100));
      return `<div class="game-bd-row"><span class="game-bd-label">Q${i + 1}</span><div class="game-bd-track"><div class="game-bd-fill" style="width:${pct}%;background:${t.color}"></div></div><span class="game-bd-pts">${pts}</span></div>`;
    }).join('');
    const pct = totalMax ? gameTotal / totalMax : 0;
    const blurb = pct >= 0.95 ? 'Elite. Are you Frank?' : pct >= 0.8 ? 'Sharp memory.' : pct >= 0.6 ? 'Solid round.' : pct >= 0.4 ? 'Keep practicing.' : 'The globe is big. Try again!';
    clearGameOverlays();
    const results = document.getElementById('gameResults');
    if (results) {
      results.innerHTML = `
        <button class="game-results-close" onclick="closeGame()" aria-label="Close">✕</button>
        <div class="game-results-card">
          <div class="game-final-date">Practice round complete</div>
          <div class="game-final-score">${gameTotal}<span> / ${totalMax.toLocaleString()}</span></div>
          <div class="game-final-dots">${dots}</div>
          <div class="game-bd-list">${rows}</div>
          <div class="game-final-lbl">${blurb}</div>
          <button class="game-next-btn" onclick="playAgain()">Play again ↻</button>
        </div>`;
      results.style.display = 'flex';
    }
  };

  (window as any).playAgain = function () { (window as any).openGame(); };

  (window as any).closeGame = function () {
    const modal = document.getElementById('gameModal');
    if (modal) modal.style.display = 'none';
    document.body.style.overflow = '';
    const results = document.getElementById('gameResults');
    if (results) results.style.display = 'none';
    clearGameOverlays();
    if (gameMap) { gameMap.remove(); gameMap = null; }
  };

  (window as any).openGame = async function () {
    const modal = document.getElementById('gameModal');
    if (!modal) return;
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    const panel = document.getElementById('gamePanel');
    const prompt = document.getElementById('gamePrompt');
    const prog = document.getElementById('gameProgress');
    if (prompt) prompt.textContent = '';
    if (prog) prog.textContent = '';
    if (panel) panel.innerHTML = '<div class="map-info-loading">Shuffling questions…</div>';
    try {
      const res = await fetch('/api/practice');
      gameRound = (await res.json()).questions || [];
    } catch { gameRound = []; }
    if (!gameRound.length) {
      if (panel) panel.innerHTML = '<div class="map-info-loading">No questions cached yet — check back tomorrow.</div>';
      return;
    }
    gameIdx = 0; gameTotal = 0; gameRaw = []; gameLocked = false;
    setGameScore();

    await loadMapLibre();
    await loadUsStates();
    const maplibregl = (window as any).maplibregl;
    const container = document.getElementById('gameMap');
    if (!container) return;
    clearGameOverlays();
    if (gameMap) { gameMap.remove(); gameMap = null; }
    container.innerHTML = '';
    const map = new maplibregl.Map({
      container, style: '/map-style.json', center: [-96, 40], zoom: 2.4,
      minZoom: -1, maxZoom: 10, projection: { type: 'globe' },
    });
    gameMap = map;
    map.on('load', () => {
      GAME_HIDE_LAYERS.forEach(id => { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none'); });
      map.on('click', (e: any) => handleGameGuess(e.lngLat.lng, e.lngLat.lat));
      startGameQuestion();
    });
  };


  // ── Boot ──────────────────────────────────────────────────────────────────────

  Promise.all([loadScores(), loadQuestions()]);
}

// ─── CSS ──────────────────────────────────────────────────────────────────────

// US state polygons for the practice game's green answer-region highlight.
let usStatesGeo: any = null;
async function loadUsStates(): Promise<any> {
  if (usStatesGeo) return usStatesGeo;
  try { usStatesGeo = await fetch('/us-states.geojson').then(r => r.json()); }
  catch { usStatesGeo = { features: [] }; }
  return usStatesGeo;
}
function pointInRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (((yi > lat) !== (yj > lat)) && (lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
function pointInPolygon(lng: number, lat: number, poly: number[][][]): boolean {
  if (!pointInRing(lng, lat, poly[0])) return false;
  for (let k = 1; k < poly.length; k++) if (pointInRing(lng, lat, poly[k])) return false;
  return true;
}
function stateFeatureAt(lng: number, lat: number, fc: any): any {
  for (const f of fc.features || []) {
    const g = f.geometry;
    if (g.type === 'Polygon') { if (pointInPolygon(lng, lat, g.coordinates)) return f; }
    else if (g.type === 'MultiPolygon') { for (const poly of g.coordinates) if (pointInPolygon(lng, lat, poly)) return f; }
  }
  return null;
}

const CSS = `
  :root {
    --bg:#080e1a; --surface:#0f1826; --surface2:#162030;
    --border:rgba(255,255,255,0.07); --text:#f0f4ff; --muted:#6b7a99;
    --accent:#3b82f6; --green:#4ade80; --yellow:#facc15; --red:#f87171;
  }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { background:var(--bg); color:var(--text); font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; min-height:100vh; }
  .header { background:var(--surface); border-bottom:1px solid var(--border); padding:18px 20px 14px; text-align:center; }
  .header-logo { font-size:22px; margin-bottom:4px; }
  .header h1 { font-size:17px; font-weight:700; letter-spacing:-0.3px; }
  .header p { font-size:12px; color:var(--muted); margin-top:3px; }
  .tabs { display:flex; background:var(--surface); border-bottom:1px solid var(--border); padding:0 4px; }
  .tab { flex:1; padding:12px 6px 11px; text-align:center; font-size:13px; font-weight:500; color:var(--muted); cursor:pointer; border-bottom:2px solid transparent; transition:color 0.15s,border-color 0.15s; user-select:none; }
  .tab:hover { color:var(--text); }
  .tab.active { color:var(--text); border-bottom-color:var(--accent); }
  .content { max-width:560px; margin:0 auto; padding:16px 14px 40px; }
  .period-label { font-size:11px; font-weight:600; letter-spacing:0.08em; text-transform:uppercase; color:var(--muted); margin-bottom:10px; }
  .card { background:var(--surface); border:1px solid var(--border); border-radius:14px; overflow:hidden; }
  .entry-wrap { border-bottom:1px solid var(--border); }
  .entry-wrap:last-child { border-bottom:none; }
  .entry { display:flex; align-items:center; padding:14px 16px; gap:12px; transition:background 0.1s; cursor:default; }
  .entry.expandable { cursor:pointer; }
  .entry:hover { background:rgba(255,255,255,0.02); }
  .entry.expanded { background:rgba(255,255,255,0.03); }
  .rank { width:26px; text-align:center; font-size:15px; font-weight:700; color:var(--muted); flex-shrink:0; }
  .avatar { width:34px; height:34px; border-radius:50%; background:var(--surface2); border:1px solid var(--border); display:flex; align-items:center; justify-content:center; font-size:13px; font-weight:700; color:var(--muted); flex-shrink:0; }
  .info { flex:1; min-width:0; }
  .name { font-size:15px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .sub { font-size:11px; color:var(--muted); margin-top:2px; }
  .score-col { text-align:right; flex-shrink:0; }
  .score-main { font-size:19px; font-weight:700; font-variant-numeric:tabular-nums; letter-spacing:-0.5px; }
  .score-sub { font-size:11px; color:var(--muted); margin-top:1px; }
  .no-played { font-size:13px; color:var(--muted); }
  .chevron { width:16px; flex-shrink:0; color:var(--muted); transition:transform 0.2s; font-size:11px; text-align:center; }
  .expanded .chevron { transform:rotate(180deg); }
  .tier-perfect{color:#4ade80} .tier-great{color:#86efac} .tier-good{color:#facc15} .tier-ok{color:#fb923c} .tier-low{color:#f87171}
  .breakdown { overflow:hidden; max-height:0; transition:max-height 0.28s ease,padding 0.2s ease; background:rgba(0,0,0,0.2); border-top:1px solid var(--border); }
  .breakdown.open { max-height:600px; }
  .breakdown-inner { padding:14px 16px 16px 68px; }
  .dot-row { display:flex; gap:7px; margin-bottom:12px; }
  .dot { width:20px; height:20px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:8px; font-weight:700; }
  .dot-perfect{background:#4ade80} .dot-great{background:#86efac} .dot-good{background:#facc15} .dot-ok{background:#fb923c} .dot-low{background:#f87171} .dot-zero{background:#374151}
  .q-row { display:flex; gap:8px; margin-bottom:10px; }
  .q-row:last-child { margin-bottom:0; }
  .q-row.has-prompt { align-items:flex-start; } .q-row.no-prompt { align-items:center; }
  .q-label { font-size:11px; font-weight:600; color:var(--muted); width:22px; flex-shrink:0; }
  .q-row.has-prompt .q-label { padding-top:15px; }
  .q-middle { flex:1; min-width:0; }
  .q-prompt-text { font-size:10px; color:var(--muted); margin-bottom:4px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .q-bar-row { display:flex; align-items:center; gap:6px; }
  .q-bar-track { flex:1; height:10px; background:rgba(255,255,255,0.06); border-radius:5px; overflow:hidden; }
  .q-bar-fill { height:100%; border-radius:5px; transition:width 0.4s ease; }
  .bar-green{background:#4ade80} .bar-yellow{background:#facc15} .bar-red{background:#f87171}
  .q-pts-col { text-align:right; flex-shrink:0; width:36px; }
  .q-pts { font-size:12px; font-weight:700; font-variant-numeric:tabular-nums; }
  .q-group-avg { font-size:9px; color:var(--muted); margin-top:2px; }
  .day-row { display:flex; align-items:center; gap:10px; margin-bottom:8px; }
  .day-row:last-child { margin-bottom:0; }
  .day-date-lbl { font-size:11px; color:var(--muted); width:46px; flex-shrink:0; }
  .day-score-num { font-size:13px; font-weight:700; width:36px; text-align:right; flex-shrink:0; font-variant-numeric:tabular-nums; }
  .day-mini-dots { display:flex; gap:4px; align-items:center; }
  .mini-dot { width:9px; height:9px; border-radius:50%; flex-shrink:0; }
  .breakdown-section-label { font-size:10px; font-weight:600; letter-spacing:0.07em; text-transform:uppercase; color:var(--muted); margin-bottom:10px; }
  .stats-records { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:14px; }
  .record-card { background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:14px 14px 12px; }
  .record-emoji { font-size:18px; margin-bottom:6px; }
  .record-val { font-size:18px; font-weight:700; font-variant-numeric:tabular-nums; }
  .record-name { font-size:12px; margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .record-lbl { font-size:10px; color:var(--muted); text-transform:uppercase; letter-spacing:0.06em; margin-top:5px; }
  .record-card.wooden-spoon { background:linear-gradient(135deg, rgba(180,120,40,0.14), rgba(180,120,40,0.05)); border-color:rgba(180,120,40,0.45); }
  .record-card.wooden-spoon .record-lbl { color:#b47828; }
  .stats-section-lbl { font-size:11px; font-weight:600; letter-spacing:0.08em; text-transform:uppercase; color:var(--muted); margin-bottom:10px; }
  .stats-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:14px; }
  .sg-item { text-align:center; background:var(--surface2); border-radius:8px; padding:10px 6px; }
  .sg-val { font-size:15px; font-weight:700; font-variant-numeric:tabular-nums; }
  .sg-lbl { font-size:10px; color:var(--muted); margin-top:3px; text-transform:uppercase; letter-spacing:0.05em; }
  .h2h-section-title { font-size:10px; font-weight:600; letter-spacing:0.07em; text-transform:uppercase; color:var(--muted); margin-bottom:8px; }
  .h2h-row { display:flex; align-items:center; gap:8px; margin-bottom:6px; }
  .h2h-row:last-child { margin-bottom:0; }
  .h2h-name { flex:1; font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .h2h-record { font-size:11px; font-weight:700; font-variant-numeric:tabular-nums; white-space:nowrap; }
  .h2h-w{color:var(--green)} .h2h-l{color:var(--red)} .h2h-t{color:var(--muted)}
  .stats-strip { display:flex; gap:16px; background:var(--surface2); border:1px solid var(--border); border-radius:10px; padding:12px 16px; margin-bottom:14px; }
  .stat { flex:1; text-align:center; }
  .stat-val { font-size:20px; font-weight:700; }
  .stat-lbl { font-size:10px; color:var(--muted); text-transform:uppercase; letter-spacing:0.06em; margin-top:2px; }
  .footer { text-align:center; font-size:11px; color:var(--muted); padding:12px 0 0; }
  .sync-btn { background:none; border:1px solid var(--border); border-radius:6px; color:var(--muted); font-size:11px; padding:4px 10px; cursor:pointer; margin-left:8px; transition:border-color 0.15s,color 0.15s; }
  .sync-btn:hover { border-color:var(--accent); color:var(--accent); }
  .loading,.empty { text-align:center; padding:48px 20px; color:var(--muted); font-size:14px; }
  .error-box { background:rgba(239,68,68,0.08); border:1px solid rgba(239,68,68,0.2); border-radius:10px; padding:16px; margin:16px 0; font-size:13px; color:#fca5a5; }

  /* ── Period label row ── */
  .period-label-row { display:flex; align-items:center; justify-content:space-between; margin-bottom:10px; }
  .map-review-btn { background:rgba(59,130,246,0.12); border:1px solid rgba(59,130,246,0.3); border-radius:6px; color:#3b82f6; font-size:11px; font-weight:600; padding:4px 10px; cursor:pointer; transition:background 0.15s; }
  .map-review-btn:hover { background:rgba(59,130,246,0.22); }
  .user-map-btn { display:block; width:100%; margin-top:14px; background:rgba(59,130,246,0.12); border:1px solid rgba(59,130,246,0.3); border-radius:8px; color:#3b82f6; font-size:12px; font-weight:600; padding:9px 10px; cursor:pointer; transition:background 0.15s; }
  .user-map-btn:hover { background:rgba(59,130,246,0.22); }
  .map-info-dist { font-size:13px; font-weight:700; margin-bottom:8px; font-variant-numeric:tabular-nums; }
  .day-map-icon { background:none; border:none; font-size:13px; cursor:pointer; opacity:0.5; padding:0 0 0 6px; transition:opacity 0.15s; line-height:1; }
  .day-map-icon:hover { opacity:1; }

  /* ── Map modal ── */
  .map-modal { position:fixed; inset:0; z-index:1000; background:var(--bg); display:flex; flex-direction:column; }
  .map-modal-bar { display:flex; align-items:center; justify-content:space-between; padding:14px 16px 12px; background:var(--surface); border-bottom:1px solid var(--border); flex-shrink:0; }
  .map-modal-title { font-size:15px; font-weight:700; }
  .map-modal-close { background:none; border:none; color:var(--muted); font-size:20px; cursor:pointer; padding:0; line-height:1; transition:color 0.15s; }
  .map-modal-close:hover { color:var(--text); }
  .map-container { flex:1; min-height:0; }
  .map-info-panel { flex-shrink:0; background:var(--surface); border-top:1px solid var(--border); max-height:38vh; overflow-y:auto; }
  .map-info-inner { padding:14px 16px; }
  .map-info-loading { padding:20px 16px; text-align:center; color:var(--muted); font-size:13px; }
  .map-info-qnum { font-size:11px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; margin-bottom:4px; }
  .map-info-prompt { font-size:13px; color:var(--muted); line-height:1.5; margin-bottom:8px; }
  .map-info-answer { font-size:15px; font-weight:700; margin-bottom:6px; }
  .map-info-story { font-size:12px; color:var(--muted); line-height:1.6; margin-bottom:8px; }
  .map-info-score { font-size:12px; color:var(--muted); }
  .map-info-score span { font-weight:700; }

  /* Leaflet overrides for dark theme */
  .maplibregl-map { background:#000 !important; }
  .maplibregl-ctrl-attrib { background:rgba(0,0,0,0.5) !important; color:#6b7a99 !important; font-size:9px !important; }
  .maplibregl-ctrl-attrib a { color:#3b82f6 !important; }
  .maplibregl-ctrl-zoom-in, .maplibregl-ctrl-zoom-out, .maplibregl-ctrl-compass { background:var(--surface) !important; border-color:var(--border) !important; color:var(--text) !important; }

  /* ── Secret practice game ── */
  .header-logo { cursor:pointer; user-select:none; -webkit-tap-highlight-color:transparent; }
  .game-modal { position:fixed; inset:0; z-index:1100; background:var(--bg); display:flex; flex-direction:column; }
  .game-bar { display:flex; align-items:stretch; gap:10px; padding:10px 12px; background:var(--surface); border-bottom:1px solid var(--border); flex-shrink:0; }
  .game-score-box { border:1px solid var(--accent); border-radius:8px; padding:4px 10px; text-align:center; min-width:64px; align-self:center; flex-shrink:0; }
  .game-score-lbl { font-size:8px; letter-spacing:0.12em; color:var(--accent); font-weight:700; }
  .game-score-val { font-size:18px; font-weight:700; font-variant-numeric:tabular-nums; font-family:ui-monospace,Menlo,monospace; }
  .game-head { flex:1; min-width:0; display:flex; flex-direction:column; }
  .game-progress { background:#b9f0d6; color:#0a3a24; text-align:center; font-size:11px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; padding:5px 8px; border-radius:6px; min-height:23px; }
  .game-prompt { font-size:13px; line-height:1.45; color:var(--text); padding:8px 4px 2px; }
  .game-close { background:none; border:none; color:var(--muted); font-size:20px; cursor:pointer; line-height:1; align-self:center; padding:0 2px; transition:color 0.15s; flex-shrink:0; }
  .game-close:hover { color:var(--text); }
  .game-map-wrap { position:relative; flex:1; min-height:0; }
  .game-map-wrap .map-container { position:absolute; inset:0; }
  .game-toast { position:absolute; left:50%; top:54%; transform:translate(-50%,-50%); background:rgba(10,16,26,0.82); padding:8px 18px; border-radius:12px; font-size:16px; font-weight:700; white-space:nowrap; pointer-events:none; box-shadow:0 3px 14px rgba(0,0,0,0.55); z-index:5; }
  .game-panel { flex-shrink:0; background:var(--surface); border-top:1px solid var(--border); max-height:44vh; overflow-y:auto; }
  .game-results { position:absolute; inset:0; background:var(--bg); display:flex; align-items:center; justify-content:center; padding:20px; z-index:20; overflow-y:auto; }
  .game-results-card { width:100%; max-width:400px; background:var(--surface); border:1px solid var(--border); border-radius:16px; padding:26px 24px; text-align:center; box-shadow:0 10px 40px rgba(0,0,0,0.5); }
  .game-results-close { position:absolute; top:16px; right:18px; background:none; border:none; color:var(--muted); font-size:24px; line-height:1; cursor:pointer; padding:4px; transition:color 0.15s; }
  .game-results-close:hover { color:var(--text); }
  .game-hint, .game-revealing { padding:16px; text-align:center; color:var(--muted); font-size:13px; }
  .game-pin { width:15px; height:15px; border-radius:50%; background:#3b82f6; border:2px solid #fff; box-shadow:0 1px 5px rgba(0,0,0,0.6); }
  .game-pin.answer { width:18px; height:18px; background:#fff; border:3px solid #22c55e; }
  .game-result-line { display:flex; align-items:center; gap:8px; margin-bottom:10px; flex-wrap:wrap; }
  .game-dot { width:14px; height:14px; border-radius:50%; flex-shrink:0; }
  .game-result-pts { font-size:15px; font-weight:700; }
  .game-result-dist { font-size:12px; color:var(--muted); margin-left:auto; font-variant-numeric:tabular-nums; }
  .game-next-btn { display:block; width:100%; margin-top:14px; background:var(--accent); border:none; border-radius:10px; color:#fff; font-size:14px; font-weight:700; padding:12px; cursor:pointer; transition:opacity 0.15s; }
  .game-next-btn:hover { opacity:0.9; }
  .game-final { text-align:center; }
  .game-final-date { font-size:11px; letter-spacing:0.08em; text-transform:uppercase; color:var(--muted); margin-bottom:6px; }
  .game-final-score { font-size:34px; font-weight:800; font-variant-numeric:tabular-nums; }
  .game-final-score span { font-size:18px; color:var(--muted); font-weight:600; }
  .game-final-dots { display:flex; justify-content:center; gap:7px; margin:12px 0 16px; }
  .game-final-dots .d { width:18px; height:18px; border-radius:50%; }
  .game-bd-list { margin-bottom:6px; }
  .game-bd-row { display:flex; align-items:center; gap:10px; margin-bottom:8px; }
  .game-bd-label { width:26px; font-size:11px; font-weight:700; color:var(--muted); text-align:left; flex-shrink:0; }
  .game-bd-track { flex:1; height:18px; background:rgba(255,255,255,0.06); border-radius:5px; overflow:hidden; }
  .game-bd-fill { height:100%; border-radius:5px; transition:width 0.5s ease; }
  .game-bd-pts { width:42px; text-align:right; font-size:13px; font-weight:700; font-variant-numeric:tabular-nums; flex-shrink:0; }
  .game-final-lbl { font-size:13px; color:var(--muted); margin-top:6px; }
`;
