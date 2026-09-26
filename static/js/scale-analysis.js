// ---------------------------------------------------------------------------
// Bookoo — detectores y análisis de flujo (puros, sin DOM ni BLE).
// Spec: docs/features/bookoo-scale.md §5.1, §5.2, §5.4. Tests: tests/js/.
// Las muestras son {t, weight, ms?} con t en segundos (reloj de llegada).
// ---------------------------------------------------------------------------
const DOSE_STABLE_S   = 1.0;   // tiempo quieto para considerar estable
const DOSE_STABLE_TOL = 0.1;   // ±g
const DOSE_MIN_G      = 1;
const DOSE_MAX_G      = 200;   // por encima: mano/golpe, se ignora
const DOSE_LIFT_G     = 0.5;   // por debajo: recipiente levantado
const DOSE_LIFT_N     = 2;     // lecturas seguidas bajo DOSE_LIFT_G

// Sigue el peso en vivo y congela el último valor estable al levantar el recipiente.
class DoseTracker {
  constructor() { this.reset(); }
  reset() {
    this.win = [];          // ventana de muestras para estabilidad
    this.stable = null;     // último valor estable (g, 1 decimal)
    this.live = null;
    this.frozen = null;     // dosis final congelada
    this._low = 0;
  }
  push({t, weight}) {
    if (this.frozen !== null) return this.frozen;
    this.live = weight;
    if (weight > DOSE_MAX_G) { this.win = []; this._low = 0; return null; }
    if (weight < DOSE_LIFT_G) {
      if (++this._low >= DOSE_LIFT_N && this.stable !== null) this.frozen = this.stable;
      this.win = [];
      return this.frozen;
    }
    this._low = 0;
    this.win.push({t, weight});
    while (this.win.length && t - this.win[0].t > DOSE_STABLE_S) this.win.shift();
    const ws = this.win.map(s => s.weight);
    const span = t - this.win[0].t;
    if (span >= DOSE_STABLE_S * 0.9 && Math.max(...ws) - Math.min(...ws) <= DOSE_STABLE_TOL * 2 && weight >= DOSE_MIN_G) {
      this.stable = Math.round(weight * 10) / 10;
    }
    return null;
  }
  // ✓ manual: usa el estable si lo hay, si no el valor en vivo
  freeze() {
    if (this.frozen === null) {
      const v = this.stable ?? (this.live >= DOSE_MIN_G && this.live <= DOSE_MAX_G ? this.live : null);
      this.frozen = v === null ? null : Math.round(v * 10) / 10;
    }
    return this.frozen;
  }
}

// Shot en modo auto: arranca cuando el timer pasa de 0 a >0 y termina cuando
// vuelve a 0 (hallazgo F0 §8.1). Respaldo: timer congelado > SHOT_FREEZE_S.
const SHOT_FREEZE_S = 3;

class ShotTracker {
  constructor() { this.reset(); }
  reset() {
    this.state = 'waiting';   // waiting → running → done
    this.samples = [];        // {t (s desde el inicio del timer), weight}
    this.result = null;
    this._t0 = null;
    this._lastMs = null;
    this._lastMsAt = null;
  }
  push({t, ms, weight}) {
    if (this.state === 'done') return this.state;
    if (this.state === 'waiting') {
      if (ms > 0) {
        this.state = 'running';
        this._t0 = t - ms / 1000;   // el timer de la báscula viene retrofechado
      } else return this.state;
    }
    if (ms === 0 || (this._lastMs === ms && t - this._lastMsAt > SHOT_FREEZE_S)) {
      this._finish();
      return this.state;
    }
    if (ms !== this._lastMs) { this._lastMs = ms; this._lastMsAt = t; }
    this.samples.push({t: t - this._t0, ms, weight});
    return this.state;
  }
  _finish() {
    const last = this.samples[this.samples.length - 1];
    this.state = 'done';
    if (!last) return;
    this.result = {
      yield_g: Math.round(last.weight * 10) / 10,
      time_s: Math.round(last.ms / 1000),
      time_ms: last.ms,
    };
  }
}

// Flujo propio: pendiente (regresión lineal) del peso en una ventana de FLOW_WINDOW_S.
const FLOW_WINDOW_S = 1.0;

function flowSeries(samples) {
  const out = [];
  let j = 0;
  for (let i = 0; i < samples.length; i++) {
    while (samples[i].t - samples[j].t > FLOW_WINDOW_S) j++;
    const n = i - j + 1;
    if (n < 3) { out.push({t: samples[i].t, flow: null, weight: samples[i].weight}); continue; }
    let mx = 0, my = 0;
    for (let k = j; k <= i; k++) { mx += samples[k].t; my += samples[k].weight; }
    mx /= n; my /= n;
    let num = 0, den = 0;
    for (let k = j; k <= i; k++) {
      num += (samples[k].t - mx) * (samples[k].weight - my);
      den += (samples[k].t - mx) ** 2;
    }
    out.push({t: samples[i].t, flow: den ? num / den : null, weight: samples[i].weight});
  }
  return out;
}

const RAMP_FRAC      = 0.9;   // fin de rampa: flujo ≥ 90 % de la referencia…
const RAMP_HOLD_S    = 1.0;   // …sostenido este tiempo
const TAIL_FRAC      = 0.5;   // cola: flujo < 50 % de la referencia hasta el final
const IRREG_WIN_S    = 3.0;   // mediana local para detectar picos/caídas
const IRREG_FRAC     = 0.25;  // desviación relativa que cuenta como irregular
const IRREG_HOLD_S   = 0.3;

const r2 = v => Math.round(v * 100) / 100;
const r1 = v => Math.round(v * 10) / 10;

function median(a) {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Métricas §5.4 a partir de las muestras del shot. target/tol en g/s (target opcional).
function analyzeShot(samples, {target = null, tol = 0.2, time_ms = null, yield_g = null} = {}) {
  if (!samples || samples.length < 5) return null;
  const series = flowSeries(samples).filter(p => p.flow !== null);
  if (series.length < 3) return null;
  const last = samples[samples.length - 1];
  const total = time_ms !== null ? time_ms / 1000 : last.t;
  const yld = yield_g ?? last.weight;
  const weightAt = t => {
    let best = samples[0];
    for (const s of samples) { if (s.t <= t) best = s; else break; }
    return best.weight;
  };

  let peak = series[0];
  for (const p of series) if (p.flow > peak.flow) peak = p;
  // Referencia: el objetivo si se alcanza; si no, la mediana del flujo "útil" (≥ 50 % del pico)
  const ref = target && peak.flow >= RAMP_FRAC * target
    ? target
    : median(series.filter(p => p.flow >= 0.5 * peak.flow).map(p => p.flow));

  // Fin de rampa: primer instante desde el que el flujo se mantiene ≥ RAMP_FRAC·ref RAMP_HOLD_S
  let rampEnd = null, since = null;
  for (const p of series) {
    if (p.flow >= RAMP_FRAC * ref) {
      if (since === null) since = p.t;
      if (p.t - since >= RAMP_HOLD_S) { rampEnd = since; break; }
    } else since = null;
  }
  if (rampEnd === null) rampEnd = peak.t;

  // Fin de la fase principal: último instante con flujo ≥ TAIL_FRAC·ref
  let mainEnd = rampEnd;
  for (const p of series) if (p.t >= rampEnd && p.flow >= TAIL_FRAC * ref) mainEnd = p.t;

  const main = series.filter(p => p.t >= rampEnd && p.t <= mainEnd);
  const mainDur = mainEnd - rampEnd;
  const mainFlow = mainDur > 0 ? (weightAt(mainEnd) - weightAt(rampEnd)) / mainDur : null;

  let cv = null;
  if (main.length >= 3) {
    const m = main.reduce((a, p) => a + p.flow, 0) / main.length;
    const sd = Math.sqrt(main.reduce((a, p) => a + (p.flow - m) ** 2, 0) / main.length);
    cv = m > 0 ? sd / m : null;
  }

  // Tiempo por encima de la banda y % dentro de ella (solo con objetivo)
  let overshoot = null, inBand = null;
  if (target) {
    let over = 0, band = 0, dur = 0;
    for (let i = 1; i < main.length; i++) {
      const dt = main[i].t - main[i - 1].t;
      dur += dt;
      if (main[i].flow > target + tol) over += dt;
      if (Math.abs(main[i].flow - target) <= tol) band += dt;
    }
    overshoot = r1(over);
    inBand = dur > 0 ? Math.round(band / dur * 100) : null;
  }

  // Irregular: desviación sostenida > IRREG_FRAC respecto a la mediana local
  // (se excluyen los bordes de la fase principal: la subida y la caída final son normales)
  let irregular = false, dev = null;
  const core = main.filter(p => p.t - rampEnd >= IRREG_WIN_S / 2 && mainEnd - p.t >= IRREG_WIN_S / 2);
  for (const p of core) {
    const local = main.filter(q => Math.abs(q.t - p.t) <= IRREG_WIN_S / 2).map(q => q.flow);
    const med = median(local);
    if (med > 0 && Math.abs(p.flow - med) / med > IRREG_FRAC) {
      if (dev === null) dev = p.t;
      if (p.t - dev >= IRREG_HOLD_S) { irregular = true; break; }
    } else dev = null;
  }

  return {
    main_flow: mainFlow === null ? null : r2(mainFlow),
    avg_flow: total > 0 ? r2(yld / total) : null,
    peak_flow: r2(peak.flow),
    t_peak_s: r1(peak.t),
    t_ramp_s: r1(rampEnd),
    overshoot_s: overshoot,
    in_band_pct: inBand,
    flow_cv: cv === null ? null : r2(cv),
    tail_s: r1(Math.max(0, total - mainEnd)),
    tail_g: r1(Math.max(0, yld - weightAt(mainEnd))),
    irregular,
    target_flow: target,
  };
}

if (typeof module !== 'undefined') {
  module.exports = {DoseTracker, ShotTracker, flowSeries, analyzeShot};
}
