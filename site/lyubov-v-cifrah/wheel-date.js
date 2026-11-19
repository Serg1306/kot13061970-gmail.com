// Колёсики для даты рождения: день, месяц, год вместо стандартного календаря.
// Подключение: <script src="wheel-date.js" defer></script> перед </body>.
// Сами поля <input type="date"> остаются на странице (скрыты): код сайта читает и пишет их .value как раньше,
// колёсики при каждом выборе обновляют значение и посылают события input и change.
// Чтобы оставить у поля обычный календарь, добавьте ему атрибут data-no-wheel.
// На телефоне: колёсики крутятся пальцем, строки 44 px, значение выбирается, когда колесо остановилось.
// Если поле стоит внутри <label>, нажатие на колёсико не открывает календарь телефона.
// Внутри фотобудки на главной (.mx-booth) колёсики компактнее: видно 3 строки по 36 px вместо 5.
(() => {
  const ROW = 44;
  const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  const pad2 = n => String(n).padStart(2, '0');
  const daysIn = (y, m) => new Date(y, m, 0).getDate();
  const nativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');

  // Цвета — бордовая гамма сайта; при желании их можно переопределить переменными --wd-* у родителя.
  const css = `
.wd{--wd-bg:#1f040b;--wd-ink:#fff;--wd-muted:rgb(246 228 232 / .6);--wd-line:rgb(246 228 232 / .22);--wd-accent:#ff4f8b;--wd-rows:5;--wd-row:${ROW}px;
  display:flex;gap:.4rem;position:relative;user-select:none;-webkit-user-select:none;margin-top:.3rem;max-width:22rem;width:100%}
.wd.compact{--wd-rows:3;--wd-row:36px}
.wd.compact .wd-col li{font-size:1.05rem}
.wd.compact .wd-col li.on{font-size:1.2rem}
.wd-col{position:relative;flex:1 1 0;height:calc(var(--wd-row) * var(--wd-rows));overflow-y:auto;scroll-snap-type:y mandatory;scrollbar-width:none;overscroll-behavior:contain;
  touch-action:pan-y;-webkit-overflow-scrolling:touch;
  background:var(--wd-bg);border:1.5px solid var(--wd-line);border-radius:14px;outline:none;
  -webkit-mask-image:linear-gradient(transparent,#000 30%,#000 70%,transparent);mask-image:linear-gradient(transparent,#000 30%,#000 70%,transparent)}
.wd-col::-webkit-scrollbar{display:none}
.wd-col:focus-visible{border-color:var(--wd-accent)}
.wd-col.year{flex:1.4 1 0}
.wd-col ul{list-style:none;margin:0;padding:calc(var(--wd-row) * (var(--wd-rows) - 1) / 2) 0}
.wd-col li{height:var(--wd-row);line-height:var(--wd-row);text-align:center;scroll-snap-align:center;font:600 1.15rem/var(--wd-row) 'Golos Text',system-ui,sans-serif;color:var(--wd-muted);cursor:pointer}
.wd-col li small{font-weight:400;font-size:.75rem;margin-left:.25rem}
.wd-col li.on{color:var(--wd-ink);font-size:1.3rem}
.wd-col li.off{opacity:.3}
.wd::after{content:"";position:absolute;left:0;right:0;top:calc(var(--wd-row) * (var(--wd-rows) - 1) / 2);height:var(--wd-row);border-top:1.5px solid var(--wd-accent);border-bottom:1.5px solid var(--wd-accent);pointer-events:none;border-radius:2px;opacity:.7}
.wd.wd-empty li.on{color:var(--wd-muted)}
.wd-hidden{position:absolute!important;opacity:0!important;pointer-events:none!important;width:1px!important;height:1px!important;margin:0!important;padding:0!important;border:0!important}`;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  function wheelify(input) {
    if (input.dataset.wheel === '1') return;
    input.dataset.wheel = '1';
    const now = new Date();
    const minY = input.min ? +input.min.slice(0, 4) : 1930;
    const maxY = input.max ? +input.max.slice(0, 4) : now.getFullYear() - 18;
    const years = []; for (let y = minY; y <= maxY; y++) years.push(y);

    const wrap = document.createElement('div'); wrap.className = input.closest('.mx-booth') ? 'wd compact' : 'wd';
    // Поле внутри <label>: нажатие по колёсику иначе «нажимает» сам label, и телефон открывает свой календарь.
    wrap.addEventListener('click', e => e.preventDefault());
    // Высота строки из CSS (в фотобудке строки ниже)
    const rowH = () => D.ul.firstElementChild?.offsetHeight || ROW;
    const mk = (cls, label, items, fmt) => {
      const col = document.createElement('div'); col.className = 'wd-col ' + cls; col.tabIndex = 0;
      col.setAttribute('role', 'spinbutton'); col.setAttribute('aria-label', label);
      const ul = document.createElement('ul');
      items.forEach((v, i) => { const li = document.createElement('li'); li.innerHTML = fmt(v); li.dataset.i = i; ul.appendChild(li); });
      col.appendChild(ul); wrap.appendChild(col);
      return { col, ul, items, i: 0, label, fmt };
    };
    const D = mk('day', 'День', Array.from({ length: 31 }, (_, k) => k + 1), v => pad2(v));
    const M = mk('month', 'Месяц', Array.from({ length: 12 }, (_, k) => k + 1), v => `${pad2(v)}<small>${MONTHS[v - 1]}</small>`);
    const Y = mk('year', 'Год', years, v => String(v));
    const cols = [D, M, Y];

    // readOnly: телефон не открывает свой календарь; .value из кода сайта работает как раньше
    input.classList.add('wd-hidden'); input.tabIndex = -1; input.setAttribute('aria-hidden', 'true'); input.readOnly = true;
    input.addEventListener('click', e => e.preventDefault());
    input.insertAdjacentElement('afterend', wrap);

    let quiet = false, touched = false;
    const cur = () => ({ d: D.items[D.i], m: M.items[M.i], y: Y.items[Y.i] });

    function paint() {
      const { y, m } = cur(), max = daysIn(y, m);
      cols.forEach(c => c.ul.querySelectorAll('li').forEach((li, k) => {
        li.classList.toggle('on', k === c.i);
        li.classList.toggle('off', c === D && k + 1 > max);
      }));
      cols.forEach(c => { c.col.setAttribute('aria-valuenow', c.items[c.i]); c.col.setAttribute('aria-valuetext', c === M ? MONTHS[c.i] : String(c.items[c.i])); });
      wrap.classList.toggle('wd-empty', !nativeValue.get.call(input));
    }
    function scrollTo(c, i, smooth) {
      c.i = Math.max(0, Math.min(c.items.length - 1, i));
      c.h = c.col.clientHeight;
      quiet = true;
      c.col.scrollTo({ top: c.i * rowH(), behavior: smooth ? 'smooth' : 'auto' });
      setTimeout(() => { quiet = false; }, smooth ? 350 : 50);
    }
    function commit() {
      let { d, m, y } = cur();
      const max = daysIn(y, m);
      if (d > max) { d = max; scrollTo(D, max - 1, true); }
      const v = `${y}-${pad2(m)}-${pad2(d)}`;
      if (nativeValue.get.call(input) !== v) {
        nativeValue.set.call(input, v);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
      paint();
    }
    function show(v) {
      const ok = /^\d{4}-\d{2}-\d{2}$/.test(v || '');
      const y = ok ? +v.slice(0, 4) : Math.min(maxY, 1995), m = ok ? +v.slice(5, 7) : 6, d = ok ? +v.slice(8, 10) : 15;
      const yi = years.indexOf(y);
      scrollTo(D, d - 1); scrollTo(M, m - 1); scrollTo(Y, yi < 0 ? 0 : yi);
      paint();
    }

    cols.forEach(c => {
      // Значение выбираем, когда колесо остановилось: по событию scrollend, а где его нет — после паузы.
      // Пока палец на экране, ничего не выбираем.
      let t, finger = false;
      const settle = () => {
        if (quiet || finger || !c.col.clientHeight) return;
        if (c.h !== c.col.clientHeight) { scrollTo(c, c.i); return; }
        const i = Math.max(0, Math.min(c.items.length - 1, Math.round(c.col.scrollTop / rowH())));
        if (i === c.i) return;
        c.i = i; touched = true; commit();
      };
      c.col.addEventListener('touchstart', () => { finger = true; clearTimeout(t); }, { passive: true });
      c.col.addEventListener('touchend', () => { finger = false; clearTimeout(t); t = setTimeout(settle, 180); }, { passive: true });
      c.col.addEventListener('touchcancel', () => { finger = false; }, { passive: true });
      if ('onscrollend' in window) c.col.addEventListener('scrollend', () => { clearTimeout(t); settle(); });
      c.col.addEventListener('scroll', () => {
        if (quiet || !c.col.clientHeight) return;
        // Блок только что стал видимым (окно, вкладка): браузер сбросил прокрутку — ставим колесо на место, значение не трогаем
        if (c.h !== c.col.clientHeight) { scrollTo(c, c.i); return; }
        clearTimeout(t);
        t = setTimeout(settle, 180);
      }, { passive: true });
      c.ul.addEventListener('click', e => {
        const li = e.target.closest('li'); if (!li) return;
        scrollTo(c, +li.dataset.i, true); touched = true; commit();
      });
      c.col.addEventListener('keydown', e => {
        const step = { ArrowDown: 1, ArrowUp: -1, PageDown: 5, PageUp: -5 }[e.key];
        if (!step) return;
        e.preventDefault(); scrollTo(c, c.i + step, true); touched = true; commit();
      });
    });

    // Если код сайта сам меняет input.value (например, подставляет дату из анкеты) — колёсики следуют за ним.
    Object.defineProperty(input, 'value', {
      configurable: true,
      get() { return nativeValue.get.call(this); },
      set(v) { nativeValue.set.call(this, v); show(v); }
    });
    input.addEventListener('focus', () => D.col.focus());

    // Ширина колонок известна только после отрисовки
    show(nativeValue.get.call(input));
    requestAnimationFrame(() => cols.forEach(c => scrollTo(c, c.i)));
    // Колёсики в скрытом блоке (вкладка, окно, «Подробнее») получают позицию, когда блок становится видимым
    new ResizeObserver(() => { if (wrap.clientHeight) cols.forEach(c => scrollTo(c, c.i)); }).observe(wrap);
  }

  const run = root => root.querySelectorAll('input[type=date]:not([data-no-wheel])').forEach(wheelify);
  run(document);
  // Поля даты, которые появятся позже (окна, формы), тоже получат колёсики
  new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => {
    if (n.nodeType !== 1) return;
    if (n.matches?.('input[type=date]:not([data-no-wheel])')) wheelify(n); else run(n);
  }))).observe(document.documentElement, { childList: true, subtree: true });
})();
