import { getState } from '../state.js';
import { esc } from '../api.js';

let acTimers = {};

export function acInput(input, table) {
  clearTimeout(acTimers[table]);
  acTimers[table] = setTimeout(()=>renderAC(input, table), 80);
}

export function renderAC(input, table) {
  const s = getState();
  const val = input.value.trim().toLowerCase();
  const dropdown = document.getElementById('ac-'+table);
  const chipField = table === 'varieties' || table === 'processes' || table === 'milk_types';
  let opts = (s.allOptions[table]||[]);

  if (chipField) {
    const chips = table === 'varieties' ? s.selectedVarieties : table === 'processes' ? s.selectedProcesses : s.selectedMilkTypes;
    opts = opts.filter(o => !chips.includes(o.name));
  }

  if (table === 'regions') {
    const originName = (document.getElementById('f-origin')||{}).value||'';
    if (originName.trim()) {
      const origin = (s.allOptions.origins||[]).find(o => o.name.toLowerCase() === originName.trim().toLowerCase());
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
      if (chipField) window.addChip(table, o.name);
      else acSelect(input.id, table, o.name);
    });
    dropdown.appendChild(div);
  });

  const exact = (s.allOptions[table]||[]).some(o => o.name.toLowerCase() === val);
  if (val && !exact) {
    const trimmed = input.value.trim();
    const div = document.createElement('div');
    div.className = 'ac-item new-entry';
    div.textContent = '+ Añadir "' + trimmed + '"';
    div.addEventListener('mousedown', e => {
      e.preventDefault();
      if (chipField) window.addChip(table, trimmed);
      else acSelect(input.id, table, trimmed);
    });
    dropdown.appendChild(div);
  }

  dropdown.classList.toggle('open', dropdown.children.length > 0);
}

export function acSelect(inputId, table, value) {
  document.getElementById(inputId).value = value;
  document.getElementById('ac-'+table).classList.remove('open');
  if (table === 'origins') onOriginChange();
  if (table === 'regions') onRegionSelect(value);
}

export function acBlur(table) {
  setTimeout(()=>{ document.getElementById('ac-'+table).classList.remove('open'); }, 150);
  if (table === 'origins') setTimeout(onOriginChange, 160);
  if (table === 'regions') {
    const inp = document.getElementById('f-region');
    if (inp) setTimeout(() => onRegionSelect(inp.value), 160);
  }
}

export function removeChip(table, idx) {
  const s = getState();
  const chips = table === 'varieties' ? 'selectedVarieties' : table === 'processes' ? 'selectedProcesses' : 'selectedMilkTypes';
  const arr = [...s[chips]];
  arr.splice(idx, 1);
  s[chips] = arr;
  renderChips(table);
}

export function renderChips(table) {
  const s = getState();
  const chips = table === 'varieties' ? s.selectedVarieties : table === 'processes' ? s.selectedProcesses : s.selectedMilkTypes;
  const chipsId = table === 'varieties' ? 'varieties-chips' : table === 'processes' ? 'processes-chips' : 'milk-chips';
  const el = document.getElementById(chipsId);
  if (!el) return;
  el.textContent = '';
  chips.forEach((v, i) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    const txt = document.createElement('span');
    txt.textContent = v;
    const btn = document.createElement('button');
    btn.className = 'chip-x';
    btn.type = 'button';
    btn.textContent = '×';
    btn.addEventListener('mousedown', e => { e.preventDefault(); removeChip(table, i); });
    chip.appendChild(txt);
    chip.appendChild(btn);
    el.appendChild(chip);
  });
}

export function chipKeydown(e, table) {
  if (e.key === 'Enter') {
    e.preventDefault();
    const val = e.target.value.trim();
    if (val) window.addChip(table, val);
  } else if (e.key === 'Backspace' && !e.target.value) {
    const s = getState();
    const chips = table === 'varieties' ? s.selectedVarieties : table === 'processes' ? s.selectedProcesses : s.selectedMilkTypes;
    if (chips.length > 0) removeChip(table, chips.length - 1);
  }
}

export function onRegionSelect(regionName) {
  const s = getState();
  if (!regionName || !regionName.trim()) return;
  const region = (s.allOptions.regions||[]).find(r => r.name.toLowerCase() === regionName.trim().toLowerCase());
  if (!region || !region.origin_id) return;
  const origin = (s.allOptions.origins||[]).find(o => o.id === region.origin_id);
  if (!origin) return;
  const originInput = document.getElementById('f-origin');
  if (originInput) {
    originInput.value = origin.name;
    onOriginChange();
  }
}

export function onOriginChange() {
  const s = getState();
  const originName = (document.getElementById('f-origin')||{}).value||'';
  const hint = document.getElementById('region-hint');
  const regionInput = document.getElementById('f-region');
  if (!hint) return;
  if (originName.trim()) {
    const origin = (s.allOptions.origins||[]).find(o => o.name.toLowerCase() === originName.trim().toLowerCase());
    if (origin) {
      if (regionInput && regionInput.value.trim()) {
        const region = (s.allOptions.regions||[]).find(r => r.name.toLowerCase() === regionInput.value.trim().toLowerCase());
        if (region && region.origin_id && region.origin_id !== origin.id) {
          regionInput.value = '';
        }
      }
      const count = (s.allOptions.regions||[]).filter(r => r.origin_id === origin.id).length;
      hint.textContent = count ? count + ' región' + (count!==1?'es':'') + ' disponible' + (count!==1?'s':'') : '';
      return;
    }
  }
  hint.textContent = '';
}

export function onFilterOriginChange() {
  const s = getState();
  const originSel = document.getElementById('f-filter-origin');
  const regionSel = document.getElementById('f-filter-region');
  if (!originSel || !regionSel) return;
  const originId = originSel.value ? parseInt(originSel.value) : null;
  const currentRegion = regionSel.value;
  while (regionSel.options.length > 1) regionSel.remove(1);
  const regions = (s.allOptions.regions || []).filter(r => !originId || !r.origin_id || r.origin_id === originId);
  regions.forEach(r => {
    const opt = document.createElement('option');
    opt.value = r.id;
    opt.textContent = r.name;
    regionSel.appendChild(opt);
  });
  regionSel.value = regions.some(r => String(r.id) === currentRegion) ? currentRegion : '';
}
