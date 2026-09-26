// ---------------------------------------------------------------------------
// Init + startup
// ---------------------------------------------------------------------------
async function init() {
  const [, settings] = await Promise.all([loadOptions(), api('/settings')]);
  gramsPerShot = settings.grams_per_shot || 17;
  lowStockThreshold = settings.low_stock_threshold ?? 5;
  flowTolerance = settings.flow_tolerance ?? 0.2;
  grindStep = settings.grind_step ?? 1;
  restoreListPrefs();
  await fetchAndRender();
}

// Close modals on overlay click (not the ones with data being entered, e.g. mid-shot)
document.querySelectorAll('.modal-overlay:not([data-keep-open])').forEach(m=>{
  m.addEventListener('click', e=>{ if(e.target===m) closeModal(m.id); });
});

async function startup() {
  await initI18n();
  applyI18n();
  const langSel = document.getElementById('lang-select');
  if (langSel) langSel.value = _currentLang;
  scaleLabInit();
  scaleUiInit();
  init();
}

startup();

// Nueva versión desplegada → recargar, pero nunca en la primera visita (no había versión
// anterior) ni con un modal abierto (un shot o un formulario a medias): se espera a cerrarlo.
function onSwUpdated(hadController) {
  if (!hadController) return;
  if (document.querySelector('.modal-overlay.open')) reloadWhenModalsClosed = true;
  else window.location.reload();
}

if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('/sw.js');
  navigator.serviceWorker.addEventListener('message', e => {
    if (e.data?.type === 'SW_UPDATED') onSwUpdated(hadController);
  });
}
