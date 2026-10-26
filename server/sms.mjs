// Код входа на телефон через SMS.ru. Два способа:
//   call — звонок-сброс (https://sms.ru/api/code_call): робот звонит, код — последние 4 цифры его номера.
//          Около 0,4 ₽ за код, имя отправителя регистрировать не нужно. Так входят в Мамбу и Авито.
//   sms  — СМС с шестизначным кодом (https://sms.ru/api/send): около 8,5 ₽ за СМС, у операторов может понадобиться
//          платное имя отправителя.
// Ключ — в .env сервера, в браузер не попадает:
//   SMS_RU_API_ID   — api_id из личного кабинета SMS.ru
//   SMS_MODE        — call (по умолчанию) или sms
//   SMS_FROM        — имя отправителя, если оно согласовано в SMS.ru (иначе отправитель по умолчанию)
//   SMS_PREFIXES    — коды стран через запятую, куда разрешено слать СМС; по умолчанию 7 (Россия и Казахстан)
//   SMS_DAILY_LIMIT — не больше стольких кодов в сутки на весь сайт, защита баланса от накрутки; по умолчанию 300
//   SMS_API_URL     — адрес API (меняется только в автотестах)
import { textFor } from './langs.mjs';

export const API_URL = 'https://sms.ru';

// Номер в виде +79991234567. Принимаем 8 999…, 9991234567 (без кода страны — Россия), пробелы, скобки, дефисы.
export function normPhone(s) {
  const raw = String(s ?? '').trim();
  let d = raw.replace(/\D/g, '');
  if (!raw.startsWith('+')) {
    if (d.length === 11 && d[0] === '8') d = '7' + d.slice(1);
    else if (d.length === 10 && d[0] === '9') d = '7' + d;
  }
  if (d.length < 10 || d.length > 15 || d[0] === '0') return '';
  if (d[0] === '7' && d.length !== 11) return '';
  return '+' + d;
}

export const isPhone = login => String(login || '').startsWith('+');

const CODE_TEXT = {
  ru: c => `Код входа в «Любовь в цифрах»: ${c}`,
  en: c => `Love in Numbers sign-in code: ${c}`,
  uk: c => `Код входу в «Любов у цифрах»: ${c}`,
  kk: c => `«Махаббат сандарда» кіру коды: ${c}`,
  uz: c => `«Sevgi raqamlarda» kirish kodi: ${c}`,
  de: c => `Anmeldecode für „Liebe in Zahlen“: ${c}`,
  es: c => `Código de acceso a «Amor en Números»: ${c}`,
  fr: c => `Code de connexion « L'Amour en Chiffres » : ${c}`,
};

// Текст СМС. Последняя строка «@домен #код» нужна браузеру: Chrome на Android сам подставит код в поле.
export function codeText(code, lang, publicUrl = '') {
  let host = '';
  try { host = publicUrl ? new URL(publicUrl).host : ''; } catch { /* адрес сайта не задан */ }
  return textFor(CODE_TEXT, lang)(code) + (host ? `\n\n@${host} #${code}` : '');
}

export function createSms(config, log) {
  const s = config.sms;
  const outbox = [];
  let day = '', sent = 0;
  return {
    configured: Boolean(s),
    // Как придёт код: звонком (4 цифры) или СМС (6 цифр).
    via: s?.mode === 'sms' ? 'sms' : s ? 'call' : 'sms',
    outbox,
    // Можно ли слать СМС на этот номер: страна из списка разрешённых.
    allowed: phone => (s?.prefixes || ['7']).some(p => phone.startsWith('+' + p)),
    // Суточный лимит на весь сайт исчерпан?
    exhausted() {
      const d = new Date().toISOString().slice(0, 10);
      if (d !== day) { day = d; sent = 0; }
      return Boolean(s) && sent >= s.dailyLimit;
    },
    // Отправить код. Возвращает код, который придёт человеку: при звонке его выбирает SMS.ru (4 цифры).
    async send(phone, { code, lang, publicUrl, ip }) {
      if (!s) { outbox.push({ to: phone, code }); return code; }
      const call = s.mode === 'call';
      const params = call
        ? { api_id: s.apiId, phone: phone.slice(1), ip: ip || '-1', json: '1' }
        : { api_id: s.apiId, to: phone.slice(1), msg: codeText(code, lang, publicUrl), json: '1', ...(s.from ? { from: s.from } : {}) };
      const res = await fetch(s.apiUrl + (call ? '/code/call' : '/sms/send'), {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(params),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const r = await res.json();
      const one = call ? r : r.sms?.[phone.slice(1)];
      if (r.status !== 'OK' || one?.status !== 'OK' || (call && !/^\d{4}$/.test(String(r.code)))) {
        throw new Error(`SMS.ru: ${one?.status_code || r.status_code || '?'} ${one?.status_text || r.status_text || ''}`.trim());
      }
      sent++;
      if (typeof r.balance === 'number' && r.balance < 100) log.warn(`sms: на балансе SMS.ru осталось ${r.balance} ₽`);
      return call ? String(r.code) : code;
    },
  };
}
