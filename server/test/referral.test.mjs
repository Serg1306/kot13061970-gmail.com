import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { DAY } from '../model.mjs';
import { ADMIN, JPEG, startServer } from './helpers.mjs';

let srv;
before(async () => { srv = await startServer(); });
after(() => srv.close());

const vipDays = id => Math.max(0, Math.round((srv.app.db.get('SELECT vip_until FROM users WHERE id = ?', id).vip_until - Date.now()) / DAY));

async function invited(email, ref) {
  const c = srv.client();
  const s = await c.post('/api/auth/start', { email });
  await c.post('/api/auth/verify', { email, code: s.body.devCode, ref });
  const r = await c.put('/api/profile', { name: 'Друг', birth: '1992-03-04', g: 'f', seek: 'm', city: 'Екатеринбург', about: '', consent: true, consentPublic: true });
  c.id = r.body.user.id;
  return c;
}

test('приглашение: бонус обоим после одобрения первого фото, один раз', async () => {
  const host = await srv.user('host@example.ru');
  const friend = await invited('friend@example.ru', host.id);
  const row = srv.app.db.get('SELECT ref_by, src FROM users WHERE id = ?', friend.id);
  assert.deepEqual({ ...row }, { ref_by: host.id, src: 'invite' });
  assert.deepEqual((await host.get('/api/me')).body.ref, { invited: 1, rewarded: 0 });

  const photos = (await friend.post('/api/photos', { dataUrl: JPEG })).body.photos;
  assert.equal(vipDays(friend.id), 0);
  const admin = srv.client(); await admin.login(ADMIN);
  assert.equal((await admin.post('/api/admin/photo', { id: photos[0].id, approve: true })).status, 200);
  assert.equal(vipDays(host.id), 7);
  assert.equal(vipDays(friend.id), 7);
  assert.deepEqual((await host.get('/api/me')).body.ref, { invited: 1, rewarded: 1 });

  // Второе фото бонус не повторяет.
  const p2 = (await friend.post('/api/photos', { dataUrl: JPEG })).body.photos;
  await admin.post('/api/admin/photo', { id: p2[1].id, approve: true });
  assert.equal(vipDays(host.id), 7);
});

test('приглашение: чужой или кривой код и отклонённое фото бонуса не дают', async () => {
  const a = await invited('nobody@example.ru', 'ffffffffffffffff');
  const b = await invited('weird@example.ru', "1' OR 1=1 --");
  for (const c of [a, b]) assert.equal(srv.app.db.get('SELECT ref_by FROM users WHERE id = ?', c.id).ref_by, null);

  const host = await srv.user('host2@example.ru');
  const friend = await invited('friend2@example.ru', host.id);
  const photos = (await friend.post('/api/photos', { dataUrl: JPEG })).body.photos;
  const admin = srv.client(); await admin.login(ADMIN);
  await admin.post('/api/admin/photo', { id: photos[0].id, approve: false });
  assert.equal(vipDays(host.id), 0);
});
