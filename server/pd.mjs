// Персональные данные (152-ФЗ): удаление аккаунта с записью в журнал уничтожения,
// запрет повторной регистрации забаненных, выгрузка данных по запросу субъекта (ст. 14).
import crypto from 'node:crypto';
import { detailsOut } from './options.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { CATALOG } from './tkassa.mjs';
import { removeFile } from './media.mjs';
import { uploadSrc } from './model.mjs';

export const DESTRUCTION_METHOD = 'удаление из БД и файлов';
export const REASONS = ['user_request', 'ban', 'retention', 'consent_withdrawn'];
export const ACCOUNT_CATEGORIES = 'e-mail; анкета (имя, дата рождения, пол, город, о себе); фото; селфи для проверки; '
  + 'сообщения и голосовые; посты; симпатии, визиты, друзья, блокировки; подарки; push-подписки; '
  + 'сессии; согласия (счета об оплате обезличены и хранятся для бухгалтерского учёта)';
export const SELFIE_CATEGORY = 'селфи для проверки';
const BAN_KEEP_MS = 3 * 365 * 24 * 3600 * 1000;

// Секрет сервера для обезличенных ссылок и хэшей почт: DATA_DIR/secret.key, создаётся при первом запуске.
export function loadSecret(dataDir) {
  const file = path.join(dataDir, 'secret.key');
  try {
    const s = fs.readFileSync(file, 'utf8').trim();
    if (s.length >= 32) return s;
  } catch { /* файла ещё нет */ }
  const s = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(file, s, { mode: 0o600 });
  return s;
}

export const subjectRef = (secret, userId) => crypto.createHash('sha256').update(String(userId) + secret).digest('hex').slice(0, 16);
export const emailHash = (secret, email) => crypto.createHmac('sha256', secret).update(String(email)).digest('hex');
export function maskEmail(email) {
  // Телефон: +7******67 — код страны и две последние цифры.
  if (String(email || '').startsWith('+')) return email.slice(0, 2) + '*'.repeat(Math.max(0, email.length - 4)) + email.slice(-2);
  const [local = '', domain = ''] = String(email || '').split('@');
  return `${local.slice(0, 1) || '?'}***@${domain}`;
}

export function logDestruction(app, { userId, email, categories, reason, operator }) {
  app.db.run(`INSERT INTO pd_destruction (at, subject_ref, email_masked, categories, reason, method, operator)
    VALUES (?, ?, ?, ?, ?, ?, ?)`, Date.now(), subjectRef(app.secret, userId), maskEmail(email), categories, reason, DESTRUCTION_METHOD, operator);
}

export const isEmailBanned = (app, email) => Boolean(app.db.get('SELECT 1 FROM banned_emails WHERE email_hash = ?', emailHash(app.secret, email)));

// Хэши почт забаненных храним 3 года, потом удаляем.
export const purgeBannedEmails = app => app.db.run('DELETE FROM banned_emails WHERE at < ?', Date.now() - BAN_KEEP_MS);

// Все файлы пользователя: фото, селфи, голосовые, картинки постов.
function userFiles(db, id) {
  return {
    uploads: [
      ...db.all('SELECT file FROM photos WHERE user_id = ?', id).map(r => r.file),
      ...db.all('SELECT src FROM messages WHERE (from_id = :id OR to_id = :id) AND src IS NOT NULL', { id }).map(r => r.src),
      ...db.all('SELECT img FROM posts WHERE author = ? AND img IS NOT NULL', id).map(r => r.img),
    ],
    private: db.get('SELECT verify_file FROM users WHERE id = ?', id)?.verify_file,
  };
}

// Полное удаление аккаунта. reason — из REASONS, operator — кто удалил (почта модератора, «пользователь», «система»).
export function deleteUser(app, id, { reason = 'user_request', operator = 'пользователь' } = {}) {
  const { db, config } = app;
  const u = db.get('SELECT * FROM users WHERE id = ?', id);
  if (!u) return false;
  const files = userFiles(db, id);
  db.tx(() => {
    if (u.banned || reason === 'ban') {
      db.run(`INSERT INTO banned_emails (email_hash, reason, at) VALUES (?, ?, ?)
        ON CONFLICT(email_hash) DO UPDATE SET reason = excluded.reason, at = excluded.at`,
      emailHash(app.secret, u.email), u.ban_reason || 'ban', Date.now());
    }
    db.run('DELETE FROM messages WHERE from_id = :id OR to_id = :id', { id });
    db.run('DELETE FROM users WHERE id = ?', id); // остальное удаляется каскадом, у счетов user_id становится NULL
    logDestruction(app, { userId: id, email: u.email, categories: ACCOUNT_CATEGORIES, reason, operator });
  });
  for (const f of files.uploads) removeFile(config.uploadsDir, f);
  if (files.private) removeFile(config.privateDir, files.private);
  return true;
}

// Удаление селфи после проверки или по сроку хранения — тоже записывается в журнал.
export function destroySelfie(app, user, operator) {
  if (!user.verify_file) return;
  removeFile(app.config.privateDir, user.verify_file);
  logDestruction(app, { userId: user.id, email: user.email, categories: SELFIE_CATEGORY, reason: 'retention', operator });
}

// Выгрузка «всё обо мне». Чужие данные не раскрываются: о других людях — только их id или количество.
export function exportUser(app, u) {
  const { db, config } = app;
  const abs = src => (config.publicUrl || '') + src;
  const ids = (sql, ...p) => db.all(sql, ...p).map(r => r.id);
  const messages = db.all('SELECT * FROM messages WHERE from_id = :id OR to_id = :id ORDER BY t, id', { id: u.id }).map(m => ({
    id: m.id, direction: m.from_id === u.id ? 'out' : 'in', with: m.from_id === u.id ? m.to_id : m.from_id, t: m.t, kind: m.kind,
    ...(m.text != null ? { text: m.text } : {}), ...(m.src ? { voice: abs(uploadSrc(m.src)), dur: m.dur } : {}),
  }));
  return {
    service: 'Любовь в цифрах',
    exportedAt: new Date().toISOString(),
    profile: {
      id: u.id, email: u.email, name: u.name, birth: u.birth, g: u.g, seek: u.seek, city: u.city, about: u.about, lang: u.lang,
      createdAt: u.created_at, lastSeen: u.last_seen, verifyStatus: u.verify_status, hideAge: Boolean(u.hide_age),
      invisible: Boolean(u.invisible), notifyEmail: Boolean(u.notify_email), notifyPush: Boolean(u.notify_push), banned: Boolean(u.banned),
      ...detailsOut(u),
    },
    consents: { processingAt: u.consent_at, publicAt: u.consent_public_at, version: u.consent_version, ip: u.consent_ip },
    wallet: { coins: u.coins, vipUntil: u.vip_until, boostUntil: u.boost_until },
    photos: db.all('SELECT * FROM photos WHERE user_id = ? ORDER BY pos, id', u.id).map(p => ({ src: abs(uploadSrc(p.file)), status: p.status, createdAt: p.created_at })),
    verification: { status: u.verify_status, gesture: u.verify_gesture, submittedAt: u.verify_at, selfieStored: Boolean(u.verify_file) },
    likes: {
      given: db.all('SELECT to_id AS id, t FROM likes WHERE from_id = ? ORDER BY t', u.id),
      receivedCount: db.get('SELECT COUNT(*) AS n FROM likes WHERE to_id = ?', u.id).n,
    },
    passes: db.all('SELECT to_id AS id, t FROM passes WHERE from_id = ? ORDER BY t', u.id),
    matches: ids('SELECT l.to_id AS id FROM likes l JOIN likes r ON r.from_id = l.to_id AND r.to_id = l.from_id WHERE l.from_id = ?', u.id),
    friends: db.all('SELECT from_id, to_id, status, t FROM friends WHERE from_id = :id OR to_id = :id', { id: u.id })
      .map(f => ({ with: f.from_id === u.id ? f.to_id : f.from_id, status: f.status, requestedByMe: f.from_id === u.id, t: f.t })),
    blocked: db.all('SELECT to_id AS id, t FROM blocks WHERE from_id = ?', u.id),
    messages,
    posts: db.all('SELECT * FROM posts WHERE author = ? ORDER BY t', u.id).map(p => ({ id: p.id, t: p.t, text: p.text, ...(p.img ? { img: abs(uploadSrc(p.img)) } : {}) })),
    visits: {
      madeByMe: db.all('SELECT owner_id AS id, t FROM visits WHERE viewer_id = ? ORDER BY t', u.id),
      receivedCount: db.get('SELECT COUNT(*) AS n FROM visits WHERE owner_id = ?', u.id).n,
    },
    gifts: {
      sent: db.all('SELECT to_id AS id, kind, t FROM gifts WHERE from_id = ? ORDER BY t', u.id),
      received: db.all('SELECT kind, t FROM gifts WHERE to_id = ? ORDER BY t', u.id),
    },
    reportsFiled: db.all('SELECT target_id AS id, reason, text, t FROM reports WHERE from_id = ? ORDER BY t', u.id),
    orders: db.all('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at', u.id).map(o => ({
      invId: o.inv_id, product: o.product, title: CATALOG[o.product]?.title || o.product, price: o.price, status: o.status,
      createdAt: o.created_at, paidAt: o.paid_at, refundedAt: o.refunded_at,
    })),
    events: db.all('SELECT t, kind, text FROM events WHERE user_id = ? ORDER BY t', u.id),
    pushSubscriptions: db.get('SELECT COUNT(*) AS n FROM push_subs WHERE user_id = ?', u.id).n,
  };
}
