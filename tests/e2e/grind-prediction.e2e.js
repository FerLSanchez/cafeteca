// E2E de la molienda sugerida por edad de la bolsa (390×844): siembra dos bolsas con
// deriva conocida (−0.1 pasos/día desde apertura) y comprueba la pista del modal de brew
// ("Usar" rellena la molienda), la gráfica de la ficha y la tarjeta de Stats.
//
//   python app.py  (o cualquier servidor en BASE_URL, con BD de prueba vacía)
//   BASE_URL=http://localhost:5323 node tests/e2e/grind-prediction.e2e.js [carpeta-capturas]
const assert = require('node:assert');
const {chromium} = require('playwright');

const BASE = process.env.BASE_URL || 'http://localhost:5323';
const SHOTS = process.argv[2];

const ymd = d => d.toISOString().slice(0, 10);
const daysAgo = n => ymd(new Date(Date.now() - n * 86400000));

(async () => {
  const browser = await chromium.launch({executablePath: process.env.CHROMIUM || undefined});
  const page = await browser.newPage({viewport: {width: 390, height: 844}, hasTouch: true, isMobile: true, serviceWorkers: 'block'});
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const call = (method, url, body) => page.evaluate(async ([method, url, body]) => {
    const r = await fetch(url, {method, headers: {'Content-Type': 'application/json'}, body: body && JSON.stringify(body)});
    return r.json();
  }, [method, url, body]);

  await page.goto(BASE + '/');
  await page.waitForFunction(() => typeof openBrewModal === 'function' && document.querySelector('[data-i18n]')?.textContent);
  const prevStep = (await call('GET', '/api/settings')).grind_step ?? 1;
  await call('PUT', '/api/settings', {grind_step: 0.5});
  await page.reload();
  await page.waitForFunction(() => typeof openBrewModal === 'function' && grindStep === 0.5);

  // grind = α + 4·flow − 0.1·día (± 0.1)
  const seed = async (name, opened, alpha, shots, finished = null) => {
    const c = await call('POST', '/api/coffees', {name, quantity_g: 250, opened_date: daysAgo(opened),
      roast_date: daysAgo(opened + 7), finished_date: finished});
    for (const [i, [day, flow, rating]] of shots.entries()) {
      const grind = +(alpha + 4 * flow - 0.1 * day + (i % 2 ? 0.1 : -0.1)).toFixed(1);
      const time_s = 30, yield_g = +(flow * time_s).toFixed(1);
      await call('POST', `/api/coffees/${c.id}/brews`, {brew_date: daysAgo(opened - day), dose_g: 18, yield_g, time_s, grind, rating});
    }
    return c;
  };
  const stamp = Date.now();
  await seed(`GP viejo ${stamp}`, 40, 5, [[0, 1.5], [4, 2.0], [8, 1.8], [12, 1.6], [16, 2.1], [20, 1.9]], daysAgo(15));
  const bag = await seed(`GP abierto ${stamp}`, 14, 8, [[0, 1.7, 5], [3, 1.9, 3], [7, 1.5], [10, 1.8, 5]]);

  // 1) Modal de brew: sugerida para hoy (día 14) con el flujo de los 5★ (1.75 g/s)
  //    8 + 4·1.75 − 1.4 ≈ 13.6 → paso 0.5 → 13.5
  await page.evaluate(id => openBrewModal(id), bag.id);
  const hint = page.locator('#b-grind-hint');
  await hint.waitFor({state: 'visible'});
  const text = await hint.textContent();
  assert.match(text, /13\.5/, text);
  assert.match(text, /1\.8 g\/s/, text);
  assert.match(text, /−0\.[67]\d/, text);
  if (SHOTS) await page.screenshot({path: `${SHOTS}/grind-brew-modal.png`});
  const use = hint.locator('button');
  assert.match(await use.getAttribute('aria-label'), /13\.5/);
  const box = await use.boundingBox();
  assert.ok(box.height >= 40 && box.width >= 40, 'botón Usar ≥ 40 px');
  await use.tap();
  assert.strictEqual(await page.inputValue('#b-grind'), '13.5');
  assert.ok(await use.isDisabled(), 'tras usarla, ✓ deshabilitado');
  await page.evaluate(() => brewStep('b-grind', 1));
  assert.ok(await use.isEnabled(), 'al moverla, vuelve a ofrecer Usar');
  // Registrar un shot de hace 7 días: la sugerida retrocede ~0.7 pasos (más gruesa)
  await page.fill('#b-date', daysAgo(7));
  await page.dispatchEvent('#b-date', 'change');
  assert.match(await hint.textContent(), /14\.5/);
  await page.evaluate(() => closeModal('modal-brew'));

  // 2) Ficha: sección con gráfica y línea de hoy
  await page.evaluate(async id => { await fetchAndRender(); showDetail(id); }, bag.id);
  const section = page.locator('#detail-grind-section');
  await section.locator('canvas').waitFor();
  const detailText = await section.textContent();
  assert.match(detailText, /pasos\/semana|steps\/week/, detailText);
  assert.match(detailText, /13\.5/, detailText);
  const painted = await section.locator('canvas').evaluate(c => c.width > 0 && c.getContext('2d')
    .getImageData(0, 0, c.width, c.height).data.some((v, i) => i % 4 === 3 && v > 0));
  assert.ok(painted, 'la gráfica se dibuja');
  if (SHOTS) { await section.scrollIntoViewIfNeeded(); await page.screenshot({path: `${SHOTS}/grind-detail.png`}); }
  assert.ok(await section.locator('canvas').getAttribute('aria-label'));
  // Girar / redimensionar: el canvas se vuelve a dibujar a su nuevo ancho
  await page.setViewportSize({width: 820, height: 1180});
  await page.waitForFunction(() => {
    const c = document.querySelector('#detail-grind-section canvas');
    return c.width === Math.round(c.clientWidth * (window.devicePixelRatio || 1));
  });
  if (SHOTS) { await section.scrollIntoViewIfNeeded(); await page.screenshot({path: `${SHOTS}/grind-detail-tablet.png`}); }
  await page.setViewportSize({width: 390, height: 844});
  await page.evaluate(() => closeModal('modal-detail'));

  // 3) Stats: deriva por base, resaltada la mejor
  await page.evaluate(() => showPage('stats'));
  const stats = page.locator('#stats-grind');
  await stats.locator('.stats-grind-row').first().waitFor();
  assert.strictEqual(await stats.locator('.stats-grind-row.best').count(), 1);
  if (SHOTS) { await stats.scrollIntoViewIfNeeded(); await page.screenshot({path: `${SHOTS}/grind-stats.png`}); }

  await call('PUT', '/api/settings', {grind_step: prevStep});
  assert.deepStrictEqual(errors, []);
  await browser.close();
  console.log('grind-prediction e2e OK');
})().catch(e => { console.error(e); process.exit(1); });
