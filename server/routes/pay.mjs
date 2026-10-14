// Оплата через Робокассу. Логика подписи — общая с функциями Netlify (netlify/lib/robokassa.mjs);
// здесь добавлена привязка счёта к пользователю и начисление ровно один раз.
import { CATALOG, checkPaid, isConfigured, newInvId, paymentUrl, settings } from '../../netlify/lib/robokassa.mjs';
import { fail, text } from '../http.mjs';
import { DAY, addEvent, walletOf } from '../model.mjs';

const PAID_TEXT = {
  ru: t => `Оплата получена: ${t}. Спасибо!`,
  en: t => `Payment received: ${t}. Thank you!`,
};

// Начислить оплаченный заказ. Возвращает true, если начислено сейчас, false — если уже было начислено раньше.
export function creditOrder(db, invId) {
  return db.tx(() => {
    const order = db.get('SELECT * FROM orders WHERE inv_id = ?', invId);
    if (!order) return false;
    const now = Date.now();
    const r = db.run("UPDATE orders SET status = 'paid', paid_at = ? WHERE inv_id = ? AND status = 'new'", now, invId);
    if (!r.changes || !order.user_id) return false;
    const product = CATALOG[order.product];
    if (product.vipDays) {
      db.run('UPDATE users SET vip_until = MAX(vip_until, ?) + ? WHERE id = ?', now, product.vipDays * DAY, order.user_id);
    }
    if (product.coins) db.run('UPDATE users SET coins = coins + ? WHERE id = ?', product.coins, order.user_id);
    const lang = db.get('SELECT lang FROM users WHERE id = ?', order.user_id)?.lang;
    addEvent(db, order.user_id, 'system', null, (PAID_TEXT[lang] || PAID_TEXT.ru)(product.title));
    return true;
  });
}

// Параметры Робокассы: строка запроса + тело (форма или JSON).
function robokassaParams(url, raw, contentType) {
  const params = new URLSearchParams(url.searchParams);
  if (!raw?.length) return params;
  if (String(contentType).includes('application/json')) {
    let body = {};
    try { body = JSON.parse(raw.toString('utf8')) || {}; } catch { /* пустое тело */ }
    for (const [k, v] of Object.entries(body)) params.set(k, String(v));
  } else {
    for (const [k, v] of new URLSearchParams(raw.toString('utf8'))) params.set(k, v);
  }
  return params;
}

// Проверка подписи и соответствия заказа: тот же товар, что в счёте.
function paidOrder(db, s, params, password) {
  const paid = checkPaid(s, params, password);
  if (!paid) return null;
  const order = db.get('SELECT * FROM orders WHERE inv_id = ?', paid.invId);
  if (!order || order.product !== paid.productKey) return { paid, order: null };
  return { paid, order };
}

export default function payRoutes(route) {
  route('GET', '/api/pay', ({ app }) => {
    const s = settings(app.config.env);
    return { configured: isConfigured(s), test: s.test, catalog: CATALOG };
  }, { auth: 'none' });

  route('POST', '/api/pay', ({ app, user, body }) => {
    const { db } = app;
    const s = settings(app.config.env);
    if (!isConfigured(s)) fail(503, 'not_configured');
    const product = CATALOG[body.product];
    if (!product) fail(400, 'unknown_product');
    app.limiter.check(`pay:${user.id}`, 20, 3600e3);
    // Номер счёта уникален: при совпадении берём другой.
    let invId;
    for (let i = 0; i < 5 && !invId; i++) {
      const candidate = newInvId();
      const r = db.run("INSERT OR IGNORE INTO orders (inv_id, user_id, product, price, status, created_at) VALUES (?, ?, ?, ?, 'new', ?)",
        candidate, user.id, body.product, product.price, Date.now());
      if (r.changes) invId = candidate;
    }
    if (!invId) fail(503, 'try_again');
    return paymentUrl(s, body.product, { invId, email: user.email });
  }, { auth: 'user' });

  // Result URL: Робокасса сообщает об оплате (подпись паролем #2), ответ — строка OK<InvId>.
  route('POST', '/api/robokassa-result', handleResult, { auth: 'none', csrf: false, raw: true });
  route('GET', '/api/robokassa-result', handleResult, { auth: 'none', csrf: false, raw: true });

  // Возврат на Success URL: подпись паролем #1; начисление, если Result URL ещё не дошёл (идемпотентно).
  route('POST', '/api/pay-confirm', ({ app, url, raw, req, user }) => {
    const { db } = app;
    const s = settings(app.config.env);
    if (!isConfigured(s)) fail(503, 'not_configured');
    const found = paidOrder(db, s, robokassaParams(url, raw, req.headers['content-type']), s.pass1);
    if (!found) fail(400, 'bad_signature');
    if (!found.order) fail(404, 'unknown_order');
    creditOrder(db, found.paid.invId);
    // fresh — первое подтверждение этого счёта: сайт показывает «Оплата прошла» только один раз.
    const first = db.run('UPDATE orders SET confirmed_at = ? WHERE inv_id = ? AND confirmed_at IS NULL', Date.now(), found.paid.invId);
    const out = { ok: true, invId: found.paid.invId, product: found.paid.productKey, ...found.paid.product, fresh: first.changes === 1 };
    if (user && user.id === found.order.user_id) out.wallet = walletOf(db.get('SELECT * FROM users WHERE id = ?', user.id));
    return out;
  }, { auth: 'optional', raw: true });
}

function handleResult({ app, url, raw, req }) {
  const { db, log } = app;
  const s = settings(app.config.env);
  if (!isConfigured(s)) return text('not configured', 503);
  const found = paidOrder(db, s, robokassaParams(url, raw, req.headers['content-type']), s.pass2);
  if (!found) return text('bad sign', 400);
  if (!found.order) {
    log.error(`robokassa: оплачен неизвестный счёт ${found.paid.invId}`);
    return text('unknown order', 404);
  }
  const credited = creditOrder(db, found.paid.invId);
  log.info(`robokassa: счёт ${found.paid.invId} (${found.paid.productKey}) ${credited ? 'оплачен' : 'уже был начислен'}`);
  return text(`OK${found.paid.invId}`);
}
