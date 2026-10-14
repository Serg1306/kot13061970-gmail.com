// Действия: симпатии, сообщения, друзья, блокировки, жалобы, лента, монеты, звонки, push-подписки.
import { fail } from '../http.mjs';
import { decodeAudio, decodeImage, removeFile, saveFile } from '../media.mjs';
import {
  BOOST_COST, DAY, FREE_LIKES, GIFTS, SUPPORT, addEvent, canTalk, friendsOf, hiddenIds, isVip, likesToday,
  messageOut, mutual, visibleUser, walletOf,
} from '../model.mjs';
import { endpointAllowed } from '../push.mjs';
import { postOut } from './people.mjs';

const REASONS = ['fake', 'scam', 'rude', 'photos', 'minor', 'other'];
const str = v => (typeof v === 'string' ? v.trim() : '');

// Номер карты: 13–19 цифр подряд, допускаются пробелы и дефисы между ними.
const CARD_RE = /(?:\d[ -]?){12,18}\d/;
const LINK_RE = /(?:https?:\/\/|www\.|t\.me\/|wa\.me\/|[a-z0-9-]+\.(?:ru|com|net|org|рф|su|me|io|info|ly|link|site|online|xyz|app|club|pro|biz|cc)(?![a-z0-9]))/i;
const PHONE_RE = /(?:\+?\d[\s().-]*){10,}/;

export function checkText(text, linksAllowed) {
  if (CARD_RE.test(text)) fail(400, 'blocked_card');
  if (!linksAllowed && (LINK_RE.test(text) || PHONE_RE.test(text))) fail(400, 'blocked_link');
}

const wrote = (db, from, to) => Boolean(db.get('SELECT 1 FROM messages WHERE from_id = ? AND to_id = ? LIMIT 1', from, to));
const fresh = (db, id) => db.get('SELECT * FROM users WHERE id = ?', id);

function target(db, me, id) {
  const other = visibleUser(db, me, id);
  if (!other) fail(404, 'not_found');
  return other;
}

function insertMessage(app, from, to, fields) {
  const { db, notify } = app;
  const r = db.run('INSERT INTO messages (from_id, to_id, t, kind, text, src, dur) VALUES (?, ?, ?, ?, ?, ?, ?)',
    from.id, to, Date.now(), fields.kind, fields.text ?? null, fields.src ?? null, fields.dur ?? null);
  if (to !== SUPPORT) notify.message(from, to);
  return messageOut(db.get('SELECT * FROM messages WHERE id = ?', r.lastInsertRowid));
}

function checkTalk(app, user, to) {
  if (typeof to !== 'string' || !to) fail(400, 'invalid', { field: 'to' });
  if (to === SUPPORT) return;
  if (user.banned) fail(403, 'banned');
  if (!user.name) fail(409, 'profile_required');
  if (!canTalk(app.db, user, to)) fail(403, 'not_allowed');
}

export default function actionRoutes(route) {
  route('POST', '/api/like', ({ app, user, body }) => {
    const { db, notify } = app;
    const other = target(db, user, body.id);
    if (db.get('SELECT 1 FROM likes WHERE from_id = ? AND to_id = ?', user.id, other.id)) {
      return { match: mutual(db, user.id, other.id), likesToday: likesToday(db, user.id) };
    }
    if (!isVip(user) && likesToday(db, user.id) >= FREE_LIKES) fail(429, 'limit');
    const match = db.tx(() => {
      db.run('INSERT INTO likes (from_id, to_id, t) VALUES (?, ?, ?)', user.id, other.id, Date.now());
      db.run('DELETE FROM passes WHERE from_id = ? AND to_id = ?', user.id, other.id);
      const m = mutual(db, user.id, other.id);
      if (m) {
        addEvent(db, user.id, 'match', other.id);
        addEvent(db, other.id, 'match', user.id);
      } else {
        addEvent(db, other.id, 'like', user.id);
      }
      return m;
    });
    if (match) notify.match(user, other.id);
    return { match, likesToday: likesToday(db, user.id) };
  });

  route('POST', '/api/pass', ({ app, user, body }) => {
    const other = target(app.db, user, body.id);
    app.db.run('INSERT OR REPLACE INTO passes (from_id, to_id, t) VALUES (?, ?, ?)', user.id, other.id, Date.now());
    return { ok: true };
  });

  route('POST', '/api/messages', ({ app, user, body }) => {
    app.limiter.check(`msg:${user.id}`, 30, 60e3);
    checkTalk(app, user, body.to);
    const text = str(body.text);
    if (!text || text.length > 2000) fail(400, 'invalid', { field: 'text' });
    checkText(text, body.to === SUPPORT || wrote(app.db, body.to, user.id));
    return { message: insertMessage(app, user, body.to, { kind: 'text', text }) };
  }, { auth: 'user', banned: true });

  route('POST', '/api/messages/voice', ({ app, user, body }) => {
    app.limiter.check(`msg:${user.id}`, 30, 60e3);
    checkTalk(app, user, body.to);
    const dur = Math.round(Number(body.dur));
    if (!Number.isFinite(dur) || dur < 1 || dur > 120) fail(400, 'invalid', { field: 'dur' });
    const src = saveFile(app.config.uploadsDir, decodeAudio(body.dataUrl));
    return { message: insertMessage(app, user, body.to, { kind: 'voice', src, dur }) };
  }, { auth: 'user', banned: true });

  route('POST', '/api/messages/read', ({ app, user, body }) => {
    if (typeof body.with !== 'string') fail(400, 'invalid', { field: 'with' });
    app.db.run('UPDATE messages SET read = 1 WHERE from_id = ? AND to_id = ? AND read = 0', body.with, user.id);
    return { ok: true };
  }, { auth: 'user', banned: true });

  route('POST', '/api/friends', ({ app, user, body }) => {
    const { db, notify } = app;
    const id = body.id;
    const me = user.id;
    const now = Date.now();
    const row = (a, b) => db.get('SELECT * FROM friends WHERE from_id = ? AND to_id = ?', a, b);
    switch (body.action) {
      case 'add': {
        target(db, user, id);
        const theirs = row(id, me);
        if (theirs) {
          if (theirs.status === 'pending') {
            db.run("UPDATE friends SET status = 'ok', t = ? WHERE from_id = ? AND to_id = ?", now, id, me);
            addEvent(db, id, 'friend_ok', me);
          }
        } else if (!row(me, id)) {
          db.run("INSERT INTO friends (from_id, to_id, status, t) VALUES (?, ?, 'pending', ?)", me, id, now);
          addEvent(db, id, 'friend_req', me);
          notify.friendReq(user, id);
        }
        break;
      }
      case 'accept': {
        const r = db.run("UPDATE friends SET status = 'ok', t = ? WHERE from_id = ? AND to_id = ? AND status = 'pending'", now, id, me);
        if (r.changes) addEvent(db, id, 'friend_ok', me);
        break;
      }
      case 'decline':
        db.run("DELETE FROM friends WHERE from_id = ? AND to_id = ? AND status = 'pending'", id, me);
        break;
      case 'cancel':
        db.run("DELETE FROM friends WHERE from_id = ? AND to_id = ? AND status = 'pending'", me, id);
        break;
      case 'remove':
        db.run("DELETE FROM friends WHERE status = 'ok' AND ((from_id = :me AND to_id = :id) OR (from_id = :id AND to_id = :me))", { me, id: String(id) });
        break;
      default:
        fail(400, 'invalid', { field: 'action' });
    }
    return { friends: friendsOf(db, me) };
  });

  const blockedList = (db, me) => db.all('SELECT to_id AS id FROM blocks WHERE from_id = ? ORDER BY t', me).map(r => r.id);

  // Блокировка убирает взаимность и дружбу; переписка остаётся в базе, но скрыта обоим.
  route('POST', '/api/block', ({ app, user, body }) => {
    const { db } = app;
    const id = body.id;
    if (typeof id !== 'string' || id === user.id || !db.get('SELECT 1 FROM users WHERE id = ?', id)) fail(404, 'not_found');
    db.tx(() => {
      db.run('INSERT OR IGNORE INTO blocks (from_id, to_id, t) VALUES (?, ?, ?)', user.id, id, Date.now());
      db.run('DELETE FROM likes WHERE (from_id = :me AND to_id = :id) OR (from_id = :id AND to_id = :me)', { me: user.id, id });
      db.run('DELETE FROM friends WHERE (from_id = :me AND to_id = :id) OR (from_id = :id AND to_id = :me)', { me: user.id, id });
    });
    return { blocked: blockedList(db, user.id) };
  });

  route('POST', '/api/unblock', ({ app, user, body }) => {
    app.db.run('DELETE FROM blocks WHERE from_id = ? AND to_id = ?', user.id, String(body.id));
    return { blocked: blockedList(app.db, user.id) };
  });

  route('POST', '/api/report', ({ app, user, body }) => {
    const { db, limiter } = app;
    limiter.check(`report:${user.id}`, 10, 3600e3);
    if (!REASONS.includes(body.reason)) fail(400, 'invalid', { field: 'reason' });
    const text = str(body.text);
    if (text.length > 1000) fail(400, 'invalid', { field: 'text' });
    if (typeof body.id !== 'string' || body.id === user.id || !db.get('SELECT 1 FROM users WHERE id = ?', body.id)) fail(404, 'not_found');
    db.run("INSERT INTO reports (from_id, target_id, reason, text, t, status) VALUES (?, ?, ?, ?, ?, 'open')", user.id, body.id, body.reason, text, Date.now());
    return { ok: true };
  });

  route('POST', '/api/posts', ({ app, user, body }) => {
    const { db, config, limiter } = app;
    limiter.check(`post:${user.id}`, 20, 3600e3);
    const text = str(body.text);
    if (text.length > 1000) fail(400, 'invalid', { field: 'text' });
    if (!text && !body.dataUrl) fail(400, 'invalid', { field: 'text' });
    if (text) checkText(text, false);
    const img = body.dataUrl ? saveFile(config.uploadsDir, decodeImage(body.dataUrl)) : null;
    const r = db.run('INSERT INTO posts (author, t, text, img) VALUES (?, ?, ?, ?)', user.id, Date.now(), text, img);
    return { post: postOut(db.get('SELECT *, 0 AS likes, 0 AS liked FROM posts WHERE id = ?', r.lastInsertRowid)) };
  });

  route('DELETE', '/api/posts/:id', ({ app, user, params }) => {
    const { db, config } = app;
    const post = db.get('SELECT * FROM posts WHERE id = ? AND author = ?', Number(params.id), user.id);
    if (!post) fail(404, 'not_found');
    db.run('DELETE FROM posts WHERE id = ?', post.id);
    if (post.img) removeFile(config.uploadsDir, post.img);
    return { ok: true };
  });

  route('POST', '/api/posts/:id/like', ({ app, user, params }) => {
    const { db } = app;
    const post = db.get('SELECT * FROM posts WHERE id = ?', Number(params.id));
    if (!post || hiddenIds(db, user.id).has(post.author)) fail(404, 'not_found');
    const del = db.run('DELETE FROM post_likes WHERE post_id = ? AND user_id = ?', post.id, user.id);
    if (!del.changes) db.run('INSERT INTO post_likes (post_id, user_id) VALUES (?, ?)', post.id, user.id);
    const likes = db.get('SELECT COUNT(*) AS n FROM post_likes WHERE post_id = ?', post.id).n;
    return { likes, liked: !del.changes };
  });

  route('POST', '/api/boost', ({ app, user }) => {
    const { db } = app;
    const now = Date.now();
    const r = db.run('UPDATE users SET coins = coins - ?, boost_until = MAX(boost_until, ?) + ? WHERE id = ? AND coins >= ?',
      BOOST_COST, now, DAY, user.id, BOOST_COST);
    if (!r.changes) fail(400, 'no_coins');
    return { wallet: walletOf(fresh(db, user.id)) };
  });

  route('POST', '/api/gift', ({ app, user, body }) => {
    const { db } = app;
    const price = GIFTS[body.kind];
    if (!price) fail(400, 'invalid', { field: 'kind' });
    const other = target(db, user, body.to);
    db.tx(() => {
      const r = db.run('UPDATE users SET coins = coins - ? WHERE id = ? AND coins >= ?', price, user.id, price);
      if (!r.changes) fail(400, 'no_coins');
      db.run('INSERT INTO gifts (from_id, to_id, kind, t) VALUES (?, ?, ?, ?)', user.id, other.id, body.kind, Date.now());
      addEvent(db, other.id, 'gift', user.id, body.kind);
    });
    return { wallet: walletOf(fresh(db, user.id)) };
  });

  // Сигнализация WebRTC: сервер только пересылает data адресату через /api/sync.
  route('POST', '/api/call/signal', ({ app, user, body }) => {
    const { db, limiter, notify } = app;
    limiter.check(`signal:${user.id}`, 300, 60e3);
    if (body.to === SUPPORT) fail(403, 'not_allowed');
    checkTalk(app, user, body.to);
    const data = body.data;
    if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.type !== 'string' || data.type.length > 20) {
      fail(400, 'invalid', { field: 'data' });
    }
    const json = JSON.stringify(data);
    if (json.length > 32 * 1024) fail(413, 'too_large');
    const r = db.run('INSERT INTO signals (from_id, to_id, t, data) VALUES (?, ?, ?, ?)', user.id, body.to, Date.now(), json);
    if (data.type === 'offer') notify.call(user, body.to);
    return { ok: true, id: Number(r.lastInsertRowid) };
  });

  route('POST', '/api/push/subscribe', ({ app, user, body }) => {
    const s = body.subscription;
    const endpoint = s && typeof s.endpoint === 'string' ? s.endpoint : '';
    const p256dh = s?.keys?.p256dh, auth = s?.keys?.auth;
    if (!endpoint || endpoint.length > 1000 || typeof p256dh !== 'string' || typeof auth !== 'string' || p256dh.length > 200 || auth.length > 100) {
      fail(400, 'invalid', { field: 'subscription' });
    }
    if (!endpointAllowed(endpoint, app.config.pushAllowLocal)) fail(400, 'invalid', { field: 'endpoint' });
    app.db.run(`INSERT INTO push_subs (endpoint, user_id, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
    endpoint, user.id, p256dh, auth, Date.now());
    return { ok: true };
  }, { auth: 'user' });

  route('POST', '/api/push/unsubscribe', ({ app, user, body }) => {
    app.db.run('DELETE FROM push_subs WHERE endpoint = ? AND user_id = ?', String(body.endpoint || ''), user.id);
    return { ok: true };
  }, { auth: 'user', banned: true });
}
