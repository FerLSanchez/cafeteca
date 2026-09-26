// E2E de objetivos táctiles: recorre todas las páginas y modales a 390×844 (móvil,
// táctil) y falla si algún control visible mide menos de MIN_PX en su lado corto o
// está a menos de GAP_PX de otro control pequeño (el fallo de "Tara" / "✓").
//
//   python app.py  (o cualquier servidor en BASE_URL, con BD de prueba)
//   BASE_URL=http://localhost:5323 node tests/e2e/touch-targets.e2e.js [carpeta-capturas]
const assert = require('node:assert');
const path = require('node:path');
const {chromium} = require('playwright');

const BASE = process.env.BASE_URL || 'http://localhost:5323';
const SHOTS = process.argv[2] || null;
const MIN_PX = 36;   // lado corto mínimo de cualquier control
const GAP_PX = 8;    // separación mínima entre controles si alguno es < 40 px
// Grupos de estrellas: los botones van pegados a propósito (cada uno ≥ 36 px)
const GROUPED = '.quick-star, .brew-star, .rating-star';

async function measure(page) {
  return page.evaluate(([MIN_PX, GAP_PX, GROUPED]) => {
    const sel = 'button, a[href], input:not([type=hidden]), select, textarea, [onclick], summary';
    const hit = el => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || r.bottom <= 0 || r.top >= innerHeight) return false;
      const x = Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2));
      const y = Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2));
      return document.elementFromPoint(x, y)?.closest(sel) === el;   // visible y no tapado
    };
    // Contenedores con onclick (tarjetas, cabeceras) no cuentan si tienen controles dentro
    const els = [...document.querySelectorAll(sel)].filter(el => !(el.matches('[onclick]:not(button)') && el.querySelector(sel)))
      .filter(hit);
    const name = el => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${[...el.classList].join('.')} "${
      (el.getAttribute('aria-label') || el.textContent || el.placeholder || '').trim().slice(0, 20)}"`;
    // Barras fijas (nav): el contenido pasa por debajo al hacer scroll, no cuentan como "pegados"
    const fixed = el => { for (; el; el = el.parentElement) if (getComputedStyle(el).position === 'fixed' && !el.classList.contains('modal-overlay')) return true; return false; };
    const small = [], close = [], overflow = [];
    // Controles que se salen de la pantalla por los lados (scroll horizontal en móvil)
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      if (r.width && r.height && r.bottom > 0 && r.top < innerHeight && el.checkVisibility?.()
          && (r.right > innerWidth + 1 || r.left < -1) && !el.closest('.filter-status')) {   // las pills hacen scroll a propósito
        overflow.push(`${Math.round(r.left)}→${Math.round(r.right)} ${name(el)}`);
      }
    }
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (Math.min(r.width, r.height) < MIN_PX) small.push(`${Math.round(r.width)}×${Math.round(r.height)} ${name(el)}`);
    }
    for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) {
      const [a, b] = [els[i], els[j]];
      if (a.contains(b) || b.contains(a) || (a.matches(GROUPED) && b.matches(GROUPED))) continue;
      if (fixed(a) !== fixed(b)) continue;
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      const gap = Math.max(Math.max(ra.left, rb.left) - Math.min(ra.right, rb.right),
                           Math.max(ra.top, rb.top) - Math.min(ra.bottom, rb.bottom), 0);
      const tiny = Math.min(ra.width, ra.height, rb.width, rb.height) < 40;
      // Controles apilados en la misma columna a ≥ 4 px (campos de formulario) están bien
      if (gap < GAP_PX && tiny && !(gap >= 4 && (ra.bottom <= rb.top || rb.bottom <= ra.top))) {
        close.push(`${name(a)} ↔ ${Math.round(gap)} px ↔ ${name(b)}`);
      }
    }
    return {small, close, overflow};
  }, [MIN_PX, GAP_PX, GROUPED]);
}

(async () => {
  const browser = await chromium.launch({executablePath: process.env.CHROMIUM || undefined});
  const page = await browser.newPage({viewport: {width: 390, height: 844}, hasTouch: true, isMobile: true, serviceWorkers: 'block'});
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(BASE + '/');
  await page.waitForFunction(() => typeof fetchAndRender === 'function' && document.querySelector('[data-i18n]')?.textContent);

  const ids = await page.evaluate(async () => {
    const post = async (url, body, method = 'POST') => (await fetch(url, {method,
      headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)})).json();
    const open = await post('/api/coffees', {name: 'TT Abierto', roaster: 'TT Tostador', origin: 'Kenia',
      varieties: ['SL28'], processes: ['Lavado'], roast_date: '2026-09-01', opened_date: '2026-09-10', quantity_g: 250, rating: 4});
    const unopened = await post('/api/coffees', {name: 'TT Sin abrir', quantity_g: 250});
    await post(`/api/coffees/${open.id}/recipe`, {dose_g: 18, yield_g: 38, grind: 15, temp_c: 93}, 'PUT');
    await post(`/api/coffees/${open.id}/brews`, {dose_g: 18, yield_g: 37, time_s: 28, grind: 15, brew_date: '2026-09-26'});
    await post(`/api/coffees/${open.id}/brews`, {dose_g: 18, yield_g: 38, time_s: 28, grind: 14, rating: 4, brew_date: '2026-09-26'});
    return {open: open.id, unopened: unopened.id};
  });
  await page.evaluate(() => fetchAndRender());

  const failures = [];
  let n = 0;
  const check = async (label, action) => {
    if (action) await page.evaluate(action, ids);
    await page.waitForTimeout(300);
    n++;
    if (SHOTS) await page.screenshot({path: path.join(SHOTS, `tt-${String(n).padStart(2, '0')}-${label}.png`)});
    const {small, close, overflow} = await measure(page);
    overflow.forEach(o => failures.push(`[${label}] fuera de pantalla: ${o}`));
    small.forEach(s => failures.push(`[${label}] pequeño: ${s}`));
    close.forEach(c => failures.push(`[${label}] pegados: ${c}`));
  };

  await check('lista');
  await check('filtros', () => toggleFilterPanel());
  await check('compacta', () => { toggleFilterPanel(); toggleCompactView(); });
  await check('ficha', ids => { toggleCompactView(); showDetail(ids.open); });
  await check('ficha-abajo', () => document.getElementById('modal-detail').scrollTo(0, 5000));
  await check('restante', ids => editRemainingInline(ids.open));
  await check('ficha-sin-abrir', ids => { closeModal('modal-detail'); showDetail(ids.unopened); });
  await check('brew', ids => { closeModal('modal-detail'); return openBrewModal(ids.open); });
  await check('brew-abajo', () => document.getElementById('modal-brew').scrollTo(0, 5000));
  await check('receta', ids => { closeModal('modal-brew'); return openRecipeModal(ids.open); });
  await check('formulario', () => { closeModal('modal-recipe'); openAddModal(); });
  await check('formulario-abajo', () => document.getElementById('modal-form').scrollTo(0, 5000));
  await check('formulario-editar', ids => {
    closeModal('modal-form'); openEditModal(displayedCoffees.find(c => c.id === ids.open));
    document.getElementById('f-variety-input').scrollIntoView({block: 'center'});   // chips con su ✕
  });
  await check('ajustes', () => { closeModal('modal-form'); openSettings(); });
  await check('ajustes-abajo', () => document.getElementById('modal-settings').scrollTo(0, 5000));
  await check('prepas', () => { closeModal('modal-settings'); showPage('brews'); });
  await check('elegir-cafe', () => newBrewFromBrews());
  await check('stats', () => { closeModal('modal-pick-coffee'); showPage('stats'); });
  await check('catalogo', () => { showPage('catalog'); document.querySelector('.catalog-header')?.click(); });
  await check('confirmar', () => { showPage('list'); showConfirm({title: 'TT', onConfirm() {}}); });

  await browser.close();
  assert.deepStrictEqual(errors, []);
  assert.deepStrictEqual(failures, [], `\n${failures.join('\n')}`);
  console.log(`ok — touch targets (${n} pantallas)`);
})().catch(e => { console.error(e.message || e); process.exit(1); });
