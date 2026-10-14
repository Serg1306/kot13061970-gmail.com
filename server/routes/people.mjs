// Люди, состояние кабинета и опрос новостей (/api/sync).
import { fail } from '../http.mjs';
import {
  addEvent, eventOut, friendsOf, hiddenIds, isVip, likesToday, messageOut, peopleOut, visibleUser, walletOf,
} from '../model.mjs';

const VISIT_GAP = 3600 * 1000;
const SIGNAL_TTL = 60 * 1000;

export function postsOut(db, meId, hidden, limit = 100) {
  const rows = db.all(`SELECT p.*, (SELECT COUNT(*) FROM post_likes l WHERE l.post_id = p.id) AS likes,
      EXISTS(SELECT 1 FROM post_likes l WHERE l.post_id = p.id AND l.user_id = :me) AS liked
    FROM posts p ORDER BY p.t DESC, p.id DESC LIMIT 300`, { me: meId });
  return rows.filter(p => !hidden.has(p.author)).slice(0, limit).map(postOut);
}

export function postOut(p) {
  const o = { id: p.id, author: p.author, t: p.t, text: p.text, likes: Number(p.likes || 0), liked: Boolean(p.liked) };
  if (p.img) o.img = `/uploads/${p.img}`;
  return o;
}

// Лайкнули меня без взаимности (и не скрыты).
const admirerIds = (db, meId, hidden) => db.all(
  'SELECT l.from_id AS id FROM likes l WHERE l.to_id = :me AND NOT EXISTS (SELECT 1 FROM likes r WHERE r.from_id = :me AND r.to_id = l.from_id) ORDER BY l.t DESC',
  { me: meId }).map(r => r.id).filter(id => !hidden.has(id));

const guestList = (db, meId, hidden) => db.all('SELECT viewer_id AS id, t FROM visits WHERE owner_id = ? ORDER BY t DESC LIMIT 200', meId)
  .filter(g => !hidden.has(g.id)).map(g => ({ id: g.id, t: g.t }));

function counters(db, me, hidden) {
  const unread = db.all('SELECT from_id FROM messages WHERE to_id = ? AND read = 0', me.id).filter(m => !hidden.has(m.from_id)).length;
  return {
    unread,
    admirers: admirerIds(db, me.id, hidden).length,
    guests: guestList(db, me.id, hidden).length,
    friendsIn: friendsOf(db, me.id).in.length,
  };
}

export default function peopleRoutes(route) {
  // Список анкет работает и без входа (карусель и города на главной). С сессией — без себя и заблокированных.
  // Невидимки в списке есть: режим невидимки влияет только на визиты.
  route('GET', '/api/people', ({ app, user }) => {
    const { db } = app;
    const now = Date.now();
    const me = user ? user.id : '';
    const rows = db.all(`SELECT * FROM users u WHERE u.name IS NOT NULL AND u.banned = 0 AND u.id != :me
        AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.from_id = :me AND b.to_id = u.id) OR (b.from_id = u.id AND b.to_id = :me))
      ORDER BY (u.boost_until > :now) DESC, u.boost_until DESC, u.last_seen DESC LIMIT 200`, { me, now });
    return { people: peopleOut(db, rows, me || null, now) };
  }, { auth: 'optional' });

  route('GET', '/api/people/:id', ({ app, user, params, url }) => {
    const { db } = app;
    const other = visibleUser(db, user, params.id);
    if (!other) fail(404, 'not_found');
    // Визит записывается, если смотрящий не в режиме невидимки (невидимка работает только с VIP).
    // ?peek=1 — сайт догружает анкету для списка (например, автора сообщения), это не визит.
    if (!url.searchParams.has('peek') && !(user.invisible && isVip(user))) {
      const now = Date.now();
      const prev = db.get('SELECT t FROM visits WHERE viewer_id = ? AND owner_id = ?', user.id, other.id);
      if (!prev || now - prev.t >= VISIT_GAP) {
        db.run(`INSERT INTO visits (viewer_id, owner_id, t) VALUES (?, ?, ?)
          ON CONFLICT(viewer_id, owner_id) DO UPDATE SET t = excluded.t`, user.id, other.id, now);
        addEvent(db, other.id, 'visit', user.id);
      }
    }
    return { person: peopleOut(db, [other], user.id)[0] };
  });

  route('GET', '/api/state', ({ app, user }) => {
    const { db } = app;
    const me = user.id;
    const vip = isVip(user);
    const hidden = hiddenIds(db, me);
    const ids = sql => db.all(sql, me).map(r => r.id).filter(id => !hidden.has(id));
    const likes = ids('SELECT to_id AS id FROM likes WHERE from_id = ? ORDER BY t DESC');
    const matches = ids('SELECT l.to_id AS id FROM likes l JOIN likes r ON r.from_id = l.to_id AND r.to_id = l.from_id WHERE l.from_id = ? ORDER BY MAX(l.t, r.t) DESC');
    const admirers = admirerIds(db, me, hidden);
    const guests = guestList(db, me, hidden);

    // Переписки: последние 50 сообщений с каждым собеседником (включая поддержку).
    const partners = db.all(`SELECT CASE WHEN from_id = :me THEN to_id ELSE from_id END AS id, MAX(t) AS last
      FROM messages WHERE from_id = :me OR to_id = :me GROUP BY 1 ORDER BY last DESC`, { me });
    const chats = {};
    for (const { id } of partners) {
      if (hidden.has(id)) continue;
      chats[id] = db.all(`SELECT * FROM (SELECT * FROM messages WHERE (from_id = :me AND to_id = :o) OR (from_id = :o AND to_id = :me)
        ORDER BY t DESC, id DESC LIMIT 50) ORDER BY t, id`, { me, o: id }).map(messageOut);
    }
    const events = db.all('SELECT * FROM events WHERE user_id = ? ORDER BY t DESC, id DESC LIMIT 100', me)
      .filter(e => !e.who || !hidden.has(e.who)).map(e => eventOut(e, vip));

    return {
      likes,
      passes: ids('SELECT to_id AS id FROM passes WHERE from_id = ?'),
      matches,
      ...(vip ? { admirers } : { admirers: [] }),
      admirersCount: admirers.length,
      ...(vip ? { guests } : { guests: [] }),
      guestsCount: guests.length,
      friends: friendsOf(db, me),
      blocked: db.all('SELECT to_id AS id FROM blocks WHERE from_id = ?', me).map(r => r.id),
      chats,
      events,
      posts: postsOut(db, me, hidden),
      likesToday: likesToday(db, me),
      wallet: walletOf(user),
    };
  });

  // Новое за окно (since, now]. now отстаёт на 1 мс, чтобы запись, сделанная в ту же миллисекунду после ответа,
  // попала в следующий опрос, а не потерялась.
  route('GET', '/api/sync', ({ app, user, url }) => {
    const { db } = app;
    const me = user.id;
    const now = Date.now() - 1;
    const since = Math.max(0, Number(url.searchParams.get('since')) || 0);
    const hidden = hiddenIds(db, me);
    const vip = isVip(user);
    const win = { me, since, now };
    const messages = db.all(`SELECT * FROM messages WHERE (to_id = :me OR from_id = :me) AND t > :since AND t <= :now ORDER BY t, id LIMIT 500`, win)
      .filter(m => !hidden.has(m.from_id === me ? m.to_id : m.from_id)).map(messageOut);
    const events = db.all('SELECT * FROM events WHERE user_id = :me AND t > :since AND t <= :now ORDER BY t, id LIMIT 200', win)
      .filter(e => !e.who || !hidden.has(e.who)).map(e => eventOut(e, vip));
    const signals = db.all('SELECT * FROM signals WHERE to_id = :me AND t > :since AND t <= :now AND t > :fresh ORDER BY t, id', { ...win, fresh: now - SIGNAL_TTL })
      .filter(s => !hidden.has(s.from_id)).map(s => ({ id: s.id, from: s.from_id, t: s.t, data: JSON.parse(s.data) }));
    return { now, messages, events, signals, wallet: walletOf(user), counters: counters(db, user, hidden) };
  }, { auth: 'user', banned: true });
}

