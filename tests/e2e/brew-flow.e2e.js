// E2E del flujo de preparación sin báscula, en móvil (390×844, táctil):
// entrada manual por pasos, valorar después, empezar desde la tarjeta o desde
// Prepas, y "Deshacer" de consumir / terminar bolsa.
//
//   python app.py  (o cualquier servidor en BASE_URL, con BD de prueba)
//   BASE_URL=http://localhost:5323 node tests/e2e/brew-flow.e2e.js
const assert = require('node:assert');
const {chromium} = require('playwright');

const BASE = process.env.BASE_URL || 'http://localhost:5323';

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
  const stamp = Date.now();
  const coffee = await call('POST', '/api/coffees', {name: `BF ${stamp}`, quantity_g: 250, opened_date: '2026-09-20'});
  const other = await call('POST', '/api/coffees', {name: `BF otro ${stamp}`, quantity_g: 250, opened_date: '2026-09-21'});
  const brewsOf = id => call('GET', `/api/coffees/${id}/brews`);

  // 1) Desde la tarjeta: "🫖 Preparar" abre el modal con el nombre del café
  await page.evaluate(() => fetchAndRender());
  await page.tap(`#actions-${coffee.id} .btn-quick.brew`);
  await page.waitForSelector('#modal-brew.open');
  assert.strictEqual(await page.textContent('#b-coffee-name'), coffee.name);

  // 2) Entrada manual por pasos, con los −/+ y sin valorar
  await page.fill('#b-dose', '18');
  await page.fill('#b-grind', '12');
  await page.tap('#b-step-dial .stepper-btn:last-child');
  assert.strictEqual(await page.inputValue('#b-grind'), '13');
  await page.fill('#b-yield', '36');
  await page.fill('#b-time', '30');
  assert.match(await page.textContent('#b-ratio-display'), /1:2\.00/);
  assert.ok(await page.$('#b-step-shot.done'), 'paso 3 marcado');
  assert.match(await page.textContent('#b-submit'), /valorar después|rate later/);
  await page.tap('#modal-brew .brew-star[data-val="4"]');
  assert.ok(!/valorar después|rate later/.test(await page.textContent('#b-submit')));
  await page.tap('#modal-brew .brew-star[data-val="4"]');   // tocar la marcada la quita
  assert.match(await page.textContent('#b-submit'), /valorar después|rate later/);
  await page.mouse.click(5, 5);                             // tocar fuera no cierra
  assert.ok(await page.$('#modal-brew.open'));
  await page.tap('#b-submit');
  await page.waitForSelector('#modal-brew:not(.open)', {state: 'attached'});
  let brews = await brewsOf(coffee.id);
  assert.strictEqual(brews.length, 1);
  assert.strictEqual(brews[0].rating, null);
  assert.strictEqual(brews[0].grind, 13);

  // 3) Valorar después desde Prepas
  await page.evaluate(() => showPage('brews'));
  const quick = `.brew-card:has(.brew-coffee-tag:text-is("${coffee.name}")) .quick-star`;
  await page.waitForSelector(quick);
  await page.tap(`${quick} >> nth=4`);
  await page.waitForTimeout(600);
  assert.strictEqual((await brewsOf(coffee.id))[0].rating, 5);

  // 3b) Solo piden valoración los brews sin valorar de los últimos días
  assert.deepStrictEqual(await page.evaluate(() => [
    canQuickRate({brew_date: todayLocal()}), canQuickRate({brew_date: '2026-01-10'}),
    canQuickRate({brew_date: todayLocal(), rating: 3}),
  ]), [true, false, false]);

  // 4) Siguiente preparación: sin receta parte del último brew
  await page.evaluate(id => openBrewModal(id), coffee.id);
  await page.waitForSelector('#modal-brew.open');
  assert.strictEqual(await page.inputValue('#b-grind'), '13');
  assert.ok(await page.$('#b-last:not([hidden])'));
  await page.evaluate(() => closeModal('modal-brew'));

  // 5) "Nueva preparación" en Prepas con varias bolsas abiertas → selector
  await page.tap('.btn-new-brew');
  await page.waitForSelector('#modal-pick-coffee.open');
  await page.tap(`.pick-coffee:has-text("${other.name}")`);
  await page.waitForSelector('#modal-brew.open');
  assert.strictEqual(await page.textContent('#b-coffee-name'), other.name);
  await page.evaluate(() => closeModal('modal-brew'));

  // 6) Deshacer consumir (vista compacta) y deshacer terminar bolsa
  await page.evaluate(() => { showPage('list'); if (!compactList) toggleCompactView(); });
  const card = `.coffee-card-compact:has(.coffee-name:text-is("${coffee.name}"))`;
  const before = (await call('GET', `/api/coffees/${coffee.id}`)).remaining_g;   // 232: el brew manual descontó 18 g
  await page.tap(`${card} .btn-cc.consume`);
  await page.waitForSelector('.toast.show .toast-action');
  assert.strictEqual((await brewsOf(coffee.id)).length, 2);
  await page.tap('.toast-action');
  await page.waitForTimeout(600);
  assert.strictEqual((await call('GET', `/api/coffees/${coffee.id}`)).remaining_g, before);
  assert.strictEqual((await brewsOf(coffee.id)).length, 1, 'el brew del consumo se borra');
  await page.tap(`${card} .btn-cc.finish`);
  await page.waitForSelector('.toast.show .toast-action');
  await page.tap('.toast-action');
  await page.waitForTimeout(600);
  assert.strictEqual((await call('GET', `/api/coffees/${coffee.id}`)).finished_date, null);
  assert.ok(await page.$(`${card} .btn-cc.consume`), 'la bolsa vuelve a estar abierta');
  await page.evaluate(() => toggleCompactView());

  await browser.close();
  assert.deepStrictEqual(errors, []);
  console.log('ok — brew flow e2e');
})().catch(e => { console.error(e); process.exit(1); });
