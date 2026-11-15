// Расчёт совместимости по датам рождения — копия блока «расчёты по дате» из index.html.
// Процент берётся из таблицы compat-table.js. При изменении формулы в index.html обновите и этот файл.
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

  // Процент пары берётся только из таблицы compat-table.js (её можно править без программиста).
  // Знак, восточный год и аркан показываются как подробности и на процент не влияют.
  const TABLE = globalThis.LVC_TABLE || { numbers: {}, pairs: {}, levels: [] };
  const pctOf = v => Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
  function scoreNumerology(a, b) {
    const row = TABLE.pairs[`${Math.min(a, b)}-${Math.max(a, b)}`] || [50, ''];
    return [pctOf(row[0]), String(row[1] || '')];
  }
  const levelOf = t => TABLE.levels.find(l => t >= l.min) || TABLE.levels[TABLE.levels.length - 1] || { title: '', text: '' };
  const numberInfo = n => TABLE.numbers[n] || { name: '', about: '' };
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
    const p1 = parse(s1), p2 = parse(s2), n1 = lifePath(p1), n2 = lifePath(p2);
    const n = scoreNumerology(n1, n2);
    const z1 = zodiac(p1), z2 = zodiac(p2), e1 = eastern(p1), e2 = eastern(p2);
    const z = scoreZodiac(z1, z2);
    const e = scoreEastern(e1, e2);
    let pa = arcanum(p1) + arcanum(p2); if (pa > 22) pa -= 22;
    const ar = ARCANA[pa];
    const total = n[0];
    // parts: число судьбы даёт процент (w: 1), остальное — подробности без веса
    const parts = [
      { key: 'num', t: 'Число судьбы', w: 1, v: total, short: `${n1} и ${n2}`, why: n[1], c: 'var(--rose)' },
      { key: 'zod', t: 'Знак и стихия', w: 0, v: z[0], short: `${z1.name} и ${z2.name}`, why: z[1], c: 'var(--sun)' },
      { key: 'east', t: 'Восточный год', w: 0, v: e[0], short: `${e1.name} и ${e2.name}`, why: e[1], c: 'var(--sea)' },
      { key: 'arc', t: 'Аркан пары', w: 0, v: ar[2], short: `${pa}, ${ar[0]}`, why: `${pa}, ${ar[0]}: ${ar[1]}`, c: 'var(--plum)' }
    ];
    const a = numberInfo(n1), b = numberInfo(n2);
    // описание пары: кто есть кто, текст пары из таблицы, вывод по проценту
    const about = [n[1], levelOf(total).text].filter(Boolean).join(' ');
    const text = [`Ваше число судьбы ${n1}${a.name ? ` (${a.name})` : ''}, у партнёра ${n2}${b.name ? ` (${b.name})` : ''}.`, about].join(' ');
    return { total, parts, pairArcanum: pa, arc: ar, n1, n2, text, about };
  }
  const verdictOf = t => levelOf(t).title;
  window.LVC = { parse, lifePath, zodiac, eastern, arcanum, ARCANA, compat, verdictOf, levelOf, numberInfo };
})();
