/* ui.js — Shared rendering helpers */

const UI = {
  badge(score) {
    if (score == null) return '<span class="badge badge-gray">—</span>';
    const cls = score >= 90 ? 'badge-green' : score >= 75 ? 'badge-amber' : 'badge-red';
    return `<span class="badge ${cls}">${Math.round(score)}%</span>`;
  },

  faspBadge(status) {
    const cls = status === 'Current' ? 'badge-green' : status === 'Overdue' ? 'badge-red' : 'badge-gray';
    return `<span class="badge ${cls}">${status || 'Pending'}</span>`;
  },

  scoreColor(s) {
    if (s == null) return '#aaa';
    return s >= 90 ? '#0F6E56' : s >= 75 ? '#BA7517' : '#A32D2D';
  },

  respClass(r) {
    return r === 'Yes' ? 'yes' : r === 'No' ? 'no' : r === 'Some but not all' ? 'partial' : '';
  },

  initials(name) {
    return (name || '').split(' ').map(p => p[0]).join('').slice(0,2).toUpperCase();
  },

  toast(msg, type='', dur=3000) {
    const el = document.createElement('div');
    el.className = 'toast' + (type ? ' '+type : '');
    el.textContent = msg;
    document.getElementById('toast-wrap').appendChild(el);
    setTimeout(() => el.remove(), dur);
  },

  modal(html, onConfirm) {
    const wrap = document.getElementById('modal-wrap');
    const box  = document.getElementById('modal-box');
    box.innerHTML = html;
    wrap.classList.remove('hidden');
    box.querySelector('[data-cancel]')?.addEventListener('click', () => wrap.classList.add('hidden'));
    box.querySelector('[data-confirm]')?.addEventListener('click', () => {
      wrap.classList.add('hidden');
      onConfirm?.();
    });
  },

  closeModal() {
    document.getElementById('modal-wrap').classList.add('hidden');
  },

  setTitle(t) { document.getElementById('tb-title').textContent = t; },
  setTopbar(html) { document.getElementById('tb-right').innerHTML = html; },
  setContent(html) { document.getElementById('main-content').innerHTML = html; },

  charts: {},
  mkChart(id, config) {
    if (this.charts[id]) { this.charts[id].destroy(); delete this.charts[id]; }
    const el = document.getElementById(id);
    if (!el) return;
    this.charts[id] = new Chart(el, config);
  },

  buildReqRow(r, i) {
    return `
      <div class="req-row">
        <span class="req-id">${r.id}</span>
        <span class="req-name${r.unscored?' unscored':''}">${r.name}${r.unscored?' <em style="font-size:10px">(unscored)</em>':''}</span>
        <select class="req-sel" id="rq-${r.id}" onchange="SharedViews.styleReq(this);SharedViews.calcScore()">
          ${r.opts.map(o => `<option>${o}</option>`).join('')}
        </select>
        <input class="req-note" type="text" id="rn-${r.id}" placeholder="Notes...">
      </div>`;
  },

  domainBars(domains) {
    return domains.map(d => `
      <div style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;margin-bottom:3px">
          <span style="font-size:13px;color:#333">${d.name}</span>
          <span style="font-size:13px;font-weight:700;color:${this.scoreColor(d.pct)}">${d.pct != null ? Math.round(d.pct)+'%' : '—'}</span>
        </div>
        <div class="prog-bar"><div class="prog-fill" style="width:${d.pct||0}%;background:${d.pct>=90?'#1D9E75':d.pct>=75?'#EF9F27':'#E24B4A'}"></div></div>
      </div>`).join('');
  },

  trendChart(id, data, color='#1D9E75') {
    this.mkChart(id, {
      type: 'line',
      data: {
        labels: data.map(d => d.week_ending?.slice(5) || d.week_ending),
        datasets: [{
          label: 'Score',
          data: data.map(d => d.score != null ? Math.round(d.score) : null),
          borderColor: color, backgroundColor: color+'14', fill: true,
          tension: .35, pointRadius: 3, pointBackgroundColor: color,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { min: 50, max: 100, ticks: { callback: v => v+'%', font:{size:10} } },
          x: { ticks: { font:{size:10}, autoSkip: false, maxRotation: 0 } },
        },
      },
    });
  },
};
