// ---------------------------------------------------------------------------
// SVG icon helper — devuelve un <svg> referenciando el sprite del HTML
// ---------------------------------------------------------------------------
function icon(name, extraClass) {
  const cls = extraClass ? ' ' + extraClass : '';
  return `<svg class="ic${cls}" viewBox="0 0 24 24" aria-hidden="true"><use href="#ic-${name}"/></svg>`;
}

// ---------------------------------------------------------------------------
// Formatting utilities
// ---------------------------------------------------------------------------
function stars(rating) {
  const r = parseInt(rating, 10);
  if (!r||r<1||r>5) return `<span style="color:var(--text3);font-size:13px">${t('status.unrated')}</span>`;
  return [1,2,3,4,5].map(i=>`<span class="star ${i<=r?'filled':''}">★</span>`).join('');
}

// Colores de los tokens tal como los ve este canvas: dentro del shot en vivo (.theme-dark)
// son los del tema oscuro aunque el resto de la app esté en claro.
function canvasColors(canvas) {
  const css = getComputedStyle(canvas);
  return name => css.getPropertyValue(name).trim();
}

// Dibuja un canvas ahora y cada vez que cambie de tamaño (girar el móvil, redimensionar) o de
// tema (claro/oscuro del sistema); deja de observar cuando el canvas sale del DOM.
function drawCanvasFitted(canvas, draw) {
  if (typeof ResizeObserver === 'undefined') { draw(); return; }
  let lastW = -1;
  const scheme = window.matchMedia('(prefers-color-scheme: dark)');
  const onScheme = () => { if (canvas.isConnected) draw(); else scheme.removeEventListener('change', onScheme); };
  scheme.addEventListener('change', onScheme);
  const ro = new ResizeObserver(() => {
    if (!canvas.isConnected) { ro.disconnect(); scheme.removeEventListener('change', onScheme); return; }
    if (canvas.clientWidth === lastW) return;
    lastW = canvas.clientWidth;
    draw();
  });
  ro.observe(canvas);
}

// Local calendar date as YYYY-MM-DD (toISOString() is UTC and gives
// yesterday's date shortly after local midnight in UTC+ timezones).
function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function fmtDate(d) {
  if (!d) return null;
  const [y,m,day] = d.split('-'); return `${day}/${m}/${y}`;
}

// Gramos para mostrar: sin decimales si es entero, con el separador del idioma
function fmtGrams(g) {
  return fmtNum(g, Number.isInteger(+g) ? 0 : 1) + ' g';
}

function fmtWeight(g) {
  if (!g) return '0 g';
  return g >= 1000 ? fmtNum(g / 1000, 1) + ' kg' : fmtGrams(g);
}

function fmtPrice(c) {
  if (!c.price_kg||!c.quantity_g) return null;
  const total = fmtNum((c.quantity_g / 1000 * c.price_kg), 2);
  const perCup = fmtNum((c.price_kg * gramsPerShot / 1000), 2);
  return `${fmtNum(c.price_kg, 2)} €/kg · ${total} € · ${t('list.per_cup', {price: perCup})}`;
}

function getStatus(c) {
  if (c.finished_date) return {label:t('status.finished'),cls:'status-done'};
  if (c.opened_date)   return {label:t('status.open'),cls:'status-open'};
  return {label:t('status.unopened'),cls:''};
}

function daysFromRoast(roastDate) {
  if (!roastDate) return null;
  const roast = new Date(roastDate); roast.setHours(0,0,0,0);
  const today = new Date(); today.setHours(0,0,0,0);
  return Math.floor((today - roast) / 86400000);
}
