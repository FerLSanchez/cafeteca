// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------
function setStatus(s, btn) {
  activeStatus = s;
  document.querySelectorAll('.fb').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  saveListPrefs();
  fetchAndRender();
}

// Estado, orden y filtros avanzados se recuerdan entre visitas (la búsqueda no).
// localStorage puede fallar (modo privado): nunca debe romper la lista.
const LIST_PREFS_KEY = 'listPrefs';

function saveListPrefs() {
  try {
    localStorage.setItem(LIST_PREFS_KEY, JSON.stringify({status: activeStatus, sort: currentSort, filters: activeFilters}));
  } catch (_) {}
}

// Llamar tras loadOptions(): los desplegables ya tienen sus opciones. Ignora valores que ya no existen.
function restoreListPrefs() {
  let prefs = null;
  try { prefs = JSON.parse(localStorage.getItem(LIST_PREFS_KEY) || 'null'); } catch (_) {}
  if (!prefs || typeof prefs !== 'object') return;
  const pill = typeof prefs.status === 'string' && document.querySelector(`.fb[onclick*="setStatus('${CSS.escape(prefs.status)}'"]`);
  if (pill) {
    activeStatus = prefs.status;
    document.querySelectorAll('.fb').forEach(b => b.classList.toggle('active', b === pill));
  }
  const sortSel = document.getElementById('sort-select');
  if ([...sortSel.options].some(o => o.value === prefs.sort)) { sortSel.value = prefs.sort; currentSort = prefs.sort; }
  const ids = {roaster_id: 'roaster', producer_id: 'producer', origin_id: 'origin', region_id: 'region',
               process_id: 'process', variety_id: 'variety', shop_id: 'shop'};
  // País antes que región: la región se filtra por país
  for (const k of ['origin_id', ...Object.keys(ids).filter(k => k !== 'origin_id')]) {
    const sel = document.getElementById('f-filter-' + ids[k]);
    const v = prefs.filters?.[k];
    if (sel && v && [...sel.options].some(o => o.value === String(v))) {
      sel.value = String(v);
      if (k === 'origin_id') onFilterOriginChange();
    }
  }
  updateActiveFilters();
}

function onSearch(val) {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(()=>{ searchQuery = val.trim(); fetchAndRender(); }, 280);
}

function toggleFilterPanel() {
  const p = document.getElementById('filter-panel');
  const btn = document.getElementById('filter-toggle-btn');
  p.classList.toggle('open');
  btn.classList.toggle('active', p.classList.contains('open'));
}

function applyFilters() {
  updateActiveFilters();
  saveListPrefs();
  fetchAndRender();
}

function updateActiveFilters() {
  activeFilters = {
    roaster_id:  document.getElementById('f-filter-roaster').value,
    producer_id: document.getElementById('f-filter-producer').value,
    origin_id:   document.getElementById('f-filter-origin').value,
    region_id:   document.getElementById('f-filter-region').value,
    process_id:  document.getElementById('f-filter-process').value,
    variety_id:  document.getElementById('f-filter-variety').value,
    shop_id:     document.getElementById('f-filter-shop').value,
  };
  // Update badge
  const active = Object.values(activeFilters).filter(Boolean).length;
  const badge = document.getElementById('filter-badge');
  badge.textContent = active;
  badge.classList.toggle('show', active > 0);
}

function clearFilters() {
  const sortVal = document.getElementById('sort-select').value;
  document.querySelectorAll('.filter-select').forEach(s=>s.value='');
  document.getElementById('sort-select').value = sortVal;  // don't reset sort
  onFilterOriginChange();
  activeFilters = {};
  document.getElementById('filter-badge').classList.remove('show');
  saveListPrefs();
  fetchAndRender();
}
