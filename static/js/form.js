// ---------------------------------------------------------------------------
// Form: add / edit coffee
// ---------------------------------------------------------------------------
function setRating(val) {
  document.getElementById('f-rating').value = val;
  document.querySelectorAll('.rating-star').forEach(s=>s.classList.toggle('active', parseInt(s.dataset.val)<=val));
}

function resetForm() {
  pendingRecipeCopyFrom = null;
  document.getElementById('coffee-form').reset();
  document.getElementById('f-id').value='';
  document.getElementById('f-rating').value='';
  document.querySelectorAll('.rating-star').forEach(s=>s.classList.remove('active'));
  document.getElementById('edit-actions').style.display='none';
  document.getElementById('modal-title').textContent=t('modal.form.new');
  // Reset chip fields
  selectedVarieties = []; renderChips('varieties');
  selectedProcesses = []; renderChips('processes');
  selectedMilkTypes = []; renderChips('milk_types');
  if (document.getElementById('region-hint')) document.getElementById('region-hint').textContent='';
}

function openAddModal() {
  resetForm();
  document.getElementById('f-purchase').value = new Date().toISOString().split('T')[0];
  openModal('modal-form');
}

function openEditModal(c) {
  resetForm();
  document.getElementById('modal-title').textContent=t('modal.form.edit');
  document.getElementById('f-id').value=c.id;
  document.getElementById('f-name').value=c.name||'';
  document.getElementById('f-roaster').value=c.roaster||'';
  document.getElementById('f-producer').value=c.producer||'';
  document.getElementById('f-origin').value=c.origin||'';
  document.getElementById('f-region').value=c.region||'';
  document.getElementById('f-shop').value=c.shop||'';
  // Chip fields
  selectedVarieties = Array.isArray(c.varieties)   ? [...c.varieties]   : [];
  selectedProcesses = Array.isArray(c.processes)   ? [...c.processes]   : [];
  selectedMilkTypes = Array.isArray(c.milk_types)  ? [...c.milk_types]  : [];
  renderChips('varieties'); renderChips('processes'); renderChips('milk_types');
  onOriginChange();
  document.getElementById('f-quantity').value=c.quantity_g||'';
  document.getElementById('f-price').value=c.price_kg||'';
  document.getElementById('f-purchase').value=c.purchase_date||'';
  document.getElementById('f-roast').value=c.roast_date||'';
  document.getElementById('f-opened').value=c.opened_date||'';
  document.getElementById('f-finished').value=c.finished_date||'';
  document.getElementById('f-notes').value=c.notes||'';
  document.getElementById('f-altitude').value=c.altitude||'';
  const r=parseInt(c.rating,10);
  if (r>=1&&r<=5) setRating(r);
  document.getElementById('edit-actions').style.display='flex';
  openModal('modal-form');
}

async function submitForm(e) {
  e.preventDefault();
  const id = document.getElementById('f-id').value;
  const rv = document.getElementById('f-rating').value;
  const data = {
    name:          document.getElementById('f-name').value,
    roaster:       document.getElementById('f-roaster').value||null,
    producer:      document.getElementById('f-producer').value||null,
    varieties:     selectedVarieties.length ? [...selectedVarieties] : [],
    origin:        document.getElementById('f-origin').value||null,
    region:        document.getElementById('f-region').value||null,
    processes:     selectedProcesses.length ? [...selectedProcesses] : [],
    milk_types:    selectedMilkTypes.length  ? [...selectedMilkTypes]  : [],
    shop:          document.getElementById('f-shop').value||null,
    quantity_g:    document.getElementById('f-quantity').value?parseInt(document.getElementById('f-quantity').value):null,
    price_kg:      document.getElementById('f-price').value?parseFloat(document.getElementById('f-price').value):null,
    purchase_date: document.getElementById('f-purchase').value||null,
    roast_date:    document.getElementById('f-roast').value||null,
    opened_date:   document.getElementById('f-opened').value||null,
    finished_date: document.getElementById('f-finished').value||null,
    rating:        rv?parseInt(rv):null,
    notes:         document.getElementById('f-notes').value||null,
    altitude:      document.getElementById('f-altitude').value?parseInt(document.getElementById('f-altitude').value):null,
  };
  // Validate region-country consistency for known entities
  if (data.region && data.origin) {
    const region = (allOptions.regions||[]).find(r => r.name.toLowerCase() === data.region.toLowerCase());
    const origin = (allOptions.origins||[]).find(o => o.name.toLowerCase() === data.origin.toLowerCase());
    if (region && region.origin_id && origin && region.origin_id !== origin.id) {
      const correct = (allOptions.origins||[]).find(o => o.id === region.origin_id);
      showToast(t('validation.region_mismatch', {region: data.region, country: correct ? correct.name : '?', origin: data.origin}));
      return;
    }
  }
  if (id) {
    await api('/coffees/'+id, {method:'PUT', body:JSON.stringify(data)});
  } else {
    if (pendingRecipeCopyFrom) data.source_id = pendingRecipeCopyFrom;
    await api('/coffees', {method:'POST', body:JSON.stringify(data)});
    pendingRecipeCopyFrom = null;
  }
  closeModal('modal-form');
  showToast(id ? t('toast.coffee_updated') : t('toast.coffee_added'));
  await loadOptions();       // refresh autocomplete lists
  populateFilterSelects();   // refresh filter dropdowns
  await fetchAndRender();
}

function deleteCoffee() {
  const id = document.getElementById('f-id').value;
  if (!id) return;
  const name = document.getElementById('f-name').value;
  showConfirm({
    icon: '🗑', title: t('confirm.delete_coffee.title'),
    msg: t('confirm.delete_coffee.msg', {name}),
    btnLabel: t('confirm.delete_coffee.btn'), btnClass: 'btn-danger',
    onConfirm: async () => {
      await api('/coffees/'+id, {method:'DELETE'});
      closeModal('modal-form');
      showToast(t('toast.coffee_deleted'));
      await fetchAndRender();
    }
  });
}

// ---------------------------------------------------------------------------
// Settings modal
// ---------------------------------------------------------------------------
function openSettings() {
  document.getElementById('s-grams').value = gramsPerShot;
  openModal('modal-settings');
}

async function saveSettings() {
  const gps = parseInt(document.getElementById('s-grams').value, 10);
  if (isNaN(gps) || gps < 1 || gps > 100) { showToast(t('validation.grams_invalid')); return; }
  await api('/settings', {method:'PUT', body:JSON.stringify({grams_per_shot:gps})});
  gramsPerShot = gps;
  showToast(t('toast.settings_saved'));
}
