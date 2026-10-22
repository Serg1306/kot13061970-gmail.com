// Глобус в круге «Анкеты по городам»: сетка, точки городов и дуги от выбранного города к остальным.
// Вращается при прокрутке; выбранный город (кнопка с aria-pressed="true" в #homeCities) поворачивается к зрителю.
// При уменьшенном движении глобус стоит неподвижно и сразу повёрнут к городу.
(() => {
  const cv = document.getElementById('cityGlobe');
  if (!cv) return;
  const box = cv.closest('.t-list');
  box.classList.add('wave');
  const ctx = cv.getContext('2d');
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  // широта, долгота
  const AT = {
    'Москва': [55.75, 37.62], 'Санкт-Петербург': [59.94, 30.31], 'Новосибирск': [55.03, 82.92], 'Екатеринбург': [56.84, 60.6],
    'Казань': [55.79, 49.12], 'Нижний Новгород': [56.33, 44], 'Краснодар': [45.04, 38.98], 'Самара': [53.2, 50.15],
    'Ростов-на-Дону': [47.24, 39.7], 'Воронеж': [51.67, 39.18], 'Минск': [53.9, 27.56], 'Алматы': [43.24, 76.95],
    'Ташкент': [41.3, 69.24], 'Тбилиси': [41.72, 44.78], 'Ереван': [40.18, 44.51], 'Берлин': [52.52, 13.4],
    'Париж': [48.86, 2.35], 'Лондон': [51.51, -0.13], 'Нью-Йорк': [40.71, -74.01], 'Дубай': [25.2, 55.27],
    'Стамбул': [41.01, 28.98], 'Прага': [50.08, 14.44], 'Барселона': [41.39, 2.17], 'Рим': [41.9, 12.5]
  };
  const rad = Math.PI / 180;
  let cities = [], active = '', label = '';
  let lon = 40, lat = 35, goalLon = 40, goalLat = 35, prog = 0, shown = 0, raf = 0;

  function read() {
    const chips = [...document.querySelectorAll('#homeCities [data-city]')];
    cities = chips.map(b => b.dataset.city).filter(c => AT[c]);
    const on = chips.find(b => b.getAttribute('aria-pressed') === 'true');
    active = on && AT[on.dataset.city] ? on.dataset.city : '';
    label = active ? on.firstChild.textContent.trim() : '';
    const [la, lo] = AT[active] || AT['Москва'];
    goalLat = Math.max(-10, Math.min(55, la - 10)); goalLon = lo;
    if (still.matches) { lat = goalLat; lon = goalLon; }
    shown = 0;
    req();
  }

  // точка на сфере → экран; z > 0 — лицевая сторона
  function proj(la, lo, r, cx, cy, rotLon) {
    const φ = la * rad, λ = (lo - rotLon) * rad, φ0 = lat * rad;
    const x = Math.cos(φ) * Math.sin(λ);
    const y = Math.cos(φ0) * Math.sin(φ) - Math.sin(φ0) * Math.cos(φ) * Math.cos(λ);
    const z = Math.sin(φ0) * Math.sin(φ) + Math.cos(φ0) * Math.cos(φ) * Math.cos(λ);
    return [cx + x * r, cy - y * r, z];
  }
  // точки большого круга между двумя городами, с подъёмом над поверхностью
  function arc(a, b, n) {
    const v = ([la, lo]) => [Math.cos(la * rad) * Math.cos(lo * rad), Math.cos(la * rad) * Math.sin(lo * rad), Math.sin(la * rad)];
    const A = v(a), B = v(b);
    const d = Math.acos(Math.min(1, A[0] * B[0] + A[1] * B[1] + A[2] * B[2])) || 1e-6;
    const out = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, s1 = Math.sin((1 - t) * d) / Math.sin(d), s2 = Math.sin(t * d) / Math.sin(d);
      const p = [s1 * A[0] + s2 * B[0], s1 * A[1] + s2 * B[1], s1 * A[2] + s2 * B[2]];
      const lift = 1 + Math.sin(Math.PI * t) * d * .18;
      out.push([Math.asin(p[2]) / rad, Math.atan2(p[1], p[0]) / rad, lift]);
    }
    return out;
  }

  function draw() {
    raf = 0;
    const dpr = Math.min(devicePixelRatio || 1, 2), W = cv.clientWidth;
    if (!W) return;
    if (cv.width !== Math.round(W * dpr)) { cv.width = cv.height = Math.round(W * dpr); }
    const S = cv.width, cx = S / 2, cy = S / 2, r = S * .47;
    // плавно догоняем цель; прокрутка докручивает глобус
    const spin = still.matches ? 0 : (prog - .5) * 70;
    lon += (goalLon - lon) * (still.matches ? 1 : .08);
    lat += (goalLat - lat) * (still.matches ? 1 : .08);
    shown = Math.min(1, shown + (still.matches ? 1 : .025));
    const rl = lon + spin;
    ctx.clearRect(0, 0, S, S);
    // шар
    const g = ctx.createRadialGradient(cx - r * .35, cy - r * .4, r * .1, cx, cy, r * 1.05);
    g.addColorStop(0, '#7a1430'); g.addColorStop(1, '#1f040b');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(246,228,232,.35)'; ctx.lineWidth = S / 400; ctx.stroke();
    // сетка
    ctx.strokeStyle = 'rgba(246,228,232,.13)'; ctx.lineWidth = S / 600;
    const line = pts => { ctx.beginPath(); let on = false; for (const [la, lo] of pts) { const [x, y, z] = proj(la, lo, r, cx, cy, rl); if (z > 0) { on ? ctx.lineTo(x, y) : ctx.moveTo(x, y); on = true; } else on = false; } ctx.stroke(); };
    for (let la = -60; la <= 60; la += 30) line(Array.from({ length: 73 }, (_, i) => [la, i * 5 - 180]));
    for (let lo = -180; lo < 180; lo += 30) line(Array.from({ length: 37 }, (_, i) => [i * 5 - 90, lo]));
    // дуги от выбранного города (или от Москвы) к остальным
    const from = AT[active] || AT['Москва'];
    const targets = cities.filter(c => c !== (active || 'Москва')).slice(0, 14);
    targets.forEach((c, k) => {
      const part = Math.max(0, Math.min(1, shown * 1.6 - k * .07));
      if (!part) return;
      const pts = arc(from, AT[c], 40), n = Math.round(pts.length * part);
      ctx.beginPath(); let on = false;
      for (let i = 0; i < n; i++) {
        const [la, lo, lift] = pts[i], [x, y, z] = proj(la, lo, r * lift, cx, cy, rl);
        if (z > -.15) { on ? ctx.lineTo(x, y) : ctx.moveTo(x, y); on = true; } else on = false;
      }
      const lg = ctx.createLinearGradient(cx - r, cy, cx + r, cy);
      lg.addColorStop(0, '#ff6fa0'); lg.addColorStop(1, '#7c9cff');
      ctx.strokeStyle = lg; ctx.lineWidth = S / 160; ctx.shadowColor = '#ff4f8b'; ctx.shadowBlur = S / 60; ctx.stroke(); ctx.shadowBlur = 0;
    });
    // города
    for (const c of cities) {
      const [x, y, z] = proj(...AT[c], r, cx, cy, rl);
      if (z <= 0) continue;
      const me = c === active;
      ctx.fillStyle = me ? '#ff4f8b' : 'rgba(246,228,232,' + (.45 + z * .5).toFixed(2) + ')';
      ctx.shadowColor = me ? '#ff4f8b' : 'transparent'; ctx.shadowBlur = me ? S / 30 : 0;
      ctx.beginPath(); ctx.arc(x, y, (me ? S / 55 : S / 110) * (.6 + z * .4), 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      if (me && label) {
        ctx.font = `600 ${Math.round(S / 22)}px "Golos Text", system-ui, sans-serif`;
        ctx.fillStyle = '#f6e4e8'; ctx.textAlign = 'center';
        ctx.fillText(label, x, y - S / 28);
      }
    }
    if (!still.matches && (Math.abs(goalLon - lon) > .05 || Math.abs(goalLat - lat) > .05 || shown < 1)) req();
  }
  const req = () => { if (!raf) raf = requestAnimationFrame(draw); };

  addEventListener('scroll', () => {
    const b = box.getBoundingClientRect();
    if (b.bottom < 0 || b.top > innerHeight) return;
    prog = Math.min(1, Math.max(0, (innerHeight - b.top) / (innerHeight + b.height)));
    req();
  }, { passive: true });
  addEventListener('resize', req);
  new MutationObserver(read).observe(document.getElementById('homeCities'), { childList: true, subtree: true, characterData: true });
  if ('IntersectionObserver' in window) new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { box.classList.add('in'); shown = 0; req(); } }), { threshold: .2 }).observe(box);
  read();
})();
