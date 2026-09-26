// Claves de traducción: es.json y en.json tienen las mismas, y toda clave usada en el
// código existe (t('…') en JS, data-i18n* en el HTML, error_key en el backend).
//   node --test tests/js/*.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '../..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const langs = fs.readdirSync(path.join(ROOT, 'static/i18n')).filter(f => f.endsWith('.json'));
const dict = Object.fromEntries(langs.map(f => [f, JSON.parse(read('static/i18n/' + f))]));
const es = dict['es.json'];
const KEY = /^[a-z0-9_]+(\.[a-z0-9_]+)+$/;

function usedKeys() {
  const keys = new Map();   // clave → dónde
  const add = (k, where) => { if (KEY.test(k) && !keys.has(k)) keys.set(k, where); };
  for (const f of fs.readdirSync(path.join(ROOT, 'static/js'))) {
    const src = read('static/js/' + f);
    // t('clave') y también t(cond ? 'a' : 'b'): todos los literales con forma de clave dentro de t(…)
    for (const m of src.matchAll(/\bt\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g)) {
      for (const lit of m[1].matchAll(/['"]([a-z0-9_.]+)['"]/g)) add(lit[1], f);
    }
    for (const m of src.matchAll(/error_key['"]?\s*[:=]\s*['"]([a-z0-9_.]+)['"]/g)) add(m[1], f);
  }
  const html = read('templates/index.html');
  for (const m of html.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)) add(m[1], 'index.html');
  const py = ['models.py', ...fs.readdirSync(path.join(ROOT, 'blueprints')).filter(f => f.endsWith('.py')).map(f => 'blueprints/' + f)];
  for (const f of py) {
    for (const m of read(f).matchAll(/['"](error\.[a-z0-9_.]+)['"]/g)) add(m[1], f);
  }
  return keys;
}

test('todos los idiomas tienen las mismas claves que es.json', () => {
  for (const [f, d] of Object.entries(dict)) {
    if (f === 'es.json') continue;
    assert.deepStrictEqual(Object.keys(es).filter(k => !(k in d)), [], `${f}: faltan claves`);
    assert.deepStrictEqual(Object.keys(d).filter(k => !(k in es)), [], `${f}: claves que no están en es.json`);
  }
});

test('toda clave usada en el código existe en es.json', () => {
  const missing = [...usedKeys()].filter(([k]) => !(k in es)).map(([k, where]) => `${k} (${where})`);
  assert.deepStrictEqual(missing, []);
});

test('los parámetros {x} coinciden entre idiomas', () => {
  // Mismo conjunto de parámetros (un idioma puede no necesitar {s})
  const params = s => [...new Set([...String(s).matchAll(/\{(\w+)\}/g)].map(m => m[1]).filter(p => p !== 's'))].sort().join(',');
  for (const [f, d] of Object.entries(dict)) {
    const bad = Object.keys(es).filter(k => k in d && params(es[k]) !== params(d[k]));
    assert.deepStrictEqual(bad, [], `${f}: parámetros distintos`);
  }
});
