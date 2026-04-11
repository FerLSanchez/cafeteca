// ---------------------------------------------------------------------------
// API + UI primitives
// ---------------------------------------------------------------------------
async function api(path, opts={}) {
  let r;
  try {
    r = await fetch('/api'+path, {headers:{'Content-Type':'application/json'}, ...opts});
  } catch {
    showToast('⚠️ ' + t('error.network'));
    throw new Error('network error');
  }
  const data = await r.json();
  if (!r.ok) {
    const msg = data.error_key
      ? t(data.error_key, data.error_key_params || {})
      : (data.error || `Error ${r.status}`);
    showToast('⚠️ ' + msg);
    throw Object.assign(new Error(msg), {status: r.status});
  }
  return data;
}

function showToast(msg) {
  const toastEl = document.getElementById('toast');
  toastEl.textContent = msg; toastEl.classList.add('show');
  setTimeout(()=>toastEl.classList.remove('show'), 2200);
}

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function showConfirm({icon='🗑', title, msg='', btnLabel, btnClass='btn-danger', onConfirm}) {
  title = title ?? t('modal.confirm.default_title');
  btnLabel = btnLabel ?? t('modal.confirm.default_btn');
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
