const ExecViews = {

  _currentTab:  'weekly',
  _childrenTab: 'weekly',
  _dateFrom:    null,
  _dateTo:      null,
  _programId:   null,

  getDatePreset(preset) {
    const now = new Date();
    const y   = now.getFullYear();
    const m   = now.getMonth();
    const d   = now.getDate();
    const pad = n => String(n).padStart(2,'0');
    const fmt = dt => `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())}`;
    const today = fmt(now);
    const dayOfWeek = (now.getDay() + 6) % 7;
    const weekStart = fmt(new Date(y, m, d - dayOfWeek));
    const weekEnd   = fmt(new Date(y, m, d - dayOfWeek + 6));
    const qStart    = [0,3,6,9][Math.floor(m/3)];
    switch(preset) {
      case 'week':    return { from: weekStart, to: weekEnd };
      case 'month':   return { from: `${y}-${pad(m+1)}-01`, to: today };
      case 'quarter': return { from: `${y}-${pad(qStart+1)}-01`, to: today };
      case 'year':    return { from: `${y}-01-01`, to: today };
      default:        return { from: null, to: null };
    }
  },

  async dashboard(data) {
    const dateFrom = ExecViews._dateFrom;
    const dateTo   = ExecViews._dateTo;
    const progId   = ExecViews._programId;

    let url = '/api/dashboard?_=1';
    if (progId)   url += `&program_id=${encodeURIComponent(progId)}`;
    if (dateFrom) url += `&date_from=${dateFrom}`;
    if (dateTo)   url += `&date_to=${dateTo}`;

    const d     = data || await API.get(url) || {};
    const progs = d.programs || [];
    const s     = d.scores   || {};
    const dr    = d.dateRange || {};

    const today  = new Date().toISOString().slice(0,10);
    const fromVal = dateFrom || (dr.earliest || `${today.slice(0,4)}-01-01`);
    const toVal   = dateTo   || today;

    UI.setTopbar(`
      <select id="ex-prog" onchange="ExecViews.applyFilters()" style="font-size:12px;padding:5px 9px;border:1px solid var(--mgray);border-radius:6px">
        <option value="">All programs</option>
        ${progs.map(p=>`<option value="${p.id}" ${p.id===progId?'selected':''}>${p.name}</option>`).join('')}
      </select>
      <div style="display:flex;align-items:center;gap:3px">
        <button class="btn btn-xs" onclick="ExecViews.setPreset('week')">Week</button>
        <button class="btn btn-xs" onclick="ExecViews.setPreset('month')">Month</button>
        <button class="btn btn-xs" onclick="ExecViews.setPreset('quarter')">Quarter</button>
        <button class="btn btn-xs" onclick="ExecViews.setPreset('year')">Year</button>
        <button class="btn btn-xs" onclick="ExecViews.setPreset('all')">All time</button>
      </div>
      <input type="date" id="ex-from" value="${fromVal}" onchange="ExecViews.applyFilters()" style="font-size:12px;padding:5px 9px;border:1px solid var(--mgray);border-radius:6px">
      <span style="color:#aaa;font-size:12px">to</span>
      <input type="date" id="ex-to" value="${toVal}" onchange="ExecViews.applyFilters()" style="font-size:12px;padding:5px 9px;border:1px solid var(--mgray);border-radius:6px">
      <button class="btn btn-navy btn-sm" onclick="ExecViews.exportData()">Export CSV</button>`);

    const totalCases    = d.totalCases    || 0;
    const totalChildren = d.totalChildren || 0;
    const totalFlags    = d.safetyFlags   || 0;
    const totalFasp     = d.faspOver      || 0;
    const avgWs         = s.weekly_avg != null ? s.weekly_avg : (s.weekly || null);
    const dateLabel     = dateFrom || dateTo ? `${dateFrom||'Start'} → ${dateTo||'Today'}` : 'All time';

    UI.setContent(`
      <div style="font-size:11px;color:#888;margin-bottom:10px;text-align:right">
        Showing: <strong style="color:#1B3A5C">${dateLabel}</strong>
        ${dr.earliest?` &nbsp;|&nbsp; Earliest data: <strong>${dr.earliest}</strong>`:''}
      </div>
      <div class="metric-grid" style="grid-template-columns:repeat(7,minmax(0,1fr))">
        <div class="mc"><div class="mc-label">Avg weekly score</div><div class="mc-value" style="color:${UI.scoreColor(avgWs)}">${avgWs!=null?avgWs+'%':'—'}</div><div class="mc-sub">${progs.length||'All'} programs</div></div>
        <div class="mc"><div class="mc-label">Active cases</div><div class="mc-value">${totalCases}</div><div class="mc-sub">All programs</div></div>
        <div class="mc"><div class="mc-label">Not reviewed this week</div><div class="mc-value" style="color:${(d.casesNotReviewedWeek||0)>0?'#A32D2D':'#0F6E56'}">${d.casesNotReviewedWeek||0}</div><div class="mc-sub">No entry this week</div></div>
        <div class="mc"><div class="mc-label">Not reviewed this month</div><div class="mc-value" style="color:${(d.casesNotReviewedMonth||0)>0?'#BA7517':'#0F6E56'}">${d.casesNotReviewedMonth||0}</div><div class="mc-sub">No entry this month</div></div>
        <div class="mc"><div class="mc-label">Children not seen</div><div class="mc-value" style="color:${(d.notSeenCount||0)>0?'#A32D2D':'#0F6E56'}">${d.notSeenCount||0}</div><div class="mc-sub">This month</div></div>
        <div class="mc"><div class="mc-label">Safety flags</div><div class="mc-value" style="color:#A32D2D">${totalFlags}</div><div class="mc-sub">${dateLabel}</div></div>
        <div class="mc"><div class="mc-label">FASP overdue</div><div class="mc-value" style="color:#BA7517">${totalFasp}</div><div class="mc-sub">${dateLabel}</div></div>
      </div>
      <div class="chart-grid" style="margin-bottom:14px">
        <div class="card"><div class="card-title">Program compliance</div>
          <div style="position:relative;height:200px"><canvas id="c-exec-prog">Program data.</canvas></div></div>
        <div class="card"><div class="card-title">Score trend</div>
          <div style="position:relative;height:200px"><canvas id="c-exec-trend">Trend data.</canvas></div></div>
      </div>
      <div class="section-head">Submission activity</div>
      <div id="submission-stats-section"><div class="loading" style="padding:12px">Loading submission data...</div></div>
      <div class="section-head" style="margin-top:18px">Children compliance</div>
      <div id="children-compliance-section"></div>
      <div class="section-head" style="margin-top:18px">All programs</div>
      <div id="prog-list"></div>
    `);

    ExecViews.renderSubmissionStats(progId || null, dateFrom, dateTo);
    ExecViews.renderChildrenCompliance(progId || null);

    if (progs.length) {
      UI.mkChart('c-exec-prog', {
        type:'bar',
        data:{labels:progs.map(p=>p.name.split(' ').slice(0,2).join(' ')),datasets:[{label:'Weekly %',data:progs.map(p=>p.ws||0),backgroundColor:progs.map(p=>(p.ws||0)>=90?'#1D9E75':(p.ws||0)>=75?'#EF9F27':'#E24B4A'),borderRadius:5}]},
        options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{min:0,max:100,ticks:{callback:v=>v+'%',font:{size:10}}},x:{ticks:{font:{size:10},maxRotation:30}}}}
      });
    }
    const trend = d.trend || [];
    if (trend.length) UI.trendChart('c-exec-trend', trend, '#1D9E75');

    const plist = document.getElementById('prog-list');
    if (plist) {
      plist.innerHTML = progs.map(p=>`
        <div class="prog-card" id="pc-${p.id}" onclick="ExecViews.toggleProg('${p.id}')">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <div>
              <div style="font-size:14px;font-weight:600;color:#1B3A5C">${p.name}</div>
              <div style="font-size:11px;color:#888;margin-top:2px">${p.borough||'—'} | ${p.modality||'—'} | ${p.cases||0} cases | ${p.children||0} children</div>
            </div>
            <div style="display:flex;align-items:center;gap:8px">
              ${UI.badge(p.ws)}<span style="font-size:11px;color:#888">weekly</span>
              ${(p.flags||0)>0?`<span class="badge badge-red">${p.flags} flag${p.flags>1?'s':''}</span>`:''}
              ${(p.fasp||0)>0?`<span class="badge badge-amber">${p.fasp} FASP</span>`:''}
            </div>
          </div>
          <div class="prog-bar" style="margin-top:8px"><div class="prog-fill" style="width:${p.ws||0}%;background:${(p.ws||0)>=90?'#1D9E75':(p.ws||0)>=75?'#EF9F27':'#E24B4A'}"></div></div>
          <div class="prog-drill" id="pd-${p.id}" style="display:none">
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:10px 0">
              ${[['Monthly',p.ms],['Quarterly',p.qs],['Lifetime',p.ls],['Children',p.children||0]].map(([l,v])=>`
                <div style="text-align:center"><div style="font-size:10px;color:#888;margin-bottom:2px;font-weight:600">${l}</div>
                <div style="font-size:16px;font-weight:700;color:${typeof v==='number'&&l!=='Children'?UI.scoreColor(v):'#1B3A5C'}">${typeof v==='number'&&l!=='Children'?(v||'—')+'%':v||'—'}</div></div>`).join('')}
            </div>
            <button class="btn btn-sm" onclick="event.stopPropagation();ExecViews.renderChildrenCompliance('${p.id}')">View children compliance</button>
          </div>
        </div>`).join('');
    }
  },

  async renderSubmissionStats(programId, dateFrom, dateTo) {
    const el = document.getElementById('submission-stats-section');
    if (!el) return;

    let url = '/api/submission-stats?_=1';
    if (programId) url += `&program_id=${encodeURIComponent(programId)}`;
    if (dateFrom)  url += `&date_from=${dateFrom}`;
    if (dateTo)    url += `&date_to=${dateTo}`;

    const data = await API.get(url) || {};
    const weekly  = data.weeklySubmissions || [];
    const totals  = data.totals || {};

    // Active tab state
    ExecViews._subTab = ExecViews._subTab || 'weekly';

    el.innerHTML = `
      <div class="metric-grid-3" style="margin-bottom:14px">
        <div class="mc"><div class="mc-label">Total entries submitted</div><div class="mc-value" style="color:#1B3A5C">${totals.total_entries||0}</div><div class="mc-sub">${dateFrom||dateTo?'In date range':'All time'}</div></div>
        <div class="mc"><div class="mc-label">Cases with entries</div><div class="mc-value" style="color:#0F6E56">${totals.cases_with_entries||0}</div><div class="mc-sub">of all active cases</div></div>
        <div class="mc"><div class="mc-label">Weeks covered</div><div class="mc-value" style="color:#534AB7">${totals.weeks_covered||0}</div><div class="mc-sub">submission weeks</div></div>
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div class="tab-bar" style="margin-bottom:0">
          <div class="tab active" onclick="ExecViews.switchSubTab('weekly',this)">Weekly view</div>
          <div class="tab" onclick="ExecViews.switchSubTab('monthly',this)">Monthly rollup</div>
          <div class="tab" onclick="ExecViews.switchSubTab('quarterly',this)">Quarterly rollup</div>
        </div>
      </div>

      <div class="card" style="margin-bottom:14px">
        <div style="position:relative;height:220px"><canvas id="c-submissions" role="img" aria-label="Submission activity chart">Submission data.</canvas></div>
      </div>

      <div id="submission-table-section"></div>
    `;

    ExecViews._subData = weekly;
    ExecViews.renderSubChart('weekly');
    ExecViews.renderSubTable('weekly');
  },

  groupByPeriod(weekly, period) {
    const grouped = {};
    weekly.forEach(w => {
      const date = new Date(w.week_ending);
      let key;
      if (period === 'monthly') {
        key = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;
      } else if (period === 'quarterly') {
        const q = Math.floor(date.getMonth()/3) + 1;
        key = `${date.getFullYear()} Q${q}`;
      } else {
        key = w.week_ending;
      }
      if (!grouped[key]) grouped[key] = { label: key, submissions: 0, unique_cases: 0 };
      grouped[key].submissions  += parseInt(w.submissions  || 0);
      grouped[key].unique_cases += parseInt(w.unique_cases || 0);
    });
    return Object.values(grouped).sort((a,b) => a.label.localeCompare(b.label));
  },

  renderSubChart(period) {
    const data    = ExecViews.groupByPeriod(ExecViews._subData || [], period);
    const labels  = data.map(d => d.label);
    const counts  = data.map(d => d.submissions);
    const maxVal  = Math.max(...counts, 1);

    if (window._subChart) { window._subChart.destroy(); }
    const ctx = document.getElementById('c-submissions');
    if (!ctx) return;

    window._subChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Entries submitted',
          data: counts,
          backgroundColor: counts.map(v =>
            v >= maxVal * 0.8 ? '#1D9E75' :
            v >= maxVal * 0.5 ? '#534AB7' : '#E8ECF0'
          ),
          borderRadius: 4,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => `${ctx.parsed.y} entries`,
              afterLabel: ctx => {
                const d = data[ctx.dataIndex];
                return `${d.unique_cases} unique cases`;
              }
            }
          }
        },
        scales: {
          y: { beginAtZero: true, ticks: { font: { size: 10 }, stepSize: 1 } },
          x: { ticks: { font: { size: 10 }, maxRotation: 45 } }
        }
      }
    });
  },

  renderSubTable(period) {
    const tableEl = document.getElementById('submission-table-section');
    if (!tableEl) return;
    const data = ExecViews.groupByPeriod(ExecViews._subData || [], period);
    if (!data.length) {
      tableEl.innerHTML = '<div class="empty-state">No submissions in this period.</div>';
      return;
    }
    const total = data.reduce((a,d) => a + d.submissions, 0);
    tableEl.innerHTML = `
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr>
            <th>${period === 'weekly' ? 'Week ending' : period === 'monthly' ? 'Month' : 'Quarter'}</th>
            <th>Entries submitted</th>
            <th>Unique cases</th>
            <th>% of total</th>
            <th>Activity</th>
          </tr></thead>
          <tbody>
            ${data.slice().reverse().map(d => {
              const pct = total ? Math.round(d.submissions / total * 100) : 0;
              const bar = `<div style="background:#E8ECF0;border-radius:3px;height:8px;width:100%"><div style="background:${pct>50?'#1D9E75':pct>25?'#534AB7':'#EF9F27'};border-radius:3px;height:8px;width:${pct}%"></div></div>`;
              return `<tr>
                <td class="mono" style="color:#1B3A5C;font-weight:600">${d.label}</td>
                <td style="text-align:center;font-weight:600">${d.submissions}</td>
                <td style="text-align:center">${d.unique_cases}</td>
                <td style="text-align:center">${pct}%</td>
                <td style="min-width:80px">${bar}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;
  },

  switchSubTab(period, el) {
    document.querySelectorAll('#submission-stats-section .tab').forEach(t => t.classList.remove('active'));
    el?.classList.add('active');
    ExecViews._subTab = period;
    ExecViews.renderSubChart(period);
    ExecViews.renderSubTable(period);
  },

  setPreset(preset) {
    const { from, to } = ExecViews.getDatePreset(preset);
    ExecViews._dateFrom = from;
    ExecViews._dateTo   = to;
    const fromEl = document.getElementById('ex-from');
    const toEl   = document.getElementById('ex-to');
    if (fromEl) fromEl.value = from || '';
    if (toEl)   toEl.value   = to   || '';
    ExecViews.dashboard();
  },

  applyFilters() {
    ExecViews._dateFrom  = document.getElementById('ex-from')?.value  || null;
    ExecViews._dateTo    = document.getElementById('ex-to')?.value    || null;
    ExecViews._programId = document.getElementById('ex-prog')?.value  || null;
    ExecViews.dashboard();
  },

  exportData() {
    let url = '/api/export/csv?mode=full';
    if (ExecViews._programId) url += `&program_id=${encodeURIComponent(ExecViews._programId)}`;
    if (ExecViews._dateFrom)  url += `&date_from=${ExecViews._dateFrom}`;
    if (ExecViews._dateTo)    url += `&date_to=${ExecViews._dateTo}`;
    window.open(url, '_blank');
  },

  async renderChildrenCompliance(programId) {
    const el = document.getElementById('children-compliance-section');
    if (!el) return;
    el.innerHTML = '<div class="loading" style="padding:20px">Loading...</div>';
    const now   = new Date();
    const month = now.getMonth() + 1;
    const year  = now.getFullYear();
    const we    = now.toISOString().slice(0,10);
    const pp    = programId ? `?program_id=${encodeURIComponent(programId)}` : '?_=1';

    const [compliance, notSeen] = await Promise.all([
      API.get(`/api/children-compliance${pp}&month=${month}&year=${year}`) || [],
      API.get(`/api/children-not-seen${pp}&week_ending=${we}`) || [],
    ]);

    const compliant    = (compliance||[]).filter(c=>c.compliance_status==='Compliant').length;
    const nonCompliant = (compliance||[]).filter(c=>c.compliance_status==='Non-compliant').length;
    const total        = (compliance||[]).length;
    const notSeenCount = (notSeen||[]).length;

    el.innerHTML = `
      <div class="metric-grid-3" style="margin-bottom:14px">
        <div class="mc"><div class="mc-label">Total active children</div><div class="mc-value" style="color:#1B3A5C">${total}</div><div class="mc-sub">${programId?'This program':'All programs'}</div></div>
        <div class="mc"><div class="mc-label">Seen 2x this month</div><div class="mc-value" style="color:#0F6E56">${compliant}</div><div class="mc-sub">Compliant — ${total?Math.round(compliant/total*100):0}%</div></div>
        <div class="mc"><div class="mc-label">Not seen this week</div><div class="mc-value" style="color:#A32D2D">${notSeenCount}</div></div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div class="tab-bar" style="margin-bottom:0">
          <div class="tab active" onclick="ExecViews.switchChildrenTab('weekly',this,'${programId||''}')">Not seen this week (${notSeenCount})</div>
          <div class="tab" onclick="ExecViews.switchChildrenTab('monthly',this,'${programId||''}')">Non-compliant this month (${nonCompliant})</div>
          <div class="tab" onclick="ExecViews.switchChildrenTab('all',this,'${programId||''}')">All children</div>
        </div>
        <button class="btn btn-sm" onclick="window.open('/api/export/children-compliance${pp}','_blank')">Export CSV</button>
      </div>
      <div id="children-tab-content"></div>`;

    ExecViews._childrenData = compliance;
    ExecViews._notSeenData  = notSeen;
    ExecViews.switchChildrenTab('weekly', document.querySelector('#children-compliance-section .tab.active'), programId);
  },

  switchChildrenTab(id, el, programId) {
    document.querySelectorAll('#children-compliance-section .tab').forEach(t=>t.classList.remove('active'));
    el?.classList.add('active');
    const content = document.getElementById('children-tab-content');
    if (!content) return;

    const tbl = (rows, cols) => rows.length
      ? `<div class="table-wrap"><table class="data-table"><thead><tr>${cols.map(c=>`<th>${c}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`
      : '<div class="empty-state">No data for this period.</div>';

    if (id === 'weekly') {
      content.innerHTML = tbl(
        (ExecViews._notSeenData||[]).map(c=>`<tr>
          <td style="font-size:12px">${c.program_id||'—'}</td>
          <td class="mono" style="color:#1B3A5C;font-weight:600">${c.case_id}</td>
          <td style="font-size:12px">${c.case_name||'—'}</td>
          <td style="font-weight:600">${c.child_name||'—'}</td>
          <td class="mono" style="font-size:12px">${c.cin||'—'}</td>
          <td><span class="badge badge-red">${c.seen_status||'Not seen'}</span></td>
          <td style="font-size:12px;color:#888">${c.reason_not_seen||'—'}</td>
          <td style="font-size:12px">${c.planner_name||'—'}</td>
        </tr>`),
        ['Program','Case ID','Case Name','Child Name','CIN','Status','Reason','Planner']
      );
    } else if (id === 'monthly') {
      const data = (ExecViews._childrenData||[]).filter(c=>c.compliance_status==='Non-compliant');
      content.innerHTML = tbl(
        data.map(c=>`<tr>
          <td style="font-size:12px">${c.program_id||'—'}</td>
          <td class="mono" style="color:#1B3A5C;font-weight:600">${c.case_id}</td>
          <td style="font-size:12px">${c.case_name||'—'}</td>
          <td style="font-weight:600">${c.child_name||'—'}</td>
          <td class="mono" style="font-size:12px">${c.cin||'—'}</td>
          <td style="text-align:center"><span class="badge ${parseInt(c.times_seen)===0?'badge-red':'badge-amber'}">${c.times_seen||0}x</span></td>
          <td style="font-size:12px;color:#888">${c.last_seen||'Never'}</td>
          <td><span class="badge badge-red">Non-compliant</span></td>
          <td style="font-size:12px">${c.planner_name||'—'}</td>
        </tr>`),
        ['Program','Case ID','Case Name','Child','CIN','Times seen','Last seen','Status','Planner']
      );
    } else {
      const data = ExecViews._childrenData || [];
      content.innerHTML = `
        <div style="display:flex;gap:8px;margin-bottom:10px">
          <input type="text" id="child-search" oninput="ExecViews.filterChildren()" placeholder="Search name or CIN..." style="font-size:12px;padding:6px 10px;border:1px solid var(--mgray);border-radius:6px;flex:1">
          <select id="child-status-filter" onchange="ExecViews.filterChildren()" style="font-size:12px;padding:6px 10px;border:1px solid var(--mgray);border-radius:6px">
            <option value="">All</option><option>Compliant</option><option>Non-compliant</option>
          </select>
        </div>
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>Program</th><th>Case ID</th><th>Child Name</th><th>CIN</th><th>DOB</th><th>Times seen</th><th>Last seen</th><th>Status</th><th>Planner</th></tr></thead>
          <tbody id="all-children-tbody">${data.map(c=>`<tr>
            <td style="font-size:12px">${c.program_id||'—'}</td>
            <td class="mono" style="color:#1B3A5C;font-weight:600">${c.case_id}</td>
            <td style="font-weight:600">${c.child_name||'—'}</td>
            <td class="mono" style="font-size:12px">${c.cin||'—'}</td>
            <td style="font-size:12px;color:#888">${c.dob||'—'}</td>
            <td style="text-align:center"><span class="badge ${parseInt(c.times_seen)>=1?'badge-green':'badge-red'}">${c.times_seen||0}x</span></td>
            <td style="font-size:12px;color:#888">${c.last_seen||'Never'}</td>
            <td><span class="badge ${c.compliance_status==='Compliant'?'badge-green':'badge-red'}">${c.compliance_status}</span></td>
            <td style="font-size:12px">${c.planner_name||'—'}</td>
          </tr>`).join('')}</tbody>
        </table></div>`;
    }
  },

  filterChildren() {
    const search = (document.getElementById('child-search')?.value||'').toLowerCase();
    const status = document.getElementById('child-status-filter')?.value||'';
    const data   = (ExecViews._childrenData||[]).filter(c=>
      (!search || (c.child_name||'').toLowerCase().includes(search)||(c.cin||'').toLowerCase().includes(search)) &&
      (!status || c.compliance_status === status)
    );
    const tbody = document.getElementById('all-children-tbody');
    if (!tbody) return;
    tbody.innerHTML = data.map(c=>`<tr>
      <td style="font-size:12px">${c.program_id||'—'}</td>
      <td class="mono" style="color:#1B3A5C;font-weight:600">${c.case_id}</td>
      <td style="font-weight:600">${c.child_name||'—'}</td>
      <td class="mono" style="font-size:12px">${c.cin||'—'}</td>
      <td style="font-size:12px;color:#888">${c.dob||'—'}</td>
      <td style="text-align:center"><span class="badge ${parseInt(c.times_seen)>=1?'badge-green':'badge-red'}">${c.times_seen||0}x</span></td>
      <td style="font-size:12px;color:#888">${c.last_seen||'Never'}</td>
      <td><span class="badge ${c.compliance_status==='Compliant'?'badge-green':'badge-red'}">${c.compliance_status}</span></td>
      <td style="font-size:12px">${c.planner_name||'—'}</td>
    </tr>`).join('');
  },

  toggleProg(id) {
    const drill = document.getElementById('pd-'+id);
    const card  = document.getElementById('pc-'+id);
    const open  = drill?.style.display !== 'none';
    document.querySelectorAll('.prog-drill').forEach(d=>d.style.display='none');
    document.querySelectorAll('.prog-card').forEach(c=>c.classList.remove('expanded'));
    if (!open) { drill.style.display='block'; card.classList.add('expanded'); }
  },
};