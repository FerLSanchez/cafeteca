// ---------------------------------------------------------------------------
// i18n — translation helper
// ---------------------------------------------------------------------------
let _translations = {};
const _currentLang = localStorage.getItem('lang') || 'es';

async function initI18n() {
  try {
    const res = await fetch(`/static/i18n/${_currentLang}.json`);
    if (!res.ok) throw new Error('i18n load failed');
    _translations = await res.json();
  } catch {
    if (_currentLang !== 'es') {
      try {
        const fallback = await fetch('/static/i18n/es.json');
        _translations = await fallback.json();
      } catch { /* show keys as-is */ }
    }
  }
}

function t(key, vars = {}) {
  let str = _translations[key] ?? key;
  for (const [k, v] of Object.entries(vars))
    str = str.replaceAll(`{${k}}`, v);
  return str;
}

function applyI18n() {
  document.documentElement.lang = _currentLang;
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = t(el.dataset.i18nTitle);
  });
}

function changeLang(lang) {
  localStorage.setItem('lang', lang);
  location.reload();
}
