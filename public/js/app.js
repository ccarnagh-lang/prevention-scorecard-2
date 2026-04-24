// Program Director view removed — supervisors handle case entries directly

const SupViews = {

  // Build comma-separated program IDs into proper query params
  _programParams(user) {
    if (!user?.program_id) return '';
    const pids = user.program_id.split(',').map(p => p.trim()).filter(Boolean);
    if (!pids.length) return '';
    // Pass multiple program_id params for the server's ANY() query
    return pids.map(p => `program_id=${encodeURIComponent(p)}`).join('&');
  },

  async dashboard(data) {
    const u   = Auth.user;
    const isDir = u.role === 'program_director';
    const progParams = SupViews._programParams(u);
    const url = `/api/dashboard${progParams ? '?' + progParams : ''}`;
    const d   = data || await API.get(url) || {};
    const s   = d.scores || {};

    const weekLabel = new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
    UI.setTopbar(`
      <span class="wpill">Week ending ${weekLabel}</span>
      <button class="btn btn-p btn-sm" onclick="App.nav('entry')">+ New entry</button>`);

    const metrics = isDir
      ? [['Program score', s.weekly!=null?Math.round(s.weekly)+'%':'—'],
         ['Active cases',  d.totalCases||0],
         ['Active children', d.totalChildren||0],
         ['Safety flags',  d.safetyFlags||0],
         ['FASP overdue',  d.faspOver||0]]
      : [['Program score', s.weekly!=null?Math.round(s.weekly)+'%':'—'],
         ['Cases on roster', d.totalCases||0],
         ['Safety flags',   d.safetyFlags||0],
         ['FASP overdue',   d.faspOver||0]];

    UI.setContent(`
      <div style="background:#1B3A5C;border-radius:10px;padding:14px 18px;margin-bottom:18px;display:grid;grid-template-columns:repeat(${metrics.length},minmax(0,1fr));gap:8px">
        ${metrics.map(([l,v],i)=>`
          <div style="text-align:center">
            <div style="font-size:10px;color:rgba(255,255,255,.45);font-weight:600;margin-bottom:4px">${l}</div>
            <div style="font-size:22px;font-weight:700;color:${(l.includes('flag')||l.includes('Flag'))&&v>0?'#F09595':(l.includes('FASP'))&&v>0?'#FAC775':'#fff'}">${v}</div>
          </div>`).join('')}
      </div>

      ${isDir ? `
      <div class="section-head">Children not seen this month</div>
      <div id="dir-not-seen" style="margin-bottom:18px"><div class="loading" style="padding:10px">Loading...</div></div>
      ` : ''}

      <div class="section-head">${isDir ? 'All program cases' : 'My cases'}</div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr>
            <th>Case ID</th><th>Case Name</th><th>Case Planner</th>
            <th>Weekly</th><th>Monthly</th><th>Quarterly</th>
            <th>Safety</th><th>FASP</th><th></th>
          </tr></thead>
          <tbody>${(d.caseScores||[]).length ? (d.caseScores||[]).map(e=>`<tr>
            <td class="mono bold" style="color:#1B3A5C;cursor:pointer" onclick="SharedViews.openCaseReview('${e.case_id}')">${e.case_id}</td>
            <td style="font-size:12px">${e.case_name||'—'}</td>
            <td style="font-size:12px">${e.case_planner||'—'}</td>
            <td>${UI.badge(e.weekly_score)}</td>
            <td>${UI.badge(e.monthly_score)}</td>
            <td>${UI.badge(e.quarterly_score)}</td>
            <td>${e.safety_flag==='Yes'?`<span class="badge badge-red" style="cursor:pointer" onclick="SharedViews.showSafetyFlagDetail('${e.case_id}')">⚠ Flag</span>`:'<span class="badge badge-gray">—</span>'}</td>
            <td>${UI.faspBadge(e.fasp_status)}</td>
            <td><button class="btn btn-xs" onclick="sessionStorage.setItem('sn_case','${e.case_id}');App.nav('supnote')">Note</button></td>
          </tr>`).join('') : '<tr><td colspan="9" class="empty-state">No cases yet — upload a roster CSV or add cases manually.</td></tr>'}
          </tbody>
        </table>
      </div>

      ${isDir && (d.byPlanner||[]).length ? `
      <div class="section-head" style="margin-top:18px">Staff compliance</div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Case Planner</th><th>Entries</th><th>Weekly avg</th><th>Monthly avg</th><th>Quarterly avg</th></tr></thead>
          <tbody>${(d.byPlanner||[]).map(p=>`<tr>
            <td style="font-weight:600">${p.case_planner||'—'}</td>
            <td style="text-align:center">${p.entries||0}</td>
            <td>${UI.badge(p.ws)}</td>
            <td>${UI.badge(p.ms)}</td>
            <td>${UI.badge(p.qs)}</td>
          </tr>`).join('')}
          </tbody>
        </table>
      </div>` : ''}

      ${!isDir && (d.trend||[]).length ? `
      <div class="section-head" style="margin-top:18px">Score trend</div>
      <div class="card"><div style="position:relative;height:180px"><canvas id="c-sup-trend">Trend data.</canvas></div></div>
      ` : ''}
    `);

    if (!isDir && (d.trend||[]).length) {
      UI.trendChart('c-sup-trend', d.trend, '#0F6E56');
    }

    // Director: load children not seen this month
    if (isDir) {
      const now = new Date();
      const nsUrl = `/api/children-not-seen-month?month=${now.getMonth()+1}&year=${now.getFullYear()}${progParams?'&'+progParams:''}`;
      const notSeen = await API.get(nsUrl) || [];
      const el = document.getElementById('dir-not-seen');
      if (el) {
        el.innerHTML = notSeen.length
          ? `<div class="table-wrap"><table class="data-table">
              <thead><tr><th>Child Name</th><th>CIN</th><th>Case ID</th><th>Case Name</th><th>Planner</th><th>Program</th></tr></thead>
              <tbody>${notSeen.map(c=>`<tr>
                <td style="font-weight:600;color:#A32D2D">${c.child_name||'—'}</td>
                <td class="mono" style="font-size:11px">${c.cin||'—'}</td>
                <td class="mono" style="color:#1B3A5C;font-weight:600">${c.case_id}</td>
                <td style="font-size:12px">${c.case_name||'—'}</td>
                <td style="font-size:12px">${c.planner_name||'—'}</td>
                <td style="font-size:11px;color:#888">${c.program_id||'—'}</td>
              </tr>`).join('')}</tbody>
             </table></div>`
          : '<div class="empty-state" style="color:#0F6E56;padding:10px">✓ All children seen this month</div>';
      }
    }
  },
  async renderWeekly(programId) {
    UI.setTitle('This Week');
    const [entries,roster] = await Promise.all([API.get(`/api/entries${programId?'?program_id='+programId:''}&limit=100`)||[],API.get(`/api/roster${programId?'?program_id='+programId:''}`)||[]]);
    const submitted=(entries||[]).map(e=>e.case_id);
    const missing=(roster||[]).filter(r=>!submitted.includes(r.case_id));
    UI.setTopbar(`<span class="wpill">Week of ${new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</span>`);
    UI.setContent(`
      <div class="metric-grid-3">
        <div class="mc"><div class="mc-label">Submitted this week</div><div class="mc-value" style="color:#0F6E56">${submitted.length}</div><div class="mc-sub">of ${(roster||[]).length} cases</div></div>
        <div class="mc"><div class="mc-label">Not yet submitted</div><div class="mc-value" style="color:#A32D2D">${missing.length}</div><div class="mc-sub">Follow up required</div></div>
        <div class="mc"><div class="mc-label">Week avg score</div><div class="mc-value">${(entries||[]).length?Math.round((entries||[]).reduce((a,e)=>a+(e.weekly_score||0),0)/(entries||[]).length)+'%':'—'}</div><div class="mc-sub">All submitted</div></div>
      </div>
      <div class="section-head">Submission status</div>
      <div class="card" style="margin-bottom:16px">
        ${[...(entries||[]).map(e=>`<div class="week-row"><div style="display:flex;align-items:center;gap:10px"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#1D9E75" stroke-width="2.5"><polyline points="3,8 7,12 13,4"/></svg><span class="mono bold" style="color:#1B3A5C">${e.case_id}</span><span style="color:#aaa;font-size:12px">${e.case_planner||'—'}</span></div><div style="display:flex;align-items:center;gap:8px">${UI.badge(e.weekly_score)}<span class="badge badge-green">Submitted</span></div></div>`),
          ...(missing||[]).map(r=>`<div class="week-row"><div style="display:flex;align-items:center;gap:10px"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#E24B4A" stroke-width="2.5"><circle cx="8" cy="8" r="6"/><line x1="5" y1="5" x2="11" y2="11"/><line x1="11" y1="5" x2="5" y2="11"/></svg><span class="mono bold" style="color:#1B3A5C">${r.case_id}</span><span style="color:#aaa;font-size:12px">${r.planner_name||'—'}</span></div><div style="display:flex;align-items:center;gap:8px"><span class="badge badge-red">Not submitted</span><button class="btn btn-xs" onclick="App.nav('entry')">Enter now</button></div></div>`)
        ].join('') || '<div class="empty-state">No cases on roster yet.</div>'}
      </div>`);
  },
};

/* ── MAIN APP ROUTER ─────────────────────────────────────────── */
const App = {
  async showApp() {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app-screen').classList.remove('hidden');
    const u = Auth.user;
    const roleColors  = { executive:'#534AB7', program_director:'#0F6E56', supervisor:'#993C1D', staff:'#1B3A5C', admin:'#534AB7', office_manager:'#2C6E8A' };
    const chipClasses = { executive:'chip-exec', program_director:'chip-dir', supervisor:'chip-sup', staff:'chip-staff', admin:'chip-exec', office_manager:'chip-dir' };
    const chipLabels  = { executive:'Executive Access', program_director:'Program Director', supervisor:'Supervisor', staff:'Staff', admin:'System Admin', office_manager:'Office Manager' };
    document.getElementById('sb-org').textContent     = (u.role==='executive'||u.role==='admin')?'All Programs':(u.program_id||'My Program');
    document.getElementById('sb-av').style.background = roleColors[u.role]||'#1B3A5C';
    document.getElementById('sb-av').textContent      = u.initials||UI.initials(u.name);
    document.getElementById('sb-uname').textContent   = u.name;
    document.getElementById('sb-urole').textContent   = u.role?.replace(/_/g,' ');
    document.getElementById('role-chip').className    = 'role-chip '+(chipClasses[u.role]||'chip-staff');
    document.getElementById('role-chip').textContent  = chipLabels[u.role]||u.role;
    this.buildNav();
    await this.nav('dash');
  },

  buildNav() {
    const u = Auth.user;
    const ico = {
      dash:    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="1" width="6" height="6" rx="1"/><rect x="9" y="1" width="6" height="6" rx="1"/><rect x="1" y="9" width="6" height="6" rx="1"/><rect x="9" y="9" width="6" height="6" rx="1"/></svg>',
      progs:   '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="2,8 8,4 14,8"/><polyline points="2,12 8,8 14,12"/></svg>',
      cases:   '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="12" height="10" rx="1"/><line x1="2" y1="6" x2="14" y2="6"/><line x1="5" y1="6" x2="5" y2="13"/></svg>',
      entry:   '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="12" height="12" rx="1.5"/><line x1="5" y1="6" x2="11" y2="6"/><line x1="5" y1="9" x2="9" y2="9"/></svg>',
      weekly:  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="12" height="11" rx="1"/><line x1="2" y1="7" x2="14" y2="7"/><line x1="5" y1="1" x2="5" y2="4"/><line x1="11" y1="1" x2="11" y2="4"/></svg>',
      suplog:  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 2h10a1 1 0 011 1v8a1 1 0 01-1 1H6l-3 2V3a1 1 0 011-1z"/></svg>',
      supnote: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="1" width="10" height="14" rx="1.5"/><line x1="6" y1="5" x2="10" y2="5"/><line x1="6" y1="8" x2="10" y2="8"/><line x1="6" y1="11" x2="8" y2="11"/></svg>',
      alerts:  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 2L14 13H2L8 2z"/><line x1="8" y1="7" x2="8" y2="10"/><circle cx="8" cy="12" r=".5" fill="currentColor"/></svg>',
      roster:  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="6" cy="5" r="2.5"/><path d="M1 13c0-2.76 2.24-5 5-5"/><line x1="12" y1="8" x2="12" y2="14"/><line x1="9" y1="11" x2="15" y2="11"/></svg>',
      export:  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="8" y1="2" x2="8" y2="11"/><polyline points="4,7 8,11 12,7"/><line x1="2" y1="14" x2="14" y2="14"/></svg>',
      admin:   '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="5" r="3"/><path d="M2 14c0-3.31 2.69-6 6-6s6 2.69 6 6"/></svg>',
    };
    const item = (id,label,badge) => `<a class="sb-item" data-nav="${id}" onclick="App.nav('${id}',this)">${ico[id]||''}${label}${badge?`<span class="sb-badge">${badge}</span>`:''}</a>`;
    const sec  = t => `<div class="sb-sec">${t}</div>`;
    const navs = {
      executive: `${sec('Overview')}${item('dash','Executive Dashboard')}${item('cases','All Cases')}${sec('Reports')}${item('alerts','System Alerts')}${item('supcomp','Supervision Compliance')}${item('export','Export Reports')}`,
      admin:     `${sec('Overview')}${item('dash','Executive Dashboard')}${item('cases','All Cases')}${sec('Reports')}${item('alerts','System Alerts')}${item('supcomp','Supervision Compliance')}${item('export','Export Reports')}${sec('System')}${item('admin','Admin Panel')}`,
      program_director: `${sec('My Program')}${item('dash','Case Dashboard')}${item('cases','Case List')}${item('entry','New Entry')}${sec('Supervision')}${item('suplog','Weekly Supervision Log')}${item('supnote','Monthly Supervisory Note')}${item('supcomp','Supervision Compliance')}${sec('Data')}${item('roster','Case Roster')}`,
      supervisor: `${sec('My Cases')}${item('dash','Case Dashboard')}${item('cases','All My Cases')}${item('entry','New Entry')}${sec('Supervision')}${item('suplog','Weekly Supervision Log')}${item('supnote','Monthly Supervisory Note')}${sec('Data')}${item('roster','Case Roster')}`,
      staff:          `${sec('My Work')}${item('dash','My Dashboard')}${item('mylog','My Supervision Log')}`,
      office_manager: `${sec('Roster')}${item('roster','Case Roster')}`,
    };
    document.getElementById('sb-nav').innerHTML = navs[u.role] || navs.staff;
  },
  async nav(viewId, el) {
    document.querySelectorAll('.sb-item').forEach(i => i.classList.remove('active'));
    (el || document.querySelector(`[data-nav="${viewId}"]`))?.classList.add('active');
    const titles = {
      dash:'Dashboard', cases:'Case List', entry:'New Entry', weekly:'This Week',
      suplog:'Weekly Supervision Log', supnote:'Monthly Supervisory Note',
      mylog:'My Supervision Log', alerts:'Alerts', roster:'Case Roster',
      export:'Export Reports', admin:'Admin Panel', supcomp:'Supervision Compliance',
    };
    document.getElementById('tb-title').textContent = titles[viewId] || viewId;
    document.getElementById('main-content').innerHTML = '<div class="loading">Loading...</div>';
    const u = Auth.user;
    // For multi-program users, use first program as single-program fallback
    const rawPid  = (u.role==='executive'||u.role==='admin') ? null : u.program_id;
    const firstPid = rawPid ? rawPid.split(',')[0].trim() : null;
    try {
      switch(viewId) {
        case 'dash':
          if(u.role==='executive'||u.role==='admin') await ExecViews.dashboard();
          else if(u.role==='program_director') await SupViews.dashboard();
          else if(u.role==='staff') await SharedViews.renderStaffDash();
          else if(u.role==='office_manager') await SharedViews.renderOfficeRoster(firstPid);
          else await SupViews.dashboard();
          break;
        case 'cases':   await SharedViews.renderCases(firstPid); break;
        case 'mylog':   await SharedViews.renderMyLog(); break;
        case 'entry':   await SharedViews.renderEntry(); break;
        case 'weekly':  await SupViews.renderWeekly(firstPid); break;
        case 'suplog':  await SharedViews.renderSuplog(firstPid); break;
        case 'supnote': await SharedViews.renderSupnote(firstPid); break;
        case 'alerts':  await SharedViews.renderAlerts(firstPid); break;
        case 'supcomp': await SharedViews.renderSupComp(firstPid); break;
        case 'roster':
          if(u.role==='office_manager') await SharedViews.renderOfficeRoster(firstPid);
          else await SharedViews.renderRoster(firstPid);
          break;
        case 'admin':   await AdminViews.render(); break;
        case 'export':
          const from = ExecViews._dateFrom || '';
          const to   = ExecViews._dateTo   || '';
          UI.setTopbar(`
            <div style="display:flex;align-items:center;gap:3px">
              <button class="btn btn-xs" onclick="ExecViews.setPreset('week');App.nav('export')">Week</button>
              <button class="btn btn-xs" onclick="ExecViews.setPreset('month');App.nav('export')">Month</button>
              <button class="btn btn-xs" onclick="ExecViews.setPreset('quarter');App.nav('export')">Quarter</button>
              <button class="btn btn-xs" onclick="ExecViews.setPreset('year');App.nav('export')">Year</button>
              <button class="btn btn-xs" onclick="ExecViews.setPreset('all');App.nav('export')">All time</button>
            </div>
            <input type="date" id="exp-from" value="${from}" style="font-size:12px;padding:5px 9px;border:1px solid var(--mgray);border-radius:6px">
            <span style="color:#aaa;font-size:12px">to</span>
            <input type="date" id="exp-to" value="${to}" style="font-size:12px;padding:5px 9px;border:1px solid var(--mgray);border-radius:6px">`);
          UI.setContent(`
            <div class="chart-grid">
              <div class="form-card">
                <div class="fc-title">Full data export</div>
                <div style="font-size:12px;color:#555;margin-bottom:12px">Every entry with all requirement responses. Use for ACS audits and compliance reviews.</div>
                <button class="btn btn-navy btn-block" style="padding:11px" onclick="App.doExport('full')">Download full CSV</button>
              </div>
              <div class="form-card">
                <div class="fc-title">Summary export</div>
                <div style="font-size:12px;color:#555;margin-bottom:12px">Score summary only — weekly, monthly, quarterly, lifetime scores per case.</div>
                <button class="btn btn-p btn-block" style="padding:11px" onclick="App.doExport('summary')">Download summary CSV</button>
              </div>
              <div class="form-card">
                <div class="fc-title">Children compliance export</div>
                <div style="font-size:12px;color:#555;margin-bottom:12px">All children with seen/not seen counts and compliance status for the current month.</div>
                <button class="btn btn-block" style="padding:11px;background:#1B3A5C;color:#fff" onclick="window.open('/api/export/children-compliance','_blank')">Download children CSV</button>
              </div>
            </div>`);
          break;
        default:
          UI.setContent('<div class="empty-state">View not found.</div>');
      }
    } catch(e) {
      console.error('Nav error:', e);
      UI.setContent(`<div class="empty-state">Error loading: ${e.message}<br><br><button class="btn" onclick="App.nav('dash')">Go to dashboard</button></div>`);
    }
  },

  doExport(mode) {
    const from = document.getElementById('exp-from')?.value || ExecViews._dateFrom || '';
    const to   = document.getElementById('exp-to')?.value   || ExecViews._dateTo   || '';
    let url = `/api/export/csv?mode=${mode}`;
    if (from) url += `&date_from=${from}`;
    if (to)   url += `&date_to=${to}`;
    window.open(url, '_blank');
  },
};

window.addEventListener('DOMContentLoaded', () => Auth.init());