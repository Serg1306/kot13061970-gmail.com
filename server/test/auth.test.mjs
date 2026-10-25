import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { JPEG, WEBM, startServer } from './helpers.mjs';

let srv;
before(async () => { srv = await startServer(); });
after(() => srv.close());

test('config и заголовки безопасности', async () => {
  const r = await srv.client().get('/api/config');
  assert.equal(r.status, 200);
  assert.equal(r.body.live, true);
  assert.equal(r.body.devCodes, true);
  assert.equal(r.body.payments, false);
  assert.equal(r.body.vapidPublicKey, null); // push выключен по умолчанию
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
});

test('статика: index, типы, запрет выхода из папки', async () => {
  const c = srv.client();
  const home = await fetch(srv.base + '/');
  assert.equal(home.status, 200);
  assert.match(home.headers.get('content-type'), /text\/html/);
  const video = await fetch(srv.base + '/media/video-sea.mp4', { headers: { range: 'bytes=0-99' } });
  assert.equal(video.status, 206);
  assert.equal(video.headers.get('content-type'), 'video/mp4');
  assert.equal((await video.arrayBuffer()).byteLength, 100);
  for (const p of ['/%2e%2e/%2e%2e/package.json', '/..%2f..%2fserver/tkassa.mjs', '/.git/config', '/tools/make_demo_media.py']) {
    const r = await c.get(p);
    assert.notEqual(r.status, 200, p);
  }
});

test('CSRF: без заголовка X-Requested-With изменяющие запросы отклоняются', async () => {
  const r = await srv.client().post('/api/auth/start', { email: 'x@y.ru' }, { csrf: false });
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'csrf');
});

test('вход по коду: ошибки и успешный вход', async () => {
  const c = srv.client();
  assert.equal((await c.post('/api/auth/start', { email: 'not-an-email' })).body.error, 'bad_email');
  const s = await c.post('/api/auth/start', { email: '  Anna@Example.RU ', lang: 'ru' });
  assert.equal(s.status, 200);
  assert.match(s.body.devCode, /^\d{6}$/);
  const again = await c.post('/api/auth/start', { email: 'anna@example.ru' });
  assert.equal(again.status, 429);
  assert.equal(again.body.error, 'too_often');
  assert.ok(again.body.wait > 0);

  const wrong = s.body.devCode === '000000' ? '111111' : '000000';
  const bad = await c.post('/api/auth/verify', { email: 'anna@example.ru', code: wrong });
  assert.equal(bad.body.error, 'bad_code');
  assert.equal((await c.get('/api/me')).status, 401);

  const ok = await c.post('/api/auth/verify', { email: 'ANNA@example.ru', code: s.body.devCode });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.user, null);
  const me = await c.get('/api/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.user, null);
  assert.deepEqual(me.body.wallet, { coins: 0, vipUntil: 0, boostUntil: 0 });

  // Код одноразовый.
  const reuse = await srv.client().post('/api/auth/verify', { email: 'anna@example.ru', code: s.body.devCode });
  assert.equal(reuse.body.error, 'code_expired');

  // Токен хранится в базе только в виде хэша.
  const token = c.cookie.split('=')[1];
  const row = srv.app.db.get('SELECT token_hash FROM sessions LIMIT 1');
  assert.notEqual(row.token_hash, token);
  assert.equal(row.token_hash.length, 64);
});

test('вход: 5 неверных попыток и просроченный код', async () => {
  const c = srv.client();
  const s = await c.post('/api/auth/start', { email: 'brute@example.ru' });
  const wrong = s.body.devCode === '000000' ? '111111' : '000000';
  for (let i = 0; i < 4; i++) assert.equal((await c.post('/api/auth/verify', { email: 'brute@example.ru', code: wrong })).body.error, 'bad_code');
  assert.equal((await c.post('/api/auth/verify', { email: 'brute@example.ru', code: wrong })).body.error, 'too_many_attempts');
  assert.equal((await c.post('/api/auth/verify', { email: 'brute@example.ru', code: s.body.devCode })).body.error, 'too_many_attempts');

  const s2 = await c.post('/api/auth/start', { email: 'late@example.ru' });
  srv.app.db.run('UPDATE codes SET expires = ? WHERE email = ?', Date.now() - 1, 'late@example.ru');
  assert.equal((await c.post('/api/auth/verify', { email: 'late@example.ru', code: s2.body.devCode })).body.error, 'code_expired');
});

test('анкета: проверки, согласие, 18+', async () => {
  const c = srv.client();
  await c.login('profile@example.ru');
  const good = { name: 'Анна-Мария', birth: '1995-03-08', g: 'f', seek: 'm', city: 'Санкт-Петербург', about: 'Люблю <b>книги</b>' };
  assert.equal((await c.put('/api/profile', { ...good, consent: false, consentPublic: true })).body.error, 'consent_required');
  assert.equal((await c.put('/api/profile', { ...good, consent: true })).body.error, 'consent_public_required');
  const young = new Date(); young.setFullYear(young.getFullYear() - 17);
  assert.equal((await c.put('/api/profile', { ...good, birth: young.toISOString().slice(0, 10), consent: true })).body.error, 'under_18');
  assert.equal((await c.put('/api/profile', { ...good, name: '<img src=x>', consent: true })).body.error, 'bad_name');
  assert.equal((await c.put('/api/profile', { ...good, city: 'Москва<script>', consent: true })).body.error, 'bad_city');
  assert.equal((await c.put('/api/profile', { ...good, about: 'x'.repeat(501), consent: true })).body.field, 'about');
  assert.equal((await c.put('/api/profile', { ...good, birth: '1995-02-30', consent: true })).body.field, 'birth');
  assert.equal((await c.put('/api/profile', { ...good, g: 'x', consent: true })).body.field, 'g');

  const r = await c.put('/api/profile', { ...good, name: '  Анна-Мария  ', consent: true, consentPublic: true });
  assert.equal(r.status, 200);
  assert.equal(r.body.user.name, 'Анна-Мария');
  assert.ok(r.body.user.consentAt > 0);
  assert.equal(r.body.user.consentPublicAt, r.body.user.consentAt);
  assert.equal(r.body.user.consentVersion, '2026-10-25');
  assert.equal(srv.app.db.get('SELECT consent_ip FROM users WHERE id = ?', r.body.user.id).consent_ip, '127.0.0.1');
  // Повторное сохранение — согласие уже есть.
  const r2 = await c.put('/api/profile', { ...good, city: 'Казань' });
  assert.equal(r2.body.user.city, 'Казань');
  assert.equal(r2.body.user.consentAt, r.body.user.consentAt);
});

test('приветствие от поддержки на русском и английском', async () => {
  const ru = await srv.user('welcome-ru@example.ru');
  const st = await ru.get('/api/state');
  assert.match(st.body.chats.support[0].text, /Добро пожаловать в «Любовь в цифрах»!/);
  assert.equal(st.body.chats.support[0].from, 'support');
  assert.ok(st.body.events.some(e => e.kind === 'system'));

  const en = srv.client();
  await en.login('welcome-en@example.ru', 'en');
  await en.put('/api/profile', { name: 'John', birth: '1990-01-01', g: 'm', seek: 'f', city: 'London', consent: true, consentPublic: true, lang: 'en' });
  const st2 = await en.get('/api/state');
  assert.equal(st2.body.chats.support[0].text, 'Welcome to Love in Numbers! Ask us anything about the site, payments or your profile here.');

  const de = srv.client();
  await de.login('welcome-de@example.ru', 'de');
  await de.put('/api/profile', { name: 'Lena', birth: '1990-01-01', g: 'f', seek: 'm', city: 'Berlin', consent: true, consentPublic: true, lang: 'de' });
  const st3 = await de.get('/api/state');
  assert.match(st3.body.chats.support[0].text, /^Willkommen bei „Liebe in Zahlen“!/);
  assert.equal(srv.app.db.get('SELECT lang FROM users WHERE email = ?', 'welcome-de@example.ru').lang, 'de');
});

test('выход и удаление аккаунта вместе с файлами', async () => {
  const a = await srv.user('gone@example.ru');
  const b = await srv.user('friend-of-gone@example.ru');
  await a.post('/api/photos', { dataUrl: JPEG });
  srv.app.db.run('UPDATE users SET vip_until = ? WHERE id = ?', Date.now() + 864e5, a.id);
  const voice = await a.post('/api/messages/voice', { to: b.id, dataUrl: WEBM, dur: 3 });
  assert.equal(voice.status, 200);
  const files = fs.readdirSync(srv.app.config.uploadsDir);
  assert.ok(files.length >= 2);
  const photoFile = srv.app.db.get('SELECT file FROM photos WHERE user_id = ?', a.id).file;

  const del = await a.del('/api/account');
  assert.equal(del.status, 200);
  assert.equal(fs.existsSync(path.join(srv.app.config.uploadsDir, photoFile)), false);
  assert.equal(fs.existsSync(path.join(srv.app.config.uploadsDir, voice.body.message.src.replace('/uploads/', ''))), false);
  assert.equal(srv.app.db.get('SELECT COUNT(*) AS n FROM messages WHERE from_id = ? OR to_id = ?', a.id, a.id).n, 0);
  assert.equal((await a.get('/api/me')).status, 401);

  await b.post('/api/auth/logout');
  assert.equal((await b.get('/api/me')).status, 401);
});
