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
  // Authelia session expired: NPM answers API calls with a bare 401 (no redirect,
  // fetch can't follow it cross-origin). Reloading navigates to / → Authelia login.
  if (r.status === 401) {
    window.location.reload();
    throw new Error('unauthenticated');
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

// {undo}: async fn → adds a "Deshacer" button and keeps the toast 5 s (actions a mis-tap can trigger)
let _toastTimer = null;
function showToast(msg, {undo} = {}) {
  const toastEl = document.getElementById('toast');
  toastEl.textContent = msg;
  toastEl.classList.toggle('has-action', !!undo);
  if (undo) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast-action';
    btn.textContent = t('toast.undo');
    btn.onclick = async () => {
      toastEl.classList.remove('show');
      try { await undo(); showToast(t('toast.undone')); } catch (_) {}
    };
    toastEl.append(btn);
  }
  toastEl.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(()=>toastEl.classList.remove('show'), undo ? 5000 : 2200);
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

// Pila de modales abiertos (el último es el de arriba) con el elemento que tenía el foco al abrir
const _modalStack = [];

function openModal(id) {
  const overlay = document.getElementById(id);
  const dialog = overlay.querySelector('.modal');
  const i = _modalStack.findIndex(m => m.id === id);
  const opener = i !== -1 ? _modalStack.splice(i, 1)[0].opener : document.activeElement;
  _modalStack.push({id, opener});
  if (dialog) {
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.tabIndex = -1;
    const title = dialog.querySelector('.modal-title');
    if (title) { title.id ||= id + '-title'; dialog.setAttribute('aria-labelledby', title.id); }
  }
  overlay.classList.add('open');
  document.body.classList.add('modal-open');
  // Foco al diálogo, no al primer campo: en el móvil abriría el teclado
  if (dialog && !dialog.contains(document.activeElement)) dialog.focus({preventScroll: true});
}

// Recarga pendiente por una versión nueva (onSwUpdated en init.js): al cerrar el último modal
let reloadWhenModalsClosed = false;

// Limpieza al cerrar un modal (botón, overlay o código): {modalId: fn}
const MODAL_ON_CLOSE = {};

function closeModal(id) {
  MODAL_ON_CLOSE[id]?.();
  document.getElementById(id).classList.remove('open');
  if (!document.querySelector('.modal-overlay.open')) {
    document.body.classList.remove('modal-open');
    if (reloadWhenModalsClosed) { window.location.reload(); return; }
  }
  const i = _modalStack.findIndex(m => m.id === id);
  if (i !== -1) {
    const {opener} = _modalStack.splice(i, 1)[0];
    if (i === _modalStack.length && opener?.isConnected && opener.focus) opener.focus({preventScroll: true});
  }
}

// Esc cierra el modal de arriba; Tab no sale de él
document.addEventListener('keydown', e => {
  const top = _modalStack[_modalStack.length - 1];
  if (!top || !document.getElementById(top.id)?.classList.contains('open')) return;
  const dialog = document.querySelector(`#${top.id} .modal`);
  if (e.key === 'Escape') {
    // Un autocompletado abierto se cierra antes que el modal (los campos con su propio Esc hacen stopPropagation)
    const ac = document.querySelector('.ac-dropdown.open');
    if (ac) { ac.classList.remove('open'); e.preventDefault(); return; }
    e.preventDefault();
    closeModal(top.id);
  } else if (e.key === 'Tab' && dialog) {
    const items = [...dialog.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
      .filter(el => !el.disabled && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
});
