import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { ADMIN, startServer } from './helpers.mjs';
import { startTkassaMock } from './tkassa-mock.mjs';

let srv, admin, tk, states;
before(async () => {
  tk = await startTkassaMock();
  srv = await startServer(tk.env);
  admin = srv.client();
  await admin.login(ADMIN);
  // Состояние заказа в Т-Кассе: «оплачен» = CONFIRMED на полную сумму заказа.
  states = {
    set(inv, status) {
      const o = srv.app.db.get('SELECT price FROM orders WHERE inv_id = ?', inv);
      tk.orders.set(inv, { status, amount: Math.round((o?.price || 0) * 100) });
    },
  };
});
after(async () => { await srv.close(); await tk.close(); });

const order = async (c, product) => (await c.post('/api/pay', { product })).body.invId;
const wallet = async c => (await c.get('/api/me')).body.wallet;
const checks = () => tk.hits.filter(h => h.method === 'CheckOrder');

test('сверка заказа с Т-Кассой и начисление один раз', async () => {
  const a = await srv.user('check@example.ru');
  const inv = await order(a, 'coins_100');
  let r = await admin.post('/api/admin/order-check', { invId: inv });
  assert.deepEqual(r.body, { state: 'NOT_FOUND', paid: false, credited: false });
  states.set(inv, 'FORM_SHOWED');
  r = await admin.post('/api/admin/order-check', { invId: inv });
  assert.deepEqual(r.body, { state: 'FORM_SHOWED', paid: false, credited: false });
  const hit = checks().at(-1);
  assert.equal(hit.tokenOk, true);
  assert.equal(hit.body.OrderId, inv);

  // Оплачен на другую сумму — не начисляем.
  tk.orders.set(inv, { status: 'CONFIRMED', amount: 100 });
  r = await admin.post('/api/admin/order-check', { invId: inv });
  assert.equal(r.body.credited, false);
  assert.equal((await wallet(a)).coins, 0);

  states.set(inv, 'CONFIRMED');
  r = await admin.post('/api/admin/order-check', { invId: inv });
  assert.equal(r.body.credited, true);
  assert.equal(r.body.state, 'CONFIRMED');
  assert.equal((await wallet(a)).coins, 100);
  r = await admin.post('/api/admin/order-check', { invId: inv });
  assert.equal(r.body.credited, false);
  assert.equal((await wallet(a)).coins, 100);
  assert.equal((await admin.post('/api/admin/order-check', { invId: '999' })).status, 404);
  assert.equal((await a.post('/api/admin/order-check', { invId: inv })).status, 403);
});

test('список платежей, фильтры и итоги', async () => {
  const a = await srv.user('payer@example.ru', { name: 'Плательщик' });
  const inv1 = await order(a, 'vip_1m');
  const inv2 = await order(a, 'coins_550');
  states.set(inv1, 'CONFIRMED');
  await admin.post('/api/admin/order-check', { invId: inv1 });
  const all = (await admin.get('/api/admin/orders')).body;
  const o1 = all.orders.find(o => o.invId === inv1);
  assert.equal(o1.status, 'paid');
  assert.equal(o1.email, 'payer@example.ru');
  assert.equal(o1.name, 'Плательщик');
  assert.equal(o1.title, 'VIP-статус на 30 дней');
  assert.equal(o1.price, 599);
  assert.ok(o1.paidAt > 0);
  assert.ok(all.orders[0].createdAt >= all.orders.at(-1).createdAt);
  const byEmail = (await admin.get('/api/admin/orders?q=PAYER@')).body.orders;
  assert.deepEqual(byEmail.map(o => o.invId).sort(), [inv1, inv2].sort());
  assert.deepEqual((await admin.get('/api/admin/orders?status=new&q=payer')).body.orders.map(o => o.invId), [inv2]);
  assert.deepEqual((await admin.get(`/api/admin/orders?q=${inv1}`)).body.orders.map(o => o.invId), [inv1]);
  assert.equal((await admin.get('/api/admin/orders?status=bad')).status, 400);
  const t = all.totals;
  assert.equal(t.all, 599 + 99);
  assert.equal(t.today, 599 + 99);
  assert.equal(t.month, 599 + 99);
  assert.equal(t.refunded, 0);
});

test('возврат: отмена услуги на сайте', async () => {
  const a = await srv.user('refund@example.ru');
  const coinsInv = await order(a, 'coins_550');
  assert.equal((await admin.post('/api/admin/refund', { invId: coinsInv })).body.error, 'not_paid');
  states.set(coinsInv, 'CONFIRMED');
  await admin.post('/api/admin/order-check', { invId: coinsInv });
  srv.app.db.run('UPDATE users SET coins = 100 WHERE id = ?', a.id); // часть монет уже потрачена
  const r = await admin.post('/api/admin/refund', { invId: coinsInv, note: 'Ошибочная покупка, возврат в кабинете 14.10' });
  assert.equal(r.status, 200);
  assert.equal(r.body.order.status, 'refunded');
  assert.equal(r.body.order.refundNote, 'Ошибочная покупка, возврат в кабинете 14.10');
  assert.ok(r.body.order.refundedAt > 0);
  assert.equal((await wallet(a)).coins, 0);
  assert.equal((await admin.post('/api/admin/refund', { invId: coinsInv })).body.error, 'not_paid');
  assert.ok((await a.get('/api/state')).body.events.some(e => e.kind === 'system' && /отменена/.test(e.text)));
  // Повторное уведомление об оплате не начисляет возвращённый счёт снова.
  assert.equal((await admin.post('/api/admin/order-check', { invId: coinsInv })).body.credited, false);
  assert.equal((await wallet(a)).coins, 0);

  const vipInv = await order(a, 'vip_3d');
  states.set(vipInv, 'CONFIRMED');
  await admin.post('/api/admin/order-check', { invId: vipInv });
  const before = (await wallet(a)).vipUntil;
  assert.ok(before > Date.now() + 2.9 * 864e5);
  await admin.post('/api/admin/refund', { invId: vipInv });
  const vip = (await wallet(a)).vipUntil;
  assert.ok(vip <= Date.now() && vip > Date.now() - 60e3);
  const totals = (await admin.get('/api/admin/orders')).body.totals;
  assert.equal(totals.refunded, 449 + 199);
  assert.equal(totals.refundedCount, 2);
});

test('фоновая сверка: возраст счёта, пауза 30 минут, ошибки сети', async () => {
  const a = await srv.user('bg@example.ru');
  const fresh = await order(a, 'coins_100');
  const old = await order(a, 'coins_100');
  const ancient = await order(a, 'coins_100');
  srv.app.db.run('UPDATE orders SET created_at = ? WHERE inv_id = ?', Date.now() - 10 * 60e3, old);
  srv.app.db.run('UPDATE orders SET created_at = ? WHERE inv_id = ?', Date.now() - 49 * 3600e3, ancient);
  states.set(fresh, 'CONFIRMED'); states.set(old, 'CONFIRMED'); states.set(ancient, 'CONFIRMED');
  tk.hits.length = 0;
  await srv.checkOrders();
  assert.ok(checks().some(h => h.body.OrderId === old));
  assert.ok(!checks().some(h => h.body.OrderId === fresh || h.body.OrderId === ancient));
  assert.equal((await wallet(a)).coins, 100);
  assert.ok(srv.app.db.get('SELECT last_checked_at FROM orders WHERE inv_id = ?', old).last_checked_at > 0);

  // Только что проверенный (и уже оплаченный) не проверяется снова.
  tk.hits.length = 0;
  srv.app.db.run("UPDATE orders SET status = 'new' WHERE inv_id = ?", old);
  await srv.checkOrders();
  assert.ok(!checks().some(h => h.body.OrderId === old));
  srv.app.db.run("UPDATE orders SET status = 'paid' WHERE inv_id = ?", old);

  // Сеть недоступна: сервер не падает, админ получает понятную ошибку.
  const s2 = await startServer({ ...tk.env, TKASSA_API_URL: 'http://127.0.0.1:1/v2' });
  try {
    const b = await s2.user('offline@example.ru');
    // Платёж не создаётся: Т-Касса недоступна.
    const p = await b.post('/api/pay', { product: 'coins_100' });
    assert.equal(p.status, 502);
    assert.equal(p.body.error, 'tkassa_unavailable');
    const inv = s2.app.db.get('SELECT inv_id FROM orders ORDER BY created_at DESC LIMIT 1').inv_id;
    s2.app.db.run('UPDATE orders SET created_at = ? WHERE inv_id = ?', Date.now() - 10 * 60e3, inv);
    await s2.checkOrders();
    const adm = s2.client();
    await adm.login(ADMIN);
    const r = await adm.post('/api/admin/order-check', { invId: inv });
    assert.equal(r.status, 502);
    assert.equal(r.body.error, 'tkassa_unavailable');
  } finally { await s2.close(); }
});
