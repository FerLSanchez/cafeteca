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

function renderList() {
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
  el.innerHTML = visible.map(c => {
    const status = getStatus(c);
    const finished = !!c.finished_date, opened = !!c.opened_date && !finished;
    const origin = [c.origin, c.region].filter(Boolean).map(esc).join(' · ');
    const sub = [c.roaster, c.producer].filter(Boolean).map(esc).join(' / ');
    const roastDays = daysFromRoast(c.roast_date);
    const freshTag = !finished && roastDays !== null && roastDays < 14
      ? `<span class="tag fresh-warning">${t('list.fresh_tag', {days: 14 - roastDays})}</span>` : '';
    const daysOpen = opened ? Math.floor((new Date() - new Date(c.opened_date)) / 86400000) : null;
    const daysOpenTag = daysOpen !== null ? `<span class="tag">${t('list.days_open_tag', {days: daysOpen, s: daysOpen!==1?'s':''})}</span>` : '';
    const price = fmtPrice(c);
    const actions = !finished ? `<div class="card-actions" id="actions-${c.id}">
      ${!c.opened_date?`<button class="btn-quick open" onclick="showOpenDatePicker(event,${c.id})">${t('list.btn.open_today')}</button>`:''}
      ${c.opened_date?`<button class="btn-quick finish" onclick="quickFinish(event,${c.id})">${t('list.btn.finish_today')}</button>`:''}
    </div>` : '';
    return `<div class="coffee-card ${finished?'finished-coffee':opened?'active-coffee':''}" onclick="showDetail(${c.id})">
      <div class="card-header">
        <div style="min-width:0">
          <div class="coffee-name">${esc(c.name)}</div>
          ${sub?`<div class="coffee-sub">${sub}</div>`:''}
        </div>
        <div class="coffee-rating">${stars(c.rating)}</div>
      </div>
      <div class="coffee-meta">
        <span class="tag ${status.cls}">${status.label}</span>
        ${freshTag}
        ${daysOpenTag}
        ${origin?`<span class="tag">${icon('mappin')} ${origin}</span>`:''}
        ${c.varieties&&c.varieties.length?`<span class="tag">${icon('leaf')} ${c.varieties.map(esc).join(', ')}</span>`:''}
        ${c.processes&&c.processes.length?`<span class="tag">${icon('activity')} ${c.processes.map(esc).join(', ')}</span>`:''}
        ${c.milk_types&&c.milk_types.length?`<span class="tag milk">${icon('droplet')} ${c.milk_types.map(esc).join(', ')}</span>`:''}
        ${c.quantity_g?`<span class="tag">${icon('package')} ${c.quantity_g}g</span>`:''}
        ${price?`<span class="tag price">${icon('tag')} ${price}</span>`:''}
      </div>
      ${c.notes?`<div class="coffee-notes">${esc(c.notes)}</div>`:''}
      ${opened && c.remaining_g != null ? `
        <div class="consume-block" onclick="event.stopPropagation()">
          <div class="consume-block-head">
            <span class="consume-block-label">${t('list.remaining')}</span>
            <span class="consume-block-value">${c.remaining_g}g <small>/ ${c.quantity_g}g</small></span>
          </div>
          <div class="consume-block-track">
            <div class="consume-block-fill" style="width:${Math.min(100, Math.max(0, (c.remaining_g / c.quantity_g) * 100)).toFixed(1)}%"></div>
          </div>
          <button class="btn-consume" onclick="event.stopPropagation(); consumeShot(${c.id})">
            − ${t('list.consume_shot')} (17g)
          </button>
        </div>
      ` : ''}
      ${actions}
    </div>`;
  }).join('');

  if (showing < total) {
    const remaining = total - showing;
    const next = Math.min(PAGE_SIZE, remaining);
    el.innerHTML += `<button class="btn-load-more" onclick="loadMore()">
      ${t('list.show_more', {next})} <span>(${t('list.show_more_remaining', {remaining})})</span>
    </button>`;
  }
}

function loadMore() {
  visibleCount += PAGE_SIZE;
  renderList();
}

async function consumeShot(id) {
  const result = await api('/coffees/' + id + '/consume', { method: 'POST' });
  if (!result || result.error) { showToast(result?.error || t('error.generic')); return; }
  showToast(t('toast.consume_summary', { consumed_g: result.consumed_g, remaining_g: result.remaining_g }));
  await fetchAndRender();
}

function showPage(name, tab) {
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.bnav-item').forEach(t=>t.classList.remove('active'));
  document.getElementById('page-'+name).classList.add('active');
  document.querySelectorAll(`[data-page="${name}"]`).forEach(t=>t.classList.add('active'));
  if (name==='stats') loadStats();
  if (name==='catalog') loadCatalog();
  if (name==='brews') loadBrews();
}
