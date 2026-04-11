// ---------------------------------------------------------------------------
// Brews tab
// ---------------------------------------------------------------------------
async function loadBrews() {
  document.getElementById('brews-list').innerHTML = `<div class="loading">${t('loading')}</div>`;
  const brews = await api('/brews');
  renderBrewsPage(brews);
}

function fmtRatio(dose, yld) {
  if (!dose || !yld) return null;
  return '1:' + (yld / dose).toFixed(2);
}

function brewSummaryLine(b) {
  const parts = [];
  if (b.dose_g && b.yield_g) parts.push(`${b.dose_g}g → ${b.yield_g}g (${fmtRatio(b.dose_g, b.yield_g)})`);
  else if (b.dose_g)         parts.push(`${b.dose_g}g café`);
  if (b.grind)  parts.push(t('brew.grind_label', {grind: b.grind}));
  if (b.temp_c) parts.push(`${b.temp_c}°C`);
  return parts.join(' · ') || '—';
}

function renderBrewsPage(brews) {
  const el = document.getElementById('brews-list');
  if (!brews.length) {
    el.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text3)">${t('brew.empty')}</div>`;
    return;
  }
  el.innerHTML = brews.map(b => `
    <div class="brew-card">
      <div class="brew-card-header">
        <span class="brew-date">${fmtDate(b.brew_date)}</span>
        <span class="brew-rating">${b.rating ? stars(b.rating) : `<span style="color:var(--text3)">${t('brew.unrated')}</span>`}</span>
        <button class="btn-brew-delete" onclick="deleteBrew(${b.id})" title="Eliminar preparación">✕</button>
      </div>
      <div class="brew-coffees">${b.coffees.map(n=>`<span class="brew-coffee-tag">${esc(n)}</span>`).join('')}</div>
      <div class="brew-summary">${esc(brewSummaryLine(b))}</div>
      ${b.notes ? `<div class="brew-notes">"${esc(b.notes)}"</div>` : ''}
    </div>
  `).join('');
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
          <button class="btn-inline-edit" onclick="openRecipeModal(${coffeeId})" title="Editar receta">✏️</button>
          <button class="btn-inline-edit" onclick="confirmDeleteRecipe(${coffeeId})" title="Quitar receta" style="color:var(--text3)">✕</button>
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
  el.innerHTML = `
    <div class="detail-brews-header">${t('detail.brews_header', {count: brews.length})}</div>
    ${brews.map(b => `
      <div class="detail-brew-row">
        <span class="detail-brew-date">${fmtDate(b.brew_date)}</span>
        <span class="detail-brew-summary">${esc(brewSummaryLine(b))}</span>
        <span class="detail-brew-rating">${b.rating ? stars(b.rating) : '—'}</span>
        <button class="btn-inline-edit" onclick="deleteBrew(${b.id}, ${coffeeId})" title="Eliminar" style="color:var(--text3);font-size:12px">✕</button>
      </div>`).join('')}`;
}

// ---------------------------------------------------------------------------
// Recipe modal
// ---------------------------------------------------------------------------
let _recipeTargetId = null;

async function openRecipeModal(coffeeId) {
  _recipeTargetId = coffeeId;
  // Pre-fill if recipe exists
  document.getElementById('r-dose').value = '';
  document.getElementById('r-yield').value = '';
  document.getElementById('r-grind').value = '';
  document.getElementById('r-temp').value = '';
  updateRatioDisplay();
  try {
    const r = await fetch('/api/coffees/' + coffeeId + '/recipe', {headers:{'Content-Type':'application/json'}});
    if (r.ok) {
      const recipe = await r.json();
      document.getElementById('r-dose').value  = recipe.dose_g  ?? '';
      document.getElementById('r-yield').value = recipe.yield_g ?? '';
      document.getElementById('r-grind').value = recipe.grind   ?? '';
      document.getElementById('r-temp').value  = recipe.temp_c  ?? '';
      updateRatioDisplay();
    }
  } catch (_) {}
  openModal('modal-recipe');
}

function updateRatioDisplay() {
  const dose  = parseFloat(document.getElementById('r-dose').value);
  const yld   = parseFloat(document.getElementById('r-yield').value);
  const el    = document.getElementById('r-ratio-display');
  if (el) el.textContent = (dose && yld) ? 'Ratio: 1:' + (yld / dose).toFixed(2) : '';
}

async function submitRecipe() {
  if (!_recipeTargetId) return;
  const dose_g  = parseFloat(document.getElementById('r-dose').value)  || null;
  const yield_g = parseFloat(document.getElementById('r-yield').value) || null;
  const grind   = parseInt(document.getElementById('r-grind').value)   || null;
  const temp_c  = parseInt(document.getElementById('r-temp').value)    || null;
  await api('/coffees/' + _recipeTargetId + '/recipe', {
    method: 'PUT',
    body: JSON.stringify({ dose_g, yield_g, grind, temp_c })
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

async function openBrewModal() {
  if (!currentDetail) return;
  _brewTargetId = currentDetail.id;
  _brewRating   = 0;
  document.getElementById('b-dose').value  = '';
  document.getElementById('b-yield').value = '';
  document.getElementById('b-grind').value = '';
  document.getElementById('b-temp').value  = '';
  document.getElementById('b-date').value  = new Date().toISOString().split('T')[0];
  document.getElementById('b-notes').value = '';
  document.querySelectorAll('.brew-star').forEach(s => s.classList.remove('active'));
  updateBrewRatioDisplay();
  // Pre-fill from recipe
  try {
    const r = await fetch('/api/coffees/' + _brewTargetId + '/recipe', {headers:{'Content-Type':'application/json'}});
    if (r.ok) {
      const recipe = await r.json();
      document.getElementById('b-dose').value  = recipe.dose_g  ?? '';
      document.getElementById('b-yield').value = recipe.yield_g ?? '';
      document.getElementById('b-grind').value = recipe.grind   ?? '';
      document.getElementById('b-temp').value  = recipe.temp_c  ?? '';
      updateBrewRatioDisplay();
    }
  } catch (_) {}
  openModal('modal-brew');
}

function updateBrewRatioDisplay() {
  const dose  = parseFloat(document.getElementById('b-dose').value);
  const yld   = parseFloat(document.getElementById('b-yield').value);
  const el    = document.getElementById('b-ratio-display');
  if (el) el.textContent = (dose && yld) ? 'Ratio: 1:' + (yld / dose).toFixed(2) : '';
}

function setBrewRating(val) {
  _brewRating = val;
  document.querySelectorAll('.brew-star').forEach(s =>
    s.classList.toggle('active', parseInt(s.dataset.val) <= val));
}

async function submitBrew() {
  if (!_brewTargetId) return;
  const dose_g    = parseFloat(document.getElementById('b-dose').value)  || null;
  const yield_g   = parseFloat(document.getElementById('b-yield').value) || null;
  const grind     = parseInt(document.getElementById('b-grind').value)   || null;
  const temp_c    = parseInt(document.getElementById('b-temp').value)    || null;
  const brew_date = document.getElementById('b-date').value || null;
  const notes     = document.getElementById('b-notes').value || null;
  const rating    = _brewRating >= 1 ? _brewRating : null;
  await api('/coffees/' + _brewTargetId + '/brews', {
    method: 'POST',
    body: JSON.stringify({ dose_g, yield_g, grind, temp_c, brew_date, notes, rating })
  });
  closeModal('modal-brew');
  showToast(t('toast.brew_registered'));
  renderBrewsSection(_brewTargetId);
  // If brews tab is active, refresh it
  if (document.getElementById('page-brews')?.classList.contains('active')) loadBrews();
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
