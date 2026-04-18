// ---------------------------------------------------------------------------
// Stats page
// ---------------------------------------------------------------------------
async function loadStats() {
  const [s, coffees] = await Promise.all([api('/stats'), api('/coffees')]);
  calCoffees = coffees;

  const dpkg = s.days_per_kg ? t('stats.days_per_kg', {n: s.days_per_kg}) : '–';
  const pending = s.total - s.active - s.finished;
  document.getElementById('stats-grid').innerHTML = `
    <div class="stat-card"><div class="stat-val">${pending}</div><div class="stat-label">${t('stats.available')}</div>${s.pending_weight_g?`<div class="stat-sub">${fmtWeight(s.pending_weight_g)}</div>`:''}</div>
    <div class="stat-card"><div class="stat-val">${s.active}</div><div class="stat-label">${t('stats.in_use')}</div>${s.active_weight_g?`<div class="stat-sub">${t('stats.remaining_weight', {weight: fmtWeight(s.active_weight_g)})}</div>`:''}</div>
    <div class="stat-card"><div class="stat-val">${s.avg_rating?'★ '+s.avg_rating:'–'}</div><div class="stat-label">${t('stats.avg_rating')}</div></div>
    <div class="stat-card"><div class="stat-val">${s.avg_cost_kg?s.avg_cost_kg+'€/kg':'–'}</div><div class="stat-label">${t('stats.avg_cost')}</div></div>
    <div class="stat-card" style="grid-column:1/-1"><div class="stat-val" style="font-size:22px">${dpkg}</div><div class="stat-label">${t('stats.consumption_rate')}</div></div>
  `;

  renderStatsHero(s);
  renderStatsGantt(s);
  renderCalendar();

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

function renderStatsGantt(s) {
  const el = document.getElementById('stats-gantt');
  if (!el || !s.active_bags || !s.active_bags.length) return;
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthLabel = now.toLocaleDateString(navigator.language || 'es', { month: 'long', year: 'numeric' });

  const bars = s.active_bags.map(b => {
    const opened = new Date(b.opened_date);
    const finished = b.finished_date ? new Date(b.finished_date) : now;
    const startDay = opened < monthStart ? 1 : opened.getDate();
    const endDay = finished > now ? now.getDate() : finished.getDate();
    return { name: b.name, start: startDay, end: endDay, finished: !!b.finished_date };
  });

  const ticks = [1, 5, 10, 15, 20, 25, daysInMonth];
  el.innerHTML = `
    <div class="stats-gantt">
      <div class="stats-gantt-head">
        <button class="stats-gantt-nav" aria-label="prev" style="opacity:.4">‹</button>
        <div class="stats-gantt-title">${monthLabel}</div>
        <button class="stats-gantt-nav" aria-label="next" style="opacity:.4">›</button>
      </div>
      <div class="stats-gantt-grid">
        <div></div>
        <div class="stats-gantt-scale">
          ${ticks.map(d => `<span class="stats-gantt-scale-tick" style="left:${((d - 0.5) / daysInMonth * 100).toFixed(1)}%">${d}</span>`).join('')}
        </div>
        ${bars.map(b => `
          <div class="stats-gantt-row-label" title="${esc(b.name)}">${esc(b.name)}</div>
          <div class="stats-gantt-row-track">
            <div class="stats-gantt-bar ${b.finished ? 'finished' : 'open'}"
              style="left:${((b.start - 1) / daysInMonth * 100).toFixed(1)}%; width:${((b.end - b.start + 1) / daysInMonth * 100).toFixed(1)}%"></div>
          </div>
        `).join('')}
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

function calNav(delta) {
  calMonth += delta;
  if (calMonth < 0)  { calMonth = 11; calYear--; }
  if (calMonth > 11) { calMonth = 0;  calYear++; }
  // Don't navigate beyond current month
  const now = new Date();
  if (calYear > now.getFullYear() || (calYear === now.getFullYear() && calMonth > now.getMonth())) {
    calYear = now.getFullYear();
    calMonth = now.getMonth();
  }
  renderCalendar();
}

function renderCalendar() {
  const el = document.getElementById('stats-calendar');
  if (!el) return;

  const firstDay = new Date(calYear, calMonth, 1);
  const lastDay  = new Date(calYear, calMonth + 1, 0);
  const dim      = lastDay.getDate();
  const today    = new Date(); today.setHours(0,0,0,0);

  // coffees that overlap this month and have been opened
  const active = calCoffees.filter(c => {
    if (!c.opened_date) return false;
    const o = new Date(c.opened_date);
    const e = c.finished_date ? new Date(c.finished_date) : today;
    return o <= lastDay && e >= firstDay;
  });

  // day tick marks: 1, every 5, last day
  const ticks = new Set([1]);
  for (let d = 5; d < dim; d += 5) ticks.add(d);
  ticks.add(dim);

  const dayHeader = Array.from({length: dim}, (_,i) => {
    const d = i + 1;
    const left = ((i + 0.5) / dim * 100).toFixed(2);
    return ticks.has(d) ? `<span class="cal-day-tick" style="left:${left}%">${d}</span>` : '';
  }).join('');

  let namesHTML = '', tracksHTML = '';
  active.forEach(c => {
    const opened   = new Date(c.opened_date);
    const closed   = c.finished_date ? new Date(c.finished_date) : today;
    const isOpen   = !c.finished_date;
    const startIdx = Math.max(0,     Math.round((opened - firstDay) / 86400000));
    const endIdx   = Math.min(dim-1, Math.round((closed - firstDay) / 86400000));
    const leftPct  = (startIdx / dim * 100).toFixed(2);
    const widthPct = ((endIdx - startIdx + 1) / dim * 100).toFixed(2);
    const color    = isOpen ? 'var(--green)' : 'var(--accent)';

    namesHTML  += `<div class="cal-name" title="${esc(c.name)}">${esc(c.name)}</div>`;
    tracksHTML += `<div class="cal-track">
      <div class="cal-bar" style="left:${leftPct}%;width:${widthPct}%;background:${color}">
        <span class="cal-bar-label">${esc(c.name)}</span>
      </div>
    </div>`;
  });

  const now2 = new Date();
  const atCurrentMonth = calYear === now2.getFullYear() && calMonth === now2.getMonth();
  el.innerHTML = `<div class="stats-section" style="margin-bottom:10px">
    <div class="cal-nav-header">
      <button class="cal-nav-btn" onclick="calNav(-1)">‹</button>
      <span class="cal-title-text">${getMonthNames()[calMonth]} ${calYear}</span>
      <button class="cal-nav-btn" onclick="calNav(1)" ${atCurrentMonth ? 'disabled' : ''}>›</button>
    </div>
    ${active.length ? `
    <div class="cal-layout">
      <div class="cal-names-col">${namesHTML}</div>
      <div class="cal-tracks-col">
        <div class="cal-days-header">${dayHeader}</div>
        ${tracksHTML}
      </div>
    </div>` : `<div class="cal-empty">${t('stats.no_consumption', {month: getMonthNames()[calMonth].toLowerCase(), year: calYear})}</div>`}
  </div>`;
}
