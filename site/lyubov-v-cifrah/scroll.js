// Скролл-сцены главной (и черновых вариантов в redesign/). Без библиотек: CSP разрешает скрипты только со своего сервера.
//
// [data-scene]            высокая секция с липкой сценой внутри; получает --p (0…1) — прогресс прокрутки сцены
// [data-range="a b"]      внутри сцены: класс .on, пока a ≤ p ≤ b, и --q — прогресс внутри диапазона (0…1)
// canvas[data-frames]     покадровое видео: кадр = p; data-frames="frames/f%03d.webp", data-count, data-from/to — участок p,
//                         data-focus="x y" — точка кадра, которая остаётся в окне при обрезке (0…1)
// [data-anchor="x y"]     рядом с холстом: элемент ставится в точку кадра (доли ширины и высоты видео)
// [data-hscroll]          в сцене: дорожка .track едет по горизонтали, пока прокручивается сцена
// [data-reveal]           появление при входе в экран (класс .in), задержка по номеру среди соседей (--i)
// [data-count-to]         число набирается при появлении
// form[data-calc]         живой расчёт совместимости (compat.js)
(() => {
  const root = document.documentElement;
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  const setRM = () => root.classList.toggle('rm', still.matches);
  setRM();
  still.addEventListener?.('change', () => { setRM(); tick(); });

  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));

  /* ---------- покадровое видео ---------- */
  function frames(cv) {
    const n = +cv.dataset.count;
    const pattern = cv.dataset.frames;
    const src = i => pattern.replace('%03d', String(i + 1).padStart(3, '0'));
    const imgs = new Array(n);
    const ctx = cv.getContext('2d');
    let cur = -1;
    const load = i => {
      if (imgs[i]) return imgs[i];
      const im = new Image();
      im.decoding = 'async';
      im.src = src(i);
      im.onload = () => { if (Math.abs(i - want) < 3) draw(want, true); };
      return (imgs[i] = im);
    };
    let want = 0;
    const [fx, fy] = (cv.dataset.focus || '.5 .5').split(' ').map(Number);
    const anchors = [...(cv.closest('.stage, .mx-stage') || cv.parentElement).querySelectorAll('[data-anchor]')].map(el => ({ el, at: el.dataset.anchor.split(' ').map(Number) }));
    let placed = '';
    function place(x, y, w, h) {
      if (!anchors.length) return;
      const k = cv.clientWidth / cv.width;
      const key = [x, y, w, h, k].join();
      if (key === placed) return;
      placed = key;
      for (const a of anchors) {
        a.el.style.left = (cv.offsetLeft + (x + a.at[0] * w) * k) + 'px';
        a.el.style.top = (cv.offsetTop + (y + a.at[1] * h) * k) + 'px';
      }
    }
    function fit() {
      const r = cv.getBoundingClientRect();
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
      if (w && h && (cv.width !== w || cv.height !== h)) { cv.width = w; cv.height = h; cur = -1; }
    }
    function draw(i, force) {
      want = i;
      if (i === cur && !force) return;
      // ближайший загруженный кадр, чтобы не мигать при быстрой прокрутке
      let k = i, im = load(i);
      if (!im.complete || !im.naturalWidth) {
        for (let d = 1; d < n; d++) {
          const a = imgs[i - d], b = imgs[i + d];
          if (a && a.complete && a.naturalWidth) { im = a; k = i - d; break; }
          if (b && b.complete && b.naturalWidth) { im = b; k = i + d; break; }
        }
        if (!im.complete || !im.naturalWidth) return;
      }
      fit();
      const s = Math.max(cv.width / im.naturalWidth, cv.height / im.naturalHeight);
      const w = im.naturalWidth * s, h = im.naturalHeight * s;
      const x = (cv.width - w) * fx, y = (cv.height - h) * fy;
      ctx.drawImage(im, x, y, w, h);
      cur = k === i ? i : -1;
      place(x, y, w, h);
    }
    // первый кадр сразу, остальные — когда страница загрузится
    load(0);
    addEventListener('load', () => {
      let i = 0;
      const step = () => { for (let j = 0; j < 8 && i < n; j++, i++) load(i); if (i < n) setTimeout(step, 60); };
      step();
    });
    addEventListener('resize', () => { cur = -1; });
    const from = +(cv.dataset.from || 0), to = +(cv.dataset.to || 1);
    return p => draw(Math.round(clamp((p - from) / (to - from)) * (n - 1)));
  }

  /* ---------- сцены ---------- */
  const scenes = [...document.querySelectorAll('[data-scene]')].map(el => {
    const ranges = [...el.querySelectorAll('[data-range]')].map(r => {
      const [a, b] = r.dataset.range.split(' ').map(Number);
      return { r, a, b };
    });
    const players = [...el.querySelectorAll('canvas[data-frames]')].map(frames);
    const h = el.querySelector('[data-hscroll] .track, [data-hscroll] .mx-track') || (el.matches('[data-hscroll]') ? el.querySelector('.track, .mx-track') : null);
    return { el, ranges, players, h, last: -1 };
  });

  function update(s) {
    const r = s.el.getBoundingClientRect();
    const vh = innerHeight;
    const span = r.height - vh;
    const p = span > 0 ? clamp(-r.top / span) : clamp((vh - r.top) / (vh + r.height));
    if (r.bottom < -vh || r.top > vh * 2) return;
    if (Math.abs(p - s.last) < 0.0005) return;
    s.last = p;
    s.el.style.setProperty('--p', p.toFixed(4));
    for (const { r: el, a, b } of s.ranges) {
      el.classList.toggle('on', p >= a && p <= b);
      el.classList.toggle('past', p > b);
      el.style.setProperty('--q', clamp((p - a) / (b - a)).toFixed(4));
    }
    for (const play of s.players) play(p);
    if (s.h) {
      const extra = s.h.scrollWidth - s.h.parentElement.clientWidth;
      s.h.style.transform = `translate3d(${(-p * Math.max(0, extra)).toFixed(1)}px,0,0)`;
    }
  }

  let raf = 0;
  function tick() { raf = 0; for (const s of scenes) update(s); }
  const req = () => { if (!raf) raf = requestAnimationFrame(tick); };
  addEventListener('scroll', req, { passive: true });
  addEventListener('resize', () => { for (const s of scenes) s.last = -1; req(); });
  tick();

  /* ---------- появление ---------- */
  const groups = new Map();
  document.querySelectorAll('[data-reveal]').forEach(el => {
    const k = el.parentElement;
    const i = groups.get(k) || 0;
    groups.set(k, i + 1);
    el.style.setProperty('--i', i);
  });
  const countUp = el => {
    const to = +el.dataset.countTo;
    if (still.matches) { el.textContent = to; return; }
    const t0 = performance.now(), dur = 1400;
    const step = now => {
      const k = clamp((now - t0) / dur);
      el.textContent = Math.round(to * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(es => es.forEach(e => {
      if (!e.isIntersecting) return;
      if (e.target.matches('[data-reveal]')) e.target.classList.add('in');
      for (const c of e.target.children) if (c.matches('[data-reveal]')) c.classList.add('in');
      e.target.querySelectorAll('[data-count-to]').forEach(countUp);
      if (e.target.matches('[data-count-to]')) countUp(e.target);
      io.unobserve(e.target);
    }), { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    // следим за родителем: элемент в начальном положении может стоять за краем экрана
    const watched = new Set();
    document.querySelectorAll('[data-reveal]').forEach(el => {
      const box = el.parentElement;
      if (watched.has(box)) return;
      watched.add(box);
      io.observe(box);
    });
    document.querySelectorAll('[data-count-to]').forEach(el => io.observe(el));
  } else {
    document.querySelectorAll('[data-reveal]').forEach(el => el.classList.add('in'));
  }

  /* ---------- живой расчёт ---------- */
  document.querySelectorAll('form[data-calc]').forEach(f => {
    const [a, b] = f.querySelectorAll('input[type=date]');
    const out = f.querySelector('[data-out]');
    const why = f.querySelector('[data-why]');
    const run = () => {
      if (!window.LVC || !a.value || !b.value) return;
      const r = LVC.compat(a.value, b.value);
      out.textContent = r.total;
      if (why) why.textContent = `${LVC.verdictOf(r.total)}. Аркан пары: ${r.arc[0]}.`;
      f.style.setProperty('--res', r.total / 100);
      f.classList.remove('done'); void f.offsetWidth; f.classList.add('done');
    };
    a.addEventListener('change', run);
    b.addEventListener('change', run);
    f.addEventListener('submit', e => { e.preventDefault(); run(); });
    run();
  });
})();
