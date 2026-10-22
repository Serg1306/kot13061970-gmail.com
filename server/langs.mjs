// Языки интерфейса. Тексты сервера берутся по языку анкеты, а если перевода нет — английские.
export const LANGS = ['ru', 'en', 'uk', 'kk', 'uz', 'de', 'es', 'fr'];
export const langOf = l => (LANGS.includes(l) ? l : 'ru');
export const textFor = (texts, l) => texts[l] || (l && l !== 'ru' ? texts.en : null) || texts.ru;
