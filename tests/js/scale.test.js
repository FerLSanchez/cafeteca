// Unit tests del parser Bookoo: node --test tests/js/*.test.js
const test = require('node:test');
const assert = require('node:assert');
const {parseScalePacket, scaleChecksum} = require('../../static/js/scale.js');

function frame(bytes) {
  return [...bytes, scaleChecksum(bytes, bytes.length)];
}

// 0B: timer 12.345 s, +36.50 g, +2.10 g/s, batería 87 %
const WEIGHT = frame([0x03, 0x0b, 0x00, 0x30, 0x39, 0x00, 0x2b, 0x00, 0x0e, 0x42,
                      0x2b, 0x00, 0xd2, 0x57, 0x00, 0x32, 0x01, 0x01, 0x00]);

test('parsea trama de peso 0B', () => {
  const p = parseScalePacket(WEIGHT);
  assert.strictEqual(p.type, 'weight');
  assert.strictEqual(p.ms, 12345);
  assert.strictEqual(p.weight, 36.5);
  assert.strictEqual(p.flow, 2.1);
  assert.strictEqual(p.battery, 87);
});

test('signo negativo ASCII "-"', () => {
  const b = WEIGHT.slice(0, 19); b[6] = 0x2d;
  assert.strictEqual(parseScalePacket(frame(b)).weight, -36.5);
});

test('acepta DataView', () => {
  const dv = new DataView(Uint8Array.from(WEIGHT).buffer);
  assert.strictEqual(parseScalePacket(dv).weight, 36.5);
});

test('checksum incorrecto → null', () => {
  const b = WEIGHT.slice(); b[19] ^= 0xff;
  assert.strictEqual(parseScalePacket(b), null);
});

test('producto distinto de 0x03 → null', () => {
  assert.strictEqual(parseScalePacket(frame([0x02, 0x0b, 0x00])), null);
});

test('comando tara tiene checksum correcto', () => {
  assert.strictEqual(scaleChecksum([0x03, 0x0a, 0x01, 0x00, 0x00], 5), 0x08);
});

test('evento 0D (auto-mode)', () => {
  const p = parseScalePacket(frame([0x03, 0x0d, 0x00, 0x00, 0x75, 0x30, 0x2b, 0x00, 0x0e, 0x42, 0x2b, 0x00, 0x96]));
  assert.deepStrictEqual([p.type, p.state, p.ms, p.weight, p.avg], ['event', 0, 30000, 36.5, 1.5]);
});

test('tipo desconocido', () => {
  assert.deepStrictEqual(parseScalePacket(frame([0x03, 0x0f, 0x01])), {type: 'unknown', code: 0x0f, length: 4});
});
