import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { after, before, test } from 'node:test';
import { parseOpState } from '../../netlify/lib/robokassa.mjs';
import { ADMIN, startServer } from './helpers.mjs';

const md5 = s => crypto.createHash('md5').update(s).digest('hex');

// Поддельный XML-интерфейс Робокассы: состояние счёта задаёт тест.
const states = new Map();
const hits = [];
const xml = (result, state) => `<?xml version="1.0" encoding="utf-8"?>
<OperationStateResponse xmlns="http://merchant.roboxchange.com/WebService/">
  <Result><Code>${result}</Code></Result>
  ${state ? `<State><Code>${state}</Code><RequestDate>2026-10-14T10:00:00+03:00</RequestDate></State>` : ''}
</OperationStateResponse>`;
const mock = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const inv = u.searchParams.get('InvoiceID');
  hits.push({ path: u.pathname, inv, sig: u.searchParams.get('Signature'), login: u.searchParams.get('MerchantLogin') });
  res.writeHead(200, { 'content-type': 'text/xml' });
  res.end(states.has(inv) ? xml(0, states.get(inv)) : xml(3));
});

let srv, admin;
before(async () => {
  await new Promise(r => mock.listen(0, '127.0.0.1', r));
  srv = await startServer({
    ROBOKASSA_LOGIN: 'demo-shop', ROBOKASSA_PASS1: 'p1secret', ROBOKASSA_PASS2: 'p2secret',
    ROBOKASSA_XML_URL: `http://127.0.0.1:${mock.address().port}/Merchant/WebService/Service.asmx`,
  });
  admin = srv.client();
  await admin.login(ADMIN);
});
after(async () => { await srv.close(); mock.close(); });

const order = async (c, product) => new URL((await c.post('/api/pay', { product })).body.url).searchParams.get('InvId');
const wallet = async c => (await c.get('/api/me')).body.wallet;

test('разбор ответа OpStateExt', () => {
  assert.deepEqual(parseOpState(xml(0, 100)), { resultCode: 0, stateCode: 100, state: 'paid', paid: true });
  assert.equal(parseOpState(xml(0, 5)).state, 'pending');
  assert.equal(parseOpState(xml(0, 60)).state, 'refunded');
  assert.equal(parseOpState(xml(3)).state, 'not_found');
  assert.equal(parseOpState('мусор').state, 'error');
});

test('сверка счёта с Робокассой и начисление один раз', async () => {
  const a = await srv.user('check@example.ru');
  const inv = await order(a, 'coins_100');
  states.set(inv, 5);
  let r = await admin.post('/api/admin/order-check', { invId: inv });
  assert.deepEqual(r.body, { state: 'pending', code: 5, resultCode: 0, credited: false });
  const hit = hits.at(-1);
  assert.equal(hit.path, '/Merchant/WebService/Service.asmx/OpStateExt');
  assert.equal(hit.login, 'demo-shop');
  assert.equal(hit.sig, md5(`demo-shop:${inv}:p2secret`));

  states.set(inv, 100);
  r = await admin.post('/api/admin/order-check', { invId: inv });
  assert.equal(r.body.credited, true);
  assert.equal(r.body.state, 'paid');
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
  states.set(inv1, 100);
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
  states.set(coinsInv, 100);
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
  states.set(vipInv, 100);
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
  states.set(fresh, 100); states.set(old, 100); states.set(ancient, 100);
  hits.length = 0;
  await srv.checkOrders();
  assert.ok(hits.some(h => h.inv === old));
  assert.ok(!hits.some(h => h.inv === fresh || h.inv === ancient));
  assert.equal((await wallet(a)).coins, 100);
  assert.ok(srv.app.db.get('SELECT last_checked_at FROM orders WHERE inv_id = ?', old).last_checked_at > 0);

  // Только что проверенный (и уже оплаченный) не проверяется снова.
  hits.length = 0;
  srv.app.db.run("UPDATE orders SET status = 'new' WHERE inv_id = ?", old);
  await srv.checkOrders();
  assert.ok(!hits.some(h => h.inv === old));
  srv.app.db.run("UPDATE orders SET status = 'paid' WHERE inv_id = ?", old);

  // Сеть недоступна: сервер не падает, админ получает понятную ошибку.
  const s2 = await startServer({
    ROBOKASSA_LOGIN: 'demo-shop', ROBOKASSA_PASS1: 'p1secret', ROBOKASSA_PASS2: 'p2secret', ROBOKASSA_XML_URL: 'http://127.0.0.1:1/x',
  });
  try {
    const b = await s2.user('offline@example.ru');
    const inv = await order(b, 'coins_100');
    s2.app.db.run('UPDATE orders SET created_at = ? WHERE inv_id = ?', Date.now() - 10 * 60e3, inv);
    await s2.checkOrders();
    const adm = s2.client();
    await adm.login(ADMIN);
    const r = await adm.post('/api/admin/order-check', { invId: inv });
    assert.equal(r.status, 502);
    assert.equal(r.body.error, 'robokassa_unavailable');
  } finally { await s2.close(); }
});
