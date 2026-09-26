// E2E del wake lock de la sesión de báscula (Web Bluetooth y Wake Lock falsos, reloj falso).
//   BASE_URL=http://localhost:5323 node tests/e2e/wake-lock.e2e.js
const assert = require('node:assert');
const {chromium} = require('playwright');

const BASE = process.env.BASE_URL || 'http://localhost:5323';

(async () => {
  const browser = await chromium.launch({executablePath: process.env.CHROMIUM || undefined});
  const page = await browser.newPage({serviceWorkers: 'block'});
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.clock.install();
  await page.addInitScript(() => {
    let listener = null;
    window.__weight = g => {
      const b = [3, 0x0b, 0, 0, 0, 1, 0x2b, (g >> 16) & 255, (g >> 8) & 255, g & 255, 0x2b, 0, 0, 80, 0, 50, 0, 0, 0];
      b.push(b.reduce((x, v) => x ^ v, 0));
      listener?.({target: {value: new DataView(Uint8Array.from(b).buffer)}});
    };
    const device = {name: 'SIM', addEventListener() {}, gatt: {connected: false, async connect() {
      this.connected = true;
      return {getPrimaryService: async () => ({getCharacteristic: async u => u === 0xff11
        ? {addEventListener: (_, f) => { listener = f; }, startNotifications: async () => {}}
        : {writeValue: async () => {}}})};
    }}};
    Object.defineProperty(navigator, 'bluetooth', {value: {requestDevice: async () => device}, configurable: true});
    window.__wake = {requests: 0, active: 0, locks: []};
    Object.defineProperty(navigator, 'wakeLock', {configurable: true, value: {request: async () => {
      const lock = {released: false, release: async () => { if (!lock.released) { lock.released = true; __wake.active--; } }};
      __wake.requests++; __wake.active++; __wake.locks.push(lock);
      return lock;
    }}});
  });
  await page.goto(BASE + '/');
  await page.clock.runFor(1500);
  await page.waitForFunction(() => document.getElementById('scale-lab-status')?.textContent);
  const wake = () => page.evaluate(() => ({requests: __wake.requests, active: __wake.active}));
  const coffee = await page.evaluate(async () => (await (await fetch('/api/coffees', {method: 'POST',
    headers: {'Content-Type': 'application/json'}, body: JSON.stringify({name: 'Wake'})})).json()).id);

  // Modal abierto sin báscula conectada: no hay lock
  await page.evaluate(id => openBrewModal(id), coffee);
  assert.deepStrictEqual(await wake(), {requests: 0, active: 0});

  // Conectar desde ⚖️: se enciende el lock
  await page.click('#modal-brew .btn-scale');
  await page.evaluate(() => __weight(0));
  assert.deepStrictEqual(await wake(), {requests: 1, active: 1});

  // Actividad normal no pide más locks
  await page.evaluate(() => { __weight(1000); __weight(1700); });
  assert.strictEqual((await wake()).requests, 1);

  // Chrome suelta el lock en segundo plano: al volver se pide otro
  await page.evaluate(() => { __wake.locks.at(-1).release(); document.dispatchEvent(new Event('visibilitychange')); });
  await page.clock.runFor(10);
  assert.deepStrictEqual(await wake(), {requests: 2, active: 1});

  // 10 min sin actividad: se suelta; al volver a moverse el peso, se recupera
  await page.clock.runFor(11 * 60 * 1000);
  assert.strictEqual((await wake()).active, 0);
  await page.evaluate(() => __weight(3000));
  await page.clock.runFor(10);
  assert.deepStrictEqual(await wake(), {requests: 3, active: 1});

  // Cerrar el modal suelta el lock
  await page.evaluate(() => closeModal('modal-brew'));
  await page.clock.runFor(10);
  assert.strictEqual((await wake()).active, 0);

  // Página de prueba: lock mientras está abierta
  await page.evaluate(() => openScaleTest());
  await page.clock.runFor(10);
  assert.strictEqual((await wake()).active, 1);
  await page.evaluate(() => closeModal('modal-scale'));
  await page.clock.runFor(10);
  assert.strictEqual((await wake()).active, 0);

  assert.deepStrictEqual(errors, []);
  console.log('ok — wake lock e2e');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
