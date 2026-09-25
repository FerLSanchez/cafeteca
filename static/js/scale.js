// ---------------------------------------------------------------------------
// Bookoo Themis Mini — Web Bluetooth (spec: docs/features/bookoo-scale.md)
// F0: conexión, parser de tramas y "Scale lab" en Ajustes para capturar
// tramas reales y descargarlas como JSON (fixtures para F1).
// ---------------------------------------------------------------------------
const SCALE_SERVICE = 0x0ffe;
const SCALE_CHAR_NOTIFY = 0xff11;
const SCALE_CHAR_CMD = 0xff12;
const SCALE_CMD_TARE = [0x03, 0x0a, 0x01, 0x00, 0x00, 0x08];

// XOR de todos los bytes salvo el último
function scaleChecksum(bytes, len) {
  let x = 0;
  for (let i = 0; i < len; i++) x ^= bytes[i];
  return x;
}

// Byte de signo: sin documentar. Se acepta ASCII '-' (0x2D) o 0x01 como negativo.
function scaleSign(b) { return (b === 0x2d || b === 0x01) ? -1 : 1; }

function scaleU24(b, i) { return (b[i] << 16) | (b[i + 1] << 8) | b[i + 2]; }

// Función pura: bytes (Uint8Array | DataView | Array) → objeto tipado o null
function parseScalePacket(input) {
  let b;
  if (input instanceof DataView) b = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  else b = Uint8Array.from(input);
  if (b.length < 3 || b[0] !== 0x03) return null;
  if (scaleChecksum(b, b.length - 1) !== b[b.length - 1]) return null;
  const type = b[1];
  if (type === 0x0b && b.length === 20) {
    return {
      type: 'weight',
      ms: scaleU24(b, 2),
      unit: b[5],
      weight: scaleSign(b[6]) * scaleU24(b, 7) / 100,
      flow: scaleSign(b[10]) * ((b[11] << 8) | b[12]) / 100,
      battery: b[13],
      standby: ((b[14] << 8) | b[15]) / 10,
      buzzer: b[16],
      smoothing: b[17],
      raw_sign: [b[6], b[10]],
    };
  }
  if (type === 0x0d && b.length >= 14) {
    return {
      type: 'event',
      state: b[2],
      ms: scaleU24(b, 3),
      weight: scaleSign(b[6]) * scaleU24(b, 7) / 100,
      avg: scaleSign(b[10]) * ((b[11] << 8) | b[12]) / 100,
    };
  }
  return {type: 'unknown', code: type, length: b.length};
}

function scaleHex(b) {
  return Array.from(b, x => x.toString(16).padStart(2, '0')).join(' ');
}

// ---------------------------------------------------------------------------
// Conexión BLE (solo navegador)
// ---------------------------------------------------------------------------
const scale = {
  device: null,
  cmdChar: null,
  bus: typeof EventTarget !== 'undefined' ? new EventTarget() : null,
  last: null,
};

function scaleSupported() {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
}

function scaleEmit(name, detail) {
  scale.bus.dispatchEvent(new CustomEvent(name, {detail}));
}

function scaleOnNotify(e) {
  const dv = e.target.value;
  const bytes = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength).slice();
  const pkt = parseScalePacket(bytes);
  scaleEmit('scale:raw', {t: performance.now(), bytes, pkt});
  if (!pkt) return;
  if (pkt.type === 'weight') { scale.last = pkt; scaleEmit('scale:weight', pkt); }
  else if (pkt.type === 'event') scaleEmit('scale:event', pkt);
}

function scaleOnDisconnect() {
  scale.cmdChar = null;
  scaleEmit('scale:disconnected', {});
}

async function scaleConnect() {
  if (!scaleSupported()) throw new Error('unsupported');
  if (scale.device?.gatt?.connected) return scale.device;
  const device = scale.device || await navigator.bluetooth.requestDevice({
    filters: [{services: [SCALE_SERVICE]}],
  });
  if (!scale.device) {
    device.addEventListener('gattserverdisconnected', scaleOnDisconnect);
    scale.device = device;
  }
  const server = await device.gatt.connect();
  const service = await server.getPrimaryService(SCALE_SERVICE);
  const notify = await service.getCharacteristic(SCALE_CHAR_NOTIFY);
  scale.cmdChar = await service.getCharacteristic(SCALE_CHAR_CMD);
  notify.addEventListener('characteristicvaluechanged', scaleOnNotify);
  await notify.startNotifications();
  scaleEmit('scale:connected', {name: device.name});
  return device;
}

function scaleDisconnect() {
  if (scale.device?.gatt?.connected) scale.device.gatt.disconnect();
}

async function scaleTare() {
  if (!scale.cmdChar) return;
  await scale.cmdChar.writeValue(new Uint8Array(SCALE_CMD_TARE));
}

// ---------------------------------------------------------------------------
// Scale lab (F0) — captura de tramas en Ajustes
// ---------------------------------------------------------------------------
const scaleLab = {frames: [], recording: false, t0: null, label: '', session: 0};

function scaleLabInit() {
  const box = document.getElementById('scale-lab');
  if (!box) return;
  if (!scaleSupported()) {
    document.getElementById('scale-lab-unsupported').style.display = '';
    document.getElementById('scale-lab-body').style.display = 'none';
    return;
  }
  scale.bus.addEventListener('scale:raw', e => {
    const {t, bytes, pkt} = e.detail;
    if (scaleLab.recording) {
      scaleLab.frames.push({t: Math.round(t - scaleLab.t0), session: scaleLab.session, label: scaleLab.label, hex: scaleHex(bytes)});
      scaleLabRenderCount();
    }
    scaleLabRenderLive(pkt, bytes);
  });
  scale.bus.addEventListener('scale:connected', e => scaleLabStatus(t('scale.connected', {name: e.detail.name || 'Bookoo'})));
  scale.bus.addEventListener('scale:disconnected', () => scaleLabStatus(t('scale.disconnected')));
}

function scaleLabStatus(msg) {
  document.getElementById('scale-lab-status').textContent = msg;
}

function scaleLabRenderLive(pkt, bytes) {
  const el = document.getElementById('scale-lab-live');
  if (!pkt) { el.textContent = `✗ ${scaleHex(bytes)}`; return; }
  if (pkt.type === 'weight') {
    el.textContent = `⏱ ${(pkt.ms / 1000).toFixed(1)}s · ${pkt.weight.toFixed(2)} g · ${pkt.flow.toFixed(2)} g/s · 🔋${pkt.battery}% · sign ${pkt.raw_sign.map(x => x.toString(16)).join('/')}`;
  } else if (pkt.type === 'event') {
    document.getElementById('scale-lab-events').textContent += `0D state=${pkt.state} ${(pkt.ms / 1000).toFixed(1)}s ${pkt.weight}g\n`;
  } else {
    document.getElementById('scale-lab-events').textContent += `type 0x${pkt.code.toString(16)} (${pkt.length}B): ${scaleHex(bytes)}\n`;
  }
}

function scaleLabRenderCount() {
  document.getElementById('scale-lab-count').textContent = t('scale.lab.frames', {count: scaleLab.frames.length});
}

async function scaleLabConnect() {
  try {
    scaleLabStatus(t('scale.connecting'));
    await scaleConnect();
  } catch (err) {
    scaleLabStatus(`${t('scale.connect_failed')} (${err.message})`);
  }
}

function scaleLabRecord(label) {
  scaleLab.label = label;
  if (!scaleLab.recording) {
    // t0 se mantiene entre grabaciones (hasta Vaciar) para que los tiempos no se solapen
    scaleLab.recording = true;
    scaleLab.session++;
    if (scaleLab.t0 === null) scaleLab.t0 = performance.now();
  }
  document.getElementById('scale-lab-rec').textContent = `● ${label}`;
}

// Pausa: deja de grabar (p. ej. mientras se cambia a modo auto y se lleva la
// báscula a la cafetera) sin perder lo grabado; "● Shot" reanuda.
function scaleLabPause() {
  if (!scaleLab.recording) return;
  scaleLab.recording = false;
  document.getElementById('scale-lab-rec').textContent = t('scale.lab.paused');
}

function scaleLabDownload() {
  const data = {
    captured_at: new Date().toISOString(),
    device: scale.device?.name || null,
    user_agent: navigator.userAgent,
    frames: scaleLab.frames,
  };
  const blob = new Blob([JSON.stringify(data, null, 1)], {type: 'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `bookoo-capture-${todayLocal()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function scaleLabClear() {
  scaleLab.frames = [];
  scaleLab.t0 = null;
  scaleLab.session = 0;
  scaleLab.recording = false;
  document.getElementById('scale-lab-rec').textContent = '';
  document.getElementById('scale-lab-events').textContent = '';
  scaleLabRenderCount();
}

if (typeof module !== 'undefined') {
  module.exports = {parseScalePacket, scaleChecksum, scaleHex};
}
