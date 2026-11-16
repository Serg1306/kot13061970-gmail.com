import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, test } from 'node:test';
import { makeToken } from '../tkassa.mjs';
import { startServer } from './helpers.mjs';
import { notification, startTkassaMock } from './tkassa-mock.mjs';

let srv, tk;
before(async () => {
  tk = await startTkassaMock();
  srv = await startServer(tk.env);
});
after(async () => { await srv.close(); await tk.close(); });

const notify = body => fetch(srv.base + '/api/tkassa-notify', {
  method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
});

async function newOrder(c, product) {
  const r = await c.post('/api/pay', { product });
  assert.equal(r.status, 200);
  assert.match(r.body.url, /^https:\/\/securepay\.example\/new\//);
  const init = tk.hits.at(-1);
  assert.equal(init.method, 'Init');
  assert.equal(init.tokenOk, true);
  assert.equal(init.body.OrderId, r.body.invId);
  assert.equal(init.body.DATA.product, product);
  assert.equal(init.body.NotificationURL, `${srv.base}/api/tkassa-notify`);
  assert.equal(init.body.SuccessURL, `${srv.base}/?pay=ok&order=${r.body.invId}`);
  return r.body.invId;
}

test('подпись запросов: вложенные объекты и Token не участвуют, ключи по алфавиту', () => {
  const t = makeToken({ TerminalKey: 'Shop', Amount: 19200, OrderId: '00000', Description: 'Подарок', DATA: { a: 1 }, Receipt: { Items: [] }, Token: 'x', Success: true }, 'pw');
  // Amount, Description, OrderId, Password, Success, TerminalKey
  const expected = crypto.createHash('sha256').update('19200Подарок00000pwtrueShop').digest('hex');
  assert.equal(t, expected);
});

test('витрина и заказ привязан к пользователю', async () => {
  const g = await srv.client().get('/api/pay');
  assert.equal(g.body.configured, true);
  assert.equal(g.body.test, true);
  assert.equal(g.body.catalog.vip_1m.price, 599);
  assert.equal((await srv.client().get('/api/config')).body.payments, true);
  assert.equal((await srv.client().post('/api/pay', { product: 'vip_1m' })).status, 401);
  const a = await srv.user('buyer@example.ru');
  assert.equal((await a.post('/api/pay', { product: 'free' })).body.error, 'unknown_product');
  const inv = await newOrder(a, 'vip_1m');
  assert.equal(tk.hits.at(-1).body.Amount, 59900);
  const order = srv.app.db.get('SELECT * FROM orders WHERE inv_id = ?', inv);
  assert.equal(order.user_id, a.id);
  assert.equal(order.status, 'new');
  assert.equal(order.payment_id, '7' + inv);
});

test('уведомление: неверная подпись отклоняется, верное начисляет ровно один раз', async () => {
  const a = await srv.user('vip@example.ru');
  const inv = await newOrder(a, 'vip_1m');
  const bad = await notify(notification(inv, 59900, 'CONFIRMED', 'wrong'));
  assert.equal(bad.status, 400);
  assert.equal((await a.get('/api/me')).body.wallet.vipUntil, 0);
  // Сумма не та, что в заказе: не начисляем.
  await notify(notification(inv, 100, 'CONFIRMED'));
  assert.equal((await a.get('/api/me')).body.wallet.vipUntil, 0);
  // Промежуточный статус: не начисляем.
  assert.equal(await (await notify(notification(inv, 59900, 'AUTHORIZED'))).text(), 'OK');
  assert.equal((await a.get('/api/me')).body.wallet.vipUntil, 0);

  const ok = await notify(notification(inv, 59900));
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), 'OK');
  const vip1 = (await a.get('/api/me')).body.wallet.vipUntil;
  assert.ok(Math.abs(vip1 - (Date.now() + 30 * 864e5)) < 60e3);

  assert.equal(await (await notify(notification(inv, 59900))).text(), 'OK');
  assert.equal((await a.get('/api/me')).body.wallet.vipUntil, vip1);
  assert.ok((await a.get('/api/state')).body.events.some(e => e.kind === 'system' && /Оплата получена/.test(e.text)));

  // Возврат на сайт после уведомления: начисления нет, fresh — только в первый раз.
  const c1 = await a.post('/api/pay-confirm', { invId: inv });
  assert.equal(c1.status, 200);
  assert.equal(c1.body.ok, true);
  assert.equal(c1.body.product, 'vip_1m');
  assert.equal(c1.body.fresh, true);
  assert.equal(c1.body.wallet.vipUntil, vip1);
  const c2 = await a.post('/api/pay-confirm', { invId: inv });
  assert.equal(c2.body.fresh, false);
  assert.equal(c2.body.wallet.vipUntil, vip1);

  // Уведомление о неизвестном заказе подтверждается, чтобы Т-Касса не повторяла его.
  assert.equal(await (await notify(notification('123', 9900))).text(), 'OK');
});

test('pay-confirm раньше уведомления: сервер сам спрашивает Т-Кассу', async () => {
  const a = await srv.user('coins@example.ru');
  const inv = await newOrder(a, 'coins_550');
  // Ещё не оплачен: «ждём».
  tk.orders.set(inv, { status: 'FORM_SHOWED', amount: 44900 });
  const wait = await a.post('/api/pay-confirm', { invId: inv });
  assert.deepEqual([wait.body.ok, wait.body.pending], [false, true]);
  assert.equal((await a.get('/api/me')).body.wallet.coins, 0);

  tk.orders.set(inv, { status: 'CONFIRMED', amount: 44900 });
  const c1 = await a.post('/api/pay-confirm', { invId: inv });
  assert.equal(tk.hits.at(-1).method, 'CheckOrder');
  assert.equal(tk.hits.at(-1).tokenOk, true);
  assert.equal(c1.body.wallet.coins, 550);
  assert.equal(c1.body.fresh, true);
  const c2 = await a.post('/api/pay-confirm', { invId: inv });
  assert.equal(c2.body.wallet.coins, 550);
  await notify(notification(inv, 44900));
  assert.equal((await a.get('/api/me')).body.wallet.coins, 550);

  // Без сессии: оплата подтверждается, кошелёк не отдаётся.
  const anon = await srv.client().post('/api/pay-confirm', { invId: inv });
  assert.equal(anon.body.ok, true);
  assert.equal(anon.body.wallet, undefined);
  assert.equal((await srv.client().post('/api/pay-confirm', { invId: '404' })).body.error, 'unknown_order');
});
