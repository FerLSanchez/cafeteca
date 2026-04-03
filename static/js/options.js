// ---------------------------------------------------------------------------
// Options (lookup data)
// ---------------------------------------------------------------------------
async function loadOptions() {
  allOptions = await api('/options');
  LOOKUP_TABLES = Object.keys(allOptions);  // stay in sync with server
  populateFilterSelects();
}

function populateFilterSelects() {
  const map = {
    roasters:'f-filter-roaster', producers:'f-filter-producer',
    origins:'f-filter-origin', regions:'f-filter-region',
    processes:'f-filter-process', varieties:'f-filter-variety',
    shops:'f-filter-shop'
  };
  for (const [table, selId] of Object.entries(map)) {
    const sel = document.getElementById(selId);
    if (!sel) continue;
    const currentVal = sel.value;  // preserve active filter selection
    const first = sel.options[0];
    sel.textContent = '';
    sel.appendChild(first);
    (allOptions[table]||[]).forEach(o => {
      const opt = document.createElement('option');
      opt.value = o.id; opt.textContent = o.name;
      sel.appendChild(opt);
    });
    sel.value = currentVal;  // restore
  }
  // Re-apply region cascade after repopulating
  onFilterOriginChange();
}

function onFilterOriginChange() {
  const originSel = document.getElementById('f-filter-origin');
  const regionSel = document.getElementById('f-filter-region');
  if (!originSel || !regionSel) return;
  const originId = originSel.value ? parseInt(originSel.value) : null;
  const currentRegion = regionSel.value;
  // Remove all region options except first placeholder
  while (regionSel.options.length > 1) regionSel.remove(1);
  const regions = (allOptions.regions || []).filter(r => !originId || !r.origin_id || r.origin_id === originId);
  regions.forEach(r => {
    const opt = document.createElement('option');
    opt.value = r.id;
    opt.textContent = r.name;
    regionSel.appendChild(opt);
  });
  // Restore selection if still valid
  regionSel.value = regions.some(r => String(r.id) === currentRegion) ? currentRegion : '';
}
