// ---------------------------------------------------------------------------
// Catalog management
// ---------------------------------------------------------------------------
async function loadCatalog() {
  const el = document.getElementById('catalog-content');
  el.innerHTML = `<div class="loading">${t('loading')}</div>`;
  const results = await Promise.all(
    LOOKUP_TABLES.map(tbl => api('/lookup/'+tbl).then(data => ({table:tbl, data})))
  );
  el.innerHTML = results.map(({table, data}) => {
    const orphans = data.filter(r => r.coffee_count === 0).length;
    const s = data.length !== 1 ? 's' : '';
    const badgeText = t('catalog.entry_count', {count: data.length, s}) + (orphans ? ' · ' + t('catalog.unused_count', {count: orphans}) : '');
    const badge = `<span class="catalog-badge ${orphans?'has-orphans':''}" id="cat-badge-${table}">${badgeText}</span>`;
    const rows = data.map(r => `
      <div class="catalog-row" id="crow-${table}-${r.id}">
        <span class="catalog-row-name" id="cname-${table}-${r.id}">${esc(r.name)}</span>
        <input class="catalog-row-input" id="cinput-${table}-${r.id}" value="${esc(r.name)}"
          onkeydown="catalogKeydown(event,'${table}',${r.id})" onfocus="this.select()">
        <span class="catalog-count ${r.coffee_count===0?'zero':''}" title="${r.coffee_count} café(s)">
          ${r.coffee_count===0?'✕':r.coffee_count}
        </span>
        <button class="btn-icon" id="cedit-${table}-${r.id}" onclick="catalogStartEdit('${table}',${r.id})" title="Renombrar">✏️</button>
        <button class="btn-icon save" id="csave-${table}-${r.id}" style="display:none" onclick="catalogSave('${table}',${r.id})" title="Guardar">✓</button>
        <button class="btn-icon" id="ccancel-${table}-${r.id}" style="display:none" onclick="catalogCancelEdit('${table}',${r.id})" title="Cancelar">✕</button>
        <button class="btn-icon danger" onclick="catalogDelete('${table}',${r.id},${r.coffee_count})" title="Eliminar" ${r.coffee_count>0?'disabled style="opacity:0.3;cursor:not-allowed"':''}>🗑</button>
      </div>`).join('');
    const purgeBtn = orphans ? `<div class="catalog-purge"><button class="btn-purge" onclick="catalogPurge('${table}')">🧹 ${t('catalog.unused_count', {count: orphans})}</button></div>` : '';
    return `<div class="catalog-section">
      <div class="catalog-header" onclick="toggleCatalogSection('${table}')">
        <div class="catalog-header-left">
          <span class="catalog-title">${getCatalogLabels()[table]}</span>
          ${badge}
        </div>
        <span id="cat-arrow-${table}" style="color:var(--text3)">›</span>
      </div>
      <div class="catalog-body" id="catbody-${table}">
        ${rows || `<div style="padding:14px 16px;color:var(--text3);font-size:13px">${t('catalog.no_entries')}</div>`}
        ${purgeBtn}
      </div>
    </div>`;
  }).join('');
}

function toggleCatalogSection(table) {
  const body = document.getElementById('catbody-'+table);
  const arrow = document.getElementById('cat-arrow-'+table);
  body.classList.toggle('open');
  arrow.textContent = body.classList.contains('open') ? '⌄' : '›';
}

function catalogStartEdit(table, id) {
  document.getElementById('cname-'+table+'-'+id).style.display = 'none';
  document.getElementById('cinput-'+table+'-'+id).style.display = 'block';
  document.getElementById('cedit-'+table+'-'+id).style.display = 'none';
  document.getElementById('csave-'+table+'-'+id).style.display = 'flex';
  document.getElementById('ccancel-'+table+'-'+id).style.display = 'flex';
  document.getElementById('cinput-'+table+'-'+id).focus();
}

function catalogCancelEdit(table, id) {
  const nameEl = document.getElementById('cname-'+table+'-'+id);
  document.getElementById('cinput-'+table+'-'+id).value = nameEl.textContent;
  nameEl.style.display = '';
  document.getElementById('cinput-'+table+'-'+id).style.display = 'none';
  document.getElementById('cedit-'+table+'-'+id).style.display = '';
  document.getElementById('csave-'+table+'-'+id).style.display = 'none';
  document.getElementById('ccancel-'+table+'-'+id).style.display = 'none';
}

function catalogKeydown(e, table, id) {
  if (e.key === 'Enter') catalogSave(table, id);
  if (e.key === 'Escape') catalogCancelEdit(table, id);
}

async function catalogSave(table, id) {
  const input = document.getElementById('cinput-'+table+'-'+id);
  const newName = input.value.trim();
  if (!newName) return;
  const r = await api('/lookup/'+table+'/'+id, {method:'PUT', body:JSON.stringify({name:newName})});
  if (r.error) { showToast('⚠️ '+r.error); return; }
  // Update name in UI without full reload
  document.getElementById('cname-'+table+'-'+id).textContent = newName;
  catalogCancelEdit(table, id);
  // Refresh autocomplete options
  await loadOptions();
  populateFilterSelects();
  showToast(t('toast.catalog_renamed'));
}

function catalogDelete(table, id, count) {
  if (count > 0) return;
  const name = document.getElementById('cname-'+table+'-'+id)?.textContent || '';
  showConfirm({
    icon: '🗑', title: t('confirm.catalog_delete.title'),
    msg: t('confirm.catalog_delete.msg', {name}),
    btnLabel: t('confirm.catalog_delete.btn'), btnClass: 'btn-danger',
    onConfirm: async () => {
      const r = await api('/lookup/'+table+'/'+id, {method:'DELETE'});
      if (r.error) { showToast('⚠️ '+r.error); return; }
      document.getElementById('crow-'+table+'-'+id).remove();
      await loadOptions(); populateFilterSelects();
      // Update section badge without full reload
      const rows = document.querySelectorAll(`#catbody-${table} .catalog-row`);
      const orphanCounts = document.querySelectorAll(`#catbody-${table} .catalog-count.zero`);
      const total = rows.length, orphans = orphanCounts.length;
      const badge = document.getElementById('cat-badge-'+table);
      if (badge) {
        badge.className = `catalog-badge${orphans?' has-orphans':''}`;
        const s2 = total !== 1 ? 's' : '';
        badge.textContent = t('catalog.entry_count', {count: total, s: s2}) + (orphans ? ' · ' + t('catalog.unused_count', {count: orphans}) : '');
      }
      const purgeEl = document.querySelector(`#catbody-${table} .catalog-purge`);
      if (!orphans && purgeEl) purgeEl.remove();
      else if (orphans && purgeEl) {
        const btn = purgeEl.querySelector('.btn-purge');
        if (btn) btn.textContent = `🧹 ${t('catalog.unused_count', {count: orphans})}`;
      }
      showToast(t('toast.catalog_entry_deleted'));
    }
  });
}

async function catalogPurge(table) {
  const r = await api('/lookup/'+table+'/purge', {method:'POST'});
  const s = r.deleted !== 1 ? 's' : '';
  showToast(t('toast.catalog_purged', {count: r.deleted, s}));
  await loadOptions();
  populateFilterSelects();
  await loadCatalog();
}

function purgeAll() {
  showConfirm({
    icon: '🧹', title: t('confirm.purge_all.title'),
    msg: t('confirm.purge_all.msg'),
    btnLabel: t('confirm.purge_all.btn'), btnClass: 'btn-danger',
    onConfirm: async () => {
      let total = 0;
      for (const tbl of LOOKUP_TABLES) {
        const r = await api('/lookup/'+tbl+'/purge', {method:'POST'});
        total += r.deleted || 0;
      }
      const s = total !== 1 ? 's' : '';
      showToast(t('toast.catalog_purged', {count: total, s}));
      await loadOptions(); populateFilterSelects();
      await loadCatalog();
    }
  });
}
