import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { ADMIN, JPEG, WEBM, mutualLike, setVip, startServer } from './helpers.mjs';

let srv, admin;
before(async () => {
  srv = await startServer();
  admin = srv.client();
  await admin.login(ADMIN);
});
after(() => srv.close());

test('сообщения: кому можно писать, фильтр карт и ссылок', async () => {
  const a = await srv.user('msg-a@example.ru');
  const b = await srv.user('msg-b@example.ru');
  assert.equal((await a.post('/api/messages', { to: b.id, text: 'Привет' })).body.error, 'not_allowed');
  await mutualLike(a, b);
  const m = await a.post('/api/messages', { to: b.id, text: 'Привет!' });
  assert.equal(m.status, 200);
  assert.equal(m.body.message.from, a.id);
  assert.equal(m.body.message.kind, 'text');
  assert.equal(m.body.message.read, false);

  assert.equal((await a.post('/api/messages', { to: b.id, text: 'Карта 4276 1234 5678 9012' })).body.error, 'blocked_card');
  assert.equal((await a.post('/api/messages', { to: b.id, text: 'пиши в t.me/anna' })).body.error, 'blocked_link');
  assert.equal((await a.post('/api/messages', { to: b.id, text: 'мой номер +7 (999) 123-45-67' })).body.error, 'blocked_link');
  assert.equal((await a.post('/api/messages', { to: b.id, text: 'x'.repeat(2001) })).body.field, 'text');

  // После ответа собеседника ссылки можно, карты — никогда.
  await b.post('/api/messages', { to: a.id, text: 'Привет, как дела?' });
  assert.equal((await a.post('/api/messages', { to: b.id, text: 'вот сайт example.ru' })).status, 200);
  assert.equal((await a.post('/api/messages', { to: b.id, text: '4276-1234-5678-9012' })).body.error, 'blocked_card');

  // Третий без симпатии не может, с VIP — может; получатель может ответить.
  const c = await srv.user('msg-c@example.ru');
  assert.equal((await c.post('/api/messages', { to: a.id, text: 'Привет' })).body.error, 'not_allowed');
  setVip(srv.app, c.id);
  assert.equal((await c.post('/api/messages', { to: a.id, text: 'Привет' })).status, 200);
  assert.equal((await a.post('/api/messages', { to: c.id, text: 'И тебе привет' })).status, 200);

  // Прочитано.
  await b.post('/api/messages/read', { with: a.id });
  const chat = (await a.get('/api/state')).body.chats[b.id];
  assert.ok(chat.filter(x => x.from === a.id).every(x => x.read));

  // Блокировка скрывает переписку обоим и запрещает писать.
  await b.post('/api/block', { id: a.id });
  assert.equal((await a.get('/api/state')).body.chats[b.id], undefined);
  assert.equal((await b.get('/api/state')).body.chats[a.id], undefined);
  assert.equal((await a.post('/api/messages', { to: b.id, text: 'эй' })).body.error, 'not_allowed');
  assert.deepEqual((await a.get('/api/state')).body.matches, []);
});

test('голосовые сообщения', async () => {
  const a = await srv.user('voice-a@example.ru');
  const b = await srv.user('voice-b@example.ru');
  await mutualLike(a, b);
  assert.equal((await a.post('/api/messages/voice', { to: b.id, dataUrl: JPEG, dur: 5 })).body.error, 'bad_audio');
  assert.equal((await a.post('/api/messages/voice', { to: b.id, dataUrl: WEBM, dur: 121 })).body.field, 'dur');
  const r = await a.post('/api/messages/voice', { to: b.id, dataUrl: WEBM, dur: 4.6 });
  assert.equal(r.status, 200);
  assert.equal(r.body.message.kind, 'voice');
  assert.equal(r.body.message.dur, 5);
  assert.match(r.body.message.src, /^\/uploads\/[a-f0-9]{32}\.weba$/);
  const f = await fetch(srv.base + r.body.message.src);
  assert.equal(f.headers.get('content-type'), 'audio/webm');
  const ogg = 'data:audio/ogg;base64,' + Buffer.concat([Buffer.from('OggS'), Buffer.alloc(40)]).toString('base64');
  assert.match((await a.post('/api/messages/voice', { to: b.id, dataUrl: ogg, dur: 2 })).body.message.src, /\.ogg$/);
});

test('друзья: заявка, принятие, удаление, отмена; дружба разрешает переписку', async () => {
  const a = await srv.user('fr-a@example.ru');
  const b = await srv.user('fr-b@example.ru');
  let r = await a.post('/api/friends', { id: b.id, action: 'add' });
  assert.deepEqual(r.body.friends, { list: [], in: [], out: [b.id] });
  const bs = await b.get('/api/state');
  assert.deepEqual(bs.body.friends.in, [a.id]);
  assert.ok(bs.body.events.some(e => e.kind === 'friend_req' && e.who === a.id));
  r = await b.post('/api/friends', { id: a.id, action: 'accept' });
  assert.deepEqual(r.body.friends.list, [a.id]);
  assert.ok((await a.get('/api/state')).body.events.some(e => e.kind === 'friend_ok' && e.who === b.id));
  assert.equal((await a.post('/api/messages', { to: b.id, text: 'Привет, друг' })).status, 200);
  r = await a.post('/api/friends', { id: b.id, action: 'remove' });
  assert.deepEqual(r.body.friends.list, []);

  await a.post('/api/friends', { id: b.id, action: 'add' });
  r = await a.post('/api/friends', { id: b.id, action: 'cancel' });
  assert.deepEqual(r.body.friends.out, []);
  await a.post('/api/friends', { id: b.id, action: 'add' });
  r = await b.post('/api/friends', { id: a.id, action: 'decline' });
  assert.deepEqual(r.body.friends.in, []);
  // Встречная заявка сразу делает друзьями.
  await a.post('/api/friends', { id: b.id, action: 'add' });
  r = await b.post('/api/friends', { id: a.id, action: 'add' });
  assert.deepEqual(r.body.friends.list, [a.id]);
  assert.equal((await a.post('/api/friends', { id: b.id, action: 'hug' })).body.field, 'action');
});

test('лента: посты, лайки, удаление', async () => {
  const a = await srv.user('post-a@example.ru');
  const b = await srv.user('post-b@example.ru');
  const p = await a.post('/api/posts', { text: 'Первый пост', dataUrl: JPEG });
  assert.equal(p.status, 200);
  assert.match(p.body.post.img, /^\/uploads\//);
  assert.equal((await a.post('/api/posts', { text: '' })).body.field, 'text');
  let l = await b.post(`/api/posts/${p.body.post.id}/like`);
  assert.deepEqual(l.body, { likes: 1, liked: true });
  const feed = (await b.get('/api/state')).body.posts;
  assert.equal(feed[0].id, p.body.post.id);
  assert.equal(feed[0].liked, true);
  l = await b.post(`/api/posts/${p.body.post.id}/like`);
  assert.deepEqual(l.body, { likes: 0, liked: false });
  assert.equal((await b.del(`/api/posts/${p.body.post.id}`)).status, 404);
  assert.equal((await a.del(`/api/posts/${p.body.post.id}`)).status, 200);
  assert.equal((await fetch(srv.base + p.body.post.img)).status, 404);
});

test('звонки: сигнал доставляется через /api/sync', async () => {
  const a = await srv.user('call-a@example.ru');
  const b = await srv.user('call-b@example.ru');
  const since = Date.now() - 1000;
  assert.equal((await a.post('/api/call/signal', { to: b.id, data: { type: 'offer', sdp: 'x' } })).body.error, 'not_allowed');
  await mutualLike(a, b);
  assert.equal((await a.post('/api/call/signal', { to: b.id, data: 'offer' })).body.field, 'data');
  assert.equal((await a.post('/api/call/signal', { to: b.id, data: { type: 'offer', sdp: 'v=0' } })).status, 200);
  await a.post('/api/messages', { to: b.id, text: 'Звоню!' });
  await new Promise(r => setTimeout(r, 5));
  const s = await b.get(`/api/sync?since=${since}`);
  assert.equal(s.status, 200);
  assert.deepEqual(s.body.signals.map(x => [x.from, x.data]), [[a.id, { type: 'offer', sdp: 'v=0' }]]);
  assert.ok(s.body.messages.some(m => m.text === 'Звоню!'));
  assert.ok(s.body.events.some(e => e.kind === 'match'));
  assert.equal(s.body.counters.unread, 2); // приветствие поддержки + новое сообщение
  assert.ok(s.body.now <= Date.now());
  // Свои сообщения (с другого устройства) тоже приходят в sync.
  const own = await a.get(`/api/sync?since=${since}`);
  assert.ok(own.body.messages.some(m => m.text === 'Звоню!' && m.from === a.id));
  assert.equal(own.body.signals.length, 0);
  // Следующий опрос с since=now ничего старого не возвращает.
  const next = await b.get(`/api/sync?since=${s.body.now}`);
  assert.equal(next.body.signals.length + next.body.messages.length, 0);
  // Сигналы старше 60 секунд удаляются уборкой.
  srv.app.db.run('UPDATE signals SET t = t - 61000');
  assert.equal((await b.get('/api/sync?since=0')).body.signals.length, 0);
  srv.cleanup();
  assert.equal(srv.app.db.get('SELECT COUNT(*) AS n FROM signals').n, 0);
});

test('жалоба и бан через модерацию', async () => {
  const a = await srv.user('rep-a@example.ru');
  const bad = await srv.user('rep-bad@example.ru', { name: 'Мошенник' });
  assert.equal((await a.post('/api/report', { id: bad.id, reason: 'spam' })).body.field, 'reason');
  assert.equal((await a.post('/api/report', { id: bad.id, reason: 'scam', text: 'просит деньги' })).status, 200);
  const q = await admin.get('/api/admin/queue');
  const rep = q.body.reports.find(r => r.target.id === bad.id);
  assert.equal(rep.from.id, a.id);
  assert.equal(rep.reason, 'scam');
  assert.equal((await a.post('/api/admin/report', { id: rep.id, action: 'ban' })).status, 403);
  assert.equal((await admin.post('/api/admin/report', { id: rep.id, action: 'ban' })).status, 200);
  assert.ok(!(await a.get('/api/people')).body.people.some(p => p.id === bad.id));
  assert.ok(!(await srv.client().get('/api/people')).body.people.some(p => p.id === bad.id));
  const me = await bad.get('/api/me');
  assert.equal(me.body.banned, true);
  assert.equal((await bad.post('/api/like', { id: a.id })).body.error, 'banned');
  // Забаненный может написать в поддержку.
  assert.equal((await bad.post('/api/messages', { to: 'support', text: 'За что?' })).status, 200);
  const q2 = await admin.get('/api/admin/queue');
  assert.ok(!q2.body.reports.some(r => r.id === rep.id));
  assert.ok(q2.body.banned.some(u => u.id === bad.id));
  await admin.post('/api/admin/unban', { userId: bad.id });
  assert.ok((await a.get('/api/people')).body.people.some(p => p.id === bad.id));

  // Отклонение жалобы.
  await a.post('/api/report', { id: bad.id, reason: 'rude' });
  const r2 = (await admin.get('/api/admin/queue')).body.reports.find(r => r.target.id === bad.id);
  await admin.post('/api/admin/report', { id: r2.id, action: 'dismiss' });
  assert.ok(!(await admin.get('/api/admin/queue')).body.reports.some(r => r.id === r2.id));
});

test('поддержка: обращение и ответ модератора', async () => {
  const a = await srv.user('help@example.ru');
  const sent = await a.post('/api/messages', { to: 'support', text: 'Не проходит оплата, вот ссылка example.ru' });
  assert.equal(sent.status, 200);
  assert.equal(sent.body.message.to, 'support');
  const q = await admin.get('/api/admin/queue');
  const thread = q.body.support.find(t => t.user.id === a.id);
  assert.equal(thread.unread, 1);
  const open = await admin.get(`/api/admin/support?userId=${a.id}`);
  assert.equal(open.body.messages.at(-1).text, 'Не проходит оплата, вот ссылка example.ru');
  const since = Date.now() - 1;
  const reply = await admin.post('/api/admin/support', { userId: a.id, text: 'Проверили, всё в порядке.' });
  assert.equal(reply.status, 200);
  await new Promise(r => setTimeout(r, 5));
  const s = await a.get(`/api/sync?since=${since}`);
  const m = s.body.messages.find(x => x.text === 'Проверили, всё в порядке.');
  assert.equal(m.from, 'support');
  assert.equal(m.to, a.id);
  const chat = (await a.get('/api/state')).body.chats.support;
  assert.equal(chat.at(-1).from, 'support');
  assert.ok(chat.find(x => x.to === 'support').read);
});

test('проверка селфи: модератор видит селфи и главное фото', async () => {
  const a = await srv.user('selfie@example.ru');
  await a.post('/api/photos', { dataUrl: JPEG });
  const r = await a.post('/api/verify', { dataUrl: JPEG, gesture: 'Два пальца у щеки' });
  assert.equal(r.body.user.verifyStatus, 'pending');
  const v = (await admin.get('/api/admin/queue')).body.verifications.find(x => x.userId === a.id);
  assert.equal(v.gesture, 'Два пальца у щеки');
  assert.match(v.photo, /^\/uploads\//);
  assert.equal((await fetch(srv.base + v.selfie)).status, 401);
  assert.equal((await admin.get(v.selfie)).status, 200);
  assert.equal((await a.get(v.selfie)).status, 403);
  await admin.post('/api/admin/verify', { userId: a.id, approve: true });
  const me = (await a.get('/api/me')).body.user;
  assert.equal(me.verified, true);
  assert.equal(me.verifyStatus, 'approved');
  assert.equal((await admin.get(v.selfie)).status, 404);
});

test('push выключен по умолчанию', async () => {
  const a = await srv.user('push@example.ru');
  const keys = { p256dh: 'B'.repeat(87), auth: 'A'.repeat(22) };
  const r = await a.post('/api/push/subscribe', { subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys } });
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'push_disabled');
  assert.equal(srv.app.push.publicKey, null);
});
