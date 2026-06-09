'use client';

import { useEffect, useRef } from 'react';

interface ScoreEntry {
  date: string;
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
          <div className="header-logo">ð</div>
          <h1 id="groupTitle">Loadingâ¦</h1>
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
          <div id="tabContent"><div className="loading">Loading scoresâ¦</div></div>
          <div className="footer" id="footer"></div>
        </div>
      </div>

      {/* Map review modal */}
      <div id="mapModal" className="map-modal" style={{display:'none'}}>
        <div className="map-modal-bar">
          <span id="mapModalTitle" className="map-modal-title"></span>
          <button className="map-modal-close" onClick={() => (window as any).closeMapReview()}>â</button>
        </div>
        <div id="mapContainer" className="map-container"></div>
        <div id="mapInfoPanel" className="map-info-panel"></div>
      </div>
    </>
  );
}

// âââ Dashboard logic ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

function initDashboard(groupCode: string, initialData?: InitialData) {
  const Q_MULTIPLIERS = [1, 1, 2, 3, 3];
  const Q_MAX_PTS     = [100, 100, 200, 300, 300];

  let allScores: {date:string;username:string;score:number;rawScores?:number[]}[] = [];
  let questionsCache: Record<string, string[]> = {};
  let currentTab = 'today';
  let lastFetched: Date | null = null;
  let openEntry: string | null = null;

  // ââ Data loading âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

  async function loadScores() {
    // If pre-loaded demo data was provided, use it directly â no fetch needed
    if (initialData) {
      allScores = initialData.scores || [];
      lastFetched = new Date();
      const title = document.getElementById('groupTitle');
      if (title) title.textContent = initialData.group_name || groupCode;
      renderTab(currentTab);
      renderFooter();
      return;
    }

    setContent('<div class="loading">Loading scoresâ¦</div>');
    try {
      const res = await fetch(`/api/scores/${groupCode}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load');
      allScores = data.scores || [];
      lastFetched = new Date();
      const title = document.getElementById('groupTitle');
      if (title) title.textContent = data.group_name || groupCode;
      if (!data.active) showInactiveBanner();
      renderTab(currentTab);
      renderFooter();
    } catch (e: any) {
      setContent(`<div class="error-box">Could not load scores.<br><small>${e.message}</small></div>`);
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
    const banner = document.createElement('div');
    banner.style.cssText = 'background:rgba(251,191,36,0.1);border:1px solid rgba(251,191,36,0.3);border-radius:8px;padding:10px 14px;font-size:12px;color:#fde68a;margin-bottom:12px;';
    banner.textContent = 'â ï¸ Sync paused â session token expired. Update your token to resume.';
    const content = document.getElementById('tabContent');
    if (content) content.prepend(banner);
  }

  // ââ Exposed globals âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

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
    if (btn) { btn.textContent = 'â» Syncingâ¦'; btn.disabled = true; }
    await loadScores();
    if (btn) { btn.textContent = 'â» Refresh'; btn.disabled = false; }
  };

  // ââ Date utils ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

  function toDateStr(d: Date) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  function getDateRange(tab: string) {
    const today = new Date();
    const todayStr = toDateStr(today);
    if (tab === 'today') return { start: todayStr, end: todayStr, label: todayStr };
    if (tab === 'week') {
      const d = new Date(today);
      const dow = d.getDay();
      d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow));
      const s = toDateStr(d);
      return { start: s, end: todayStr, label: `${s} â ${todayStr}` };
    }
    if (tab === 'month') {
      const s = toDateStr(new Date(today.getFullYear(), today.getMonth(), 1));
      return { start: s, end: todayStr, label: `${s} â ${todayStr}` };
    }
    const dates = allScores.map(s => s.date).sort();
    const s = dates[0] || '2020-01-01';
    return { start: s, end: todayStr, label: `${s} â ${todayStr}` };
  }
  function formatDisplayDate(dateStr: string) {
    const [, m, d] = dateStr.split('-').map(Number);
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${months[m-1]} ${d}`;
  }

  // ââ Tier helpers ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

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

  // ââ Breakdown builders ââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

  function buildTodayBreakdown(rawScores: number[], date: string, groupAvgs: number[] | null) {
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
          ${prompt ? `<div class="q-prompt-text">${prompt}</div>` : ''}
          <div class="q-bar-row"><div class="q-bar-track"><div class="q-bar-fill ${barClass(r)}" style="width:${pct}%"></div></div></div>
        </div>
        <div class="q-pts-col">
          <div class="q-pts ${tierClass(r)}">${pts}</div>
          ${grpPts !== null ? `<div class="q-group-avg">grp ${grpPts}</div>` : ''}
        </div>
      </div>`;
    }).join('');
    return `<div class="breakdown-inner"><div class="dot-row">${dots}</div>${bars}</div>`;
  }

  function buildDayList(days: {date:string;score:number;rawScores?:number[]|null}[]) {
    const rows = [...days].reverse().map(d => {
      const tc = totalTierClass(d.score, 1000);
      const dots = (d.rawScores || []).map(r => `<div class="mini-dot ${dotClass(r)}"></div>`).join('');
      const mapIcon = !initialData
        ? `<button class="day-map-icon" onclick="event.stopPropagation();openMapReview('${d.date}')" title="View on map">ð</button>`
        : '';
      return `<div class="day-row">
        <div class="day-date-lbl">${formatDisplayDate(d.date)}</div>
        <div class="day-score-num ${tc}">${d.score}</div>
        ${dots ? `<div class="day-mini-dots">${dots}</div>` : ''}
        ${mapIcon}
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

  // ââ Stats âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

  function getWeekKey(dateStr: string) {
    const d = new Date(dateStr + 'T00:00:00');
    const dow = d.getDay();
    const mon = new Date(d);
    mon.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow));
    return toDateStr(mon);
  }

  function computeAllStats() {
    const allUsers = [...new Set(allScores.map(s => s.username))];
    type Stat = { username:string;daysPlayed:number;daysWon:number;weeksWon:number;monthsWon:number;totalScore:number;bestScore:number;avg:number;currentStreak:number;bestStreak:number;h2h:Record<string,{w:number;l:number;t:number}> };
    const stats: Record<string, Stat> = {};
    allUsers.forEach(u => {
      stats[u] = { username:u,daysPlayed:0,daysWon:0,weeksWon:0,monthsWon:0,totalScore:0,bestScore:0,avg:0,currentStreak:0,bestStreak:0,h2h:{} };
      allUsers.forEach(v => { if (v !== u) stats[u].h2h[v] = {w:0,l:0,t:0}; });
    });
    const byDate: Record<string, typeof allScores> = {};
    allScores.forEach(s => { if (!byDate[s.date]) byDate[s.date]=[]; byDate[s.date].push(s); });
    Object.values(byDate).forEach(players => {
      const top = Math.max(...players.map(p => p.score));
      players.forEach(p => {
        if (!stats[p.username]) return;
        const u = stats[p.username];
        u.daysPlayed++; u.totalScore += p.score;
        if (p.score > u.bestScore) u.bestScore = p.score;
        if (p.score >= top) u.daysWon++;
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
      const today = toDateStr(new Date());
      const yestD = new Date(); yestD.setDate(yestD.getDate()-1);
      const yest = toDateStr(yestD);
      const last = dates[dates.length-1];
      let curr = 0;
      if (last===today||last===yest) { curr=1; for(let i=dates.length-2;i>=0;i--){if(daysBetween(dates[i],dates[i+1])===1)curr++;else break;} }
      stats[u].currentStreak = curr;
    });
    const byWeek: Record<string,Record<string,number>> = {};
    allScores.forEach(s => { const wk=getWeekKey(s.date); if(!byWeek[wk])byWeek[wk]={}; byWeek[wk][s.username]=(byWeek[wk][s.username]||0)+s.score; });
    Object.values(byWeek).forEach(wk => { const top=Math.max(...Object.values(wk)); Object.entries(wk).forEach(([u,sc])=>{if(sc>=top&&stats[u])stats[u].weeksWon++;}); });
    const byMonth: Record<string,Record<string,number>> = {};
    allScores.forEach(s => { const mk=s.date.slice(0,7); if(!byMonth[mk])byMonth[mk]={}; byMonth[mk][s.username]=(byMonth[mk][s.username]||0)+s.score; });
    Object.values(byMonth).forEach(mk => { const top=Math.max(...Object.values(mk)); Object.entries(mk).forEach(([u,sc])=>{if(sc>=top&&stats[u])stats[u].monthsWon++;}); });
    allUsers.forEach(u => { stats[u].avg = stats[u].daysPlayed>0?Math.round(stats[u].totalScore/stats[u].daysPlayed):0; });
    return stats;
  }

  // ââ Renderers âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

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
    const mapBtn = !initialData
      ? `<button class="map-review-btn" onclick="openMapReview('${start}')">ðº Map</button>`
      : '';
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
        if (e.played) { playedRank++; rankStr = playedRank===1?'ð¥':playedRank===2?'ð¥':playedRank===3?'ð¥':`${playedRank}`; }
        else rankStr = 'â';
        const initials = e.username.split(/\s+/).map((w:string)=>w[0]).join('').slice(0,2).toUpperCase();
        const tClass = e.total!==null?totalTierClass(isToday?e.total:e.avg??0,1000):'';
        let breakdownContent = '';
        if (e.played) {
          if (isToday) { const raw=e.days[0]?.rawScores; if(raw&&raw.length===5)breakdownContent=buildTodayBreakdown(raw,start,groupAvgs); }
          else if (tab==='week') { if(e.days.length>0)breakdownContent=buildDayList(e.days); }
          else { const qAvgs=computeQAvgs(e.days); if(qAvgs){const n=e.days.filter(d=>d.rawScores&&d.rawScores.length===5).length;breakdownContent=buildQAvgBreakdown(qAvgs,n);} }
        }
        const hasBreak = breakdownContent.length>0;
        const username = e.username.replace(/'/g,"\\'");
        let scoreHtml: string;
        if (e.played) {
          if (isToday) scoreHtml=`<div class="score-col"><div class="score-main ${tClass}">${e.total}</div><div class="score-sub">/ 1,000</div></div>`;
          else scoreHtml=`<div class="score-col"><div class="score-main ${tClass}">${(e.total??0).toLocaleString()}</div><div class="score-sub">${e.count} day${e.count!==1?'s':''} Â· avg ${e.avg}</div></div>`;
        } else {
          scoreHtml=`<div class="score-col no-played">Not played</div>`;
        }
        const isExpanded = openEntry===e.username;
        html += `<div class="entry-wrap" data-username="${e.username}">
          <div class="entry${hasBreak?' expandable':''}${isExpanded?' expanded':''}" ${hasBreak?`onclick="toggleBreakdown('${username}')"`:''}>
            <div class="rank">${rankStr}</div>
            <div class="avatar">${initials}</div>
            <div class="info"><div class="name">${e.username}</div>${!isToday&&e.played?`<div class="sub">Best: ${e.best}</div>`:''}</div>
            ${scoreHtml}
            ${hasBreak?'<div class="chevron">â¾</div>':''}
          </div>
          ${hasBreak?`<div class="breakdown${isExpanded?' open':''}">${breakdownContent}</div>`:''}
        </div>`;
      });
    }
    html += '</div>';
    setContent(html);
    if (openEntry) {
      const wrap = document.querySelector(`.entry-wrap[data-username="${openEntry}"]`);
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
      {emoji:'ð',val:mostWon?.daysWon??0,name:mostWon?.username??'â',lbl:'Most Days Won'},
      {emoji:'ð¯',val:bestScr?.bestScore??0,name:bestScr?.username??'â',lbl:'Best Score'},
      {emoji:'ð',val:bestAvg?.avg??0,name:bestAvg?.username??'â',lbl:'Best Average'},
      {emoji:'ð¥',val:bestStrk?.bestStreak??0,name:bestStrk?.username??'â',lbl:'Longest Streak'},
    ];
    const recordsHtml = records.map(r=>`<div class="record-card"><div class="record-emoji">${r.emoji}</div><div class="record-val">${r.val}</div><div class="record-name">${r.name}</div><div class="record-lbl">${r.lbl}</div></div>`).join('');
    const sorted = [...users].sort((a,b)=>b.daysWon-a.daysWon||b.avg-a.avg);
    let html = `<div class="period-label">ALL TIME</div><div class="stats-records">${recordsHtml}</div><div class="stats-section-lbl">Player Stats</div><div class="card">`;
    sorted.forEach(u => {
      const initials = u.username.split(/\s+/).map((w:string)=>w[0]).join('').slice(0,2).toUpperCase();
      const h2hEntries = Object.entries(u.h2h).filter(([,r])=>r.w+r.l+r.t>0);
      const h2hHtml = h2hEntries.length?`<div class="h2h-section-title">Head-to-Head</div>${h2hEntries.sort((a,b)=>b[1].w-a[1].w).map(([opp,r])=>`<div class="h2h-row"><div class="h2h-name">${opp}</div><div class="h2h-record"><span class="h2h-w">${r.w}W</span><span class="h2h-t" style="margin:0 3px">Â·</span><span class="h2h-l">${r.l}L</span>${r.t>0?`<span class="h2h-t" style="margin:0 3px">Â·</span><span class="h2h-t">${r.t}T</span>`:''}</div></div>`).join('')}`:'';
      const key = `stats-${u.username}`;
      const isExpanded = openEntry===key;
      const panelHtml = `<div class="breakdown-inner"><div class="stats-grid">
        <div class="sg-item"><div class="sg-val">${u.daysWon}</div><div class="sg-lbl">Days Won</div></div>
        <div class="sg-item"><div class="sg-val">${u.daysPlayed}</div><div class="sg-lbl">Played</div></div>
        <div class="sg-item"><div class="sg-val">${u.avg}</div><div class="sg-lbl">Avg Score</div></div>
        <div class="sg-item"><div class="sg-val">${u.bestScore}</div><div class="sg-lbl">Best Score</div></div>
        <div class="sg-item"><div class="sg-val">ð¥ ${u.currentStreak}</div><div class="sg-lbl">Cur Streak</div></div>
        <div class="sg-item"><div class="sg-val">${u.bestStreak}</div><div class="sg-lbl">Best Streak</div></div>
        <div class="sg-item"><div class="sg-val">${u.weeksWon}</div><div class="sg-lbl">Weeks Won</div></div>
        <div class="sg-item"><div class="sg-val">${u.monthsWon}</div><div class="sg-lbl">Months Won</div></div>
      </div>${h2hHtml}</div>`;
      const uKey = key.replace(/'/g,"\\'");
      html += `<div class="entry-wrap" data-username="${key}">
        <div class="entry expandable${isExpanded?' expanded':''}" onclick="toggleBreakdown('${uKey}')">
          <div class="avatar">${initials}</div>
          <div class="info"><div class="name">${u.username}</div><div class="sub">${u.daysWon} day${u.daysWon!==1?'s':''} won Â· ${u.daysPlayed} played</div></div>
          <div class="score-col"><div class="score-main">${u.avg}</div><div class="score-sub">avg</div></div>
          <div class="chevron">â¾</div>
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
      el.innerHTML = `<span style="color:#3b82f6;font-weight:600;">Demo Mode</span> Â· <a href="/" style="color:var(--muted);text-decoration:none;">Set up your group â</a>`;
    } else {
      const t = lastFetched?.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) || '';
      el.innerHTML = `Updated ${t} Â· <button class="sync-btn" onclick="refreshNow()">â» Refresh</button>`;
    }
  }

  // ââ Map review ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

  let maplibreLoaded = false;
  let mapInstance: any = null;

  async function loadMapLibre(): Promise<void> {
    if (maplibreLoaded) return;
    return new Promise((resolve) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css';
      document.head.appendChild(link);
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js';
      script.onload = () => { maplibreLoaded = true; resolve(); };
      document.head.appendChild(script);
    });
  }

  const PIN_COLORS = ['#3b82f6','#8b5cf6','#ec4899','#f59e0b','#10b981'];

  function showMapInfoPanel(guess: any, prompt: string, index: number) {
    const panel = document.getElementById('mapInfoPanel');
    if (!panel) return;
    const color = PIN_COLORS[index];
    panel.innerHTML = `
      <div class="map-info-inner">
        <div class="map-info-qnum" style="color:${color}">Q${index + 1}</div>
        <div class="map-info-prompt">${prompt || ''}</div>
        <div class="map-info-answer">ð ${guess.answer.name}</div>
        ${guess.answer.story ? `<div class="map-info-story">${guess.answer.story}</div>` : ''}
      </div>`;
  }

  (window as any).openMapReview = async function(date: string) {
    if (initialData) return; // demo mode â no real results
    const modal = document.getElementById('mapModal');
    const title = document.getElementById('mapModalTitle');
    const container = document.getElementById('mapContainer');
    const panel = document.getElementById('mapInfoPanel');
    if (!modal || !container || !panel) return;

    if (title) title.textContent = `${formatDisplayDate(date)} answers`;
    panel.innerHTML = '<div class="map-info-loading">Loadingâ¦</div>';
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    // Fetch results
    let data: any;
    try {
      const res = await fetch(`/api/results/${groupCode}?date=${date}`);
      if (res.status === 404) {
        panel.innerHTML = '<div class="map-info-loading">No results found for this date.<br><small>The account owner may not have played that day.</small></div>';
        return;
      }
      if (!res.ok) throw new Error('fetch failed');
      data = await res.json();
    } catch {
      panel.innerHTML = '<div class="map-info-loading">Could not load results.</div>';
      return;
    }

    const guesses: any[] = data.guesses || [];
    if (!guesses.length) {
      panel.innerHTML = '<div class="map-info-loading">No answer data for this date.</div>';
      return;
    }

    await loadMapLibre();
    const maplibregl = (window as any).maplibregl;

    // Destroy previous map if any
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

    map.on('load', () => {
      map.setProjection('globe');
      map.setFog({
        'space-color': '#000000',
        'star-intensity': 0.0,
        'color': 'rgba(255, 255, 255, 0.08)',
        'high-color': 'rgba(200, 220, 255, 0.2)',
        'horizon-blend': 0.05,
      });
      const bounds: [[number,number],[number,number]] = [[180,90],[-180,-90]];

      guesses.forEach((g: any, i: number) => {
        const color = PIN_COLORS[i];
        const el = document.createElement('div');
        el.style.cssText = `width:28px;height:28px;border-radius:50%;background:${color};border:2px solid #fff;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#fff;box-shadow:0 2px 6px rgba(0,0,0,0.5);cursor:pointer`;
        el.textContent = String(i + 1);
        el.addEventListener('click', () => showMapInfoPanel(g, prompts[i] || '', i));

        new maplibregl.Marker({ element: el })
          .setLngLat([g.answer.lng, g.answer.lat])
          .addTo(map);

        if (g.answer.lng < bounds[0][0]) bounds[0][0] = g.answer.lng;
        if (g.answer.lat < bounds[0][1]) bounds[0][1] = g.answer.lat;
        if (g.answer.lng > bounds[1][0]) bounds[1][0] = g.answer.lng;
        if (g.answer.lat > bounds[1][1]) bounds[1][1] = g.answer.lat;
      });

      if (guesses.length === 1) {
        map.flyTo({ center: [guesses[0].answer.lng, guesses[0].answer.lat], zoom: 4 });
      } else {
        map.fitBounds(bounds, { padding: 60, maxZoom: 5, duration: 1200 });
      }

      showMapInfoPanel(guesses[0], prompts[0] || '', 0);
    });
  };

  (window as any).closeMapReview = function() {
    const modal = document.getElementById('mapModal');
    if (modal) modal.style.display = 'none';
    document.body.style.overflow = '';
    if (mapInstance) { mapInstance.remove(); mapInstance = null; }
  };

  // ââ Boot ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

  Promise.all([loadScores(), loadQuestions()]);
}

// âââ CSS ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

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

  /* ââ Period label row ââ */
  .period-label-row { display:flex; align-items:center; justify-content:space-between; margin-bottom:10px; }
  .map-review-btn { background:rgba(59,130,246,0.12); border:1px solid rgba(59,130,246,0.3); border-radius:6px; color:#3b82f6; font-size:11px; font-weight:600; padding:4px 10px; cursor:pointer; transition:background 0.15s; }
  .map-review-btn:hover { background:rgba(59,130,246,0.22); }
  .day-map-icon { background:none; border:none; font-size:13px; cursor:pointer; opacity:0.5; padding:0 0 0 6px; transition:opacity 0.15s; line-height:1; }
  .day-map-icon:hover { opacity:1; }

  /* ââ Map modal ââ */
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
`;
