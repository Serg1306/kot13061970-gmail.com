// Подробности анкеты: цель знакомства, интересы, дети, курение и поля «как на Mamba» (CHOICES, работа, языки). Списки должны совпадать с PROFILE_OPTS в site/lyubov-v-cifrah/index.html.
export const GOALS = ['rel', 'family', 'friends', 'talk', 'flirt'];
export const KIDS = ['no', 'have', 'want'];
export const SMOKE = ['no', 'some', 'yes'];
// поля с выбором из списка: колонка в users → допустимые значения
export const CHOICES = {
  marital: ['single', 'divorced', 'widowed', 'complicated'],
  body: ['slim', 'athletic', 'average', 'curvy', 'large'],
  drink: ['no', 'social', 'yes'],
  edu: ['school', 'college', 'incomplete', 'higher', 'degree'],
  home: ['own', 'rent', 'parents', 'shared'],
  income: ['irregular', 'small', 'middle', 'high'],
};
export const LANGS = ['ru', 'en', 'uk', 'kk', 'uz', 'de', 'es', 'fr', 'it', 'tr', 'zh', 'ar', 'pt', 'pl'];
export const MAX_LANGS = 5;
export const JOB_MAX = 60;
export const DETAIL_KEYS = ['goal', 'interests', 'height', 'kids', 'smoke', ...Object.keys(CHOICES), 'job', 'langs'];
export const INTERESTS = [
  'Путешествия', 'Спорт', 'Йога', 'Бег', 'Велосипед', 'Горы', 'Море', 'Природа', 'Кино', 'Сериалы', 'Музыка', 'Концерты',
  'Театр', 'Книги', 'Кулинария', 'Кофе', 'Рестораны', 'Фотография', 'Рисование', 'Танцы', 'Игры', 'Психология',
  'Астрология', 'Нумерология', 'Животные', 'Автомобили', 'Бизнес', 'IT',
];
export const MAX_INTERESTS = 8;
export const HEIGHT = [140, 220];

// Пустое или неизвестное значение — «не указано».
const pick = (v, list) => (list.includes(v) ? v : null);

export function parseDetails(body) {
  const interests = Array.isArray(body.interests) ? [...new Set(body.interests.filter(x => INTERESTS.includes(x)))].slice(0, MAX_INTERESTS) : [];
  const h = Number(body.height);
  const langs = Array.isArray(body.langs) ? [...new Set(body.langs.filter(x => LANGS.includes(x)))].slice(0, MAX_LANGS) : [];
  const job = typeof body.job === 'string' ? body.job.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, JOB_MAX) : '';
  return {
    goal: pick(body.goal, GOALS), kids: pick(body.kids, KIDS), smoke: pick(body.smoke, SMOKE), interests,
    height: Number.isInteger(h) && h >= HEIGHT[0] && h <= HEIGHT[1] ? h : null,
    ...Object.fromEntries(Object.entries(CHOICES).map(([k, list]) => [k, pick(body[k], list)])),
    job: job || null, langs,
  };
}

// Поля для ответа API: из строки таблицы users.
export function detailsOut(u) {
  const list = v => { try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };
  return {
    goal: u.goal || null, kids: u.kids || null, smoke: u.smoke || null, height: u.height || null, interests: list(u.interests),
    ...Object.fromEntries(Object.keys(CHOICES).map(k => [k, u[k] || null])), job: u.job || null, langs: list(u.langs),
  };
}
