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
// Teclado como un grupo de radios: una sola parada de Tab (la marcada o el centro) y ← → para moverse.
const _tabStop = (v, value) => (value == null ? v === 0 : v === value);
function tasteScaleHtml(field, value, onPick, {compact = false} = {}) {
  const name = TASTE_SCALES[field];
  return `<div class="taste-scale${compact ? ' compact' : ''}" data-field="${field}">
    <div class="taste-scale-name">${esc(t('brew.taste.' + name))}</div>
    <div class="taste-track" role="radiogroup" aria-label="${esc(t('brew.taste.' + name))}" onkeydown="tasteKey(event)">${TASTE_VALUES.map(v =>
      `<button type="button" class="taste-seg${v === value ? ' active' : ''}" data-val="${v}" role="radio"
        aria-checked="${v === value}" aria-label="${esc(tasteLabel(field, v))}" tabindex="${_tabStop(v, value) ? 0 : -1}"
        onclick="${onPick}('${field}',${v},this)"><span class="taste-dot"></span></button>`).join('')}</div>
    <div class="taste-ends" aria-hidden="true"><span>${esc(t(`brew.taste.${name}_lo`))}</span>`
      + `<span>${esc(t(`brew.taste.${name}_mid`))}</span><span>${esc(t(`brew.taste.${name}_hi`))}</span></div>
  </div>`;
}

function markTasteScale(scaleEl, value) {
  scaleEl?.querySelectorAll('.taste-seg').forEach(s => {
    const v = +s.dataset.val;
    s.classList.toggle('active', v === value);
    s.setAttribute('aria-checked', String(v === value));
    s.tabIndex = _tabStop(v, value) ? 0 : -1;
  });
}

// ← → (y ↑ ↓) mueven y marcan, como en un grupo de radios
function tasteKey(e) {
  const d = {ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1}[e.key];
  if (!d) return;
  e.preventDefault();
  const segs = [...e.currentTarget.querySelectorAll('.taste-seg')];
  const i = Math.max(0, segs.indexOf(document.activeElement));
  const next = segs[Math.min(segs.length - 1, Math.max(0, i + d))];
  if (next === segs[i] && next.classList.contains('active')) return;
  next.focus();
  if (!next.classList.contains('active')) next.click();
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

// --- Paso 3: salida aprendida del cuerpo de los últimos shots (y la receta como recomendación) ---
// Se ve solo cuando cambia algo respecto a la receta (o, sin receta, cuando el cuerpo no estaba en su punto)
function renderBrewRatioHint() {
  const el = document.getElementById('b-ratio-hint');
  if (!el) return;
  const dose = parseFloat(document.getElementById('b-dose').value);
  const rr = recipeRatio(_brewRecipe);
  const s = !_editBrewId && _brewHistory ? suggestRatio(_brewHistory, dose, rr) : null;
  const differs = s && (rr ? Math.abs(s.yield_g - dose * rr) >= 0.5 : Math.abs(s.body) >= 0.5);
  el.hidden = !differs;
  if (!differs) { el.innerHTML = ''; el.dataset.yield = ''; return; }
  el.dataset.yield = s.yield_g;
  el.innerHTML = `<span><b>${esc(t('grind.suggested_label'))}</b> ${esc(s.yield_g + ' g')}`
    + ` · ${esc(t('brew.ratio_learned', {ratio: s.ratio.toFixed(2), source: targetSourceLabel(s.source)}))}</span>`
    + `<button type="button" class="brew-grind-use" onclick="useSuggestedYield()"`
    + ` aria-label="${esc(t('brew.ratio_use_aria', {yield: s.yield_g}))}"></button>`;
  syncYieldUse();
}

// La báscula escribe la dosis ~10 veces/s: la pista se recalcula cuando la dosis se queda quieta
let _ratioHintTimer = null;
function scheduleBrewRatioHint() {
  clearTimeout(_ratioHintTimer);
  _ratioHintTimer = setTimeout(renderBrewRatioHint, 400);
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
// Primero las estrellas; las escalas aparecen al tocar una (o ya están si el brew tiene estrellas)
function quickTasteHtml(b) {
  return `<div class="quick-taste">${Object.keys(TASTE_SCALES).map(f =>
    tasteScaleHtml(f, b[f] ?? null, `quickTasteBrew.bind(null,${b.id})`, {compact: true})).join('')}</div>`;
}

function showQuickTaste(id, starBtn) {
  const block = starBtn?.closest('.quick-block');
  if (block && !block.querySelector('.quick-taste')) block.insertAdjacentHTML('beforeend', quickTasteHtml(_brewCache[id] || {id}));
}

async function quickTasteBrew(id, field, val, btn) {
  const b = _brewCache[id] || {};
  const next = b[field] === val ? null : val;
  markTasteScale(btn.closest('.taste-scale'), next);
  await api('/brews/' + id, {method: 'PUT', body: JSON.stringify({[field]: next})});
  if (_brewCache[id]) _brewCache[id][field] = next;
  afterQuickRate(id);
}
