// Inventario de acciones: el rediseño no cambia funcionalidad, así que ninguna función llamada
// desde un manejador on*="…" de la UI puede desaparecer respecto a la línea base.
//   node --test tests/js/actions.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '../..');
const NOT_ACTIONS = new Set(['if', 'event', 'this', 'return', 'document']);

function handlerNames() {
  const files = ['templates/index.html',
    ...fs.readdirSync(path.join(ROOT, 'static/js')).map(f => 'static/js/' + f)];
  const names = new Set();
  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const m of src.matchAll(/\bon[a-z]+="([^"]*)"/g)) {
      for (const c of m[1].matchAll(/(?<![.\w])([A-Za-z_$][\w$]*)\s*\(/g)) {
        if (!NOT_ACTIONS.has(c[1])) names.add(c[1]);
      }
    }
  }
  return [...names].sort();
}

test('no UI action disappears', () => {
  const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/actions-baseline.json'), 'utf8'));
  const now = handlerNames();
  assert.deepEqual(baseline.filter(n => !now.includes(n)), []);
});

module.exports = {handlerNames};
