// Модерация: фото, проверка селфи, жалобы, поддержка, статистика. Доступ — только почтам из ADMIN_EMAILS.
import path from 'node:path';
import { fail, serveFile } from '../http.mjs';
import { textFor } from '../langs.mjs';
import { CATALOG } from '../tkassa.mjs';
import { isSafeName } from '../media.mjs';
import { ONLINE_MS, addEvent, dayStartMsk, messageOut, uploadSrc } from '../model.mjs';
import { REASONS, deleteUser, destroySelfie } from '../pd.mjs';
import { checkOrder, refundOrder } from './pay.mjs';
import { normEmail } from './auth.mjs';
import { normPhone } from '../sms.mjs';

const VERIFY_TEXT = {
  ru: { ok: 'Фото проверено: на анкете появился значок «фото проверено».', no: 'Проверка фото не пройдена. Попробуйте ещё раз: лицо должно быть хорошо видно, жест — как в задании.' },
  en: { ok: 'Photo verified: your profile now has the verified badge.', no: 'Photo verification failed. Please try again: your face must be clearly visible and the gesture must match.' },
  uk: { ok: 'Фото перевірено: в анкеті з\'явився значок «фото перевірено».', no: 'Перевірку фото не пройдено. Спробуйте ще раз: обличчя має бути добре видно, жест — як у завданні.' },
  kk: { ok: 'Сурет тексерілді: анкетада «сурет тексерілген» белгісі пайда болды.', no: 'Сурет тексеруден өтпеді. Қайталап көріңіз: бет анық көрінуі, ым тапсырмадағыдай болуы керек.' },
  uz: { ok: 'Rasm tekshirildi: anketada «rasm tekshirilgan» belgisi paydo boʻldi.', no: 'Rasm tekshiruvdan oʻtmadi. Qayta urinib koʻring: yuz yaxshi koʻrinishi, imo-ishora topshiriqdagidek boʻlishi kerak.' },
  de: { ok: 'Foto geprüft: Dein Profil hat jetzt das Abzeichen „Foto geprüft“.', no: 'Die Fotoprüfung ist fehlgeschlagen. Versuch es noch einmal: Das Gesicht muss gut zu sehen sein und die Geste der Aufgabe entsprechen.' },
  es: { ok: 'Foto verificada: tu perfil ya tiene la insignia «foto verificada».', no: 'La verificación de la foto no se superó. Inténtalo de nuevo: la cara debe verse bien y el gesto debe ser como en la tarea.' },
  fr: { ok: 'Photo vérifiée : votre profil porte désormais le badge « photo vérifiée ».', no: 'La vérification de la photo a échoué. Réessayez : le visage doit être bien visible et le geste conforme à la consigne.' },
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
    // Регистрации по рекламным меткам: всего, за 30 дней и сколько из них платили.
    sources: db.all(`SELECT COALESCE(src, 'без метки') AS src, COUNT(*) AS users, SUM(created_at >= :since) AS month,
        SUM(EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id AND o.status = 'paid')) AS payers
      FROM users u GROUP BY COALESCE(src, 'без метки') ORDER BY users DESC LIMIT 50`, { since: now - 30 * 864e5 }),
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

  route('POST', '/api/admin/verify', ({ app, body, user }) => {
    const { db, config } = app;
    const u = userById(db, String(body.userId));
    if (!u) fail(404, 'not_found');
    const t = textFor(VERIFY_TEXT, u.lang);
    db.run('UPDATE users SET verify_status = ?, verify_file = NULL WHERE id = ?', body.approve ? 'approved' : 'rejected', u.id);
    addEvent(db, u.id, 'system', null, body.approve ? t.ok : t.no);
    destroySelfie(app, u, user.email);
    return { ok: true };
  }, opts);

  route('POST', '/api/admin/report', ({ app, body }) => {
    const { db } = app;
    const rep = db.get('SELECT * FROM reports WHERE id = ?', Number(body.id));
    if (!rep) fail(404, 'not_found');
    if (body.action === 'ban') {
      db.tx(() => {
        db.run('UPDATE users SET banned = 1, ban_reason = ? WHERE id = ?', rep.reason, rep.target_id);
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

  // ---------- Платежи ----------

  route('GET', '/api/admin/orders', ({ app, url }) => {
    const { db } = app;
    const status = String(url.searchParams.get('status') || '');
    if (status && !['new', 'paid', 'refunded'].includes(status)) fail(400, 'invalid', { field: 'status' });
    const q = String(url.searchParams.get('q') || '').trim().toLowerCase().slice(0, 100);
    const like = '%' + q.replace(/[\\%_]/g, c => '\\' + c) + '%';
    const orders = db.all(`SELECT o.*, u.email, u.name FROM orders o LEFT JOIN users u ON u.id = o.user_id
      WHERE (:status = '' OR o.status = :status)
        AND (:q = '' OR o.inv_id = :q OR lower(u.email) LIKE :like ESCAPE '\\' OR lower(u.name) LIKE :like ESCAPE '\\')
      ORDER BY o.created_at DESC LIMIT 200`, { status, q, like }).map(orderOut);
    const now = Date.now();
    const sum = (where, ...p) => db.get(`SELECT COALESCE(SUM(price), 0) AS s, COUNT(*) AS n FROM orders WHERE ${where}`, ...p);
    const t = sum("status = 'paid' AND paid_at >= ?", dayStartMsk(now));
    const m = sum("status = 'paid' AND paid_at >= ?", monthStartMsk(now));
    const a = sum("status = 'paid'");
    const r = sum("status = 'refunded'");
    return {
      orders,
      totals: { today: t.s, todayCount: t.n, month: m.s, monthCount: m.n, all: a.s, allCount: a.n, refunded: r.s, refundedCount: r.n },
    };
  }, opts);

  route('POST', '/api/admin/refund', ({ app, body }) => {
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : '';
    return { order: orderOut(refundOrder(app.db, String(body.invId || ''), note)) };
  }, opts);

  route('POST', '/api/admin/order-check', ({ app, body }) => checkOrder(app, String(body.invId || '')), opts);

  // ---------- Персональные данные ----------

  route('GET', '/api/admin/destruction', ({ app, url }) => {
    const from = dateMsk(url.searchParams.get('from'), 0) ?? 0;
    const to = dateMsk(url.searchParams.get('to'), 1) ?? Date.now() + 1;
    const rows = app.db.all('SELECT * FROM pd_destruction WHERE at >= ? AND at < ? ORDER BY at DESC, id DESC LIMIT 5000', from, to).map(r => ({
      id: r.id, at: r.at, subjectRef: r.subject_ref, emailMasked: r.email_masked, categories: r.categories,
      reason: r.reason, method: r.method, operator: r.operator,
    }));
    return { rows };
  }, opts);

  // Полное удаление пользователя модератором (например, по письму об отзыве согласия).
  route('POST', '/api/admin/delete-user', ({ app, body, user }) => {
    const { db } = app;
    const reason = body.reason || 'user_request';
    if (!REASONS.includes(reason)) fail(400, 'invalid', { field: 'reason' });
    const target = body.userId
      ? db.get('SELECT * FROM users WHERE id = ?', String(body.userId))
      : db.get('SELECT * FROM users WHERE email = ?', String(body.email || '').includes('@') ? normEmail(body.email) : normPhone(body.email));
    if (!target) fail(404, 'not_found');
    if (target.id === user.id) fail(400, 'self');
    deleteUser(app, target.id, { reason, operator: user.email });
    return { ok: true };
  }, opts);
}


const orderOut = o => ({
  invId: o.inv_id, userId: o.user_id, email: o.email ?? null, name: o.name ?? null, product: o.product,
  title: CATALOG[o.product]?.title || o.product, price: o.price, status: o.status,
  createdAt: o.created_at, paidAt: o.paid_at, refundedAt: o.refunded_at ?? null, refundNote: o.refund_note ?? null,
  lastCheckedAt: o.last_checked_at ?? null,
});

// Начало месяца по Москве.
function monthStartMsk(now) {
  const off = 3 * 3600e3;
  const d = new Date(now + off);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - off;
}

// 'YYYY-MM-DD' → начало этих суток по Москве (+ addDays дней) или null.
function dateMsk(s, addDays) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) return null;
  const t = Date.parse(`${s}T00:00:00+03:00`);
  return Number.isNaN(t) ? null : t + addDays * 86400e3;
}
