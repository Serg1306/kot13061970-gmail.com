import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { ADMIN, JPEG, WEBM, mutualLike, startServer } from './helpers.mjs';

let srv, admin;
before(async () => {
  srv = await startServer();
  admin = srv.client();
  await admin.login(ADMIN);
});
after(() => srv.close());

const today = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
const journal = async () => (await admin.get(`/api/admin/destruction?from=${today()}&to=${today()}`)).body.rows;

test('push выключен: ключи VAPID не создаются', () => {
  assert.equal(fs.existsSync(path.join(srv.dataDir, 'vapid.json')), false);
  assert.ok(fs.existsSync(path.join(srv.dataDir, 'secret.key')));
});

test('выгрузка своих данных (ст. 14 152-ФЗ)', async () => {
  const a = await srv.user('export-a@example.ru', { name: 'Ада' });
  const b = await srv.user('export-b@example.ru', { name: 'Борис' });
  await a.post('/api/photos', { dataUrl: JPEG });
  await mutualLike(a, b);
  await a.post('/api/messages', { to: b.id, text: 'Привет, Борис' });
  await b.post('/api/messages', { to: a.id, text: 'Привет, Ада' });
  await b.post('/api/messages/voice', { to: a.id, dataUrl: WEBM, dur: 2 });
  await a.get(`/api/people/${b.id}`);
  await b.get(`/api/people/${a.id}`);
  await a.post('/api/posts', { text: 'Мой пост' });

  const r = await a.get('/api/account/export');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-disposition'), 'attachment; filename="lyubov-v-cifrah-data.json"');
  const d = r.body;
  assert.equal(d.profile.email, 'export-a@example.ru');
  assert.equal(d.profile.name, 'Ада');
  assert.ok(d.consents.processingAt > 0 && d.consents.publicAt > 0);
  assert.equal(d.consents.version, '2026-10-14');
  assert.equal(d.photos.length, 1);
  assert.deepEqual(d.likes.given.map(x => x.id), [b.id]);
  assert.equal(d.likes.receivedCount, 1);
  assert.deepEqual(d.matches, [b.id]);
  assert.ok(d.messages.some(m => m.direction === 'out' && m.text === 'Привет, Борис'));
  assert.ok(d.messages.some(m => m.direction === 'in' && m.text === 'Привет, Ада' && m.with === b.id));
  assert.ok(d.messages.some(m => m.kind === 'voice' && /\/uploads\/.+\.weba$/.test(m.voice)));
  assert.deepEqual(d.visits.madeByMe.map(v => v.id), [b.id]);
  assert.equal(d.visits.receivedCount, 1);
  assert.equal(d.posts[0].text, 'Мой пост');
  // Чужие почты в выгрузку не попадают.
  assert.ok(!r.text.includes('export-b@example.ru'));

  for (let i = 0; i < 4; i++) assert.equal((await a.get('/api/account/export')).status, 200);
  assert.equal((await a.get('/api/account/export')).status, 429);
});

test('удаление аккаунта записывается в журнал уничтожения', async () => {
  const a = await srv.user('gone@example.ru');
  await a.post('/api/photos', { dataUrl: JPEG });
  const id = a.id;
  assert.equal((await a.del('/api/account')).status, 200);
  const row = (await journal()).find(r => r.emailMasked === 'g***@example.ru');
  assert.ok(row);
  assert.equal(row.reason, 'user_request');
  assert.equal(row.method, 'удаление из БД и файлов');
  assert.match(row.subjectRef, /^[a-f0-9]{16}$/);
  assert.ok(!row.subjectRef.includes(id));
  assert.match(row.categories, /фото/);
  assert.equal((await a.get('/api/admin/destruction')).status, 401);
  const other = await srv.user('not-admin@example.ru');
  assert.equal((await other.get('/api/admin/destruction')).status, 403);
  // Фильтр по датам.
  assert.equal((await admin.get('/api/admin/destruction?from=2020-01-01&to=2020-01-02')).body.rows.length, 0);
});

test('модератор удаляет пользователя по отзыву согласия', async () => {
  const a = await srv.user('withdraw@example.ru');
  await a.post('/api/photos', { dataUrl: JPEG });
  const file = srv.app.db.get('SELECT file FROM photos WHERE user_id = ?', a.id).file;
  assert.equal((await admin.post('/api/admin/delete-user', { email: 'Withdraw@Example.ru', reason: 'bogus' })).body.field, 'reason');
  assert.equal((await a.post('/api/admin/delete-user', { email: 'withdraw@example.ru', reason: 'consent_withdrawn' })).status, 403);
  const r = await admin.post('/api/admin/delete-user', { email: 'Withdraw@Example.ru', reason: 'consent_withdrawn' });
  assert.equal(r.status, 200);
  assert.equal(srv.app.db.get('SELECT COUNT(*) AS n FROM users WHERE email = ?', 'withdraw@example.ru').n, 0);
  assert.equal(fs.existsSync(path.join(srv.app.config.uploadsDir, file)), false);
  const row = (await journal()).find(x => x.emailMasked === 'w***@example.ru');
  assert.equal(row.reason, 'consent_withdrawn');
  assert.equal(row.operator, ADMIN);
  assert.equal((await admin.post('/api/admin/delete-user', { email: 'withdraw@example.ru' })).status, 404);
  // Новая регистрация с этой почтой разрешена (не бан).
  assert.equal((await srv.client().post('/api/auth/start', { email: 'withdraw@example.ru' })).status, 200);
});

test('селфи уничтожаются после проверки и по сроку хранения', async () => {
  const a = await srv.user('selfie-old@example.ru');
  await a.post('/api/verify', { dataUrl: JPEG, gesture: 'Знак «ок»' });
  const file = srv.app.db.get('SELECT verify_file FROM users WHERE id = ?', a.id).verify_file;
  srv.app.db.run('UPDATE users SET verify_at = ? WHERE id = ?', Date.now() - 31 * 864e5, a.id);
  srv.cleanup();
  assert.equal(fs.existsSync(path.join(srv.app.config.privateDir, file)), false);
  assert.equal((await a.get('/api/me')).body.user.verifyStatus, 'none');
  const row = (await journal()).find(x => x.emailMasked === 's***@example.ru');
  assert.equal(row.categories, 'селфи для проверки');
  assert.equal(row.reason, 'retention');

  const b = await srv.user('checked@example.ru');
  await b.post('/api/verify', { dataUrl: JPEG, gesture: 'Ладонь' });
  await admin.post('/api/admin/verify', { userId: b.id, approve: false });
  const row2 = (await journal()).find(x => x.emailMasked === 'c***@example.ru');
  assert.equal(row2.categories, 'селфи для проверки');
  assert.equal(row2.operator, ADMIN);
});

test('удалённый забаненный не может зарегистрироваться снова; хэш хранится 3 года', async () => {
  const reporter = await srv.user('rep@example.ru');
  const bad = await srv.user('scammer@example.ru');
  await reporter.post('/api/report', { id: bad.id, reason: 'scam' });
  const rep = (await admin.get('/api/admin/queue')).body.reports.find(r => r.target.id === bad.id);
  await admin.post('/api/admin/report', { id: rep.id, action: 'ban' });
  // Забаненный удаляет аккаунт сам — почта всё равно запоминается.
  assert.equal((await bad.del('/api/account')).status, 200);
  const row = srv.app.db.get('SELECT * FROM banned_emails');
  assert.equal(row.reason, 'scam');
  assert.ok(!JSON.stringify(row).includes('scammer'));
  const again = await srv.client().post('/api/auth/start', { email: 'Scammer@example.ru' });
  assert.equal(again.status, 403);
  assert.equal(again.body.error, 'banned');

  // Модератор удаляет с причиной ban.
  const spam = await srv.user('spammer@example.ru');
  await admin.post('/api/admin/delete-user', { userId: spam.id, reason: 'ban' });
  assert.equal((await srv.client().post('/api/auth/start', { email: 'spammer@example.ru' })).body.error, 'banned');
  assert.equal((await journal()).find(x => x.emailMasked === 's***@example.ru' && x.reason === 'ban').operator, ADMIN);

  // Через 3 года запись удаляется.
  srv.app.db.run('UPDATE banned_emails SET at = ?', Date.now() - 3 * 366 * 864e5);
  srv.cleanup();
  assert.equal(srv.app.db.get('SELECT COUNT(*) AS n FROM banned_emails').n, 0);
  assert.equal((await srv.client().post('/api/auth/start', { email: 'scammer@example.ru' })).status, 200);
});
