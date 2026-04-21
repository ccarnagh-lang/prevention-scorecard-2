const ExecViews = {

  _currentTab: 'weekly',
  _childrenTab: 'weekly',

  async dashboard(data) {
    const d = data || await API.get('/api/dashboard') || {};
    const progs = d.programs || [];
    const s = d.scores || {};

    UI.setTopbar(`
      <select id="ex-prog" onchange="ExecViews.filterByProgram()" style="font-size:12px;padding:5px 9px;border:1px solid var(--mgray);border-radius:6px">
        <option value="">All programs</option>
        ${progs.map(p=>`<option value="${p.id}">${p.name}</option>`).join('')}
      </select>
      <select id="ex-borough" style="font-size:12px;padding:5px 9px;border:1px solid var(--mgray);border-radius:6px">
        <option value="">All boroughs</option>
        ${[...new Set(progs.map(p=>p.borough).filter(Boolean))].map(b=>`<option>${b}</option>`).join('')}
      </select>
      <input type="date" id="ex-from" value="${new Date(new Date().getFullYear(),0,1).toISOString().slice(0,10)}" style="font-size:12px;padding:5px 9px;border:1px solid var(--mgray);border-radius:6px">
      <span style="color:#aaa;font-size:12px">to</span>
      <input type="date" id="ex-to" value="${new Date().toISOString().slice(0,10)}" style="font-size:12px;padding:5px 9px;border:1px solid var(--mgray);border-radius:6px">
      <button class="btn btn-navy btn-sm" onclick="window.open('/api/export/csv?mode=full','_blank')">Export CSV</button>`);

    const totalCases    = progs.reduce((a,p)=>a+(p.cases||0),0);
    const totalFlags    = progs.reduce((a,p)=>a+(p.flags||0),0);
    const totalFasp     = progs.reduce((a,p)=>a+(p.fasp||0),0);
    const totalChildren = progs.reduce((a,p)=>a+(p.children||0),0);
    const avgWs         = progs.length ? Math.round(progs.filter(p=>p.ws).reduce((a,p)=>a+(p.ws||0),0)/progs.filter(p=>p.ws).length||0) : null;

    const tabs = [{id:'weekly',label:'Weekly'},{id:'monthly',label:'Monthly'},{id:'quarterly',label:'Quarterly'},{id:'ytd',label:'Year to Date'}];

    UI.setContent(`
      <div class="metric-grid" style="grid-template-columns:repeat(5,minmax(0,1fr))">
        <div class="mc"><div class="mc-label">Agency score</div><div class="mc-value" style="color:${UI.scoreColor(avgWs)}">${avgWs!=null?avgWs+'%':'—'}</div><div class="mc-sub">${progs.length} programs</div></div>
        <div class="mc"><div class="mc-label">Active cases</div><div class="mc-value">${totalCases}</div><div class="mc-sub">All programs</div></div>
        <div class="mc"><div class="mc-label">Active children</div><div class="mc-value" style="color:#1B3A5C">${totalChildren}</div><div class="mc-sub">In roster</div></div>
        <div class="mc"><div class="mc-label">Safety flags</div><div class="mc-value" style="color:#A32D2D">${totalFlags}</div><div class="mc-sub">Requiring action</div></div>
        <div class="mc"><div class="mc-label">FASP overdue</div><div class="mc-value" style="color:#BA7517">${totalFasp}</div><div class="mc-sub">Submit to ACS</div></div>
      </div>

      <div class="tab-bar">
        ${tabs.map((t,i)=>`<div class="tab${i===0?' active':''}" onclick="ExecViews.switchTab('${t.id}',this)">${t.label}</div>`).join('')}
      </div>
      <div id="exec-tab-content" style="margin-bottom:14px"></div>

      <div class="chart-grid" style="margin-bottom:14px">
        <div class="card"><div class="card-title">Program compliance — weekly score</div>
          <div style="position:relative;height:200px"><canvas id="c-exec-prog" role="img" aria-label="Program compliance bar chart">Program data.</canvas></div></div>
        <div class="card"><div class="card-title">Agency score trend</div>
          <div style="position:relative;height:200px"><canvas id="c-exec-trend" role="img" aria-label="Score trend line chart">Trend data.</canvas></div></div>
      </div>

      <div class="section-head">Children compliance — all programs</div>
      <div id="children-compliance-section"></div>

      <div class="section-head" style="margin-top:18px">All programs — click to drill down</div>
      <div id="prog-list"></div>
    `);

    ExecViews.switchTab('weekly', document.querySelector('.tab.active'));
    ExecViews.renderChildrenCompliance(null);

    if (progs.length) {
      UI.mkChart('c-exec-prog', {
        type:'bar',
        data:{labels:progs.map(p=>p.name.split(' ').slice(0,2).join(' ')),datasets:[{label:'Weekly %',data:progs.map(p=>p.ws||0),backgroundColor:progs.map(p=>(p.ws||0)>=90?'#1D9E75':(p.ws||0)>=75?'#EF9F27':'#E24B4A'),borderRadius:5}]},
        options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{min:0,max:100,ticks:{callback:v=>v+'%',font:{size:10}}},x:{ticks:{font:{size:10},maxRotation:30}}}}
      });
    }
    const trend = d.allTrend || d.trend || [];
    if (trend.length) UI.trendChart('c-exec-trend', trend, '#1D9E75');

    const plist = document.getElementById('prog-list');
    plist.innerHTML = progs.map(p=>`
      <div class="prog-card" id="pc-${p.id}" onclick="ExecViews.toggleProg('${p.id}')">
        <div style="display:flex;align-items:center;justify-content:space-between">
          <div>
            <div style="font-size:14px;font-weight:600;color:#1B3A5C">${p.name}</div>
            <div style="font-size:11px;color:#888;margin-top:2px">${p.borough||'—'} &nbsp;|&nbsp; ${p.modality||'—'} &nbsp;|&nbsp; ${p.cases||0} cases &nbsp;|&nbsp; ${p.children||0} children</div>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            ${UI.badge(p.ws)}<span style="font-size:11px;color:#888">weekly</span>
            ${(p.flags||0)>0?`<span class="badge badge-red">${p.flags} flag${p.flags>1?'s':''}</span>`:''}
            ${(p.fasp||0)>0?`<span class="badge badge-amber">${p.fasp} FASP</span>`:''}
          </div>
        </div>
        <div class="prog-bar" style="margin-top:8px"><div class="prog-fill" style="width:${p.ws||0}%;background:${(p.ws||0)>=90?'#1D9E75':(p.ws||0)>=75?'#EF9F27':'#E24B4A'}"></div></div>
        <div class="prog-drill" id="pd-${p.id}">
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:10px">
            ${[['Monthly',p.ms],['Quarterly',p.qs],['Lifetime',p.ls],['Children',p.children||0]].map(([l,v])=>`
              <div style="text-align:center"><div style="font-size:10px;color:#888;margin-bottom:2px;font-weight:600">${l}</div>
              <div style="font-size:16px;font-weight:700;color:${typeof v==='number'&&l!=='Children'?UI.scoreColor(v):'#1B3A5C'}">${typeof v==='number'&&l!=='Children'?v+'%':v||'—'}</div></div>`).join('')}
          </div>
          <button class="btn btn-sm" onclick="event.stopPropagation();ExecViews.renderChildrenCompliance('${p.id}')">View children compliance</button>
        </div>
      </div>`).join('');
  },

  switchTab(id, el) {
    document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
    el?.classList.add('active');
    ExecViews._currentTab = id;
    const domains = [
      {name:'Administration',pct:88},{name:'Assessment',pct:82},{name:'Safety/Risk',pct:75},
      {name:'Engagement',pct:79},{name:'FASP',pct:70},{name:'FTC',pct:83},
    ];
    const labels = {weekly:'Week ending '+new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}),monthly:'Current month',quarterly:'Q2 2025',ytd:'Year to date'};
    document.getElementById('exec-tab-content').innerHTML = `
      <div class="card">
        <div class="card-title">Compliance by domain — <span style="color:#888;font-weight:400">${labels[id]}</span></div>
        ${UI.domainBars(domains)}
      </div>`;
  },

  async renderChildrenCompliance(programId) {
    const el = document.getElementById('children-compliance-section');
    if (!el) return;
    el.innerHTML = '<div class="loading" style="padding:20px">Loading children compliance data...</div>';

    const now   = new Date();
    const month = now.getMonth() + 1;
    const year  = now.getFullYear();
    const we    = now.toISOString().slice(0,10);

    const [compliance, notSeen] = await Promise.all([
      API.get(`/api/children-compliance?month=${month}&year=${year}${programId?'&program_id='+programId:''}`) || [],
      API.get(`/api/children-not-seen?week_ending=${we}${programId?'&program_id='+programId:''}`) || [],
    ]);

    const compliant    = (compliance||[]).filter(c=>c.compliance_status==='Compliant').length;
    const nonCompliant = (compliance||[]).filter(c=>c.compliance_status==='Non-compliant').length;
    const total        = (compliance||[]).length;
    const notSeenCount = (notSeen||[]).length;

    const childTabs = [{id:'weekly',label:`Not seen this week (${notSeenCount})`},{id:'monthly',label:`Monthly compliance (${nonCompliant} non-compliant)`},{id:'all',label:'All children'}];

    el.innerHTML = `
      <div class="metric-grid-3" style="margin-bottom:14px">
        <div class="mc"><div class="mc-label">Total active children</div><div class="mc-value" style="color:#1B3A5C">${total}</div><div class="mc-sub">${programId?'This program':'All programs'}</div></div>
        <div class="mc"><div class="mc-label">Seen 2x this month</div><div class="mc-value" style="color:#0F6E56">${compliant}</div><div class="mc-sub">Compliant — ${total?Math.round(compliant/total*100):0}%</div></div>
        <div class="mc"><div class="mc-label">Not seen this week</div><div class="mc-value" style="color:#A32D2D">${notSeenCount}</div><div class="mc-sub">Across ${programId?'this program':'all programs'}</div></div>
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div class="tab-bar" style="margin-bottom:0">
          ${childTabs.map((t,i)=>`<div class="tab${i===0?' active':''}" onclick="ExecViews.switchChildrenTab('${t.id}',this,'${programId||''}')">${t.label}</div>`).join('')}
        </div>
        <button class="btn btn-sm" onclick="window.open('/api/export/children-compliance${programId?'?program_id='+programId:''}','_blank')">Export CSV</button>
      </div>
      <div id="children-tab-content"></div>
    `;

    ExecViews._childrenData    = compliance;
    ExecViews._notSeenData     = notSeen;
    ExecViews.switchChildrenTab('weekly', document.querySelector('#children-compliance-section .tab.active'), programId);
  },

  switchChildrenTab(id, el, programId) {
    document.querySelectorAll('#children-compliance-section .tab').forEach(t=>t.classList.remove('active'));
    el?.classList.add('active');

    const content = document.getElementById('children-tab-content');
    if (!content) return;

    if (id === 'weekly') {
      const data = ExecViews._notSeenData || [];
      content.innerHTML = data.length ? `
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Program</th><th>Case ID</th><th>Case Name</th><th>Child Name</th><th>CIN</th><th>Status</th><th>Reason</th><th>Planner</th></tr></thead>
            <tbody>${data.map(c=>`<tr>
              <td style="font-size:12px">${c.program_id||'—'}</td>
              <td class="mono" style="color:#1B3A5C;font-weight:600">${c.case_id}</td>
              <td style="font-size:12px">${c.case_name||'—'}</td>
              <td style="font-weight:600">${c.child_name||'—'}</td>
              <td class="mono" style="font-size:12px">${c.cin||'—'}</td>
              <td><span class="badge badge-red">${c.seen_status||'Not seen'}</span></td>
              <td style="font-size:12px;color:#888">${c.reason_not_seen||'—'}</td>
              <td style="font-size:12px">${c.planner_name||'—'}</td>
            </tr>`).join('')}</tbody>
          </table>
        </div>` : '<div class="empty-state">All children were seen this week.</div>';
    } else if (id === 'monthly') {
      const data = (ExecViews._childrenData||[]).filter(c=>c.compliance_status==='Non-compliant');
      content.innerHTML = data.length ? `
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Program</th><th>Case ID</th><th>Case Name</th><th>Child Name</th><th>CIN</th><th>DOB</th><th>Times seen</th><th>Last seen</th><th>Status</th><th>Planner</th></tr></thead>
            <tbody>${data.map(c=>`<tr>
              <td style="font-size:12px">${c.program_id||'—'}</td>
              <td class="mono" style="color:#1B3A5C;font-weight:600">${c.case_id}</td>
              <td style="font-size:12px">${c.case_name||'—'}</td>
              <td style="font-weight:600">${c.child_name||'—'}</td>
              <td class="mono" style="font-size:12px">${c.cin||'—'}</td>
              <td style="font-size:12px;color:#888">${c.dob||'—'}</td>
              <td style="text-align:center"><span class="badge ${parseInt(c.times_seen)===0?'badge-red':'badge-amber'}">${c.times_seen||0}x</span></td>
              <td style="font-size:12px;color:#888">${c.last_seen||'Never'}</td>
              <td><span class="badge badge-red">Non-compliant</span></td>
              <td style="font-size:12px">${c.planner_name||'—'}</td>
            </tr>`).join('')}</tbody>
          </table>
        </div>` : '<div class="empty-state">All children seen 2+ times this month — fully compliant.</div>';
    } else {
      const data = ExecViews._childrenData || [];
      content.innerHTML = data.length ? `
        <div class="filter-bar">
          <input type="text" id="child-search" oninput="ExecViews.filterChildren()" placeholder="Search child name or CIN..." style="font-size:12px;padding:6px 10px;border:1px solid var(--mgray);border-radius:6px">
          <select id="child-status-filter" onchange="ExecViews.filterChildren()" style="font-size:12px;padding:6px 10px;border:1px solid var(--mgray);border-radius:6px">
            <option value="">All statuses</option><option>Compliant</option><option>Non-compliant</option>
          </select>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Program</th><th>Case ID</th><th>Child Name</th><th>CIN</th><th>DOB</th><th>Times seen</th><th>Last seen</th><th>Status</th><th>Planner</th></tr></thead>
            <tbody id="all-children-tbody">${data.map(c=>`<tr>
              <td style="font-size:12px">${c.program_id||'—'}</td>
              <td class="mono" style="color:#1B3A5C;font-weight:600">${c.case_id}</td>
              <td style="font-weight:600">${c.child_name||'—'}</td>
              <td class="mono" style="font-size:12px">${c.cin||'—'}</td>
              <td style="font-size:12px;color:#888">${c.dob||'—'}</td>
              <td style="text-align:center"><span class="badge ${parseInt(c.times_seen)>=2?'badge-green':parseInt(c.times_seen)===1?'badge-amber':'badge-red'}">${c.times_seen||0}x</span></td>
              <td style="font-size:12px;color:#888">${c.last_seen||'Never'}</td>
              <td><span class="badge ${c.compliance_status==='Compliant'?'badge-green':'badge-red'}">${c.compliance_status}</span></td>
              <td style="font-size:12px">${c.planner_name||'—'}</td>
            </tr>`).join('')}</tbody>
          </table>
        </div>` : '<div class="empty-state">No children data yet. Upload a roster CSV to populate.</div>';
    }
  },

  filterChildren() {
    const search = (document.getElementById('child-search')?.value||'').toLowerCase();
    const status = document.getElementById('child-status-filter')?.value||'';
    const data   = (ExecViews._childrenData||[]).filter(c=>
      (!search || (c.child_name||'').toLowerCase().includes(search) || (c.cin||'').toLowerCase().includes(search)) &&
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
      <td style="text-align:center"><span class="badge ${parseInt(c.times_seen)>=2?'badge-green':parseInt(c.times_seen)===1?'badge-amber':'badge-red'}">${c.times_seen||0}x</span></td>
      <td style="font-size:12px;color:#888">${c.last_seen||'Never'}</td>
      <td><span class="badge ${c.compliance_status==='Compliant'?'badge-green':'badge-red'}">${c.compliance_status}</span></td>
      <td style="font-size:12px">${c.planner_name||'—'}</td>
    </tr>`).join('');
  },

  toggleProg(id) {
    const drill = document.getElementById('pd-'+id);
    const card  = document.getElementById('pc-'+id);
    const open  = drill.style.display !== 'none';
    document.querySelectorAll('.prog-drill').forEach(d=>d.style.display='none');
    document.querySelectorAll('.prog-card').forEach(c=>c.classList.remove('expanded'));
    if (!open) { drill.style.display='block'; card.classList.add('expanded'); }
  },

  filterByProgram() {
    const pid = document.getElementById('ex-prog')?.value;
    App.nav('dash');
  },
};
