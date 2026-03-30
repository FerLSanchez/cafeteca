import { api } from '../api.js';

let pinValue = '';

export function pinDigit(d) {
  if (pinValue.length >= 4) return;
  pinValue += d;
  updatePinDots();
  if (pinValue.length === 4) submitPin();
}

export function pinDelete() {
  pinValue = pinValue.slice(0, -1);
  updatePinDots();
}

function updatePinDots() {
  document.querySelectorAll('#pin-dots .pin-dot').forEach((dot, i) => {
    dot.classList.toggle('filled', i < pinValue.length);
  });
}

export async function submitPin() {
  try {
    await api('/auth/login', {method:'POST', body:JSON.stringify({pin: pinValue})});
    document.getElementById('pin-lock').style.display = 'none';
    if (window._init) window._init();
  } catch {
    document.getElementById('pin-error').textContent = 'PIN incorrecto';
    pinValue = '';
    updatePinDots();
    setTimeout(() => { document.getElementById('pin-error').textContent = ''; }, 1500);
  }
}

export async function startup() {
  try {
    const status = await fetch('/api/auth/status').then(r => r.json()).catch(() => ({authenticated: false}));
    if (status.authenticated) {
      document.getElementById('pin-lock').style.display = 'none';
      if (window._init) window._init();
    }
  } catch {
    // show lock screen
  }
}
