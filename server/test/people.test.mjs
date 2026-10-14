import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { ADMIN, FAKE_IMG, JPEG, PNG, setCoins, setVip, startServer } from './helpers.mjs';

let srv, admin;
before(async () => {
  srv = await startServer();
  admin = srv.client();
  await admin.login(ADMIN);
});
after(() => srv.close());

const person = async (c, id) => (await c.get('/api/people')).body.people.find(p => p.id === id);

test('фото: загрузка, проверка типа, лимит, порядок, удаление, модерация', async () => {
  const a = await srv.user('photos@example.ru');
  const b = await srv.user('viewer@example.ru');
  assert.equal((await a.post('/api/photos', { dataUrl: FAKE_IMG })).body.error, 'bad_image');
  assert.equal((await a.post('/api/photos', { dataUrl: 'data:text/html;base64,PGh0bWw+' })).body.error, 'bad_image');
  const big = 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(4.5 * 1024 * 1024)]).toString('base64');
  assert.equal((await a.post('/api/photos', { dataUrl: big })).status, 413);

  let photos;
  for (let i = 0; i < 10; i++) photos = (await a.post('/api/photos', { dataUrl: i % 2 ? PNG : JPEG })).body.photos;
  assert.equal(photos.length, 10);
  assert.ok(photos.every(p => p.status === 'pending' && /^\/uploads\/[a-f0-9]{32}\.(jpg|png)$/.test(p.src)));
  assert.equal((await a.post('/api/photos', { dataUrl: JPEG })).body.error, 'too_many');

  // Файл отдаётся с правильным типом.
  const file = await fetch(srv.base + photos[1].src);
  assert.equal(file.headers.get('content-type'), 'image/png');

  const ids = photos.map(p => p.id);
  const reordered = (await a.put('/api/photos/order', { ids: [ids[3], ids[0]] })).body.photos;
  assert.deepEqual(reordered.slice(0, 3).map(p => p.id), [ids[3], ids[0], ids[1]]);

  const afterDel = (await a.del(`/api/photos/${ids[9]}`)).body.photos;
  assert.equal(afterDel.length, 9);
  assert.equal((await fetch(srv.base + photos[9].src)).status, 404);
  assert.equal((await b.del(`/api/photos/${ids[0]}`)).status, 404);

  // На модерации чужим не видно.
  assert.deepEqual((await person(b, a.id)).media, []);
  const queue = await admin.get('/api/admin/queue');
  assert.equal(queue.status, 200);
  assert.ok(queue.body.photos.some(p => p.id === ids[3]));
  assert.equal((await b.get('/api/admin/queue')).status, 403);
  await admin.post('/api/admin/photo', { id: ids[3], approve: true });
  await admin.post('/api/admin/photo', { id: ids[0], approve: false });
  const media = (await person(b, a.id)).media;
  assert.deepEqual(media, [{ type: 'photo', src: reordered[0].src }]);
  const mine = (await a.get('/api/me')).body.photos;
  assert.equal(mine[0].status, 'approved');
  assert.equal(mine[1].status, 'rejected');

  // Гостям без входа тоже видны только одобренные фото.
  const guest = await srv.client().get('/api/people');
  assert.equal(guest.status, 200);
  assert.deepEqual(guest.body.people.find(p => p.id === a.id).media, media);
});

test('AUTO_APPROVE=1 одобряет фото сразу', async () => {
  const s2 = await startServer({ AUTO_APPROVE: '1' });
  try {
    const a = await s2.user('auto@example.ru');
    assert.equal((await a.post('/api/photos', { dataUrl: JPEG })).body.photos[0].status, 'approved');
  } finally { await s2.close(); }
});

test('список людей скрывает заблокированных и забаненных, визиты и гости', async () => {
  const me = await srv.user('me@example.ru');
  const x = await srv.user('x@example.ru', { name: 'Икс' });
  const y = await srv.user('y@example.ru', { name: 'Игрек' });
  const z = await srv.user('z@example.ru', { name: 'Зет' });
  let people = (await me.get('/api/people')).body.people;
  assert.ok(!people.some(p => p.id === me.id));
  assert.ok([x, y, z].every(u => people.some(p => p.id === u.id)));
  const px = people.find(p => p.id === x.id);
  assert.equal(px.online, true);
  assert.equal(px.email, undefined);

  await me.post('/api/block', { id: x.id });
  await y.post('/api/block', { id: me.id });
  srv.app.db.run('UPDATE users SET banned = 1 WHERE id = ?', z.id);
  people = (await me.get('/api/people')).body.people;
  assert.ok(![x, y, z].some(u => people.some(p => p.id === u.id)));
  assert.equal((await me.get(`/api/people/${x.id}`)).status, 404);
  assert.equal((await me.get(`/api/people/${y.id}`)).status, 404);
  assert.equal((await me.get(`/api/people/${z.id}`)).status, 404);
  assert.equal((await me.post('/api/like', { id: y.id })).status, 404);
  assert.deepEqual((await me.get('/api/state')).body.blocked, [x.id]);
  // Забаненный не может пользоваться сайтом.
  assert.equal((await z.get('/api/people/' + me.id)).body.error, 'banned');
  await me.post('/api/unblock', { id: x.id });
  assert.equal((await me.get(`/api/people/${x.id}`)).status, 200);

  // Визит: событие владельцу, гость виден только с VIP.
  const xs = await x.get('/api/state');
  assert.equal(xs.body.guestsCount, 1);
  assert.deepEqual(xs.body.guests, []);
  const visit = xs.body.events.find(e => e.kind === 'visit');
  assert.ok(visit && visit.who === undefined);
  setVip(srv.app, x.id);
  const xs2 = await x.get('/api/state');
  assert.equal(xs2.body.guests[0].id, me.id);
  assert.equal(xs2.body.events.find(e => e.kind === 'visit').who, me.id);
  // Повторный визит в течение часа не записывается.
  await me.get(`/api/people/${x.id}`);
  assert.equal((await x.get('/api/state')).body.events.filter(e => e.kind === 'visit').length, 1);
});

test('симпатии: лимит 30 в день, взаимность и события', async () => {
  const a = await srv.user('liker@example.ru');
  const targets = [];
  for (let i = 0; i < 31; i++) {
    const id = `t${String(i).padStart(3, "0")}`;
    srv.app.db.run("INSERT INTO users (id, email, name, birth, g, seek, city, created_at) VALUES (?, ?, 'Т', '1990-01-01', 'm', 'a', 'Тула', ?)", id, `t${i}@x.ru`, Date.now());
    targets.push(id);
  }
  for (let i = 0; i < 30; i++) assert.equal((await a.post('/api/like', { id: targets[i] })).status, 200);
  const limit = await a.post('/api/like', { id: targets[30] });
  assert.equal(limit.body.error, 'limit');
  assert.equal((await a.get('/api/state')).body.likesToday, 30);
  setVip(srv.app, a.id);
  assert.equal((await a.post('/api/like', { id: targets[30] })).status, 200);

  const b = await srv.user('likee@example.ru');
  const c = await srv.user('third@example.ru');
  const first = await b.post('/api/like', { id: c.id });
  assert.equal(first.body.match, false);
  const cState = await c.get('/api/state');
  assert.equal(cState.body.admirersCount, 1);
  assert.deepEqual(cState.body.admirers, []);
  const likeEv = cState.body.events.find(e => e.kind === 'like');
  assert.ok(likeEv && likeEv.who === undefined);

  const second = await c.post('/api/like', { id: b.id });
  assert.equal(second.body.match, true);
  for (const u of [b, c]) {
    const st = (await u.get('/api/state')).body;
    assert.deepEqual(st.matches, [u === b ? c.id : b.id]);
    assert.ok(st.events.some(e => e.kind === 'match' && e.who === (u === b ? c.id : b.id)));
  }
  // Письмо о взаимной симпатии (почта не настроена — письмо в outbox).
  assert.ok(srv.app.mailer.outbox.some(m => m.to === 'likee@example.ru' && m.kind === 'match'));

  await a.post('/api/pass', { id: b.id });
  assert.ok((await a.get('/api/state')).body.passes.includes(b.id));
});

test('настройки: невидимка и скрытие возраста только с VIP', async () => {
  const a = await srv.user('settings@example.ru');
  assert.equal((await a.put('/api/settings', { invisible: true })).body.error, 'vip_required');
  assert.equal((await a.put('/api/settings', { hideAge: true })).body.error, 'vip_required');
  const r = await a.put('/api/settings', { notifyEmail: false, lang: 'en' });
  assert.equal(r.body.user.notifyEmail, false);
  assert.equal(r.body.user.lang, 'en');
  setVip(srv.app, a.id);
  const v = await a.put('/api/settings', { invisible: true, hideAge: true });
  assert.equal(v.body.user.invisible, true);
  assert.equal(v.body.user.hideAge, true);

  // Невидимка не оставляет визитов, но остаётся в списке.
  const b = await srv.user('watched@example.ru');
  await a.get(`/api/people/${b.id}`);
  assert.equal((await b.get('/api/state')).body.guestsCount, 0);
  const p = await person(b, a.id);
  assert.equal(p.hideAge, true);
  assert.equal(p.online, false);
});

test('монеты: поднятие анкеты и подарки', async () => {
  const a = await srv.user('rich@example.ru');
  const b = await srv.user('gifted@example.ru');
  assert.equal((await a.post('/api/boost')).body.error, 'no_coins');
  setCoins(srv.app, a.id, 100);
  const boost = await a.post('/api/boost');
  assert.equal(boost.body.wallet.coins, 50);
  assert.ok(boost.body.wallet.boostUntil > Date.now() + 23 * 3600e3);
  const people = (await b.get('/api/people')).body.people;
  assert.equal(people[0].id, a.id);
  assert.equal(people[0].boosted, true);

  assert.equal((await a.post('/api/gift', { to: b.id, kind: 'diamond' })).body.field, 'kind');
  const g = await a.post('/api/gift', { to: b.id, kind: 'bear' });
  assert.equal(g.body.wallet.coins, 10);
  assert.equal((await a.post('/api/gift', { to: b.id, kind: 'star' })).body.error, 'no_coins');
  assert.equal((await a.post('/api/gift', { to: b.id, kind: 'rose' })).body.wallet.coins, 0);
  const ev = (await b.get('/api/state')).body.events.find(e => e.kind === 'gift');
  assert.equal(ev.who, a.id);
  const pb = await person(a, b.id);
  assert.deepEqual(pb.gifts.map(x => x.kind).sort(), ['bear', 'rose']);
  assert.equal(pb.gifts[0].from, a.id);
});
