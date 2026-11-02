// ---------------------------------------------------------------------------
// i18n — translation helper
// ---------------------------------------------------------------------------
let _translations = {};
const _currentLang = (() => { try { return localStorage.getItem('lang') || 'es'; } catch (_) { return 'es'; } })();

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
  document.querySelectorAll('[data-i18n-aria-label]').forEach(el => {
    el.setAttribute('aria-label', t(el.dataset.i18nAriaLabel));
  });
}

function changeLang(lang) {
  try { localStorage.setItem('lang', lang); } catch (_) {}
  location.reload();
}

// Número para mostrar con el separador decimal del idioma. Solo para pantalla: lo que va al API
// o a un <input> sigue siendo un número normal.
function fmtNum(value, decimals, lang = _currentLang) {
  const n = Number(value).toFixed(decimals);
  return lang === 'en' ? n : n.replace('.', ',');
}

// Con los decimales que tenga el valor, hasta dos: 15 · 15,5 · 15,25
function fmtPlain(value, lang = _currentLang) {
  const v = +Number(value).toFixed(2);
  return fmtNum(v, Number.isInteger(v) ? 0 : Number.isInteger(+(v * 10).toFixed(6)) ? 1 : 2, lang);
}

if (typeof module !== 'undefined') module.exports = {fmtNum, fmtPlain};
