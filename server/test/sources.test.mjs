import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { adSource } from '../routes/auth.mjs';
import { ADMIN, startServer } from './helpers.mjs';

let srv;
before(async () => { srv = await startServer(); });
after(() => srv.close());

test('метка рекламы: только короткие латинские слова', () => {
  assert.equal(adSource({ s: 'VK', m: 'cpc', c: 'Osen-2026' }), 'vk / cpc / osen-2026');
  assert.equal(adSource({ s: 'telegram' }), 'telegram');
  assert.equal(adSource({ s: '<script>', m: '', c: 'x' }), 'script / - / x');
  assert.equal(adSource({ s: 'a'.repeat(100) }).length, 40);
  assert.equal(adSource({ s: 'Кириллица' }), null);
  assert.equal(adSource('vk'), null);
  assert.equal(adSource(null), null);
});

test('метка сохраняется при регистрации и видна в статистике админки', async () => {
  const c = srv.client();
  const s = await c.post('/api/auth/start', { email: 'ad@example.ru' });
  await c.post('/api/auth/verify', { email: 'ad@example.ru', code: s.body.devCode, src: { s: 'vk', m: 'cpc', c: 'osen' } });
  assert.equal(srv.app.db.get('SELECT src FROM users WHERE email = ?', 'ad@example.ru').src, 'vk / cpc / osen');

  const admin = srv.client(); await admin.login(ADMIN);
  const sources = (await admin.get('/api/admin/queue')).body.stats.sources;
  const vk = sources.find(r => r.src === 'vk / cpc / osen');
  assert.deepEqual({ users: vk.users, month: vk.month, payers: vk.payers }, { users: 1, month: 1, payers: 0 });
  assert.ok(sources.some(r => r.src === 'без метки'));
});
