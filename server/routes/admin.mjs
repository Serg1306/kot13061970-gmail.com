// Модерация: фото, проверка селфи, жалобы, поддержка, статистика. Доступ — только почтам из ADMIN_EMAILS.
import path from 'node:path';
import { fail, serveFile } from '../http.mjs';
import { isSafeName, removeFile } from '../media.mjs';
import { ONLINE_MS, addEvent, dayStartMsk, messageOut, uploadSrc } from '../model.mjs';

const VERIFY_TEXT = {
  ru: { ok: 'Фото проверено: на анкете появился значок «фото проверено».', no: 'Проверка фото не пройдена. Попробуйте ещё раз: лицо должно быть хорошо видно, жест — как в задании.' },
  en: { ok: 'Photo verified: your profile now has the verified badge.', no: 'Photo verification failed. Please try again: your face must be clearly visible and the gesture must match.' },
};

const brief = u => (u ? { id: u.id, name: u.name, email: u.email, banned: Boolean(u.banned) } : null);
const mainPhoto = (db, userId) => {
  const p = db.get('SELECT file FROM photos WHERE user_id = ? ORDER BY pos, id LIMIT 1', userId);
  return p ? uploadSrc(p.file) : null;
};
const userById = (db, id) => db.get('SELECT * FROM users WHERE id = ?', id);

function supportThreads(db) {
  const rows = db.all(`SELECT CASE WHEN from_id = 'support' THEN to_id ELSE from_id END AS uid, MAX(t) AS last,
      SUM(CASE WHEN to_id = 'support' AND read = 0 THEN 1 ELSE 0 END) AS unread,
      SUM(CASE WHEN to_id = 'support' THEN 1 ELSE 0 END) AS incoming
    FROM messages WHERE from_id = 'support' OR to_id = 'support' GROUP BY uid HAVING incoming > 0 ORDER BY unread > 0 DESC, last DESC LIMIT 200`);
  return rows.map(r => {
    const lastMsg = db.get(`SELECT * FROM messages WHERE (from_id = 'support' AND to_id = :u) OR (from_id = :u AND to_id = 'support')
      ORDER BY t DESC, id DESC LIMIT 1`, { u: r.uid });
    return { user: brief(userById(db, r.uid)), unread: r.unread, last: lastMsg ? messageOut(lastMsg) : null };
  }).filter(r => r.user);
}

function stats(db) {
  const now = Date.now();
  const paid = db.get("SELECT COUNT(*) AS n, COALESCE(SUM(price), 0) AS sum FROM orders WHERE status = 'paid'");
  return {
    users: db.get('SELECT COUNT(*) AS n FROM users WHERE name IS NOT NULL').n,
    today: db.get('SELECT COUNT(*) AS n FROM users WHERE created_at >= ?', dayStartMsk(now)).n,
    online: db.get('SELECT COUNT(*) AS n FROM users WHERE last_seen >= ?', now - ONLINE_MS).n,
    paid: paid.n,
    revenue: paid.sum,
    paidToday: db.get("SELECT COUNT(*) AS n FROM orders WHERE status = 'paid' AND paid_at >= ?", dayStartMsk(now)).n,
    messagesToday: db.get('SELECT COUNT(*) AS n FROM messages WHERE t >= ?', dayStartMsk(now)).n,
    banned: db.get('SELECT COUNT(*) AS n FROM users WHERE banned = 1').n,
  };
}

export default function adminRoutes(route) {
  const opts = { auth: 'admin' };

  route('GET', '/api/admin/queue', ({ app }) => {
    const { db } = app;
    const photos = db.all(`SELECT p.id, p.user_id, p.file, p.created_at, u.name, u.email FROM photos p JOIN users u ON u.id = p.user_id
      WHERE p.status = 'pending' ORDER BY p.created_at LIMIT 200`)
      .map(p => ({ id: p.id, userId: p.user_id, name: p.name, email: p.email, src: uploadSrc(p.file), t: p.created_at }));
    const verifications = db.all("SELECT * FROM users WHERE verify_status = 'pending' ORDER BY verify_at LIMIT 100").map(u => ({
      userId: u.id, name: u.name, email: u.email, gesture: u.verify_gesture, t: u.verify_at,
      selfie: u.verify_file ? `/api/admin/file/${u.verify_file}` : null, photo: mainPhoto(db, u.id),
    }));
    const reports = db.all("SELECT * FROM reports WHERE status = 'open' ORDER BY t LIMIT 200").map(r => ({
      id: r.id, t: r.t, reason: r.reason, text: r.text,
      from: brief(userById(db, r.from_id)),
      target: { ...brief(userById(db, r.target_id)), photo: mainPhoto(db, r.target_id) },
      count: db.get("SELECT COUNT(*) AS n FROM reports WHERE target_id = ? AND status = 'open'", r.target_id).n,
    }));
    const banned = db.all('SELECT * FROM users WHERE banned = 1 ORDER BY created_at DESC LIMIT 200').map(brief);
    return { photos, verifications, reports, support: supportThreads(db), banned, stats: stats(db) };
  }, opts);

  route('POST', '/api/admin/photo', ({ app, body }) => {
    const r = app.db.run("UPDATE photos SET status = ? WHERE id = ?", body.approve ? 'approved' : 'rejected', Number(body.id));
    if (!r.changes) fail(404, 'not_found');
    return { ok: true };
  }, opts);

  route('POST', '/api/admin/verify', ({ app, body }) => {
    const { db, config } = app;
    const u = userById(db, String(body.userId));
    if (!u) fail(404, 'not_found');
    const t = VERIFY_TEXT[u.lang] || VERIFY_TEXT.ru;
    db.run('UPDATE users SET verify_status = ?, verify_file = NULL WHERE id = ?', body.approve ? 'approved' : 'rejected', u.id);
    addEvent(db, u.id, 'system', null, body.approve ? t.ok : t.no);
    removeFile(config.privateDir, u.verify_file);
    return { ok: true };
  }, opts);

  route('POST', '/api/admin/report', ({ app, body }) => {
    const { db } = app;
    const rep = db.get('SELECT * FROM reports WHERE id = ?', Number(body.id));
    if (!rep) fail(404, 'not_found');
    if (body.action === 'ban') {
      db.tx(() => {
        db.run('UPDATE users SET banned = 1 WHERE id = ?', rep.target_id);
        db.run("UPDATE reports SET status = 'banned' WHERE target_id = ? AND status = 'open'", rep.target_id);
      });
    } else if (body.action === 'dismiss') {
      db.run("UPDATE reports SET status = 'dismissed' WHERE id = ?", rep.id);
    } else {
      fail(400, 'invalid', { field: 'action' });
    }
    return { ok: true };
  }, opts);

  route('POST', '/api/admin/unban', ({ app, body }) => {
    const r = app.db.run('UPDATE users SET banned = 0 WHERE id = ?', String(body.userId));
    if (!r.changes) fail(404, 'not_found');
    return { ok: true };
  }, opts);

  // Переписка с пользователем; открытие отмечает его сообщения прочитанными.
  route('GET', '/api/admin/support', ({ app, url }) => {
    const { db } = app;
    const u = userById(db, String(url.searchParams.get('userId') || ''));
    if (!u) fail(404, 'not_found');
    db.run("UPDATE messages SET read = 1 WHERE from_id = ? AND to_id = 'support' AND read = 0", u.id);
    const messages = db.all(`SELECT * FROM (SELECT * FROM messages WHERE (from_id = 'support' AND to_id = :u) OR (from_id = :u AND to_id = 'support')
      ORDER BY t DESC, id DESC LIMIT 200) ORDER BY t, id`, { u: u.id }).map(messageOut);
    return { user: brief(u), messages };
  }, opts);

  route('POST', '/api/admin/support', ({ app, body }) => {
    const { db, notify } = app;
    const u = userById(db, String(body.userId));
    if (!u) fail(404, 'not_found');
    const msg = typeof body.text === 'string' ? body.text.trim() : '';
    if (!msg || msg.length > 4000) fail(400, 'invalid', { field: 'text' });
    const r = db.run("INSERT INTO messages (from_id, to_id, t, kind, text) VALUES ('support', ?, ?, 'text', ?)", u.id, Date.now(), msg);
    db.run("UPDATE messages SET read = 1 WHERE from_id = ? AND to_id = 'support' AND read = 0", u.id);
    notify.support(u.id);
    return { message: messageOut(db.get('SELECT * FROM messages WHERE id = ?', r.lastInsertRowid)) };
  }, opts);

  // Селфи для проверки лежат вне /uploads и отдаются только модераторам.
  route('GET', '/api/admin/file/:name', ({ app, req, res, params }) => {
    if (!isSafeName(params.name) || !serveFile(req, res, path.join(app.config.privateDir, params.name), 'private, no-store')) fail(404, 'not_found');
  }, opts);
}

