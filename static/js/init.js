// ---------------------------------------------------------------------------
// Init + startup
// ---------------------------------------------------------------------------
async function init() {
  const [, settings] = await Promise.all([loadOptions(), api('/settings')]);
  gramsPerShot = settings.grams_per_shot || 17;
  lowStockThreshold = settings.low_stock_threshold ?? 5;
  await fetchAndRender();
}

// Close modals on overlay click
document.querySelectorAll('.modal-overlay').forEach(m=>{
  m.addEventListener('click', e=>{ if(e.target===m) closeModal(m.id); });
});

async function startup() {
  await initI18n();
  applyI18n();
  const langSel = document.getElementById('lang-select');
  if (langSel) langSel.value = _currentLang;
  scaleLabInit();
  init();
}

startup();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js');
  navigator.serviceWorker.addEventListener('message', e => {
    if (e.data?.type === 'SW_UPDATED') window.location.reload();
  });
}
