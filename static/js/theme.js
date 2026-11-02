// Tema: 'system' (el del dispositivo), 'light' o 'dark'. Se carga en el <head>, antes de pintar,
// para no dar un destello con el tema equivocado. Se guarda por dispositivo, como el idioma.
const THEME_COLORS = {light: '#f6f5f2', dark: '#121211'};

function themePref() {
  try {
    const v = localStorage.getItem('theme');
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch (_) { return 'system'; }
}

function applyTheme(pref) {
  const root = document.documentElement;
  if (pref === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', pref);
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => {
    const own = m.media.includes('dark') ? 'dark' : 'light';
    m.content = THEME_COLORS[pref === 'system' ? own : pref];
  });
}

function changeTheme(pref) {
  try { localStorage.setItem('theme', pref); } catch (_) {}
  applyTheme(pref);
  window.dispatchEvent(new Event('themechange'));   // las gráficas se redibujan
}

applyTheme(themePref());
