// ---------------------------------------------------------------------------
// Stats page
// ---------------------------------------------------------------------------
async function loadStats() {
  const [s, coffees] = await Promise.all([api('/stats'), api('/coffees')]);
  calCoffees = coffees;

  const pending = s.total - s.active - s.finished;
  document.getElementById('stats-grid').innerHTML = `
    <div class="stat-card"><div class="stat-val">${pending}</div><div class="stat-label">${t('stats.available')}</div>${s.pending_weight_g?`<div class="stat-sub">${fmtWeight(s.pending_weight_g)}</div>`:''}</div>
    <div class="stat-card"><div class="stat-val">${s.active}</div><div class="stat-label">${t('stats.in_use')}</div>${s.active_weight_g?`<div class="stat-sub">${t('stats.remaining_weight', {weight: fmtWeight(s.active_weight_g)})}</div>`:''}</div>
    <div class="stat-card" style="grid-column:1/-1"><div class="stat-val">${s.avg_cost_kg?s.avg_cost_kg+'€/kg':'–'}</div><div class="stat-label">${t('stats.avg_cost')}</div></div>
  `;

  renderStatsHero(s);
  renderStatsGantt();

  const chartsEl = document.getElementById('stats-charts');
  chartsEl.textContent = '';
  if (s.top_roasters?.length) chartsEl.insertAdjacentHTML('beforeend', buildBarChart(t('stats.chart.top_roasters'), s.top_roasters));
  if (s.origins_breakdown?.length) chartsEl.insertAdjacentHTML('beforeend', buildBarChart(t('stats.chart.by_origin'), s.origins_breakdown));
  if (s.processes_breakdown?.length) chartsEl.insertAdjacentHTML('beforeend', buildBarChart(t('stats.chart.by_process'), s.processes_breakdown));
  if (s.varieties_breakdown?.length) chartsEl.insertAdjacentHTML('beforeend', buildBarChart(t('stats.chart.by_variety'), s.varieties_breakdown));
}

function renderStatsHero(s) {
  const el = document.getElementById('stats-hero');
  if (!el) return;
  const m = s.current_month || {};
  el.innerHTML = `
    <div class="stats-hero">
      <div class="stats-hero-label">${t('stats.this_month')}</div>
      <div class="stats-hero-big">${m.consumed_g ?? 0}<span class="stats-hero-big-unit">g ${t('stats.consumed')}</span></div>
      <div class="stats-hero-row">
        <div><div class="v">${m.brews_count ?? 0}</div><div class="k">${t('stats.preparations')}</div></div>
        <div><div class="v">★ ${m.avg_rating != null ? m.avg_rating.toFixed(1) : '—'}</div><div class="k">${t('stats.avg_rating')}</div></div>
        <div><div class="v">${s.days_per_kg != null ? s.days_per_kg + 'd' : '—'}</div><div class="k">${t('stats.per_kg')}</div></div>
      </div>
    </div>
  `;
}

function renderStatsGantt() {
  const el = document.getElementById('stats-gantt');
  if (!el) return;

  const firstDay = new Date(calYear, calMonth, 1);
  const lastDay  = new Date(calYear, calMonth + 1, 0);
  const dim      = lastDay.getDate();
  const today    = new Date(); today.setHours(0, 0, 0, 0);
  const atCurrentMonth = calYear === today.getFullYear() && calMonth === today.getMonth();
  const monthLabel = firstDay.toLocaleDateString(navigator.language || 'es', { month: 'long', year: 'numeric' });

  const active = calCoffees.filter(c => {
    if (!c.opened_date) return false;
    const o = new Date(c.opened_date);
    const e = c.finished_date ? new Date(c.finished_date) : today;
    return o <= lastDay && e >= firstDay;
  });

  const ticks = [1, 5, 10, 15, 20, 25, dim];

  const rows = active.map(c => {
    const opened   = new Date(c.opened_date);
    const closed   = c.finished_date ? new Date(c.finished_date) : today;
    const startDay = Math.max(1,   Math.round((opened - firstDay) / 86400000) + 1);
    const endDay   = Math.min(dim, Math.round((closed - firstDay) / 86400000) + 1);
    const isOpen   = !c.finished_date;
    return `
      <div class="stats-gantt-row-label" title="${esc(c.name)}">${esc(c.name)}</div>
      <div class="stats-gantt-row-track">
        <div class="stats-gantt-bar ${isOpen ? 'open' : 'finished'}"
          style="left:${((startDay - 1) / dim * 100).toFixed(1)}%; width:${((endDay - startDay + 1) / dim * 100).toFixed(1)}%"></div>
      </div>`;
  }).join('');

  el.innerHTML = `
    <div class="stats-gantt">
      <div class="stats-gantt-head">
        <button class="stats-gantt-nav" onclick="ganttNav(-1)">‹</button>
        <div class="stats-gantt-title">${monthLabel}</div>
        <button class="stats-gantt-nav" onclick="ganttNav(1)" ${atCurrentMonth ? 'disabled style="opacity:.3"' : ''}>›</button>
      </div>
      <div class="stats-gantt-grid">
        <div></div>
        <div class="stats-gantt-scale">
          ${ticks.map(d => `<span class="stats-gantt-scale-tick" style="left:${((d - 0.5) / dim * 100).toFixed(1)}%">${d}</span>`).join('')}
        </div>
        ${rows || `<div style="grid-column:1/-1;font-size:12px;color:var(--text3);padding:8px 0">${t('stats.no_consumption', {month: getMonthNames()[calMonth].toLowerCase(), year: calYear})}</div>`}
      </div>
    </div>
  `;
}

function buildBarChart(title, data) {
  const max = Math.max(...data.map(r=>r.cnt));
  const rows = data.map(r=>{
    const rating = r.avg_rating != null ? ` · ★${r.avg_rating}` : '';
    return `
    <div class="bar-row">
      <span class="bar-label" title="${esc(r.name)}">${esc(r.name)}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.round(r.cnt/max*100)}%"></div></div>
      <span class="bar-cnt">${r.cnt}${rating}</span>
    </div>`;
  }).join('');
  return `<div class="stats-section"><h3>${title}</h3>${rows}</div>`;
}

function ganttNav(delta) {
  calMonth += delta;
  if (calMonth < 0)  { calMonth = 11; calYear--; }
  if (calMonth > 11) { calMonth = 0;  calYear++; }
  const now = new Date();
  if (calYear > now.getFullYear() || (calYear === now.getFullYear() && calMonth > now.getMonth())) {
    calYear = now.getFullYear();
    calMonth = now.getMonth();
  }
  renderStatsGantt();
}
