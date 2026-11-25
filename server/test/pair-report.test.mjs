import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { pairReport, validBirth } from '../pairReport.mjs';
import { refundOrder } from '../routes/pay.mjs';
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
const PAIR = { a: '1988-02-17', b: '1992-03-24' };

test('расчёт разбора: даты и разделы', () => {
  assert.equal(validBirth('1988-02-17'), true);
  for (const bad of ['1988-02-30', '1920-01-01', '2999-01-01', '17.02.1988', '', null]) assert.equal(validBirth(bad), false, bad);
  const r = pairReport(PAIR.a, PAIR.b, new Date('2026-11-25T12:00:00Z'));
  assert.equal(r.total, 93);
  assert.deepEqual(r.sections.map(s => s.key), ['systems', 'easy', 'spark', 'talk', 'dates', 'tips']);
  for (const s of r.sections) assert.ok(JSON.stringify(s).length > 80, s.key);
});

test('покупка разбора: пара обязательна, доступ только после оплаты, повторно не продаём', async () => {
  const a = await srv.user('pair@example.ru');
  assert.equal((await a.post('/api/pay', { product: 'pair_report' })).body.error, 'invalid');
  assert.equal((await a.post('/api/pay', { product: 'pair_report', pair: { a: PAIR.a, b: '1992-13-01' } })).status, 400);
  const r = await a.post('/api/pay', { product: 'pair_report', pair: PAIR });
  assert.equal(r.status, 200);
  const inv = r.body.invId;
  assert.equal(tk.hits.at(-1).body.Amount, 9900);

  assert.equal((await a.get('/api/pair-report?inv=' + inv)).status, 402);
  assert.deepEqual((await a.get('/api/pair-reports')).body.reports, []);

  assert.equal(await (await notify(notification(inv, 9900))).text(), 'OK');
  const rep = await a.get('/api/pair-report?inv=' + inv);
  assert.equal(rep.status, 200);
  assert.equal(rep.body.report.total, 93);
  const list = (await a.get('/api/pair-reports')).body.reports;
  assert.equal(list.length, 1);
  assert.equal(list[0].invId, inv);
  assert.equal(list[0].a, PAIR.a);

  const again = await a.post('/api/pay', { product: 'pair_report', pair: PAIR });
  assert.equal(again.status, 409);
  assert.equal(again.body.error, 'already_bought');
  assert.equal(again.body.invId, inv);

  // Чужой разбор не открывается, без входа — тоже.
  const b = await srv.user('other@example.ru');
  assert.equal((await b.get('/api/pair-report?inv=' + inv)).status, 404);
  assert.equal((await srv.client().get('/api/pair-report?inv=' + inv)).status, 401);
  assert.equal((await a.get('/api/pair-report?inv=999999')).status, 404);

  // Возврат закрывает доступ.
  refundOrder(srv.app.db, inv, 'тест');
  assert.equal((await a.get('/api/pair-report?inv=' + inv)).status, 402);
  assert.deepEqual((await a.get('/api/pair-reports')).body.reports, []);
});

test('удаление анкеты стирает даты пары из заказов', async () => {
  const a = await srv.user('gone@example.ru');
  const inv = (await a.post('/api/pay', { product: 'pair_report', pair: PAIR })).body.invId;
  await notify(notification(inv, 9900));
  assert.equal((await a.del('/api/account')).status, 200);
  const o = srv.app.db.get('SELECT pair_a, pair_b FROM orders WHERE inv_id = ?', inv);
  assert.equal(o.pair_a, null);
  assert.equal(o.pair_b, null);
});
