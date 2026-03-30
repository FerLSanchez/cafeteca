export async function api(path, opts={}) {
  let r;
  try {
    r = await fetch('/api'+path, {headers:{'Content-Type':'application/json'}, ...opts});
  } catch {
    showToast('⚠️ Error de red: sin conexión con el servidor');
    throw new Error('network error');
  }
  const data = await r.json();
  if (!r.ok) {
    showToast('⚠️ ' + (data.error || `Error ${r.status}`));
    throw Object.assign(new Error(data.error || `Error ${r.status}`), {status: r.status});
  }
  return data;
}

export function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), 2200);
}

export function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

export function fmtDate(d) {
  if (!d) return null;
  const [y,m,day] = d.split('-'); return `${day}/${m}/${y}`;
}

export function fmtWeight(g) {
  if (!g) return '0g';
  return g >= 1000 ? (g / 1000).toFixed(1) + 'kg' : g + 'g';
}

export function fmtPrice(c) {
  if (!c.price_kg||!c.quantity_g) return null;
  return `${c.price_kg}€/kg · ${(c.quantity_g/1000*c.price_kg).toFixed(2)}€`;
}
