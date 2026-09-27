// ---------------------------------------------------------------------------
// Cata rápida: dos escalas de 5 puntos con el centro "en su punto".
//   taste_balance: −2 ácido … 0 equilibrado … +2 amargo  → corrige el flujo objetivo (molienda)
//   taste_body:    −2 aguado … 0 justo … +2 pesado       → sugiere el ratio (salida)
// Un toque marca, tocar el mismo punto lo quita (null = sin catar). El modelo está en grind-model.js.
// ---------------------------------------------------------------------------
const TASTE_SCALES = {taste_balance: 'balance', taste_body: 'body'};
const TASTE_VALUES = [-2, -1, 0, 1, 2];
const _tasteSuffix = v => (v < 0 ? 'm' : v > 0 ? 'p' : '') + Math.abs(v);
const tasteLabel = (field, v) => t(`brew.taste.${TASTE_SCALES[field]}_${_tasteSuffix(v)}`);

// Escala como una barra de 5 paradas (un toque, sin arrastrar). `onPick` recibe (field, value)
// como texto JS: p. ej. "setBrewTaste" o "quickTasteBrew.bind(null,12)".
function tasteScaleHtml(field, value, onPick, {compact = false} = {}) {
  const name = TASTE_SCALES[field];
  return `<div class="taste-scale${compact ? ' compact' : ''}" data-field="${field}">
    <div class="taste-scale-name">${esc(t('brew.taste.' + name))}</div>
    <div class="taste-track" role="radiogroup" aria-label="${esc(t('brew.taste.' + name))}">${TASTE_VALUES.map(v =>
      `<button type="button" class="taste-seg${v === value ? ' active' : ''}" data-val="${v}" role="radio"
        aria-checked="${v === value}" aria-label="${esc(tasteLabel(field, v))}"
        onclick="${onPick}('${field}',${v},this)"><span class="taste-dot"></span></button>`).join('')}</div>
    <div class="taste-ends" aria-hidden="true"><span>${esc(t(`brew.taste.${name}_lo`))}</span>`
      + `<span>${esc(t(`brew.taste.${name}_mid`))}</span><span>${esc(t(`brew.taste.${name}_hi`))}</span></div>
  </div>`;
}

function markTasteScale(scaleEl, value) {
  scaleEl?.querySelectorAll('.taste-seg').forEach(s => {
    const on = +s.dataset.val === value;
    s.classList.toggle('active', on);
    s.setAttribute('aria-checked', String(on));
  });
}

// "Algo ácido · Cuerpo justo" (vacío si no hay cata)
function tasteLine(b) {
  return Object.keys(TASTE_SCALES).filter(f => b[f] != null).map(f => tasteLabel(f, b[f])).join(' · ');
}

// --- Modal de brew (paso 4) ------------------------------------------------------------
let _brewTaste = {taste_balance: null, taste_body: null};

function renderBrewTaste(src = {}) {
  _brewTaste = {taste_balance: src.taste_balance ?? null, taste_body: src.taste_body ?? null};
  document.getElementById('b-taste').innerHTML = Object.keys(TASTE_SCALES)
    .map(f => tasteScaleHtml(f, _brewTaste[f], 'setBrewTaste')).join('');
}

function setBrewTaste(field, val, btn) {
  _brewTaste[field] = _brewTaste[field] === val ? null : val;
  markTasteScale(btn.closest('.taste-scale'), _brewTaste[field]);
  updateBrewSteps();
}

// --- Paso 3: salida sugerida por el cuerpo de los últimos shots --------------------------
function renderBrewRatioHint() {
  const el = document.getElementById('b-ratio-hint');
  if (!el) return;
  const s = !_editBrewId && _brewHistory ? suggestRatio(_brewHistory, parseFloat(document.getElementById('b-dose').value)) : null;
  el.hidden = !s;
  if (!s) { el.innerHTML = ''; el.dataset.yield = ''; return; }
  el.dataset.yield = s.yield_g;
  el.innerHTML = `<span><b>${esc(t('grind.suggested_label'))}</b> ${esc(s.yield_g + ' g')}`
    + ` · ${esc(t(s.body < 0 ? 'brew.ratio_hint_thin' : 'brew.ratio_hint_heavy', {from: s.from, ratio: s.ratio}))}</span>`
    + `<button type="button" class="brew-grind-use" onclick="useSuggestedYield()"`
    + ` aria-label="${esc(t('brew.ratio_use_aria', {yield: s.yield_g}))}"></button>`;
  syncYieldUse();
}

function useSuggestedYield() {
  const y = document.getElementById('b-ratio-hint').dataset.yield;
  if (!y) return;
  document.getElementById('b-yield').value = y;
  updateBrewRatioDisplay();
}

function syncYieldUse() {
  const hint = document.getElementById('b-ratio-hint');
  const btn = hint?.querySelector('.brew-grind-use');
  if (!btn) return;
  const applied = parseFloat(document.getElementById('b-yield').value) === parseFloat(hint.dataset.yield);
  btn.disabled = applied;
  btn.textContent = applied ? '✓' : t('grind.use');
}

// --- Valorar después (Prepas y ficha) ----------------------------------------------------
async function quickTasteBrew(id, field, val, btn) {
  const b = _brewCache[id] || {};
  const next = b[field] === val ? null : val;
  markTasteScale(btn.closest('.taste-scale'), next);
  await api('/brews/' + id, {method: 'PUT', body: JSON.stringify({[field]: next})});
  if (_brewCache[id]) _brewCache[id][field] = next;
  afterQuickRate(id);
}
