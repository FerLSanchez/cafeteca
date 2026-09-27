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

const {tasteSlope, suggestRatio} = require('../../static/js/grind-model.js');

test('objetivo por cata: ácido baja el flujo, amargo lo sube; la receta manda', () => {
  const r = (flow, taste_balance, rating = null) => ({coffee_id: 3, flow, taste_balance, rating});
  assert.strictEqual(targetFlowFor([r(2.0, -2)], null, 0.25).flow, 1.5);
  assert.strictEqual(targetFlowFor([r(1.2, 1)], null, 0.25).flow, 1.45);
  const mixed = targetFlowFor([r(2.0, -1), r(1.6, 0, 5), r(1.4, 1)], null, 0.25);
  assert.strictEqual(mixed.source, 'taste');
  assert.ok(Math.abs(mixed.flow - (1.75 + 1.6 + 1.65) / 3) < 1e-9);
  // la cata va antes que las estrellas; la receta antes que todo
  assert.strictEqual(targetFlowFor([r(1.8, null, 5), r(2.0, -1)]).source, 'taste');
  assert.strictEqual(targetFlowFor([r(1.8, null, 5)]).source, 'best');
  // la receta es una recomendación: pesa como 2 shots catados
  const blended = targetFlowFor([r(2.0, -1)], 1.9, 0.25);
  assert.strictEqual(blended.source, 'taste_recipe');
  assert.ok(Math.abs(blended.flow - (2 * 1.9 + 1.75) / 3) < 1e-9);
  const many = targetFlowFor([r(2.0, -1), r(2.0, -1), r(2.0, -1), r(2.0, -1), r(2.0, -1), r(2.0, -1)], 1.9, 0.25);
  assert.ok(Math.abs(many.flow - 1.75) < Math.abs(many.flow - 1.9), 'la experiencia desplaza la receta');
  assert.deepStrictEqual(targetFlowFor([r(2.0, null)], 1.7), {flow: 1.7, source: 'recipe'});
});

test('k de la cata: pendiente dentro de cada bolsa, por defecto si no hay datos', () => {
  assert.deepStrictEqual(tasteSlope([]), {k: 0.25, fitted: false, n: 0});
  // equilibrio = −2·(flow − 1.6) → k = 0.5
  const mk = (id, flows) => flows.map(f => ({coffee_id: id, flow: f, taste_balance: -2 * (f - 1.6)}));
  const s = tasteSlope([...mk(1, [1.2, 1.6, 2.0]), ...mk(2, [1.4, 1.8, 2.1])]);
  assert.ok(s.fitted);
  assert.ok(Math.abs(s.k - 0.5) < 1e-9);
  // pendiente al revés (más rápido ⇒ más amargo): no se cree, valor por defecto
  const wrong = [1.2, 1.6, 2.0, 1.3, 1.7, 2.1].map((f, i) => ({coffee_id: i < 3 ? 1 : 2, flow: f, taste_balance: f - 1.6}));
  assert.strictEqual(tasteSlope(wrong).fitted, false);
});

test('ratio aprendido: aguado acorta, pesado alarga, la receta como recomendación', () => {
  const b = (taste_body, dose_g = 17, yield_g = 39) => ({taste_body, dose_g, yield_g});
  const thin = suggestRatio([b(-1), b(-1)], 17);
  assert.strictEqual(thin.ratio, 2.14);
  assert.strictEqual(thin.yield_g, 36.5);
  assert.strictEqual(thin.source, 'taste');
  assert.ok(suggestRatio([b(2)], 17).ratio > 2.29);
  assert.strictEqual(suggestRatio([b(0)], 17).ratio, 2.29);   // en su punto: el que usas
  assert.strictEqual(suggestRatio([b(null)], 17), null);
  assert.strictEqual(suggestRatio([b(-2, 17, 20)], 17).ratio, 1.2);   // tope
  const withRecipe = suggestRatio([b(-1)], 17, 2.0);
  assert.strictEqual(withRecipe.source, 'taste_recipe');
  assert.strictEqual(withRecipe.ratio, +((2 * 2.0 + 39 / 17 - 0.15) / 3).toFixed(2));
});

test('bolsa nueva de la misma familia: parte de la anterior, días con sus fechas', () => {
  const m = fitGrindModel(rows, 'open');
  const bag1 = rows.filter(r => r.coffee_id === 1);
  // bolsa nueva sin shots, abierta hoy: α de la familia, días = 0
  const s = suggestGrind(m, bag1, {date: '2026-10-01', target: 1.8, bag: {opened_date: '2026-10-01'}});
  assert.strictEqual(s.days, 0);
  assert.strictEqual(s.grind, Math.round(5 + 4 * 1.8));
  // sin fecha de apertura en la bolsa nueva no se inventan los días
  assert.strictEqual(suggestGrind(m, bag1, {date: '2026-10-01', target: 1.8, bag: {opened_date: null}}), null);
});
