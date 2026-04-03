// ---------------------------------------------------------------------------
// Chip input management (multi-select for varieties / processes / milk_types)
// ---------------------------------------------------------------------------
function addChip(table, name) {
  const cf = CHIP_FIELDS[table];
  if (!cf) return;
  const n = name.trim();
  if (!n || cf.state().includes(n)) return;
  cf.set([...cf.state(), n]);
  renderChips(table);
  const inp = document.getElementById(cf.inputId);
  inp.value = '';
  document.getElementById('ac-'+table).classList.remove('open');
  inp.focus();
}

function removeChip(table, idx) {
  const cf = CHIP_FIELDS[table];
  if (!cf) return;
  const arr = [...cf.state()];
  arr.splice(idx, 1);
  cf.set(arr);
  renderChips(table);
}

function renderChips(table) {
  const cf = CHIP_FIELDS[table];
  if (!cf) return;
  const el = document.getElementById(cf.chipsId);
  el.textContent = '';
  cf.state().forEach((v, i) => {
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

function chipKeydown(e, table) {
  if (e.key === 'Enter') {
    e.preventDefault();
    const val = e.target.value.trim();
    if (val) addChip(table, val);
  } else if (e.key === 'Backspace' && !e.target.value) {
    const cf = CHIP_FIELDS[table];
    if (cf && cf.state().length > 0) removeChip(table, cf.state().length - 1);
  }
}
