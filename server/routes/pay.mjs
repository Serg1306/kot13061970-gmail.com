// Оплата через Робокассу. Логика подписи — общая с функциями Netlify (netlify/lib/robokassa.mjs);
// здесь добавлена привязка счёта к пользователю и начисление ровно один раз.
import {
  CATALOG, checkPaid, isConfigured, newInvId, opStateUrl, parseOpState, paymentUrl, settings,
} from '../../netlify/lib/robokassa.mjs';
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

const REFUND_TEXT = {
  ru: t => `Покупка «${t}» отменена, деньги возвращаются на карту.`,
  en: t => `Purchase "${t}" was cancelled and refunded.`,
};

// Возврат: только для оплаченного счёта. Услуга отменяется на сайте (монеты списываются, но не ниже нуля;
// срок VIP сокращается на купленные дни, но не раньше текущего момента). Деньги возвращает оператор в кабинете Робокассы.
export function refundOrder(db, invId, note) {
  return db.tx(() => {
    const order = db.get('SELECT * FROM orders WHERE inv_id = ?', invId);
    if (!order) fail(404, 'not_found');
    if (order.status !== 'paid') fail(400, 'not_paid');
    const now = Date.now();
    db.run("UPDATE orders SET status = 'refunded', refunded_at = ?, refund_note = ? WHERE inv_id = ?", now, note, invId);
    const product = CATALOG[order.product];
    if (order.user_id && product) {
      if (product.coins) db.run('UPDATE users SET coins = MAX(0, coins - ?) WHERE id = ?', product.coins, order.user_id);
      if (product.vipDays) db.run('UPDATE users SET vip_until = MAX(?, vip_until - ?) WHERE id = ?', now, product.vipDays * DAY, order.user_id);
      const lang = db.get('SELECT lang FROM users WHERE id = ?', order.user_id)?.lang;
      addEvent(db, order.user_id, 'system', null, (REFUND_TEXT[lang] || REFUND_TEXT.ru)(product.title));
    }
    return db.get('SELECT * FROM orders WHERE inv_id = ?', invId);
  });
}

// Сверка счёта с Робокассой (XML-интерфейс OpStateExt). Если там оплачено — начисляем (идемпотентно).
export async function checkOrder(app, invId) {
  const { db } = app;
  const s = settings(app.config.env);
  if (!isConfigured(s)) fail(503, 'not_configured');
  if (!db.get('SELECT 1 FROM orders WHERE inv_id = ?', invId)) fail(404, 'not_found');
  db.run('UPDATE orders SET last_checked_at = ? WHERE inv_id = ?', Date.now(), invId);
  let xml;
  try {
    const res = await fetch(opStateUrl(s, invId), { signal: AbortSignal.timeout(15000) });
    xml = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (e) {
    app.log.warn(`robokassa: сверка счёта ${invId} не удалась: ${e.message}`);
    fail(502, 'robokassa_unavailable');
  }
  const st = parseOpState(xml);
  const credited = st.paid ? creditOrder(db, invId) : false;
  if (credited) app.log.info(`robokassa: счёт ${invId} оплачен (найден сверкой)`);
  return { state: st.state, code: st.stateCode, resultCode: st.resultCode, credited };
}

// Фоновая сверка: неоплаченные счета возрастом от 5 минут до 48 часов, не чаще раза в 30 минут на счёт.
export async function checkPendingOrders(app) {
  if (!isConfigured(settings(app.config.env))) return 0;
  const now = Date.now();
  const due = app.db.all(`SELECT inv_id FROM orders WHERE status = 'new' AND created_at <= ? AND created_at >= ?
    AND (last_checked_at IS NULL OR last_checked_at < ?) ORDER BY created_at LIMIT 50`, now - 5 * 60e3, now - 48 * 3600e3, now - 30 * 60e3);
  for (const o of due) {
    try { await checkOrder(app, o.inv_id); } catch { /* сеть недоступна — попробуем в следующий раз */ }
  }
  return due.length;
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
