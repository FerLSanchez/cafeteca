const test = require('node:test');
const assert = require('node:assert');
const {fmtNum} = require('../../static/js/i18n.js');

test('fmtNum sigue el idioma', () => {
  assert.equal(fmtNum(30.4, 1, 'es'), '30,4');
  assert.equal(fmtNum(30.4, 1, 'en'), '30.4');
  assert.equal(fmtNum(30, 1, 'es'), '30,0');
  assert.equal(fmtNum(2.111, 2, 'es'), '2,11');
});

test('fmtNum redondea como toFixed y no agrupa miles', () => {
  assert.equal(fmtNum(1234.56, 1, 'es'), '1234,6');
  assert.equal(fmtNum(0, 0, 'es'), '0');
});
