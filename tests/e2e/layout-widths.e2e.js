// E2E: ninguna pantalla tiene scroll horizontal en móvil, tablet ni escritorio
// (con el chip de la báscula visible, que es cuando la cabecera va más llena).
//   BASE_URL=http://localhost:5323 node tests/e2e/layout-widths.e2e.js
const assert = require('node:assert');
const {chromium} = require('playwright');

const BASE = process.env.BASE_URL || 'http://localhost:5323';
const WIDTHS = [390, 768, 820, 1024, 1280];

(async () => {
  const browser = await chromium.launch({executablePath: process.env.CHROMIUM || undefined});
  const failures = [], errors = [];
  let seeded = false;
  for (const w of WIDTHS) {
    const page = await browser.newPage({viewport: {width: w, height: 900}, serviceWorkers: 'block'});
    page.on('pageerror', e => errors.push(`${w}px: ${e.message}`));
    await page.goto(BASE + '/');
    await page.waitForFunction(() => typeof fetchAndRender === 'function' && document.querySelector('[data-i18n]')?.textContent);
    if (!seeded) {
      await page.evaluate(async () => {
        const post = async (url, body, method = 'POST') => (await fetch(url, {method,
          headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)})).json();
        const c = await post('/api/coffees', {name: 'LW café con un nombre bastante largo', roaster: 'LW Tostador',
          varieties: ['SL28', 'Pink Bourbon'], processes: ['Lavado'], opened_date: '2026-09-20', quantity_g: 250});
        const pts = Array.from({length: 120}, (_, i) => [i / 4, Math.min(38, i * 0.35)]);
        await post(`/api/coffees/${c.id}/brews`, {dose_g: 18, yield_g: 38, time_s: 28, grind: 15, brew_date: '2026-09-26',
          shot_metrics: {main_flow: 1.5, avg_flow: 1.3, t_ramp_s: 6, peak_flow: 2, t_peak_s: 20, flow_cv: 0.1,
            tail_s: 3, tail_g: 0.5, irregular: false, in_band_pct: 80, overshoot_s: 1, target_flow: 1.5},
          shot_curve: {v: 1, time_ms: 28000, pts}});
      });
      seeded = true;
    }
    await page.evaluate(() => fetchAndRender());
    await page.evaluate(() => { const c = document.getElementById('scale-chip'); c.hidden = false; c.textContent = '⚖️ 100%'; });

    const check = async (label, action) => {
      if (action) await page.evaluate(action);
      await page.waitForTimeout(250);
      const bad = await page.evaluate(() => {
        const out = [];
        if (document.documentElement.scrollWidth > innerWidth) out.push(`página ${document.documentElement.scrollWidth}px`);
        const modal = document.querySelector('.modal-overlay.open .modal');
        if (modal) {
          const m = modal.getBoundingClientRect();
          for (const el of modal.querySelectorAll('*')) {
            const r = el.getBoundingClientRect();
            if (r.width && el.getClientRects().length && r.right > m.right + 1) { out.push(`${el.tagName}.${el.className} se sale del modal`); break; }
          }
        }
        return out;
      });
      bad.forEach(b => failures.push(`[${w}px ${label}] ${b}`));
    };
    await check('lista');
    await check('busqueda-abierta', () => document.getElementById('search-input').focus());   // la búsqueda se ensancha: cabecera al límite
    await page.evaluate(() => document.activeElement.blur());
    await check('compacta', () => toggleCompactView());
    await check('ficha', () => { toggleCompactView(); showDetail(displayedCoffees.find(c => c.name.startsWith('LW')).id); });
    await check('brew', () => { closeModal('modal-detail'); return openBrewModal(displayedCoffees.find(c => c.name.startsWith('LW')).id); });
    await check('formulario', () => { closeModal('modal-brew'); openEditModal(displayedCoffees.find(c => c.name.startsWith('LW'))); });
    await check('ajustes', () => { closeModal('modal-form'); openSettings(); });
    await check('prepas', () => { closeModal('modal-settings'); showPage('brews'); });
    await check('stats', () => showPage('stats'));
    await check('catalogo', () => showPage('catalog'));
    await page.close();
  }
  await browser.close();
  assert.deepStrictEqual(errors, []);
  assert.deepStrictEqual(failures, [], `\n${failures.join('\n')}`);
  console.log(`ok — layout widths (${WIDTHS.join(', ')} px)`);
})().catch(e => { console.error(e.message || e); process.exit(1); });
