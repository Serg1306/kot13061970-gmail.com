/* Переключатель RU/EN и тема для юридических страниц.
   Язык хранится так же, как на главной: localStorage['lvc.lang'] = JSON.stringify('ru' | 'en').
   Тема: localStorage['lvc.theme'] = JSON.stringify('dark' | 'light'), если пользователь выбрал её на сайте. */
(function () {
  var root = document.documentElement;
  function read(key) { try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; } }
  function write(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) {} }

  var theme = read('lvc.theme');
  if (theme === 'dark' || theme === 'light') root.setAttribute('data-theme', theme);

  var param = null;
  try { param = new URLSearchParams(location.search).get('lang'); } catch (e) {}
  var lang = (param === 'en' || param === 'ru') ? param : (read('lvc.lang') === 'en' ? 'en' : 'ru');

  function apply(l) {
    lang = l;
    root.lang = l;
    var blocks = document.querySelectorAll('[data-lang-block]');
    for (var i = 0; i < blocks.length; i++) blocks[i].hidden = blocks[i].getAttribute('data-lang-block') !== l;
    var t = root.getAttribute('data-title-' + l);
    if (t) document.title = t;
    var btn = document.getElementById('langBtn');
    if (btn) {
      btn.textContent = l === 'en' ? 'RU' : 'EN';
      var label = l === 'en' ? 'Читать по-русски' : 'Read in English';
      btn.setAttribute('aria-label', label);
      btn.title = label;
    }
  }
  apply(lang);
  var btn = document.getElementById('langBtn');
  if (btn) btn.addEventListener('click', function () {
    var next = lang === 'en' ? 'ru' : 'en';
    write('lvc.lang', next);
    apply(next);
    window.scrollTo(0, 0);
  });
})();
