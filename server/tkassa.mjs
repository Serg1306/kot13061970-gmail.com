// Оплата через Т-Кассу (интернет-эквайринг Т-Банка, API v2).
// Ключи берутся из переменных окружения сервера (.env) и никогда не попадают в браузер:
//   TKASSA_TERMINAL — TerminalKey из личного кабинета (у тестового терминала в конце DEMO)
//   TKASSA_PASSWORD — пароль терминала (им подписываются запросы и проверяются уведомления)
//   TKASSA_RECEIPT  — "1", если подключена онлайн-касса (чеки 54-ФЗ); тогда передаём чек
//   TKASSA_TAXATION — система налогообложения для чека: osn, usn_income, usn_income_outcome, esn, patent
//   TKASSA_TAX      — ставка НДС для чека, по умолчанию none
//   TKASSA_API_URL  — адрес API (меняется только в автотестах)
import crypto from 'node:crypto';

// Цены задаёт только сервер: браузер присылает код товара, а не сумму.
// Если меняете цены, поправьте и витрину в site/lyubov-v-cifrah/index.html (const SHOP).
export const CATALOG = {
  vip_3d: { title: 'VIP-статус на 3 дня', price: 199, vipDays: 3 },
  vip_1m: { title: 'VIP-статус на 30 дней', price: 599, vipDays: 30 },
  vip_3m: { title: 'VIP-статус на 90 дней', price: 1290, vipDays: 90 },
  coins_100: { title: '100 монет', price: 99, coins: 100 },
  coins_550: { title: '550 монет', price: 449, coins: 550 },
  coins_1200: { title: '1200 монет', price: 890, coins: 1200 },
};

export const API_URL = 'https://securepay.tinkoff.ru/v2';

export function settings(env = process.env) {
  const terminal = env.TKASSA_TERMINAL || '';
  return {
    terminal,
    password: env.TKASSA_PASSWORD || '',
    test: /DEMO$/i.test(terminal),
    receipt: env.TKASSA_RECEIPT === '1',
    taxation: env.TKASSA_TAXATION || 'usn_income',
    tax: env.TKASSA_TAX || 'none',
    apiUrl: (env.TKASSA_API_URL || API_URL).replace(/\/+$/, ''),
  };
}

export const isConfigured = s => Boolean(s.terminal && s.password);

// Подпись: берём параметры верхнего уровня без вложенных объектов (Receipt, DATA) и без самого Token,
// добавляем Password, сортируем по имени и склеиваем значения; от строки — SHA-256.
export function makeToken(params, password) {
  const flat = Object.entries({ ...params, Password: password })
    .filter(([k, v]) => k !== 'Token' && v !== undefined && v !== null && typeof v !== 'object');
  flat.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return crypto.createHash('sha256').update(flat.map(([, v]) => String(v)).join(''), 'utf8').digest('hex');
}

export function sameToken(a, b) {
  const x = Buffer.from(String(a || '').toLowerCase());
  const y = Buffer.from(String(b || '').toLowerCase());
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Номер заказа: уникальная строка до 36 символов.
export const newInvId = () => String((Math.floor(Date.now() / 1000) % 100000000) * 20 + crypto.randomInt(20));

const kopecks = rub => Math.round(rub * 100);

async function call(s, method, params) {
  const body = { TerminalKey: s.terminal, ...params };
  body.Token = makeToken(body, s.password);
  const res = await fetch(`${s.apiUrl}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Создать платёж (метод Init). Возвращает ссылку на платёжную форму.
export async function initPayment(s, productKey, { invId, email = '', successUrl, failUrl, notificationUrl }) {
  const product = CATALOG[productKey];
  if (!product) throw new Error('unknown_product');
  const amount = kopecks(product.price);
  const goodEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : '';
  const params = {
    Amount: amount, OrderId: invId, Description: `Любовь в цифрах: ${product.title}`.slice(0, 140),
    SuccessURL: successUrl, FailURL: failUrl, NotificationURL: notificationUrl,
    DATA: { product: productKey, ...(goodEmail ? { Email: goodEmail } : {}) },
  };
  if (s.receipt) {
    params.Receipt = {
      ...(goodEmail ? { Email: goodEmail } : {}), Taxation: s.taxation,
      Items: [{ Name: product.title, Price: amount, Quantity: 1, Amount: amount, Tax: s.tax, PaymentMethod: 'full_payment', PaymentObject: 'service' }],
    };
  }
  const r = await call(s, 'Init', params);
  if (!r.Success || !r.PaymentURL) throw new Error(`Init: ${r.ErrorCode || '?'} ${r.Message || ''}`.trim());
  return { url: r.PaymentURL, paymentId: String(r.PaymentId || '') };
}

// Состояние заказа (метод CheckOrder): оплачен, если хоть один платёж по нему в статусе CONFIRMED.
export async function orderState(s, invId) {
  const r = await call(s, 'CheckOrder', { OrderId: String(invId) });
  if (!r.Success) {
    if (String(r.ErrorCode) === '7') return { state: 'NOT_FOUND', paid: false, amount: 0 };
    throw new Error(`CheckOrder: ${r.ErrorCode || '?'} ${r.Message || ''}`.trim());
  }
  const payments = Array.isArray(r.Payments) ? r.Payments : [];
  const done = payments.find(p => p.Status === 'CONFIRMED');
  const last = done || payments.at(-1);
  return { state: last?.Status || 'NOT_FOUND', paid: Boolean(done), amount: Number(done?.Amount || 0) };
}

// Уведомление об оплате: подпись верна, терминал наш. Возвращает поля уведомления или null.
export function checkNotification(s, body) {
  if (!body || typeof body !== 'object' || body.TerminalKey !== s.terminal) return null;
  if (!sameToken(makeToken(body, s.password), body.Token)) return null;
  return { invId: String(body.OrderId || ''), status: String(body.Status || ''), amount: Number(body.Amount || 0), success: body.Success === true || body.Success === 'true' };
}

export const priceKopecks = productKey => kopecks(CATALOG[productKey]?.price || 0);
