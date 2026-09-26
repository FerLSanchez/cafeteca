// E2E: la lista recuerda estado, orden y filtros entre visitas, ignora valores que ya
// no existen y funciona aunque localStorage falle (modo privado).
//   BASE_URL=http://localhost:5323 node tests/e2e/list-prefs.e2e.js
const assert = require('node:assert');
const {chromium} = require('playwright');

const BASE = process.env.BASE_URL || 'http://localhost:5323';

(async () => {
  const browser = await chromium.launch({executablePath: process.env.CHROMIUM || undefined});
  const errors = [];
  const ready = p => p.waitForFunction(() => typeof fetchAndRender === 'function' && document.querySelector('.coffee-card, .empty-state'));

  const page = await browser.newPage({viewport: {width: 390, height: 844}, serviceWorkers: 'block'});
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(BASE + '/');
  await ready(page);
  const roaster = `LP Tostador ${Date.now()}`;
  await page.evaluate(async r => {
    await fetch('/api/coffees', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({name: 'LP café', roaster: r, opened_date: '2026-09-20'})});
    await loadOptions();
  }, roaster);

  // Elegir estado, orden y tostador
  await page.click('.fb[onclick*="\'active\'"]');
  await page.selectOption('#sort-select', 'name_asc');
  const rid = await page.evaluate(r => String(allOptions.roasters.find(x => x.name === r).id), roaster);
  await page.evaluate(() => toggleFilterPanel());
  await page.selectOption('#f-filter-roaster', rid);

  // Tras recargar sigue igual
  await page.reload();
  await ready(page);
  assert.strictEqual(await page.getAttribute('.fb.active', 'onclick'), "setStatus('active',this)");
  assert.strictEqual(await page.inputValue('#sort-select'), 'name_asc');
  assert.strictEqual(await page.inputValue('#f-filter-roaster'), rid);
  assert.strictEqual(await page.textContent('#filter-badge'), '1');
  assert.deepStrictEqual(await page.$$eval('.coffee-card .coffee-name', els => els.map(e => e.textContent)), ['LP café']);

  // Un valor guardado que ya no existe se ignora; "Limpiar filtros" también se recuerda
  await page.evaluate(() => localStorage.setItem('listPrefs', JSON.stringify({status: 'nope', sort: 'x', filters: {roaster_id: '999999'}})));
  await page.reload();
  await ready(page);
  assert.strictEqual(await page.getAttribute('.fb.active', 'onclick'), "setStatus('in_use',this)");
  assert.strictEqual(await page.inputValue('#f-filter-roaster'), '');
  await page.evaluate(() => localStorage.removeItem('listPrefs'));
  await page.close();

  // localStorage roto (modo privado estricto): la app arranca igual
  const priv = await browser.newPage({serviceWorkers: 'block'});
  priv.on('pageerror', e => errors.push('privado: ' + e.message));
  await priv.addInitScript(() => {
    const boom = () => { throw new DOMException('denied', 'SecurityError'); };
    Object.defineProperty(window, 'localStorage', {get: boom, configurable: true});
  });
  await priv.goto(BASE + '/');
  await ready(priv);
  await priv.click('.fb[onclick*="\'active\'"]');
  await priv.evaluate(() => toggleCompactView());

  await browser.close();
  assert.deepStrictEqual(errors, []);
  console.log('ok — list prefs e2e');
})().catch(e => { console.error(e); process.exit(1); });
