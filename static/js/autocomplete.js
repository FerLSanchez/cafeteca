// ---------------------------------------------------------------------------
// Autocomplete
// ---------------------------------------------------------------------------
function acInput(input, table) {
  clearTimeout(acTimers[table]);
  acTimers[table] = setTimeout(()=>renderAC(input, table), 80);
}

function renderAC(input, table) {
  const val = input.value.trim().toLowerCase();
  const dropdown = document.getElementById('ac-'+table);
  const chipField = CHIP_FIELDS[table];
  let opts = (allOptions[table]||[]);

  // For chip fields: hide already-selected values
  if (chipField) opts = opts.filter(o => !chipField.state().includes(o.name));

  // For regions: filter by currently typed country
  if (table === 'regions') {
    const originName = (document.getElementById('f-origin')||{}).value||'';
    if (originName.trim()) {
      const origin = (allOptions.origins||[]).find(o => o.name.toLowerCase() === originName.trim().toLowerCase());
      if (origin) opts = opts.filter(o => !o.origin_id || o.origin_id === origin.id);
    }
  }

  const matches = val ? opts.filter(o=>o.name.toLowerCase().includes(val)) : opts;
  dropdown.textContent = '';

  matches.slice(0,10).forEach(o => {
    const div = document.createElement('div');
    div.className = 'ac-item';
    div.textContent = o.name;
    div.addEventListener('mousedown', e => {
      e.preventDefault();
      if (chipField) addChip(table, o.name);
      else acSelect(input.id, table, o.name);
    });
    dropdown.appendChild(div);
  });

  const exact = (allOptions[table]||[]).some(o => o.name.toLowerCase() === val);
  if (val && !exact) {
    const trimmed = input.value.trim();
    const div = document.createElement('div');
    div.className = 'ac-item new-entry';
    div.textContent = '+ Añadir "' + trimmed + '"';
    div.addEventListener('mousedown', e => {
      e.preventDefault();
      if (chipField) addChip(table, trimmed);
      else acSelect(input.id, table, trimmed);
    });
    dropdown.appendChild(div);
  }

  dropdown.classList.toggle('open', dropdown.children.length > 0);
}

function acSelect(inputId, table, value) {
  document.getElementById(inputId).value = value;
  document.getElementById('ac-'+table).classList.remove('open');
  if (table === 'origins') onOriginChange();
  if (table === 'regions') onRegionSelect(value);
}

function acBlur(table) {
  // Small delay so mousedown fires first
  setTimeout(()=>{ document.getElementById('ac-'+table).classList.remove('open'); }, 150);
  if (table === 'origins') setTimeout(onOriginChange, 160);
  if (table === 'regions') {
    const inp = document.getElementById('f-region');
    if (inp) setTimeout(() => onRegionSelect(inp.value), 160);
  }
}

// ---------------------------------------------------------------------------
// Region ↔ Country cascade
// ---------------------------------------------------------------------------
function onRegionSelect(regionName) {
  if (!regionName || !regionName.trim()) return;
  const region = (allOptions.regions||[]).find(r => r.name.toLowerCase() === regionName.trim().toLowerCase());
  if (!region || !region.origin_id) return;
  const origin = (allOptions.origins||[]).find(o => o.id === region.origin_id);
  if (!origin) return;
  const originInput = document.getElementById('f-origin');
  if (originInput) {
    originInput.value = origin.name;
    onOriginChange();
  }
}

function onOriginChange() {
  const originName = (document.getElementById('f-origin')||{}).value||'';
  const hint = document.getElementById('region-hint');
  const regionInput = document.getElementById('f-region');
  if (!hint) return;
  if (originName.trim()) {
    const origin = (allOptions.origins||[]).find(o => o.name.toLowerCase() === originName.trim().toLowerCase());
    if (origin) {
      // If the currently entered region belongs to a different country, clear it
      if (regionInput && regionInput.value.trim()) {
        const region = (allOptions.regions||[]).find(r => r.name.toLowerCase() === regionInput.value.trim().toLowerCase());
        if (region && region.origin_id && region.origin_id !== origin.id) {
          regionInput.value = '';
        }
      }
      const count = (allOptions.regions||[]).filter(r => r.origin_id === origin.id).length;
      hint.textContent = count ? count + ' región' + (count!==1?'es':'') + ' disponible' + (count!==1?'s':'') : '';
      return;
    }
  }
  hint.textContent = '';
}
