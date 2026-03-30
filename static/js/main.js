import { api, showToast, esc, fmtDate, fmtWeight, fmtPrice } from './api.js';
import { initState, getState, setState } from './state.js';
import { openModal, closeModal, initModals, showConfirm } from './components/modal.js';
import { acInput, acBlur, renderChips, removeChip, chipKeydown, onOriginChange, onFilterOriginChange } from './components/autocomplete.js';
import { stars, setRating } from './components/rating.js';
import { renderCalendar, setCalCoffees } from './components/calendar.js';
import { startup as authStartup, pinDigit, pinDelete } from './auth/pin.js';

// Make available globally for onclick handlers
window.pinDigit = pinDigit;
window.pinDelete = pinDelete;
window.acInput = acInput;
window.acBlur = acBlur;
window.chipKeydown = chipKeydown;
window.setRating = setRating;
window.closeModal = closeModal;
window.onOriginChange = onOriginChange;
window.onFilterOriginChange = onFilterOriginChange;
window.renderChips = renderChips;

async function loadOptions() {
  const s = getState();
  s.allOptions = await api('/options');
  s.lookupTables = Object.keys(s.allOptions);
  populateFilterSelects();
}

function populateFilterSelects() {
  const s = getState();
  const map = {
    roasters:'f-filter-roaster', producers:'f-filter-producer',
    origins:'f-filter-origin', regions:'f-filter-region',
    processes:'f-filter-process', varieties:'f-filter-variety',
    shops:'f-filter-shop'
  };
  for (const [table, selId] of Object.entries(map)) {
    const sel = document.getElementById(selId);
    if (!sel) continue;
    const currentVal = sel.value;
    const first = sel.options[0];
    sel.textContent = '';
    sel.appendChild(first);
    (s.allOptions[table]||[]).forEach(o => {
      const opt = document.createElement('option');
      opt.value = o.id; opt.textContent = o.name;
      sel.appendChild(opt);
    });
    sel.value = currentVal;
  }
  onFilterOriginChange();
}

async function fetchAndRender() {
  const s = getState();
  s.visibleCount = s.pageSize;
  const params = new URLSearchParams();
  if (s.activeStatus) params.set('status', s.activeStatus);
  if (s.searchQuery) params.set('q', s.searchQuery);
  for (const [k,v] of Object.entries(s.activeFilters)) {
    if (v) params.set(k, v);
  }
  const qs = params.toString();
  s.displayedCoffees = await api('/coffees' + (qs ? '?'+qs : ''));
  renderList();
}

function daysFromRoast(roastDate) {
  if (!roastDate) return null;
  const roast = new Date(roastDate); roast.setHours(0,0,0,0);
  const today = new Date(); today.setHours(0,0,0,0);
  return Math.floor((today - roast) / 86400000);
}

function getStatus(c) {
  if (c.finished_date) return {label:'Terminado',cls:'status-done'};
  if (c.opened_date)   return {label:'Abierto',cls:'status-open'};
  return {label:'Sin abrir',cls:''};
}

function sortedCoffees() {
  const s = getState();
  const arr = [...s.displayedCoffees];
  switch (s.currentSort) {
    case 'smart': return arr.sort((a, b) => {
      const statusOrder = c => c.finished_date ? 2 : c.opened_date ? 0 : 1;
      const sa = statusOrder(a), sb = statusOrder(b);
      if (sa !== sb) return sa - sb;
      if (sa < 2) return (a.roast_date || '').localeCompare(b.roast_date || '');
      return (b.finished_date || '').localeCompare(a.finished_date || '');
    });
    case 'roast_desc':  return arr.sort((a,b)=>(b.roast_date||'').localeCompare(a.roast_date||''));
    case 'roast_asc':   return arr.sort((a,b)=>(a.roast_date||'').localeCompare(b.roast_date||''));
    case 'rating_desc': return arr.sort((a,b)=>(b.rating||0)-(a.rating||0));
    case 'name_asc':    return arr.sort((a,b)=>a.name.localeCompare(b.name));
    default:            return arr;
  }
}

function renderList() {
  const s = getState();
  const el = document.getElementById('coffee-list');
  const info = document.getElementById('results-info');
  const total = s.displayedCoffees.length;
  if (total === 0) {
    info.textContent = '';
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">☕</div><h3>Sin cafés aquí</h3><p>Prueba a cambiar los filtros o añade uno nuevo</p></div>`;
    return;
  }
  const sorted = sortedCoffees();
  const showing = Math.min(s.visibleCount, total);
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
    const next = Math.min(s.pageSize, remaining);
    el.innerHTML += `<button class="btn-load-more" onclick="loadMore()">
      Mostrar ${next} más <span>(${remaining} restantes)</span>
    </button>`;
  }
}

function loadMore() {
  const s = getState();
  s.visibleCount += s.pageSize;
  renderList();
}

function showDetail(id) {
  const s = getState();
  const c = s.displayedCoffees.find(x=>x.id===id);
  if (!c) return;
  s.currentDetail = c;
  document.getElementById('detail-title').textContent = c.name;
  document.getElementById('unrate-btn').style.display = parseInt(c.rating,10)?'':'none';
  const rows = [
    ['Tostador',c.roaster],['Productor',c.producer],
    ['Variedad',c.varieties&&c.varieties.length?c.varieties.join(', '):null],
    ['País',c.origin],['Región',c.region],['Altitud',c.altitude?c.altitude+' m':null],
    ['Proceso',c.processes&&c.processes.length?c.processes.join(', '):null],
    ['🥛 Con leche vegetal',c.milk_types&&c.milk_types.length?c.milk_types.join(', '):null],
    ['Tienda',c.shop],
    ['Cantidad',c.quantity_g?c.quantity_g+'g':null],
    ['Precio/kg',c.price_kg?c.price_kg+'€':null],['Coste total',fmtPrice(c)],
    ['Compra',fmtDate(c.purchase_date)],['Tueste',fmtDate(c.roast_date)],
    ['Abierto',fmtDate(c.opened_date)],['Terminado',fmtDate(c.finished_date)],
  ].filter(([,v])=>v);
  const roastDays = daysFromRoast(c.roast_date);
  const freshBanner = roastDays !== null && roastDays < 14 && !c.finished_date
    ? `<div class="fresh-warning-banner">⏳ Aún en reposo — faltan <strong>${14 - roastDays} días</strong> para las dos semanas desde el tueste (${roastDays} días de ${14}).</div>` : '';

  const remainingRow = c.quantity_g != null ? `
    <div class="detail-row" id="remaining-display-row">
      <span class="detail-label">☕ Restante</span>
      <span class="detail-val" style="display:flex;align-items:center;gap:6px">
        <span id="remaining-display">${c.remaining_g != null ? c.remaining_g + 'g' : '—'}</span>
        <button class="btn-inline-edit" onclick="editRemainingInline()" title="Editar">✏️</button>
      </span>
    </div>
    <div class="detail-row" id="remaining-edit-row" style="display:none">
      <span class="detail-label">☕ Restante</span>
      <span class="detail-val">
        <span class="remaining-edit-row">
          <input class="remaining-input" type="number" id="remaining-input" value="${c.remaining_g ?? ''}" min="0" onkeydown="if(event.key==='Enter')saveRemaining();if(event.key==='Escape')cancelEditRemaining()">
          <span style="color:var(--text3);font-size:13px">g</span>
          <button class="btn-quick" onclick="saveRemaining()" style="padding:4px 10px;font-size:12px">✓</button>
          <button class="btn-quick" onclick="cancelEditRemaining()" style="padding:4px 10px;font-size:12px">✕</button>
        </span>
      </span>
    </div>` : '';

  const consumeBtn = !c.finished_date ? `<button class="btn-consume" onclick="consumeCoffee()">☕ Consumir una toma (−${s.gramsPerShot}g)</button>` : '';

  document.getElementById('detail-content').innerHTML = `
    ${freshBanner}
    <div style="margin-bottom:12px">${stars(c.rating)}</div>
    ${rows.map(([l,v])=>`<div class="detail-row"><span class="detail-label">${esc(l)}</span><span class="detail-val">${esc(String(v))}</span></div>`).join('')}
    ${remainingRow}
    ${c.notes?`<div style="margin-top:14px;font-size:14px;color:var(--text2);line-height:1.6;font-style:italic">"${esc(c.notes)}"</div>`:''}
    ${consumeBtn}
  `;
  openModal('modal-detail');
}

window.showDetail = showDetail;

async function confirmOpen(e, id) {
  e.stopPropagation();
  const s = getState();
  const date = document.getElementById('open-date-'+id)?.value || new Date().toISOString().split('T')[0];
  const updated = await api('/coffees/'+id+'/open', {method:'POST', body:JSON.stringify({date})});
  const i = s.displayedCoffees.findIndex(c=>c.id===id);
  if (i!==-1) s.displayedCoffees[i]=updated;
  if (s.currentDetail?.id===id) s.currentDetail=updated;
  renderList(); showToast('📦 Marcado como abierto');
  await loadOptions();
}

async function quickFinish(e, id) {
  e.stopPropagation();
  const s = getState();
  const updated = await api('/coffees/'+id+'/finish', {method:'POST'});
  const i = s.displayedCoffees.findIndex(c=>c.id===id);
  if (i!==-1) s.displayedCoffees[i]=updated;
  if (s.currentDetail?.id===id) s.currentDetail=updated;
  renderList(); showToast('✅ Marcado como terminado');
}

window.confirmOpen = confirmOpen;
window.quickFinish = quickFinish;

function showOpenDatePicker(e, id) {
  e.stopPropagation();
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('actions-'+id).innerHTML = `
    <div class="open-date-row" onclick="event.stopPropagation()">
      <input type="date" class="form-input" id="open-date-${id}" value="${today}">
      <button class="btn-quick open" onclick="confirmOpen(event,${id})">✓ Confirmar</button>
      <button class="btn-quick" onclick="event.stopPropagation();renderList()">✕</button>
    </div>`;
}

window.showOpenDatePicker = showOpenDatePicker;

function editRemainingInline() {
  document.getElementById('remaining-display-row').style.display = 'none';
  document.getElementById('remaining-edit-row').style.display = '';
  const inp = document.getElementById('remaining-input');
  inp.focus(); inp.select();
}

window.editRemainingInline = editRemainingInline;

function cancelEditRemaining() {
  document.getElementById('remaining-display-row').style.display = '';
  document.getElementById('remaining-edit-row').style.display = 'none';
}

window.cancelEditRemaining = cancelEditRemaining;

async function saveRemaining() {
  const s = getState();
  const val = parseInt(document.getElementById('remaining-input').value, 10);
  if (isNaN(val) || val < 0) { showToast('⚠️ Valor inválido'); return; }
  const updated = await api('/coffees/'+s.currentDetail.id+'/remaining', {method:'PUT', body:JSON.stringify({remaining_g:val})});
  const i = s.displayedCoffees.findIndex(c=>c.id===s.currentDetail.id);
  if (i!==-1) s.displayedCoffees[i]=updated;
  s.currentDetail = updated;
  showDetail(updated.id);
  showToast('✓ Café restante actualizado');
}

window.saveRemaining = saveRemaining;

async function consumeCoffee() {
  const s = getState();
  if (!s.currentDetail) return;
  const result = await api('/coffees/'+s.currentDetail.id+'/consume', {method:'POST'});
  const updated = result.coffee;
  const i = s.displayedCoffees.findIndex(c=>c.id===updated.id);
  if (i!==-1) s.displayedCoffees[i]=updated;
  s.currentDetail = updated;
  showDetail(updated.id);
  renderList();
  if (result.remaining_g <= 0) {
    showConfirm({
      icon: '☕',
      title: '¿Marcar como terminado?',
      msg: `"${updated.name}" se ha quedado sin café restante. ¿Marcarlo como terminado con la fecha de hoy?`,
      btnLabel: 'Marcar como terminado',
      btnClass: 'btn-primary',
      onConfirm: async () => {
        const finished = await api('/coffees/'+updated.id+'/finish', {method:'POST'});
        const j = s.displayedCoffees.findIndex(c=>c.id===finished.id);
        if (j!==-1) s.displayedCoffees[j]=finished;
        s.currentDetail = finished;
        showDetail(finished.id);
        renderList();
        showToast('✅ Café terminado');
      }
    });
  } else {
    showToast(`☕ −${result.consumed_g}g · Quedan ${result.remaining_g}g`);
  }
}

window.consumeCoffee = consumeCoffee;

function editCurrent() {
  const s = getState();
  closeModal('modal-detail');
  openEditModal(s.currentDetail);
}

function duplicateCurrent() {
  const s = getState();
  if (!s.currentDetail) return;
  const c = s.currentDetail;
  closeModal('modal-detail');
  resetForm();
  document.getElementById('modal-title').textContent = 'Nueva bolsa';
  document.getElementById('f-name').value = c.name || '';
  document.getElementById('f-roaster').value = c.roaster || '';
  document.getElementById('f-producer').value = c.producer || '';
  document.getElementById('f-origin').value = c.origin || '';
  document.getElementById('f-region').value = c.region || '';
  document.getElementById('f-shop').value = c.shop || '';
  s.selectedVarieties = Array.isArray(c.varieties)  ? [...c.varieties]  : [];
  s.selectedProcesses = Array.isArray(c.processes)  ? [...c.processes]  : [];
  s.selectedMilkTypes = Array.isArray(c.milk_types) ? [...c.milk_types] : [];
  renderChips('varieties'); renderChips('processes'); renderChips('milk_types');
  onOriginChange();
  document.getElementById('f-quantity').value = c.quantity_g || '';
  document.getElementById('f-price').value = c.price_kg || '';
  document.getElementById('f-altitude').value = c.altitude || '';
  document.getElementById('f-notes').value = c.notes || '';
  document.getElementById('f-purchase').value = new Date().toISOString().split('T')[0];
  openModal('modal-form');
}

async function unrateCurrent() {
  const s = getState();
  if (!s.currentDetail) return;
  const updated = await api('/coffees/'+s.currentDetail.id+'/unrate', {method:'POST'});
  const i = s.displayedCoffees.findIndex(c=>c.id===s.currentDetail.id);
  if (i!==-1) s.displayedCoffees[i]=updated;
  s.currentDetail = updated;
  showDetail(updated.id);
  renderList();
  showToast('☆ Valoración eliminada');
}

window.editCurrent = editCurrent;
window.duplicateCurrent = duplicateCurrent;
window.unrateCurrent = unrateCurrent;

function resetForm() {
  const s = getState();
  document.getElementById('coffee-form').reset();
  document.getElementById('f-id').value='';
  document.getElementById('f-rating').value='';
  document.querySelectorAll('.rating-star').forEach(st=>st.classList.remove('active'));
  document.getElementById('edit-actions').style.display='none';
  document.getElementById('modal-title').textContent='Nuevo café';
  s.selectedVarieties = []; renderChips('varieties');
  s.selectedProcesses = []; renderChips('processes');
  s.selectedMilkTypes = []; renderChips('milk_types');
  if (document.getElementById('region-hint')) document.getElementById('region-hint').textContent='';
}

function openAddModal() {
  resetForm();
  document.getElementById('f-purchase').value = new Date().toISOString().split('T')[0];
  openModal('modal-form');
}

function openEditModal(c) {
  const s = getState();
  resetForm();
  document.getElementById('modal-title').textContent='Editar café';
  document.getElementById('f-id').value=c.id;
  document.getElementById('f-name').value=c.name||'';
  document.getElementById('f-roaster').value=c.roaster||'';
  document.getElementById('f-producer').value=c.producer||'';
  document.getElementById('f-origin').value=c.origin||'';
  document.getElementById('f-region').value=c.region||'';
  document.getElementById('f-shop').value=c.shop||'';
  s.selectedVarieties = Array.isArray(c.varieties)   ? [...c.varieties]   : [];
  s.selectedProcesses = Array.isArray(c.processes)   ? [...c.processes]   : [];
  s.selectedMilkTypes = Array.isArray(c.milk_types)  ? [...c.milk_types]  : [];
  renderChips('varieties'); renderChips('processes'); renderChips('milk_types');
  onOriginChange();
  document.getElementById('f-quantity').value=c.quantity_g||'';
  document.getElementById('f-price').value=c.price_kg||'';
  document.getElementById('f-purchase').value=c.purchase_date||'';
  document.getElementById('f-roast').value=c.roast_date||'';
  document.getElementById('f-opened').value=c.opened_date||'';
  document.getElementById('f-finished').value=c.finished_date||'';
  document.getElementById('f-notes').value=c.notes||'';
  document.getElementById('f-altitude').value=c.altitude||'';
  const r=parseInt(c.rating,10);
  if (r>=1&&r<=5) setRating(r);
  document.getElementById('edit-actions').style.display='flex';
  openModal('modal-form');
}

window.openAddModal = openAddModal;
window._openAddModal = openAddModal;

async function submitForm(e) {
  e.preventDefault();
  const s = getState();
  const id = document.getElementById('f-id').value;
  const rv = document.getElementById('f-rating').value;
  const data = {
    name:          document.getElementById('f-name').value,
    roaster:       document.getElementById('f-roaster').value||null,
    producer:      document.getElementById('f-producer').value||null,
    varieties:     s.selectedVarieties.length ? [...s.selectedVarieties] : [],
    origin:        document.getElementById('f-origin').value||null,
    region:        document.getElementById('f-region').value||null,
    processes:     s.selectedProcesses.length ? [...s.selectedProcesses] : [],
    milk_types:    s.selectedMilkTypes.length  ? [...s.selectedMilkTypes]  : [],
    shop:          document.getElementById('f-shop').value||null,
    quantity_g:    document.getElementById('f-quantity').value?parseInt(document.getElementById('f-quantity').value):null,
    price_kg:      document.getElementById('f-price').value?parseFloat(document.getElementById('f-price').value):null,
    purchase_date: document.getElementById('f-purchase').value||null,
    roast_date:    document.getElementById('f-roast').value||null,
    opened_date:   document.getElementById('f-opened').value||null,
    finished_date: document.getElementById('f-finished').value||null,
    rating:        rv?parseInt(rv):null,
    notes:         document.getElementById('f-notes').value||null,
    altitude:      document.getElementById('f-altitude').value?parseInt(document.getElementById('f-altitude').value):null,
  };
  if (data.region && data.origin) {
    const region = (s.allOptions.regions||[]).find(r => r.name.toLowerCase() === data.region.toLowerCase());
    const origin = (s.allOptions.origins||[]).find(o => o.name.toLowerCase() === data.origin.toLowerCase());
    if (region && region.origin_id && origin && region.origin_id !== origin.id) {
      const correct = (s.allOptions.origins||[]).find(o => o.id === region.origin_id);
      showToast(`⚠️ La región "${data.region}" pertenece a "${correct ? correct.name : '?'}", no a "${data.origin}"`);
      return;
    }
  }
  if (id) await api('/coffees/'+id, {method:'PUT', body:JSON.stringify(data)});
  else    await api('/coffees',     {method:'POST',body:JSON.stringify(data)});
  closeModal('modal-form');
  showToast(id?'☕ Café actualizado':'☕ Café añadido');
  await loadOptions();
  populateFilterSelects();
  await fetchAndRender();
}

async function deleteCoffee() {
  const id = document.getElementById('f-id').value;
  if (!id) return;
  const name = document.getElementById('f-name').value;
  showConfirm({
    icon: '🗑', title: 'Eliminar café',
    msg: `¿Eliminar "${name}"? Esta acción no se puede deshacer.`,
    btnLabel: 'Eliminar', btnClass: 'btn-danger',
    onConfirm: async () => {
      await api('/coffees/'+id, {method:'DELETE'});
      closeModal('modal-form');
      showToast('Café eliminado');
      await fetchAndRender();
    }
  });
}

window.submitForm = submitForm;
window.deleteCoffee = deleteCoffee;

function setStatus(s, btn) {
  const state = getState();
  state.activeStatus = s;
  document.querySelectorAll('.fb').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  fetchAndRender();
}

window.setStatus = setStatus;

function onSearch(val) {
  const state = getState();
  clearTimeout(state.searchQuery);
  state.searchQuery = setTimeout(()=>{
    const s = getState();
    s.searchQuery = val.trim();
    fetchAndRender();
  }, 280);
}

window.onSearch = onSearch;

function onSortChange() {
  const s = getState();
  s.currentSort = document.getElementById('sort-select').value;
  s.visibleCount = s.pageSize;
  renderList();
}

window.onSortChange = onSortChange;

function toggleFilterPanel() {
  const p = document.getElementById('filter-panel');
  const a = document.getElementById('filter-arrow');
  p.classList.toggle('open');
  a.textContent = p.classList.contains('open') ? '⌄' : '›';
}

window.toggleFilterPanel = toggleFilterPanel;

function applyFilters() {
  const s = getState();
  s.activeFilters = {
    roaster_id:  document.getElementById('f-filter-roaster').value,
    producer_id: document.getElementById('f-filter-producer').value,
    origin_id:   document.getElementById('f-filter-origin').value,
    region_id:   document.getElementById('f-filter-region').value,
    process_id:  document.getElementById('f-filter-process').value,
    variety_id:  document.getElementById('f-filter-variety').value,
    shop_id:     document.getElementById('f-filter-shop').value,
  };
  const active = Object.values(s.activeFilters).filter(Boolean).length;
  const badge = document.getElementById('filter-badge');
  badge.textContent = active;
  badge.classList.toggle('show', active > 0);
  fetchAndRender();
}

window.applyFilters = applyFilters;

function clearFilters() {
  const sortVal = document.getElementById('sort-select').value;
  document.querySelectorAll('.filter-select').forEach(sel=>sel.value='');
  document.getElementById('sort-select').value = sortVal;
  onFilterOriginChange();
  const s = getState();
  s.activeFilters = {};
  document.getElementById('filter-badge').classList.remove('show');
  fetchAndRender();
}

window.clearFilters = clearFilters;

window.loadMore = loadMore;
window.renderList = renderList;

// Stats
async function loadStats() {
  const [stats, coffees] = await Promise.all([api('/stats'), api('/coffees')]);
  setCalCoffees(coffees);

  const dpkg = stats.days_per_kg ? `${stats.days_per_kg} días/kg` : '–';
  document.getElementById('stats-grid').innerHTML = `
    <div class="stat-card"><div class="stat-val">${stats.total - stats.active - stats.finished}</div><div class="stat-label">Disponibles</div>${stats.pending_weight_g?`<div class="stat-sub">${fmtWeight(stats.pending_weight_g)}</div>`:''}</div>
    <div class="stat-card"><div class="stat-val">${stats.active}</div><div class="stat-label">En uso</div>${stats.active_weight_g?`<div class="stat-sub">${fmtWeight(stats.active_weight_g)} restantes</div>`:''}</div>
    <div class="stat-card"><div class="stat-val">${stats.avg_rating?'⭐ '+stats.avg_rating:'–'}</div><div class="stat-label">Valoración media</div></div>
    <div class="stat-card"><div class="stat-val">${stats.avg_cost_kg?stats.avg_cost_kg+'€/kg':'–'}</div><div class="stat-label">Coste medio/kg</div></div>
    <div class="stat-card" style="grid-column:1/-1"><div class="stat-val" style="font-size:22px">${dpkg}</div><div class="stat-label">Consumo medio normalizado (días para 1 kg)</div></div>
  `;

  renderCalendar();

  const chartsEl = document.getElementById('stats-charts');
  chartsEl.textContent = '';
  if (stats.top_roasters?.length) chartsEl.insertAdjacentHTML('beforeend', buildBarChart('Tostadores más usados', stats.top_roasters));
  if (stats.origins_breakdown?.length) chartsEl.insertAdjacentHTML('beforeend', buildBarChart('Por país de origen', stats.origins_breakdown));
  if (stats.processes_breakdown?.length) chartsEl.insertAdjacentHTML('beforeend', buildBarChart('Por proceso', stats.processes_breakdown));
  if (stats.varieties_breakdown?.length) chartsEl.insertAdjacentHTML('beforeend', buildBarChart('Por variedad', stats.varieties_breakdown));
}

function buildBarChart(title, data) {
  const max = Math.max(...data.map(r=>r.cnt));
  const rows = data.map(r=>{
    const rating = r.avg_rating != null ? ` · ⭐${r.avg_rating}` : '';
    return `<div class="bar-row"><span class="bar-label" title="${esc(r.name)}">${esc(r.name)}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.round(r.cnt/max*100)}%"></div></div><span class="bar-cnt">${r.cnt}${rating}</span></div>`;
  }).join('');
  return `<div class="stats-section"><h3>${title}</h3>${rows}</div>`;
}

window.loadStats = loadStats;

// Catalog
const CATALOG_LABELS = {
  roasters:'Tostadores', producers:'Productores', shops:'Tiendas',
  origins:'Países de origen', regions:'Regiones', varieties:'Variedades', processes:'Procesos',
  milk_types:'Leches vegetales'
};

function loadCatalog() {
  const s = getState();
  const el = document.getElementById('catalog-content');
  el.innerHTML = '<div class="loading">Cargando...</div>';
  Promise.all(
    s.lookupTables.map(t => api('/lookup/'+t).then(data => ({table:t, data})))
  ).then(results => {
    el.innerHTML = results.map(({table, data}) => {
      const orphans = data.filter(r => r.coffee_count === 0).length;
      const badge = `<span class="catalog-badge ${orphans?'has-orphans':''}" id="cat-badge-${table}">${data.length} entrada${data.length!==1?'s':''}${orphans?' · '+orphans+' sin usar':''}</span>`;
      const rows = data.map(r => `
        <div class="catalog-row" id="crow-${table}-${r.id}">
          <span class="catalog-row-name" id="cname-${table}-${r.id}">${esc(r.name)}</span>
          <input class="catalog-row-input" id="cinput-${table}-${r.id}" value="${esc(r.name)}" onkeydown="catalogKeydown(event,'${table}',${r.id})" onfocus="this.select()">
          <span class="catalog-count ${r.coffee_count===0?'zero':''}" title="${r.coffee_count} café(s)">${r.coffee_count===0?'✕':r.coffee_count}</span>
          <button class="btn-icon" id="cedit-${table}-${r.id}" onclick="catalogStartEdit('${table}',${r.id})" title="Renombrar">✏️</button>
          <button class="btn-icon save" id="csave-${table}-${r.id}" style="display:none" onclick="catalogSave('${table}',${r.id})" title="Guardar">✓</button>
          <button class="btn-icon" id="ccancel-${table}-${r.id}" style="display:none" onclick="catalogCancelEdit('${table}',${r.id})" title="Cancelar">✕</button>
          <button class="btn-icon danger" onclick="catalogDelete('${table}',${r.id},${r.coffee_count})" title="Eliminar" ${r.coffee_count>0?'disabled style="opacity:0.3;cursor:not-allowed"':''}>🗑</button>
        </div>`).join('');
      const purgeBtn = orphans ? `<div class="catalog-purge"><button class="btn-purge" onclick="catalogPurge('${table}')">🧹 Eliminar ${orphans} huérfano${orphans!==1?'s':''}</button></div>` : '';
      return `<div class="catalog-section">
        <div class="catalog-header" onclick="toggleCatalogSection('${table}')">
          <div class="catalog-header-left"><span class="catalog-title">${CATALOG_LABELS[table]}</span>${badge}</div>
          <span id="cat-arrow-${table}" style="color:var(--text3)">›</span>
        </div>
        <div class="catalog-body" id="catbody-${table}">${rows || '<div style="padding:14px 16px;color:var(--text3);font-size:13px">Sin entradas</div>'}${purgeBtn}</div>
      </div>`;
    }).join('');
  });
}

function toggleCatalogSection(table) {
  const body = document.getElementById('catbody-'+table);
  const arrow = document.getElementById('cat-arrow-'+table);
  body.classList.toggle('open');
  arrow.textContent = body.classList.contains('open') ? '⌄' : '›';
}

function catalogStartEdit(table, id) {
  document.getElementById('cname-'+table+'-'+id).style.display = 'none';
  document.getElementById('cinput-'+table+'-'+id).style.display = 'block';
  document.getElementById('cedit-'+table+'-'+id).style.display = 'none';
  document.getElementById('csave-'+table+'-'+id).style.display = 'flex';
  document.getElementById('ccancel-'+table+'-'+id).style.display = 'flex';
  document.getElementById('cinput-'+table+'-'+id).focus();
}

function catalogCancelEdit(table, id) {
  const nameEl = document.getElementById('cname-'+table+'-'+id);
  document.getElementById('cinput-'+table+'-'+id).value = nameEl.textContent;
  nameEl.style.display = '';
  document.getElementById('cinput-'+table+'-'+id).style.display = 'none';
  document.getElementById('cedit-'+table+'-'+id).style.display = '';
  document.getElementById('csave-'+table+'-'+id).style.display = 'none';
  document.getElementById('ccancel-'+table+'-'+id).style.display = 'none';
}

function catalogKeydown(e, table, id) {
  if (e.key === 'Enter') catalogSave(table, id);
  if (e.key === 'Escape') catalogCancelEdit(table, id);
}

async function catalogSave(table, id) {
  const input = document.getElementById('cinput-'+table+'-'+id);
  const newName = input.value.trim();
  if (!newName) return;
  const r = await api('/lookup/'+table+'/'+id, {method:'PUT', body:JSON.stringify({name:newName})});
  if (r.error) { showToast('⚠️ '+r.error); return; }
  document.getElementById('cname-'+table+'-'+id).textContent = newName;
  catalogCancelEdit(table, id);
  await loadOptions();
  populateFilterSelects();
  showToast('✓ Renombrado correctamente');
}

function catalogDelete(table, id, count) {
  if (count > 0) return;
  const name = document.getElementById('cname-'+table+'-'+id)?.textContent || '';
  showConfirm({
    icon: '🗑', title: 'Eliminar entrada',
    msg: `¿Eliminar "${name}"?`,
    btnLabel: 'Eliminar', btnClass: 'btn-danger',
    onConfirm: async () => {
      const r = await api('/lookup/'+table+'/'+id, {method:'DELETE'});
      if (r.error) { showToast('⚠️ '+r.error); return; }
      document.getElementById('crow-'+table+'-'+id).remove();
      await loadOptions(); populateFilterSelects();
      const rows = document.querySelectorAll(`#catbody-${table} .catalog-row`);
      const orphanCounts = document.querySelectorAll(`#catbody-${table} .catalog-count.zero`);
      const total = rows.length, orphans = orphanCounts.length;
      const badge = document.getElementById('cat-badge-'+table);
      if (badge) { badge.className = `catalog-badge${orphans?' has-orphans':''}`; badge.textContent = `${total} entrada${total!==1?'s':''}${orphans?' · '+orphans+' sin usar':''}`; }
      const purgeEl = document.querySelector(`#catbody-${table} .catalog-purge`);
      if (!orphans && purgeEl) purgeEl.remove();
      else if (orphans && purgeEl) { const btn = purgeEl.querySelector('.btn-purge'); if (btn) btn.textContent = `🧹 Eliminar ${orphans} huérfano${orphans!==1?'s':''}`; }
      showToast('🗑 Entrada eliminada');
    }
  });
}

async function catalogPurge(table) {
  const r = await api('/lookup/'+table+'/purge', {method:'POST'});
  showToast(`🧹 ${r.deleted} entrada${r.deleted!==1?'s':''} eliminada${r.deleted!==1?'s':''}`);
  await loadOptions();
  populateFilterSelects();
  loadCatalog();
}

async function purgeAll() {
  const s = getState();
  showConfirm({
    icon: '🧹', title: 'Eliminar huérfanos',
    msg: '¿Eliminar todos los valores de referencia sin usar en ningún café?',
    btnLabel: 'Eliminar todos', btnClass: 'btn-danger',
    onConfirm: async () => {
      let total = 0;
      for (const t of s.lookupTables) {
        const r = await api('/lookup/'+t+'/purge', {method:'POST'});
        total += r.deleted || 0;
      }
      showToast(`🧹 ${total} entrada${total!==1?'s':''} eliminada${total!==1?'s':''}`);
      await loadOptions(); populateFilterSelects();
      loadCatalog();
    }
  });
}

window.toggleCatalogSection = toggleCatalogSection;
window.catalogStartEdit = catalogStartEdit;
window.catalogCancelEdit = catalogCancelEdit;
window.catalogKeydown = catalogKeydown;
window.catalogSave = catalogSave;
window.catalogDelete = catalogDelete;
window.catalogPurge = catalogPurge;
window.loadCatalog = loadCatalog;
window._purgeAll = purgeAll;
window.purgeAll = purgeAll;

// Settings
function openSettings() {
  const s = getState();
  document.getElementById('s-grams').value = s.gramsPerShot;
  openModal('modal-settings');
}

async function saveSettings() {
  const s = getState();
  const gps = parseInt(document.getElementById('s-grams').value, 10);
  if (isNaN(gps) || gps < 1 || gps > 100) { showToast('⚠️ Valor entre 1 y 100 g'); return; }
  await api('/settings', {method:'PUT', body:JSON.stringify({grams_per_shot:gps})});
  s.gramsPerShot = gps;
  showToast('✓ Ajustes guardados');
}

async function changePinSubmit() {
  const current = document.getElementById('cp-current').value;
  const newPin = document.getElementById('cp-new').value;
  const confirm = document.getElementById('cp-confirm').value;
  if (!/^\d{4}$/.test(newPin)) { showToast('⚠️ El PIN debe tener exactamente 4 dígitos'); return; }
  if (newPin !== confirm) { showToast('⚠️ Los PINs no coinciden'); return; }
  try {
    await api('/auth/change-pin', {method:'POST', body:JSON.stringify({current_pin:current, new_pin:newPin})});
    closeModal('modal-settings');
    document.getElementById('cp-current').value = '';
    document.getElementById('cp-new').value = '';
    document.getElementById('cp-confirm').value = '';
    showToast('✓ PIN cambiado correctamente');
  } catch { /* api() already shows toast */ }
}

window.openSettings = openSettings;
window._openSettings = openSettings;
window.saveSettings = saveSettings;
window.changePinSubmit = changePinSubmit;

// Pages
function showPage(name, tab) {
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  document.getElementById('page-'+name).classList.add('active');
  tab.classList.add('active');
  if (name==='stats') loadStats();
  if (name==='catalog') loadCatalog();
}

window._showPage = showPage;

// Add chip
function addChip(table, name) {
  const s = getState();
  const chips = table === 'varieties' ? 'selectedVarieties' : table === 'processes' ? 'selectedProcesses' : 'selectedMilkTypes';
  const n = name.trim();
  if (!n || s[chips].includes(n)) return;
  s[chips] = [...s[chips], n];
  renderChips(table);
  const inp = document.getElementById(table === 'varieties' ? 'f-variety-input' : table === 'processes' ? 'f-process-input' : 'f-milk-input');
  inp.value = '';
  document.getElementById('ac-'+table).classList.remove('open');
  inp.focus();
}

window.addChip = addChip;
window.removeChip = removeChip;

window.addEventListener('DOMContentLoaded', () => {
  initModals();
  authStartup();
});

// Expose init globally
window._init = async function init() {
  initState();
  const [, settings] = await Promise.all([loadOptions(), api('/settings')]);
  setState({ gramsPerShot: settings.grams_per_shot || 17 });
  await fetchAndRender();
};
