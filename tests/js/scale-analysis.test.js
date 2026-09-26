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
