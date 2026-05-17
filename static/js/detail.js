// ---------------------------------------------------------------------------
// Quick actions (card-level)
// ---------------------------------------------------------------------------
function showOpenDatePicker(e, id) {
  e.stopPropagation();
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('actions-'+id).innerHTML = `
    <div class="open-date-row" onclick="event.stopPropagation()">
      <input type="date" class="form-input" id="open-date-${id}" value="${today}">
      <button class="btn-quick open" onclick="confirmOpen(event,${id})">✓ Confirmar</button>
      <button class="btn-quick" onclick="event.stopPropagation();renderList()">✕</button>
    </div>`;
}

async function confirmOpen(e, id) {
  e.stopPropagation();
  const date = document.getElementById('open-date-'+id)?.value || new Date().toISOString().split('T')[0];
  const updated = await api('/coffees/'+id+'/open', {method:'POST', body:JSON.stringify({date})});
  const i = displayedCoffees.findIndex(c=>c.id===id);
  if (i!==-1) displayedCoffees[i]=updated;
  if (currentDetail?.id===id) currentDetail=updated;
  renderList(); showToast(t('toast.opened'));
  await loadOptions();
}

async function quickFinish(e, id) {
  e.stopPropagation();
  const updated = await api('/coffees/'+id+'/finish', {method:'POST'});
  const i = displayedCoffees.findIndex(c=>c.id===id);
  if (i!==-1) displayedCoffees[i]=updated;
  if (currentDetail?.id===id) currentDetail=updated;
  renderList(); showToast(t('toast.finished'));
}

// ---------------------------------------------------------------------------
// Detail modal
// ---------------------------------------------------------------------------
function showDetail(id) {
  const c = displayedCoffees.find(x=>x.id===id);
  if (!c) return;
  currentDetail = c;
  document.getElementById('detail-title').textContent = c.name;
  document.getElementById('unrate-btn').style.display = parseInt(c.rating,10)?'':'none';

  // Hero: status badge
  const roastDays = daysFromRoast(c.roast_date);
  const isFresh = roastDays !== null && roastDays < 14 && !c.finished_date;
  let statusClass = '', statusText = '';
  if (c.finished_date) {
    statusClass = 'done'; statusText = t('detail.status.finished');
  } else if (c.opened_date) {
    const daysOpen = Math.floor((Date.now() - new Date(c.opened_date)) / 86400000);
    statusClass = 'open';
    statusText = t('detail.status.open', {days: daysOpen, s: daysOpen !== 1 ? 's' : ''});
  } else {
    statusText = t('detail.status.unopened');
  }
  const freshNote = isFresh
    ? `<div class="detail-fresh-note">${t('detail.fresh_note', {days: 14 - roastDays, roasted: roastDays})}</div>`
    : '';

  // Profile info rows for the grid
  function chips(arr) {
    if (!arr || !arr.length) return '';
    if (arr.length === 1) return `<div class="detail-cell-val">${esc(arr[0])}</div>`;
    return `<div class="detail-cell-chips">${arr.map(v=>`<span class="detail-chip">${esc(v)}</span>`).join('')}</div>`;
  }

  // Compact grid helper
  function gridRow(l1, v1, l2, v2) {
    if (!v1 && !v2) return '';
    if (v1 && v2) return `
      <div class="detail-cell"><div class="detail-cell-label">${l1}</div><div class="detail-cell-val">${esc(String(v1))}</div></div>
      <div class="detail-cell"><div class="detail-cell-label">${l2}</div><div class="detail-cell-val">${esc(String(v2))}</div></div>`;
    const l = v1 ? l1 : l2, v = v1 || v2;
    return `<div class="detail-cell span2"><div class="detail-cell-label">${l}</div><div class="detail-cell-val">${esc(String(v))}</div></div>`;
  }

  const coste = c.price_kg && c.quantity_g
    ? (c.price_kg * c.quantity_g / 1000).toFixed(2) + '€'
    : null;

  // Profile rows (labeled, no horizontal scroll)
  function profileRow(label, content) {
    if (!content) return '';
    return `<div class="detail-cell span2"><div class="detail-cell-label">${label}</div>${content}</div>`;
  }

  const profileHTML = [
    gridRow(t('detail.label.roaster'),   c.roaster,   t('detail.label.producer'), c.producer),
    gridRow(t('detail.label.country'),   c.origin,    t('detail.label.region'),   c.region),
    profileRow(t('detail.label.varieties'),  chips(c.varieties)),
    profileRow(t('detail.label.process'),    chips(c.processes)),
    profileRow(t('detail.label.milk'),       chips(c.milk_types)),
    c.altitude ? `<div class="detail-cell span2"><div class="detail-cell-label">${t('detail.label.altitude')}</div><div class="detail-cell-val">${c.altitude} m</div></div>` : '',
  ].join('');

  const gridHTML = [
    gridRow(t('detail.label.shop'),      c.shop,                                  t('detail.label.purchase'),   fmtDate(c.purchase_date)),
    gridRow(t('detail.label.roast'),     fmtDate(c.roast_date),                   t('detail.label.opened'),     fmtDate(c.opened_date)),
    gridRow(t('detail.label.finished'),  fmtDate(c.finished_date),                t('detail.label.quantity'),   c.quantity_g ? c.quantity_g + 'g' : null),
    gridRow(t('detail.label.price_kg'),  c.price_kg ? c.price_kg + '€/kg' : null, t('detail.label.total_cost'), coste),
  ].join('');

  // Remaining row (preserves IDs used by editRemainingInline/saveRemaining)
  const remainingRow = c.quantity_g != null ? `
    <div class="detail-cell span2" id="remaining-display-row">
      <div class="detail-cell-label">${t('detail.label.remaining')}</div>
      <div class="detail-cell-val" style="display:flex;align-items:center;gap:8px">
        <span id="remaining-display">${c.remaining_g != null ? c.remaining_g + 'g' : '—'}</span>
        <button class="btn-inline-edit" onclick="editRemainingInline(${c.id})" title="Editar">${icon('edit')}</button>
      </div>
    </div>
    <div class="detail-cell span2" id="remaining-edit-row" style="display:none">
      <div class="detail-cell-label">${t('detail.label.remaining')}</div>
      <div class="detail-cell-val">
        <span class="remaining-edit-row">
          <input class="remaining-input" type="number" id="remaining-input" value="${c.remaining_g ?? ''}" min="0"
            onkeydown="if(event.key==='Enter')saveRemaining(${c.id});if(event.key==='Escape')cancelEditRemaining()">
          <span style="color:var(--text3);font-size:13px">g</span>
          <button class="btn-quick" onclick="saveRemaining(${c.id})" style="padding:4px 10px;font-size:12px">✓</button>
          <button class="btn-quick" onclick="cancelEditRemaining()" style="padding:4px 10px;font-size:12px">✕</button>
        </span>
      </div>
    </div>` : '';

  // Actions row (only if not finished)
  const actionsRow = !c.finished_date ? `
    <div class="detail-actions-row">
      <button class="btn-brew" onclick="openBrewModal()">${t('detail.btn.brew')}</button>
      <button class="btn-consume" onclick="consumeCoffee()">${t('detail.btn.consume')}</button>
    </div>` : '';

  document.getElementById('detail-content').innerHTML = `
    <div class="detail-hero">
      <div>
        <div class="detail-status-badge ${statusClass}">${statusText}</div>
        ${freshNote}
      </div>
      <div style="flex-shrink:0">${stars(c.rating)}</div>
    </div>

    <div class="detail-grid">
      ${profileHTML}
      ${gridHTML}
      ${remainingRow}
    </div>

    ${c.notes ? `<div class="detail-notes">"${esc(c.notes)}"</div>` : ''}

    ${actionsRow}

    <div id="detail-recipe-section" style="margin-top:4px"></div>
    <div id="detail-brews-section" style="margin-top:14px"></div>
  `;
  openModal('modal-detail');
  renderRecipeSection(c.id);
  renderBrewsSection(c.id);
}

function editCurrent() { closeModal('modal-detail'); openEditModal(currentDetail); }

function duplicateCurrent() {
  if (!currentDetail) return;
  const c = currentDetail;
  closeModal('modal-detail');
  resetForm();
  pendingRecipeCopyFrom = c.id;
  document.getElementById('modal-title').textContent = t('modal.form.duplicate');
  document.getElementById('f-name').value = c.name || '';
  document.getElementById('f-roaster').value = c.roaster || '';
  document.getElementById('f-producer').value = c.producer || '';
  document.getElementById('f-origin').value = c.origin || '';
  document.getElementById('f-region').value = c.region || '';
  document.getElementById('f-shop').value = c.shop || '';
  selectedVarieties = Array.isArray(c.varieties)  ? [...c.varieties]  : [];
  selectedProcesses = Array.isArray(c.processes)  ? [...c.processes]  : [];
  selectedMilkTypes = Array.isArray(c.milk_types) ? [...c.milk_types] : [];
  renderChips('varieties'); renderChips('processes'); renderChips('milk_types');
  onOriginChange();
  document.getElementById('f-quantity').value = c.quantity_g || '';
  document.getElementById('f-price').value = c.price_kg || '';
  document.getElementById('f-altitude').value = c.altitude || '';
  document.getElementById('f-notes').value = c.notes || '';
  document.getElementById('f-purchase').value = new Date().toISOString().split('T')[0];
  // leave roast_date, opened_date, finished_date, rating blank (new bag)
  openModal('modal-form');
}

async function unrateCurrent() {
  if (!currentDetail) return;
  const updated = await api('/coffees/'+currentDetail.id+'/unrate', {method:'POST'});
  const i = displayedCoffees.findIndex(c=>c.id===currentDetail.id);
  if (i!==-1) displayedCoffees[i]=updated;
  currentDetail = updated;
  showDetail(updated.id);
  renderList();
  showToast(t('toast.rating_removed'));
}

// ---------------------------------------------------------------------------
// Consume
// ---------------------------------------------------------------------------
async function consumeCoffee() {
  if (!currentDetail) return;
  const result = await api('/coffees/'+currentDetail.id+'/consume', {method:'POST'});
  const updated = result.coffee;
  const i = displayedCoffees.findIndex(c=>c.id===updated.id);
  if (i!==-1) displayedCoffees[i]=updated;
  currentDetail = updated;
  showDetail(updated.id);
  renderList();
  if (result.remaining_g <= 0) {
    showConfirm({
      icon: '☕', /* confirm icon */
      title: t('confirm.consume_finish.title'),
      msg: t('confirm.consume_finish.msg', {name: updated.name}),
      btnLabel: t('confirm.consume_finish.btn'),
      btnClass: 'btn-primary',
      onConfirm: async () => {
        const finished = await api('/coffees/'+updated.id+'/finish', {method:'POST'});
        const j = displayedCoffees.findIndex(c=>c.id===finished.id);
        if (j!==-1) displayedCoffees[j]=finished;
        currentDetail = finished;
        showDetail(finished.id);
        renderList();
        showToast(t('toast.coffee_done'));
      }
    });
  } else {
    showToast(t('toast.consume_summary', {consumed_g: result.consumed_g, remaining_g: result.remaining_g}));
  }
}

function editRemainingInline(id) {
  document.getElementById('remaining-display-row').style.display = 'none';
  document.getElementById('remaining-edit-row').style.display = '';
  const inp = document.getElementById('remaining-input');
  inp.focus(); inp.select();
}

function cancelEditRemaining() {
  document.getElementById('remaining-display-row').style.display = '';
  document.getElementById('remaining-edit-row').style.display = 'none';
}

async function saveRemaining(id) {
  const val = parseInt(document.getElementById('remaining-input').value, 10);
  if (isNaN(val) || val < 0) { showToast(t('validation.remaining_invalid')); return; }
  const updated = await api('/coffees/'+id+'/remaining', {method:'PUT', body:JSON.stringify({remaining_g:val})});
  const i = displayedCoffees.findIndex(c=>c.id===id);
  if (i!==-1) displayedCoffees[i]=updated;
  currentDetail = updated;
  showDetail(updated.id);
  renderList();
  showToast(t('toast.remaining_saved'));
}
