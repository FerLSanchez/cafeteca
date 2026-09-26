// ---------------------------------------------------------------------------
// Bookoo — UI: chip de conexión, dosis en el modal de brew, vista de shot en
// vivo y página de prueba de la báscula. Spec: docs/features/bookoo-scale.md §5.
// Depende de scale.js (BLE + bus) y scale-analysis.js (detectores puros).
// ---------------------------------------------------------------------------
let flowTolerance = 0.2;   // cargado desde /api/settings

function scaleUiInit() {
  const supported = scaleSupported();
  document.querySelectorAll('.scale-only').forEach(el => { el.hidden = !supported; });
  if (!supported) return;
  scale.bus.addEventListener('scale:connected', scaleChipRender);
  scale.bus.addEventListener('scale:weight', scaleChipRender);
  scale.bus.addEventListener('scale:disconnected', () => {
    scaleChipRender();
    if (!scale.userDisconnect) showToast(t('scale.disconnected'));
    scale.userDisconnect = false;
  });
}

function scaleConnected() {
  return !!scale.device?.gatt?.connected;
}

// Conecta si hace falta (necesita gesto del usuario la primera vez). Devuelve true/false.
async function scaleEnsure() {
  if (scaleConnected()) return true;
  try {
    await scaleConnect();
    return true;
  } catch (err) {
    if (err?.name !== 'NotFoundError') showToast(t('scale.connect_failed'));  // NotFound = chooser cancelado
    return false;
  }
}

function scaleChipRender() {
  const chip = document.getElementById('scale-chip');
  if (!chip) return;
  chip.hidden = !scaleConnected();
  const bat = scale.last?.battery;
  chip.textContent = bat != null ? `⚖️ ${bat}%` : '⚖️';
  const low = bat != null && bat <= SCALE_LOW_BATTERY;
  chip.classList.toggle('low', low);
  if (low && !_lowBatteryWarned) {
    _lowBatteryWarned = true;
    showToast(t('scale.low_battery', {pct: bat}));
  }
}

const SCALE_LOW_BATTERY = 15;   // %
let _lowBatteryWarned = false;  // un aviso por sesión

function scaleChipClick() {
  showConfirm({
    icon: '⚖️', title: t('scale.chip.title'),
    msg: t('scale.chip.msg', {name: scale.device?.name || 'Bookoo'}),
    btnLabel: t('scale.btn.disconnect'), btnClass: 'btn-danger',
    onConfirm: scaleDisconnect,
  });
}

// Suscripción al peso con muestras {t (s), ms, weight, flow}. Devuelve la función para cancelar.
function scaleSubscribe(fn) {
  const h = e => fn({...e.detail, t: performance.now() / 1000});
  scale.bus.addEventListener('scale:weight', h);
  return () => scale.bus.removeEventListener('scale:weight', h);
}

const fmtG = v => (v == null ? '—' : v.toFixed(1));

// ---------------------------------------------------------------------------
// Dosis (modo normal) → campo "Café (g)" del modal de brew (§5.1)
// ---------------------------------------------------------------------------
let _doseSession = null;

async function brewScaleDose() {
  if (_doseSession) { brewScaleDoseStop(); return; }
  if (!await scaleEnsure()) return;
  const input = document.getElementById('b-dose');
  const status = document.getElementById('b-dose-scale');
  const tracker = new DoseTracker();
  const onType = () => brewScaleDoseStop();
  input.addEventListener('input', onType, {once: true});
  input.classList.add('scale-live');
  status.hidden = false;
  const render = () => {
    const frozen = tracker.frozen !== null;
    status.querySelector('.scale-dose-msg').textContent = frozen
      ? t('scale.dose.locked', {g: fmtG(tracker.frozen)})
      : (tracker.stable !== null ? t('scale.dose.stable', {g: fmtG(tracker.stable)}) : t('scale.dose.live'));
    status.querySelector('.scale-dose-ok').hidden = frozen;
  };
  const unsub = scaleSubscribe(s => {
    const v = tracker.push(s);
    if (v !== null) { _doseSet(v); brewScaleDoseStop(true); return; }
    if (s.weight >= 1 && s.weight <= 200) { input.value = s.weight.toFixed(1); updateBrewRatioDisplay(); }
    render();
  });
  _doseSession = {tracker, unsub, onType, input, render};
  render();
}

function _doseSet(v) {
  const input = document.getElementById('b-dose');
  input.value = v.toFixed(1);
  updateBrewRatioDisplay();
}

function brewScaleDoseLock() {
  if (!_doseSession) return;
  const v = _doseSession.tracker.freeze();
  if (v !== null) _doseSet(v);
  brewScaleDoseStop(true);
}

function brewScaleDoseStop(keepMsg = false) {
  const s = _doseSession;
  if (!s) return;
  _doseSession = null;
  s.unsub();
  s.input.removeEventListener('input', s.onType);
  s.input.classList.remove('scale-live');
  const status = document.getElementById('b-dose-scale');
  if (keepMsg && s.tracker.frozen !== null) {
    status.querySelector('.scale-dose-msg').textContent = t('scale.dose.locked', {g: fmtG(s.tracker.frozen)});
    status.querySelector('.scale-dose-ok').hidden = true;
  } else status.hidden = true;
}

// ---------------------------------------------------------------------------
// Vista de shot en vivo (modo auto) — reutilizada por el brew y la página de prueba (§5.2, §5.4)
// ---------------------------------------------------------------------------
function createShotView(root, opts) {
  // opts: {dose, target, tol, targetYield, compare, onUse}
  root.innerHTML = `
    <div class="shot-status"></div>
    <div class="shot-stats">
      <div><span class="shot-num" data-k="time">0.0</span><span class="shot-unit">s</span></div>
      <div><span class="shot-num" data-k="weight">0.0</span><span class="shot-unit">g</span></div>
      <div><span class="shot-num shot-flow" data-k="flow">—</span><span class="shot-unit">g/s</span></div>
    </div>
    <div class="shot-sub"><span data-k="ratio"></span><span data-k="target"></span></div>
    <div class="shot-progress" hidden><div class="shot-progress-bar"></div></div>
    <canvas class="shot-chart"></canvas>
    <div class="shot-summary" hidden></div>
    <div class="shot-actions"></div>`;
  const q = sel => root.querySelector(sel);
  const canvas = q('.shot-chart');
  // Curva fantasma: el mejor shot valorado del mismo café (si guardó curva)
  if (opts.compare?.shot_curve) {
    opts.ghostSeries = flowSeries(samplesFromCurve(opts.compare.shot_curve)).filter(p => p.flow !== null);
    canvas.insertAdjacentHTML('afterend',
      `<div class="shot-legend">${esc(t('scale.shot.ghost', {rating: '★'.repeat(opts.compare.rating || 0)}))}</div>`);
  }
  const tracker = new ShotTracker();
  let wakeLock = null;
  let metrics = null;

  const requestWake = async () => {
    try { wakeLock = await navigator.wakeLock?.request('screen'); } catch (_) { wakeLock = null; }
  };
  requestWake();

  const setStatus = key => { q('.shot-status').textContent = t(key); };
  setStatus('scale.shot.waiting');
  if (opts.target) q('[data-k=target]').textContent = t('scale.shot.target', {target: opts.target.toFixed(1), tol: opts.tol.toFixed(1)});

  const renderLive = (s, flow) => {
    const running = tracker.state !== 'waiting';
    const last = tracker.samples[tracker.samples.length - 1];
    q('[data-k=time]').textContent = running && last ? last.t.toFixed(1) : '0.0';
    q('[data-k=weight]').textContent = fmtG(running && last ? last.weight : Math.max(0, s.weight));
    q('[data-k=flow]').textContent = flow == null ? '—' : Math.max(0, flow).toFixed(1);
    const flowEl = q('[data-k=flow]');
    flowEl.classList.toggle('in-band', !!opts.target && flow != null && Math.abs(flow - opts.target) <= opts.tol);
    flowEl.classList.toggle('over', !!opts.target && flow != null && flow > opts.target + opts.tol);
    const w = running && last ? last.weight : 0;
    q('[data-k=ratio]').textContent = opts.dose && w > 0 ? `1:${(w / opts.dose).toFixed(2)}` : '';
    if (opts.targetYield) {
      q('.shot-progress').hidden = false;
      q('.shot-progress-bar').style.width = `${Math.min(100, w / opts.targetYield * 100)}%`;
    }
  };

  const unsub = scaleSubscribe(s => {
    const before = tracker.state;
    tracker.push(s);
    if (before === 'waiting' && tracker.state === 'running') setStatus('scale.shot.running');
    const series = tracker.samples.length >= 3 ? flowSeries(tracker.samples.slice(-15)) : [];
    const flow = series.length ? series[series.length - 1].flow : null;
    renderLive(s, flow);
    drawShotChart(canvas, tracker.samples, opts);
    if (tracker.state === 'done' && before !== 'done') finish();
  });

  function finish() {
    unsub();
    wakeLock?.release?.().catch(() => {});
    setStatus('scale.shot.done');
    const r = tracker.result;
    if (!r) return;
    metrics = analyzeShot(tracker.samples, {target: opts.target, tol: opts.tol, ...r});
    q('[data-k=time]').textContent = (r.time_ms / 1000).toFixed(1);
    q('[data-k=weight]').textContent = fmtG(r.yield_g);
    q('[data-k=flow]').textContent = metrics?.main_flow?.toFixed(2) ?? '—';
    q('.shot-summary').hidden = false;
    q('.shot-summary').innerHTML = shotSummaryHtml(metrics, r, opts);
    if (opts.onUse) {
      q('.shot-actions').innerHTML = `<button class="btn-primary">${esc(t('scale.shot.use'))}</button>`;
      q('.shot-actions button').onclick = () => opts.onUse(r, metrics, curveFromShot(tracker.samples, r));
    }
  }

  const onResize = () => drawShotChart(canvas, tracker.samples, opts);
  window.addEventListener('resize', onResize);
  drawShotChart(canvas, [], opts);

  return {
    destroy() {
      unsub();
      window.removeEventListener('resize', onResize);
      wakeLock?.release?.().catch(() => {});
      root.innerHTML = '';
    },
    get metrics() { return metrics; },
    get result() { return tracker.result; },
  };
}

function shotSummaryHtml(m, r, opts) {
  if (!m) return '';
  const rows = [
    [t('scale.metric.main_flow'), `${m.main_flow ?? '—'} g/s`],
    [t('scale.metric.avg_flow'), `${m.avg_flow ?? '—'} g/s`],
    [t('scale.metric.ramp'), `${m.t_ramp_s} s`],
    [t('scale.metric.peak'), `${m.peak_flow} g/s @ ${m.t_peak_s} s`],
  ];
  if (m.target_flow) {
    rows.push([t('scale.metric.in_band'), `${m.in_band_pct ?? '—'} %`]);
    rows.push([t('scale.metric.overshoot'), `${m.overshoot_s} s`]);
  }
  rows.push([t('scale.metric.stability'), m.flow_cv == null ? '—' : `${Math.round(m.flow_cv * 100)} %`]);
  rows.push([t('scale.metric.tail'), `${m.tail_s} s · ${m.tail_g} g`]);
  let html = `<div class="shot-metrics">${rows.map(([k, v]) =>
    `<div class="shot-metric"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</div>`;
  if (m.irregular) html += `<div class="shot-warn">⚠️ ${esc(t('scale.metric.irregular'))}</div>`;
  const c = opts.compare;
  if (c?.shot_metrics?.main_flow != null && m.main_flow != null) {
    const dRamp = m.t_ramp_s - (c.shot_metrics.t_ramp_s ?? m.t_ramp_s);
    html += `<div class="shot-compare">${esc(t('scale.shot.compare', {
      rating: '★'.repeat(c.rating || 0),
      now: m.main_flow.toFixed(2), best: c.shot_metrics.main_flow.toFixed(2),
      ramp: (dRamp >= 0 ? '+' : '') + dRamp.toFixed(1),
    }))}</div>`;
  }
  return html;
}

// Curva de flujo con la banda objetivo sombreada; el peso va en segundo plano.
function drawShotChart(canvas, samples, opts) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  if (canvas.width !== w * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const css = getComputedStyle(document.documentElement);
  const col = name => css.getPropertyValue(name).trim();
  const series = samples.length >= 3 ? flowSeries(samples).filter(p => p.flow !== null) : [];
  const ghost = opts.ghostSeries || [];
  const tMax = Math.max(30, ...samples.map(s => s.t), ...ghost.map(p => p.t));
  const fMax = Math.max(3, (opts.target || 0) + 1, ...series.map(p => p.flow * 1.1), ...ghost.map(p => p.flow * 1.1));
  const wMax = Math.max(opts.targetYield || 40, ...samples.map(s => s.weight * 1.1));
  const pad = {l: 26, r: 6, t: 6, b: 16};
  const X = tt => pad.l + tt / tMax * (w - pad.l - pad.r);
  const Yf = f => h - pad.b - Math.max(0, f) / fMax * (h - pad.t - pad.b);
  const Yw = g => h - pad.b - Math.max(0, g) / wMax * (h - pad.t - pad.b);

  ctx.font = '10px system-ui, sans-serif';
  ctx.fillStyle = col('--text3');
  ctx.strokeStyle = col('--border');
  ctx.lineWidth = 1;
  for (let f = 0; f <= fMax; f += 1) {
    ctx.beginPath(); ctx.moveTo(pad.l, Yf(f)); ctx.lineTo(w - pad.r, Yf(f)); ctx.stroke();
    ctx.fillText(String(f), 4, Yf(f) + 3);
  }
  for (let s = 0; s <= tMax; s += 10) ctx.fillText(`${s}s`, X(s) - 6, h - 3);

  if (opts.target) {
    ctx.fillStyle = col('--green-dim');
    ctx.fillRect(pad.l, Yf(opts.target + opts.tol), w - pad.l - pad.r, Yf(opts.target - opts.tol) - Yf(opts.target + opts.tol));
    ctx.strokeStyle = col('--green-border');
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(pad.l, Yf(opts.target)); ctx.lineTo(w - pad.r, Yf(opts.target)); ctx.stroke();
    ctx.setLineDash([]);
  }
  if (ghost.length > 1) {
    ctx.strokeStyle = col('--text2');
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ghost.forEach((p, i) => (i ? ctx.lineTo(X(p.t), Yf(p.flow)) : ctx.moveTo(X(p.t), Yf(p.flow))));
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (samples.length > 1) {
    ctx.strokeStyle = col('--text3');
    ctx.lineWidth = 1;
    ctx.beginPath();
    samples.forEach((s, i) => (i ? ctx.lineTo(X(s.t), Yw(s.weight)) : ctx.moveTo(X(s.t), Yw(s.weight))));
    ctx.stroke();
  }
  if (series.length > 1) {
    ctx.strokeStyle = col('--accent');
    ctx.lineWidth = 2;
    ctx.beginPath();
    series.forEach((p, i) => (i ? ctx.lineTo(X(p.t), Yf(p.flow)) : ctx.moveTo(X(p.t), Yf(p.flow))));
    ctx.stroke();
  }
}

// ---------------------------------------------------------------------------
// Shot desde el modal de brew
// ---------------------------------------------------------------------------
let _shotView = null;
let _brewShotMetrics = null;
let _brewShotCurve = null;

async function brewScaleShot() {
  if (!await scaleEnsure()) return;
  brewScaleDoseLock();   // si la dosis seguía en vivo, se fija con el último valor
  const dose = parseFloat(document.getElementById('b-dose').value) || null;
  const targetYield = parseFloat(document.getElementById('b-yield').value) || null;
  const target = _brewRecipe?.target_flow ?? null;
  let compare = null;
  if (_brewTargetId) {
    try {
      const brews = await api('/coffees/' + _brewTargetId + '/brews');
      // Mejor valorado; a igual nota, primero el que tenga curva y luego el más reciente
      compare = (brews || []).filter(b => b.rating && b.shot_metrics?.main_flow != null && b.id !== _editBrewId)
        .sort((a, b) => b.rating - a.rating || !!b.shot_curve - !!a.shot_curve
          || (b.brew_date > a.brew_date ? 1 : -1))[0] || null;
    } catch (_) {}
  }
  openModal('modal-shot');
  _shotView?.destroy();
  _shotView = createShotView(document.getElementById('shot-view'), {
    dose, target, tol: flowTolerance, targetYield, compare,
    onUse: (r, metrics, curve) => {
      document.getElementById('b-yield').value = r.yield_g;
      document.getElementById('b-time').value = r.time_s;
      _brewShotMetrics = metrics;
      _brewShotCurve = curve;
      brewShowShotSummary(metrics, curve);
      updateBrewRatioDisplay();
      closeShotModal();
    },
  });
}

function closeShotModal() { closeModal('modal-shot'); }

MODAL_ON_CLOSE['modal-shot'] = () => { _shotView?.destroy(); _shotView = null; };
MODAL_ON_CLOSE['modal-brew'] = () => brewScaleDoseStop();

// ---------------------------------------------------------------------------
// Página de prueba de la báscula (modo normal + modo auto)
// ---------------------------------------------------------------------------
let _testDose = null;
let _testShotView = null;

function openScaleTest() {
  closeModal('modal-settings');
  openModal('modal-scale');
  scaleTestTab('normal');
  document.getElementById('st-target').value = document.getElementById('st-target').value || '1.5';
}

MODAL_ON_CLOSE['modal-scale'] = () => {
  _testDose?.unsub(); _testDose = null;
  _testShotView?.destroy(); _testShotView = null;
};

async function scaleTestConnect() {
  if (await scaleEnsure()) scaleTestTab(document.querySelector('#modal-scale .st-tab.active')?.dataset.tab || 'normal');
}

function scaleTestTab(tab) {
  document.querySelectorAll('#modal-scale .st-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.getElementById('st-normal').hidden = tab !== 'normal';
  document.getElementById('st-auto').hidden = tab !== 'auto';
  _testDose?.unsub(); _testDose = null;
  _testShotView?.destroy(); _testShotView = null;
  if (tab === 'normal') scaleTestNormalStart();
  else scaleTestAutoStart();
}

function scaleTestNormalStart() {
  const tracker = new DoseTracker();
  const big = document.getElementById('st-weight');
  const msg = document.getElementById('st-dose-msg');
  big.textContent = '—';
  msg.textContent = scaleConnected() ? t('scale.dose.live') : t('scale.test.connect_first');
  const unsub = scaleSubscribe(s => {
    tracker.push(s);
    big.textContent = s.weight.toFixed(1);
    msg.textContent = tracker.frozen !== null ? t('scale.dose.locked', {g: fmtG(tracker.frozen)})
      : tracker.stable !== null ? t('scale.dose.stable', {g: fmtG(tracker.stable)}) : t('scale.dose.live');
  });
  _testDose = {tracker, unsub};
}

function scaleTestLock() {
  const v = _testDose?.tracker.freeze();
  if (v != null) document.getElementById('st-dose-msg').textContent = t('scale.dose.locked', {g: fmtG(v)});
}

function scaleTestAutoStart() {
  const target = parseFloat(document.getElementById('st-target').value) || null;
  const dose = parseFloat(document.getElementById('st-dose').value) || null;
  _testShotView?.destroy();
  _testShotView = createShotView(document.getElementById('st-shot-view'), {dose, target, tol: flowTolerance});
}


// ---------------------------------------------------------------------------
// F2 — métricas guardadas y dial-in por café
// ---------------------------------------------------------------------------
function brewShowShotSummary(metrics, curve) {
  const el = document.getElementById('b-shot-summary');
  if (!el) return;
  el.hidden = !metrics;
  el.innerHTML = metrics ? (curve ? '<canvas class="shot-chart"></canvas>' : '') + shotSummaryHtml(metrics, null, {}) : '';
  if (metrics && curve) {
    // tras abrir el modal, para que el canvas ya tenga tamaño
    requestAnimationFrame(() => drawShotChart(el.querySelector('canvas'), samplesFromCurve(curve),
      {target: metrics.target_flow, tol: flowTolerance}));
  }
}

// Mini curva de flujo (SVG) para las filas de brews
function curveSparkline(curve) {
  const series = flowSeries(samplesFromCurve(curve)).filter(p => p.flow !== null);
  if (series.length < 3) return '';
  const W = 64, H = 16;
  const tMax = series[series.length - 1].t || 1;
  const fMax = Math.max(1, ...series.map(p => p.flow));
  const step = Math.max(1, Math.floor(series.length / 40));
  const pts = series.filter((_, i) => i % step === 0)
    .map(p => `${(p.t / tMax * W).toFixed(1)},${(H - Math.max(0, p.flow) / fMax * (H - 1)).toFixed(1)}`).join(' ');
  return `<svg class="sparkline" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true"><polyline points="${pts}"/></svg>`;
}

// Recalcula shot_metrics de todos los brews con curva (tras cambiar el análisis o la tolerancia)
async function recomputeShotMetrics() {
  let offset = 0, updated = 0, more = true;
  while (more) {
    const page = await api(`/brews?limit=100&offset=${offset}`);
    more = page.has_more;
    offset += page.brews.length;
    for (const b of page.brews) {
      if (!b.shot_curve) continue;
      const m = reanalyzeCurve(b.shot_curve, {target: b.shot_metrics?.target_flow ?? null, tol: flowTolerance, yield_g: b.yield_g});
      if (m && JSON.stringify(m) !== JSON.stringify(b.shot_metrics)) {
        await api('/brews/' + b.id, {method: 'PUT', body: JSON.stringify({shot_metrics: m})});
        updated++;
      }
    }
  }
  showToast(t('scale.recompute_done', {count: updated}));
}

// Rango [min, max] de un array de números, formateado
const fmtRange = (vals, d = 2) => {
  const lo = Math.min(...vals), hi = Math.max(...vals);
  return lo === hi ? lo.toFixed(d) : `${lo.toFixed(d)}–${hi.toFixed(d)}`;
};

// Sección "Dial-in" en la ficha: flujo principal vs valoración de los shots con báscula.
async function renderDialIn(coffeeId, brews) {
  const el = document.getElementById('detail-dialin-section');
  if (!el) return;
  const shots = brews.filter(b => b.shot_metrics?.main_flow != null);
  if (shots.length < 2) { el.innerHTML = ''; return; }
  let target = null;
  try {
    const r = await fetch('/api/coffees/' + coffeeId + '/recipe');
    if (r.ok) target = (await r.json()).target_flow ?? null;
  } catch (_) {}

  const rated = shots.filter(b => b.rating);
  const lines = [];
  if (rated.length) {
    const top = Math.max(...rated.map(b => b.rating));
    const best = rated.filter(b => b.rating === top);
    lines.push(t('scale.dialin.best', {
      stars: '★'.repeat(top), n: best.length,
      flow: fmtRange(best.map(b => b.shot_metrics.main_flow)),
      ramp: fmtRange(best.map(b => b.shot_metrics.t_ramp_s), 1),
    }));
  }
  if (target) {
    const inBand = shots.filter(b => Math.abs(b.shot_metrics.main_flow - target) <= flowTolerance).length;
    lines.push(t('scale.dialin.in_band', {n: inBand, total: shots.length, target: target.toFixed(1)}));
  }
  const irregular = shots.filter(b => b.shot_metrics.irregular).length;
  if (irregular) lines.push(t('scale.dialin.irregular', {n: irregular, total: shots.length}));

  el.innerHTML = `
    <div class="detail-brews-header">${esc(t('scale.dialin.title', {count: shots.length}))}</div>
    <canvas class="dialin-chart"></canvas>
    <div class="dialin-legend">${esc(t('scale.dialin.legend'))}</div>
    ${lines.map(l => `<div class="dialin-line">${esc(l)}</div>`).join('')}`;
  drawDialIn(el.querySelector('canvas'), shots, target);
}

// Dispersión: x = flujo principal (g/s), y = valoración (sin valorar abajo). El más reciente, resaltado.
function drawDialIn(canvas, shots, target) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  canvas.width = w * dpr; canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const css = getComputedStyle(document.documentElement);
  const col = name => css.getPropertyValue(name).trim();
  const flows = shots.map(b => b.shot_metrics.main_flow);
  if (target) flows.push(target - flowTolerance, target + flowTolerance);
  const xMin = Math.max(0, Math.floor((Math.min(...flows) - 0.2) * 10) / 10);
  const xMax = Math.ceil((Math.max(...flows) + 0.2) * 10) / 10;
  const pad = {l: 22, r: 8, t: 8, b: 18};
  const X = f => pad.l + (f - xMin) / (xMax - xMin) * (w - pad.l - pad.r);
  const Y = r => pad.t + (5 - r) / 5 * (h - pad.t - pad.b);   // r=0 → sin valorar

  ctx.font = '10px system-ui, sans-serif';
  ctx.fillStyle = col('--text3');
  ctx.strokeStyle = col('--border');
  for (let r = 0; r <= 5; r++) {
    ctx.beginPath(); ctx.moveTo(pad.l, Y(r)); ctx.lineTo(w - pad.r, Y(r)); ctx.stroke();
    ctx.fillText(r ? `${r}★` : '—', 2, Y(r) + 3);
  }
  const step = xMax - xMin > 1.5 ? 0.5 : 0.2;
  for (let f = Math.ceil(xMin / step) * step; f <= xMax + 1e-9; f += step) ctx.fillText(f.toFixed(1), X(f) - 8, h - 4);
  if (target) {
    ctx.fillStyle = col('--green-dim');
    ctx.fillRect(X(target - flowTolerance), pad.t, X(target + flowTolerance) - X(target - flowTolerance), h - pad.t - pad.b);
  }
  // brews llega ordenado del más reciente al más antiguo
  shots.slice().reverse().forEach((b, i, arr) => {
    const last = i === arr.length - 1;
    ctx.beginPath();
    ctx.arc(X(b.shot_metrics.main_flow), Y(b.rating || 0), last ? 5 : 4, 0, Math.PI * 2);
    ctx.fillStyle = last ? col('--accent2') : col('--accent');
    ctx.globalAlpha = last ? 1 : 0.7;
    ctx.fill();
    ctx.globalAlpha = 1;
    if (b.shot_metrics.irregular) { ctx.strokeStyle = col('--red'); ctx.lineWidth = 1.5; ctx.stroke(); ctx.lineWidth = 1; }
  });
}
