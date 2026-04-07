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
  renderList(); showToast('📦 Marcado como abierto');
  await loadOptions();
}

async function quickFinish(e, id) {
  e.stopPropagation();
  const updated = await api('/coffees/'+id+'/finish', {method:'POST'});
  const i = displayedCoffees.findIndex(c=>c.id===id);
  if (i!==-1) displayedCoffees[i]=updated;
  if (currentDetail?.id===id) currentDetail=updated;
  renderList(); showToast('✅ Marcado como terminado');
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
  const rows = [
    ['Tostador',c.roaster],['Productor',c.producer],
    ['Variedad',c.varieties&&c.varieties.length?c.varieties.join(', '):null],
    ['País',c.origin],['Región',c.region],['Altitud',c.altitude?c.altitude+' m':null],
    ['Proceso',c.processes&&c.processes.length?c.processes.join(', '):null],
    ['🥛 Con leche vegetal',c.milk_types&&c.milk_types.length?c.milk_types.join(', '):null],
    ['Tienda',c.shop],
    ['Cantidad',c.quantity_g?c.quantity_g+'g':null],
    ['Precio/kg',c.price_kg?c.price_kg+'€':null],['Coste total',fmtPrice(c)],
    ['Compra',fmtDate(c.purchase_date)],['Tueste',fmtDate(c.roast_date)],
    ['Abierto',fmtDate(c.opened_date)],['Terminado',fmtDate(c.finished_date)],
  ].filter(([,v])=>v);
  const roastDays = daysFromRoast(c.roast_date);
  const freshBanner = roastDays !== null && roastDays < 14 && !c.finished_date
    ? `<div class="fresh-warning-banner">⏳ Aún en reposo — faltan <strong>${14 - roastDays} días</strong> para las dos semanas desde el tueste (${roastDays} días de ${14}).</div>` : '';

  // Remaining coffee row (editable)
  const remainingRow = c.quantity_g != null ? `
    <div class="detail-row" id="remaining-display-row">
      <span class="detail-label">☕ Restante</span>
      <span class="detail-val" style="display:flex;align-items:center;gap:6px">
        <span id="remaining-display">${c.remaining_g != null ? c.remaining_g + 'g' : '—'}</span>
        <button class="btn-inline-edit" onclick="editRemainingInline(${c.id})" title="Editar">✏️</button>
      </span>
    </div>
    <div class="detail-row" id="remaining-edit-row" style="display:none">
      <span class="detail-label">☕ Restante</span>
      <span class="detail-val">
        <span class="remaining-edit-row">
          <input class="remaining-input" type="number" id="remaining-input" value="${c.remaining_g ?? ''}" min="0" onkeydown="if(event.key==='Enter')saveRemaining(${c.id});if(event.key==='Escape')cancelEditRemaining()">
          <span style="color:var(--text3);font-size:13px">g</span>
          <button class="btn-quick" onclick="saveRemaining(${c.id})" style="padding:4px 10px;font-size:12px">✓</button>
          <button class="btn-quick" onclick="cancelEditRemaining()" style="padding:4px 10px;font-size:12px">✕</button>
        </span>
      </span>
    </div>` : '';

  // Consume button (only if not finished)
  const consumeBtn = !c.finished_date ? `<button class="btn-consume" onclick="consumeCoffee()">☕ Consumir una toma (−${gramsPerShot}g)</button>` : '';

  document.getElementById('detail-content').innerHTML = `
    ${freshBanner}
    <div style="margin-bottom:12px">${stars(c.rating)}</div>
    ${rows.map(([l,v])=>`<div class="detail-row"><span class="detail-label">${esc(l)}</span><span class="detail-val">${esc(String(v))}</span></div>`).join('')}
    ${remainingRow}
    ${c.notes?`<div style="margin-top:14px;font-size:14px;color:var(--text2);line-height:1.6;font-style:italic">"${esc(c.notes)}"</div>`:''}
    ${consumeBtn}
    <div id="detail-recipe-section" style="margin-top:14px"></div>
    <button class="btn-brew" onclick="openBrewModal()" style="margin-top:8px;width:100%">🫖 Preparar café</button>
    <div id="detail-brews-section" style="margin-top:14px"></div>
  `;
  document.getElementById('modal-detail').classList.add('open');
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
  document.getElementById('modal-title').textContent = 'Nueva bolsa';
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
  document.getElementById('modal-form').classList.add('open');
}

async function unrateCurrent() {
  if (!currentDetail) return;
  const updated = await api('/coffees/'+currentDetail.id+'/unrate', {method:'POST'});
  const i = displayedCoffees.findIndex(c=>c.id===currentDetail.id);
  if (i!==-1) displayedCoffees[i]=updated;
  currentDetail = updated;
  showDetail(updated.id);
  renderList();
  showToast('☆ Valoración eliminada');
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
      icon: '☕',
      title: '¿Marcar como terminado?',
      msg: `"${updated.name}" se ha quedado sin café restante. ¿Marcarlo como terminado con la fecha de hoy?`,
      btnLabel: 'Marcar como terminado',
      btnClass: 'btn-primary',
      onConfirm: async () => {
        const finished = await api('/coffees/'+updated.id+'/finish', {method:'POST'});
        const j = displayedCoffees.findIndex(c=>c.id===finished.id);
        if (j!==-1) displayedCoffees[j]=finished;
        currentDetail = finished;
        showDetail(finished.id);
        renderList();
        showToast('✅ Café terminado');
      }
    });
  } else {
    showToast(`☕ −${result.consumed_g}g · Quedan ${result.remaining_g}g`);
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
  if (isNaN(val) || val < 0) { showToast('⚠️ Valor inválido'); return; }
  const updated = await api('/coffees/'+id+'/remaining', {method:'PUT', body:JSON.stringify({remaining_g:val})});
  const i = displayedCoffees.findIndex(c=>c.id===id);
  if (i!==-1) displayedCoffees[i]=updated;
  currentDetail = updated;
  showDetail(updated.id);
  showToast('✓ Café restante actualizado');
}
