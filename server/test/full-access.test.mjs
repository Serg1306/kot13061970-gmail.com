import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { ADMIN, startServer } from './helpers.mjs';
import { startTkassaMock } from './tkassa-mock.mjs';

let srv, tk, admin;
before(async () => {
  tk = await startTkassaMock();
  srv = await startServer(tk.env);
  admin = srv.client();
  await admin.login(ADMIN);
});
after(async () => { await srv.close(); await tk.close(); });

test('полный доступ: выдаёт только админ, всё платное бесплатно, без значка VIP', async () => {
  const owner = await srv.user('owner@example.ru', { name: 'Сергей', birth: '1970-06-13' });
  const other = await srv.user('other2@example.ru', { name: 'Ира' });
  assert.equal((await owner.post('/api/admin/full-access', { userId: owner.id, on: true })).status, 403);
  assert.equal((await admin.post('/api/admin/full-access', { userId: 'nope', on: true })).status, 404);
  assert.equal((await admin.post('/api/admin/full-access', { userId: owner.id, on: true })).body.fullAccess, true);
  assert.equal((await admin.get('/api/admin/users?q=owner@')).body.users[0].fullAccess, true);

  const me = (await owner.get('/api/me')).body;
  assert.equal(me.wallet.full, true);
  assert.equal(me.wallet.coins, 0);
  // Поднятие анкеты и подарок — без монет.
  assert.equal((await owner.post('/api/boost')).status, 200);
  assert.equal((await owner.post('/api/gift', { kind: 'rose', to: other.id })).status, 200);
  // Разбор — сразу, без Т-Кассы.
  const hits = tk.hits.length;
  const r = await owner.post('/api/pay', { product: 'birth_report', birth: '1970-06-13' });
  assert.equal(r.body.free, true);
  assert.equal(tk.hits.length, hits);
  assert.equal((await owner.get('/api/report?inv=' + r.body.invId)).body.kind, 'birth');
  assert.equal((await owner.post('/api/pay', { product: 'birth_report', birth: '1970-06-13' })).body.error, 'already_bought');
  // Платежи VIP по-прежнему через Т-Кассу.
  assert.match((await owner.post('/api/pay', { product: 'vip_1m' })).body.url, /securepay/);

  // Снять доступ.
  await admin.post('/api/admin/full-access', { userId: owner.id, on: false });
  assert.equal((await owner.get('/api/me')).body.wallet.full, undefined);
  assert.equal((await owner.post('/api/boost')).body.error, 'no_coins');
});
