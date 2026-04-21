const DirViews = {
  async dashboard(data) {
    const pid = Auth.user?.program_id;
    const d = data || await API.get(`/api/dashboard${pid?'?program_id='+pid:''}`) || {};
    const s = d.scores || {};
    UI.setTopbar(`
      <span class="wpill">Week ending ${new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</span>
      <button class="btn btn-p btn-sm" onclick="App.nav('entry')">+ New entry</button>
      <button class="btn btn-sm" onclick="window.open('/api/export/csv${pid?'?program_id='+pid:''}','_blank')">Export CSV</button>`);
    UI.setContent(`
      <div class="metric-grid">
        <div class="mc"><div class="mc-label">Program score</div><div class="mc-value" style="color:${UI.scoreColor(s.weekly)}">${s.weekly!=null?Math.round(s.weekly)+'%':'—'}</div><div class="mc-sub">${d.totalCases||0} active cases</div></div>
        <div class="mc"><div class="mc-label">Monthly avg</div><div class="mc-value" style="color:${UI.scoreColor(s.monthly)}">${s.monthly!=null?Math.round(s.monthly)+'%':'—'}</div><div class="mc-sub">Current period</div></div>
        <div class="mc"><div class="mc-label">Safety flags</div><div class="mc-value" style="color:#A32D2D">${d.safetyFlags||0}</div><div class="mc-sub">Requiring action</div></div>
        <div class="mc"><div class="mc-label">FASP overdue</div><div class="mc-value" style="color:#BA7517">${d.faspOver||0}</div><div class="mc-sub">Submit to ACS</div></div>
      </div>
      <div class="chart-grid">
        <div class="card"><div class="card-title">Case planner performance</div>
          <div style="position:relative;height:190px"><canvas id="c-dir-staff" role="img" aria-label="Staff compliance bar chart">Staff data.</canvas></div></div>
        <div class="card"><div class="card-title">Score trend — 12 weeks</div>
          <div style="position:relative;height:190px"><canvas id="c-dir-trend" role="img" aria-label="Score trend line chart">Trend data.</canvas></div></div>
      </div>
      <div class="section-head">Case list</div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Case ID</th><th>Case Planner</th><th>Weekly</th><th>Monthly</th><th>Safety</th><th>FASP</th><th></th></tr></thead>
          <tbody>${(d.caseScores||[]).length?(d.caseScores||[]).map(e=>`<tr>
            <td class="mono bold" style="color:#1B3A5C">${e.case_id}</td>
            <td>${e.case_planner||'—'}</td>
            <td>${UI.badge(e.weekly_score)}</td><td>${UI.badge(e.monthly_score)}</td>
            <td>${e.safety_flag==='Yes'?'<span class="badge badge-red">Flag</span>':'<span class="badge badge-gray">—</span>'}</td>
            <td>${UI.faspBadge(e.fasp_status)}</td>
            <td><button class="btn btn-xs" onclick="sessionStorage.setItem('sn_case','${e.case_id}');App.nav('supnote')">Sup note</button></td>
          </tr>`).join(''):'<tr><td colspan="7" class="empty-state">No cases yet — add cases in the Roster.</td></tr>'}</tbody>
        </table>
      </div>`);
    if((d.byPlanner||[]).length){UI.mkChart('c-dir-staff',{type:'bar',data:{labels:(d.byPlanner||[]).map(p=>(p.case_planner||'').split(' ')[0]),datasets:[{label:'Weekly %',data:(d.byPlanner||[]).map(p=>p.ws||0),backgroundColor:(d.byPlanner||[]).map(p=>(p.ws||0)>=90?'#1D9E75':(p.ws||0)>=75?'#EF9F27':'#E24B4A'),borderRadius:5}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{min:0,max:100,ticks:{callback:v=>v+'%',font:{size:10}}},x:{ticks:{font:{size:10}}}}}});}
    if((d.trend||[]).length){UI.trendChart('c-dir-trend',d.trend,'#0F6E56');}
  },
  switchTab(id,el){document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));el?.classList.add('active');},
};

const SupViews = {
  async dashboard(data) {
    const pid = Auth.user?.program_id;
    const d = data || await API.get(`/api/dashboard${pid?'?program_id='+pid:''}`) || {};
    const s = d.scores || {};
    UI.setTopbar(`<span class="wpill">Week ending ${new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</span>
      <button class="btn btn-p btn-sm" onclick="App.nav('entry')">+ New entry</button>`);
    UI.setContent(`
      <div style="background:#1B3A5C;border-radius:10px;padding:14px 18px;margin-bottom:18px;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px">
        ${[['My program score',s.weekly!=null?Math.round(s.weekly)+'%':'—'],['Cases I supervise',d.totalCases||0],['Safety flags',d.safetyFlags||0],['FASP overdue',d.faspOver||0]].map(([l,v],i)=>`
          <div style="text-align:center"><div style="font-size:10px;color:rgba(255,255,255,.45);font-weight:600;margin-bottom:4px">${l}</div>
          <div style="font-size:22px;font-weight:700;color:${i===2&&v>0?'#F09595':i===3&&v>0?'#FAC775':'#fff'}">${v}</div></div>`).join('')}
      </div>
      <div class="section-head">My cases</div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Case ID</th><th>Case Planner</th><th>Weekly</th><th>Monthly</th><th>Quarterly</th><th>Safety</th><th>FASP</th><th></th></tr></thead>
          <tbody>${(d.caseScores||[]).length?(d.caseScores||[]).map(e=>`<tr>
            <td class="mono bold" style="color:#1B3A5C">${e.case_id}</td>
            <td>${e.case_planner||'—'}</td>
            <td>${UI.badge(e.weekly_score)}</td><td>${UI.badge(e.monthly_score)}</td><td>${UI.badge(e.quarterly_score)}</td>
            <td>${e.safety_flag==='Yes'?'<span class="badge badge-red">Flag</span>':'<span class="badge badge-gray">—</span>'}</td>
            <td>${UI.faspBadge(e.fasp_status)}</td>
            <td><button class="btn btn-xs" onclick="sessionStorage.setItem('sn_case','${e.case_id}');App.nav('supnote')">Sup note</button></td>
          </tr>`).join(''):'<tr><td colspan="8" class="empty-state">No cases yet.</td></tr>'}</tbody>
        </table>
      </div>`);
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
    const roleColors  = { executive:'#534AB7', program_director:'#0F6E56', supervisor:'#993C1D', staff:'#1B3A5C', admin:'#534AB7' };
    const chipClasses = { executive:'chip-exec', program_director:'chip-dir', supervisor:'chip-sup', staff:'chip-staff', admin:'chip-exec' };
    const chipLabels  = { executive:'Executive Access', program_director:'Program Director', supervisor:'Supervisor View', staff:'Case Planner', admin:'System Admin' };
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
      executive: `${sec('Overview')}${item('dash','Executive Dashboard')}${item('progs','All Programs')}${item('cases','All Cases')}${sec('Reports')}${item('alerts','System Alerts')}${item('export','Export Reports')}`,
      admin:     `${sec('Overview')}${item('dash','Executive Dashboard')}${item('progs','All Programs')}${item('cases','All Cases')}${sec('Reports')}${item('alerts','System Alerts')}${item('export','Export Reports')}${sec('System')}${item('admin','Admin Panel')}`,
      program_director: `${sec('My Program')}${item('dash','Program Dashboard')}${item('cases','Case List')}${item('entry','New Entry')}${sec('Oversight')}${item('suplog','Supervision Log')}${item('alerts','Alerts')}${item('supnote','Supervisory Notes')}${sec('Data')}${item('roster','Case Roster')}`,
      supervisor: `${sec('My Cases')}${item('dash','Case Dashboard')}${item('weekly','This Week')}${item('cases','All My Cases')}${item('entry','New Entry')}${sec('Supervision')}${item('suplog','Supervision Log')}${item('supnote','Supervisory Notes')}${sec('Data')}${item('roster','Case Roster')}`,
      staff: `${sec('My Work')}${item('dash','My Dashboard')}${item('weekly','This Week')}${item('entry','New Entry')}`,
    };
    document.getElementById('sb-nav').innerHTML = navs[u.role] || navs.staff;
  },

  async nav(viewId, el) {
    document.querySelectorAll('.sb-item').forEach(i => i.classList.remove('active'));
    (el || document.querySelector(`[data-nav="${viewId}"]`))?.classList.add('active');
    const titles = { dash:'Dashboard',progs:'All Programs',cases:'Case List',entry:'New Entry',weekly:'This Week',suplog:'Supervision Log',supnote:'Supervisory Notes',alerts:'Alerts',roster:'Case Roster',export:'Export Reports',admin:'Admin Panel' };
    document.getElementById('tb-title').textContent = titles[viewId] || viewId;
    document.getElementById('main-content').innerHTML = '<div class="loading">Loading...</div>';
    const u   = Auth.user;
    const pid = (u.role==='executive'||u.role==='admin') ? null : u.program_id;
    try {
      switch(viewId) {
        case 'dash':
          if(u.role==='executive'||u.role==='admin') await ExecViews.dashboard();
          else if(u.role==='program_director') await DirViews.dashboard();
          else await SupViews.dashboard();
          break;
        case 'progs':   await ExecViews.dashboard(); break;
        case 'cases':   await SharedViews.renderCases(pid); break;
        case 'entry':   await SharedViews.renderEntry(); break;
        case 'weekly':  await SupViews.renderWeekly(pid); break;
        case 'suplog':  await SharedViews.renderSuplog(pid); break;
        case 'supnote': await SharedViews.renderSupnote(pid); break;
        case 'alerts':  await SharedViews.renderAlerts(pid); break;
        case 'roster':  await SharedViews.renderRoster(pid); break;
        case 'admin':   await AdminViews.render(); break;
        case 'export':
          UI.setTopbar(`<button class="btn btn-navy btn-sm" onclick="window.open('/api/export/csv?mode=full','_blank')">Export full CSV</button><button class="btn btn-sm" onclick="window.open('/api/export/csv?mode=summary','_blank')">Export summary CSV</button>`);
          UI.setContent(`<div class="chart-grid">
            <div class="form-card"><div class="fc-title">Full data export</div>
              <div class="field" style="margin-bottom:10px"><label>Date from</label><input type="date"></div>
              <div class="field" style="margin-bottom:14px"><label>Date to</label><input type="date"></div>
              <button class="btn btn-navy btn-block" style="padding:10px" onclick="window.open('/api/export/csv?mode=full','_blank')">Download full CSV</button>
              <div style="font-size:11px;color:#aaa;margin-top:8px">Every entry with all responses — for ACS audits.</div>
            </div>
            <div class="form-card"><div class="fc-title">Summary export</div>
              <div class="field" style="margin-bottom:10px"><label>Date from</label><input type="date"></div>
              <div class="field" style="margin-bottom:14px"><label>Date to</label><input type="date"></div>
              <button class="btn btn-p btn-block" style="padding:10px" onclick="window.open('/api/export/csv?mode=summary','_blank')">Download summary CSV</button>
              <div style="font-size:11px;color:#aaa;margin-top:8px">Score summary only — for board presentations.</div>
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
};

window.addEventListener('DOMContentLoaded', () => Auth.init());
