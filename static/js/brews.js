// ---------------------------------------------------------------------------
// Brews tab — infinite scroll
// ---------------------------------------------------------------------------
const BREWS_PAGE = 20;
let _brewsOffset  = 0;
let _brewsLoading = false;
let _brewsHasMore = true;
let _brewsObserver = null;

// "+ Nueva preparación" en Prepas: elige entre las bolsas abiertas (si solo hay una, va directo)
async function newBrewFromBrews() {
  const open = await api('/coffees?status=active');
  if (!open.length) { showToast(t('brew.pick.none')); return; }
  if (open.length === 1) { openBrewModal(open[0].id, null, open[0].name); return; }
  document.getElementById('pick-coffee-list').innerHTML = open.map(c => `
    <button type="button" class="pick-coffee" onclick="closeModal('modal-pick-coffee');openBrewModal(${c.id},null,${esc(JSON.stringify(c.name))})">
      <span class="pick-coffee-name">${esc(c.name)}</span>
      <span class="pick-coffee-sub">${esc([c.roaster, c.remaining_g != null ? c.remaining_g + 'g' : null].filter(Boolean).join(' · '))}</span>
    </button>`).join('');
  openModal('modal-pick-coffee');
}

async function loadBrews(reset = true) {
  if (reset) {
    _brewsOffset  = 0;
    _brewsHasMore = true;
    if (_brewsObserver) { _brewsObserver.disconnect(); _brewsObserver = null; }
    document.getElementById('brews-list').innerHTML = `<div class="loading">${t('loading')}</div>`;
  }
  if (_brewsLoading || !_brewsHasMore) return;
  _brewsLoading = true;

  const data = await api(`/brews?limit=${BREWS_PAGE}&offset=${_brewsOffset}`);
  _brewsLoading = false;
  if (!data) return;

  const brews    = data.brews || [];
  _brewsHasMore  = data.has_more;
  _brewsOffset  += brews.length;

  const el = document.getElementById('brews-list');
  if (reset && !brews.length) {
    el.innerHTML = `<div style="text-align:center;padding:40px;color:var(--ink-muted)">${t('brew.empty')}</div>`;
    return;
  }
  if (reset) el.innerHTML = '';

  _appendBrewCards(brews, el);
  _setupBrewsObserver(el);
}

function _appendBrewCards(brews, el) {
  brews.forEach(b => { _brewCache[b.id] = b; });
  const sentinel = document.getElementById('brews-sentinel');
  if (sentinel) sentinel.remove();
  el.insertAdjacentHTML('beforeend', brews.map(b => `
    <div class="brew-card">
      <div class="brew-card-header">
        <span class="brew-date">${fmtDate(b.brew_date)}</span>
        <span class="brew-rating">${canQuickRate(b) ? '' : b.rating ? stars(b.rating) : `<span class="row-muted">${t('brew.unrated')}</span>`}</span>
        <div class="brew-card-actions">
          <button class="btn-brew-edit" onclick="openBrewModal(null,${b.id})" title="${esc(t('brew.btn.edit'))}" aria-label="${esc(t('brew.btn.edit'))}">${icon('edit')}</button>
          <button class="btn-brew-delete" onclick="deleteBrew(${b.id})" title="${esc(t('brew.btn.delete'))}" aria-label="${esc(t('brew.btn.delete'))}">${icon('trash')}</button>
        </div>
      </div>
      <div class="brew-coffees">${b.coffees.map(n=>`<span class="brew-coffee-tag">${esc(n)}</span>`).join('')}</div>
      <div class="brew-summary">${esc(brewSummaryLine(b))}</div>
      ${b.shot_metrics ? `<div class="brew-metrics">${b.shot_curve ? curveSparkline(b.shot_curve) : ''}${esc(brewMetricsLine(b))}</div>` : ''}
      ${tasteLine(b) && !canQuickRate(b) ? `<div class="brew-taste-line">${esc(tasteLine(b))}</div>` : ''}
      ${b.notes ? `<div class="brew-notes">"${esc(b.notes)}"</div>` : ''}
      ${canQuickRate(b) ? quickRateHtml(b) : ''}
    </div>
  `).join(''));
  if (_brewsHasMore) {
    el.insertAdjacentHTML('beforeend', '<div id="brews-sentinel" style="height:1px;margin-top:8px"></div>');
  }
}

function _setupBrewsObserver(el) {
  if (_brewsObserver) { _brewsObserver.disconnect(); _brewsObserver = null; }
  const sentinel = document.getElementById('brews-sentinel');
  if (!sentinel) return;
  _brewsObserver = new IntersectionObserver(entries => {
    if (entries[0].isIntersecting) loadBrews(false);
  }, { rootMargin: '200px' });
  _brewsObserver.observe(sentinel);
}

function fmtRatio(dose, yld) {
  if (!dose || !yld) return null;
  return '1:' + fmtNum((yld / dose), 2);
}

function fmtFlow(yld, time_s) {
  if (!yld || !time_s) return null;
  return fmtNum((yld / time_s), 2) + ' g/s';
}

function brewSummaryLine(b) {
  const parts = [];
  if (b.dose_g && b.yield_g) parts.push(`${fmtGrams(b.dose_g)} → ${fmtGrams(b.yield_g)} (${fmtRatio(b.dose_g, b.yield_g)})`);
  else if (b.dose_g)         parts.push(`${fmtGrams(b.dose_g)} café`);
  if (b.time_s) parts.push(`${b.time_s} s`);
  const m = b.shot_metrics;
  const flow = m?.main_flow != null
    ? t('scale.summary_flow', {main: fmtNum(m.main_flow, 2)}) + (m.irregular ? ' · ' + t('scale.row.irregular_short') : '')
    : fmtFlow(b.yield_g, b.time_s);
  if (flow) parts.push(flow);
  if (b.grind)  parts.push(t('brew.grind_label', {grind: fmtPlain(b.grind)}));
  if (b.temp_c) parts.push(`${b.temp_c} °C`);
  return parts.join(' · ') || '—';
}

// Segunda línea con las métricas de flujo de la báscula (vacía si el brew no las tiene)
function brewMetricsLine(b) {
  const m = b.shot_metrics;
  if (!m) return '';
  const parts = [t('scale.row.ramp', {s: fmtNum((+m.t_ramp_s), 1)})];
  if (m.in_band_pct != null) parts.push(t('scale.row.in_band', {pct: m.in_band_pct}));
  parts.push(t('scale.row.peak', {flow: fmtNum((+m.peak_flow), 2)}));
  parts.push(t('scale.row.tail', {s: fmtNum((+m.tail_s), 1)}));
  return parts.join(' · ');
}


const recipeRatio = r => (r?.dose_g && r?.yield_g ? r.yield_g / r.dose_g : null);

function recipeSummaryLine(recipe) {
  const ratio = fmtRatio(recipe.dose_g, recipe.yield_g);
  const parts = [];
  if (recipe.dose_g && recipe.yield_g) parts.push(`${fmtGrams(recipe.dose_g)} → ${fmtGrams(recipe.yield_g)}${ratio ? ' (' + ratio + ')' : ''}`);
  else if (recipe.dose_g)              parts.push(`${fmtGrams(recipe.dose_g)}`);
  if (recipe.grind)  parts.push(t('recipe.grind_label', {grind: fmtPlain(recipe.grind)}));
  if (recipe.temp_c) parts.push(`${recipe.temp_c} °C`);
  if (recipe.target_flow) parts.push(`${fmtNum(recipe.target_flow, 2)} g/s`);
  return parts.join(' · ') || '—';
}

// Nombre de una receta: el suyo o, sin nombre, su ratio
const recipeName = r => r.name || fmtRatio(r.dose_g, r.yield_g) || t('recipe.label');

// "Guardar como receta" en un shot bueno: abre la receta para la que cuenta el shot (o una nueva)
// rellenada con el shot, para revisarla y ponerle nombre
function saveBrewAsRecipe(brewId, coffeeId) {
  const b = _brewCache[brewId];
  if (!b) return;
  const flow = b.shot_metrics?.main_flow ?? (b.yield_g && b.time_s ? b.yield_g / b.time_s : null);
  openRecipeModal(coffeeId, b.recipe_group ?? null, {dose_g: b.dose_g, yield_g: b.yield_g, time_s: b.time_s,
    grind: b.grind, temp_c: b.temp_c, target_flow: flow != null && flow >= 0.1 && flow <= 10 ? +flow.toFixed(2) : null});
}

// ---------------------------------------------------------------------------
// Recipes section inside detail modal: varias por café (espresso, largo…), de toda la familia
// ---------------------------------------------------------------------------
let _detailRecipes = [];

async function renderRecipeSection(coffeeId) {
  const el = document.getElementById('detail-recipe-section');
  if (!el) return;
  el.innerHTML = '';
  let recipes = [];
  try {
    const r = await fetch('/api/coffees/' + coffeeId + '/recipes');
    if (r.ok) recipes = (await r.json()).recipes;
  } catch (_) {}
  _detailRecipes = recipes;
  const add = `<button class="btn-add-recipe" onclick="openRecipeModal(${coffeeId})">${esc(t(recipes.length ? 'recipe.add_another' : 'recipe.add_btn'))}</button>`;
  if (!recipes.length) {
    el.innerHTML = `
      <div class="recipe-section recipe-empty">
        <span style="color:var(--ink-muted);font-size:13px">${t('recipe.no_recipe')}</span>
        ${add}
      </div>`;
    return;
  }
  el.innerHTML = `
    <div class="recipe-section">
      ${recipes.map(r => `
        <div class="recipe-item">
          <div class="recipe-header">
            <span class="recipe-label">${esc(recipes.length > 1 || r.name ? recipeName(r) : t('recipe.label'))}</span>
            <button class="btn-inline-edit" onclick="openRecipeModal(${coffeeId},${r.id})" title="${esc(t('recipe.btn.edit'))}" aria-label="${esc(t('recipe.btn.edit'))}">${icon('edit')}</button>
            <button class="btn-inline-edit" onclick="confirmDeleteRecipe(${coffeeId},${r.id})" title="${esc(t('recipe.btn.delete'))}" aria-label="${esc(t('recipe.btn.delete'))}" style="color:var(--ink-muted)">${icon('trash')}</button>
          </div>
          <div class="recipe-summary">${esc(recipeSummaryLine(r))}</div>
        </div>`).join('')}
      <div class="form-hint">${esc(t(recipes.length > 1 ? 'recipe.hint_many' : 'recipe.hint'))}</div>
      <div class="recipe-add-row">${add}</div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Brews section inside detail modal
// ---------------------------------------------------------------------------
async function renderBrewsSection(coffeeId) {
  const el = document.getElementById('detail-brews-section');
  if (!el) return;
  let brews = [];
  try {
    const r = await fetch('/api/coffees/' + coffeeId + '/brews', {headers:{'Content-Type':'application/json'}});
    if (r.ok) brews = await r.json();
  } catch (_) {}
  renderDialIn(coffeeId, brews);
  if (!brews.length) { el.innerHTML = ''; return; }
  brews.forEach(b => { _brewCache[b.id] = b; });
  el.innerHTML = `
    <div class="detail-brews-header">${t('detail.brews_header', {count: brews.length})}</div>
    ${brews.map(b => `
      <div class="detail-brew-row">
        <span class="detail-brew-date">${fmtDate(b.brew_date)}</span>
        <span class="detail-brew-summary">${esc(brewSummaryLine(b))}</span>
        <span class="detail-brew-rating">${canQuickRate(b) ? '' : b.rating ? stars(b.rating) : '—'}</span>
        ${b.rating >= 4 ? `<button class="btn-inline-edit" onclick="saveBrewAsRecipe(${b.id},${coffeeId})" title="${esc(t('brew.btn.save_recipe'))}" aria-label="${esc(t('brew.btn.save_recipe'))}">${icon('clipboard')}</button>` : ''}
        <button class="btn-inline-edit" onclick="openBrewModal(${coffeeId},${b.id})" title="${esc(t('brew.btn.edit'))}" aria-label="${esc(t('brew.btn.edit'))}">${icon('edit')}</button>
        <button class="btn-inline-edit" onclick="deleteBrew(${b.id}, ${coffeeId})" title="${esc(t('brew.btn.delete'))}" aria-label="${esc(t('brew.btn.delete'))}" style="color:var(--ink-muted)">${icon('trash')}</button>
        ${tasteLine(b) && !canQuickRate(b) ? `<div class="brew-taste-line detail-brew-metrics">${esc(tasteLine(b))}</div>` : ''}
        ${b.shot_metrics ? `<div class="brew-metrics detail-brew-metrics">${b.shot_curve ? curveSparkline(b.shot_curve) : ''}${esc(brewMetricsLine(b))}</div>` : ''}
        ${canQuickRate(b) ? `<div class="detail-brew-quick">${quickRateHtml(b)}</div>` : ''}
      </div>`).join('')}`;
}

// ---------------------------------------------------------------------------
// Recipe modal: nueva (recipeId null) o editar una; `prefill` rellena con un shot ("Guardar como receta")
// ---------------------------------------------------------------------------
let _recipeTargetId = null;
let _recipeEditId = null;
const RECIPE_INPUTS = {name: 'r-name', dose_g: 'r-dose', yield_g: 'r-yield', time_s: 'r-time', grind: 'r-grind',
  temp_c: 'r-temp', target_flow: 'r-target-flow'};

async function openRecipeModal(coffeeId, recipeId = null, prefill = null) {
  _recipeTargetId = coffeeId;
  _recipeEditId = recipeId;
  let recipe = recipeId != null ? _detailRecipes.find(r => r.id === recipeId) : null;
  if (recipeId != null && !recipe) {
    try {
      const r = await fetch('/api/coffees/' + coffeeId + '/recipes');
      if (r.ok) recipe = (await r.json()).recipes.find(x => x.id === recipeId) ?? null;
    } catch (_) {}
    if (!recipe) _recipeEditId = null;
  }
  const src = {...(recipe || {}), ...(prefill || {})};
  for (const [k, id] of Object.entries(RECIPE_INPUTS)) document.getElementById(id).value = src[k] ?? '';
  document.querySelector('#modal-recipe .modal-title').textContent = t(recipe ? 'modal.recipe_edit' : 'modal.recipe_new');
  updateRatioDisplay();
  openModal('modal-recipe');
}

function updateRatioDisplay() {
  const dose = parseFloat(document.getElementById('r-dose').value);
  const yld  = parseFloat(document.getElementById('r-yield').value);
  const time = parseInt(document.getElementById('r-time').value);
  const el   = document.getElementById('r-ratio-display');
  if (!el) return;
  const parts = [];
  if (dose && yld) parts.push(t('brew.ratio', {ratio: '1:' + fmtNum((yld / dose), 2)}));
  const flow = fmtFlow(yld, time);
  if (flow) parts.push(t('brew.flow', {flow}));
  el.textContent = parts.join('  ·  ');
}

async function submitRecipe() {
  if (!_recipeTargetId) return;
  const name    = document.getElementById('r-name').value.trim() || null;
  const dose_g  = parseFloat(document.getElementById('r-dose').value)  || null;
  const yield_g = parseFloat(document.getElementById('r-yield').value) || null;
  const time_s  = parseInt(document.getElementById('r-time').value)    || null;
  const grindV  = parseFloat(document.getElementById('r-grind').value);   // decimales: medios pasos
  const grind   = Number.isNaN(grindV) ? null : grindV;
  const temp_c  = parseInt(document.getElementById('r-temp').value)    || null;
  const target_flow = parseFloat(document.getElementById('r-target-flow').value) || null;
  const body = JSON.stringify({ name, dose_g, yield_g, time_s, grind, temp_c, target_flow });
  if (_recipeEditId != null) await api('/recipes/' + _recipeEditId, { method: 'PUT', body });
  else await api('/coffees/' + _recipeTargetId + '/recipes', { method: 'POST', body });
  closeModal('modal-recipe');
  showToast(t('toast.recipe_saved'));
  renderRecipeSection(_recipeTargetId);
}

function confirmDeleteRecipe(coffeeId, recipeId) {
  const r = _detailRecipes.find(x => x.id === recipeId);
  showConfirm({
    icon: 'clipboard', title: t('confirm.delete_recipe.title'),
    msg: t('confirm.delete_recipe.msg_named', {name: r ? recipeName(r) : t('recipe.label')}),
    btnLabel: t('confirm.delete_recipe.btn'), btnClass: 'btn-danger',
    onConfirm: async () => {
      await api('/recipes/' + recipeId, { method: 'DELETE' });
      showToast(t('toast.recipe_deleted'));
      renderRecipeSection(coffeeId);
    }
  });
}

// ---------------------------------------------------------------------------
// Brew modal — sigue el proceso: 1 dosis · 2 molienda/temperatura · 3 extracción · 4 cata
// ---------------------------------------------------------------------------
let _brewTargetId = null;
let _brewRating   = 0;
let _editBrewId   = null;
let _brewCache    = {};
let _brewRecipe   = null;   // receta elegida (target_flow para el shot con báscula)
let _brewRecipes  = [];     // recetas del café (espresso, largo…)
let _brewHistory  = null;   // brews de la familia (último para la pista, mejor para comparar)
let _brewSetup    = null;   // {grindRows, coffee}: para volver a rellenar al cambiar de receta

// Los brews que cuentan para la receta elegida (los elegidos con ella o los de ratio más cercano)
const brewRecipeHistory = () => forRecipe(_brewHistory || [], _brewRecipe?.id ?? null);

const BREW_FIELDS = {dose: 'b-dose', yield: 'b-yield', time: 'b-time', grind: 'b-grind', temp: 'b-temp'};
const _bv = id => document.getElementById(id);

async function openBrewModal(coffeeId = null, brewId = null, coffeeName = null) {
  _brewTargetId = coffeeId ?? currentDetail?.id ?? null;
  _editBrewId   = brewId ?? null;
  _brewRecipe   = null;
  _brewRecipes  = [];
  _brewHistory  = null;
  _brewSetup    = null;
  _brewShotMetrics = _editBrewId ? undefined : null;   // undefined = no tocar al editar
  _brewShotCurve   = null;
  brewScaleDoseStop();
  brewShotClose();
  _bv('b-dose-scale').hidden = true;
  _bv('b-last').hidden = true;
  _bv('b-recipe').hidden = true;
  _bv('b-recipe-pick').hidden = true;
  brewGrindHint(null);
  const editing = _editBrewId ? _brewCache[_editBrewId] : null;
  brewShowShotSummary(editing?.shot_metrics, editing?.shot_curve);

  const src = editing || {};
  _bv('b-dose').value  = src.dose_g  ?? '';
  _bv('b-yield').value = src.yield_g ?? '';
  _bv('b-time').value  = src.time_s  ?? '';
  _bv('b-grind').value = src.grind   ?? '';
  _bv('b-temp').value  = src.temp_c  ?? '';
  _bv('b-date').value  = src.brew_date ?? todayLocal();
  _bv('b-notes').value = src.notes   ?? '';
  _brewRating = src.rating ?? 0;
  renderBrewTaste(src);
  document.querySelector('#modal-brew .modal-title').textContent = t(editing ? 'modal.edit_brew' : 'modal.brew');
  _bv('b-coffee-name').textContent = editing ? (editing.coffees || []).join(' · ')
    : coffeeName ?? (currentDetail?.id === _brewTargetId ? currentDetail?.name
      : displayedCoffees.find(c => c.id === _brewTargetId)?.name) ?? '';

  if (!editing && _brewTargetId) {
    const get = (url, fallback) => fetch(url).then(r => (r.ok ? r.json() : fallback)).catch(() => fallback);
    const [recipes, history, grindRows, coffee] = await Promise.all([
      get('/api/coffees/' + _brewTargetId + '/recipes', {recipes: [], current_id: null}),
      get('/api/coffees/' + _brewTargetId + '/brews?family=1', []),   // también las bolsas anteriores del mismo café
      fetchGrindData(),
      get('/api/coffees/' + _brewTargetId, null),
    ]);
    _brewRecipes = recipes.recipes;
    _brewHistory = history;
    _brewSetup   = {grindRows, coffee};
    // Empieza con la receta que usó el último brew (o la última editada)
    applyBrewRecipe(_brewRecipes.find(r => r.id === recipes.current_id) ?? _brewRecipes[0] ?? null);
  } else if (editing && _brewTargetId) {
    fetch('/api/coffees/' + _brewTargetId + '/brews?family=1').then(r => (r.ok ? r.json() : null))
      .then(h => { if (h) _brewHistory = h; }).catch(() => {});
  }
  renderBrewRating();
  updateBrewRatioDisplay();
  renderBrewRatioHint();   // ya, sin esperar: nada se mueve al abrir
  openModal('modal-brew');
  document.querySelector('#modal-brew .modal').scrollTop = 0;
  wakeSessionStart('brew');
  // Con la báscula ya conectada, el paso 1 empieza leyendo la dosis sin más toques
  if (!editing && scaleSupported() && scaleConnected()) brewScaleDoseStart();
}

// Rellena el modal para una receta: la molienda y la salida aprendidas (cata + receta) van primero;
// dosis y temperatura, de la receta o del último shot de esa receta. Solo se aprende de los shots de
// la receta: un largo 1:4.7 no arrastra al espresso 1:2.15 del mismo café.
function applyBrewRecipe(recipe) {
  _brewRecipe = recipe;
  const history = brewRecipeHistory();
  const last = history[0] || (_brewRecipes.length ? null : _brewHistory?.[0]) || null;   // más reciente primero
  const grind = brewGrindHint(_brewSetup.grindRows, _brewTargetId, recipe, bagOf(_brewSetup.coffee));
  const dose = recipe?.dose_g ?? last?.dose_g ?? _brewHistory?.[0]?.dose_g ?? null;
  const learned = suggestRatio(history, dose, recipeRatio(recipe));
  if (!_doseSession) _bv('b-dose').value = dose ?? '';   // la báscula ya puede estar escribiendo la dosis
  _bv('b-yield').value = learned?.yield_g ?? recipe?.yield_g ?? '';
  _bv('b-time').value  = recipe?.time_s  ?? '';
  _bv('b-grind').value = grind ?? recipe?.grind ?? last?.grind ?? '';
  _bv('b-temp').value  = recipe?.temp_c  ?? last?.temp_c ?? '';
  _bv('b-last').hidden = !last;
  _bv('b-last').innerHTML = last ? `<b>${esc(t('brew.last_label'))}</b> ${esc(brewSummaryLine(last))}`
    + ` · ${last.rating ? '★'.repeat(last.rating) : esc(t('brew.unrated'))}`
    + (tasteLine(last) ? ` · ${esc(tasteLine(last))}` : '')
    + (last.coffee_id !== _brewTargetId ? ` · ${esc(t('brew.other_bag', {name: last.coffee_name}))}` : '') : '';
  _bv('b-recipe').hidden = !recipe;
  _bv('b-recipe').innerHTML = recipe ? `<b>${esc(t('recipe.label'))}</b> ${esc(recipeSummaryLine(recipe))}` : '';
  renderBrewRecipePick();
  updateBrewRatioDisplay();
  renderBrewRatioHint();
}

// Con más de una receta: elegirla al empezar (grupo de radios, una parada de Tab y ← →)
function renderBrewRecipePick() {
  const el = _bv('b-recipe-pick');
  el.hidden = _brewRecipes.length < 2;
  if (el.hidden) { el.innerHTML = ''; return; }
  el.innerHTML = _brewRecipes.map(r => {
    const on = r.id === _brewRecipe?.id;
    return `<button type="button" class="recipe-pick${on ? ' active' : ''}" role="radio" aria-checked="${on}"`
      + ` tabindex="${on ? 0 : -1}" onclick="pickBrewRecipe(${r.id})" onkeydown="recipePickKey(event)">${esc(recipeName(r))}</button>`;
  }).join('');
}

function pickBrewRecipe(id) {
  const r = _brewRecipes.find(x => x.id === id);
  if (!r || r === _brewRecipe) return;
  applyBrewRecipe(r);
  _bv('b-recipe-pick').querySelector('[aria-checked="true"]')?.focus();
}

function recipePickKey(event) {
  const d = {ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1}[event.key];
  if (!d) return;
  event.preventDefault();
  const i = _brewRecipes.findIndex(r => r.id === _brewRecipe?.id);
  pickBrewRecipe(_brewRecipes[(i + d + _brewRecipes.length) % _brewRecipes.length].id);
}

function updateBrewRatioDisplay() {
  const dose = parseFloat(_bv('b-dose').value);
  const yld  = parseFloat(_bv('b-yield').value);
  const time = parseInt(_bv('b-time').value);
  const el   = _bv('b-ratio-display');
  if (!el) return;
  const parts = [];
  if (dose && yld) parts.push(t('brew.ratio', {ratio: '1:' + fmtNum((yld / dose), 2)}));
  // Con métricas de báscula se muestra el flujo principal (el mismo que el resumen del shot),
  // no la media salida/tiempo, para no tener dos "flujos" distintos en pantalla
  const metrics = _brewShotMetrics === undefined ? _brewCache[_editBrewId]?.shot_metrics : _brewShotMetrics;
  const flow = metrics?.main_flow != null ? null : fmtFlow(yld, time);
  if (metrics?.main_flow != null) parts.push(t('scale.summary_flow', {main: fmtNum(metrics.main_flow, 2)}));
  else if (flow) parts.push(t('brew.flow', {flow}));
  el.textContent = parts.join('  ·  ');
  scheduleBrewRatioHint();
  updateBrewSteps();
}

// Marca con ✓ los pasos que ya tienen datos
function updateBrewSteps() {
  const has = id => _bv(id).value !== '';
  const done = {
    'b-step-dose': has('b-dose'),
    'b-step-dial': has('b-grind') || has('b-temp'),
    'b-step-shot': has('b-yield') && has('b-time'),
    'b-step-taste': _brewRating >= 1 || _brewTaste.taste_balance != null || _brewTaste.taste_body != null,
  };
  Object.entries(done).forEach(([id, ok]) => _bv(id)?.classList.toggle('done', ok));
  // Una sola acción principal: sacar el shot mientras se pueda y no haya uno; después, guardar
  const shotBtn = document.querySelector('#modal-brew .btn-shot');
  const shotFirst = !_editBrewId && !_brewShotMetrics && !!shotBtn && !shotBtn.hidden && scaleSupported();
  _bv('b-submit').className = shotFirst ? 'btn-secondary' : 'btn-primary';
  if (shotBtn) shotBtn.classList.toggle('secondary', !shotFirst);
  syncGrindUse();
}

// Botones −/+ de molienda (paso de Ajustes: 1, 0.5, 0.1…) y temperatura (de 1 en 1)
function brewStep(id, delta) {
  const el = _bv(id);
  const step = id === 'b-grind' ? grindStep : 1;
  const base = parseFloat(el.value);
  const next = Number.isNaN(base) ? parseFloat(el.placeholder) || 0 : base + delta * step;
  el.value = +Math.max(0, Math.min(parseFloat(el.max) || 1000, next)).toFixed(2);   // sin 13.600000001
  updateBrewSteps();
}

// Tocar la estrella ya marcada la quita (sin valorar)
function setBrewRating(val) {
  _brewRating = val === _brewRating ? 0 : val;
  renderBrewRating();
}

function renderBrewRating() {
  document.querySelectorAll('#modal-brew .brew-star').forEach(s => {
    const v = parseInt(s.dataset.val);
    s.classList.toggle('active', v <= _brewRating);
    s.setAttribute('aria-pressed', String(v <= _brewRating));
  });
  _bv('b-submit').textContent = t(_editBrewId ? 'brew.btn.update' : _brewRating ? 'brew.btn.submit' : 'brew.btn.submit_unrated');
  updateBrewSteps();
}

let _brewSaving = false;

async function submitBrew() {
  if (_brewSaving) return;   // doble toque: un solo brew
  _brewSaving = true;
  try { await _submitBrew(); } finally { _brewSaving = false; }
}

async function _submitBrew() {
  const num = (id, parse) => { const v = parse(_bv(id).value); return Number.isNaN(v) ? null : v; };
  const dose_g    = num('b-dose', parseFloat) || null;
  const yield_g   = num('b-yield', parseFloat) || null;
  const time_s    = num('b-time', v => parseInt(v, 10)) || null;
  const grind     = num('b-grind', parseFloat);
  const temp_c    = num('b-temp', v => parseInt(v, 10)) || null;
  const brew_date = _bv('b-date').value || null;
  const notes     = _bv('b-notes').value || null;
  const rating    = _brewRating >= 1 ? _brewRating : null;
  const extra     = _brewShotMetrics ? { shot_metrics: _brewShotMetrics, shot_curve: _brewShotCurve } : {};
  if (!_editBrewId && _brewRecipe) extra.recipe_id = _brewRecipe.id;
  const body = JSON.stringify({ dose_g, yield_g, time_s, grind, temp_c, brew_date, notes, rating, ..._brewTaste, ...extra });

  if (_editBrewId) {
    await api('/brews/' + _editBrewId, { method: 'PUT', body });
    closeModal('modal-brew');
    showToast(t('toast.brew_updated'));
  } else {
    if (!_brewTargetId) return;
    await api('/coffees/' + _brewTargetId + '/brews', { method: 'POST', body });
    closeModal('modal-brew');
    showToast(t(rating ? 'toast.brew_registered' : 'toast.brew_registered_unrated'));
    fetchAndRender();
  }
  refreshBrewViews();
  refreshPendingCount();
}

function refreshBrewViews() {
  if (_brewTargetId && currentDetail?.id === _brewTargetId) renderBrewsSection(_brewTargetId);
  if (document.getElementById('page-brews')?.classList.contains('active')) loadBrews();
}

// Valorar después de probarlo: estrellas y cata en los brews de los últimos días sin valorar o sin
// equilibrio (los antiguos, p. ej. de "Consumir", no llenan la lista de "¿Qué tal estaba?")
const QUICK_RATE_DAYS = 2;
function canQuickRate(b) {
  if ((b.rating && b.taste_balance != null) || !b.brew_date) return false;
  const [y, m, d] = b.brew_date.split('-').map(Number);
  return (new Date() - new Date(y, m - 1, d)) / 86400000 < QUICK_RATE_DAYS + 1;
}

function quickRateHtml(b) {
  return `<div class="quick-block"><span class="quick-rate" role="group" aria-label="${esc(t('brew.quick_rate'))}">
    <span class="quick-rate-label">${esc(t('brew.quick_rate'))}</span>${[1, 2, 3, 4, 5].map(v =>
      `<button type="button" class="quick-star${v <= (b.rating || 0) ? ' active' : ''}" aria-label="${v}" onclick="quickRateBrew(${b.id},${v},this)">★</button>`).join('')}
  </span>${b.rating ? quickTasteHtml(b) : ''}</div>`;
}

async function quickRateBrew(id, rating, btn) {
  btn?.parentElement?.querySelectorAll('.quick-star').forEach((s, i) => s.classList.toggle('active', i < rating));
  showQuickTaste(id, btn);   // las escalas aparecen al momento, sin esperar a la red
  await api('/brews/' + id, { method: 'PUT', body: JSON.stringify({ rating }) });
  if (_brewCache[id]) _brewCache[id].rating = rating;
  showToast(t('toast.brew_rated', {stars: '★'.repeat(rating)}));
  afterQuickRate(id);
}

// Shots de báscula por valorar: aviso en Prepas para que no se olviden. Si falla, sin aviso ni error.
async function refreshPendingCount() {
  const el = document.getElementById('nav-count-brews');
  let count = 0;
  try {
    const d = new Date();
    d.setDate(d.getDate() - QUICK_RATE_DAYS);
    const since = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const r = await fetch('/api/brews/pending?since=' + since);
    if (r.ok) count = (await r.json()).count;
  } catch (_) {}
  el.textContent = count || '';
  el.hidden = !count;
  const label = count ? t('brew.pending', {count, s: count !== 1 ? 's' : ''}) : '';
  const item = el.closest('.bnav-item');
  item.setAttribute('aria-label', [t('nav.tab.brews'), label].filter(Boolean).join(', '));
  setPageSummary('brews', esc(label));
}

// Repinta cuando ya no queda nada por valorar (estrellas + equilibrio); mientras, se queda a la vista
function afterQuickRate(id) {
  refreshPendingCount();
  if (_brewCache[id] && canQuickRate(_brewCache[id])) return;
  setTimeout(() => {
    const coffeeId = currentDetail?.id;
    if (coffeeId && document.getElementById('modal-detail')?.classList.contains('open')) renderBrewsSection(coffeeId);
    if (document.getElementById('page-brews')?.classList.contains('active')) loadBrews();
  }, 400);
}

async function deleteBrew(id, coffeeId) {
  showConfirm({
    icon: 'coffee', title: t('confirm.delete_brew.title'),
    msg: t('confirm.delete_brew.msg'),
    btnLabel: t('confirm.delete_brew.btn'), btnClass: 'btn-danger',
    onConfirm: async () => {
      await api('/brews/' + id, { method: 'DELETE' });
      showToast(t('toast.brew_deleted'));
      refreshPendingCount();
      if (coffeeId) renderBrewsSection(coffeeId);
      if (document.getElementById('page-brews')?.classList.contains('active')) loadBrews();
    }
  });
}
