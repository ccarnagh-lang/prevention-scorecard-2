const SharedViews = {

  // ── ENTRY FORM ─────────────────────────────────────────────
  async renderEntry(roster) {
    UI.setTitle('New Entry');
    UI.setTopbar(`<span class="wpill">Week ending ${new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</span>`);
    const cases = roster || await API.get('/api/roster') || [];

    const buildRows = reqs => reqs.map(r => UI.buildReqRow(r)).join('');
    const buildSection = reqs =>
      Object.entries(reqs).map(([key,items]) =>
        `<div class="req-sec-hdr">${key.charAt(0).toUpperCase()+key.slice(1)}</div>` + buildRows(items)
      ).join('');

    UI.setContent(`
      <div class="score-strip">
        <div class="score-tile"><div class="score-tile-label">Weekly score</div><div class="score-tile-value" id="sw">—</div></div>
        <div class="score-tile"><div class="score-tile-label">Monthly score</div><div class="score-tile-value" id="sm">—</div></div>
        <div class="score-tile"><div class="score-tile-label">Quarterly score</div><div class="score-tile-value" id="sq">—</div></div>
        <div class="score-tile"><div class="score-tile-label">Rating</div><div class="score-tile-value" id="sr" style="font-size:14px">—</div></div>
      </div>

      <div class="form-card">
        <div class="fc-title">Case identification</div>
        <div class="grid-3">
          <div class="field"><label>Case ID (CNNX)</label>
            <select id="f-case" onchange="SharedViews.entryAutoFill(this)">
              <option value="">— Select case —</option>
              ${cases.map(c=>`<option value="${c.case_id}" data-pl="${c.planner_name||''}" data-hh="${c.household_id||''}" data-ch="${c.children_count||0}" data-name="${c.case_name||''}">${c.case_id}${c.case_name?' — '+c.case_name:''}</option>`).join('')}
            </select></div>
          <div class="field"><label>Case planner</label>
            <select id="f-planner">
              ${[...new Set(cases.map(c=>c.planner_name).filter(Boolean))].map(p=>`<option>${p}</option>`).join('')}
            </select></div>
          <div class="field"><label>Week ending</label><input type="date" id="f-week"></div>
          <div class="field"><label>Household ID</label><input type="text" id="f-hh" placeholder="HH-####"></div>
          <div class="field"><label>Case name (HOH)</label><input type="text" id="f-casename" placeholder="Last, First"></div>
          <div class="field"><label>Submission notes</label><input type="text" id="f-notes" placeholder="Optional..."></div>
        </div>
      </div>

      <div class="form-card">
        <div class="fc-title">
          Section A — weekly requirements
          <span class="field-tag" style="background:#E1F5EE;color:#085041">10 items</span>
        </div>
        ${buildRows(REQS.weekly.filter(r=>r.id!=='W6'))}
        <div class="req-sec-hdr">W6 — Children seen this week</div>
        <div id="children-seen-rows">
          <div style="color:#aaa;font-size:12px;padding:10px 0">Select a case above to load children from the roster.</div>
        </div>
      </div>

      <div class="form-card">
        <div class="fc-title">Section B — monthly requirements <span class="field-tag" style="background:#E6F1FB;color:#185FA5">5 items</span></div>
        ${buildRows(REQS.monthly)}
      </div>

      <div class="form-card">
        <div class="fc-title">Section C — quarterly requirements <span class="field-tag" style="background:#EEEDFE;color:#3C3489">18 items</span></div>
        ${buildSection(REQS.quarterly)}
      </div>

      <div style="display:flex;gap:8px;padding-bottom:32px">
        <button class="btn btn-p" style="padding:10px 28px;font-size:14px" onclick="SharedViews.submitEntry()">Save entry</button>
        <button class="btn btn-pu" style="padding:10px 20px;font-size:14px" onclick="SharedViews.submitAndNote()">Save &amp; generate sup note</button>
        <button class="btn" onclick="SharedViews.clearEntry()">Clear form</button>
      </div>
    `);

    document.getElementById('f-week').valueAsDate = new Date();
    document.querySelectorAll('.req-sel').forEach(s => {
      s.addEventListener('change', () => SharedViews.calcScore());
      SharedViews.styleReq(s);
    });
  },

  async entryAutoFill(sel) {
    const opt = sel.options[sel.selectedIndex];
    if (!opt.value) {
      document.getElementById('children-seen-rows').innerHTML = '<div style="color:#aaa;font-size:12px;padding:10px 0">Select a case above to load children from the roster.</div>';
      return;
    }
    const pl = document.getElementById('f-planner');
    if (pl && opt.dataset.pl) pl.value = opt.dataset.pl;
    const hh = document.getElementById('f-hh');
    if (hh && opt.dataset.hh) hh.value = opt.dataset.hh;
    const cn = document.getElementById('f-casename');
    if (cn && opt.dataset.name) cn.value = opt.dataset.name;

    // Load children for this case
    const caseId = opt.value;
    const childrenEl = document.getElementById('children-seen-rows');
    childrenEl.innerHTML = '<div style="color:#aaa;font-size:12px;padding:8px 0">Loading children...</div>';

    try {
      const children = await API.get(`/api/children/${caseId}`) || [];
      if (children.length === 0) {
        childrenEl.innerHTML = `
          <div style="padding:10px;background:#FAEEDA;border-radius:6px;border-left:3px solid #EF9F27;font-size:12px;color:#633806">
            No children found in roster for this case. Upload a roster CSV or add children manually.
          </div>`;
        return;
      }

      const today = new Date();
      const age = dob => {
        if (!dob) return '—';
        const b = new Date(dob);
        const a = Math.floor((today - b) / (365.25 * 24 * 60 * 60 * 1000));
        return isNaN(a) ? '—' : a + ' yrs';
      };

      childrenEl.innerHTML = children.map(c => `
        <div class="req-row" style="grid-template-columns:1fr 80px 130px 1fr" data-cin="${c.cin}">
          <div>
            <div style="font-size:13px;font-weight:600;color:#222">${c.child_name||'Unknown'}</div>
            <div style="font-size:11px;color:#aaa">CIN: ${c.cin||'—'} &nbsp;|&nbsp; DOB: ${c.dob||'—'} &nbsp;|&nbsp; Age: ${age(c.dob)}</div>
          </div>
          <div style="text-align:center;font-size:11px;color:#888;font-weight:600">${age(c.dob)}</div>
          <select class="req-sel" id="cs-seen-${c.cin}" onchange="SharedViews.styleReq(this);SharedViews.toggleReasonField('${c.cin}')">
            <option value="">Not recorded</option>
            <option value="Yes">Yes — seen</option>
            <option value="No">No — not seen</option>
          </select>
          <div id="cs-reason-wrap-${c.cin}" style="display:none">
            <select class="req-sel" id="cs-reason-${c.cin}" style="width:100%">
              <option value="">Select reason...</option>
              <option>Not home during visit</option>
              <option>Family refused contact</option>
              <option>Child visiting relative</option>
              <option>Child at school / daycare</option>
              <option>Family reported child safe — follow-up scheduled</option>
              <option>Hospitalized / medical appointment</option>
              <option>Other — see notes</option>
            </select>
          </div>
        </div>`).join('');
    } catch(e) {
      childrenEl.innerHTML = `<div style="font-size:12px;color:#aaa;padding:8px 0">Could not load children: ${e.message}</div>`;
    }
    SharedViews.calcScore();
  },

  toggleReasonField(cin) {
    const sel   = document.getElementById('cs-seen-'+cin);
    const wrap  = document.getElementById('cs-reason-wrap-'+cin);
    if (wrap) wrap.style.display = sel?.value === 'No' ? 'block' : 'none';
  },

  styleReq(sel) {
    sel.className = 'req-sel';
    if (sel.value === 'Yes') sel.classList.add('yes');
    else if (sel.value === 'No') sel.classList.add('no');
    else if (sel.value === 'Some but not all') sel.classList.add('partial');
    SharedViews.calcScore();
  },

  calcScore() {
    const score = ids => {
      let yes=0, tot=0;
      ids.forEach(id => {
        const el = document.getElementById('rq-'+id);
        if (!el || REQS.allFlat().find(r=>r.id===id)?.unscored) return;
        const v = el.value;
        if (!v || v==='Not applicable') return;
        tot++; if (v==='Yes') yes++;
      });
      return tot ? Math.round(yes/tot*100) : null;
    };
    const allQ = Object.values(REQS.quarterly).flat().filter(r=>!r.unscored);
    const ws = score(REQS.weekly.filter(r=>!r.unscored).map(r=>r.id));
    const ms = score(REQS.monthly.filter(r=>!r.unscored).map(r=>r.id));
    const qs = score(allQ.map(r=>r.id));
    if (document.getElementById('sw')) document.getElementById('sw').textContent = ws!=null?ws+'%':'—';
    if (document.getElementById('sm')) document.getElementById('sm').textContent = ms!=null?ms+'%':'—';
    if (document.getElementById('sq')) document.getElementById('sq').textContent = qs!=null?qs+'%':'—';
    const srEl = document.getElementById('sr');
    if (srEl && ws!=null) srEl.textContent = ws>=90?'Strong':ws>=75?'Adequate':'Needs Attention';
  },

  collectEntry() {
    const caseId = document.getElementById('f-case')?.value;
    if (!caseId) { UI.toast('Please select a Case ID','error'); return null; }
    const week   = document.getElementById('f-week')?.value;
    if (!week)   { UI.toast('Please enter a week ending date','error'); return null; }

    const responses = REQS.allFlat().map(r => ({
      id:r.id, name:r.name, section:r.section, cadence:r.cadence,
      response: document.getElementById('rq-'+r.id)?.value||'',
      notes:    document.getElementById('rn-'+r.id)?.value||'',
      unscored: r.unscored||false,
    }));

    // Collect children seen data
    const childRows = document.querySelectorAll('[data-cin]');
    const children_seen = Array.from(childRows).map(row => {
      const cin    = row.dataset.cin;
      const seen   = document.getElementById('cs-seen-'+cin)?.value || '';
      const reason = document.getElementById('cs-reason-'+cin)?.value || '';
      return { cin, seen, reason_not_seen: reason };
    }).filter(c => c.cin && c.seen);

    return {
      case_id:          caseId,
      case_planner:     document.getElementById('f-planner')?.value||'',
      week_ending:      week,
      household_id:     document.getElementById('f-hh')?.value||'',
      case_name:        document.getElementById('f-casename')?.value||'',
      submission_notes: document.getElementById('f-notes')?.value||'',
      children_count:   children_seen.length || 0,
      responses,
      children_seen,
    };
  },

  async submitEntry() {
    const entry = this.collectEntry();
    if (!entry) return;
    try {
      await API.post('/api/entries', entry);
      UI.toast('Entry saved for '+entry.case_id,'success');
      this.clearEntry();
    } catch(e) { UI.toast('Save failed: '+e.message,'error'); }
  },

  async submitAndNote() {
    const entry = this.collectEntry();
    if (!entry) return;
    try {
      await API.post('/api/entries', entry);
      sessionStorage.setItem('sn_case', entry.case_id);
      App.nav('supnote');
    } catch(e) { UI.toast('Save failed: '+e.message,'error'); }
  },

  clearEntry() {
    document.getElementById('f-case').value='';
    document.getElementById('f-hh').value='';
    document.getElementById('f-notes').value='';
    document.getElementById('children-seen-rows').innerHTML='<div style="color:#aaa;font-size:12px;padding:10px 0">Select a case above to load children from the roster.</div>';
    document.querySelectorAll('.req-sel').forEach(s=>{s.selectedIndex=0;this.styleReq(s);});
    document.querySelectorAll('.req-note').forEach(i=>i.value='');
  },

  // ── CASE LIST ──────────────────────────────────────────────
  async renderCases(programId) {
    UI.setTitle('Case List');
    const u = Auth.user;
    const isAdminOrExec = u.role === 'admin' || u.role === 'executive';
    const dateFrom = ExecViews._dateFrom || '';
    const dateTo   = ExecViews._dateTo   || '';

    // Admin/executive: load ALL roster cases + merge with latest entry scores + entry counts
    // Others: load latest entries for their program(s)
    let entries = [];
    if (isAdminOrExec) {
      const [roster, latestEntries, subStats] = await Promise.all([
        API.get('/api/roster?active=false') || [],
        API.get(`/api/entries/latest?_=1${dateFrom?'&date_from='+dateFrom:''}${dateTo?'&date_to='+dateTo:''}`) || [],
        API.get(`/api/submission-stats?_=1${dateFrom?'&date_from='+dateFrom:''}${dateTo?'&date_to='+dateTo:''}`) || {},
      ]);
      const entryMap = {};
      (latestEntries||[]).forEach(e => { entryMap[e.case_id] = e; });
      const countMap = {};
      ((subStats||{}).caseEntryCounts||[]).forEach(c => { countMap[c.case_id] = c; });
      entries = (roster||[]).map(r => ({
        case_id:         r.case_id,
        case_name:       r.case_name || '',
        program_id:      r.program_id || '',
        case_planner:    r.planner_name || '',
        week_ending:     entryMap[r.case_id]?.week_ending || '',
        weekly_score:    entryMap[r.case_id]?.weekly_score ?? null,
        monthly_score:   entryMap[r.case_id]?.monthly_score ?? null,
        quarterly_score: entryMap[r.case_id]?.quarterly_score ?? null,
        lifetime_score:  entryMap[r.case_id]?.lifetime_score ?? null,
        safety_flag:     entryMap[r.case_id]?.safety_flag || 'No',
        fasp_status:     entryMap[r.case_id]?.fasp_status || 'Pending',
        reviewed:        entryMap[r.case_id]?.reviewed || false,
        active:          r.active,
        manually_assigned: r.manually_assigned,
        open_date:       r.open_date || '',
        end_date:        r.end_date || '',
        has_entry:       !!entryMap[r.case_id],
        entry_count:     parseInt(countMap[r.case_id]?.entry_count || 0),
        first_entry:     countMap[r.case_id]?.first_entry || '',
        last_entry:      countMap[r.case_id]?.last_entry || '',
      }));
    } else {
      let url = '/api/entries/latest?_=1';
      if (programId) url += `&program_id=${encodeURIComponent(programId)}`;
      if (dateFrom)  url += `&date_from=${dateFrom}`;
      if (dateTo)    url += `&date_to=${dateTo}`;
      entries = await API.get(url) || [];
    }

    // Get all programs for filter dropdown
    const programs = isAdminOrExec ? (await API.get('/api/programs') || []) : [];

    UI.setTopbar(`
      ${isAdminOrExec ? `<select id="fl-prog" onchange="SharedViews.filterCases()" style="font-size:12px;padding:5px 9px;border:1px solid var(--mgray);border-radius:6px">
        <option value="">All programs</option>
        ${programs.map(p=>`<option value="${p.id}">${p.name||p.id}</option>`).join('')}
      </select>` : ''}
      <select id="fl-planner" onchange="SharedViews.filterCases()" style="font-size:12px;padding:5px 9px;border:1px solid var(--mgray);border-radius:6px">
        <option value="">All planners</option>
        ${[...new Set(entries.map(e=>e.case_planner).filter(Boolean))].sort().map(p=>`<option>${p}</option>`).join('')}
      </select>
      <select id="fl-fasp" onchange="SharedViews.filterCases()" style="font-size:12px;padding:5px 9px;border:1px solid var(--mgray);border-radius:6px">
        <option value="">All FASP</option><option>Current</option><option>Overdue</option><option>Pending</option>
      </select>
      <input type="text" id="fl-search" oninput="SharedViews.filterCases()" placeholder="Search case ID or name..." style="font-size:12px;padding:5px 9px;border:1px solid var(--mgray);border-radius:6px">
      ${isAdminOrExec ? `<div style="display:flex;align-items:center;gap:3px">
        <button class="btn btn-xs" onclick="SharedViews.setCaseDatePreset('week')">Week</button>
        <button class="btn btn-xs" onclick="SharedViews.setCaseDatePreset('month')">Month</button>
        <button class="btn btn-xs" onclick="SharedViews.setCaseDatePreset('quarter')">Quarter</button>
        <button class="btn btn-xs" onclick="SharedViews.setCaseDatePreset('year')">Year</button>
        <button class="btn btn-xs" onclick="SharedViews.setCaseDatePreset('all')">All time</button>
      </div>
      <input type="date" id="fl-from" value="${dateFrom}" onchange="SharedViews.applyCaseDateFilter()" style="font-size:12px;padding:5px 9px;border:1px solid var(--mgray);border-radius:6px">
      <span style="color:#aaa;font-size:12px">to</span>
      <input type="date" id="fl-to" value="${dateTo}" onchange="SharedViews.applyCaseDateFilter()" style="font-size:12px;padding:5px 9px;border:1px solid var(--mgray);border-radius:6px">` : ''}
    `);
    SharedViews._caseData = entries;
    UI.setContent(`
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Case ID</th><th>Case Name</th><th>Program</th><th>Case Planner</th><th>Entries</th><th>Last Entry</th><th>Weekly</th><th>Monthly</th><th>Quarterly</th><th>Lifetime</th><th>Safety</th><th>FASP</th><th>Status</th><th></th></tr></thead>
          <tbody id="case-tbody"></tbody>
        </table>
      </div>`);
    SharedViews._caseProgramId = programId;
    this.filterCases();
  },

  openCaseReview(caseId) {
    sessionStorage.setItem('sn_case', caseId);
    App.nav('supnote');
  },

  setCaseDatePreset(preset) {
    const { from, to } = ExecViews.getDatePreset(preset);
    ExecViews._dateFrom = from;
    ExecViews._dateTo   = to;
    SharedViews.renderCases(null);
  },

  applyCaseDateFilter() {
    ExecViews._dateFrom = document.getElementById('fl-from')?.value || null;
    ExecViews._dateTo   = document.getElementById('fl-to')?.value   || null;
    SharedViews.renderCases(null);
  },

  filterCases() {
    const pl   = document.getElementById('fl-planner')?.value||'';
    const fp   = document.getElementById('fl-fasp')?.value||'';
    const prog = document.getElementById('fl-prog')?.value||'';
    const srch = (document.getElementById('fl-search')?.value||'').toLowerCase();
    const filtered = (SharedViews._caseData||[]).filter(e=>
      (!pl   || e.case_planner===pl) &&
      (!fp   || e.fasp_status===fp) &&
      (!prog || e.program_id===prog) &&
      (!srch || (e.case_id||'').toLowerCase().includes(srch) || (e.case_planner||'').toLowerCase().includes(srch) || (e.case_name||'').toLowerCase().includes(srch))
    );
    document.getElementById('case-tbody').innerHTML = filtered.length
      ? filtered.map(e=>`<tr>
          <td class="mono bold" style="color:#1B3A5C">
            ${['admin','executive','program_director','supervisor'].includes(Auth.user?.role)
              ? `<a href="#" onclick="event.preventDefault();SharedViews.openCaseReview('${e.case_id}')" style="color:#1B3A5C;text-decoration:underline;cursor:pointer" title="Click to open monthly supervisory review">${e.case_id}</a>`
              : e.case_id}
          </td>
          <td style="font-size:12px">${e.case_name||'—'}</td>
          <td style="font-size:11px;color:#888">${e.program_id||'—'}${e.manually_assigned?' <span class="badge badge-amber" style="font-size:9px">🔒</span>':''}</td>
          <td>${e.case_planner||'—'}</td>
          <td style="text-align:center">
            ${e.entry_count>0
              ? `<span style="font-weight:700;color:#1B3A5C">${e.entry_count}</span>`
              : '<span class="badge badge-amber">0</span>'}
          </td>
          <td style="color:#aaa;font-size:12px">${e.last_entry||e.week_ending||'—'}</td>
          <td>${e.has_entry===false?'<span style="color:#ccc;font-size:11px">—</span>':UI.badge(e.weekly_score)}</td>
          <td>${e.has_entry===false?'<span style="color:#ccc;font-size:11px">—</span>':UI.badge(e.monthly_score)}</td>
          <td>${e.has_entry===false?'<span style="color:#ccc;font-size:11px">—</span>':UI.badge(e.quarterly_score)}</td>
          <td>${e.has_entry===false?'<span style="color:#ccc;font-size:11px">—</span>':UI.badge(e.lifetime_score)}</td>
          <td>${e.safety_flag==='Yes'?'<span class="badge badge-red">Flag</span>':'<span class="badge badge-gray">—</span>'}</td>
          <td>${UI.faspBadge(e.fasp_status)}</td>
          <td>${e.active===false?'<span class="badge badge-gray">Ended</span>':e.has_entry===false?'<span class="badge badge-amber">No entries</span>':'<span class="badge badge-green">Active</span>'}</td>
          <td style="display:flex;gap:4px">
            ${(Auth.user?.role==='admin'||Auth.user?.role==='executive')?`<button class="btn btn-xs" onclick="SharedViews.reassignCase('${e.case_id}')">Reassign</button>`:''}
            <button class="btn btn-xs" onclick="sessionStorage.setItem('sn_case','${e.case_id}');App.nav('supnote')">Note</button>
          </td>
        </tr>`).join('')
      : '<tr><td colspan="14" class="empty-state">No cases match filters</td></tr>';
  },

  // ── SUPERVISION LOG ────────────────────────────────────────
  async renderSuplog(programId) {
    UI.setTitle('Supervision Log');
    const [logs, staff] = await Promise.all([
      API.get('/api/supervision-log'+(programId?`?program_id=${programId}`:''))||[],
      API.get('/api/staff'+(programId?`?program_id=${programId}`:''))||[],
    ]);
    UI.setTopbar(`
      <select id="sl-staff" onchange="SharedViews.renderSuplogContent()" style="font-size:12px;padding:5px 9px;border:1px solid var(--mgray);border-radius:6px">
        <option value="">All staff</option>
        ${staff.map(s=>`<option>${s.name}</option>`).join('')}
      </select>
      <button class="btn btn-p btn-sm" onclick="SharedViews.addSupNote('${programId||''}')">+ Add log</button>`);
    SharedViews._supLogs  = logs;
    SharedViews._supStaff = staff;
    SharedViews._currentProgramId = programId;
    this.renderSuplogContent();
  },

  parseLogContent(rawContent) {
    // Parse structured weekly log content into sections
    if (!rawContent) return null;
    const sections = {};
    const parts = rawContent.split(/\n\n(?=\[)/);
    parts.forEach(part => {
      const match = part.match(/^\[([^\]]+)\]\n([\s\S]*)/);
      if (match) {
        sections[match[1]] = match[2].trim();
      }
    });
    return Object.keys(sections).length > 0 ? sections : null;
  },

  renderCaseTable(jsonStr) {
    try {
      const rows = JSON.parse(jsonStr);
      if (!rows.length) return '';
      return `<table style="width:100%;border-collapse:collapse;font-size:11px;margin-top:6px">
        <thead><tr style="background:#f0f4f8">
          <th style="padding:5px 7px;text-align:left;border:1px solid #ddd">Case name</th>
          <th style="padding:5px 7px;text-align:left;border:1px solid #ddd">Dates of contact</th>
          <th style="padding:5px 7px;text-align:left;border:1px solid #ddd">Children not seen</th>
          <th style="padding:5px 7px;text-align:left;border:1px solid #ddd">Risk</th>
          <th style="padding:5px 7px;text-align:left;border:1px solid #ddd">Engagement</th>
        </tr></thead>
        <tbody>${rows.map(r=>`<tr>
          <td style="padding:4px 7px;border:1px solid #ddd">${r.case_name||'—'}</td>
          <td style="padding:4px 7px;border:1px solid #ddd">${r.contacts||'—'}</td>
          <td style="padding:4px 7px;border:1px solid #ddd">${r.not_seen||'—'}</td>
          <td style="padding:4px 7px;border:1px solid #ddd">${r.risk?`<span class="badge ${r.risk==='High'?'badge-red':r.risk==='Medium'?'badge-amber':'badge-green'}">${r.risk}</span>`:'—'}</td>
          <td style="padding:4px 7px;border:1px solid #ddd">${r.engagement||'—'}</td>
        </tr>`).join('')}</tbody>
      </table>`;
    } catch(e) { return `<div style="font-size:11px;color:#888">${jsonStr}</div>`; }
  },

  renderLogEntry(l, isMe) {
    const sections = SharedViews.parseLogContent(l.content);
    const sectionOrder = [
      'Date of Supervision',
      'Case Review Table',
      'Highlights and Major Accomplishments',
      'Administrative/Staff Challenges',
      'High Risk Cases',
      'Low Engagement / Children Not Seen',
      'FASP Due This Month',
      'Families/Children Opened This Week',
      'Cases Closed/Children Discharged',
      'Case Updates from Previous Supervision',
      'How Staff is Feeling in Role',
      'Support Needed',
      'Clinically/Administratively Curious About',
      'Follow-ups for Next Supervision',
    ];

    const bodyHtml = sections
      ? sectionOrder.filter(k => sections[k]).map(k => `
          <div style="margin-bottom:10px">
            <div style="font-size:10px;font-weight:700;color:#1B3A5C;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:3px">${k}</div>
            <div style="font-size:12px;color:#333;line-height:1.5">
              ${k === 'Case Review Table'
                ? SharedViews.renderCaseTable(sections[k])
                : sections[k].replace(/\n/g,'<br>')}
            </div>
          </div>`).join('')
      : `<div class="thread-text">${l.content}</div>`;

    return `<div class="thread-entry">
      <div class="thread-av" style="background:${isMe?'#993C1D':'#1B3A5C'}">${UI.initials(l.author_name)}</div>
      <div style="flex:1">
        <div class="thread-bubble${isMe?' mine':''}">
          <div class="thread-meta">
            ${l.author_name} &nbsp;·&nbsp; ${l.author_role} &nbsp;·&nbsp; ${l.created_at?.slice(0,10)||''}
            ${sections?'<span class="badge badge-blue" style="font-size:9px;margin-left:4px">Weekly Log</span>':''}
          </div>
          ${bodyHtml}
          ${l.action_item?`<div class="thread-action">Action: ${l.action_item}${l.due_date?' — due '+l.due_date:''}<span class="badge ${l.status==='Open'?'badge-amber':'badge-green'}" style="margin-left:6px">${l.status}</span></div>`:''}
        </div>
        ${!l.resolved&&isMe?`<div style="margin-top:4px"><button class="btn btn-xs" onclick="SharedViews.resolveNote(${l.id})">Mark resolved</button></div>`:''}
        ${l.resolved?`<div style="font-size:11px;color:#aaa;margin-top:4px">✓ Resolved ${l.resolved_at?.slice(0,10)||''}</div>`:''}
      </div>
    </div>`;
  },

  renderSuplogContent() {
    const filterStaff = document.getElementById('sl-staff')?.value||'';
    const logs  = SharedViews._supLogs||[];
    const staff = SharedViews._supStaff||[];
    const names = filterStaff?[filterStaff]:[...new Set(staff.map(s=>s.name))];
    let html = '';
    names.forEach(name => {
      const sdata = staff.find(s=>s.name===name);
      const sLogs = logs.filter(l=>l.staff_name===name).sort((a,b)=>b.created_at.localeCompare(a.created_at));
      html += `
        <div class="staff-section">
          <div class="staff-header">
            <div class="staff-info">
              <div class="staff-av" style="background:#1B3A5C">${UI.initials(name)}</div>
              <div><div class="staff-name">${name}</div>
              <div class="staff-meta">${sdata?.cases||0} cases &nbsp;|&nbsp; ${sLogs.length} supervision log entries</div></div>
            </div>
            <div style="display:flex;gap:8px;align-items:center">
              ${sdata?.ws!=null?UI.badge(sdata.ws):''}
              <button class="btn btn-p btn-xs" onclick="sessionStorage.setItem('sn_staff','${name}');App.nav('supnote')">Monthly note</button>
            </div>
          </div>
          <div class="thread">
            ${sLogs.length?sLogs.map(l=>{
              const isMe=l.author_role==='supervisor'||l.author_role==='program_director'||l.author_role==='executive'||l.author_role==='admin';
              return SharedViews.renderLogEntry(l, isMe);
            }).join(''):'<div style="color:#aaa;font-size:12px;text-align:center;padding:12px">No weekly supervision logs yet. Click "+ Add log" to start.</div>'}
            <div class="thread-add">
              <input type="text" id="note-input-${name.replace(/\s/g,'_')}" placeholder="Quick note...">
              <button class="btn btn-p btn-sm" onclick="SharedViews.postNote('${name}','${SharedViews._currentProgramId||''}')">Post</button>
            </div>
          </div>
        </div>`;
    });
    document.getElementById('main-content').innerHTML = html || '<div class="empty-state">No staff found for this program.</div>';
    SharedViews._currentProgramId = SharedViews._currentProgramId || '';
  },

  async postNote(staffName, programId) {
    const inputId = 'note-input-'+staffName.replace(/\s/g,'_');
    const input   = document.getElementById(inputId);
    if (!input?.value.trim()) return;
    try {
      await API.post('/api/supervision-log', { program_id:programId, staff_name:staffName, content:input.value.trim(), entry_type:'note' });
      input.value='';
      await this.renderSuplog(programId);
      UI.toast('Note added','success');
    } catch(e) { UI.toast('Failed: '+e.message,'error'); }
  },

  async resolveNote(id) {
    await API.put(`/api/supervision-log/${id}/resolve`,{});
    UI.toast('Marked as resolved','success');
    await this.renderSuplog(SharedViews._currentProgramId);
  },

  async populateCaseRow(rowIndex) {
    const dateEl = document.getElementById('mn-date');
    const sel    = document.getElementById(`mn-case-sel-${rowIndex}`);
    const notSeenEl = document.getElementById(`mn-not-seen-${rowIndex}`);
    const caseId = sel?.value;
    if (!caseId || !notSeenEl) return;

    // Get month/year from supervision date
    const supDate = dateEl?.value ? new Date(dateEl.value) : new Date();
    const month   = supDate.getMonth() + 1;
    const year    = supDate.getFullYear();

    notSeenEl.value = 'Loading...';
    try {
      const compliance = await API.get(`/api/children-compliance?month=${month}&year=${year}`) || [];
      const caseCompliance = compliance.filter(c => c.case_id === caseId && c.compliance_status === 'Non-compliant');
      if (caseCompliance.length === 0) {
        notSeenEl.value = 'None';
      } else {
        notSeenEl.value = caseCompliance.map(c => c.child_name || c.cin).join(', ');
      }
    } catch(e) {
      notSeenEl.value = '';
    }
  },

  async refreshAllCaseRows() {
    let i = 0;
    while (document.getElementById(`mn-case-sel-${i}`) !== null) {
      const sel = document.getElementById(`mn-case-sel-${i}`);
      if (sel?.value) await SharedViews.populateCaseRow(i);
      i++;
    }
  },

  async addCaseRow(programId) {
    const roster = SharedViews._lastRoster || await API.get('/api/roster' + (programId ? `?program_id=${programId}` : '')) || [];
    SharedViews._lastRoster = roster;
    const rosterOpts = roster.map(r =>
      `<option value="${r.case_id}">${r.case_name || r.case_id}${r.planner_name ? ' — ' + r.planner_name : ''}</option>`
    ).join('');
    const tbody = document.getElementById('mn-case-rows');
    if (!tbody) return;
    let i = tbody.querySelectorAll('tr').length;
    const tr = document.createElement('tr');
    tr.id = `mn-row-${i}`;
    tr.innerHTML = `
      <td style="border:1px solid #ddd;padding:2px">
        <select id="mn-case-sel-${i}" onchange="SharedViews.populateCaseRow(${i})" style="width:100%;border:none;padding:4px;font-size:11px;background:transparent;box-sizing:border-box">
          <option value="">— Select case —</option>${rosterOpts}
        </select>
      </td>
      <td style="border:1px solid #ddd;padding:2px">
        <input type="text" id="mn-contacts-${i}" placeholder="e.g. 4/1, 4/8" style="width:100%;border:none;padding:4px;font-size:11px;box-sizing:border-box">
      </td>
      <td style="border:1px solid #ddd;padding:2px">
        <input type="text" id="mn-not-seen-${i}" placeholder="Auto-fills on case select" style="width:100%;border:none;padding:4px;font-size:11px;box-sizing:border-box;color:#A32D2D">
      </td>
      <td style="border:1px solid #ddd;padding:2px">
        <select id="mn-risk-${i}" style="width:100%;border:none;padding:4px;font-size:11px;background:transparent">
          <option value="">—</option><option>High</option><option>Medium</option><option>Low</option>
        </select>
      </td>
      <td style="border:1px solid #ddd;padding:2px">
        <select id="mn-eng-${i}" style="width:100%;border:none;padding:4px;font-size:11px;background:transparent">
          <option value="">—</option><option>High</option><option>Average</option><option>Low / difficult to contact</option>
        </select>
      </td>`;
    tbody.appendChild(tr);
  },

  async addSupNote(programId) {
    const staff   = SharedViews._supStaff || [];
    const today   = new Date().toISOString().slice(0,10);

    // Pre-load roster for this program
    const roster = await API.get('/api/roster' + (programId ? `?program_id=${programId}` : '')) || [];
    SharedViews._lastRoster = roster;
    const rosterOpts = roster.map(r =>
      `<option value="${r.case_id}">${r.case_name || r.case_id}${r.planner_name ? ' — ' + r.planner_name : ''}</option>`
    ).join('');

    const buildCaseRow = (i) => `<tr id="mn-row-${i}">
      <td style="border:1px solid #ddd;padding:2px">
        <select id="mn-case-sel-${i}" onchange="SharedViews.populateCaseRow(${i})" style="width:100%;border:none;padding:4px;font-size:11px;background:transparent;box-sizing:border-box">
          <option value="">— Select case —</option>
          ${rosterOpts}
        </select>
      </td>
      <td style="border:1px solid #ddd;padding:2px">
        <input type="text" id="mn-contacts-${i}" placeholder="e.g. 4/1, 4/8" style="width:100%;border:none;padding:4px;font-size:11px;box-sizing:border-box">
      </td>
      <td style="border:1px solid #ddd;padding:2px">
        <input type="text" id="mn-not-seen-${i}" placeholder="Auto-fills on case select" style="width:100%;border:none;padding:4px;font-size:11px;box-sizing:border-box;color:#A32D2D">
      </td>
      <td style="border:1px solid #ddd;padding:2px">
        <select id="mn-risk-${i}" style="width:100%;border:none;padding:4px;font-size:11px;background:transparent">
          <option value="">—</option><option>High</option><option>Medium</option><option>Low</option>
        </select>
      </td>
      <td style="border:1px solid #ddd;padding:2px">
        <select id="mn-eng-${i}" style="width:100%;border:none;padding:4px;font-size:11px;background:transparent">
          <option value="">—</option><option>High</option><option>Average</option><option>Low / difficult to contact</option>
        </select>
      </td>
    </tr>`;

    UI.modal(`
      <div class="modal-title">Weekly Supervision Log</div>
      <div style="max-height:70vh;overflow-y:auto;padding-right:4px">

        <div class="grid-2" style="margin-bottom:10px">
          <div class="field"><label>Staff member *</label>
            <select id="mn-staff"><option value="">Select...</option>${staff.map(s=>`<option>${s.name}</option>`).join('')}</select>
          </div>
          <div class="field"><label>Date of supervision</label>
            <input type="date" id="mn-date" value="${today}" onchange="SharedViews.refreshAllCaseRows()">
          </div>
        </div>

        <div class="section-head" style="font-size:12px;margin:14px 0 8px">Case review table</div>
        <div style="font-size:11px;color:#888;margin-bottom:8px">
          Select a case from the dropdown — children not seen this month will auto-populate in red.
        </div>
        <div style="overflow-x:auto;margin-bottom:6px">
          <table style="width:100%;border-collapse:collapse;font-size:12px">
            <thead>
              <tr style="background:#f0f4f8">
                <th style="padding:6px 8px;text-align:left;border:1px solid #ddd;min-width:160px">Case name</th>
                <th style="padding:6px 8px;text-align:left;border:1px solid #ddd;min-width:100px">Dates of contact</th>
                <th style="padding:6px 8px;text-align:left;border:1px solid #ddd;min-width:140px">Children not seen this month</th>
                <th style="padding:6px 8px;text-align:left;border:1px solid #ddd;min-width:80px">Risk level</th>
                <th style="padding:6px 8px;text-align:left;border:1px solid #ddd;min-width:120px">Engagement level</th>
              </tr>
            </thead>
            <tbody id="mn-case-rows">
              ${[0,1,2,3,4,5].map(i => buildCaseRow(i)).join('')}
            </tbody>
          </table>
        </div>
        <button class="btn btn-xs" onclick="SharedViews.addCaseRow('${programId||''}')">+ Add row</button>
        <div style="font-size:10px;color:#aaa;margin-top:4px">Children not seen auto-fills based on the supervision date month.</div>

        <div class="section-head" style="font-size:12px;margin:14px 0 8px">Supervision discussion</div>

        <div class="field" style="margin-bottom:10px">
          <label>Highlights and major accomplishments</label>
          <textarea id="mn-highlights" rows="2" placeholder="Staff accomplishments and case wins this week..."></textarea>
        </div>
        <div class="field" style="margin-bottom:10px">
          <label>Administrative / staff challenges</label>
          <textarea id="mn-challenges" rows="2" placeholder="Any administrative or personal challenges..."></textarea>
        </div>
        <div class="field" style="margin-bottom:10px">
          <label>High risk cases</label>
          <textarea id="mn-highrisk" rows="2" placeholder="Cases requiring elevated attention or escalation..."></textarea>
        </div>
        <div class="field" style="margin-bottom:10px">
          <label>Cases with low engagement / children not seen (Preventive only)</label>
          <textarea id="mn-loweng" rows="2" placeholder="Cases where contact or child visits are below threshold..."></textarea>
        </div>
        <div class="field" style="margin-bottom:10px">
          <label>FASP due this month (Preventive only)</label>
          <textarea id="mn-fasp" rows="2" placeholder="FASPs coming due — case names and due dates..."></textarea>
        </div>
        <div class="field" style="margin-bottom:10px">
          <label>Families / children opened this week</label>
          <textarea id="mn-opened" rows="2" placeholder="New cases or children added to caseload..."></textarea>
        </div>
        <div class="field" style="margin-bottom:10px">
          <label>Cases closed / children discharged this week</label>
          <textarea id="mn-closed" rows="2" placeholder="Cases or children recently closed or discharged..."></textarea>
        </div>
        <div class="field" style="margin-bottom:10px">
          <label>Case updates from previous supervision</label>
          <textarea id="mn-updates" rows="2" placeholder="Follow-up on items from last supervision..."></textarea>
        </div>

        <div class="section-head" style="font-size:12px;margin:14px 0 8px">Staff wellbeing &amp; development</div>

        <div class="field" style="margin-bottom:10px">
          <label>How are you feeling in your role?</label>
          <textarea id="mn-feeling" rows="2" placeholder="Staff's reflection on their experience and wellbeing..."></textarea>
        </div>
        <div class="field" style="margin-bottom:10px">
          <label>Support needed</label>
          <textarea id="mn-support" rows="2" placeholder="Resources, training, or support the staff member needs..."></textarea>
        </div>
        <div class="field" style="margin-bottom:10px">
          <label>What are you curious about clinically / administratively?</label>
          <textarea id="mn-curious" rows="2" placeholder="Areas of interest or learning the staff wants to explore..."></textarea>
        </div>

        <div class="section-head" style="font-size:12px;margin:14px 0 8px">Follow-up</div>

        <div class="field" style="margin-bottom:10px">
          <label>Follow-ups for next supervision / director comments</label>
          <textarea id="mn-followup" rows="2" placeholder="Action items, reminders, and notes for next session..."></textarea>
        </div>
        <div class="field" style="margin-bottom:4px">
          <label>Action item (optional)</label>
          <input type="text" id="mn-action" placeholder="Specific task to be completed before next supervision">
        </div>
        <div class="grid-2" style="margin-bottom:4px">
          <div class="field"><label>Due date</label><input type="date" id="mn-due"></div>
          <div class="field"><label>Status</label><select id="mn-status"><option>Open</option><option>In Progress</option></select></div>
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn" data-cancel>Cancel</button>
        <button class="btn btn-p" data-confirm>Save supervision log</button>
      </div>`,
      async () => {
        const staffVal = document.getElementById('mn-staff')?.value;
        if (!staffVal) { UI.toast('Please select a staff member','error'); return; }

        // Collect case table rows using named inputs
        const caseRows = [];
        let rowIndex = 0;
        while (document.getElementById(`mn-case-sel-${rowIndex}`) !== null) {
          const sel      = document.getElementById(`mn-case-sel-${rowIndex}`);
          const contacts = document.getElementById(`mn-contacts-${rowIndex}`);
          const notSeen  = document.getElementById(`mn-not-seen-${rowIndex}`);
          const risk     = document.getElementById(`mn-risk-${rowIndex}`);
          const eng      = document.getElementById(`mn-eng-${rowIndex}`);
          const caseId   = sel?.value;
          const caseName = sel?.options[sel.selectedIndex]?.text?.split(' — ')[0]?.trim();
          if (caseId && caseName) {
            caseRows.push({
              case_id:    caseId,
              case_name:  caseName,
              contacts:   contacts?.value?.trim() || '',
              not_seen:   notSeen?.value?.trim()  || '',
              risk:       risk?.value || '',
              engagement: eng?.value  || '',
            });
          }
          rowIndex++;
        }

        // Build combined content from all sections
        const sections = [
          { label: 'Date of Supervision', val: document.getElementById('mn-date')?.value },
          { label: 'Case Review Table', val: caseRows.length ? JSON.stringify(caseRows) : '' },
          { label: 'Highlights and Major Accomplishments', val: document.getElementById('mn-highlights')?.value },
          { label: 'Administrative/Staff Challenges', val: document.getElementById('mn-challenges')?.value },
          { label: 'High Risk Cases', val: document.getElementById('mn-highrisk')?.value },
          { label: 'Low Engagement / Children Not Seen', val: document.getElementById('mn-loweng')?.value },
          { label: 'FASP Due This Month', val: document.getElementById('mn-fasp')?.value },
          { label: 'Families/Children Opened This Week', val: document.getElementById('mn-opened')?.value },
          { label: 'Cases Closed/Children Discharged', val: document.getElementById('mn-closed')?.value },
          { label: 'Case Updates from Previous Supervision', val: document.getElementById('mn-updates')?.value },
          { label: 'How Staff is Feeling in Role', val: document.getElementById('mn-feeling')?.value },
          { label: 'Support Needed', val: document.getElementById('mn-support')?.value },
          { label: 'Clinically/Administratively Curious About', val: document.getElementById('mn-curious')?.value },
          { label: 'Follow-ups for Next Supervision', val: document.getElementById('mn-followup')?.value },
        ];

        const content = sections
          .filter(s => s.val)
          .map(s => `[${s.label}]\n${s.val}`)
          .join('\n\n');

        if (!content) { UI.toast('Please fill in at least one section','error'); return; }

        await API.post('/api/supervision-log', {
          program_id:  programId,
          staff_name:  staffVal,
          domain:      'Weekly Supervision Log',
          content,
          action_item: document.getElementById('mn-action')?.value||null,
          due_date:    document.getElementById('mn-due')?.value||null,
          status:      document.getElementById('mn-status')?.value||'Open',
          entry_type:  'weekly_log',
        });
        UI.toast('Weekly supervision log saved','success');
        await SharedViews.renderSuplog(programId);
      }
    );
  },

  // ── SUPERVISORY NOTE ───────────────────────────────────────
  // ── MONTHLY SUPERVISORY NOTE ─────────────────────────────
  async renderSupnote(programId) {
    UI.setTitle('Monthly Supervisory Note');
    const roster  = await API.get('/api/roster?active=false'+(programId?`&program_id=${programId}`:''))||[];
    const preCase = sessionStorage.getItem('sn_case')||'';
    sessionStorage.removeItem('sn_case');

    // Month picker — default to current month
    const now = new Date();
    const monthVal = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;

    UI.setTopbar(`
      <select id="sn-case" onchange="SharedViews.refreshNote()" style="font-size:12px;padding:5px 9px;border:1px solid var(--mgray);border-radius:6px;min-width:200px">
        <option value="">— Select case —</option>
        ${roster.map(r=>`<option value="${r.case_id}" ${r.case_id===preCase?'selected':''}>${r.case_id}${r.case_name?' — '+r.case_name:''}</option>`).join('')}
      </select>
      <input type="month" id="sn-month" value="${monthVal}" onchange="SharedViews.refreshNote()" style="font-size:12px;padding:5px 9px;border:1px solid var(--mgray);border-radius:6px">
      <button class="btn btn-pu btn-sm" onclick="SharedViews.exportNote()">Export .docx</button>
      <button class="btn btn-sm" onclick="window.print()">Print PDF</button>`);

    UI.setContent(`
      <div style="display:grid;grid-template-columns:280px 1fr;gap:16px;align-items:start">
        <div>
          <div class="form-card" style="margin-bottom:10px">
            <div class="fc-title">Note settings</div>
            <div class="field" style="margin-bottom:10px"><label>Supervisor</label><input type="text" id="sn-sup" value="${Auth.user?.name||''}" oninput="SharedViews.refreshNote()"></div>
            <div class="field" style="margin-bottom:10px"><label>License / Credential</label><input type="text" id="sn-lic" placeholder="LMSW #XXXXXX"></div>
            <div class="field" style="margin-bottom:10px"><label>Title</label><input type="text" id="sn-title" value="Program Supervisor — Prevention Services"></div>
            <div style="border-top:1px solid #F0F2F5;padding-top:12px;margin-top:4px">
              <div style="font-size:11px;font-weight:600;color:#666;margin-bottom:8px">Discharge readiness</div>
              <div class="disc-toggle" style="margin-bottom:10px">
                <button class="disc-btn no" id="disc-no"  onclick="SharedViews.setDischarge(false)">Not ready</button>
                <button class="disc-btn"    id="disc-yes" onclick="SharedViews.setDischarge(true)">Ready</button>
              </div>
              <div class="field" style="margin-bottom:10px"><label>Discharge notes</label><textarea id="sn-disc" rows="3" oninput="SharedViews.refreshNote()"></textarea></div>
            </div>
            <div class="field" style="margin-bottom:10px"><label>Supervisor narrative</label><textarea id="sn-narr" rows="5" oninput="SharedViews.refreshNote()"></textarea></div>
            <div style="border-top:1px solid #F0F2F5;padding-top:12px">
              <div style="font-size:11px;font-weight:600;color:#666;margin-bottom:6px">E-signature</div>
              <div class="field"><label>Type full name to sign</label><input type="text" id="sn-sig" placeholder="${Auth.user?.name||'Your name'}" oninput="SharedViews.refreshNote()" style="font-style:italic;font-size:14px"></div>
            </div>
          </div>
          <button class="btn btn-pu btn-block" style="padding:11px;font-size:13px;margin-bottom:7px" onclick="SharedViews.exportNote()">Export as Word (.docx)</button>
          <button class="btn btn-block" style="padding:10px;font-size:12px;margin-bottom:7px" onclick="window.print()">Print / Save as PDF</button>
          <button class="btn btn-block" style="padding:9px;font-size:12px" onclick="SharedViews.refreshNote()">Refresh preview</button>
        </div>
        <div style="background:#fff;border:1px solid #E8ECF0;border-radius:10px;overflow:hidden">
          <div style="background:#1B3A5C;padding:14px 18px;display:flex;justify-content:space-between;align-items:center">
            <div><div style="font-size:13px;font-weight:600;color:#fff">Monthly Supervisory Case Note &amp; Compliance Report</div>
              <div style="font-size:11px;color:rgba(255,255,255,.4);margin-top:2px">Prevention Services &nbsp;|&nbsp; CONFIDENTIAL</div></div>
            <div style="text-align:right">
              <div style="font-size:10px;color:rgba(255,255,255,.4)">Case</div>
              <div style="font-size:14px;font-weight:700;color:#fff" id="np-caseid">${preCase||'—'}</div>
            </div>
          </div>
          <div style="max-height:780px;overflow-y:auto;padding:20px;font-size:12px;line-height:1.6;color:#333" id="np-body">
            <div class="empty-state">Select a case and month above to generate the monthly supervisory note.</div>
          </div>
          <div style="display:flex;align-items:center;gap:8px;padding:10px 16px;background:#F8F9FB;border-top:1px solid #E8ECF0">
            <span style="font-size:11px;color:#aaa" id="np-status">Select a case to begin</span>
            <div style="margin-left:auto;display:flex;gap:6px">
              <button class="btn btn-xs" onclick="window.print()">Print</button>
              <button class="btn btn-xs btn-pu" onclick="SharedViews.exportNote()">Export .docx</button>
            </div>
          </div>
        </div>
      </div>`);

    if (preCase) await this.refreshNote();
  },

  setDischarge(val) {
    SharedViews._discharge=val;
    document.getElementById('disc-yes').className='disc-btn'+(val?' yes':'');
    document.getElementById('disc-no').className='disc-btn'+(val?''  :' no');
    this.refreshNote();
  },

  async refreshNote() {
    const caseId   = document.getElementById('sn-case')?.value;
    const monthVal = document.getElementById('sn-month')?.value; // e.g. "2026-04"
    if (!caseId) return;
    document.getElementById('np-caseid').textContent = caseId;

    // Build date range from selected month
    let dateFrom = null, dateTo = null, monthLabel = '';
    if (monthVal) {
      const [y, m] = monthVal.split('-').map(Number);
      const lastDay = new Date(y, m, 0).getDate();
      dateFrom   = `${y}-${String(m).padStart(2,'0')}-01`;
      dateTo     = `${y}-${String(m).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;
      monthLabel = new Date(y, m-1, 1).toLocaleDateString('en-US',{month:'long',year:'numeric'});
    }

    const [entries, rosterAll, children, supLogs] = await Promise.all([
      API.get(`/api/entries?case_id=${caseId}&limit=100${dateFrom?'&date_from='+dateFrom:''}${dateTo?'&date_to='+dateTo:''}`)||[],
      API.get('/api/roster?active=false')||[],
      API.get(`/api/children/${caseId}`)||[],
      API.get(`/api/supervision-log?case_id=${caseId}`)||[],
    ]);

    // Filter supervision logs to this month
    const monthSupLogs = (supLogs||[]).filter(l => {
      if (!monthVal) return true;
      return l.created_at?.slice(0,7) === monthVal;
    });

    const rc     = (rosterAll||[]).find(r => r.case_id === caseId);
    const latest = (entries||[])[0] || null;

    // Aggregate scores across all entries in the month
    const validEntries = (entries||[]).filter(e => e.weekly_score != null);
    const avgWeekly    = validEntries.length ? Math.round(validEntries.reduce((a,e)=>a+(e.weekly_score||0),0)/validEntries.length) : null;
    const avgMonthly   = validEntries.length ? Math.round(validEntries.reduce((a,e)=>a+(e.monthly_score||0),0)/validEntries.length) : null;
    const avgQuarterly = validEntries.length ? Math.round(validEntries.reduce((a,e)=>a+(e.quarterly_score||0),0)/validEntries.length) : null;
    const avgLifetime  = validEntries.length ? Math.round(validEntries.reduce((a,e)=>a+(e.lifetime_score||0),0)/validEntries.length) : null;

    const names   = REQS.nameMap();
    const sup     = document.getElementById('sn-sup')?.value || Auth.user?.name || '';
    const sig     = document.getElementById('sn-sig')?.value || '';
    const narr    = document.getElementById('sn-narr')?.value || '';
    const disc    = document.getElementById('sn-disc')?.value || '';
    const dr      = SharedViews._discharge || false;
    const today   = new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'});
    const sc      = avgWeekly || 0;
    const rating  = sc>=90?'Strong':sc>=75?'Adequate':'Needs Attention';
    const rBg     = sc>=90?'#EAF3DE':sc>=75?'#FAEEDA':'#FCEBEB';
    const rClr    = sc>=90?'#27500A':sc>=75?'#633806':'#791F1F';
    const fasp    = latest?.fasp_status || 'Pending';
    const sf      = (entries||[]).some(e=>e.safety_flag==='Yes') ? 'Yes' : 'No';
    const today_  = new Date();
    const ageStr  = dob => { if(!dob)return'—'; const b=new Date(dob); const a=Math.floor((today_-b)/(365.25*24*60*60*1000)); return isNaN(a)?'—':a+' yrs'; };

    // Aggregate children seen across all entries this month
    const childSeenCounts = {};
    (entries||[]).forEach(e => {
      (e.children_seen||[]).forEach(cs => {
        if (!childSeenCounts[cs.cin]) childSeenCounts[cs.cin] = { seen: 0, not_seen: 0, reasons: [] };
        if (cs.seen === 'Yes') childSeenCounts[cs.cin].seen++;
        else { childSeenCounts[cs.cin].not_seen++; if(cs.reason_not_seen) childSeenCounts[cs.cin].reasons.push(cs.reason_not_seen); }
      });
    });

    // Best responses across all entries (most recent wins per req ID)
    const byId = {};
    [...(entries||[])].reverse().forEach(e => {
      (e.responses||[]).forEach(r => { byId[r.id] = r; });
    });

    const reqRow = id => {
      const r = byId[id] || {};
      return `<tr><td class="mono" style="color:#534AB7;font-size:10px">${id}</td>
        <td style="font-size:11px">${names[id]||id}</td>
        <td><span style="padding:2px 7px;border-radius:4px;font-size:11px;font-weight:700;background:${r.response==='Yes'?'#EAF3DE':r.response==='No'?'#FCEBEB':r.response==='Some but not all'?'#FAEEDA':'#F5F7FA'};color:${r.response==='Yes'?'#27500A':r.response==='No'?'#791F1F':r.response==='Some but not all'?'#633806':'#aaa'}">${r.response||'—'}</span></td>
        <td style="font-size:11px;color:#555">${r.notes||''}</td></tr>`;
    };

    // Parse weekly supervision logs for this case/month
    const parsedLogs = monthSupLogs.map(l => {
      const sections = SharedViews.parseLogContent(l.content) || {};
      return { date: l.created_at?.slice(0,10)||'', author: l.author_name||'', sections };
    });

    document.getElementById('np-body').innerHTML = `
      <div style="font-size:11px;font-weight:700;color:#0F6E56;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px;padding-bottom:4px;border-bottom:2px solid #0F6E56">Case identification — ${monthLabel||'All time'}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:3px 20px;margin-bottom:12px;font-size:12px">
        ${[['Case ID',caseId],['Report month',monthLabel||'All time'],['Case planner',rc?.planner_name||latest?.case_planner||'—'],['Supervisor',sup],['Program',rc?.program_id||'—'],['Case name',rc?.case_name||'—'],['FASP status',fasp],['Entries this month',(entries||[]).length]].map(([l,v])=>`<div><span style="color:#888;font-weight:600">${l}: </span><span>${v}</span></div>`).join('')}
      </div>

      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:10px">
        ${[['Avg Weekly',avgWeekly],['Avg Monthly',avgMonthly],['Avg Quarterly',avgQuarterly],['Lifetime',avgLifetime]].map(([l,v])=>`
          <div style="background:#1B3A5C;border-radius:6px;padding:8px;text-align:center">
            <div style="font-size:9px;color:rgba(255,255,255,.4);margin-bottom:3px;font-weight:600">${l}</div>
            <div style="font-size:18px;font-weight:700;color:${v!=null?(v>=90?'#5DCAA5':v>=75?'#FAC775':'#F09595'):'#A0C4E8'}">${v!=null?v+'%':'—'}</div>
          </div>`).join('')}
      </div>
      <div style="padding:7px 12px;border-radius:6px;background:${rBg};color:${rClr};font-size:12px;font-weight:700;text-align:center;margin-bottom:14px">Monthly Rating: ${sc>0?rating:'No entries this month'}</div>

      ${(entries||[]).length>1?`
      <div style="font-size:11px;font-weight:700;color:#0F6E56;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;padding-bottom:4px;border-bottom:2px solid #0F6E56">Weekly entries this month</div>
      <table style="width:100%;border-collapse:collapse;font-size:11px;margin-bottom:14px">
        <thead><tr style="background:#1B3A5C">${['Week ending','Submitted by','Weekly','Monthly','Safety','FASP'].map(h=>`<th style="color:#fff;padding:5px 8px;text-align:left;font-size:10px">${h}</th>`).join('')}</tr></thead>
        <tbody>${(entries||[]).map(e=>`<tr style="border-bottom:1px solid #F0F2F5">
          <td style="padding:5px 8px;font-family:monospace">${e.week_ending||'—'}</td>
          <td style="padding:5px 8px">${e.submitted_name||e.case_planner||'—'}</td>
          <td style="padding:5px 8px">${e.weekly_score!=null?Math.round(e.weekly_score)+'%':'—'}</td>
          <td style="padding:5px 8px">${e.monthly_score!=null?Math.round(e.monthly_score)+'%':'—'}</td>
          <td style="padding:5px 8px"><span style="color:${e.safety_flag==='Yes'?'#A32D2D':'#aaa'}">${e.safety_flag==='Yes'?'⚠ Flag':'—'}</span></td>
          <td style="padding:5px 8px">${e.fasp_status||'—'}</td>
        </tr>`).join('')}</tbody>
      </table>`:''}

      ${children.length>0?`
      <div style="font-size:11px;font-weight:700;color:#0F6E56;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;padding-bottom:4px;border-bottom:2px solid #0F6E56">Children — monthly contact summary</div>
      <table style="width:100%;border-collapse:collapse;font-size:11px;margin-bottom:14px">
        <thead><tr style="background:#1B3A5C">${['Child Name','CIN','Age','Times seen','Times not seen','Reasons not seen','Compliance'].map(h=>`<th style="color:#fff;padding:5px 8px;text-align:left;font-size:10px">${h}</th>`).join('')}</tr></thead>
        <tbody>${children.map(c=>{
          const cs = childSeenCounts[c.cin] || { seen:0, not_seen:0, reasons:[] };
          const compliant = cs.seen >= 2;
          return `<tr style="border-bottom:1px solid #F0F2F5">
            <td style="padding:5px 8px;font-weight:600">${c.child_name||'—'}</td>
            <td style="padding:5px 8px;font-family:monospace;font-size:10px">${c.cin||'—'}</td>
            <td style="padding:5px 8px">${ageStr(c.dob)}</td>
            <td style="padding:5px 8px;text-align:center;font-weight:700;color:#0F6E56">${cs.seen}</td>
            <td style="padding:5px 8px;text-align:center;font-weight:700;color:${cs.not_seen>0?'#A32D2D':'#aaa'}">${cs.not_seen}</td>
            <td style="padding:5px 8px;font-size:11px;color:#888">${cs.reasons.length?cs.reasons.join('; '):'—'}</td>
            <td style="padding:5px 8px"><span style="padding:2px 7px;border-radius:4px;font-size:11px;font-weight:700;background:${compliant?'#EAF3DE':'#FCEBEB'};color:${compliant?'#27500A':'#791F1F'}">${compliant?'Compliant':'Non-compliant'}</span></td>
          </tr>`;
        }).join('')}</tbody>
      </table>`:''}

      ${parsedLogs.length>0?`
      <div style="font-size:11px;font-weight:700;color:#0F6E56;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;padding-bottom:4px;border-bottom:2px solid #0F6E56">Weekly supervision logs this month (${parsedLogs.length})</div>
      ${parsedLogs.map(log => {
        const s = log.sections;
        const sectionOrder = ['Highlights and Major Accomplishments','Administrative/Staff Challenges','High Risk Cases','Low Engagement / Children Not Seen','FASP Due This Month','Families/Children Opened This Week','Cases Closed/Children Discharged','Case Updates from Previous Supervision','How Staff is Feeling in Role','Support Needed','Clinically/Administratively Curious About','Follow-ups for Next Supervision'];
        return `<div style="border:1px solid #E8ECF0;border-radius:8px;padding:12px;margin-bottom:10px">
          <div style="font-size:11px;font-weight:700;color:#1B3A5C;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid #f0f4f8">
            Supervision log — ${log.sections['Date of Supervision']||log.date} &nbsp;|&nbsp; <span style="color:#888;font-weight:400">${log.author}</span>
          </div>
          ${sectionOrder.filter(k=>s[k]).map(k=>`
            <div style="margin-bottom:8px">
              <div style="font-size:10px;font-weight:700;color:#534AB7;text-transform:uppercase;letter-spacing:0.4px;margin-bottom:2px">${k}</div>
              <div style="font-size:12px;color:#333;line-height:1.5">${(s[k]||'').split('\n').join('<br>')}</div>
            </div>`).join('')}
        </div>`;
      }).join('')}`:''}

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
        <div style="padding:10px;border-radius:8px;background:${sf==='Yes'?'#FCEBEB':'#EAF3DE'}"><div style="font-size:10px;font-weight:700;color:${sf==='Yes'?'#791F1F':'#27500A'};margin-bottom:3px">Safety flag this month</div><div style="font-size:18px;font-weight:700;color:${sf==='Yes'?'#791F1F':'#27500A'}">${sf==='Yes'?'YES — Action required':'None'}</div></div>
        <div style="padding:10px;border-radius:8px;background:${fasp==='Overdue'?'#FCEBEB':fasp==='Current'?'#EAF3DE':'#FAEEDA'}"><div style="font-size:10px;font-weight:700;color:${fasp==='Overdue'?'#791F1F':fasp==='Current'?'#27500A':'#633806'};margin-bottom:3px">FASP status</div><div style="font-size:18px;font-weight:700;color:${fasp==='Overdue'?'#791F1F':fasp==='Current'?'#27500A':'#633806'}">${fasp}</div></div>
      </div>

      <div style="font-size:11px;font-weight:700;color:#0F6E56;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;padding-bottom:4px;border-bottom:2px solid #0F6E56">Scorecard compliance — ${monthLabel||'All entries'}</div>
      <table style="width:100%;border-collapse:collapse;font-size:11px;margin-bottom:12px">
        <thead><tr style="background:#1B3A5C">${['ID','Requirement','Response','Notes'].map(h=>`<th style="color:#fff;padding:5px 8px;text-align:left;font-weight:600;font-size:10px">${h}</th>`).join('')}</tr></thead>
        <tbody>${REQS.weekly.map(r=>reqRow(r.id)).join('')}</tbody>
      </table>
      <table style="width:100%;border-collapse:collapse;font-size:11px;margin-bottom:12px">
        <thead><tr style="background:#1B3A5C">${['ID','Requirement','Response','Notes'].map(h=>`<th style="color:#fff;padding:5px 8px;text-align:left;font-weight:600;font-size:10px">${h}</th>`).join('')}</tr></thead>
        <tbody>${REQS.monthly.map(r=>reqRow(r.id)).join('')}</tbody>
      </table>

      <div style="font-size:11px;font-weight:700;color:#0F6E56;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;padding-bottom:4px;border-bottom:2px solid #0F6E56">Discharge readiness</div>
      <div style="display:grid;grid-template-columns:70px 1fr;gap:12px;background:#F8F9FB;border-radius:8px;padding:12px;margin-bottom:12px;align-items:center">
        <div style="width:70px;height:70px;border-radius:7px;display:flex;flex-direction:column;align-items:center;justify-content:center;background:${dr?'#EAF3DE':'#FCEBEB'}">
          <div style="font-size:9px;font-weight:700;color:${dr?'#27500A':'#791F1F'}">READY</div>
          <div style="font-size:26px;font-weight:800;color:${dr?'#27500A':'#791F1F'}">${dr?'YES':'NO'}</div>
        </div>
        <div style="font-size:12px;color:#333;font-style:italic">${disc||'No discharge notes.'}</div>
      </div>

      <div style="font-size:11px;font-weight:700;color:#0F6E56;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;padding-bottom:4px;border-bottom:2px solid #0F6E56">Supervisor narrative</div>
      <div style="font-size:12px;color:#333;font-style:italic;line-height:1.6;padding:10px 12px;background:#F8F9FB;border-radius:6px;margin-bottom:12px">${narr||'No narrative entered.'}</div>

      <div style="font-size:11px;font-weight:700;color:#0F6E56;text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px;padding-bottom:4px;border-bottom:2px solid #0F6E56">E-signature</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        ${[['Supervisor signature',sig||''],['Date',today],['Printed name',sup||''],['License',document.getElementById('sn-lic')?.value||''],['Case planner acknowledgment',''],['Date acknowledged','']].map(([l,v])=>`
          <div><div style="border-top:1.5px solid #1B3A5C;padding-top:3px;margin-top:24px;font-size:15px;font-style:italic;font-family:Georgia,serif;color:#222;min-height:22px">${v}</div>
          <div style="font-size:10px;color:#aaa;margin-top:2px">${l}</div></div>`).join('')}
      </div>
      <div style="margin-top:14px;padding-top:10px;border-top:1px solid #E8ECF0;font-size:10px;color:#ccc;font-style:italic">Generated: ${today} | Period: ${monthLabel||'All time'} | Prevention Services Scorecard | Confidential</div>
    `;

    const statusEl = document.getElementById('np-status');
    if (statusEl) statusEl.textContent = entries.length
      ? `Ready to export — ${caseId} | ${monthLabel} | ${entries.length} entries`
      : `No entries found for ${monthLabel}`;
  },

    async exportNote() {
    const caseId=document.getElementById('sn-case')?.value;
    if (!caseId){UI.toast('Please select a case first','error');return;}
    try {
      UI.toast('Generating Word document...','',2000);
      await API.download('/api/export/supervisory-note',{
        caseId,
        supervisorName:  document.getElementById('sn-sup')?.value||'',
        supervisorLicense:document.getElementById('sn-lic')?.value||'',
        supervisorTitle: document.getElementById('sn-title')?.value||'',
        narrative:       document.getElementById('sn-narr')?.value||'',
        dischargeReady:  SharedViews._discharge||false,
        dischargeNotes:  document.getElementById('sn-disc')?.value||'',
        signature:       document.getElementById('sn-sig')?.value||'',
        signatureDate:   new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}),
      },`Supervisory_Note_${caseId}_${new Date().toISOString().slice(0,10)}.docx`);
      UI.toast('Word document downloaded','success');
    } catch(e){ UI.toast('Export failed: '+e.message,'error'); }
  },

  // ── ALERTS ────────────────────────────────────────────────
  async renderAlerts(programId) {
    UI.setTitle('Alerts');
    const [entries, notSeen] = await Promise.all([
      API.get('/api/entries/latest'+(programId?`?program_id=${programId}`:''))||[],
      API.get('/api/children-not-seen'+(programId?`?program_id=${programId}`:''))||[],
    ]);
    const alerts=[];
    (entries||[]).forEach(e=>{
      if(e.safety_flag==='Yes') alerts.push({t:'Safety plan missing — '+e.case_id,b:`Safety concerns raised but plan not documented. Planner: ${e.case_planner||'—'}.`,a:'Complete safety plan immediately.',sev:'critical'});
      if(e.fasp_status==='Overdue') alerts.push({t:'FASP overdue — '+e.case_id,b:`FASP not completed. Planner: ${e.case_planner||'—'}.`,a:'Submit to ACS this week.',sev:'critical'});
    });
    if((notSeen||[]).length>0){
      alerts.push({t:`${notSeen.length} children not seen this week`,b:`Children across ${[...new Set(notSeen.map(c=>c.case_id))].length} cases were not seen this week.`,a:'Review and document reason for each child not seen.',sev:'warn'});
    }
    UI.setTopbar(`<span class="wpill">${alerts.length} alert${alerts.length!==1?'s':''} — ${alerts.filter(a=>a.sev==='critical').length} critical</span>`);
    UI.setContent(alerts.length?alerts.map(a=>`
      <div class="alert-item ${a.sev!=='critical'?'warn':''}">
        <div class="alert-title">${a.t}</div>
        <div class="alert-body">${a.b}</div>
        <div class="alert-action">Required action: ${a.a}</div>
      </div>`).join(''):'<div class="empty-state">No active alerts — all cases in good standing.</div>');
  },

  // ── ROSTER ────────────────────────────────────────────────
  async renderRoster(programId) {
    UI.setTitle('Case Roster');
    const roster=await API.get('/api/roster?active=false'+(programId?`&program_id=${programId}`:''))||[];
    UI.setTopbar(`<button class="btn btn-p btn-sm" onclick="SharedViews.addCase('${programId||''}')">+ Add case</button>`);
    SharedViews._rosterProgramId = programId;
    UI.setContent(`
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Case ID</th><th>Case Name (HOH)</th><th>Case Planner</th><th>Program / Unit</th><th>Open Date</th><th>End Date</th><th>Children</th><th>Status</th><th></th></tr></thead>
          <tbody>${roster.map(r=>`<tr>
            <td class="mono bold" style="color:#1B3A5C">${r.case_id}</td>
            <td>${r.case_name||'—'}</td>
            <td>${r.planner_name||'—'}</td>
            <td style="font-size:12px">${r.program_id||'—'}${r.manually_assigned?' <span class="badge badge-amber">🔒 Manual</span>':''}</td>
            <td style="font-size:12px;color:#aaa">${r.open_date||'—'}</td>
            <td style="font-size:12px;color:#aaa">${r.end_date||'—'}</td>
            <td style="text-align:center">${r.children_count||0}</td>
            <td>${r.active?'<span class="badge badge-green">Active</span>':'<span class="badge badge-gray">Ended</span>'}</td>
            <td><button class="btn btn-xs" onclick="SharedViews.reassignCase('${r.case_id}')">Reassign</button></td>
          </tr>`).join('')}</tbody>
        </table>
      </div>`);
    SharedViews._rosterData = roster;
  },

  async reassignCase(caseId) {
    const row      = (SharedViews._rosterData||[]).find(r => r.case_id === caseId) || {};
    const programs = await API.get('/api/programs') || [];
    UI.modal(`
      <div class="modal-title">Reassign case — <span class="mono" style="color:#1B3A5C">${caseId}</span></div>
      <div style="font-size:12px;color:#633806;margin-bottom:14px;padding:8px 12px;background:#FAEEDA;border-radius:6px;border-left:3px solid #EF9F27">
        Manual override — this assignment will be locked with a 🔒 badge and will NOT be changed by the weekly CSV upload.
      </div>
      <div class="field" style="margin-bottom:10px">
        <label>New case planner</label>
        <input type="text" id="ra-planner" value="${row.planner_name||''}" placeholder="Worker full name">
      </div>
      <div class="field" style="margin-bottom:10px">
        <label>New program / unit</label>
        <select id="ra-program">
          ${programs.map(p=>`<option value="${p.id}" ${p.id===row.program_id?'selected':''}>${p.name||p.id}</option>`).join('')}
        </select>
      </div>
      <div class="field" style="margin-bottom:10px">
        <label>Supervisor (optional)</label>
        <input type="text" id="ra-supervisor" value="${row.supervisor_name||''}" placeholder="Supervisor name">
      </div>
      <div class="modal-footer">
        <button class="btn" data-cancel>Cancel</button>
        <button class="btn btn-p" data-confirm>Confirm reassignment</button>
      </div>`,
      async () => {
        const planner    = document.getElementById('ra-planner')?.value?.trim();
        const program    = document.getElementById('ra-program')?.value;
        const supervisor = document.getElementById('ra-supervisor')?.value?.trim();
        if (!planner) { UI.toast('Case planner name is required', 'error'); return; }
        if (!program)  { UI.toast('Program / unit is required', 'error'); return; }
        try {
          await API.post(`/api/roster/${caseId}/reassign`, {
            planner_name: planner, program_id: program, supervisor_name: supervisor,
          });
          UI.toast(`Case ${caseId} reassigned to ${planner}`, 'success');
          await SharedViews.renderRoster(SharedViews._rosterProgramId);
        } catch(e) { UI.toast('Reassignment failed: ' + e.message, 'error'); }
      }
    );
  },

  addCase(programId) {
    UI.modal(`
      <div class="modal-title">Add case to roster</div>
      <div class="grid-2">
        <div class="field"><label>CNNX Case ID</label><input type="text" id="ac-id" placeholder="QNS-2024-###"></div>
        <div class="field"><label>Case name (HOH)</label><input type="text" id="ac-name" placeholder="Last, First"></div>
      </div>
      <div class="grid-2">
        <div class="field"><label>Case planner</label><input type="text" id="ac-pl"></div>
        <div class="field"><label>Open date</label><input type="date" id="ac-date"></div>
      </div>
      <div class="modal-footer">
        <button class="btn" data-cancel>Cancel</button>
        <button class="btn btn-p" data-confirm>Add case</button>
      </div>`,
      async () => {
        const caseId=document.getElementById('ac-id')?.value?.trim();
        if(!caseId){UI.toast('Case ID required','error');return;}
        await API.post('/api/roster',{
          case_id:caseId, case_name:document.getElementById('ac-name')?.value,
          program_id:programId||Auth.user?.program_id,
          planner_name:document.getElementById('ac-pl')?.value,
          open_date:document.getElementById('ac-date')?.value,
        });
        UI.toast('Case added','success');
        await SharedViews.renderRoster(programId);
      }
    );
  },
};