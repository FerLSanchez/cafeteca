// ---------------------------------------------------------------------------
// Molienda vs edad de la bolsa: molienda sugerida en el modal de brew, gráfica en la
// ficha y deriva en Stats. El modelo (puro) está en grind-model.js.
// ---------------------------------------------------------------------------
async function fetchGrindData() {
  try {
    const r = await fetch('/api/grind-data');
    return r.ok ? await r.json() : [];
  } catch (_) { return []; }
}

const fmtGrind = g => String(+g.toFixed(2));
const fmtDrift = m => (m.per_week > 0 ? '+' : '') + m.per_week.toFixed(2);
// |γ| < 2·error típico: con estos datos no se distingue de "sin deriva"
const driftConclusive = m => Math.abs(m.gamma) >= 2 * m.gamma_se;
const GRIND_BASIS_KEYS  = {roast: 'grind.basis_roast', open: 'grind.basis_open'};
const GRIND_SOURCE_KEYS = {recipe: 'grind.source_recipe', best: 'grind.source_best', recent: 'grind.source_recent'};
const basisLabel = basis => t(GRIND_BASIS_KEYS[basis]);
const targetSourceLabel = src => t(GRIND_SOURCE_KEYS[src]);

// Todo lo que necesita la bolsa: modelo global, sus filas, objetivo y sugerencia para `date`
async function grindContext(coffeeId, recipeTarget, date) {
  const rows = await fetchGrindData();
  const model = bestGrindModel(rows);
  const coffeeRows = rows.filter(r => r.coffee_id === coffeeId);
  const target = targetFlowFor(coffeeRows, recipeTarget);
  const suggestion = model && target ? suggestGrind(model, coffeeRows, {date, target: target.flow, step: grindStep}) : null;
  return {rows, model, coffeeRows, target, suggestion};
}

// --- Modal de brew: "Sugerida 13.5 · para 1.8 g/s" + botón Usar ------------------------
async function brewGrindHint(coffeeId, recipe) {
  const el = document.getElementById('b-grind-hint');
  el.hidden = true;
  const ctx = await grindContext(coffeeId, recipe?.target_flow ?? null, document.getElementById('b-date').value || todayLocal());
  // El modal puede haberse cerrado o cambiado de café mientras tanto
  if (_brewTargetId !== coffeeId || _editBrewId || !ctx.suggestion) return;
  const s = ctx.suggestion;
  el.innerHTML = `<span><b>${esc(t('grind.suggested_label'))}</b> ${esc(fmtGrind(s.grind))}`
    + ` · ${esc(t('grind.for_flow', {flow: s.target.toFixed(1), source: targetSourceLabel(ctx.target.source)}))}`
    + ` · ${esc(t('grind.drift_short', {drift: fmtDrift(ctx.model), basis: basisLabel(ctx.model.basis)}))}</span>`
    + `<button type="button" class="brew-grind-use" onclick="useSuggestedGrind(${s.grind})">${esc(t('grind.use'))}</button>`;
  el.hidden = false;
}

function useSuggestedGrind(g) {
  document.getElementById('b-grind').value = g;
  updateBrewSteps();
}

// --- Ficha: molienda vs días, color = flujo respecto al objetivo -----------------------
async function renderGrindSection(coffeeId) {
  const el = document.getElementById('detail-grind-section');
  if (!el) return;
  let recipeTarget = null;
  try {
    const r = await fetch('/api/coffees/' + coffeeId + '/recipe');
    if (r.ok) recipeTarget = (await r.json()).target_flow ?? null;
  } catch (_) {}
  const ctx = await grindContext(coffeeId, recipeTarget, todayLocal());
  if (currentDetail?.id !== coffeeId) return;
  const {model, coffeeRows, target, suggestion} = ctx;
  const basis = model?.basis ?? (coffeeRows.some(r => r.days_open != null) ? 'open' : 'roast');
  const key = basis === 'roast' ? 'days_roast' : 'days_open';
  const pts = coffeeRows.filter(r => r[key] != null);
  if (pts.length < 2) { el.innerHTML = ''; return; }

  const lines = [];
  if (model) {
    lines.push(t(driftConclusive(model) ? 'grind.drift_line' : 'grind.drift_unclear', {
      drift: fmtDrift(model), basis: basisLabel(model.basis),
      se: (model.gamma_se * 7).toFixed(2), n: model.n, bags: model.bags,
    }));
  } else {
    lines.push(t('grind.not_enough'));
  }
  if (suggestion && !currentDetail.finished_date) {
    lines.push(t('grind.today', {grind: fmtGrind(suggestion.grind), days: suggestion.days,
      flow: suggestion.target.toFixed(1), source: targetSourceLabel(target.source)}));
  }
  el.innerHTML = `
    <div class="detail-brews-header">${esc(t('grind.title'))}</div>
    <canvas class="dialin-chart"></canvas>
    <div class="dialin-legend">${esc(t('grind.legend', {basis: basisLabel(basis)}))}
      <span class="grind-key slow">●</span> ${esc(t('grind.key_slow'))}
      <span class="grind-key ok">●</span> ${esc(t('grind.key_ok'))}
      <span class="grind-key fast">●</span> ${esc(t('grind.key_fast'))}</div>
    ${lines.map(l => `<div class="dialin-line">${esc(l)}</div>`).join('')}`;
  drawGrindChart(el.querySelector('canvas'), {pts, key, model, target: target?.flow ?? null,
    suggestion: currentDetail.finished_date ? null : suggestion});
}

// Dispersión x = días, y = molienda (más fino abajo). Línea discontinua = previsión para el objetivo.
function drawGrindChart(canvas, {pts, key, model, target, suggestion}) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  canvas.width = w * dpr; canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const css = getComputedStyle(document.documentElement);
  const col = name => css.getPropertyValue(name).trim();

  const days = pts.map(r => r[key]).concat(suggestion ? [suggestion.days] : []);
  const dMax = Math.max(1, ...days);
  const line = model && target ? grindLine(model, pts, target, [0, dMax]) : [];
  const grinds = pts.map(r => r.grind).concat(line.map(p => p[1]), suggestion ? [suggestion.grind] : []);
  const gMin = Math.floor(Math.min(...grinds) - 0.5), gMax = Math.ceil(Math.max(...grinds) + 0.5);
  const pad = {l: 26, r: 8, t: 8, b: 18};
  const X = d => pad.l + d / dMax * (w - pad.l - pad.r);
  const Y = g => pad.t + (gMax - g) / (gMax - gMin) * (h - pad.t - pad.b);

  ctx.font = '10px system-ui, sans-serif';
  ctx.fillStyle = col('--text3');
  ctx.strokeStyle = col('--border');
  const gStep = Math.max(1, Math.ceil((gMax - gMin) / 4));
  for (let g = gMin; g <= gMax; g += gStep) {
    ctx.beginPath(); ctx.moveTo(pad.l, Y(g)); ctx.lineTo(w - pad.r, Y(g)); ctx.stroke();
    ctx.fillText(String(g), 2, Y(g) + 3);
  }
  const dStep = dMax > 42 ? 14 : dMax > 14 ? 7 : dMax > 6 ? 2 : 1;
  for (let d = 0; d <= dMax; d += dStep) ctx.fillText(String(d), X(d) - 3, h - 4);

  if (line.length) {
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = col('--text2');
    ctx.beginPath(); ctx.moveTo(X(line[0][0]), Y(line[0][1])); ctx.lineTo(X(line[1][0]), Y(line[1][1])); ctx.stroke();
    ctx.restore();
  }
  const tol = flowTolerance;
  pts.forEach(r => {
    const c = !target ? col('--accent2')
      : r.flow < target - tol ? col('--amber') : r.flow > target + tol ? col('--red') : col('--green');
    ctx.beginPath();
    ctx.arc(X(r[key]), Y(r.grind), 4, 0, Math.PI * 2);
    ctx.fillStyle = c;
    ctx.globalAlpha = 0.85;
    ctx.fill();
    ctx.globalAlpha = 1;
  });
  if (suggestion) {
    ctx.beginPath();
    ctx.arc(X(suggestion.days), Y(suggestion.grind), 5.5, 0, Math.PI * 2);
    ctx.strokeStyle = col('--text');
    ctx.lineWidth = 2; ctx.stroke(); ctx.lineWidth = 1;
  }
}

// --- Stats: deriva global por base de días -------------------------------------------
async function renderStatsGrind() {
  const el = document.getElementById('stats-grind');
  if (!el) return;
  const rows = await fetchGrindData();
  const best = bestGrindModel(rows);
  if (!best) { el.innerHTML = ''; return; }
  const fits = GRIND_BASES.map(b => fitGrindModel(rows, b)).filter(Boolean);
  const row = m => `
    <div class="stats-grind-row${m.basis === best.basis ? ' best' : ''}">
      <div class="stat-val">${esc(fmtDrift(m))}</div>
      <div class="stat-label">${esc(t('grind.stats_per_week', {basis: basisLabel(m.basis)}))}</div>
      <div class="stat-sub">${esc(t('grind.stats_sub', {se: (m.gamma_se * 7).toFixed(2), n: m.n, bags: m.bags}))}</div>
    </div>`;
  el.innerHTML = `
    <div class="stats-section">
      <h3>${esc(t('grind.stats_title'))}</h3>
      <div class="stats-grind">${fits.map(row).join('')}</div>
      <div class="dialin-line">${esc(t(driftConclusive(best) ? 'grind.stats_verdict' : 'grind.stats_unclear',
        {basis: basisLabel(best.basis)}))}</div>
      <div class="dialin-legend">${esc(t('grind.stats_help'))}</div>
    </div>`;
}
