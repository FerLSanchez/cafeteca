const test = require('node:test');
const assert = require('node:assert');
const {fmtNum, fmtPlain} = require('../../static/js/i18n.js');

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

test('fmtPlain muestra los decimales que tiene, hasta dos', () => {
  assert.equal(fmtPlain(15, 'es'), '15');
  assert.equal(fmtPlain(15.5, 'es'), '15,5');
  assert.equal(fmtPlain(15.25, 'es'), '15,25');
  assert.equal(fmtPlain(15.5, 'en'), '15.5');
  assert.equal(fmtPlain(36.3000001, 'es'), '36,3');
});
