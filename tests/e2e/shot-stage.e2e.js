// E2E del shot en vivo a pantalla completa: legible desde la encimera, oscuro en cualquier tema,
// guardar en un toque, y nada de lo que pase al guardar o al cambiar de tema pierde el shot.
//   BASE_URL=http://localhost:5399 node tests/e2e/shot-stage.e2e.js
const assert = require('node:assert');
const {chromium} = require('playwright');

const BASE = process.env.BASE_URL || 'http://localhost:5399';

const fakeScale = () => {
  const device = {name: 'BOOKOO_SC SIM', addEventListener() {}, gatt: {connected: false, async connect() {
    this.connected = true;
    return {getPrimaryService: async () => ({getCharacteristic: async uuid => (uuid === 0xff11
      ? {addEventListener() {}, startNotifications: async () => {}} : {writeValue: async () => {}})})};
  }}};
  Object.defineProperty(navigator, 'bluetooth', {value: {requestDevice: async () => device}, configurable: true});
};
const api = (page, method, url, body) => page.evaluate(async ([method, url, body]) => {
  const r = await fetch(url, {method, headers: {'Content-Type': 'application/json'}, body: body ? JSON.stringify(body) : undefined});
  return r.json();
}, [method, url, body]);

// Lecturas de báscula directas al bus: t en s, g acumulados
const feed = (page, pts) => page.evaluate(pts => {
  const real = performance.now.bind(performance);
  for (const [t, weight] of pts) {
    performance.now = () => t * 1000;   // el shot se marca con este reloj
    scale.bus.dispatchEvent(new CustomEvent('scale:weight', {detail: {t, ms: Math.round(t * 1000), weight, flow: 0, battery: 80}}));
  }
  performance.now = real;
}, pts);
const ramp = (from, to, flow, w0 = 0) => {
  const out = [];
  for (let t = from; t <= to; t += 0.25) out.push([+t.toFixed(2), +(w0 + (t - from) * flow).toFixed(2)]);
  return out;
};
const end = (page, t, weight) => page.evaluate(([t, weight]) => {
  const real = performance.now.bind(performance);
  performance.now = () => t * 1000;
  scale.bus.dispatchEvent(new CustomEvent('scale:weight', {detail: {t, ms: 0, weight, flow: 0, battery: 80}}));
  performance.now = real;
}, [t, weight]);

(async () => {
  const browser = await chromium.launch({executablePath: process.env.CHROMIUM || undefined});
  const open = async (opts = {}) => {
    const ctx = await browser.newContext({viewport: {width: 390, height: 844}, hasTouch: true, serviceWorkers: 'block', colorScheme: 'light', ...opts});
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(fakeScale);
    await page.goto(BASE + '/');
    await page.waitForFunction(() => typeof scale !== 'undefined' && document.getElementById('page-title')?.textContent);
    const coffee = await api(page, 'POST', '/api/coffees', {name: 'Stage ' + Math.random(), opened_date: '2026-10-01', quantity_g: 250, remaining_g: 200});
    await api(page, 'PUT', `/api/coffees/${coffee.id}/recipe`, {dose_g: 17, yield_g: 37, target_flow: 1.6});
    await page.evaluate(id => openBrewModal(id), coffee.id);
    await page.waitForSelector('#modal-brew.open .btn-shot');
    await page.click('#modal-brew .btn-shot');
    await page.waitForSelector('#b-shot-live.shot-stage');
    return {ctx, page, coffee, errors};
  };
  const brewsOf = async (page, id) => api(page, 'GET', `/api/coffees/${id}/brews`);
  const finishShot = async page => {
    await feed(page, ramp(0.25, 12, 1.5));
    await end(page, 12.25, 18);
    await page.waitForSelector('#b-shot-live .shot-summary:not([hidden])');
  };

  // Cubre la pantalla y es oscuro con el tema claro
  {
    const {ctx, page, errors} = await open();
    const box = await page.locator('#b-shot-live').boundingBox();
    assert.deepStrictEqual([box.x, box.y, box.width, box.height], [0, 0, 390, 844], 'cubre la pantalla');
    assert.strictEqual(await page.$eval('#b-shot-live', el => getComputedStyle(el).backgroundColor), 'rgb(18, 18, 17)');
    assert.strictEqual(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(246, 245, 242)', 'el resto sigue claro');

    // El peso manda: alrededor de 104 px y lo más grande
    const size = await page.$eval('[data-k=weight]', el => parseFloat(getComputedStyle(el).fontSize));
    assert.ok(size >= 96 && size <= 112, `peso a ${size} px`);

    // El estado del flujo lleva palabra: lento, en banda, rápido (objetivo 1.6 ± 0.2)
    await feed(page, ramp(0.25, 3, 0.8));
    assert.strictEqual(await page.textContent('[data-k=flow-state]'), 'Lento');
    await feed(page, ramp(3.25, 8, 1.6, 2.2));
    assert.strictEqual(await page.textContent('[data-k=flow-state]'), 'En banda');
    await feed(page, ramp(8.25, 13, 2.6, 9.8));
    assert.strictEqual(await page.textContent('[data-k=flow-state]'), 'Rápido');

    // Cambiar de tema a media extracción no toca el shot
    const blank = () => page.$eval('#b-shot-live .shot-chart', c => {
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      return d.every(v => v === 0);
    });
    assert.strictEqual(await blank(), false, 'hay curva');
    const before = await page.$eval('#b-shot-live .shot-chart', c => c.toDataURL());
    await page.emulateMedia({colorScheme: 'dark'});
    await page.waitForTimeout(100);
    assert.strictEqual(await page.$eval('#b-shot-live', el => getComputedStyle(el).backgroundColor), 'rgb(18, 18, 17)');
    assert.strictEqual(await page.$eval('#b-shot-live .shot-chart', c => c.toDataURL()), before, 'la curva no cambia');
    await page.emulateMedia({colorScheme: 'light'});

    // Peso de tres cifras sin desbordar a 360 px
    await page.setViewportSize({width: 360, height: 780});
    await page.evaluate(() => { document.querySelector('[data-k=weight]').textContent = fmtNum(123.4, 1); });
    assert.ok(await page.$eval('#b-shot-live', el => el.scrollWidth <= el.clientWidth), '123,4 cabe a 360 px');
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  }

  // Guardar en un toque, y un doble toque crea un solo brew
  {
    const {ctx, page, coffee} = await open();
    await finishShot(page);
    assert.strictEqual(await page.textContent('.shot-save'), await page.textContent('#b-submit'));
    await page.dblclick('.shot-save');
    await page.waitForSelector('#modal-brew:not(.open)', {state: 'attached'});
    await page.waitForTimeout(300);
    const brews = await brewsOf(page, coffee.id);
    assert.strictEqual(brews.length, 1, 'un solo brew');
    assert.ok(brews[0].shot_metrics, 'con métricas');
    assert.strictEqual(brews[0].rating, null);
    assert.ok(await page.locator('.toast.show').isVisible(), 'con su aviso');
    assert.strictEqual(await page.locator('.shot-stage').count(), 0, 'el shot se cierra');

    // Aviso en Prepas hasta tener estrellas y equilibrio
    await page.waitForFunction(() => !document.getElementById('nav-count-brews').hidden);
    assert.strictEqual(await page.textContent('#nav-count-brews'), '1');
    await page.evaluate(() => showPage('brews'));
    assert.match(await page.textContent('#page-summary'), /1 shot por valorar/);
    const brewId = brews[0].id;
    await page.click(`.brew-card:has(.quick-star) .quick-star >> nth=4`);
    await page.waitForSelector('.taste-scale[data-field="taste_balance"]');
    assert.strictEqual(await page.textContent('#nav-count-brews'), '1', 'con estrellas sin equilibrio sigue pendiente');
    await page.click('.taste-scale[data-field="taste_balance"] .taste-seg[data-val="1"]');
    await page.waitForFunction(() => document.getElementById('nav-count-brews').hidden);
    assert.strictEqual((await api(page, 'GET', `/api/brews/pending?since=2000-01-01`)).count, 0, `brew ${brewId} valorado`);
    // Un brew manual no avisa
    await api(page, 'POST', `/api/coffees/${coffee.id}/brews`, {dose_g: 17, yield_g: 36, brew_date: new Date().toISOString().slice(0, 10)});
    await page.evaluate(() => refreshPendingCount());
    assert.ok(await page.$eval('#nav-count-brews', el => el.hidden));
    await ctx.close();
  }

  // Si guardar falla, el shot sigue ahí
  {
    const {ctx, page, coffee} = await open();
    await finishShot(page);
    const yld = await page.inputValue('#b-yield');
    await page.route('**/api/coffees/*/brews', r => (r.request().method() === 'POST' ? r.abort() : r.continue()));
    await page.click('.shot-save');
    await page.waitForTimeout(300);
    assert.ok(await page.locator('#b-shot-live.shot-stage').isVisible(), 'sigue abierto');
    assert.strictEqual(await page.inputValue('#b-yield'), yld);
    await page.unroute('**/api/coffees/*/brews');
    await page.click('.shot-save');   // y se puede reintentar
    await page.waitForSelector('#modal-brew:not(.open)', {state: 'attached'});
    assert.strictEqual((await brewsOf(page, coffee.id)).length, 1);
    await ctx.close();
  }

  // Sin resultado no se ofrece guardar
  {
    const {ctx, page} = await open();
    await page.evaluate(() => { ShotTracker.prototype._finish = function () { this.state = 'done'; }; });
    await feed(page, ramp(0.25, 2, 1));
    await end(page, 2.25, 2);
    await page.waitForFunction(() => document.querySelectorAll('.shot-actions button').length === 2);
    assert.strictEqual(await page.locator('.shot-save').count(), 0);
    assert.ok(await page.locator('.shot-back').isVisible());
    await ctx.close();
  }

  // Volver al modal: resumen visible y guardar pasa a ser la acción principal
  {
    const {ctx, page} = await open();
    assert.strictEqual(await page.getAttribute('#b-submit', 'class'), 'btn-secondary');
    await finishShot(page);
    await page.click('.shot-back');
    assert.strictEqual(await page.locator('.shot-stage').count(), 0);
    assert.ok(await page.locator('#b-shot-summary').isVisible());
    assert.strictEqual(await page.getAttribute('#b-submit', 'class'), 'btn-primary');
    await ctx.close();
  }

  // Móvil apaisado sobre la encimera: peso, flujo y cancelar a la vista
  {
    const {ctx, page} = await open({viewport: {width: 844, height: 390}});
    for (const sel of ['[data-k=weight]', '[data-k=flow]', '.shot-actions button']) {
      const b = await page.locator(`#b-shot-live ${sel}`).first().boundingBox();
      assert.ok(b && b.y >= 0 && b.y + b.height <= 390 && b.x + b.width <= 844, `${sel} visible: ${JSON.stringify(b)}`);
    }
    await ctx.close();
  }

  // Cuenta atrás: sube por el acento y el STOP es el único rojo
  {
    const {ctx, page} = await open();
    await page.evaluate(() => {
      const run = {timers: [], el: null, stopAtG: null};
      stopCountdownRun(run, 3, 30, () => 30);
    });
    const bg = n => page.waitForSelector(`.stop-cd[data-n="${n}"]`).then(() => page.$eval('.stop-cd', el => getComputedStyle(el).backgroundColor));
    const b3 = await bg(3), b2 = await bg(2), b1 = await bg(1), b0 = await bg(0);
    assert.strictEqual(b0, 'rgb(198, 40, 40)');
    assert.ok(new Set([b3, b2, b1, b0]).size === 4, `cuatro colores: ${b3} ${b2} ${b1} ${b0}`);
    assert.strictEqual(b1, 'rgb(238, 154, 99)', 'el 1 es el acento');
    await ctx.close();
  }

  // Página de prueba: se puede salir del shot, sin botón de guardar
  {
    const ctx = await browser.newContext({viewport: {width: 390, height: 844}, serviceWorkers: 'block'});
    const page = await ctx.newPage();
    await page.addInitScript(fakeScale);
    await page.goto(BASE + '/');
    await page.waitForFunction(() => typeof scale !== 'undefined' && document.getElementById('page-title')?.textContent);
    await page.evaluate(() => openScaleTest());
    await page.click('#modal-scale .st-tab[data-tab=auto]');
    assert.strictEqual(await page.locator('.shot-stage').count(), 0, 'el formulario sigue a la vista hasta que arranca');
    await feed(page, ramp(0.25, 2, 1));
    await page.waitForSelector('#st-shot-view.shot-stage');
    assert.strictEqual(await page.locator('.shot-save').count(), 0);
    await page.click('#st-shot-view .shot-actions button');
    assert.strictEqual(await page.locator('.shot-stage').count(), 0, 'sale de la pantalla completa');
    await ctx.close();
  }

  await browser.close();
  console.log('ok — shot stage');
})().catch(e => { console.error(e.message || e); process.exit(1); });
