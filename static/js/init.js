// ---------------------------------------------------------------------------
// Init + startup
// ---------------------------------------------------------------------------
async function init() {
  const [, settings] = await Promise.all([loadOptions(), api('/settings')]);
  gramsPerShot = settings.grams_per_shot || 17;
  await fetchAndRender();
}

// Close modals on overlay click
document.querySelectorAll('.modal-overlay').forEach(m=>{
  m.addEventListener('click', e=>{ if(e.target===m) m.classList.remove('open'); });
});

async function startup() {
  const status = await fetch('/api/auth/status').then(r => r.json()).catch(() => ({authenticated: false}));
  if (status.authenticated) {
    document.getElementById('pin-lock').style.display = 'none';
    init();
  }
  // else: pin-lock screen is already visible (default display:flex)
}

startup();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js');
}
