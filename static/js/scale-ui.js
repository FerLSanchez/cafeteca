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
  scale.bus.addEventListener('scale:connected', wakeSessionSync);
  scale.bus.addEventListener('scale:disconnected', wakeSessionSync);
  scale.bus.addEventListener('scale:weight', e => wakeSessionActivity(e.detail));
  // Chrome suelta el wake lock al pasar a segundo plano: se pide de nuevo al volver
  document.addEventListener('visibilitychange', wakeSessionSync);
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

// Botón "⚖️ Pesar": conecta si hace falta y empieza a leer; si ya estaba leyendo, para.
async function brewScaleDose() {
  if (_doseSession) { brewScaleDoseStop(); return; }
  if (!await scaleEnsure()) return;
  brewScaleDoseStart();
}

// Panel de dosis: peso grande en vivo + [Tara] [Fijar dosis]. Levantar el recipiente también fija.
function brewScaleDoseStart() {
  brewScaleDoseStop();
  if (!scaleConnected()) return;
  const input = document.getElementById('b-dose');
  const panel = document.getElementById('b-dose-scale');
  const num = panel.querySelector('.scale-panel-num');
  const msg = panel.querySelector('.scale-dose-msg');
  const tracker = new DoseTracker();
  const onType = () => brewScaleDoseStop();
  input.addEventListener('input', onType, {once: true});
  input.classList.add('scale-live');
  panel.hidden = false;
  panel.classList.remove('locked');
  num.textContent = fmtG(scale.last?.weight ?? null);
  const render = () => {
    num.classList.toggle('stable', tracker.stable !== null);
    msg.textContent = tracker.stable !== null ? t('scale.dose.stable', {g: fmtG(tracker.stable)}) : t('scale.dose.live');
  };
  const unsub = scaleSubscribe(s => {
    const v = tracker.push(s);
    if (v !== null) { _doseSet(v); brewScaleDoseStop(true); return; }
    num.textContent = fmtG(Math.max(0, s.weight));
    if (s.weight >= 1 && s.weight <= 200) { input.value = s.weight.toFixed(1); updateBrewRatioDisplay(); }
    render();
  });
  _doseSession = {tracker, unsub, onType, input};
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

// keepMsg: deja el panel en estado "✓ Dosis fijada" (con "Volver a pesar") si hubo dosis.
function brewScaleDoseStop(keepMsg = false) {
  const s = _doseSession;
  if (!s) return;
  _doseSession = null;
  s.unsub();
  s.input.removeEventListener('input', s.onType);
  s.input.classList.remove('scale-live');
  const panel = document.getElementById('b-dose-scale');
  if (keepMsg && s.tracker.frozen !== null) {
    panel.classList.add('locked');
    panel.querySelector('.scale-dose-msg').textContent = t('scale.dose.locked', {g: fmtG(s.tracker.frozen)});
  } else panel.hidden = true;
}

// ---------------------------------------------------------------------------
// Vista de shot en vivo (modo auto) — reutilizada por el brew y la página de prueba (§5.2, §5.4)
// ---------------------------------------------------------------------------
function createShotView(root, opts) {
  // opts: {dose, target, tol, targetYield, stopOffset, compare, onDone(r, metrics, curve), onCancel, onRetry}
  root.innerHTML = `
    <div class="shot-status"></div>
    <div class="shot-stats">
      <div><span class="shot-num" data-k="time">0.0</span><span class="shot-unit">s</span></div>
      <div><span class="shot-num" data-k="weight">0.0</span><span class="shot-unit">g</span></div>
      <div><span class="shot-num shot-flow" data-k="flow">—</span><span class="shot-unit">g/s</span></div>
    </div>
    <div class="shot-sub"><span data-k="ratio"></span><span data-k="target"></span></div>
    <div class="shot-progress" hidden><div class="shot-progress-bar"></div></div>
    <div class="shot-cue" hidden><span></span>${stopSoundButtonHtml()}</div>
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
  let metrics = null;
  // Cuenta atrás de corte: solo con salida objetivo
  const cd = opts.targetYield ? new StopCountdown({targetYield: opts.targetYield, offset: opts.stopOffset}) : null;
  const cdRun = {timers: [], el: null, stopAtG: null};
  if (cd) {
    q('.shot-cue').hidden = false;
    q('.shot-cue span').textContent = t('scale.stop.cue', {cue: cd.cue.toFixed(1), target: fmtG(cd.target)});
  }

  const setStatus = key => { q('.shot-status').textContent = t(key); };
  setStatus('scale.shot.waiting');
  const setAction = (label, fn) => {
    q('.shot-actions').innerHTML = fn ? `<button type="button" class="btn-secondary">${esc(label)}</button>` : '';
    if (fn) q('.shot-actions button').onclick = fn;
  };
  setAction(t('scale.shot.cancel'), opts.onCancel);
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
    const last = tracker.samples[tracker.samples.length - 1];
    if (cd && tracker.state === 'running' && last) {
      const go = cd.push(last);
      if (go) stopCountdownRun(cdRun, go.beats, cd.cue, () => tracker.samples[tracker.samples.length - 1]?.weight);
      if (cdRun.el) cdRun.el.querySelector('.stop-cd-sub').textContent = `${fmtG(last.weight)} → ${fmtG(cd.cue)} g`;
    }
    const series = tracker.samples.length >= 3 ? flowSeries(tracker.samples.slice(-15)) : [];
    const flow = series.length ? series[series.length - 1].flow : null;
    renderLive(s, flow);
    drawShotChart(canvas, tracker.samples, opts);
    if (tracker.state === 'done' && before !== 'done') finish();
  });

  function finish() {
    unsub();
    setStatus('scale.shot.done');
    const r = tracker.result;
    if (!r) { setAction(t('scale.shot.retry'), opts.onRetry); return; }
    metrics = analyzeShot(tracker.samples, {target: opts.target, tol: opts.tol, ...r});
    if (metrics && cd?.startAt != null) {
      Object.assign(metrics, {stop_target_g: cd.target, stop_cue_g: cd.cue, stop_at_g: cdRun.stopAtG});
    }
    q('[data-k=time]').textContent = (r.time_ms / 1000).toFixed(1);
    q('[data-k=weight]').textContent = fmtG(r.yield_g);
    q('[data-k=flow]').textContent = metrics?.main_flow?.toFixed(2) ?? '—';
    q('.shot-summary').hidden = false;
    q('.shot-summary').innerHTML = shotSummaryHtml(metrics, r, opts);
    setAction(t('scale.shot.retry'), opts.onRetry);
    opts.onDone?.(r, metrics, curveFromShot(tracker.samples, r));
  }

  const onResize = () => drawShotChart(canvas, tracker.samples, opts);
  window.addEventListener('resize', onResize);
  drawShotChart(canvas, [], opts);

  return {
    destroy() {
      unsub();
      stopCountdownClear(cdRun);
      window.removeEventListener('resize', onResize);
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
  const yld = r?.yield_g ?? opts.yield_g;
  if (m.stop_cue_g != null && yld != null) {
    const d = yld - m.stop_target_g;
    rows.push([t('scale.metric.stop'), `${fmtG(m.stop_at_g)} → ${fmtG(yld)} g (${d >= 0 ? '+' : ''}${d.toFixed(1)})`]);
  }
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
// Cuenta atrás de corte (3 · 2 · 1 · STOP) a pantalla completa
// El ritmo lo marca el reloj, no las tramas de la báscula: una vez lanzada no cambia.
// ---------------------------------------------------------------------------
const STOP_HOLD_MS = 2000;   // el STOP sigue a la vista tras el último tiempo

// Offset global (una sola cafetera): de los últimos brews de cualquier café.
async function loadStopOffset() {
  try {
    const r = await fetch('/api/brews?limit=30');
    if (r.ok) return stopOffset((await r.json()).brews);
  } catch (_) {}
  return STOP_OFFSET_G;
}

function stopCountdownRun(run, beats, cue, weightNow) {
  stopCountdownClear(run);
  const el = document.createElement('div');
  el.className = 'stop-cd';
  el.setAttribute('role', 'alert');
  el.innerHTML = `<div class="stop-cd-num"></div>
    <div class="stop-cd-dots" aria-hidden="true">${'<i></i>'.repeat(beats)}</div>
    <div class="stop-cd-sub"></div>`;
  el.onclick = () => stopCountdownClear(run);
  document.body.appendChild(el);
  run.el = el;
  const show = n => {
    el.dataset.n = n;
    el.querySelector('.stop-cd-num').textContent = n ? String(n) : t('scale.stop.stop');
    el.querySelectorAll('.stop-cd-dots i').forEach((d, i) => d.classList.toggle('on', i < beats - n));
    el.classList.remove('pulse');
    void el.offsetWidth;   // reinicia la animación del tiempo
    el.classList.add('pulse');
    if (!n) run.stopAtG = weightNow() ?? null;
  };
  const t0 = performance.now();
  for (let i = 0; i <= beats; i++) {
    const n = beats - i;
    run.timers.push(setTimeout(() => show(n), Math.max(0, t0 + i * STOP_BEAT_S * 1000 - performance.now())));
  }
  run.timers.push(setTimeout(() => stopCountdownClear(run), beats * STOP_BEAT_S * 1000 + STOP_HOLD_MS));
  stopBeeps(beats);
}

// Quita la pantalla (al acabar, al tocarla o al cerrar el shot); stopAtG se conserva.
function stopCountdownClear(run) {
  run.timers.forEach(clearTimeout);
  run.timers = [];
  run.el?.remove();
  run.el = null;
}

// Sonido opcional (preferencia de este dispositivo): tic en cada número, tono largo en STOP.
let _stopAudio = null;

function stopSoundOn() {
  try { return localStorage.getItem('stopSound') === '1'; } catch (_) { return false; }
}

function stopSoundButtonHtml() {
  const on = stopSoundOn();
  return `<button type="button" class="shot-sound" onclick="stopSoundToggle()" aria-pressed="${on}"
    title="${esc(t('scale.stop.sound'))}" aria-label="${esc(t('scale.stop.sound'))}">${on ? '🔊' : '🔇'}</button>`;
}

function stopSoundToggle() {
  const on = !stopSoundOn();
  try { localStorage.setItem('stopSound', on ? '1' : '0'); } catch (_) {}
  stopAudioUnlock();
  document.querySelectorAll('.shot-sound').forEach(b => {
    b.textContent = on ? '🔊' : '🔇';
    b.setAttribute('aria-pressed', String(on));
  });
}

// El AudioContext solo arranca dentro de un gesto del usuario
function stopAudioUnlock() {
  if (!stopSoundOn()) return;
  try {
    _stopAudio ??= new AudioContext();
    _stopAudio.resume();
  } catch (_) { _stopAudio = null; }
}

function stopBeeps(beats) {
  const ctx = _stopAudio;
  if (!stopSoundOn() || !ctx || ctx.state !== 'running') return;
  for (let i = 0; i <= beats; i++) {
    const at = ctx.currentTime + 0.02 + i * STOP_BEAT_S;
    const last = i === beats;
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.frequency.value = last ? 1320 : 880;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.5, at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + (last ? 0.5 : 0.09));
    osc.connect(gain).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + (last ? 0.55 : 0.12));
  }
}

// ---------------------------------------------------------------------------
// Shot desde el modal de brew
// ---------------------------------------------------------------------------
let _shotView = null;
let _brewShotMetrics = null;
let _brewShotCurve = null;

// Shot en vivo dentro del paso 3 del modal: al terminar rellena salida, tiempo y métricas.
async function brewScaleShot() {
  stopAudioUnlock();   // antes de cualquier await: necesita el gesto del usuario
  if (!await scaleEnsure()) return;
  brewScaleDoseLock();   // si la dosis seguía en vivo, se fija con el último valor
  const dose = parseFloat(document.getElementById('b-dose').value) || null;
  const targetYield = parseFloat(document.getElementById('b-yield').value) || _brewRecipe?.yield_g || null;
  const target = brewTargetFlow() ?? _brewRecipe?.target_flow ?? null;
  // Mejor valorado; a igual nota, primero el que tenga curva y luego el más reciente
  const compare = (_brewHistory || []).filter(b => b.rating && b.shot_metrics?.main_flow != null && b.id !== _editBrewId)
    .sort((a, b) => b.rating - a.rating || !!b.shot_curve - !!a.shot_curve
      || (b.brew_date > a.brew_date ? 1 : -1))[0] || null;
  const stopOffset = targetYield ? await loadStopOffset() : null;
  const root = document.getElementById('b-shot-live');
  root.hidden = false;
  document.querySelector('#modal-brew .btn-shot').hidden = true;
  document.getElementById('b-shot-summary').hidden = true;
  _shotView?.destroy();
  _shotView = createShotView(root, {
    dose, target, tol: flowTolerance, targetYield, stopOffset, compare,
    onCancel: brewShotClose,
    onRetry: brewScaleShot,
    onDone: (r, metrics, curve) => {
      document.getElementById('b-yield').value = r.yield_g;
      document.getElementById('b-time').value = r.time_s;
      _brewShotMetrics = metrics;
      _brewShotCurve = curve;
      updateBrewRatioDisplay();
    },
  });
  root.scrollIntoView({behavior: 'smooth', block: 'start'});
}

// Quita la vista en vivo; si ya hay un shot aplicado vuelve a su resumen compacto.
function brewShotClose() {
  _shotView?.destroy();
  _shotView = null;
  const root = document.getElementById('b-shot-live');
  if (!root) return;
  root.hidden = true;
  document.querySelector('#modal-brew .btn-shot').hidden = !scaleSupported();
  const b = _editBrewId ? _brewCache[_editBrewId] : null;
  if (_brewShotMetrics) brewShowShotSummary(_brewShotMetrics, _brewShotCurve);
  else if (b?.shot_metrics) brewShowShotSummary(b.shot_metrics, b.shot_curve);
}

MODAL_ON_CLOSE['modal-brew'] = () => { brewScaleDoseStop(); brewShotClose(); wakeSessionEnd('brew'); };

// ---------------------------------------------------------------------------
// Página de prueba de la báscula (modo normal + modo auto)
// ---------------------------------------------------------------------------
let _testDose = null;
let _testShotView = null;

function openScaleTest() {
  closeModal('modal-settings');
  openModal('modal-scale');
  wakeSessionStart('test');
  scaleTestTab('normal');
  document.getElementById('st-target').value = document.getElementById('st-target').value || '1.5';
}

MODAL_ON_CLOSE['modal-scale'] = () => {
  wakeSessionEnd('test');
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

async function scaleTestAutoStart() {
  stopAudioUnlock();
  const target = parseFloat(document.getElementById('st-target').value) || null;
  const dose = parseFloat(document.getElementById('st-dose').value) || null;
  const targetYield = parseFloat(document.getElementById('st-yield').value) || null;
  const stopOffset = targetYield ? await loadStopOffset() : null;
  _testShotView?.destroy();
  _testShotView = createShotView(document.getElementById('st-shot-view'), {dose, target, tol: flowTolerance, targetYield, stopOffset});
}


// ---------------------------------------------------------------------------
// F2 — métricas guardadas y dial-in por café
// ---------------------------------------------------------------------------
function brewShowShotSummary(metrics, curve) {
  const el = document.getElementById('b-shot-summary');
  if (!el) return;
  el.hidden = !metrics;
  const yield_g = parseFloat(document.getElementById('b-yield')?.value) || null;
  el.innerHTML = metrics ? (curve ? '<canvas class="shot-chart"></canvas>' : '') + shotSummaryHtml(metrics, null, {yield_g}) : '';
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
      if (m) STOP_KEYS.forEach(k => { if (b.shot_metrics?.[k] != null) m[k] = b.shot_metrics[k]; });
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
    <canvas class="dialin-chart" role="img" aria-label="${esc(t('scale.dialin.legend'))}"></canvas>
    <div class="dialin-legend" aria-hidden="true">${esc(t('scale.dialin.legend'))}</div>
    ${lines.map(l => `<div class="dialin-line">${esc(l)}</div>`).join('')}`;
  const canvas = el.querySelector('canvas');
  drawCanvasFitted(canvas, () => drawDialIn(canvas, shots, target));
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

// ---------------------------------------------------------------------------
// Pantalla encendida durante la sesión de báscula (Screen Wake Lock)
// Activa mientras la báscula esté conectada y el modal de brew o la página de
// prueba estén abiertos; se suelta tras WAKE_IDLE_MS sin actividad en la báscula.
// ---------------------------------------------------------------------------
const WAKE_IDLE_MS = 10 * 60 * 1000;
const WAKE_ACTIVITY_G = 0.3;   // cambio de peso que cuenta como actividad
const _wake = {reasons: new Set(), lock: null, pending: false, lastActivity: 0, lastWeight: null, lastMs: 0, timer: null};

function wakeSessionStart(reason) {
  _wake.reasons.add(reason);
  _wake.lastActivity = Date.now();
  wakeSessionSync();
}

function wakeSessionEnd(reason) {
  _wake.reasons.delete(reason);
  wakeSessionSync();
}

function wakeSessionActivity({weight, ms}) {
  const moved = _wake.lastWeight === null || Math.abs(weight - _wake.lastWeight) >= WAKE_ACTIVITY_G;
  if (moved || ms !== _wake.lastMs) {
    _wake.lastWeight = weight;
    _wake.lastMs = ms;
    const wasIdle = Date.now() - _wake.lastActivity > WAKE_IDLE_MS;
    _wake.lastActivity = Date.now();
    if (wasIdle || !_wake.lock) wakeSessionSync();
  }
}

function wakeSessionWanted() {
  return _wake.reasons.size > 0 && scaleConnected() && document.visibilityState === 'visible'
    && Date.now() - _wake.lastActivity <= WAKE_IDLE_MS;
}

async function wakeSessionSync() {
  clearTimeout(_wake.timer);
  if (wakeSessionWanted()) {
    _wake.timer = setTimeout(wakeSessionSync, WAKE_IDLE_MS - (Date.now() - _wake.lastActivity) + 1000);
    if ((_wake.lock && !_wake.lock.released) || _wake.pending) return;
    _wake.pending = true;
    try {
      _wake.lock = await navigator.wakeLock?.request('screen') ?? null;
    } catch (_) {
      _wake.lock = null;   // p. ej. ahorro de batería: el navegador puede denegarlo
    } finally {
      _wake.pending = false;
    }
    if (!wakeSessionWanted()) wakeSessionSync();   // cambió mientras se pedía
  } else if (_wake.lock) {
    const lock = _wake.lock;
    _wake.lock = null;
    lock.release().catch(() => {});
  }
}
