// Modelo molienda vs edad de la bolsa: node --test tests/js/*.test.js
const test = require('node:test');
const assert = require('node:assert');
const {fitGrindModel, bestGrindModel, targetFlowFor, suggestGrind, grindLine, daysBetween} =
  require('../../static/js/grind-model.js');

// Datos sintéticos: grind = α_bolsa + 4·flow − 0.1·días_abierta (+ ruido determinista)
function bag(coffee_id, alpha, opened, shots, {roastLag = 10, noise = 0} = {}) {
  return shots.map(([day, flow, rating], i) => ({
    coffee_id, rating: rating ?? null, flow,
    brew_date: new Date(Date.parse(opened) + day * 86400000).toISOString().slice(0, 10),
    days_open: day, days_roast: day + roastLag,
    grind: +(alpha + 4 * flow - 0.1 * day + (i % 2 ? noise : -noise)).toFixed(2),
  }));
}
const rows = [
  ...bag(1, 5, '2026-08-01', [[0, 1.5], [3, 2.0], [6, 1.8], [10, 1.6], [14, 2.1]]),
  ...bag(2, 8, '2026-09-01', [[1, 1.7, 5], [4, 1.9, 3], [8, 1.5], [12, 1.8, 5]]),
];

test('ajuste: recupera β y γ con efecto fijo por bolsa', () => {
  const m = fitGrindModel(rows, 'open');
  assert.strictEqual(m.bags, 2);
  assert.strictEqual(m.n, 9);
  assert.ok(Math.abs(m.beta - 4) < 1e-6);
  assert.ok(Math.abs(m.gamma + 0.1) < 1e-6);
  assert.ok(Math.abs(m.per_week + 0.7) < 1e-6);
  assert.ok(m.rmse < 1e-6);
});

test('ajuste: sin datos suficientes o bolsas de un solo shot → null', () => {
  assert.strictEqual(fitGrindModel(rows.slice(0, 3), 'open'), null);
  const singles = rows.map((r, i) => ({...r, coffee_id: 100 + i}));
  assert.strictEqual(fitGrindModel(singles, 'open'), null);
});

test('ajuste: flujo constante (se corrige la molienda para mantenerlo) → solo deriva', () => {
  const flat = bag(3, 10, '2026-09-01', [[0, 1.8], [2, 1.8], [5, 1.8], [9, 1.8], [12, 1.8]]);
  const m = fitGrindModel(flat, 'open');
  assert.strictEqual(m.beta, 0);
  assert.ok(Math.abs(m.gamma + 0.1) < 1e-6);
});

test('base: elige la que mejor explica (apertura aquí; tueste con desfase distinto por bolsa no)', () => {
  const mixed = [
    ...bag(1, 5, '2026-08-01', [[0, 1.5], [3, 2.0], [6, 1.8], [10, 1.6], [14, 2.1]], {roastLag: 3}),
    ...bag(2, 8, '2026-09-01', [[1, 1.7], [4, 1.9], [8, 1.5], [12, 1.8]], {roastLag: 20}),
  ].map((r, i) => ({...r, days_roast: r.days_roast + (i % 3)}));   // tueste con ruido
  assert.strictEqual(bestGrindModel(mixed).basis, 'open');
});

test('objetivo: receta > mejor valorados (≥4★) > recientes', () => {
  const b2 = rows.filter(r => r.coffee_id === 2);
  assert.deepStrictEqual(targetFlowFor(b2, 2.2), {flow: 2.2, source: 'recipe'});
  const best = targetFlowFor(b2);
  assert.strictEqual(best.source, 'best');
  assert.ok(Math.abs(best.flow - 1.75) < 1e-9);
  assert.strictEqual(targetFlowFor(rows.filter(r => r.coffee_id === 1)).source, 'recent');
  assert.strictEqual(targetFlowFor([]), null);
});

test('sugerencia: extrapola los días hasta la fecha y redondea al paso', () => {
  const m = fitGrindModel(rows, 'open');
  const b2 = rows.filter(r => r.coffee_id === 2);
  // Último shot día 12 (2026-09-13); el 2026-09-18 son 17 días → 8 + 4·1.8 − 1.7 = 13.5
  const s = suggestGrind(m, b2, {date: '2026-09-18', target: 1.8, step: 0.5});
  assert.strictEqual(s.days, 17);
  assert.ok(Math.abs(s.raw - 13.5) < 1e-6);
  assert.strictEqual(s.grind, 13.5);
  assert.strictEqual(suggestGrind(m, b2, {date: '2026-09-18', target: 1.8, step: 1}).grind, 14);
  assert.strictEqual(suggestGrind(m, [], {date: '2026-09-18', target: 1.8}), null);
  assert.strictEqual(suggestGrind(null, b2, {date: '2026-09-18', target: 1.8}), null);
});

test('línea prevista y días entre fechas', () => {
  const m = fitGrindModel(rows, 'open');
  const line = grindLine(m, rows.filter(r => r.coffee_id === 2), 1.8, [0, 10]);
  assert.ok(Math.abs(line[0][1] - 15.2) < 1e-6 && Math.abs(line[1][1] - 14.2) < 1e-6);
  assert.strictEqual(daysBetween('2026-03-28', '2026-03-30'), 2);   // cruza el cambio de hora
});
