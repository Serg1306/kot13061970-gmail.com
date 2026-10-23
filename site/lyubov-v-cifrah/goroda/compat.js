/* Калькулятор совместимости для страниц городов. СГЕНЕРИРОВАНО tools/make_city_pages.py.
   Функции расчёта скопированы дословно из index.html — не правьте их здесь, правьте index.html и перезапустите генератор. */
(() => {
  /* ---------- расчёты по дате ---------- */
  const parse = s => { const [y, m, d] = s.split('-').map(Number); return { y, m, d }; };
  const digitSum = n => String(n).split('').reduce((a, c) => a + +c, 0);
  function lifePath({ y, m, d }) {
    let n = digitSum(`${d}${m}${y}`);
    while (n > 9 && n !== 11 && n !== 22) n = digitSum(n);
    return n;
  }
  const SIGNS = [
    ['Козерог', 'земля', '♑', 1, 19], ['Водолей', 'воздух', '♒', 2, 18], ['Рыбы', 'вода', '♓', 3, 20],
    ['Овен', 'огонь', '♈', 4, 19], ['Телец', 'земля', '♉', 5, 20], ['Близнецы', 'воздух', '♊', 6, 20],
    ['Рак', 'вода', '♋', 7, 22], ['Лев', 'огонь', '♌', 8, 22], ['Дева', 'земля', '♍', 9, 22],
    ['Весы', 'воздух', '♎', 10, 22], ['Скорпион', 'вода', '♏', 11, 21], ['Стрелец', 'огонь', '♐', 12, 21]
  ];
  // индекс знака по кругу: Козерог=0 … Стрелец=11
  function zodiac({ m, d }) {
    let i = m - 1;
    if (d > SIGNS[m - 1][4]) i = m % 12;
    return { i, name: SIGNS[i][0], el: SIGNS[i][1], glyph: SIGNS[i][2] };
  }
  const ANIMALS = ['Крыса', 'Бык', 'Тигр', 'Кролик', 'Дракон', 'Змея', 'Лошадь', 'Коза', 'Обезьяна', 'Петух', 'Собака', 'Свинья'];
  // упрощение: восточный Новый год считаем 5 февраля
  function eastern({ y, m, d }) {
    const yy = (m < 2 || (m === 2 && d < 5)) ? y - 1 : y;
    const i = ((yy - 1900) % 12 + 12) % 12;
    return { i, name: ANIMALS[i] };
  }
  const arcanum = ({ d }) => d > 22 ? d - 22 : d;
  const ARCANA = {
    1: ['Маг', 'Пара инициатив: вместе легко начинать новое.', 80], 2: ['Жрица', 'Глубокое понимание без слов, важно доверие.', 82],
    3: ['Императрица', 'Тепло, забота, желание строить дом.', 92], 4: ['Император', 'Надёжная пара с ясными ролями и планами.', 78],
    5: ['Иерофант', 'Общие ценности и традиции, союз «на века».', 85], 6: ['Влюблённые', 'Сильное притяжение и выбор друг друга каждый день.', 96],
    7: ['Колесница', 'Пара в движении: путешествия, цели, азарт.', 80], 8: ['Справедливость', 'Честность и равноправие, нужно договариваться.', 72],
    9: ['Отшельник', 'Тихий союз двух глубоких людей.', 65], 10: ['Колесо фортуны', 'Яркие перемены, судьбоносная встреча.', 84],
    11: ['Сила', 'Страсть и сильные характеры, важно уступать.', 76], 12: ['Повешенный', 'Отношения учат терпению и смене взгляда.', 55],
    13: ['Перемены', 'Встреча, после которой многое меняется.', 62], 14: ['Умеренность', 'Гармония и спокойный ритм.', 90],
    15: ['Дьявол', 'Очень сильное влечение, следите за ревностью.', 68], 16: ['Башня', 'Бурный старт, нужно строить фундамент.', 50],
    17: ['Звезда', 'Вдохновляете друг друга, общие мечты.', 93], 18: ['Луна', 'Романтика и интуиция, нужна открытость.', 64],
    19: ['Солнце', 'Радость, лёгкость, много общих друзей.', 98], 20: ['Суд', 'Связь с семьёй и прошлым, второй шанс.', 74],
    21: ['Мир', 'Цельная пара, вам хорошо где угодно вместе.', 95], 22: ['Шут', 'Свобода и спонтанность, без рутины.', 70]
  };

  function scoreNumerology(a, b) {
    const fam = n => (n === 11 ? 2 : n === 22 ? 4 : n);
    const x = fam(a), y = fam(b);
    const g = n => [1, 5, 7].includes(n) ? 0 : [2, 4, 8].includes(n) ? 1 : 2;
    if (a === b) return [88, `Одинаковое число ${a}: вы смотрите на мир похоже.`];
    if (g(x) === g(y)) return [94, `Числа ${a} и ${b} из одной семьи, ритм жизни совпадает.`];
    const friendly = { 0: 2, 1: 2, 2: 1 }; // 1-5-7 ↔ 3-6-9, 2-4-8 ↔ 3-6-9
    if (friendly[g(x)] === g(y) || friendly[g(y)] === g(x)) return [72, `Числа ${a} и ${b} дополняют друг друга.`];
    return [52, `Числа ${a} и ${b} разные по темпу, нужно больше разговаривать.`];
  }
  function scoreZodiac(a, b) {
    const diff = Math.abs(a.i - b.i);
    if (a.i === b.i) return [80, `Оба ${a.name}: хорошо понимаете друг друга, но можете скучать.`];
    if (diff === 6) return [78, `${a.name} и ${b.name} напротив друг друга: притяжение противоположностей.`];
    if (a.el === b.el) return [92, `Одна стихия (${a.el}): общий темперамент.`];
    const pair = new Set([a.el, b.el]);
    if ((pair.has('огонь') && pair.has('воздух')) || (pair.has('земля') && pair.has('вода')))
      return [86, `${cap(a.el)} и ${b.el} усиливают друг друга.`];
    return [54, `${cap(a.el)} и ${b.el}: разный темперамент, интересно, но непросто.`];
  }
  function scoreEastern(a, b) {
    const d = Math.abs(a.i - b.i);
    if (d === 6) return [35, `${a.name} и ${b.name} стоят напротив в круге: частые споры.`];
    if (a.i % 4 === b.i % 4 && a.i !== b.i) return [95, `${a.name} и ${b.name} в одном треугольнике союзников.`];
    if (a.i === b.i) return [75, `Оба ${a.name}: похожие привычки.`];
    if ((a.i + b.i) % 12 === 1) return [88, `${a.name} и ${b.name}: тайные друзья по восточному кругу.`];
    return [64, `${a.name} и ${b.name}: нейтральное сочетание.`];
  }
  const cap = s => s[0].toUpperCase() + s.slice(1);

  function compat(s1, s2) {
    const p1 = parse(s1), p2 = parse(s2);
    const n = scoreNumerology(lifePath(p1), lifePath(p2));
    const z = scoreZodiac(zodiac(p1), zodiac(p2));
    const e = scoreEastern(eastern(p1), eastern(p2));
    let pa = arcanum(p1) + arcanum(p2); if (pa > 22) pa -= 22;
    const ar = ARCANA[pa];
    const parts = [
      { key: 'num', t: 'Число судьбы', w: .30, v: n[0], why: n[1], c: 'var(--rose)' },
      { key: 'zod', t: 'Знак и стихия', w: .25, v: z[0], why: z[1], c: 'var(--sun)' },
      { key: 'east', t: 'Восточный год', w: .25, v: e[0], why: e[1], c: 'var(--sea)' },
      { key: 'arc', t: 'Аркан пары', w: .20, v: ar[2], why: `${pa}, ${ar[0]}: ${ar[1]}`, c: 'var(--plum)' }
    ];
    const total = Math.round(parts.reduce((a, p) => a + p.v * p.w, 0));
    return { total, parts, pairArcanum: pa, arc: ar };
  }
  const verdictOf = t => t >= 85 ? 'Редкое совпадение, пишите первыми' : t >= 72 ? 'Хорошая пара, есть о чём поговорить' : t >= 60 ? 'Можно попробовать' : 'Разные ритмы, но всё решает встреча';

  /* ---------- виджет на странице города ---------- */
  const okDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && +s.slice(0, 4) > 1900;
  const R = 84, C = 2 * Math.PI * R, GAP = 6;
  function ring(svg, res) {
    let start = 0, out = '';
    res.parts.forEach(p => {
      const seg = p.w * C - GAP, fill = Math.max(seg * p.v / 100, 0.01);
      out += `<circle cx="100" cy="100" r="${R}" fill="none" stroke="var(--line)" stroke-width="14" stroke-linecap="round" stroke-dasharray="${seg} ${C}" stroke-dashoffset="${-start}"/>`;
      out += `<circle cx="100" cy="100" r="${R}" fill="none" stroke="${p.c}" stroke-width="14" stroke-linecap="round" stroke-dasharray="${fill} ${C}" stroke-dashoffset="${-start}"/>`;
      start += p.w * C;
    });
    svg.innerHTML = out;
  }
  function initCalc(box) {
    const d1 = box.querySelector('[name="d1"]'), d2 = box.querySelector('[name="d2"]');
    const pct = box.querySelector('[data-pct]'), verdict = box.querySelector('[data-verdict]');
    const list = box.querySelector('[data-parts]'), svg = box.querySelector('svg');
    function run() {
      if (!okDate(d1.value) || !okDate(d2.value)) { pct.textContent = '—'; verdict.textContent = 'Укажите обе даты'; list.innerHTML = ''; svg.innerHTML = ''; return; }
      const res = compat(d1.value, d2.value);
      pct.textContent = res.total + '%';
      verdict.textContent = verdictOf(res.total);
      ring(svg, res);
      list.innerHTML = '';
      res.parts.forEach(p => {
        const li = document.createElement('li');
        li.style.setProperty('--c', p.c);
        const head = document.createElement('div'); head.className = 'ph';
        const t = document.createElement('b'); t.textContent = p.t;
        const v = document.createElement('span'); v.textContent = p.v + '% · вес ' + Math.round(p.w * 100) + '%';
        head.append(t, v);
        const why = document.createElement('p'); why.textContent = p.why;
        li.append(head, why);
        list.append(li);
      });
    }
    d1.addEventListener('input', run); d2.addEventListener('input', run);
    run();
  }
  if (typeof document !== 'undefined') document.querySelectorAll('[data-calc]').forEach(initCalc);
  if (typeof module !== 'undefined' && module.exports) module.exports = { compat, lifePath, zodiac, eastern, arcanum, scoreNumerology, scoreZodiac, scoreEastern, verdictOf };
  else if (typeof window !== 'undefined') window.LVC = { compat, verdictOf };
})();
