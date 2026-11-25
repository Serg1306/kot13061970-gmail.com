// «Полный разбор по дате рождения» (платная услуга birth_report, 99 ₽): подробный личный разбор одного человека
// по системам, которые считаются только по дате: нумерология (число судьбы, дня рождения, вершины и испытания,
// личный год и месяцы), квадрат Пифагора, знак зодиака, восточный год, матрица судьбы и предназначение.
// Расчёт знака, числа и года — тот же, что у калькулятора (site/lyubov-v-cifrah/compat.js через server/compat.mjs).
// Тексты — в server/report/*, только на сервере: без оплаты их не получить.
import { lvc } from './compat.mjs';
import { ARC } from './report/arcana.mjs';
import { CHALLENGE, DAY, KARMIC, LIFE, MONTH, PEAK, YEAR } from './report/numbers.mjs';
import { CELL } from './report/pythagoras.mjs';
import { ANIMAL, CROSS, DECAN, ELEMENT, SIGN, YEAR_EL } from './report/signs.mjs';

const ANIMALS = ['Крыса', 'Бык', 'Тигр', 'Кролик', 'Дракон', 'Змея', 'Лошадь', 'Коза', 'Обезьяна', 'Петух', 'Собака', 'Свинья'];
const SIGN_EL = { огонь: ['Овен', 'Лев', 'Стрелец'], земля: ['Телец', 'Дева', 'Козерог'], воздух: ['Близнецы', 'Весы', 'Водолей'], вода: ['Рак', 'Скорпион', 'Рыбы'] };
const EL_FRIEND = { огонь: 'воздух', воздух: 'огонь', земля: 'вода', вода: 'земля' };
const GROUPS = [[1, 5, 7], [2, 4, 8], [3, 6, 9]];
// Начало знака: [месяц, день] — для декады.
const SIGN_START = { Козерог: [12, 22], Водолей: [1, 20], Рыбы: [2, 19], Овен: [3, 21], Телец: [4, 20], Близнецы: [5, 21], Рак: [6, 21], Лев: [7, 23], Дева: [8, 23], Весы: [9, 23], Скорпион: [10, 23], Стрелец: [11, 22] };
const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

/* ---------- расчёт ---------- */
const digitSum = n => String(n).split('').reduce((a, c) => a + +c, 0);
const reduce9 = n => { while (n > 9) n = digitSum(n); return n; };
const reduceM = n => { while (n > 9 && n !== 11 && n !== 22) n = digitSum(n); return n; };
const famOf = n => reduce9(n === 11 ? 2 : n === 22 ? 4 : n);
const arc22 = n => { while (n > 22) n = n > 99 ? digitSum(n) : n - 22; return n || 22; };
const fmt = d => d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'long', timeZone: 'UTC' });

// Матрица судьбы по дате: углы (день, месяц, год, кармический хвост), центр, диагонали и предназначения.
export function matrix({ y, m, d }) {
  const A = arc22(d), B = arc22(m), C = arc22(digitSum(y));
  const D = arc22(A + B + C), E = arc22(A + B + C + D);
  const F = arc22(A + B), G = arc22(B + C), H = arc22(C + D), I = arc22(D + A);
  const sky = arc22(B + D), earth = arc22(A + C), personal = arc22(sky + earth);
  const male = arc22(F + H), female = arc22(G + I), social = arc22(male + female);
  return { A, B, C, D, E, F, G, H, I, sky, earth, personal, male, female, social, spiritual: arc22(personal + social) };
}

// Квадрат Пифагора: цифры даты и четыре рабочих числа.
export function pythagoras({ y, m, d }) {
  const date = `${d}${m}${y}`;
  const w1 = digitSum(date), w2 = digitSum(w1);
  const w3 = w1 - 2 * +String(d)[0], w4 = digitSum(Math.abs(w3));
  const all = date + w1 + w2 + Math.abs(w3) + w4;
  const counts = {};
  for (let i = 1; i <= 9; i++) counts[i] = [...all].filter(c => +c === i).length;
  return { work: [w1, w2, w3, w4], counts };
}

// Вершины и испытания нумерологии: четыре периода жизни.
export function peaks({ y, m, d }, lifePath) {
  const M = reduce9(m), D = reduce9(d), Y = reduce9(digitSum(y));
  const end1 = 36 - reduce9(lifePath);
  return {
    ages: [[0, end1], [end1 + 1, end1 + 9], [end1 + 10, end1 + 18], [end1 + 19, null]],
    peaks: [reduceM(M + D), reduceM(D + Y), reduceM(reduceM(M + D) + reduceM(D + Y)), reduceM(M + Y)],
    challenges: [Math.abs(M - D), Math.abs(D - Y), Math.abs(Math.abs(M - D) - Math.abs(D - Y)), Math.abs(M - Y)],
  };
}

const personalYear = (p, year) => reduce9(digitSum(`${p.d}${p.m}${year}`));

function goodDays(fam, from, days = 60, max = 8) {
  const out = [];
  const start = new Date(from); start.setUTCHours(0, 0, 0, 0);
  for (let i = 1; i <= days && out.length < max; i++) {
    const d = new Date(start.getTime() + i * 864e5);
    if (reduce9(digitSum(`${d.getUTCDate()}${d.getUTCMonth() + 1}${d.getUTCFullYear()}`)) === fam) out.push({ date: d.toISOString().slice(0, 10), title: fmt(d) });
  }
  return out;
}

function decanOf(sign, p) {
  const [sm, sd] = SIGN_START[sign];
  const day = Date.UTC(2002, p.m - 1, p.d);
  let start = Date.UTC(2002, sm - 1, sd);
  if (day < start) start = Date.UTC(2001, sm - 1, sd);
  return Math.min(2, Math.floor((day - start) / 864e5 / 10));
}

// Кармические числа: 13, 14, 16, 19 в сумме дня или всей даты.
function karmic(p) {
  const sums = [p.d, digitSum(`${p.d}${p.m}${p.y}`), p.d + p.m + digitSum(p.y)];
  return [...new Set(sums.filter(s => KARMIC[s]))];
}

export function birthReport(birth, now = Date.now()) {
  const L = lvc();
  const p = L.parse(birth);
  const n = L.lifePath(p), z = L.zodiac(p), e = L.eastern(p);
  const N = LIFE[n], S = SIGN[z.name], An = ANIMAL[e.name];
  const dayN = reduce9(p.d), attitude = reduceM(reduce9(p.d) + reduce9(p.m));
  const mx = matrix(p), py = pythagoras(p), pk = peaks(p, n);
  const eastYear = (p.m < 2 || (p.m === 2 && p.d < 5)) ? p.y - 1 : p.y;
  const yEl = YEAR_EL[eastYear % 10];
  const nowD = new Date(now), year = nowD.getUTCFullYear();
  const fam = famOf(n), group = GROUPS.find(g => g.includes(fam));
  const bestNums = [...group, ...(group.includes(3) ? [2, 4, 8] : [3, 6, 9])].sort((a, b) => a - b);
  const bestSigns = [...SIGN_EL[z.el], ...SIGN_EL[EL_FRIEND[z.el]]].filter(s => s !== z.name);
  const allies = ANIMALS.filter((_, i) => i % 4 === e.i % 4 && i !== e.i), friend = ANIMALS[(13 - e.i) % 12], clash = ANIMALS[(e.i + 6) % 12];
  const a = k => ARC[mx[k]];
  const an = k => `${mx[k]}, ${ARC[mx[k]].name}`;
  const age = year - p.y - (nowD.getUTCMonth() + 1 < p.m || (nowD.getUTCMonth() + 1 === p.m && nowD.getUTCDate() < p.d) ? 1 : 0);
  const period = pk.ages.findIndex(([from, to]) => age >= from && (to === null || age <= to));
  const lvl = c => Math.min(4, c);
  const kar = karmic(p);
  const days = goodDays(fam, now);
  const months = Array.from({ length: 12 }, (_, i) => {
    const dt = new Date(Date.UTC(year, nowD.getUTCMonth() + i, 1));
    const pm = reduce9(personalYear(p, dt.getUTCFullYear()) + dt.getUTCMonth() + 1);
    return { title: `${MONTHS[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`, text: `личный месяц ${pm}: ${MONTH[pm]}` };
  });
  const yearItem = yy => { const v = personalYear(p, yy), Y = YEAR[v]; return { title: `${yy} — личный год ${v}, ${Y[0]}`, text: `${Y[1]} В любви. ${Y[2]} В делах. ${Y[3]} ${Y[4]}` }; };

  const sections = [
    {
      key: 'main', title: 'Главное',
      paras: [
        `Ваш код: число судьбы ${n} (${N.who.toLowerCase()}), ${z.name} — стихия ${z.el}, восточный год ${yEl[0]} ${e.name}, аркан личности ${an('A')}, центр матрицы ${an('E')}.`,
        N.essence,
      ],
      items: [
        { title: 'Ваши сильные стороны', text: `${N.strengths.join(', ')}; от знака ${z.name}: ${S[3].join(', ')}; энергия аркана ${a('A').name} в плюсе. ${a('A').plus}` },
        { title: 'Ваши ловушки', text: `${N.shadow.join(', ')}; у знака ${z.name}: ${S[4].join(', ')}. ${a('A').minus}` },
        { title: 'В любви коротко', text: `Вам подходит ${N.partner}.` },
        { title: 'Проверка на неделю', text: N.tip },
      ],
    },
    {
      key: 'num', title: `Число судьбы ${n}: ${N.who}`,
      paras: [N.essence, N.childhood, ...kar.map(k => KARMIC[k])],
      items: [
        { title: 'Сильные стороны', text: `${N.strengths.join(', ')}.` },
        { title: 'Над чем работать', text: `${N.shadow.join(', ')}.` },
        { title: 'Совет', text: N.tip },
      ],
    },
    {
      key: 'day', title: 'Число дня рождения и число отношения',
      items: [
        { title: `Число дня рождения ${dayN}`, text: `${DAY[dayN]} Это ваш врождённый талант, который помогает идти по пути числа ${n}.` },
        { title: `Число отношения ${attitude}`, text: `Так вас видят люди при первой встрече: ${LIFE[attitude].who.toLowerCase()}. Первое, что замечают окружающие: ${LIFE[attitude].strengths.slice(0, 3).join(', ')}.` },
      ],
    },
    {
      key: 'pyth', title: 'Квадрат Пифагора',
      paras: [`Психоматрица строится из цифр даты рождения и четырёх рабочих чисел: ${py.work.join(', ')}. Количество каждой цифры показывает, насколько сильно проявлено качество.`],
      items: Object.entries(CELL).map(([digit, [title, levels]]) => ({ title: `${title} (${digit}: ${py.counts[digit] ? String(digit).repeat(py.counts[digit]) : 'нет'})`, text: levels[lvl(py.counts[digit])] })),
    },
    {
      key: 'zod', title: `Знак зодиака: ${z.glyph} ${z.name}`,
      paras: [S[2], ELEMENT[z.el], `${CROSS[S[1]]} Управитель знака — ${S[0]}. ${DECAN[decanOf(z.name, p)]}`],
      items: [
        { title: 'Сильные стороны знака', text: `${S[3].join(', ')}.` },
        { title: 'Слабые стороны знака', text: `${S[4].join(', ')}.` },
        { title: 'Совет знака', text: S[7] },
      ],
    },
    {
      key: 'east', title: `Восточный год: ${yEl[0]} ${e.name}`,
      paras: [An[0], `Стихия вашего года — ${yEl[0]}. ${yEl[1]}`],
      items: [
        { title: 'Союзники', text: `${allies.join(' и ')} — из вашего треугольника: с ними легко дружить, работать и строить отношения.` },
        { title: 'Тайный друг', text: `${friend} — тихая, но надёжная поддержка, человек этого года часто помогает вам в трудный момент.` },
        { title: 'Противоположный знак', text: `${clash} — притяжение и споры: с людьми этого года много искр, нужна взаимная уступчивость.` },
      ],
    },
    {
      key: 'matrix', title: 'Матрица судьбы',
      paras: ['Матрица судьбы раскладывает дату рождения на 22 энергии (аркана). Каждая энергия может проявляться в плюсе — как талант и сила, или в минусе — как ловушка. Ниже — главные точки вашей матрицы.'],
      items: [
        { title: `Личность и характер: ${an('A')}`, text: `Точка дня рождения — то, какой вы по природе. ${a('A').plus} ${a('A').minus}` },
        { title: `Таланты и дух: ${an('B')}`, text: `Точка месяца — ваши таланты и то, что вас вдохновляет. ${a('B').plus} ${a('B').minus}` },
        { title: `Материальная задача: ${an('C')}`, text: `Точка года — то, через что вы реализуетесь в мире. ${a('C').plus} ${a('C').minus}` },
        { title: `Кармический урок: ${an('D')}`, text: `Нижняя точка — главный урок, который жизнь будет повторять, пока он не выучен. Задача — прожить эту энергию в плюсе. ${a('D').plus} ${a('D').minus} ${a('D').tip}` },
        { title: `Зона комфорта: ${an('E')}`, text: `Центр матрицы — энергия, в которой вам легче всего и которая наполняет силой. ${a('E').plus} ${a('E').minus}` },
        { title: `Линия рода по отцу: ${an('F')} и ${an('H')}`, text: `Сильные стороны мужской линии рода: ${ARC[mx.F].name.toLowerCase()} и ${ARC[mx.H].name.toLowerCase()}. ${ARC[mx.F].tip}` },
        { title: `Линия рода по матери: ${an('G')} и ${an('I')}`, text: `Сильные стороны женской линии рода: ${ARC[mx.G].name.toLowerCase()} и ${ARC[mx.I].name.toLowerCase()}. ${ARC[mx.G].tip}` },
      ],
    },
    {
      key: 'purpose', title: 'Предназначение',
      paras: ['В матрице три уровня предназначения. Они раскрываются постепенно: личное — примерно до 40 лет, социальное — с 40 до 60, духовное — после 60 и всю жизнь как глубинный смысл.'],
      items: [
        { title: `Личное предназначение: ${an('personal')}`, text: `Складывается из «неба» (${an('sky')}) и «земли» (${an('earth')}). ${ARC[mx.personal].purpose} ${ARC[mx.personal].plus}` },
        { title: `Социальное предназначение: ${an('social')}`, text: `То, что вы приносите людям и обществу. ${ARC[mx.social].purpose} ${ARC[mx.social].tip}` },
        { title: `Духовное предназначение: ${an('spiritual')}`, text: `Глубинный смысл вашей жизни. ${ARC[mx.spiritual].purpose}` },
      ],
    },
    {
      key: 'love', title: 'Любовь и отношения',
      paras: [N.love, S[5], An[1]],
      items: [
        { title: `Энергия любви: ${an('A')}`, text: a('A').love },
        { title: `Что вас наполняет в паре: ${an('E')}`, text: a('E').love },
        { title: 'Какой партнёр вам подходит', text: `${N.partner[0].toUpperCase()}${N.partner.slice(1)}.` },
        { title: 'Кого искать', text: `Числа судьбы ${bestNums.join(', ')}; знаки ${bestSigns.join(', ')}; по восточному году — ${allies.join(', ')} и ${friend}. С людьми года ${clash} будет ярко, но непросто. Проверьте совместимость с конкретным человеком в калькуляторе.` },
      ],
    },
    {
      key: 'work', title: 'Работа и деньги',
      paras: [`По числу судьбы ${n}. ${N.work}`, N.money, `По знаку ${z.name}. ${S[6]}`],
      items: [
        { title: `Денежная энергия: ${an('C')}`, text: a('C').money },
        { title: `Таланты для дела: ${an('B')}`, text: a('B').money },
        { title: `Восточный год: ${e.name}`, text: An[2] },
      ],
    },
    {
      key: 'energy', title: 'Энергия и восстановление',
      paras: [N.energy],
      items: [
        { title: 'Ваш запас энергии', text: CELL[2][1][lvl(py.counts[2])] },
        { title: 'Выносливость', text: CELL[4][1][lvl(py.counts[4])] },
        { title: `Где брать силы: ${an('E')}`, text: a('E').tip },
      ],
    },
    {
      key: 'peaks', title: 'Периоды жизни',
      paras: ['Нумерология делит жизнь на четыре больших периода. У каждого своя «вершина» — тема и возможность, и своё «испытание» — урок периода.'],
      items: pk.ages.map(([from, to], i) => ({
        title: `${i + 1}-й период: ${to === null ? `с ${from} лет` : `${from}–${to} лет`}${i === period ? ' (вы сейчас здесь)' : ''}`,
        text: `Вершина ${pk.peaks[i]} — ${PEAK[pk.peaks[i]]}. Испытание ${pk.challenges[i]} — ${CHALLENGE[pk.challenges[i]]}.`,
      })),
    },
    {
      key: 'year', title: 'Личный год и прогноз',
      items: [yearItem(year), yearItem(year + 1), yearItem(year + 2)],
    },
    {
      key: 'months', title: 'Личные месяцы на год вперёд',
      items: months,
    },
    {
      key: 'days', title: 'Удачные дни для знакомств и свиданий',
      text: `Ваши дни — когда сумма цифр даты сводится к вашему числу ${fam}. Ближайшие:`,
      items: days.map(d => ({ title: d.title, text: 'ваше число дня — хорошо для первого шага, свидания и важного разговора', date: d.date })),
    },
    {
      key: 'tips', title: 'Советы',
      items: [
        { title: 'Главный совет числа', text: N.tip },
        { title: 'Совет знака', text: S[7] },
        { title: `Совет аркана ${a('A').name}`, text: a('A').tip },
        { title: `Над чем работать: ${a('D').name}`, text: a('D').tip },
        { title: 'Главное', text: 'Дата рождения показывает склонности, а не приговор. Решения принимаете вы.' },
      ],
    },
  ];
  const cap = t => t && t[0].toUpperCase() + t.slice(1);
  for (const s of sections) for (const it of s.items) it.text = cap(it.text);
  return { birth, num: n, sign: z.name, glyph: z.glyph, el: z.el, animal: e.name, arcanum: mx.A, arcName: ARC[mx.A].name, sections };
}
