export function stars(rating) {
  const r = parseInt(rating, 10);
  if (!r||r<1||r>5) return '<span style="color:var(--text3);font-size:13px">Sin valorar</span>';
  return [1,2,3,4,5].map(i=>`<span class="star ${i<=r?'filled':''}">★</span>`).join('');
}

export function setRating(val) {
  document.getElementById('f-rating').value = val;
  document.querySelectorAll('.rating-star').forEach(s=>s.classList.toggle('active', parseInt(s.dataset.val)<=val));
}
