// Оживление нижних блоков главной при прокрутке (без библиотек, CSP 'self').
// [data-progress]  блок получает --p (0…1): 0 — верх блока у нижнего края окна, 1 — низ блока у верхнего края
// «Сейчас на сайте»  анкеты влетают по очереди, проценты набираются от нуля
// Фотобудка          при вспышке (--p ≈ .5) снимок печатается заново и процент набирается
// «Сегодня»          число перелистывается, как на табло, когда лист появляется
// При уменьшенном движении всё показывается сразу, без набора и перелистывания.
(() => {
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  const clamp = v => Math.min(1, Math.max(0, v));
  const count = (el, to, suffix = '', dur = 1100) => {
    if (still.matches) { el.textContent = to + suffix; return; }
    const t0 = performance.now();
    const step = now => {
      const k = clamp((now - t0) / dur);
      el.textContent = Math.round(to * (1 - Math.pow(1 - k, 3))) + suffix;
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  /* ---------- прогресс блоков ---------- */
  const blocks = [...document.querySelectorAll('[data-progress]')].map(el => ({ el, last: -1, hooks: [] }));
  const at = sel => blocks.find(b => b.el.matches(sel));
  function update() {
    raf = 0;
    const vh = innerHeight;
    for (const b of blocks) {
      const r = b.el.getBoundingClientRect();
      if (r.bottom < -vh || r.top > vh * 2) continue;
      const p = clamp((vh - r.top) / (vh + r.height));
      if (Math.abs(p - b.last) < .0005) continue;
      b.last = p;
      b.el.style.setProperty('--p', p.toFixed(4));
      for (const h of b.hooks) h(p);
    }
  }
  let raf = 0;
  const req = () => { if (!raf) raf = requestAnimationFrame(update); };
  addEventListener('scroll', req, { passive: true });
  addEventListener('resize', () => { blocks.forEach(b => (b.last = -1)); req(); });

  /* ---------- фотобудка: вспышка печатает снимок ---------- */
  const booth = at('.mx-booth');
  if (booth) {
    const form = booth.el.querySelector('form[data-calc]'), out = form && form.querySelector('[data-out]');
    let fired = false;
    booth.hooks.push(p => {
      if (fired || p < .5 || !out) return;
      fired = true;
      form.classList.remove('done'); void form.offsetWidth; form.classList.add('done');
      count(out, parseInt(out.textContent, 10) || 0);
    });
  }

  /* ---------- «Сегодня»: число перелистывается ---------- */
  const today = document.querySelector('.mx-today');
  const day = document.getElementById('mxTD');
  if (today && day && 'IntersectionObserver' in window) {
    new IntersectionObserver((es, io) => es.forEach(e => {
      if (!e.isIntersecting) return;
      io.disconnect();
      if (still.matches) return;
      const real = day.textContent, t0 = performance.now();
      const step = now => {
        const k = (now - t0) / 900;
        if (k >= 1) { day.textContent = real; day.classList.remove('flip'); return; }
        day.textContent = String(1 + Math.floor(Math.random() * 31)).padStart(2, '0');
        day.classList.remove('flip'); void day.offsetWidth; day.classList.add('flip');
        setTimeout(() => requestAnimationFrame(step), 60 + k * 140);
      };
      requestAnimationFrame(step);
    }), { threshold: .35 }).observe(today);
  }

  /* ---------- «Сейчас на сайте»: анкеты влетают, проценты набираются ---------- */
  const show = document.querySelector('.t-show');
  const track = document.getElementById('track');
  if (show && track && 'IntersectionObserver' in window) {
    show.classList.add('wave');
    const play = () => {
      track.querySelectorAll('.slide').forEach((s, i) => {
        s.style.setProperty('--n', i);
        const pct = s.querySelector('.pct');
        if (pct && !pct.dataset.done) { pct.dataset.done = 1; setTimeout(() => count(pct, parseInt(pct.textContent, 10) || 0, '%'), Math.min(i * 70, 700) + 200); }
      });
    };
    new IntersectionObserver((es, io) => es.forEach(e => {
      if (!e.isIntersecting) return;
      io.disconnect();
      play();
      show.classList.add('in');
    }), { threshold: .25 }).observe(show);
  }

  req();
})();
