// ---------------------------------------------------------------------------
// List: fetch, sort, render
// ---------------------------------------------------------------------------
async function fetchAndRender() {
  visibleCount = PAGE_SIZE;
  const params = new URLSearchParams();
  if (activeStatus) params.set('status', activeStatus);
  if (searchQuery)  params.set('q', searchQuery);
  for (const [k,v] of Object.entries(activeFilters)) {
    if (v) params.set(k, v);
  }
  const qs = params.toString();
  displayedCoffees = await api('/coffees' + (qs ? '?'+qs : ''));
  renderList();
}

function onSortChange() {
  currentSort = document.getElementById('sort-select').value;
  saveListPrefs();
  visibleCount = PAGE_SIZE;
  renderList();
}

function sortedCoffees() {
  const arr = [...displayedCoffees];
  switch (currentSort) {
    case 'smart': return arr.sort((a, b) => {
      // 0=abierto, 1=sin abrir, 2=terminado
      const statusOrder = c => c.finished_date ? 2 : c.opened_date ? 0 : 1;
      const sa = statusOrder(a), sb = statusOrder(b);
      if (sa !== sb) return sa - sb;
      // abiertos y sin abrir: tueste más antiguo primero
      if (sa < 2) return (a.roast_date || '').localeCompare(b.roast_date || '');
      // terminados: más reciente primero
      return (b.finished_date || '').localeCompare(a.finished_date || '');
    });
    case 'roast_desc':  return arr.sort((a,b)=>(b.roast_date||'').localeCompare(a.roast_date||''));
    case 'roast_asc':   return arr.sort((a,b)=>(a.roast_date||'').localeCompare(b.roast_date||''));
    case 'rating_desc': return arr.sort((a,b)=>(b.rating||0)-(a.rating||0));
    case 'name_asc':    return arr.sort((a,b)=>a.name.localeCompare(b.name));
    default:            return arr; // created_desc: server already returns this order
  }
}

function shotsLeft(c) {
  if (c.remaining_g == null || !gramsPerShot) return null;
  return Math.floor(c.remaining_g / gramsPerShot);
}

function renderCompactCard(c) {
  const status = getStatus(c);
  const finished = !!c.finished_date, opened = !!c.opened_date && !finished;
  const sub = [c.roaster, c.producer].filter(Boolean).map(esc).join(' / ');
  const shots = opened ? shotsLeft(c) : null;
  const lowStock = shots !== null && shots <= lowStockThreshold;
  const actions = !finished ? `
    <div class="cc-actions" onclick="event.stopPropagation()">
      ${!c.opened_date ? `<button class="btn-cc open" onclick="showOpenDatePicker(event,${c.id})" title="${esc(t('list.btn.open_today'))}" aria-label="${esc(t('list.btn.open_today'))}">${icon('plus')}</button>` : ''}
      ${c.opened_date  ? `<button class="btn-cc finish" onclick="quickFinish(event,${c.id})" title="${esc(t('list.btn.finish_today'))}" aria-label="${esc(t('list.btn.finish_today'))}">${icon('check')}</button>` : ''}
      ${opened && c.remaining_g != null ? `<button class="btn-cc consume" onclick="consumeShot(${c.id})" title="${esc(t('list.consume_shot'))}" aria-label="${esc(t('list.consume_shot'))}">${icon('minus')}</button>` : ''}
    </div>` : '';
  return `<div class="coffee-card coffee-card-compact ${finished?'finished-coffee':opened?'active-coffee':''}" onclick="showDetail(${c.id})">
    <div class="cc-row1">
      <div class="coffee-name">${esc(c.name)}</div>
      <div class="cc-right">
        <div class="coffee-rating">${stars(c.rating)}</div>
        ${actions}
      </div>
    </div>
    <div class="cc-row2">
      <div class="coffee-sub" style="margin-top:0">${sub || ''}</div>
      <div class="cc-meta2">
        <span class="tag ${status.cls}">${status.label}</span>
        ${opened && c.remaining_g != null ? `<span class="cc-qty${lowStock?' low-stock':''}">${fmtGrams(c.remaining_g)}${c.quantity_g ? `<small> / ${fmtGrams(c.quantity_g)}</small>` : ''}${shots !== null ? ` <small>(${shots}${t('list.shots_unit')})</small>` : ''}${lowStock ? ' <span class="low-stock-icon" title="'+t('list.low_stock_alert')+'">'+icon('alert','ic-sm')+'</span>' : ''}</span>` : ''}
      </div>
    </div>
    ${!c.opened_date ? `<div class="cc-open-slot" id="actions-${c.id}" onclick="event.stopPropagation()"></div>` : ''}
  </div>`;
}

function renderList() {
  const btn = document.getElementById('view-toggle-btn');
  if (btn) {
    btn.classList.toggle('active', compactList);
    btn.querySelector('use')?.setAttribute('href', compactList ? '#ic-view-full' : '#ic-view-compact');
  }

  scheduleListSummary();
  const el = document.getElementById('coffee-list');
  const info = document.getElementById('results-info');
  const total = displayedCoffees.length;
  if (total === 0) {
    info.textContent = '';
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">${icon('coffee')}</div><h3>${t('list.empty_title')}</h3><p>${t('list.empty_hint')}</p></div>`;
    return;
  }
  const sorted = sortedCoffees();
  const showing = Math.min(visibleCount, total);
  info.textContent = showing < total
    ? t('list.showing', {showing, total})
    : t('list.total', {total, s: total !== 1 ? 's' : ''});

  const visible = sorted.slice(0, showing);
  const render = compactList ? renderCompactCard : renderCoffeeRow;
  const rows = list => list.map(render).join('');
  // Con otro orden los grupos romperían el que has elegido: lista plana
  const groups = currentSort === 'smart' ? [
    ['filter.active', visible.filter(c => c.opened_date && !c.finished_date)],
    ['filter.pending', visible.filter(c => !c.opened_date && !c.finished_date)],
    ['filter.finished', visible.filter(c => c.finished_date)],
  ].filter(([, list]) => list.length) : [];
  el.innerHTML = groups.length > 1
    ? groups.map(([key, list]) => `<h2 class="list-group-head">${t(key)}</h2><div class="coffee-group${compactList ? ' compact' : ''}">${rows(list)}</div>`).join('')
    : `<div class="coffee-group flat${compactList ? ' compact' : ''}">${rows(visible)}</div>`;

  if (showing < total) {
    const remaining = total - showing;
    const next = Math.min(PAGE_SIZE, remaining);
    el.innerHTML += `<button class="btn-load-more" onclick="loadMore()">
      ${t('list.show_more', {next})} <span>(${t('list.show_more_remaining', {remaining})})</span>
    </button>`;
  }
}

// Una bolsa como fila: "Tostador · Café", origen y datos en una línea, lo que queda y sus acciones
function renderCoffeeRow(c) {
  const status = getStatus(c);
  const finished = !!c.finished_date, opened = !!c.opened_date && !finished;
  const roasters = [c.roaster, c.producer].filter(Boolean).map(esc).join(' / ');
  const origin = [c.origin, c.region].filter(Boolean).map(esc).join(', ');
  const roastDays = daysFromRoast(c.roast_date);
  const daysOpen = opened ? Math.floor((new Date() - new Date(c.opened_date)) / 86400000) : null;
  const price = fmtPrice(c);
  const meta = [
    origin,
    c.varieties?.length ? c.varieties.map(esc).join(', ') : '',
    c.processes?.length ? c.processes.map(esc).join(', ') : '',
    c.milk_types?.length ? c.milk_types.map(esc).join(', ') : '',
    daysOpen !== null ? t('list.days_open_tag', {days: daysOpen, s: daysOpen !== 1 ? 's' : ''}) : '',
  ].filter(Boolean).join(' · ');
  const shots = opened ? shotsLeft(c) : null;
  const lowStock = shots !== null && shots <= lowStockThreshold;
  const qty = opened && c.remaining_g != null ? `
      <div class="row-qty">
        <div class="row-qty-line">
          <span class="row-qty-value${lowStock ? ' low-stock' : ''}">${fmtGrams(c.remaining_g)}${c.quantity_g ? ` <small>/ ${fmtGrams(c.quantity_g)}</small>` : ''}</span>
          ${shots !== null ? `<span class="row-shots${lowStock ? ' low-stock' : ''}">${lowStock ? `<span class="low-stock-icon" title="${esc(t('list.low_stock_alert'))}">${icon('alert', 'ic-sm')}</span> ` : ''}${t('list.shots_count', {shots, s: shots !== 1 ? 's' : ''})}</span>` : ''}
        </div>
        ${c.quantity_g ? `<div class="consume-block-track"><div class="consume-block-fill" style="width:${Math.min(100, Math.max(0, (c.remaining_g / c.quantity_g) * 100)).toFixed(1)}%"></div></div>` : ''}
      </div>` : c.quantity_g ? `<div class="row-qty"><span class="row-qty-value">${fmtGrams(c.quantity_g)}</span></div>` : '<div class="row-qty"></div>';
  const finishLabel = esc(t('list.btn.finish_today'));
  const actions = finished ? '<div class="card-actions"></div>' : `<div class="card-actions" id="actions-${c.id}" onclick="event.stopPropagation()">
      ${c.opened_date ? `<button class="btn-quick brew" type="button" onclick="openBrewModal(${c.id})">${t('detail.btn.brew')}</button>` : ''}
      ${opened && c.remaining_g != null ? `<button class="btn-quick btn-consume" type="button" onclick="consumeShot(${c.id})">${icon('minus', 'ic-sm')} ${t('list.consume_shot')} (${fmtGrams(gramsPerShot)})</button>` : ''}
      ${!c.opened_date ? `<button class="btn-quick open" type="button" onclick="showOpenDatePicker(event,${c.id})">${t('list.btn.open_today')}</button>` : ''}
      ${c.opened_date ? `<button class="btn-quick finish" type="button" onclick="quickFinish(event,${c.id})" title="${finishLabel}" aria-label="${finishLabel}">${icon('check')}</button>` : ''}
    </div>`;
  return `<div class="coffee-card coffee-row ${finished ? 'finished-coffee' : opened ? 'active-coffee' : ''}" onclick="showDetail(${c.id})">
      <div class="row-main">
        <div class="row-name">${roasters ? `<span class="coffee-sub">${roasters} ·</span> ` : ''}<span class="coffee-name">${esc(c.name)}</span>${c.rating ? ` <span class="coffee-rating">${stars(c.rating)}</span>` : ''}</div>
        <div class="row-meta">${meta}</div>
        ${price ? `<div class="row-meta row-price">${price}</div>` : ''}
        ${!finished && roastDays !== null && roastDays < 14 ? `<div class="row-meta fresh-warning">${t('list.fresh_tag', {days: 14 - roastDays})}</div>` : ''}
        ${c.notes ? `<div class="coffee-notes">${esc(c.notes)}</div>` : ''}
        <span class="tag row-status ${status.cls}">${status.label}</span>
      </div>
      ${qty}
      ${actions}
    </div>`;
}

// Resumen bajo el título: lo que hay en uso, sea cual sea el filtro de la lista
let _summaryTimer = null;
function scheduleListSummary() {
  clearTimeout(_summaryTimer);
  _summaryTimer = setTimeout(async () => {
    try {
      const r = await fetch('/api/stats');
      if (!r.ok) return;
      const st = await r.json();
      const pending = st.total - st.finished - st.active;
      setPageSummary('list', t('list.summary', {active: `<b>${st.active}</b>`, s: st.active !== 1 ? 's' : '',
        grams: `<b>${fmtGrams(st.active_weight_g)}</b>`, pending: `<b>${pending}</b>`}));
    } catch (_) {}
  }, 150);
}

function loadMore() {
  visibleCount += PAGE_SIZE;
  renderList();
}

function toggleCompactView() {
  compactList = !compactList;
  try { localStorage.setItem('compactList', compactList ? '1' : '0'); } catch (_) {}
  renderList();
}

async function consumeShot(id) {
  const result = await api('/coffees/' + id + '/consume', { method: 'POST', body: JSON.stringify({date: todayLocal()}) });
  if (!result || result.error) { showToast(result?.error || t('error.generic')); return; }
  showToast(t('toast.consume_summary', { consumed_g: fmtPlain(result.consumed_g), remaining_g: fmtPlain(result.remaining_g) }),
    { undo: () => undoConsume(id, result) });
  const idx = displayedCoffees.findIndex(c => c.id === id);
  if (idx !== -1) displayedCoffees[idx] = result.coffee;
  renderList();
}

// Deshace un "Consumir": borra el brew creado y devuelve los gramos
async function undoConsume(id, result) {
  await api('/brews/' + result.brew_id, { method: 'DELETE' });
  const coffee = await api('/coffees/' + id + '/remaining', { method: 'PUT', body: JSON.stringify({ remaining_g: result.previous_g }) });
  refreshCoffee(coffee);
}

// Sustituye un café en la lista (y en la ficha si está abierta) y repinta
function refreshCoffee(coffee) {
  const idx = displayedCoffees.findIndex(c => c.id === coffee.id);
  if (idx !== -1) displayedCoffees[idx] = coffee;
  renderList();
  if (currentDetail?.id === coffee.id) {
    currentDetail = coffee;
    if (document.getElementById('modal-detail').classList.contains('open')) showDetail(coffee.id);
  }
  if (document.getElementById('page-brews')?.classList.contains('active')) loadBrews();
}

const PAGE_TITLES = {list: 'nav.tab.coffees', brews: 'nav.tab.brews', stats: 'nav.tab.stats', catalog: 'nav.tab.catalog'};
let currentPage = 'list';
const _pageSummaries = {};

// Línea de resumen bajo el título de cada página (html ya escapado)
function setPageSummary(name, html) {
  _pageSummaries[name] = html || '';
  if (name === currentPage) renderPageHeader();
}

function renderPageHeader() {
  document.getElementById('page-title').textContent = t(PAGE_TITLES[currentPage]);
  const el = document.getElementById('page-summary');
  el.innerHTML = _pageSummaries[currentPage] || '';
  el.hidden = !el.innerHTML;
  document.querySelectorAll('.page-action').forEach(b => { b.hidden = b.dataset.forPage !== currentPage; });
}

function showPage(name, tab) {
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.bnav-item').forEach(t=>t.classList.remove('active'));
  document.getElementById('page-'+name).classList.add('active');
  document.querySelectorAll(`[data-page="${name}"]`).forEach(t=>t.classList.add('active'));
  currentPage = name;
  renderPageHeader();
  if (name==='stats') loadStats();
  if (name==='catalog') loadCatalog();
  if (name==='brews') loadBrews();
}

// Ajustes, báscula y búsqueda cambian de sitio según el ancho: cabecera en móvil, navegación en
// tablet y escritorio. Son los mismos elementos, solo se mueven.
function placeNavTools() {
  const tablet = window.matchMedia('(min-width: 640px)').matches;
  const desktop = window.matchMedia('(min-width: 1024px)').matches;
  const home = tablet ? document.querySelector('.app-nav-foot') : document.querySelector('.app-tools');
  home.append(document.getElementById('scale-chip'), document.getElementById('settings-btn'));
  const box = document.getElementById('search-box');
  if (desktop) { document.querySelector('.app-nav-search').append(box); box.hidden = false; }
  else {
    document.querySelector('.page-header').after(box);
    box.hidden = !document.getElementById('search-input').value;
  }
}

function toggleSearch() {
  const box = document.getElementById('search-box');
  const input = document.getElementById('search-input');
  if (box.hidden) { box.hidden = false; input.focus(); }
  else if (!input.value) box.hidden = true;
  else input.focus();
}
