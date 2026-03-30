import { esc } from '../api.js';

const MONTH_NAMES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                     'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

let calYear  = new Date().getFullYear();
let calMonth = new Date().getMonth();
let calCoffees = [];

export function setCalCoffees(coffees) {
  calCoffees = coffees;
}

export function calNav(delta) {
  calMonth += delta;
  if (calMonth < 0)  { calMonth = 11; calYear--; }
  if (calMonth > 11) { calMonth = 0;  calYear++; }
  const now = new Date();
  if (calYear > now.getFullYear() || (calYear === now.getFullYear() && calMonth > now.getMonth())) {
    calYear = now.getFullYear();
    calMonth = now.getMonth();
  }
  renderCalendar();
}

export function renderCalendar() {
  const el = document.getElementById('stats-calendar');
  if (!el) return;

  const firstDay = new Date(calYear, calMonth, 1);
  const lastDay  = new Date(calYear, calMonth + 1, 0);
  const dim      = lastDay.getDate();
  const today    = new Date(); today.setHours(0,0,0,0);

  const active = calCoffees.filter(c => {
    if (!c.opened_date) return false;
    const o = new Date(c.opened_date);
    const e = c.finished_date ? new Date(c.finished_date) : today;
    return o <= lastDay && e >= firstDay;
  });

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
      <button class="cal-nav-btn" onclick="window._calNav(-1)">‹</button>
      <span class="cal-title-text">${MONTH_NAMES[calMonth]} ${calYear}</span>
      <button class="cal-nav-btn" onclick="window._calNav(1)" ${atCurrentMonth ? 'disabled' : ''}>›</button>
    </div>
    ${active.length ? `
    <div class="cal-layout">
      <div class="cal-names-col">${namesHTML}</div>
      <div class="cal-tracks-col">
        <div class="cal-days-header">${dayHeader}</div>
        ${tracksHTML}
      </div>
    </div>` : `<div class="cal-empty">Sin consumo registrado en ${MONTH_NAMES[calMonth].toLowerCase()} ${calYear}</div>`}
  </div>`;
}

window._calNav = calNav;
