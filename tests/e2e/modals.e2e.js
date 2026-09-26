// E2E de accesibilidad de los modales: role=dialog, Esc cierra el de arriba,
// el foco vuelve al botón que lo abrió y Tab no se sale del modal.
//
//   python app.py  (o cualquier servidor en BASE_URL, con BD de prueba)
//   BASE_URL=http://localhost:5323 node tests/e2e/modals.e2e.js
const assert = require('node:assert');
const {chromium} = require('playwright');

const BASE = process.env.BASE_URL || 'http://localhost:5323';

(async () => {
  const browser = await chromium.launch({executablePath: process.env.CHROMIUM || undefined});
  const page = await browser.newPage({viewport: {width: 1024, height: 800}, serviceWorkers: 'block'});
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(BASE + '/');
  await page.waitForFunction(() => typeof openModal === 'function' && document.querySelector('[data-i18n]')?.textContent);
  const isOpen = id => page.$eval('#' + id, el => el.classList.contains('open'));

  // 1) Ajustes con el teclado: semántica, Esc y foco de vuelta al botón
  await page.focus('button[onclick="openSettings()"]');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#modal-settings.open');
  const dialog = await page.$eval('#modal-settings .modal', el => [el.getAttribute('role'), el.getAttribute('aria-modal'),
    document.getElementById(el.getAttribute('aria-labelledby'))?.textContent]);
  assert.deepStrictEqual(dialog.slice(0, 2), ['dialog', 'true']);
  assert.ok(dialog[2], 'aria-labelledby apunta al título');
  // 2) Tab no se sale del modal
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    assert.ok(await page.evaluate(() => document.querySelector('#modal-settings .modal').contains(document.activeElement)),
      `el foco se salió del modal en el Tab ${i + 1}`);
  }
  await page.keyboard.press('Escape');
  assert.strictEqual(await isOpen('modal-settings'), false);
  assert.ok(await page.evaluate(() => document.activeElement?.matches('button[onclick="openSettings()"]')), 'foco devuelto');

  // 3) Modales apilados: Esc cierra solo el de arriba
  const c = await page.evaluate(async () => (await (await fetch('/api/coffees', {method: 'POST',
    headers: {'Content-Type': 'application/json'}, body: JSON.stringify({name: 'Modal ' + Date.now(), quantity_g: 250, opened_date: '2026-09-20'})})).json()));
  await page.evaluate(async id => { await fetchAndRender(); displayedCoffees.some(x => x.id === id) || displayedCoffees.push(await (await fetch('/api/coffees/' + id)).json()); showDetail(id); }, c.id);
  await page.evaluate(() => showConfirm({title: 'x', onConfirm() {}}));
  await page.keyboard.press('Escape');
  assert.strictEqual(await isOpen('modal-confirm'), false);
  assert.strictEqual(await isOpen('modal-detail'), true);

  // 4) Un campo con su propio Esc (editar restante) no cierra la ficha
  await page.evaluate(id => editRemainingInline(id), c.id);
  await page.focus('#remaining-input');
  await page.keyboard.press('Escape');
  assert.strictEqual(await isOpen('modal-detail'), true);
  await page.keyboard.press('Escape');
  assert.strictEqual(await isOpen('modal-detail'), false);

  // 5) Versión nueva del service worker: nunca en la primera visita, y con un modal
  //    abierto espera a que se cierre (no se pierde un shot o un formulario a medias)
  await page.evaluate(() => { window.__marker = 1; onSwUpdated(false); });
  assert.strictEqual(await page.evaluate(() => window.__marker), 1, 'primera visita: sin recarga');
  await page.evaluate(() => { openSettings(); onSwUpdated(true); });
  assert.strictEqual(await page.evaluate(() => window.__marker), 1, 'modal abierto: sin recarga');
  await Promise.all([page.waitForEvent('load'), page.keyboard.press('Escape')]);
  assert.strictEqual(await page.evaluate(() => window.__marker), undefined, 'recarga al cerrar el modal');

  await browser.close();
  assert.deepStrictEqual(errors, []);
  console.log('ok — modals e2e');
})().catch(e => { console.error(e); process.exit(1); });
