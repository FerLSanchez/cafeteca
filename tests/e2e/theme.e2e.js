// E2E del selector de tema en Ajustes: dispositivo, claro u oscuro; se recuerda en cada dispositivo.
//   BASE_URL=http://localhost:5399 node tests/e2e/theme.e2e.js
const assert = require('node:assert');
const {chromium} = require('playwright');

const BASE = process.env.BASE_URL || 'http://localhost:5399';
const LIGHT = 'rgb(246, 245, 242)', DARK = 'rgb(18, 18, 17)';

(async () => {
  const browser = await chromium.launch({executablePath: process.env.CHROMIUM || undefined});
  const open = async (colorScheme, init) => {
    const ctx = await browser.newContext({viewport: {width: 1280, height: 800}, serviceWorkers: 'block', colorScheme});
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    if (init) await page.addInitScript(init);
    await page.goto(BASE + '/');
    await page.waitForFunction(() => document.getElementById('page-title')?.textContent);
    return {ctx, page, errors};
  };
  const bg = page => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const choose = async (page, value) => {
    await page.evaluate(() => openSettings());
    await page.selectOption('#theme-select', value);
    await page.evaluate(() => closeModal('modal-settings'));
    await page.waitForTimeout(50);
  };
  const metas = page => page.$$eval('meta[name=theme-color]', ms => ms.map(m => m.content));
  const markShown = page => page.$$eval('.app-nav-brand img', imgs => imgs.filter(i => i.getClientRects().length).map(i => i.getAttribute('src')));

  // Por defecto, el dispositivo
  {
    const {ctx, page, errors} = await open('dark');
    assert.strictEqual(await bg(page), DARK);
    await page.evaluate(() => openSettings());
    assert.strictEqual(await page.inputValue('#theme-select'), 'system');
    await page.evaluate(() => closeModal('modal-settings'));

    // Claro gana al dispositivo oscuro, sin recargar, y se recuerda
    await choose(page, 'light');
    assert.strictEqual(await bg(page), LIGHT);
    assert.deepStrictEqual(await metas(page), ['#f6f5f2', '#f6f5f2']);
    assert.deepStrictEqual(await markShown(page), ['/static/mark.svg']);
    await page.reload();
    await page.waitForFunction(() => document.getElementById('page-title')?.textContent);
    assert.strictEqual(await bg(page), LIGHT, 'recordado al recargar');
    await page.evaluate(() => openSettings());
    assert.strictEqual(await page.inputValue('#theme-select'), 'light');
    await page.evaluate(() => closeModal('modal-settings'));

    // Volver al dispositivo
    await choose(page, 'system');
    assert.strictEqual(await bg(page), DARK);
    assert.deepStrictEqual(await metas(page), ['#f6f5f2', '#121211']);
    assert.deepStrictEqual(await markShown(page), ['/static/mark-dark.svg']);
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  }

  // Oscuro gana al dispositivo claro; las gráficas se redibujan y el shot sigue oscuro
  {
    const {ctx, page} = await open('light');
    assert.strictEqual(await bg(page), LIGHT);
    await page.evaluate(async () => {
      const post = async (u, b) => (await fetch(u, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(b)})).json();
      const c = await post('/api/coffees', {name: 'Tema', opened_date: '2026-10-01', quantity_g: 250, remaining_g: 200});
      for (const main_flow of [1.4, 1.5, 1.6, 1.7]) {
        await post(`/api/coffees/${c.id}/brews`, {dose_g: 17, yield_g: 36, time_s: 28, grind: 11, rating: 4, shot_metrics: {main_flow, avg_flow: 1.3, t_ramp_s: 6, peak_flow: 2, t_peak_s: 20, flow_cv: 0.1, tail_s: 3, tail_g: 0.5, irregular: false}});
      }
      await fetchAndRender();
      await showDetail(c.id);
    });
    await page.waitForSelector('#modal-detail canvas.dialin-chart');
    await page.waitForTimeout(200);
    const curve = () => page.$eval('#modal-detail canvas.dialin-chart', c => c.toDataURL());
    const before = await curve();
    await page.evaluate(() => changeTheme('dark'));
    await page.waitForTimeout(100);
    assert.strictEqual(await bg(page), DARK);
    assert.notStrictEqual(await curve(), before, 'la gráfica sigue al selector');
    await ctx.close();
  }

  // Con localStorage bloqueado arranca igual y sigue al dispositivo
  {
    const {ctx, page, errors} = await open('dark', () => {
      Object.defineProperty(window, 'localStorage', {get() { throw new Error('bloqueado'); }});
    });
    assert.strictEqual(await bg(page), DARK);
    await page.evaluate(() => changeTheme('light'));
    assert.strictEqual(await bg(page), LIGHT, 'aplica aunque no se pueda recordar');
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  }

  await browser.close();
  console.log('ok — theme');
})().catch(e => { console.error(e.message || e); process.exit(1); });
