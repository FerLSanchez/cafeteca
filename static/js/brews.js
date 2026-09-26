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
    el.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text3)">${t('brew.empty')}</div>`;
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
        <span class="brew-rating">${b.rating ? stars(b.rating) : canQuickRate(b) ? '' : `<span style="color:var(--text3)">${t('brew.unrated')}</span>`}</span>
        <div class="brew-card-actions">
          <button class="btn-brew-edit" onclick="openBrewModal(null,${b.id})" title="${esc(t('brew.btn.edit'))}" aria-label="${esc(t('brew.btn.edit'))}">${icon('edit')}</button>
          <button class="btn-brew-delete" onclick="deleteBrew(${b.id})" title="${esc(t('brew.btn.delete'))}" aria-label="${esc(t('brew.btn.delete'))}">${icon('trash')}</button>
        </div>
      </div>
      <div class="brew-coffees">${b.coffees.map(n=>`<span class="brew-coffee-tag">${esc(n)}</span>`).join('')}</div>
      <div class="brew-summary">${esc(brewSummaryLine(b))}</div>
      ${b.shot_metrics ? `<div class="brew-metrics">${b.shot_curve ? curveSparkline(b.shot_curve) : ''}${esc(brewMetricsLine(b))}</div>` : ''}
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
  return '1:' + (yld / dose).toFixed(2);
}

function fmtFlow(yld, time_s) {
  if (!yld || !time_s) return null;
  return (yld / time_s).toFixed(2) + ' g/s';
}

function brewSummaryLine(b) {
  const parts = [];
  if (b.dose_g && b.yield_g) parts.push(`${b.dose_g}g → ${b.yield_g}g (${fmtRatio(b.dose_g, b.yield_g)})`);
  else if (b.dose_g)         parts.push(`${b.dose_g}g café`);
  if (b.time_s) parts.push(`${b.time_s}s`);
  const m = b.shot_metrics;
  const flow = m?.main_flow != null
    ? t('scale.summary_flow', {main: m.main_flow.toFixed(2)}) + (m.irregular ? ' ⚠️' : '')
    : fmtFlow(b.yield_g, b.time_s);
  if (flow) parts.push(flow);
  if (b.grind)  parts.push(t('brew.grind_label', {grind: b.grind}));
  if (b.temp_c) parts.push(`${b.temp_c}°C`);
  return parts.join(' · ') || '—';
}

// Segunda línea con las métricas de flujo de la báscula (vacía si el brew no las tiene)
function brewMetricsLine(b) {
  const m = b.shot_metrics;
  if (!m) return '';
  const parts = [t('scale.row.ramp', {s: (+m.t_ramp_s).toFixed(1)})];
  if (m.in_band_pct != null) parts.push(t('scale.row.in_band', {pct: m.in_band_pct}));
  parts.push(t('scale.row.peak', {flow: (+m.peak_flow).toFixed(2)}));
  parts.push(t('scale.row.tail', {s: (+m.tail_s).toFixed(1)}));
  return (b.shot_curve ? '' : '🌊 ') + parts.join(' · ');
}


// ---------------------------------------------------------------------------
// Recipe section inside detail modal
// ---------------------------------------------------------------------------
async function renderRecipeSection(coffeeId) {
  const el = document.getElementById('detail-recipe-section');
  if (!el) return;
  el.innerHTML = '';
  let recipe = null;
  try {
    const r = await fetch('/api/coffees/' + coffeeId + '/recipe', {headers:{'Content-Type':'application/json'}});
    if (r.ok) recipe = await r.json();
  } catch (_) {}

  if (recipe && !recipe.error) {
    const ratio = fmtRatio(recipe.dose_g, recipe.yield_g);
    const parts = [];
    if (recipe.dose_g && recipe.yield_g) parts.push(`${recipe.dose_g}g → ${recipe.yield_g}g${ratio ? ' (' + ratio + ')' : ''}`);
    else if (recipe.dose_g)              parts.push(`${recipe.dose_g}g`);
    if (recipe.grind)  parts.push(t('recipe.grind_label', {grind: recipe.grind}));
    if (recipe.temp_c) parts.push(`${recipe.temp_c}°C`);
    if (recipe.target_flow) parts.push(`🎯 ${recipe.target_flow} g/s`);
    el.innerHTML = `
      <div class="recipe-section">
        <div class="recipe-header">
          <span class="recipe-label">${t('recipe.label')}</span>
          <button class="btn-inline-edit" onclick="openRecipeModal(${coffeeId})" title="${esc(t('recipe.btn.edit'))}" aria-label="${esc(t('recipe.btn.edit'))}">${icon('edit')}</button>
          <button class="btn-inline-edit" onclick="confirmDeleteRecipe(${coffeeId})" title="${esc(t('recipe.btn.delete'))}" aria-label="${esc(t('recipe.btn.delete'))}" style="color:var(--text3)">${icon('trash')}</button>
        </div>
        <div class="recipe-summary">${esc(parts.join(' · ') || '—')}</div>
      </div>`;
  } else {
    el.innerHTML = `
      <div class="recipe-section recipe-empty">
        <span style="color:var(--text3);font-size:13px">${t('recipe.no_recipe')}</span>
        <button class="btn-add-recipe" onclick="openRecipeModal(${coffeeId})">${t('recipe.add_btn')}</button>
      </div>`;
  }
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
        <span class="detail-brew-rating">${b.rating ? stars(b.rating) : canQuickRate(b) ? '' : '—'}</span>
        <button class="btn-inline-edit" onclick="openBrewModal(${coffeeId},${b.id})" title="${esc(t('brew.btn.edit'))}" aria-label="${esc(t('brew.btn.edit'))}">${icon('edit')}</button>
        <button class="btn-inline-edit" onclick="deleteBrew(${b.id}, ${coffeeId})" title="${esc(t('brew.btn.delete'))}" aria-label="${esc(t('brew.btn.delete'))}" style="color:var(--text3)">${icon('trash')}</button>
        ${b.shot_metrics ? `<div class="brew-metrics detail-brew-metrics">${b.shot_curve ? curveSparkline(b.shot_curve) : ''}${esc(brewMetricsLine(b))}</div>` : ''}
        ${canQuickRate(b) ? `<div class="detail-brew-quick">${quickRateHtml(b)}</div>` : ''}
      </div>`).join('')}`;
}

// ---------------------------------------------------------------------------
// Recipe modal
// ---------------------------------------------------------------------------
let _recipeTargetId = null;

async function openRecipeModal(coffeeId) {
  _recipeTargetId = coffeeId;
  // Pre-fill if recipe exists
  document.getElementById('r-dose').value  = '';
  document.getElementById('r-yield').value = '';
  document.getElementById('r-time').value  = '';
  document.getElementById('r-grind').value = '';
  document.getElementById('r-temp').value  = '';
  document.getElementById('r-target-flow').value = '';
  updateRatioDisplay();
  try {
    const r = await fetch('/api/coffees/' + coffeeId + '/recipe', {headers:{'Content-Type':'application/json'}});
    if (r.ok) {
      const recipe = await r.json();
      document.getElementById('r-dose').value  = recipe.dose_g  ?? '';
      document.getElementById('r-yield').value = recipe.yield_g ?? '';
      document.getElementById('r-time').value  = recipe.time_s  ?? '';
      document.getElementById('r-grind').value = recipe.grind   ?? '';
      document.getElementById('r-temp').value  = recipe.temp_c  ?? '';
      document.getElementById('r-target-flow').value = recipe.target_flow ?? '';
      updateRatioDisplay();
    }
  } catch (_) {}
  openModal('modal-recipe');
}

function updateRatioDisplay() {
  const dose = parseFloat(document.getElementById('r-dose').value);
  const yld  = parseFloat(document.getElementById('r-yield').value);
  const time = parseInt(document.getElementById('r-time').value);
  const el   = document.getElementById('r-ratio-display');
  if (!el) return;
  const parts = [];
  if (dose && yld) parts.push(t('brew.ratio', {ratio: '1:' + (yld / dose).toFixed(2)}));
  const flow = fmtFlow(yld, time);
  if (flow) parts.push(t('brew.flow', {flow}));
  el.textContent = parts.join('  ·  ');
}

async function submitRecipe() {
  if (!_recipeTargetId) return;
  const dose_g  = parseFloat(document.getElementById('r-dose').value)  || null;
  const yield_g = parseFloat(document.getElementById('r-yield').value) || null;
  const time_s  = parseInt(document.getElementById('r-time').value)    || null;
  const grindV  = parseFloat(document.getElementById('r-grind').value);   // decimales: medios pasos
  const grind   = Number.isNaN(grindV) ? null : grindV;
  const temp_c  = parseInt(document.getElementById('r-temp').value)    || null;
  const target_flow = parseFloat(document.getElementById('r-target-flow').value) || null;
  await api('/coffees/' + _recipeTargetId + '/recipe', {
    method: 'PUT',
    body: JSON.stringify({ dose_g, yield_g, time_s, grind, temp_c, target_flow })
  });
  closeModal('modal-recipe');
  showToast(t('toast.recipe_saved'));
  renderRecipeSection(_recipeTargetId);
}

function confirmDeleteRecipe(coffeeId) {
  showConfirm({
    icon: '📋', title: t('confirm.delete_recipe.title'),
    msg: t('confirm.delete_recipe.msg'),
    btnLabel: t('confirm.delete_recipe.btn'), btnClass: 'btn-danger',
    onConfirm: async () => {
      await api('/coffees/' + coffeeId + '/recipe', { method: 'DELETE' });
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
let _brewRecipe   = null;   // receta del café (target_flow para el shot con báscula)
let _brewHistory  = null;   // brews del café (último para la pista, mejor para comparar)

const BREW_FIELDS = {dose: 'b-dose', yield: 'b-yield', time: 'b-time', grind: 'b-grind', temp: 'b-temp'};
const _bv = id => document.getElementById(id);

async function openBrewModal(coffeeId = null, brewId = null, coffeeName = null) {
  _brewTargetId = coffeeId ?? currentDetail?.id ?? null;
  _editBrewId   = brewId ?? null;
  _brewRecipe   = null;
  _brewHistory  = null;
  _brewShotMetrics = _editBrewId ? undefined : null;   // undefined = no tocar al editar
  _brewShotCurve   = null;
  brewScaleDoseStop();
  brewShotClose();
  _bv('b-dose-scale').hidden = true;
  _bv('b-last').hidden = true;
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
  document.querySelector('#modal-brew .modal-title').textContent = t(editing ? 'modal.edit_brew' : 'modal.brew');
  _bv('b-coffee-name').textContent = editing ? (editing.coffees || []).join(' · ')
    : coffeeName ?? (currentDetail?.id === _brewTargetId ? currentDetail?.name
      : displayedCoffees.find(c => c.id === _brewTargetId)?.name) ?? '';

  if (!editing && _brewTargetId) {
    const [recipe, history] = await Promise.all([
      fetch('/api/coffees/' + _brewTargetId + '/recipe').then(r => (r.ok ? r.json() : null)).catch(() => null),
      fetch('/api/coffees/' + _brewTargetId + '/brews').then(r => (r.ok ? r.json() : [])).catch(() => []),
    ]);
    _brewRecipe  = recipe;
    _brewHistory = history;
    const last = history[0] || null;   // más reciente primero
    // Receta primero; si no fija dosis/molienda/temperatura, se parte del último shot
    _bv('b-dose').value  = recipe?.dose_g  ?? last?.dose_g ?? '';
    _bv('b-yield').value = recipe?.yield_g ?? '';
    _bv('b-time').value  = recipe?.time_s  ?? '';
    _bv('b-grind').value = recipe?.grind   ?? last?.grind  ?? '';
    _bv('b-temp').value  = recipe?.temp_c  ?? last?.temp_c ?? '';
    if (last) {
      _bv('b-last').hidden = false;
      _bv('b-last').innerHTML = `<b>${esc(t('brew.last_label'))}</b> ${esc(brewSummaryLine(last))}`
        + ` · ${last.rating ? '★'.repeat(last.rating) : esc(t('brew.unrated'))}`;
    }
  } else if (editing && _brewTargetId) {
    fetch('/api/coffees/' + _brewTargetId + '/brews').then(r => (r.ok ? r.json() : null))
      .then(h => { if (h) _brewHistory = h; }).catch(() => {});
  }
  renderBrewRating();
  updateBrewRatioDisplay();
  openModal('modal-brew');
  _bv('modal-brew').scrollTop = 0;
  wakeSessionStart('brew');
  // Con la báscula ya conectada, el paso 1 empieza leyendo la dosis sin más toques
  if (!editing && scaleSupported() && scaleConnected()) brewScaleDoseStart();
}

function updateBrewRatioDisplay() {
  const dose = parseFloat(_bv('b-dose').value);
  const yld  = parseFloat(_bv('b-yield').value);
  const time = parseInt(_bv('b-time').value);
  const el   = _bv('b-ratio-display');
  if (!el) return;
  const parts = [];
  if (dose && yld) parts.push(t('brew.ratio', {ratio: '1:' + (yld / dose).toFixed(2)}));
  // Con métricas de báscula se muestra el flujo principal (el mismo que el resumen del shot),
  // no la media salida/tiempo, para no tener dos "flujos" distintos en pantalla
  const metrics = _brewShotMetrics === undefined ? _brewCache[_editBrewId]?.shot_metrics : _brewShotMetrics;
  const flow = metrics?.main_flow != null ? null : fmtFlow(yld, time);
  if (metrics?.main_flow != null) parts.push(t('scale.summary_flow', {main: metrics.main_flow.toFixed(2)}));
  else if (flow) parts.push(t('brew.flow', {flow}));
  el.textContent = parts.join('  ·  ');
  updateBrewSteps();
}

// Marca con ✓ los pasos que ya tienen datos
function updateBrewSteps() {
  const has = id => _bv(id).value !== '';
  const done = {
    'b-step-dose': has('b-dose'),
    'b-step-dial': has('b-grind') || has('b-temp'),
    'b-step-shot': has('b-yield') && has('b-time'),
    'b-step-taste': _brewRating >= 1,
  };
  Object.entries(done).forEach(([id, ok]) => _bv(id)?.classList.toggle('done', ok));
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

async function submitBrew() {
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
  const body = JSON.stringify({ dose_g, yield_g, time_s, grind, temp_c, brew_date, notes, rating, ...extra });

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
}

function refreshBrewViews() {
  if (_brewTargetId && currentDetail?.id === _brewTargetId) renderBrewsSection(_brewTargetId);
  if (document.getElementById('page-brews')?.classList.contains('active')) loadBrews();
}

// Valorar después de probarlo: estrellas en los brews sin valorar de los últimos días
// (los antiguos, p. ej. de "Consumir", no llenan la lista de "¿Qué tal estaba?")
const QUICK_RATE_DAYS = 2;
function canQuickRate(b) {
  if (b.rating || !b.brew_date) return false;
  const [y, m, d] = b.brew_date.split('-').map(Number);
  return (new Date() - new Date(y, m - 1, d)) / 86400000 < QUICK_RATE_DAYS + 1;
}

function quickRateHtml(b) {
  return `<span class="quick-rate" role="group" aria-label="${esc(t('brew.quick_rate'))}">
    <span class="quick-rate-label">${esc(t('brew.quick_rate'))}</span>${[1, 2, 3, 4, 5].map(v =>
      `<button type="button" class="quick-star" aria-label="${v}" onclick="quickRateBrew(${b.id},${v},this)">★</button>`).join('')}
  </span>`;
}

async function quickRateBrew(id, rating, btn) {
  btn?.parentElement?.querySelectorAll('.quick-star').forEach((s, i) => s.classList.toggle('active', i < rating));
  await api('/brews/' + id, { method: 'PUT', body: JSON.stringify({ rating }) });
  if (_brewCache[id]) _brewCache[id].rating = rating;
  showToast(t('toast.brew_rated', {stars: '★'.repeat(rating)}));
  setTimeout(() => {
    const coffeeId = currentDetail?.id;
    if (coffeeId && document.getElementById('modal-detail')?.classList.contains('open')) renderBrewsSection(coffeeId);
    if (document.getElementById('page-brews')?.classList.contains('active')) loadBrews();
  }, 400);
}

async function deleteBrew(id, coffeeId) {
  showConfirm({
    icon: '🫖', title: t('confirm.delete_brew.title'),
    msg: t('confirm.delete_brew.msg'),
    btnLabel: t('confirm.delete_brew.btn'), btnClass: 'btn-danger',
    onConfirm: async () => {
      await api('/brews/' + id, { method: 'DELETE' });
      showToast(t('toast.brew_deleted'));
      if (coffeeId) renderBrewsSection(coffeeId);
      if (document.getElementById('page-brews')?.classList.contains('active')) loadBrews();
    }
  });
}
