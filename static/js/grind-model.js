// ---------------------------------------------------------------------------
// Molienda vs edad de la bolsa (puro, sin DOM). Tests: tests/js/grind-model.test.js
//
// Modelo con efecto fijo por bolsa, ajustado sobre todos los brews con molienda y flujo:
//   grind = α_bolsa + β·flow + γ·días
// γ es la deriva: cuánto hay que mover la molienda por día para mantener el mismo flujo
// (negativo = más fino con el tiempo). β convierte flujo en pasos de molienda.
// Se regresa la molienda (y no el flujo) porque al ajustar la molienda para mantener el
// flujo, molienda y días van casi colineales y β/γ no se separarían; así γ sale directa.
// Las filas vienen de GET /api/grind-data: {coffee_id, brew_date, grind, flow, rating,
// days_roast, days_open}.
// ---------------------------------------------------------------------------
const GRIND_MIN_POINTS = 5;    // puntos en bolsas con ≥2 shots para ajustar el modelo
const GRIND_OFFSET_LAST = 5;   // shots recientes de la bolsa que fijan su α
const GRIND_BASES = ['roast', 'open'];

const daysKey = basis => (basis === 'roast' ? 'days_roast' : 'days_open');
const _mean = xs => xs.reduce((s, x) => s + x, 0) / xs.length;

function daysBetween(from, to) {
  return Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000);
}

// Filas utilizables para una base de días, agrupadas por bolsa (orden de llegada: antiguas primero)
function _groups(rows, basis) {
  const k = daysKey(basis);
  const by = new Map();
  for (const r of rows) {
    if (r[k] == null || r.grind == null || r.flow == null) continue;
    if (!by.has(r.coffee_id)) by.set(r.coffee_id, []);
    by.get(r.coffee_id).push({g: r.grind, f: r.flow, d: r[k]});
  }
  return [...by.values()].filter(g => g.length >= 2);
}

// Ajusta β y γ con las desviaciones respecto a la media de cada bolsa (within).
// Devuelve null si no hay datos suficientes o los días no varían.
function fitGrindModel(rows, basis = 'open') {
  const groups = _groups(rows, basis);
  const pts = [];
  for (const grp of groups) {
    const mg = _mean(grp.map(p => p.g)), mf = _mean(grp.map(p => p.f)), md = _mean(grp.map(p => p.d));
    grp.forEach(p => pts.push({g: p.g - mg, f: p.f - mf, d: p.d - md}));
  }
  const n = pts.length;
  if (n < GRIND_MIN_POINTS) return null;
  let Sff = 0, Sfd = 0, Sdd = 0, Sfg = 0, Sdg = 0;
  for (const p of pts) {
    Sff += p.f * p.f; Sfd += p.f * p.d; Sdd += p.d * p.d; Sfg += p.f * p.g; Sdg += p.d * p.g;
  }
  if (Sdd < 1e-9) return null;
  let beta, gamma, inv_dd;
  const det = Sff * Sdd - Sfd * Sfd;
  if (Sff > 1e-9 && det / (Sff * Sdd) > 0.05) {
    beta  = (Sdd * Sfg - Sfd * Sdg) / det;
    gamma = (Sff * Sdg - Sfd * Sfg) / det;
    inv_dd = Sff / det;
  }
  // Flujo casi constante o β con signo imposible (más rápido ⇒ más fino): solo la deriva
  if (beta === undefined || beta < 0) {
    beta = 0;
    gamma = Sdg / Sdd;
    inv_dd = 1 / Sdd;
  }
  const params = beta ? 2 : 1;
  const sse = pts.reduce((s, p) => s + (p.g - beta * p.f - gamma * p.d) ** 2, 0);
  const dof = Math.max(1, n - groups.length - params);
  const rmse = Math.sqrt(sse / dof);
  return {
    basis, beta, gamma, n, bags: groups.length, rmse,
    gamma_se: rmse * Math.sqrt(inv_dd),
    per_week: gamma * 7,
  };
}

// Elige la base (días desde tueste o desde apertura) que mejor explica la molienda,
// comparando el error sobre los mismos shots (los que tienen ambas fechas).
function bestGrindModel(rows) {
  const both = rows.filter(r => r.days_roast != null && r.days_open != null);
  let best = null;
  for (const basis of GRIND_BASES) {
    const m = fitGrindModel(rows, basis);
    if (!m) continue;
    const cmp = fitGrindModel(both, basis);
    const score = cmp ? cmp.rmse : Infinity;
    if (!best || score < best.score) best = {model: m, score};
  }
  return best?.model ?? null;
}

// --- Cata: equilibrio (−2 ácido … 0 justo … +2 amargo) y cuerpo (−2 aguado … +2 pesado) ---------
// Ácido = infraextraído = el flujo iba rápido → el flujo ideal de ese shot era más lento.
// Cada shot catado estima su flujo ideal: flow + k·equilibrio (k en g/s por punto de la escala).
const TASTE_LAST = 5;          // shots catados recientes de la bolsa que fijan el objetivo
const TASTE_K_DEFAULT = 0.25;  // g/s por punto hasta que haya datos para estimarlo
const TASTE_K_RANGE = [0.1, 0.6];
const TASTE_MIN_POINTS = 6;

// k a partir de los datos: pendiente de equilibrio vs flujo dentro de cada bolsa (k = −1/pendiente)
function tasteSlope(rows) {
  const by = new Map();
  for (const r of rows) {
    if (r.taste_balance == null || r.flow == null) continue;
    if (!by.has(r.coffee_id)) by.set(r.coffee_id, []);
    by.get(r.coffee_id).push(r);
  }
  let Sff = 0, Sfb = 0, n = 0;
  for (const grp of by.values()) {
    if (grp.length < 2) continue;
    const mf = _mean(grp.map(r => r.flow)), mb = _mean(grp.map(r => r.taste_balance));
    for (const r of grp) { Sff += (r.flow - mf) ** 2; Sfb += (r.flow - mf) * (r.taste_balance - mb); n++; }
  }
  if (n < TASTE_MIN_POINTS || Sff < 1e-9 || Sfb >= 0) return {k: TASTE_K_DEFAULT, fitted: false, n};
  const k = Math.min(TASTE_K_RANGE[1], Math.max(TASTE_K_RANGE[0], -Sff / Sfb));
  return {k, fitted: true, n};
}

// Flujo objetivo: el de la receta; si no, el que sugiere la cata de los últimos shots;
// si no, la media de los mejor valorados (≥4★); si no, la de los recientes
function targetFlowFor(coffeeRows, recipeTarget = null, k = TASTE_K_DEFAULT) {
  if (recipeTarget) return {flow: recipeTarget, source: 'recipe'};
  const withFlow = coffeeRows.filter(r => r.flow != null);
  if (!withFlow.length) return null;
  const tasted = withFlow.filter(r => r.taste_balance != null).slice(-TASTE_LAST);
  if (tasted.length) {
    return {flow: _mean(tasted.map(r => r.flow + k * r.taste_balance)), source: 'taste'};
  }
  const top = Math.max(0, ...withFlow.map(r => r.rating || 0));
  if (top >= 4) {
    return {flow: _mean(withFlow.filter(r => r.rating === top).map(r => r.flow)), source: 'best'};
  }
  return {flow: _mean(withFlow.slice(-GRIND_OFFSET_LAST).map(r => r.flow)), source: 'recent'};
}

// Ratio según el cuerpo de los últimos shots (brews más recientes primero, como /api/coffees/:id/brews):
// aguado → ratio más corto, pesado → más largo. null si el cuerpo ya está en su punto.
const RATIO_LAST = 3;
const RATIO_STEP = 0.15;   // puntos de ratio por punto de la escala de cuerpo
const RATIO_RANGE = [1.2, 3.5];
function suggestRatio(brews, dose) {
  const tasted = brews.filter(b => b.taste_body != null && b.dose_g && b.yield_g).slice(0, RATIO_LAST);
  if (!tasted.length || !dose) return null;
  const body = _mean(tasted.map(b => b.taste_body));
  if (Math.abs(body) < 0.5) return null;
  const from = tasted[0].yield_g / tasted[0].dose_g;
  const ratio = +Math.min(RATIO_RANGE[1], Math.max(RATIO_RANGE[0], from + RATIO_STEP * body)).toFixed(2);
  return {ratio, from: +from.toFixed(2), body, yield_g: Math.round(dose * ratio * 2) / 2};
}

// α de la bolsa con sus shots recientes (filas de la bolsa, antiguas primero)
function coffeeOffset(model, coffeeRows) {
  const k = daysKey(model.basis);
  const pts = coffeeRows.filter(r => r[k] != null && r.grind != null && r.flow != null).slice(-GRIND_OFFSET_LAST);
  if (!pts.length) return null;
  return _mean(pts.map(r => r.grind - model.beta * r.flow - model.gamma * r[k]));
}

// Días de la bolsa en una fecha, a partir de su último shot con esa base
function coffeeDaysAt(model, coffeeRows, date) {
  const k = daysKey(model.basis);
  const last = coffeeRows.filter(r => r[k] != null).at(-1);
  return last ? last[k] + daysBetween(last.brew_date, date) : null;
}

// Molienda prevista para la bolsa en `date` con el flujo objetivo, redondeada al paso de molienda
function suggestGrind(model, coffeeRows, {date, target, step = 1}) {
  if (!model || !target) return null;
  const alpha = coffeeOffset(model, coffeeRows);
  const days = coffeeDaysAt(model, coffeeRows, date);
  if (alpha == null || days == null) return null;
  const raw = alpha + model.beta * target + model.gamma * days;
  const grind = Math.max(0, +(Math.round(raw / step) * step).toFixed(2));
  return {grind, raw, days, target};
}

// Línea prevista (molienda vs días) para dibujar: [[días, molienda], …]
function grindLine(model, coffeeRows, target, [d0, d1]) {
  const alpha = coffeeOffset(model, coffeeRows);
  if (alpha == null || !target) return [];
  const at = d => [d, alpha + model.beta * target + model.gamma * d];
  return [at(d0), at(d1)];
}

if (typeof module !== 'undefined') {
  module.exports = {fitGrindModel, bestGrindModel, targetFlowFor, tasteSlope, suggestRatio, coffeeOffset, coffeeDaysAt, suggestGrind,
    grindLine, daysBetween};
}
