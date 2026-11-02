// E2E de la lista de cafés: filas en vez de tarjetas, sin desbordes con valores largos, sin perder
// información y con grupos solo en el orden Recomendado.
//   BASE_URL=http://localhost:5399 node tests/e2e/list-rows.e2e.js
const assert = require('node:assert');
const {chromium} = require('playwright');

const BASE = process.env.BASE_URL || 'http://localhost:5399';
const LONG = 'Café con un nombre de cuarenta caracteres';

(async () => {
  const browser = await chromium.launch({executablePath: process.env.CHROMIUM || undefined});
  let seeded = false;
  for (const w of [390, 820, 1280]) {
    const page = await browser.newPage({viewport: {width: w, height: 900}, serviceWorkers: 'block'});
    await page.goto(BASE + '/');
    await page.waitForFunction(() => typeof fetchAndRender === 'function' && document.querySelector('#page-title')?.textContent);
    if (!seeded) {
      await page.evaluate(async long => {
        const post = async (url, body) => (await fetch(url, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)})).json();
        await post('/api/coffees', {name: long, roaster: 'Tostador con un nombre también largo', origin: 'Etiopía', region: 'Yirgacheffe',
          varieties: ['Kurume', 'Wolisho'], processes: ['Lavado'], milk_types: ['Avena'], opened_date: '2026-10-01', roast_date: '2026-09-01',
          quantity_g: 1000, remaining_g: 1000, price_kg: 44.48});
        await post('/api/coffees', {name: 'Magnetron', roaster: 'Astro', origin: 'Brasil', quantity_g: 250, price_kg: 35.2});
      }, LONG);
      seeded = true;
    }
    await page.evaluate(() => { setStatus('', document.querySelector('.fb[onclick*="setStatus(\'\'"]')); });
    await page.waitForSelector('.coffee-row');
    assert.strictEqual(await page.locator('.coffee-row').count(), 2);
    await page.waitForFunction(() => /abierto/.test(document.getElementById('page-summary').textContent));
    assert.match(await page.textContent('#page-summary'), /1 abierto.*1000 g.*1 sin abrir/);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `sin scroll horizontal a ${w}`);
    const overflow = await page.$$eval('.coffee-row *', els => els.filter(el => {
      const r = el.getBoundingClientRect(), row = el.closest('.coffee-row').getBoundingClientRect();
      return r.width && r.right > row.right + 1;
    }).map(el => el.className));
    assert.deepStrictEqual(overflow, [], `nada se sale de la fila a ${w}`);
    const row = await page.locator('.coffee-row', {hasText: LONG}).innerText();
    for (const text of ['€/kg', 'taza', 'Avena', 'Kurume', 'Lavado', 'Etiopía', 'tomas', 'Consumir toma', 'Preparar']) {
      assert.ok(row.includes(text), `falta "${text}" en la fila a ${w}: ${row}`);
    }
    assert.ok(await page.locator('.coffee-row', {hasText: LONG}).locator('[aria-label]', {has: page.locator('svg')}).first().isVisible());
    const boxes = await page.locator('.coffee-row', {hasText: LONG}).locator('.card-actions button').evaluateAll(els => els.map(e => e.getBoundingClientRect().top));
    assert.ok(boxes.length === 3 && boxes.every(y => y === boxes[0]), `acciones en una línea a ${w}: ${boxes}`);
    assert.deepStrictEqual(await page.$$eval('.list-group-head', els => els.map(e => e.textContent)), ['Abiertos', 'Sin abrir']);
    await page.selectOption('#sort-select', 'name_asc');
    assert.strictEqual(await page.locator('.list-group-head').count(), 0, 'sin grupos con otro orden');
    await page.selectOption('#sort-select', 'smart');
    await page.close();
  }
  // Lista plana larga: con "Mostrar más" debajo, cada fila sigue diciendo su estado
  {
    const page = await browser.newPage({viewport: {width: 390, height: 900}, serviceWorkers: 'block'});
    await page.goto(BASE + '/');
    await page.waitForFunction(() => typeof fetchAndRender === 'function' && document.querySelector('#page-title')?.textContent);
    await page.evaluate(async () => {
      for (let i = 0; i < 18; i++) await fetch('/api/coffees', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({name: 'Lote ' + i})});
    });
    await page.evaluate(() => { setStatus('', document.querySelector('.fb[onclick*="setStatus(\'\'"]')); });
    await page.waitForSelector('.btn-load-more');
    await page.selectOption('#sort-select', 'name_asc');
    assert.ok(await page.locator('.coffee-row .row-status').first().isVisible(), 'estado visible en lista plana con "Mostrar más"');
    await page.close();
  }
  await browser.close();
  console.log('ok — list rows');
})().catch(e => { console.error(e.message || e); process.exit(1); });
