// Глобус в круге «Анкеты по городам»: Земля из космоса (карта, облака, атмосфера), точки городов и дуги от выбранного города к остальным.
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
  // карта Земли (равнопромежуточная, по данным Natural Earth) и облака — media/earth*.webp
  const off = document.createElement('canvas');
  let tex = null, clouds = null;
  const load = (src, done) => { const im = new Image(); im.decoding = 'async'; im.onload = () => {
    const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
    const x = c.getContext('2d'); x.drawImage(im, 0, 0);
    done({ w: im.width, h: im.height, d: x.getImageData(0, 0, im.width, im.height).data }); req();
  }; im.src = src; };
  let loaded = false;
  const loadAll = () => { if (loaded) return; loaded = true; load('media/earth.webp', t => (tex = t)); load('media/earth-clouds.webp', t => (clouds = t)); };
  let cities = [], active = '', label = '';
  let lon = 40, lat = 22, goalLon = 40, goalLat = 22, prog = 0, shown = 0, raf = 0;

  function read() {
    const chips = [...document.querySelectorAll('#homeCities [data-city]')];
    cities = chips.map(b => b.dataset.city).filter(c => AT[c]);
    const on = chips.find(b => b.getAttribute('aria-pressed') === 'true');
    active = on && AT[on.dataset.city] ? on.dataset.city : '';
    label = active ? on.firstChild.textContent.trim() : '';
    const [la, lo] = AT[active] || AT['Москва'];
    goalLat = Math.max(-10, Math.min(22, la - 22)); goalLon = lo;
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
    const S = cv.width, cx = S / 2, cy = S / 2, r = S * .42;
    // плавно догоняем цель; прокрутка докручивает глобус
    const spin = still.matches ? 0 : (prog - .5) * 70;
    lon += (goalLon - lon) * (still.matches ? 1 : .08);
    lat += (goalLat - lat) * (still.matches ? 1 : .08);
    shown = Math.min(1, shown + (still.matches ? 1 : .025));
    const rl = lon + spin;
    ctx.clearRect(0, 0, S, S);
    // космос: тёмный круг и звёзды
    ctx.fillStyle = '#03060f'; ctx.fillRect(0, 0, S, S);
    for (let k = 0; k < 90; k++) {
      const a = Math.sin(k * 12.9898) * 43758.5453, b = Math.sin(k * 78.233) * 12543.123;
      const sx = (a - Math.floor(a)) * S, sy = (b - Math.floor(b)) * S, br = .3 + ((a * 7) - Math.floor(a * 7)) * .7;
      ctx.fillStyle = `rgba(255,255,255,${(br * .8).toFixed(2)})`; ctx.fillRect(sx, sy, S / 400 * (1 + br), S / 400 * (1 + br));
    }
    // сияние атмосферы
    const halo = ctx.createRadialGradient(cx, cy, r * .96, cx, cy, r * 1.16);
    halo.addColorStop(0, 'rgba(120,190,255,.55)'); halo.addColorStop(.35, 'rgba(80,150,255,.18)'); halo.addColorStop(1, 'rgba(80,150,255,0)');
    ctx.fillStyle = halo; ctx.fillRect(0, 0, S, S);
    // сама Земля: каждая точка шара берёт цвет из карты, свет падает слева сверху
    if (tex) {
      const N = Math.min(420, Math.round(r * 2)), img = ctx.createImageData(N, N), px = img.data;
      const φ0 = lat * rad, s0 = Math.sin(φ0), c0 = Math.cos(φ0), drift = still.matches ? 0 : prog * 50;
      for (let j = 0; j < N; j++) {
        const y = 1 - (j + .5) / N * 2;
        for (let i = 0; i < N; i++) {
          const x = (i + .5) / N * 2 - 1, q = x * x + y * y;
          if (q > 1) continue;
          const z = Math.sqrt(1 - q);
          const la = Math.asin(y * c0 + z * s0), lo = rl * rad + Math.atan2(x, z * c0 - y * s0);
          const u = ((lo / (2 * Math.PI) + .5) % 1 + 1) % 1, v = .5 - la / Math.PI;
          const ti = ((v * tex.h | 0) * tex.w + (u * tex.w | 0)) * 4;
          const cu = ((u + drift / 360) % 1 + 1) % 1, ci = ((v * tex.h | 0) * tex.w + (cu * tex.w | 0)) * 4;
          const cl = clouds ? clouds.d[ci] / 255 * .85 : 0;
          const light = Math.max(0, -.45 * x + .55 * y + .7 * z), sh = .28 + .82 * light, rim = Math.pow(1 - z, 3);
          const o = (j * N + i) * 4;
          px[o] = Math.min(255, (tex.d[ti] * (1 - cl) + 245 * cl) * sh + rim * 70);
          px[o + 1] = Math.min(255, (tex.d[ti + 1] * (1 - cl) + 248 * cl) * sh + rim * 120);
          px[o + 2] = Math.min(255, (tex.d[ti + 2] * (1 - cl) + 255 * cl) * sh + rim * 200);
          px[o + 3] = q > .985 ? 255 * (1 - q) / .015 : 255;
        }
      }
      off.width = off.height = N; off.getContext('2d').putImageData(img, 0, 0);
      ctx.drawImage(off, cx - r, cy - r, r * 2, r * 2);
    } else {
      ctx.fillStyle = '#123f86'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    }
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
      lg.addColorStop(0, '#ff6fa0'); lg.addColorStop(1, '#ffd36e');
      ctx.strokeStyle = lg; ctx.lineWidth = S / 160; ctx.shadowColor = '#ff4f8b'; ctx.shadowBlur = S / 60; ctx.stroke(); ctx.shadowBlur = 0;
    });
    // города
    for (const c of cities) {
      const [x, y, z] = proj(...AT[c], r, cx, cy, rl);
      if (z <= 0) continue;
      const me = c === active;
      ctx.fillStyle = me ? '#ff4f8b' : 'rgba(255,214,120,' + (.6 + z * .4).toFixed(2) + ')';
      ctx.shadowColor = me ? '#ff4f8b' : '#ffcf6a'; ctx.shadowBlur = me ? S / 30 : S / 90;
      ctx.beginPath(); ctx.arc(x, y, (me ? S / 55 : S / 110) * (.6 + z * .4), 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      if (me && label) {
        ctx.font = `600 ${Math.round(S / 22)}px "Golos Text", system-ui, sans-serif`;
        ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.shadowColor = 'rgba(0,0,0,.8)'; ctx.shadowBlur = S / 80;
        ctx.fillText(label, x, y - S / 28);
        ctx.shadowBlur = 0;
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
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { loadAll(); box.classList.add('in'); shown = 0; req(); } }), { threshold: .2 }).observe(box);
    new IntersectionObserver(es => es.forEach(e => e.isIntersecting && loadAll()), { rootMargin: '600px 0px' }).observe(box);
  } else loadAll();
  read();
})();
