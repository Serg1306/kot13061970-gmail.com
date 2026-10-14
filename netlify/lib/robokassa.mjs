// Общие функции для оплаты через Робокассу.
// Пароли берутся из переменных окружения Netlify и никогда не попадают в браузер:
//   ROBOKASSA_LOGIN   — идентификатор магазина
//   ROBOKASSA_PASS1   — пароль #1 (подпись платежа и SuccessURL)
//   ROBOKASSA_PASS2   — пароль #2 (подпись уведомления на ResultURL)
//   ROBOKASSA_TEST    — "1", пока магазин в тестовом режиме (нужны тестовые пароли)
//   ROBOKASSA_HASH    — алгоритм подписи из настроек магазина: md5 (по умолчанию), sha256, sha384, sha512
//   ROBOKASSA_RECEIPT — "1", если подключена фискализация (Робочеки); тогда передаём чек
//   ROBOKASSA_SNO     — система налогообложения для чека, например usn_income (необязательно)
//   ROBOKASSA_TAX     — ставка НДС для чека, по умолчанию none
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

export const PAY_URL = 'https://auth.robokassa.ru/Merchant/Index.aspx';

export function settings(env = process.env) {
  return {
    login: env.ROBOKASSA_LOGIN || '',
    pass1: env.ROBOKASSA_PASS1 || '',
    pass2: env.ROBOKASSA_PASS2 || '',
    test: env.ROBOKASSA_TEST === '1',
    algo: (env.ROBOKASSA_HASH || 'md5').toLowerCase(),
    receipt: env.ROBOKASSA_RECEIPT === '1',
    sno: env.ROBOKASSA_SNO || '',
    tax: env.ROBOKASSA_TAX || 'none',
  };
}

export const isConfigured = s => Boolean(s.login && s.pass1 && s.pass2);

const ALGOS = new Set(['md5', 'sha1', 'sha256', 'sha384', 'sha512']);
export const digest = (algo, text) =>
  crypto.createHash(ALGOS.has(algo) ? algo : 'md5').update(text, 'utf8').digest('hex');

// Пользовательские параметры Shp_* добавляются в конец строки подписи, отсортированные по имени.
export const shpTail = shp => Object.keys(shp).sort().map(k => `:${k}=${shp[k]}`).join('');
export const pickShp = params => Object.fromEntries([...params].filter(([k]) => /^shp_/i.test(k)));

export function sameSignature(a, b) {
  const x = Buffer.from(String(a || '').toLowerCase());
  const y = Buffer.from(String(b || '').toLowerCase());
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Номер счёта: целое число меньше 2^31, уникальное для магазина.
export const newInvId = () => String((Math.floor(Date.now() / 1000) % 100000000) * 20 + crypto.randomInt(20));

// Ссылка на оплату. С чеком подпись: MerchantLogin:OutSum:InvId:Receipt:Пароль#1[:Shp_…],
// где Receipt — JSON в URL-кодировке; без чека Receipt из строки убирается.
export function paymentUrl(s, productKey, { invId = newInvId(), email = '' } = {}) {
  const product = CATALOG[productKey];
  if (!product) throw new Error('unknown_product');
  const outSum = product.price.toFixed(2);
  const shp = { Shp_product: productKey };
  const receipt = s.receipt ? encodeURIComponent(JSON.stringify({
    ...(s.sno ? { sno: s.sno } : {}),
    items: [{ name: product.title, quantity: 1, sum: product.price, payment_method: 'full_payment', payment_object: 'service', tax: s.tax }],
  })) : '';
  const base = [s.login, outSum, invId, ...(receipt ? [receipt] : []), s.pass1].join(':');
  const q = new URLSearchParams({
    MerchantLogin: s.login, OutSum: outSum, InvId: invId,
    Description: `Любовь в цифрах: ${product.title}`,
    SignatureValue: digest(s.algo, base + shpTail(shp)),
    Culture: 'ru', Encoding: 'utf-8', ...shp,
  });
  if (receipt) q.set('Receipt', receipt);
  if (s.test) q.set('IsTest', '1');
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) q.set('Email', email);
  return { url: `${PAY_URL}?${q}`, invId };
}

// Проверка подписи, которую Робокасса присылает после оплаты:
// OutSum:InvId:Пароль[:Shp_…], пароль #1 для SuccessURL и пароль #2 для ResultURL.
export function checkPaid(s, params, password) {
  const outSum = params.get('OutSum') || '';
  const invId = params.get('InvId') || '';
  const shp = pickShp(params);
  const expected = digest(s.algo, `${outSum}:${invId}:${password}${shpTail(shp)}`);
  if (!outSum || !invId || !sameSignature(expected, params.get('SignatureValue'))) return null;
  const key = shp.Shp_product;
  const product = CATALOG[key];
  if (!product || Math.abs(parseFloat(outSum) - product.price) > 0.001) return null;
  return { invId, productKey: key, product };
}

export const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

// Параметры из тела формы (POST) или из строки запроса (GET).
export async function readParams(req) {
  const params = new URL(req.url).searchParams;
  if (req.method === 'POST') {
    const type = req.headers.get('content-type') || '';
    if (type.includes('application/json')) {
      const body = await req.json().catch(() => ({}));
      for (const [k, v] of Object.entries(body || {})) params.set(k, String(v));
    } else {
      const body = new URLSearchParams(await req.text());
      for (const [k, v] of body) params.set(k, v);
    }
  }
  return params;
}
