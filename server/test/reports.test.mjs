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

  assert.equal((await a.get('/api/report?inv=' + inv)).status, 402);
  assert.deepEqual((await a.get('/api/reports')).body.reports, []);

  assert.equal(await (await notify(notification(inv, 9900))).text(), 'OK');
  const rep = await a.get('/api/report?inv=' + inv);
  assert.equal(rep.status, 200);
  assert.equal(rep.body.report.total, 93);
  const list = (await a.get('/api/reports')).body.reports;
  assert.equal(list.length, 1);
  assert.equal(list[0].invId, inv);
  assert.equal(list[0].a, PAIR.a);

  const again = await a.post('/api/pay', { product: 'pair_report', pair: PAIR });
  assert.equal(again.status, 409);
  assert.equal(again.body.error, 'already_bought');
  assert.equal(again.body.invId, inv);

  // Чужой разбор не открывается, без входа — тоже.
  const b = await srv.user('other@example.ru');
  assert.equal((await b.get('/api/report?inv=' + inv)).status, 404);
  assert.equal((await srv.client().get('/api/report?inv=' + inv)).status, 401);
  assert.equal((await a.get('/api/report?inv=999999')).status, 404);

  // Возврат закрывает доступ.
  refundOrder(srv.app.db, inv, 'тест');
  assert.equal((await a.get('/api/report?inv=' + inv)).status, 402);
  assert.deepEqual((await a.get('/api/reports')).body.reports, []);
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

test('личный разбор по дате рождения: расчёт', async () => {
  const { birthReport, matrix } = await import('../birthReport.mjs');
  const mx = matrix({ y: 1988, m: 2, d: 17 });
  assert.deepEqual([mx.A, mx.B, mx.C, mx.D, mx.E], [17, 2, 4, 1, 2]);
  assert.deepEqual([mx.sky, mx.earth, mx.personal], [3, 21, 2]);
  const { pythagoras, peaks } = await import('../birthReport.mjs');
  const pq = pythagoras({ y: 1988, m: 2, d: 17 });
  assert.deepEqual(pq.work, [36, 9, 34, 7]);
  assert.equal(pq.counts[8], 2);
  assert.deepEqual(peaks({ y: 1988, m: 2, d: 17 }, 9).ages[0], [0, 27]);
  const r = birthReport('1988-02-17', Date.parse('2026-11-25T12:00:00Z'));
  assert.equal(r.num, 9);
  assert.equal(r.sign, 'Водолей');
  assert.deepEqual(r.sections.map(s => s.key), ['main', 'num', 'day', 'pyth', 'lines', 'zod', 'east', 'matrix', 'rod', 'arcyear', 'purpose', 'love', 'match', 'work', 'energy', 'peaks', 'year', 'months', 'week', 'days', 'tips']);
  // Разбор подробный: не меньше 25 тысяч знаков текста.
  assert.ok(JSON.stringify(r.sections).length > 25000);
  assert.ok(r.sections.find(s => s.key === 'days').items.length > 0);
  // Все даты от 1930 до сегодня считаются без ошибок и пустых текстов.
  for (let t = Date.UTC(1930, 0, 1); t < Date.now(); t += 37 * 864e5) {
    const b = new Date(t).toISOString().slice(0, 10);
    const s = JSON.stringify(birthReport(b));
    assert.ok(!/undefined|NaN|null/.test(s), b);
  }
});

test('покупка личного разбора: дата обязательна, доступ после оплаты', async () => {
  const a = await srv.user('birth@example.ru');
  assert.equal((await a.post('/api/pay', { product: 'birth_report' })).body.error, 'invalid');
  assert.equal((await a.post('/api/pay', { product: 'birth_report', birth: '1988-02-30' })).status, 400);
  const inv = (await a.post('/api/pay', { product: 'birth_report', birth: PAIR.a })).body.invId;
  assert.equal(tk.hits.at(-1).body.Amount, 9900);
  assert.equal((await a.get('/api/report?inv=' + inv)).status, 402);
  await notify(notification(inv, 9900));
  const rep = await a.get('/api/report?inv=' + inv);
  assert.equal(rep.body.kind, 'birth');
  assert.equal(rep.body.report.birth, PAIR.a);
  assert.deepEqual((await a.get('/api/reports')).body.reports.map(x => [x.kind, x.a, x.b]), [['birth', PAIR.a, null]]);
  const again = await a.post('/api/pay', { product: 'birth_report', birth: PAIR.a });
  assert.equal(again.body.error, 'already_bought');
  assert.equal(again.body.invId, inv);
  assert.equal((await a.post('/api/pay', { product: 'birth_report', birth: PAIR.b })).status, 200);
});
