import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, test } from 'node:test';
import { startServer } from './helpers.mjs';

const md5 = s => crypto.createHash('md5').update(s).digest('hex');
let srv;
before(async () => {
  srv = await startServer({ ROBOKASSA_LOGIN: 'demo-shop', ROBOKASSA_PASS1: 'p1secret', ROBOKASSA_PASS2: 'p2secret', ROBOKASSA_TEST: '1' });
});
after(() => srv.close());

const resultForm = (inv, product, outSum, pass = 'p2secret') => new URLSearchParams({
  OutSum: outSum, InvId: inv, Shp_product: product, SignatureValue: md5(`${outSum}:${inv}:${pass}:Shp_product=${product}`).toUpperCase(),
});
const sendResult = form => fetch(srv.base + '/api/robokassa-result', {
  method: 'POST', body: form, headers: { 'content-type': 'application/x-www-form-urlencoded' },
});
const confirmBody = (inv, product, outSum) => ({
  OutSum: outSum, InvId: inv, Shp_product: product, SignatureValue: md5(`${outSum}:${inv}:p1secret:Shp_product=${product}`), Culture: 'ru',
});

async function newOrder(c, product) {
  const r = await c.post('/api/pay', { product });
  assert.equal(r.status, 200);
  const q = new URL(r.body.url).searchParams;
  assert.equal(q.get('Shp_product'), product);
  assert.equal(q.get('SignatureValue'), md5(`demo-shop:${q.get('OutSum')}:${q.get('InvId')}:p1secret:Shp_product=${product}`));
  return q.get('InvId');
}

test('витрина и счёт привязан к пользователю', async () => {
  const g = await srv.client().get('/api/pay');
  assert.equal(g.body.configured, true);
  assert.equal(g.body.catalog.vip_1m.price, 599);
  assert.equal((await srv.client().get('/api/config')).body.robokassa, true);
  assert.equal((await srv.client().post('/api/pay', { product: 'vip_1m' })).status, 401);
  const a = await srv.user('buyer@example.ru');
  assert.equal((await a.post('/api/pay', { product: 'free' })).body.error, 'unknown_product');
  const inv = await newOrder(a, 'vip_1m');
  const order = srv.app.db.get('SELECT * FROM orders WHERE inv_id = ?', inv);
  assert.equal(order.user_id, a.id);
  assert.equal(order.status, 'new');
});

test('Result URL: неверная подпись отклоняется, верная начисляет ровно один раз', async () => {
  const a = await srv.user('vip@example.ru');
  const inv = await newOrder(a, 'vip_1m');
  const bad = await sendResult(resultForm(inv, 'vip_1m', '599.000000', 'p1secret'));
  assert.equal(bad.status, 400);
  assert.equal((await a.get('/api/me')).body.wallet.vipUntil, 0);
  const swapped = await sendResult(resultForm(inv, 'vip_3m', '599.000000'));
  assert.equal(swapped.status, 400);

  const ok = await sendResult(resultForm(inv, 'vip_1m', '599.000000'));
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), `OK${inv}`);
  const vip1 = (await a.get('/api/me')).body.wallet.vipUntil;
  assert.ok(Math.abs(vip1 - (Date.now() + 30 * 864e5)) < 60e3);

  const again = await sendResult(resultForm(inv, 'vip_1m', '599.000000'));
  assert.equal(await again.text(), `OK${inv}`);
  assert.equal((await a.get('/api/me')).body.wallet.vipUntil, vip1);
  assert.ok((await a.get('/api/state')).body.events.some(e => e.kind === 'system' && /Оплата получена/.test(e.text)));

  // Возврат на сайт после Result URL: начисления нет, fresh — только в первый раз.
  const c1 = await a.post('/api/pay-confirm', confirmBody(inv, 'vip_1m', '599.000000'));
  assert.equal(c1.status, 200);
  assert.equal(c1.body.ok, true);
  assert.equal(c1.body.product, 'vip_1m');
  assert.equal(c1.body.fresh, true);
  assert.equal(c1.body.wallet.vipUntil, vip1);
  const c2 = await a.post('/api/pay-confirm', confirmBody(inv, 'vip_1m', '599.000000'));
  assert.equal(c2.body.fresh, false);
  assert.equal(c2.body.wallet.vipUntil, vip1);
});

test('pay-confirm раньше Result URL: начисляет сам, повторно — нет', async () => {
  const a = await srv.user('coins@example.ru');
  const inv = await newOrder(a, 'coins_550');
  const bad = await a.post('/api/pay-confirm', { ...confirmBody(inv, 'coins_550', '449.00'), SignatureValue: 'deadbeef' });
  assert.equal(bad.body.error, 'bad_signature');
  const c1 = await a.post('/api/pay-confirm', confirmBody(inv, 'coins_550', '449.00'));
  assert.equal(c1.body.wallet.coins, 550);
  assert.equal(c1.body.fresh, true);
  const c2 = await a.post('/api/pay-confirm', confirmBody(inv, 'coins_550', '449.00'));
  assert.equal(c2.body.wallet.coins, 550);
  const res = await sendResult(resultForm(inv, 'coins_550', '449.000000'));
  assert.equal(await res.text(), `OK${inv}`);
  assert.equal((await a.get('/api/me')).body.wallet.coins, 550);

  // Без сессии: подпись проверяется, кошелёк не отдаётся.
  const anon = await srv.client().post('/api/pay-confirm', confirmBody(inv, 'coins_550', '449.00'));
  assert.equal(anon.body.ok, true);
  assert.equal(anon.body.wallet, undefined);

  // Подписанный, но неизвестный счёт.
  const unknown = await sendResult(resultForm('123', 'coins_100', '99.00'));
  assert.equal(unknown.status, 404);
});
