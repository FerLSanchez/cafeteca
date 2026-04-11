// ---------------------------------------------------------------------------
// Formatting utilities
// ---------------------------------------------------------------------------
function stars(rating) {
  const r = parseInt(rating, 10);
  if (!r||r<1||r>5) return `<span style="color:var(--text3);font-size:13px">${t('status.unrated')}</span>`;
  return [1,2,3,4,5].map(i=>`<span class="star ${i<=r?'filled':''}">★</span>`).join('');
}

function fmtDate(d) {
  if (!d) return null;
  const [y,m,day] = d.split('-'); return `${day}/${m}/${y}`;
}

function fmtWeight(g) {
  if (!g) return '0g';
  return g >= 1000 ? (g / 1000).toFixed(1) + 'kg' : g + 'g';
}

function fmtPrice(c) {
  if (!c.price_kg||!c.quantity_g) return null;
  const total = (c.quantity_g / 1000 * c.price_kg).toFixed(2);
  const perCup = (c.price_kg * gramsPerShot / 1000).toFixed(2);
  return `${c.price_kg}€/kg · ${total}€ · ${perCup}€/taza`;
}

function getStatus(c) {
  if (c.finished_date) return {label:t('status.finished'),cls:'status-done'};
  if (c.opened_date)   return {label:t('status.open'),cls:'status-open'};
  return {label:t('status.unopened'),cls:''};
}

function daysFromRoast(roastDate) {
  if (!roastDate) return null;
  const roast = new Date(roastDate); roast.setHours(0,0,0,0);
  const today = new Date(); today.setHours(0,0,0,0);
  return Math.floor((today - roast) / 86400000);
}
