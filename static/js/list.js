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
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">☕</div><h3>Sin cafés aquí</h3><p>Prueba a cambiar los filtros o añade uno nuevo</p></div>`;
    return;
  }
  const sorted = sortedCoffees();
  const showing = Math.min(visibleCount, total);
  info.textContent = showing < total ? `${showing} de ${total} cafés` : `${total} café${total!==1?'s':''}`;

  const visible = sorted.slice(0, showing);
  el.innerHTML = visible.map(c => {
    const status = getStatus(c);
    const finished = !!c.finished_date, opened = !!c.opened_date && !finished;
    const origin = [c.origin, c.region].filter(Boolean).map(esc).join(' · ');
    const sub = [c.roaster, c.producer].filter(Boolean).map(esc).join(' / ');
    const roastDays = daysFromRoast(c.roast_date);
    const freshTag = !finished && roastDays !== null && roastDays < 14
      ? `<span class="tag fresh-warning">⏳ Reposo: ${14 - roastDays} días más</span>` : '';
    const daysOpen = opened ? Math.floor((new Date() - new Date(c.opened_date)) / 86400000) : null;
    const daysOpenTag = daysOpen !== null ? `<span class="tag">📅 ${daysOpen} día${daysOpen!==1?'s':''} abierto</span>` : '';
    const price = fmtPrice(c);
    const actions = !finished ? `<div class="card-actions" id="actions-${c.id}">
      ${!c.opened_date?`<button class="btn-quick open" onclick="showOpenDatePicker(event,${c.id})">📦 Abrir hoy</button>`:''}
      ${c.opened_date?`<button class="btn-quick finish" onclick="quickFinish(event,${c.id})">✅ Terminado hoy</button>`:''}
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
        ${origin?`<span class="tag">📍 ${origin}</span>`:''}
        ${c.varieties&&c.varieties.length?`<span class="tag">🌱 ${c.varieties.map(esc).join(', ')}</span>`:''}
        ${c.processes&&c.processes.length?`<span class="tag">⚙️ ${c.processes.map(esc).join(', ')}</span>`:''}
        ${c.milk_types&&c.milk_types.length?`<span class="tag milk">🥛 ${c.milk_types.map(esc).join(', ')}</span>`:''}
        ${c.quantity_g?`<span class="tag">⚖️ ${c.quantity_g}g</span>`:''}
        ${price?`<span class="tag price">💰 ${price}</span>`:''}
      </div>
      ${c.notes?`<div class="coffee-notes">${esc(c.notes)}</div>`:''}
      ${actions}
    </div>`;
  }).join('');

  if (showing < total) {
    const remaining = total - showing;
    const next = Math.min(PAGE_SIZE, remaining);
    el.innerHTML += `<button class="btn-load-more" onclick="loadMore()">
      Mostrar ${next} más <span>(${remaining} restantes)</span>
    </button>`;
  }
}

function loadMore() {
  visibleCount += PAGE_SIZE;
  renderList();
}

function showPage(name, tab) {
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  document.getElementById('page-'+name).classList.add('active');
  tab.classList.add('active');
  if (name==='stats') loadStats();
  if (name==='catalog') loadCatalog();
  if (name==='brews') loadBrews();
}
