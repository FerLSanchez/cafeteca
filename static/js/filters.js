// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------
function setStatus(s, btn) {
  activeStatus = s;
  document.querySelectorAll('.fb').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  fetchAndRender();
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
  fetchAndRender();
}

function clearFilters() {
  const sortVal = document.getElementById('sort-select').value;
  document.querySelectorAll('.filter-select').forEach(s=>s.value='');
  document.getElementById('sort-select').value = sortVal;  // don't reset sort
  onFilterOriginChange();
  activeFilters = {};
  document.getElementById('filter-badge').classList.remove('show');
  fetchAndRender();
}
