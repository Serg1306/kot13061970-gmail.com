// Оплата через Т-Кассу. Запросы к API и подписи — в server/tkassa.mjs;
// здесь привязка заказа к пользователю и начисление ровно один раз.
import {
  CATALOG, checkNotification, initPayment, isConfigured, isEmail, isPhone, newInvId, orderState, priceKopecks, settings,
} from '../tkassa.mjs';
import { fail, text } from '../http.mjs';
import { textFor } from '../langs.mjs';
import { DAY, addEvent, walletOf } from '../model.mjs';
import { pairReport, validBirth } from '../pairReport.mjs';

const PAID_TEXT = {
  ru: t => `Оплата получена: ${t}. Спасибо!`,
  en: t => `Payment received: ${t}. Thank you!`,
  uk: t => `Оплату отримано: ${t}. Дякуємо!`,
  kk: t => `Төлем алынды: ${t}. Рахмет!`,
  uz: t => `Toʻlov qabul qilindi: ${t}. Rahmat!`,
  de: t => `Zahlung erhalten: ${t}. Danke!`,
  es: t => `Pago recibido: ${t}. ¡Gracias!`,
  fr: t => `Paiement reçu : ${t}. Merci !`,
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
    if (product.boostDays) {
      db.run('UPDATE users SET boost_until = MAX(boost_until, ?) + ? WHERE id = ?', now, product.boostDays * DAY, order.user_id);
    }
    const lang = db.get('SELECT lang FROM users WHERE id = ?', order.user_id)?.lang;
    addEvent(db, order.user_id, 'system', null, textFor(PAID_TEXT, lang)(product.title));
    return true;
  });
}

const REFUND_TEXT = {
  ru: t => `Покупка «${t}» отменена, деньги возвращаются на карту.`,
  en: t => `Purchase "${t}" was cancelled and refunded.`,
  uk: t => `Покупку «${t}» скасовано, гроші повертаються на картку.`,
  kk: t => `«${t}» сатып алуы тоқтатылды, ақша картаға қайтарылады.`,
  uz: t => `«${t}» xaridi bekor qilindi, pul kartaga qaytariladi.`,
  de: t => `Der Kauf „${t}“ wurde storniert, das Geld wird auf die Karte zurückerstattet.`,
  es: t => `La compra «${t}» se ha cancelado y el dinero se devuelve a la tarjeta.`,
  fr: t => `L'achat « ${t} » a été annulé, l'argent est remboursé sur la carte.`,
};

// Возврат: только для оплаченного счёта. Услуга отменяется на сайте (монеты списываются, но не ниже нуля;
// срок VIP сокращается на купленные дни, но не раньше текущего момента). Деньги возвращает оператор в личном кабинете Т-Бизнеса (Т-Касса).
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
      if (product.boostDays) db.run('UPDATE users SET boost_until = MAX(?, boost_until - ?) WHERE id = ?', now, product.boostDays * DAY, order.user_id);
      const lang = db.get('SELECT lang FROM users WHERE id = ?', order.user_id)?.lang;
      addEvent(db, order.user_id, 'system', null, textFor(REFUND_TEXT, lang)(product.title));
    }
    return db.get('SELECT * FROM orders WHERE inv_id = ?', invId);
  });
}

// Сверка заказа с Т-Кассой (метод CheckOrder). Если там оплачено — начисляем (идемпотентно).
export async function checkOrder(app, invId) {
  const { db } = app;
  const s = settings(app.config.env);
  if (!isConfigured(s)) fail(503, 'not_configured');
  const order = db.get('SELECT * FROM orders WHERE inv_id = ?', invId);
  if (!order) fail(404, 'not_found');
  db.run('UPDATE orders SET last_checked_at = ? WHERE inv_id = ?', Date.now(), invId);
  let st;
  try {
    st = await orderState(s, invId);
  } catch (e) {
    app.log.warn(`tkassa: сверка заказа ${invId} не удалась: ${e.message}`);
    fail(502, 'tkassa_unavailable');
  }
  const paid = st.paid && st.amount === priceKopecks(order.product);
  if (st.paid && !paid) app.log.error(`tkassa: заказ ${invId} оплачен на другую сумму (${st.amount} коп.)`);
  const credited = paid ? creditOrder(db, invId) : false;
  if (credited) app.log.info(`tkassa: заказ ${invId} оплачен (найден сверкой)`);
  return { state: st.state, paid, credited };
}

// Фоновая сверка: неоплаченные заказы возрастом от 5 минут до 48 часов, не чаще раза в 30 минут на заказ.
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

// Адрес сайта для ссылок возврата: PUBLIC_URL, а без него — адрес, по которому пришёл запрос.
const siteUrl = (app, req) => app.config.publicUrl || `http://${req.headers.host}`;

export default function payRoutes(route) {
  route('GET', '/api/pay', ({ app }) => {
    const s = settings(app.config.env);
    return { configured: isConfigured(s), test: s.test, catalog: CATALOG };
  }, { auth: 'none' });

  route('POST', '/api/pay', async ({ app, user, body, req }) => {
    const { db } = app;
    const s = settings(app.config.env);
    if (!isConfigured(s)) fail(503, 'not_configured');
    const product = CATALOG[body.product];
    if (!product) fail(400, 'unknown_product');
    app.limiter.check(`pay:${user.id}`, 20, 3600e3);
    // Куда отправить чек (54-ФЗ): почта из окна оплаты, почта или телефон входа, почта из прошлой оплаты.
    // У входа через VK ID логин бывает вида vk:123 — тогда без почты от покупателя платёж не создаём.
    const typed = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (typed && !isEmail(typed)) fail(400, 'bad_email');
    const email = typed || (isEmail(user.email) ? user.email : '') || (isEmail(user.receipt_email) ? user.receipt_email : '');
    const phone = isPhone(user.email) ? user.email : '';
    if (s.receipt && !email && !phone) fail(400, 'need_email');
    // Разбор пары: даты обеих сторон; одну и ту же пару второй раз не продаём.
    const pair = product.pairReport ? [body.pair?.a, body.pair?.b] : [null, null];
    if (product.pairReport) {
      if (!pair.every(validBirth)) fail(400, 'invalid', { field: 'pair' });
      const had = db.get("SELECT inv_id FROM orders WHERE user_id = ? AND product = 'pair_report' AND status = 'paid' AND pair_a = ? AND pair_b = ?", user.id, ...pair);
      if (had) fail(409, 'already_bought', { invId: had.inv_id });
    }
    if (typed && typed !== user.email && typed !== user.receipt_email) db.run('UPDATE users SET receipt_email = ? WHERE id = ?', typed, user.id);
    // Номер заказа уникален: при совпадении берём другой.
    let invId;
    for (let i = 0; i < 5 && !invId; i++) {
      const candidate = newInvId();
      const r = db.run("INSERT OR IGNORE INTO orders (inv_id, user_id, product, price, status, created_at, pair_a, pair_b) VALUES (?, ?, ?, ?, 'new', ?, ?, ?)",
        candidate, user.id, body.product, product.price, Date.now(), ...pair);
      if (r.changes) invId = candidate;
    }
    if (!invId) fail(503, 'try_again');
    const base = siteUrl(app, req);
    try {
      const p = await initPayment(s, body.product, {
        invId, email, phone,
        successUrl: `${base}/?pay=ok&order=${invId}`, failUrl: `${base}/?pay=fail`, notificationUrl: `${base}/api/tkassa-notify`,
      });
      db.run('UPDATE orders SET payment_id = ? WHERE inv_id = ?', p.paymentId, invId);
      return { url: p.url, invId };
    } catch (e) {
      app.log.warn(`tkassa: не удалось создать платёж ${invId}: ${e.message}`);
      fail(502, 'tkassa_unavailable');
    }
  }, { auth: 'user' });

  // Купленные разборы пар (для профиля) и сам разбор: только по оплаченному заказу этого пользователя.
  route('GET', '/api/pair-reports', ({ app, user }) => ({
    reports: app.db.all("SELECT inv_id, pair_a, pair_b, paid_at FROM orders WHERE user_id = ? AND product = 'pair_report' AND status = 'paid' ORDER BY paid_at DESC", user.id)
      .map(o => ({ invId: o.inv_id, a: o.pair_a, b: o.pair_b, paidAt: o.paid_at })),
  }), { auth: 'user' });

  route('GET', '/api/pair-report', ({ app, user, url }) => {
    const o = app.db.get("SELECT * FROM orders WHERE inv_id = ? AND user_id = ? AND product = 'pair_report'", String(url.searchParams.get('inv') || ''), user.id);
    if (!o || !o.pair_a) fail(404, 'not_found');
    if (o.status !== 'paid') fail(402, 'not_paid');
    return { invId: o.inv_id, report: pairReport(o.pair_a, o.pair_b) };
  }, { auth: 'user' });

  // Уведомление Т-Кассы об изменении платежа (NotificationURL). Ответ — строка OK, иначе Т-Касса повторит.
  route('POST', '/api/tkassa-notify', ({ app, body }) => {
    const { db, log } = app;
    const s = settings(app.config.env);
    if (!isConfigured(s)) return text('not configured', 503);
    const n = checkNotification(s, body);
    if (!n) return text('bad token', 400);
    const order = db.get('SELECT * FROM orders WHERE inv_id = ?', n.invId);
    if (!order) { log.error(`tkassa: уведомление о неизвестном заказе ${n.invId}`); return text('OK'); }
    if (n.status === 'CONFIRMED' && n.success) {
      if (n.amount !== priceKopecks(order.product)) {
        log.error(`tkassa: заказ ${n.invId} оплачен на другую сумму (${n.amount} коп.)`);
      } else {
        const credited = creditOrder(db, n.invId);
        log.info(`tkassa: заказ ${n.invId} (${order.product}) ${credited ? 'оплачен' : 'уже был начислен'}`);
      }
    } else if (['REFUNDED', 'PARTIAL_REFUNDED', 'REVERSED'].includes(n.status)) {
      log.warn(`tkassa: по заказу ${n.invId} пришёл статус ${n.status} — оформите возврат в admin.html`);
    }
    return text('OK');
  }, { auth: 'none', csrf: false });

  // Возврат на сайт после оплаты (SuccessURL). Ссылка без подписи, поэтому оплату сервер проверяет
  // сам: по уведомлению, которое уже пришло, или запросом CheckOrder к Т-Кассе.
  route('POST', '/api/pay-confirm', async ({ app, body, user, ip }) => {
    const { db } = app;
    if (!isConfigured(settings(app.config.env))) fail(503, 'not_configured');
    app.limiter.check(`confirm:${ip}`, 30, 3600e3);
    const invId = String(body.invId || '');
    let order = db.get('SELECT * FROM orders WHERE inv_id = ?', invId);
    if (!order) fail(404, 'unknown_order');
    if (order.status === 'new') {
      await checkOrder(app, invId);
      order = db.get('SELECT * FROM orders WHERE inv_id = ?', invId);
    }
    if (order.status !== 'paid') return { ok: false, pending: order.status === 'new', invId };
    // fresh — первое подтверждение этого заказа: сайт показывает «Оплата прошла» только один раз.
    const first = db.run('UPDATE orders SET confirmed_at = ? WHERE inv_id = ? AND confirmed_at IS NULL', Date.now(), invId);
    const out = { ok: true, invId, product: order.product, ...CATALOG[order.product], fresh: first.changes === 1 };
    if (user && user.id === order.user_id) out.wallet = walletOf(db.get('SELECT * FROM users WHERE id = ?', user.id));
    return out;
  }, { auth: 'optional' });
}
