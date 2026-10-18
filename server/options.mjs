// Подробности анкеты: цель знакомства, интересы, дети, курение. Списки должны совпадать с PROFILE_OPTS в site/lyubov-v-cifrah/index.html.
export const GOALS = ['rel', 'family', 'friends', 'talk'];
export const KIDS = ['no', 'have', 'want'];
export const SMOKE = ['no', 'some', 'yes'];
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
  return {
    goal: pick(body.goal, GOALS), kids: pick(body.kids, KIDS), smoke: pick(body.smoke, SMOKE), interests,
    height: Number.isInteger(h) && h >= HEIGHT[0] && h <= HEIGHT[1] ? h : null,
  };
}

// Поля для ответа API: из строки таблицы users.
export function detailsOut(u) {
  let interests = [];
  try { interests = JSON.parse(u.interests || '[]'); } catch {}
  return { goal: u.goal || null, kids: u.kids || null, smoke: u.smoke || null, height: u.height || null, interests };
}
