// E2E del flujo de báscula con Playwright: un Web Bluetooth falso reproduce la
// captura real (tests/js/fixtures/f0-real-2026-09-26.json) a velocidad real.
//
//   python app.py  (o cualquier servidor en BASE_URL, con BD de prueba)
//   BASE_URL=http://localhost:5323 node tests/e2e/scale-flow.e2e.js [captura.png]
//
// Requiere el paquete `playwright` (no está en CI: tarda ~50 s y necesita Chromium).
const assert = require('node:assert');
const path = require('node:path');
const {chromium} = require('playwright');

const BASE = process.env.BASE_URL || 'http://localhost:5323';
const fixture = require(path.join(__dirname, '../js/fixtures/f0-real-2026-09-26.json'));

async function apiCall(page, method, url, body) {
  return page.evaluate(async ([method, url, body]) => {
    const r = await fetch(url, {method, headers: {'Content-Type': 'application/json'}, body: body && JSON.stringify(body)});
    return r.json();
  }, [method, url, body]);
}

(async () => {
  const browser = await chromium.launch({executablePath: process.env.CHROMIUM || undefined});
  // Sin service worker: al instalarse recarga la página (SW_UPDATED) y cerraría los modales
  const page = await browser.newPage({viewport: {width: 390, height: 844}, serviceWorkers: 'block'});
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.addInitScript(frames => {
    let listener = null;
    const toDV = hex => new DataView(Uint8Array.from(hex.split(' ').map(h => parseInt(h, 16))).buffer);
    // Reproduce las tramas [from, to] (segundos de la captura) respetando sus tiempos.
    window.__replay = (from, to) => new Promise(resolve => {
      const sel = frames.filter(f => f.t / 1000 >= from && f.t / 1000 <= to);
      const t0 = sel[0].t;
      sel.forEach((f, i) => setTimeout(() => {
        listener?.({target: {value: toDV(f.hex)}});
        if (i === sel.length - 1) resolve(sel.length);
      }, f.t - t0));
    });
    window.__emit = hex => listener?.({target: {value: toDV(hex)}});
    const device = {
      name: 'BOOKOO_SC SIM',
      addEventListener() {},
      gatt: {
        connected: false,
        async connect() {
          this.connected = true;
          return {getPrimaryService: async () => ({
            getCharacteristic: async uuid => uuid === 0xff11
              ? {addEventListener: (_, fn) => { listener = fn; }, startNotifications: async () => {}}
              : {writeValue: async () => {}},
          })};
        },
      },
    };
    Object.defineProperty(navigator, 'bluetooth', {value: {requestDevice: async () => device}, configurable: true});
  }, fixture.frames);

  await page.goto(BASE + '/');
  await page.waitForFunction(() => document.getElementById('scale-lab-status')?.textContent);  // i18n + scaleLabInit listos

  const coffee = await apiCall(page, 'POST', '/api/coffees', {name: 'E2E Bookoo'});
  await apiCall(page, 'PUT', `/api/coffees/${coffee.id}/recipe`, {dose_g: 18, yield_g: 38, target_flow: 1.5});
  await page.evaluate(id => openBrewModal(id), coffee.id);
  await page.waitForSelector('#modal-brew.open', {state: 'attached'});

  // 1) Dosis: "Pesar" conecta; ajuste final hasta 17.0 y levantar el recipiente
  await page.click('#modal-brew .btn-scale');
  await page.waitForSelector('#b-dose-scale:not([hidden])');
  await page.evaluate(() => window.__replay(15.5, 22.7));
  const zero = '03 0b 00 00 00 01 2b 00 00 00 2b 00 00 32 00 32 00 00 00 09';
  await page.evaluate(z => { window.__emit(z); window.__emit(z); }, zero);
  assert.strictEqual(await page.inputValue('#b-dose'), '17.0');
  assert.match(await page.textContent('#b-dose-scale .scale-dose-msg'), /17\.0/);
  assert.ok(await page.$('#b-dose-scale.locked'), 'panel en estado fijado');
  assert.ok(await page.$('#b-step-dose.done'), 'paso 1 marcado');
  assert.match(await page.textContent('#scale-chip'), /50%/);

  // 2) Shot en modo auto (inline en el paso 3): taza (auto-tara), shot y reset del timer
  await page.click('#modal-brew .btn-shot');
  await page.waitForSelector('#b-shot-live:not([hidden])');
  await page.evaluate(() => window.__replay(96, 132));
  await page.waitForSelector('#b-shot-live .shot-summary:not([hidden])');
  const summary = await page.textContent('#b-shot-live .shot-summary');
  assert.match(summary, /1\.7\d g\/s/, 'flujo principal ≈ 1.73');
  assert.match(summary, /1\.38 g\/s/, 'media de la báscula');
  if (process.argv[2]) await page.screenshot({path: process.argv[2]});
  // El resultado se aplica solo al terminar
  assert.strictEqual(await page.inputValue('#b-yield'), '38.5');
  assert.strictEqual(await page.inputValue('#b-time'), '28');
  // Un solo "flujo" en pantalla: el principal del shot, no la media salida/tiempo
  assert.match(await page.textContent('#b-ratio-display'), /1\.7\d g\/s/);
  assert.doesNotMatch(await page.textContent('#b-ratio-display'), /1\.38/);

  // 3) Guardar con valoración: el brew lleva métricas y curva
  await page.click('#modal-brew .brew-star[data-val="5"]');
  await page.click('#b-submit');
  await page.waitForSelector('#modal-brew:not(.open)', {state: 'attached'});
  const brews = await apiCall(page, 'GET', `/api/coffees/${coffee.id}/brews`);
  const m = brews[0].shot_metrics;
  assert.ok(m.main_flow > 1.65 && m.main_flow < 1.8, JSON.stringify(m));
  assert.strictEqual(m.target_flow, 1.5);
  assert.strictEqual(brews[0].dose_g, 17);
  assert.ok(brews[0].shot_curve.pts.length > 200, 'curva completa guardada');
  assert.strictEqual(brews[0].shot_curve.time_ms, 27800);

  // 4) Siguiente shot: con la báscula conectada la dosis empieza sola, y la curva
  //    del mejor valorado aparece como fantasma
  await page.evaluate(id => openBrewModal(id), coffee.id);
  await page.waitForSelector('#b-dose-scale:not([hidden]):not(.locked)');
  await page.click('#modal-brew .btn-shot');
  await page.waitForSelector('#b-shot-live .shot-legend', {state: 'attached'});
  await page.evaluate(() => closeModal('modal-brew'));
  assert.ok(await page.$('#b-shot-live[hidden]'), 'la vista en vivo se cierra con el modal');

  assert.deepStrictEqual(errors, []);
  console.log('ok — scale flow e2e', JSON.stringify(m));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
