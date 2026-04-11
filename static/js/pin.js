// ---------------------------------------------------------------------------
// PIN auth
// ---------------------------------------------------------------------------
function pinDigit(d) {
  if (pinValue.length >= 4) return;
  pinValue += d;
  updatePinDots();
  if (pinValue.length === 4) submitPin();
}

function pinDelete() {
  pinValue = pinValue.slice(0, -1);
  updatePinDots();
}

function updatePinDots() {
  document.querySelectorAll('#pin-dots .pin-dot').forEach((dot, i) => {
    dot.classList.toggle('filled', i < pinValue.length);
  });
}

async function submitPin() {
  try {
    await api('/auth/login', {method:'POST', body:JSON.stringify({pin: pinValue})});
    document.getElementById('pin-lock').style.display = 'none';
    init();
  } catch {
    document.getElementById('pin-error').textContent = t('validation.pin_wrong');
    pinValue = '';
    updatePinDots();
    setTimeout(() => { document.getElementById('pin-error').textContent = ''; }, 1500);
  }
}

async function changePinSubmit() {
  const current = document.getElementById('cp-current').value;
  const newPin = document.getElementById('cp-new').value;
  const confirm = document.getElementById('cp-confirm').value;
  if (!/^\d{4}$/.test(newPin)) { showToast(t('validation.pin_format')); return; }
  if (newPin !== confirm) { showToast(t('validation.pin_mismatch')); return; }
  try {
    await api('/auth/change-pin', {method:'POST', body:JSON.stringify({current_pin:current, new_pin:newPin})});
    closeModal('modal-settings');
    document.getElementById('cp-current').value = '';
    document.getElementById('cp-new').value = '';
    document.getElementById('cp-confirm').value = '';
    showToast(t('toast.pin_changed'));
  } catch { /* api() already shows toast */ }
}
