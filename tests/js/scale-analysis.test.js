// Detectores y análisis de flujo contra la captura real: node --test tests/js/*.test.js
const test = require('node:test');
const assert = require('node:assert');
const {parseScalePacket} = require('../../static/js/scale.js');
const {DoseTracker, ShotTracker, analyzeShot, curveFromShot, reanalyzeCurve} = require('../../static/js/scale-analysis.js');

const {frames} = require('./fixtures/f0-real-2026-09-26.json');
const pkts = frames.map(f => ({label: f.label, t: f.t / 1000,
  ...parseScalePacket(f.hex.split(' ').map(h => parseInt(h, 16)))}));
const dose = pkts.filter(p => p.label === 'dose');
const shot = pkts.filter(p => p.label === 'shot');

function runShot() {
  const st = new ShotTracker();
  shot.forEach(p => st.push(p));
  return st;
}

test('dosis: congela el último estable (17.0) al levantar el recipiente', () => {
  const dt = new DoseTracker();
  dose.forEach(p => assert.strictEqual(dt.push(p), null, 'no congela mientras se ajusta'));
  const t = dose.at(-1).t;
  dt.push({t: t + 0.1, weight: 0});
  assert.strictEqual(dt.push({t: t + 0.2, weight: 0}), 17);
});

test('dosis: una sola lectura a 0 no congela; el pico de 700 g se ignora', () => {
  const dt = new DoseTracker();
  [[0, 17], [0.5, 17], [1, 17], [1.2, 0], [1.3, 17], [1.4, 760], [1.5, 17]]
    .forEach(([t, weight]) => dt.push({t, weight}));
  assert.strictEqual(dt.frozen, null);
  assert.strictEqual(dt.stable, 17);
});

test('dosis: ✓ manual usa el valor en vivo si aún no hay estable', () => {
  const dt = new DoseTracker();
  dt.push({t: 0, weight: 16.93});
  assert.strictEqual(dt.freeze(), 16.9);
});

test('shot: la taza (auto-tara) no arranca; fin cuando el timer vuelve a 0', () => {
  const st = runShot();
  assert.strictEqual(st.state, 'done');
  assert.deepStrictEqual(st.result, {yield_g: 38.5, time_s: 28, time_ms: 27800});
  assert.ok(st.samples[0].t > 1 && st.samples[0].t < 1.2, 'eje de tiempo alineado con el timer');
});

test('shot: respaldo si el timer se congela en vez de volver a 0', () => {
  const st = new ShotTracker();
  for (let i = 1; i <= 10; i++) st.push({t: i / 10, ms: i * 100, weight: i});
  for (let i = 0; i < 40; i++) st.push({t: 1.1 + i / 10, ms: 1000, weight: 10});
  assert.strictEqual(st.state, 'done');
  assert.strictEqual(st.result.yield_g, 10);
});

test('análisis del shot real con objetivo 1.5 ± 0.2 g/s', () => {
  const st = runShot();
  const m = analyzeShot(st.samples, {target: 1.5, tol: 0.2, ...st.result});
  assert.strictEqual(m.avg_flow, 1.38);                 // lo que da la báscula
  assert.ok(m.main_flow > 1.65 && m.main_flow < 1.8);   // el flujo "real"
  assert.ok(m.t_ramp_s > 5 && m.t_ramp_s < 8);
  assert.ok(m.peak_flow > 2 && m.peak_flow < 2.4);
  assert.ok(m.overshoot_s > 5);
  assert.ok(m.tail_s > 3 && m.tail_s < 6);
  assert.strictEqual(m.irregular, true, 'la caída a ~1.1 g/s en el segundo 11.5');
  assert.ok(JSON.stringify(m).length < 400);
});

test('análisis sin objetivo: sin métricas de banda', () => {
  const st = runShot();
  const m = analyzeShot(st.samples, st.result);
  assert.strictEqual(m.overshoot_s, null);
  assert.strictEqual(m.in_band_pct, null);
  assert.ok(m.main_flow > 1.6);
});

test('análisis: flujo constante no es irregular', () => {
  const s = [];
  for (let t = 0; t <= 25; t += 0.1) s.push({t, weight: 1.5 * t});
  const m = analyzeShot(s, {target: 1.5});
  assert.strictEqual(m.irregular, false);
  assert.strictEqual(m.main_flow, 1.5);
  assert.strictEqual(m.in_band_pct, 100);
});

test('análisis: pocas muestras → null', () => {
  assert.strictEqual(analyzeShot([{t: 0, weight: 0}]), null);
});

test('curva guardada: ~3 KB y reproduce las métricas del shot en vivo', () => {
  const st = runShot();
  const live = analyzeShot(st.samples, {target: 1.5, tol: 0.2, ...st.result});
  const curve = curveFromShot(st.samples, st.result);
  assert.ok(JSON.stringify(curve).length < 4000);
  const again = reanalyzeCurve(JSON.parse(JSON.stringify(curve)), {target: 1.5, tol: 0.2, yield_g: st.result.yield_g});
  assert.strictEqual(again.main_flow, live.main_flow);
  assert.strictEqual(again.avg_flow, live.avg_flow);
  assert.strictEqual(again.irregular, live.irregular);
  assert.ok(Math.abs(again.t_ramp_s - live.t_ramp_s) <= 0.3);
});

// ---------------------------------------------------------------------------
// Cuenta atrás para cortar el shot
// ---------------------------------------------------------------------------
const {StopCountdown, stopOffset, STOP_BEAT_S, STOP_OFFSET_G} = require('../../static/js/scale-analysis.js');

// Shot sintético: preinfusión 0–4 s, luego flujo constante
const steady = (flow, until = 40) => {
  const out = [];
  for (let t = 0; t <= until; t += 0.1) out.push({t: +t.toFixed(1), weight: t < 4 ? 0.2 * t : 0.8 + flow * (t - 4)});
  return out;
};
const runCd = (samples, opts) => {
  const cd = new StopCountdown(opts);
  for (const s of samples) { const r = cd.push(s); if (r) return {cd, r}; }
  return {cd, r: null};
};

test('cuenta atrás: arranca con 3 tiempos y el STOP cae cuando el peso llega al punto de corte', () => {
  const {cd, r} = runCd(steady(1.8), {targetYield: 36, offset: 0.6});
  assert.strictEqual(cd.cue, 35.4);
  assert.strictEqual(r.beats, 3);
  assert.ok(Math.abs(r.stopAt - r.startAt - 3 * STOP_BEAT_S) < 1e-9);
  const tCue = 4 + (35.4 - 0.8) / 1.8;
  assert.ok(Math.abs(r.stopAt - tCue) < 0.15, `stop ${r.stopAt} vs ${tCue}`);
  // el ritmo es fijo: 3, 2, 1 y STOP (0) cada STOP_BEAT_S
  assert.deepStrictEqual([0, 0.99, 1, 2, 3, 4].map(d => cd.beatAt(r.startAt + d)), [3, 3, 2, 1, 0, 0]);
  assert.strictEqual(cd.push({t: r.startAt + 0.5, weight: 40}), null, 'una vez lanzada no se recalcula');
});

test('cuenta atrás: nada durante la preinfusión ni sin objetivo', () => {
  const cd = new StopCountdown({targetYield: 3});
  for (const s of steady(1.8, 4.9)) assert.strictEqual(cd.push(s), null);
  assert.strictEqual(new StopCountdown({targetYield: null}).push({t: 10, weight: 50}), null);
});

test('cuenta atrás: si al armarse ya falta poco arranca con menos tiempos; pasado el corte, STOP directo', () => {
  const {r} = runCd(steady(1.8), {targetYield: 4, offset: 0});
  assert.strictEqual(r.startAt, 5);
  assert.ok(r.beats >= 1 && r.beats < 3, `beats ${r.beats}`);
  const late = runCd([{t: 5, weight: 20}, {t: 6, weight: 22}, {t: 7, weight: 24}], {targetYield: 20, offset: 0});
  assert.strictEqual(late.r.beats, 0);
});

test('cuenta atrás: shot real F0 — el STOP llega cerca de cuando la taza alcanza el corte', () => {
  const st = runShot();
  const yld = st.result.yield_g;
  const {cd, r} = runCd(st.samples, {targetYield: yld - 3, offset: 0.7});
  assert.ok(r && r.beats === 3);
  const reach = st.samples.find(s => s.weight >= cd.cue).t;
  assert.ok(Math.abs(r.stopAt - reach) < 0.8, `stop ${r.stopAt.toFixed(2)} vs ${reach.toFixed(2)}`);
});

test('offset aprendido: mediana de (salida − corte) de los 5 últimos shots con cuenta atrás', () => {
  const b = (y, cue) => ({yield_g: y, shot_metrics: {stop_cue_g: cue}});
  assert.strictEqual(stopOffset([]), STOP_OFFSET_G);
  assert.strictEqual(stopOffset([{yield_g: 36, shot_metrics: {main_flow: 1.8}}, {yield_g: 36}]), STOP_OFFSET_G);
  assert.strictEqual(stopOffset([b(36, 35.5), b(36.2, 35.4), b(35.9, 35.6)]), 0.5);
  // solo cuentan los 5 más recientes y se descartan los disparates (> 3 g: no hizo caso)
  assert.strictEqual(stopOffset([b(36, 35), b(40, 35), b(36, 35), b(36, 35), b(36, 35.2), b(36, 35.2), b(9, 1)]), 1);
});
