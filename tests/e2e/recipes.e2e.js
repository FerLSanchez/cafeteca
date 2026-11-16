// E2E de varias recetas por café (espresso y largo con el mismo grano), en móvil (390×844):
// la ficha las lista y crea/edita con nombre; al preparar se elige la receta y cada una
// rellena con lo suyo (un largo 1:4.7 no se queda en 1:3.5 ni lo arrastra un espresso catado).
//
//   python tests/e2e/serve.py   (BD de prueba en el 5399)
//   BASE_URL=http://localhost:5399 node tests/e2e/recipes.e2e.js
const assert = require('node:assert');
const {chromium} = require('playwright');

const BASE = process.env.BASE_URL || 'http://localhost:5399';

(async () => {
  const browser = await chromium.launch({executablePath: process.env.CHROMIUM || undefined});
  const page = await browser.newPage({viewport: {width: 390, height: 844}, hasTouch: true, isMobile: true, serviceWorkers: 'block'});
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const call = (method, url, body) => page.evaluate(async ([method, url, body]) => {
    const r = await fetch(url, {method, headers: {'Content-Type': 'application/json'}, body: body && JSON.stringify(body)});
    return r.json();
  }, [method, url, body]);
  const val = id => page.inputValue('#' + id);
  const closed = id => page.waitForSelector(`#${id}.open`, {state: 'detached'});

  await page.goto(BASE + '/');
  await page.waitForFunction(() => typeof openBrewModal === 'function' && document.querySelector('[data-i18n]')?.textContent);
  const coffee = await call('POST', '/api/coffees', {name: `RC ${Date.now()}`, quantity_g: 250, opened_date: '2026-09-20'});
  const cid = coffee.id;
  // Un espresso catado (1:2.15) y la receta del largo
  await call('POST', `/api/coffees/${cid}/brews`, {dose_g: 17, yield_g: 36.5, time_s: 28, grind: 13, rating: 4,
    taste_balance: 0, taste_body: 0, brew_date: '2026-09-26'});
  await call('POST', `/api/coffees/${cid}/recipes`, {dose_g: 17, yield_g: 80, grind: 14, target_flow: 1.8});

  // 1) Una receta: sin selector; el espresso catado no cuenta para el largo → 80 g
  await page.evaluate(id => openBrewModal(id), cid);
  await page.waitForSelector('#modal-brew.open');
  assert.ok(await page.isHidden('#b-recipe-pick'));
  assert.strictEqual(await val('b-yield'), '80');
  await page.evaluate(() => closeModal('modal-brew'));

  // 2) Ficha: nombrar el largo y añadir el espresso
  await page.evaluate(c => showDetail(c.id, c), coffee);
  await page.waitForSelector('#detail-recipe-section .recipe-item');
  await page.click('#detail-recipe-section .recipe-item .btn-inline-edit');
  await page.waitForSelector('#modal-recipe.open');
  assert.strictEqual(await val('r-yield'), '80');
  await page.fill('#r-name', 'Largo');
  await page.click('#modal-recipe .btn-primary');
  await closed('modal-recipe');
  await page.click('#detail-recipe-section .btn-add-recipe');
  await page.waitForSelector('#modal-recipe.open');
  assert.strictEqual(await val('r-name'), '');
  await page.fill('#r-name', 'Espresso');
  await page.fill('#r-dose', '17');
  await page.fill('#r-yield', '36.5');
  await page.click('#modal-recipe .btn-primary');
  await page.waitForFunction(() => document.querySelectorAll('#detail-recipe-section .recipe-item').length === 2);
  assert.deepStrictEqual(await page.$$eval('#detail-recipe-section .recipe-label', ls => ls.map(l => l.textContent)),
    ['Largo', 'Espresso']);
  await page.evaluate(() => closeModal('modal-detail'));

  // 3) Preparar: empieza en la receta del último brew (el espresso, por ratio) y se cambia con ← →
  await page.evaluate(id => openBrewModal(id), cid);
  await page.waitForSelector('#modal-brew.open');
  const picked = () => page.$$eval('#b-recipe-pick .recipe-pick', bs => bs.map(b => b.textContent + (b.getAttribute('aria-checked') === 'true' ? '*' : '')));
  assert.deepStrictEqual(await picked(), ['Largo', 'Espresso*']);
  assert.strictEqual(await val('b-yield'), '36.5');
  assert.match(await page.textContent('#b-last'), /36,5 g/);
  await page.focus('#b-recipe-pick [aria-checked="true"]');
  await page.keyboard.press('ArrowLeft');
  assert.deepStrictEqual(await picked(), ['Largo*', 'Espresso']);
  assert.strictEqual(await val('b-yield'), '80');
  assert.strictEqual(await val('b-grind'), '14');
  assert.ok(await page.isHidden('#b-last'), 'sin shots del largo no hay "Último"');
  await page.fill('#b-time', '40');
  await page.evaluate(() => submitBrew());
  await closed('modal-brew');
  const [brew] = await call('GET', `/api/coffees/${cid}/brews`);
  const {recipes, current_id} = await call('GET', `/api/coffees/${cid}/recipes`);
  const largo = recipes.find(r => r.name === 'Largo');
  assert.strictEqual(brew.recipe_id, largo.id);
  assert.strictEqual(current_id, largo.id);

  // 4) Borrar una receta desde la ficha
  await page.evaluate(c => showDetail(c.id, c), coffee);
  await page.waitForFunction(() => document.querySelectorAll('#detail-recipe-section .recipe-item').length === 2);
  await page.click('#detail-recipe-section .recipe-item:nth-child(2) .btn-inline-edit:nth-of-type(2)');
  await page.click('#confirm-action-btn');
  await page.waitForFunction(() => document.querySelectorAll('#detail-recipe-section .recipe-item').length === 1);

  assert.deepStrictEqual(errors, []);
  await browser.close();
  console.log('ok — recipes e2e');
})().catch(e => { console.error(e); process.exit(1); });
