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

// Captura real F0 (Themis Mini, presionando con el dedo): valida el parser
// contra tramas reales. Signos ASCII '+'/'-' confirmados; sin paquetes 0D.
test('fixture F0: todas las tramas son 0B válidas', () => {
  const {frames} = require('./fixtures/f0-finger-2026-09-25.json');
  const pkts = frames.map(f => parseScalePacket(f.hex.split(' ').map(h => parseInt(h, 16))));
  assert.ok(pkts.every(p => p && p.type === 'weight'));
  assert.ok(pkts.some(p => p.flow < 0), 'flujo negativo con signo 0x2d');
  assert.ok(pkts.some(p => p.ms > 0), 'el timer arranca en modo auto');
  assert.ok(pkts.every(p => p.raw_sign.every(b => b === 0x2b || b === 0x2d)));
});

// Captura real de un café (dosis 17.0 g + shot en modo auto, 2026-09-26).
test('fixture real: fin de shot = el timer vuelve a 0 con el peso final aún presente', () => {
  const {frames} = require('./fixtures/f0-real-2026-09-26.json');
  const shot = frames.filter(f => f.label === 'shot')
    .map(f => parseScalePacket(f.hex.split(' ').map(h => parseInt(h, 16))));
  assert.ok(shot.every(p => p && p.type === 'weight'));
  const end = shot.findIndex((p, i) => i > 0 && shot[i - 1].ms > 0 && p.ms === 0);
  assert.strictEqual(shot[end - 1].ms, 27800);
  assert.strictEqual(shot[end - 1].weight, 38.5);
  assert.strictEqual(shot[end].weight, 38.5, 'el peso se tara un paquete después');
});
