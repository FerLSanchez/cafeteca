// ---------------------------------------------------------------------------
// Brews tab — infinite scroll
// ---------------------------------------------------------------------------
const BREWS_PAGE = 20;
let _brewsOffset  = 0;
let _brewsLoading = false;
let _brewsHasMore = true;
let _brewsObserver = null;

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
        <span class="brew-rating">${b.rating ? stars(b.rating) : `<span style="color:var(--text3)">${t('brew.unrated')}</span>`}</span>
        <div class="brew-card-actions">
          <button class="btn-brew-edit" onclick="openBrewModal(null,${b.id})" title="Editar preparación">${icon('edit')}</button>
          <button class="btn-brew-delete" onclick="deleteBrew(${b.id})" title="Eliminar preparación">${icon('x')}</button>
        </div>
      </div>
      <div class="brew-coffees">${b.coffees.map(n=>`<span class="brew-coffee-tag">${esc(n)}</span>`).join('')}</div>
      <div class="brew-summary">${esc(brewSummaryLine(b))}</div>
      ${b.notes ? `<div class="brew-notes">"${esc(b.notes)}"</div>` : ''}
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
  const flow = fmtFlow(b.yield_g, b.time_s);
  if (flow) parts.push(flow);
  if (b.grind)  parts.push(t('brew.grind_label', {grind: b.grind}));
  if (b.temp_c) parts.push(`${b.temp_c}°C`);
  return parts.join(' · ') || '—';
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
    el.innerHTML = `
      <div class="recipe-section">
        <div class="recipe-header">
          <span class="recipe-label">${t('recipe.label')}</span>
          <button class="btn-inline-edit" onclick="openRecipeModal(${coffeeId})" title="Editar receta">${icon('edit')}</button>
          <button class="btn-inline-edit" onclick="confirmDeleteRecipe(${coffeeId})" title="Quitar receta" style="color:var(--text3)">${icon('x')}</button>
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
  if (!brews.length) { el.innerHTML = ''; return; }
  brews.forEach(b => { _brewCache[b.id] = b; });
  el.innerHTML = `
    <div class="detail-brews-header">${t('detail.brews_header', {count: brews.length})}</div>
    ${brews.map(b => `
      <div class="detail-brew-row">
        <span class="detail-brew-date">${fmtDate(b.brew_date)}</span>
        <span class="detail-brew-summary">${esc(brewSummaryLine(b))}</span>
        <span class="detail-brew-rating">${b.rating ? stars(b.rating) : '—'}</span>
        <button class="btn-inline-edit" onclick="openBrewModal(${coffeeId},${b.id})" title="Editar preparación">${icon('edit')}</button>
        <button class="btn-inline-edit" onclick="deleteBrew(${b.id}, ${coffeeId})" title="Eliminar" style="color:var(--text3)">${icon('x')}</button>
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
  if (dose && yld) parts.push('Ratio: 1:' + (yld / dose).toFixed(2));
  const flow = fmtFlow(yld, time);
  if (flow) parts.push('Flujo: ' + flow);
  el.textContent = parts.join('  ·  ');
}

async function submitRecipe() {
  if (!_recipeTargetId) return;
  const dose_g  = parseFloat(document.getElementById('r-dose').value)  || null;
  const yield_g = parseFloat(document.getElementById('r-yield').value) || null;
  const time_s  = parseInt(document.getElementById('r-time').value)    || null;
  const grind   = parseInt(document.getElementById('r-grind').value)   || null;
  const temp_c  = parseInt(document.getElementById('r-temp').value)    || null;
  await api('/coffees/' + _recipeTargetId + '/recipe', {
    method: 'PUT',
    body: JSON.stringify({ dose_g, yield_g, time_s, grind, temp_c })
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
// Brew modal
// ---------------------------------------------------------------------------
let _brewTargetId = null;
let _brewRating   = 0;
let _editBrewId   = null;
let _brewCache    = {};

async function openBrewModal(coffeeId = null, brewId = null) {
  _brewTargetId = coffeeId ?? currentDetail?.id ?? null;
  _editBrewId   = brewId ?? null;
  _brewRating   = 0;

  const titleEl  = document.querySelector('#modal-brew .modal-title');
  const submitEl = document.querySelector('#modal-brew .btn-primary');

  if (_editBrewId && _brewCache[_editBrewId]) {
    // Modo edición: pre-rellenar con datos existentes
    const b = _brewCache[_editBrewId];
    document.getElementById('b-dose').value  = b.dose_g  ?? '';
    document.getElementById('b-yield').value = b.yield_g ?? '';
    document.getElementById('b-time').value  = b.time_s  ?? '';
    document.getElementById('b-grind').value = b.grind   ?? '';
    document.getElementById('b-temp').value  = b.temp_c  ?? '';
    document.getElementById('b-date').value  = b.brew_date ?? new Date().toISOString().split('T')[0];
    document.getElementById('b-notes').value = b.notes  ?? '';
    _brewRating = b.rating ?? 0;
    document.querySelectorAll('.brew-star').forEach(s =>
      s.classList.toggle('active', parseInt(s.dataset.val) <= _brewRating));
    if (titleEl)  titleEl.textContent  = t('modal.edit_brew');
    if (submitEl) submitEl.textContent = t('brew.btn.update');
  } else {
    // Modo creación: limpiar y pre-rellenar desde receta
    document.getElementById('b-dose').value  = '';
    document.getElementById('b-yield').value = '';
    document.getElementById('b-time').value  = '';
    document.getElementById('b-grind').value = '';
    document.getElementById('b-temp').value  = '';
    document.getElementById('b-date').value  = new Date().toISOString().split('T')[0];
    document.getElementById('b-notes').value = '';
    document.querySelectorAll('.brew-star').forEach(s => s.classList.remove('active'));
    if (titleEl)  titleEl.textContent  = t('modal.brew');
    if (submitEl) submitEl.textContent = t('brew.btn.submit');
    if (_brewTargetId) {
      try {
        const r = await fetch('/api/coffees/' + _brewTargetId + '/recipe', {headers:{'Content-Type':'application/json'}});
        if (r.ok) {
          const recipe = await r.json();
          document.getElementById('b-dose').value  = recipe.dose_g  ?? '';
          document.getElementById('b-yield').value = recipe.yield_g ?? '';
          document.getElementById('b-time').value  = recipe.time_s  ?? '';
          document.getElementById('b-grind').value = recipe.grind   ?? '';
          document.getElementById('b-temp').value  = recipe.temp_c  ?? '';
        }
      } catch (_) {}
    }
  }
  updateBrewRatioDisplay();
  openModal('modal-brew');
}

function updateBrewRatioDisplay() {
  const dose = parseFloat(document.getElementById('b-dose').value);
  const yld  = parseFloat(document.getElementById('b-yield').value);
  const time = parseInt(document.getElementById('b-time').value);
  const el   = document.getElementById('b-ratio-display');
  if (!el) return;
  const parts = [];
  if (dose && yld) parts.push('Ratio: 1:' + (yld / dose).toFixed(2));
  const flow = fmtFlow(yld, time);
  if (flow) parts.push('Flujo: ' + flow);
  el.textContent = parts.join('  ·  ');
}

function setBrewRating(val) {
  _brewRating = val;
  document.querySelectorAll('.brew-star').forEach(s =>
    s.classList.toggle('active', parseInt(s.dataset.val) <= val));
}

async function submitBrew() {
  const dose_g    = parseFloat(document.getElementById('b-dose').value)  || null;
  const yield_g   = parseFloat(document.getElementById('b-yield').value) || null;
  const time_s    = parseInt(document.getElementById('b-time').value)    || null;
  const grind     = parseInt(document.getElementById('b-grind').value)   || null;
  const temp_c    = parseInt(document.getElementById('b-temp').value)    || null;
  const brew_date = document.getElementById('b-date').value || null;
  const notes     = document.getElementById('b-notes').value || null;
  const rating    = _brewRating >= 1 ? _brewRating : null;

  if (_editBrewId) {
    // Editar preparación existente
    await api('/brews/' + _editBrewId, {
      method: 'PUT',
      body: JSON.stringify({ dose_g, yield_g, time_s, grind, temp_c, brew_date, notes, rating })
    });
    closeModal('modal-brew');
    showToast(t('toast.brew_updated'));
    if (_brewTargetId) renderBrewsSection(_brewTargetId);
    if (document.getElementById('page-brews')?.classList.contains('active')) loadBrews();
  } else {
    // Nueva preparación
    if (!_brewTargetId) return;
    await api('/coffees/' + _brewTargetId + '/brews', {
      method: 'POST',
      body: JSON.stringify({ dose_g, yield_g, time_s, grind, temp_c, brew_date, notes, rating })
    });
    closeModal('modal-brew');
    showToast(t('toast.brew_registered'));
    renderBrewsSection(_brewTargetId);
    if (document.getElementById('page-brews')?.classList.contains('active')) loadBrews();
    fetchAndRender();
  }
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
