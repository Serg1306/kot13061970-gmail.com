/* Плашка cookie и Яндекс Метрика для статичных страниц (города, совместимость знаков и чисел).
   Тот же выбор и та же память, что на главной: localStorage «lvc.cookieOk» = "all" | "essential".
   Метрика загружается только после «Принять». Вебвизор выключен.
   Номер счётчика приходит с сервера (/api/config, metrikaId); пока его нет, ничего не загружается и плашки нет. */
(function () {
  'use strict';
  var KEY = 'lvc.cookieOk';
  function read() { try { var v = localStorage.getItem(KEY); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function write(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {} }

  function startMetrika(id) {
    if (window.__lvcYm) return; window.__lvcYm = 1;
    window.ym = window.ym || function () { (window.ym.a = window.ym.a || []).push(arguments); };
    window.ym.l = Date.now();
    var sc = document.createElement('script'); sc.async = true; sc.src = 'https://mc.yandex.ru/metrika/tag.js';
    document.head.appendChild(sc);
    window.ym(+id, 'init', { clickmap: true, trackLinks: true, accurateTrackBounce: true, webvisor: false });
  }

  function addStyle() {
    var s = document.createElement('style');
    s.textContent =
      '.lvc-ck{position:fixed;left:1rem;right:1rem;bottom:1rem;max-width:640px;margin:0 auto;z-index:2147483000;' +
      'background:var(--card,#2e0611);color:var(--ink,#f6e4e8);border:1.5px solid var(--line,#6b2238);border-radius:18px;' +
      'padding:.9rem 1rem;display:grid;gap:.6rem;box-shadow:0 10px 40px rgba(0,0,0,.35);font:400 .9rem/1.45 system-ui,sans-serif}' +
      '.lvc-ck a{color:var(--rose,#ff7aa6)}' +
      '.lvc-ck-b{display:flex;gap:.5rem;flex-wrap:wrap}' +
      '.lvc-ck button{font:600 .9rem system-ui,sans-serif;border-radius:999px;padding:.55rem 1.1rem;cursor:pointer;' +
      'border:1.5px solid var(--rose,#ff7aa6);background:transparent;color:var(--ink,#f6e4e8)}' +
      '.lvc-ck button:hover,.lvc-ck button:focus-visible{background:var(--rose,#ff7aa6);color:#24060f}';
    document.head.appendChild(s);
  }

  function banner(id) {
    addStyle();
    var n = document.createElement('div');
    n.className = 'lvc-ck'; n.setAttribute('role', 'region'); n.setAttribute('aria-label', 'Cookie');
    n.innerHTML =
      '<span>Мы используем cookie, чтобы сайт работал. С вашего разрешения включим Яндекс Метрику — статистику посещений. ' +
      'Подробнее — в <a href="/privacy.html#ru-10">политике конфиденциальности</a>.</span>' +
      '<span class="lvc-ck-b"><button type="button" data-ck="essential">Только нужные</button>' +
      '<button type="button" data-ck="all">Принять</button></span>';
    n.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-ck]') : null; if (!b) return;
      write(b.getAttribute('data-ck')); n.remove();
      if (b.getAttribute('data-ck') === 'all') startMetrika(id);
    });
    document.body.appendChild(n);
  }

  function init(cfg) {
    var id = String((cfg && cfg.metrikaId) || '');
    if (!/^\d+$/.test(id)) return;
    var ok = read();
    if (ok === 'all') startMetrika(id);
    else if (!ok) banner(id);
  }

  fetch('/api/config').then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; }).then(init);
})();
