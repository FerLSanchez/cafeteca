// ---------------------------------------------------------------------------
// API + UI primitives
// ---------------------------------------------------------------------------
async function api(path, opts={}) {
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

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), 2200);
}

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function showConfirm({icon='🗑', title='¿Confirmar?', msg='', btnLabel='Eliminar', btnClass='btn-danger', onConfirm}) {
  document.getElementById('confirm-icon').textContent = icon;
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-msg').textContent = msg;
  const btn = document.getElementById('confirm-action-btn');
  btn.textContent = btnLabel; btn.className = btnClass;
  btn.onclick = () => { closeModal('modal-confirm'); onConfirm(); };
  openModal('modal-confirm');
}

function openModal(id) {
  document.getElementById(id).classList.add('open');
  document.body.classList.add('modal-open');
}

function closeModal(id) {
  document.getElementById(id).classList.remove('open');
  if (!document.querySelector('.modal-overlay.open')) {
    document.body.classList.remove('modal-open');
  }
}
