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
import { DAY_TIP, EAST_YEAR, EAST_YEARS, LOVE_EL, MONTH2, PYTH_LINES, TALISMAN } from './report/extra.mjs';

const ANIMALS = ['Крыса', 'Бык', 'Тигр', 'Кролик', 'Дракон', 'Змея', 'Лошадь', 'Коза', 'Обезьяна', 'Петух', 'Собака', 'Свинья'];
const SIGN_EL = { огонь: ['Овен', 'Лев', 'Стрелец'], земля: ['Телец', 'Дева', 'Козерог'], воздух: ['Близнецы', 'Весы', 'Водолей'], вода: ['Рак', 'Скорпион', 'Рыбы'] };
const EL_FRIEND = { огонь: 'воздух', воздух: 'огонь', земля: 'вода', вода: 'земля' };
const GROUPS = [[1, 5, 7], [2, 4, 8], [3, 6, 9]];
// Начало знака: [месяц, день] — для декады.
const SIGN_START = { Козерог: [12, 22], Водолей: [1, 20], Рыбы: [2, 19], Овен: [3, 21], Телец: [4, 20], Близнецы: [5, 21], Рак: [6, 21], Лев: [7, 23], Дева: [8, 23], Весы: [9, 23], Скорпион: [10, 23], Стрелец: [11, 22] };
// Знаки по кругу (как в compat.js): Козерог=0 … Стрелец=11.
const ZODIAC = [['Козерог', 'земля'], ['Водолей', 'воздух'], ['Рыбы', 'вода'], ['Овен', 'огонь'], ['Телец', 'земля'], ['Близнецы', 'воздух'], ['Рак', 'вода'], ['Лев', 'огонь'], ['Дева', 'земля'], ['Весы', 'воздух'], ['Скорпион', 'вода'], ['Стрелец', 'огонь']];
// Те же правила, что у калькулятора совместимости (scoreNumerology, scoreZodiac в compat.js).
function numScore(a, b) {
  const fam = n => (n === 11 ? 2 : n === 22 ? 4 : n), g = n => [1, 5, 7].includes(n) ? 0 : [2, 4, 8].includes(n) ? 1 : 2;
  const x = fam(a), y = fam(b);
  if (a === b) return [88, 'одинаковое число: похожий взгляд на мир'];
  if (g(x) === g(y)) return [94, 'одна семья чисел: общий ритм жизни'];
  const fr = { 0: 2, 1: 2, 2: 1 };
  if (fr[g(x)] === g(y) || fr[g(y)] === g(x)) return [72, 'числа дополняют друг друга'];
  return [52, 'разный темп, нужно больше разговаривать'];
}
function zodScore(i, j) {
  const [, e1] = ZODIAC[i], [, e2] = ZODIAC[j];
  if (i === j) return [80, 'один знак: понимаете друг друга с полуслова, но можете заскучать'];
  if (Math.abs(i - j) === 6) return [78, 'противоположные знаки: сильное притяжение'];
  if (e1 === e2) return [92, 'одна стихия: общий темперамент'];
  const pr = new Set([e1, e2]);
  if ((pr.has('огонь') && pr.has('воздух')) || (pr.has('земля') && pr.has('вода'))) return [86, 'стихии усиливают друг друга'];
  return [54, 'разные темпераменты: интересно, но непросто'];
}
function eastRel(i, j) {
  if (Math.abs(i - j) === 6) return 'clash';
  if (i === j) return 'same';
  if (i % 4 === j % 4) return 'allies';
  if ((i + j) % 12 === 1) return 'friends';
  return 'neutral';
}
const ANIMAL_GEN = { Крыса: 'Крысы', Бык: 'Быка', Тигр: 'Тигра', Кролик: 'Кролика', Дракон: 'Дракона', Змея: 'Змеи', Лошадь: 'Лошади', Коза: 'Козы', Обезьяна: 'Обезьяны', Петух: 'Петуха', Собака: 'Собаки', Свинья: 'Свиньи' };
const EL_GEN = { Огонь: 'Огненной', Земля: 'Земляной', Металл: 'Металлической', Дерево: 'Деревянной', Вода: 'Водяной' };
const EAST_REL_TXT = {
  same: 'ваш же знак: похожие привычки и одинаковые слабые места',
  allies: 'союзник по треугольнику: близкие ценности, легко быть командой',
  friends: 'тайный друг: тихая поддержка и понимание',
  clash: 'противоположный знак: сильное притяжение и частые споры',
  neutral: 'нейтральное сочетание: всё решают характеры',
};
const STAGES = ['Детство и юность', 'Молодость', 'Зрелость', 'Мудрость'];
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
    const pm = reduce9(personalYear(p, dt.getUTCFullYear()) + dt.getUTCMonth() + 1), M2 = MONTH2[pm];
    return { title: `${MONTHS[dt.getUTCMonth()]} ${dt.getUTCFullYear()}: личный месяц ${pm}`, text: `${M2[0]}: ${MONTH[pm]}. В отношениях. ${M2[1]} В делах. ${M2[2]}` };
  });
  const lineLvl = sum => sum >= 7 ? 3 : sum >= 5 ? 2 : sum >= 3 ? 1 : 0;
  const tail = [mx.D, arc22(mx.D + mx.E), arc22(mx.D + arc22(mx.D + mx.E))];
  const moneyPt = arc22(mx.C + mx.H), lovePt = arc22(mx.D + mx.H);
  const arcYear = yy => arc22(mx.A + mx.B + digitSum(yy));
  const T = TALISMAN[z.name], LE = LOVE_EL[z.el];
  const eastYear2 = yy => { const [name, el, from] = EAST_YEARS[yy] || []; if (!name) return null; return { title: `${yy}: год ${EL_GEN[el]} ${ANIMAL_GEN[name]} (с ${from})`, text: EAST_YEAR[eastRel(e.i, ANIMALS.indexOf(name))] }; };
  const pmOf = dt => reduce9(personalYear(p, dt.getUTCFullYear()) + dt.getUTCMonth() + 1);
  const week = Array.from({ length: 7 }, (_, i) => {
    const dt = new Date(Date.UTC(nowD.getUTCFullYear(), nowD.getUTCMonth(), nowD.getUTCDate() + 1 + i));
    const pd = reduce9(pmOf(dt) + dt.getUTCDate());
    return { title: fmt(dt), text: `личный день ${pd}: ${DAY_TIP[pd]}` };
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
      key: 'lines', title: 'Линии квадрата Пифагора',
      paras: ['Строки, столбцы и диагонали психоматрицы складываются в восемь линий. Сила линии — сколько всего цифр в её клетках: чем больше, тем ярче качество.'],
      items: PYTH_LINES.map(([title, digits, texts]) => { const sum = digits.reduce((t, d) => t + py.counts[d], 0); return { title: `${title} (${digits.join('-')}: ${sum})`, text: texts[lineLvl(sum)] }; }),
    },
    {
      key: 'zod', title: `Знак зодиака: ${z.glyph} ${z.name}`,
      paras: [S[2], ELEMENT[z.el], `${CROSS[S[1]]} Управитель знака — ${S[0]}. ${DECAN[decanOf(z.name, p)]}`],
      items: [
        { title: 'Сильные стороны знака', text: `${S[3].join(', ')}.` },
        { title: 'Слабые стороны знака', text: `${S[4].join(', ')}.` },
        { title: 'Совет знака', text: S[7] },
        { title: 'Талисманы', text: `Цвета: ${T[0]}. Камни: ${T[1]}. Удачный день недели — ${T[2]}. Ваши числа: ${[...new Set([n, dayN, attitude])].join(', ')}.` },
      ],
    },
    {
      key: 'east', title: `Восточный год: ${yEl[0]} ${e.name}`,
      paras: [An[0], `Стихия вашего года — ${yEl[0]}. ${yEl[1]}`],
      items: [
        { title: 'Союзники', text: `${allies.join(' и ')} — из вашего треугольника: с ними легко дружить, работать и строить отношения.` },
        { title: 'Тайный друг', text: `${friend} — тихая, но надёжная поддержка, человек этого года часто помогает вам в трудный момент.` },
        { title: 'Противоположный знак', text: `${clash} — притяжение и споры: с людьми этого года много искр, нужна взаимная уступчивость.` },
        ...[year, year + 1].map(eastYear2).filter(Boolean),
      ],
    },
    {
      key: 'matrix', title: 'Матрица судьбы',
      paras: ['Матрица судьбы раскладывает дату рождения на 22 энергии (аркана). Каждая энергия может проявляться в плюсе — как талант и сила, или в минусе — как ловушка. Ниже — главные точки вашей матрицы.'],
      items: [
        { title: `Личность и характер: ${an('A')}`, text: `Точка дня рождения — то, какой вы по природе. ${a('A').plus} ${a('A').minus} ${a('A').love} ${a('A').money} Совет: ${a('A').tip}` },
        { title: `Таланты и дух: ${an('B')}`, text: `Точка месяца — ваши таланты и то, что вас вдохновляет. ${a('B').plus} ${a('B').minus} ${a('B').love} ${a('B').money} Совет: ${a('B').tip}` },
        { title: `Материальная задача: ${an('C')}`, text: `Точка года — то, через что вы реализуетесь в мире. ${a('C').plus} ${a('C').minus} ${a('C').love} ${a('C').money} Совет: ${a('C').tip}` },
        { title: `Кармический урок: ${an('D')}`, text: `Нижняя точка — главный урок, который жизнь будет повторять, пока он не выучен. Задача — прожить эту энергию в плюсе. ${a('D').plus} ${a('D').minus} ${a('D').tip}` },
        { title: `Зона комфорта: ${an('E')}`, text: `Центр матрицы — энергия, в которой вам легче всего и которая наполняет силой. ${a('E').plus} ${a('E').minus} ${a('E').love} ${a('E').money} Совет: ${a('E').tip}` },
        { title: `Кармический хвост: ${tail.map(x => `${x}, ${ARC[x].name}`).join(' → ')}`, text: `Три аркана внизу матрицы — сценарий, который тянется из прошлого и повторяется, пока вы его не проживёте осознанно. Начало хвоста — ${ARC[tail[0]].name}: ${ARC[tail[0]].minus.replace(/^В минусе — /, '').replace(/^В минусе /, '')} Середина — ${ARC[tail[1]].name}: ${ARC[tail[1]].minus.replace(/^В минусе — /, '').replace(/^В минусе /, '')} Выход — ${ARC[tail[2]].name}: ${ARC[tail[2]].purpose}` },
      ],
    },
    {
      key: 'rod', title: 'Родовые линии, любовь и деньги в матрице',
      paras: ['Диагонали матрицы — линии рода: мужская (по отцу) и женская (по матери). Каждая несёт таланты и задачи, которые передаются из поколения в поколение. Между точкой года и кармическим хвостом проходит линия отношений и денег.'],
      items: [
        { title: `Мужской род, верх: ${an('F')}`, text: `${ARC[mx.F].plus} ${ARC[mx.F].minus}` },
        { title: `Мужской род, низ: ${an('H')}`, text: `${ARC[mx.H].plus} ${ARC[mx.H].minus}` },
        { title: `Женский род, верх: ${an('G')}`, text: `${ARC[mx.G].plus} ${ARC[mx.G].minus}` },
        { title: `Женский род, низ: ${an('I')}`, text: `${ARC[mx.I].plus} ${ARC[mx.I].minus}` },
        { title: `Точка любви: ${lovePt}, ${ARC[lovePt].name}`, text: `Каких отношений вы ищете и что в них важно. ${ARC[lovePt].love} ${ARC[lovePt].tip}` },
        { title: `Точка денег: ${moneyPt}, ${ARC[moneyPt].name}`, text: `Через что к вам приходят деньги. ${ARC[moneyPt].money} ${ARC[moneyPt].minus}` },
        { title: `Канал отношений и денег: ${an('H')}`, text: `Энергия, которая связывает любовь и деньги: когда она в плюсе, растут и отношения, и доход. ${ARC[mx.H].tip}` },
      ],
    },
    {
      key: 'arcyear', title: 'Энергия года по матрице',
      paras: ['У каждого года своя энергия-аркан. Она показывает главную тему года и то, на что стоит опереться.'],
      items: [year, year + 1, year + 2].map(yy => ({ title: `${yy}: ${arcYear(yy)}, ${ARC[arcYear(yy)].name}`, text: `${ARC[arcYear(yy)].plus} Как прожить год в плюсе: ${ARC[arcYear(yy)].tip}` })),
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
        { title: 'Ваш язык любви', text: LE[0] },
        { title: 'Идеальное свидание', text: LE[1] },
        { title: 'Как вас покорить', text: LE[2] },
        { title: 'Что разрушает ваши отношения', text: LE[3] },
        { title: 'Кого искать', text: `Числа судьбы ${bestNums.join(', ')}; знаки ${bestSigns.join(', ')}; по восточному году — ${allies.join(', ')} и ${friend}. С людьми года ${clash} будет ярко, но непросто. Проверьте совместимость с конкретным человеком в калькуляторе.` },
      ],
    },
    {
      key: 'match', title: 'Совместимость со всеми знаками и числами',
      paras: ['Совместимость по тем же правилам, что и в калькуляторе сайта. Это склонность, а не приговор: высокий процент обещает лёгкость, низкий — интерес и работу над отношениями.'],
      items: [
        ...ZODIAC.map(([name], j) => { const [v, why] = zodScore(z.i, j); return { title: `${name}: ${v}%`, text: `${why}.` }; }).sort((x, y) => parseInt(y.title.split(': ')[1]) - parseInt(x.title.split(': ')[1])),
        ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 22].map(k => { const [v, why] = numScore(n, k); return { title: `Число судьбы ${k}: ${v}%`, text: `${LIFE[k].who}: ${LIFE[k].strengths.slice(0, 3).join(', ')}. С вами — ${why}.` }; }),
        ...ANIMALS.map((name, j) => ({ title: `Год ${ANIMAL_GEN[name]}`, text: `${EAST_REL_TXT[eastRel(e.i, j)]}.` })),
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
      key: 'peaks', title: 'Этапы жизни',
      paras: ['Нумерология делит жизнь на четыре больших периода. У каждого своя «вершина» — тема и возможность, и своё «испытание» — урок периода.'],
      items: pk.ages.map(([from, to], i) => ({
        title: `${STAGES[i]}: ${to === null ? `с ${from} лет` : `${from}–${to} лет`}${i === period ? ' (вы сейчас здесь)' : ''}`,
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
      key: 'week', title: 'Ваша неделя',
      paras: ['Личный день — сумма личного месяца и числа дня. Подсказка на ближайшие семь дней:'],
      items: week,
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
