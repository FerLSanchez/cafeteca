// El rediseño vive en los tokens: sin colores sueltos, sin los nombres ni las fuentes de antes.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '../..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const css = read('static/css/style.css');
const jsFiles = fs.readdirSync(path.join(ROOT, 'static/js')).map(f => 'static/js/' + f);

test('sin colores sueltos fuera de los bloques de tokens', () => {
  // Los tokens terminan donde empiezan las reglas; la cuenta atrás y su destello son la excepción
  const body = css.slice(css.indexOf(':focus-visible'))
    .replace(/\.stop-cd[^{]*\{[^}]*\}/g, '')
    .replace(/@keyframes stop-flash[^\n]*\n/, '');
  const found = body.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g) || [];
  assert.deepStrictEqual(found, []);
});

test('sin fuentes antiguas', () => {
  for (const f of ['static/css/style.css', 'templates/index.html', ...jsFiles]) {
    assert.ok(!/Playfair|Figtree|DM Sans/.test(read(f)), f);
  }
});

test('sin los nombres de token antiguos', () => {
  const OLD = /var\(--(text2?3?|border2?|surface[23]|accent2|accent-dim|accent-glow|green[a-z-]*|red|amber[a-z-]*|r|r-sm|r-lg|r-xl)\)/;
  for (const f of ['static/css/style.css', 'templates/index.html', ...jsFiles]) {
    assert.ok(!OLD.test(read(f)), `${f}: ${(read(f).match(OLD) || [])[0]}`);
  }
});
