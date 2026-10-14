// Общие правила: как отдавать анкеты, кто кого видит, кто кому может писать.
import crypto from 'node:crypto';

export const SUPPORT = 'support';
export const DAY = 24 * 3600 * 1000;
export const ONLINE_MS = 10 * 60 * 1000;
export const FREE_LIKES = 30;
export const BOOST_COST = 50;
export const GIFTS = { rose: 10, coffee: 15, heart: 20, bear: 40, star: 50 };

export const newUserId = () => crypto.randomBytes(8).toString('hex');
export const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
export const isVip = (u, now = Date.now()) => Boolean(u && u.vip_until > now);
export const uploadSrc = file => `/uploads/${file}`;

// Начало текущих суток по Москве (UTC+3) — с него считается дневной лимит симпатий.
export function dayStartMsk(now = Date.now()) {
  const off = 3 * 3600 * 1000;
  return Math.floor((now + off) / DAY) * DAY - off;
}

export const walletOf = u => ({ coins: u.coins, vipUntil: u.vip_until, boostUntil: u.boost_until });

export function userOut(u) {
  if (!u || !u.name) return null;
  const vip = isVip(u);
  return {
    id: u.id, email: u.email, name: u.name, birth: u.birth, g: u.g, seek: u.seek, city: u.city, about: u.about,
    lang: u.lang, verified: u.verify_status === 'approved', verifyStatus: u.verify_status,
    hideAge: Boolean(u.hide_age) && vip, invisible: Boolean(u.invisible) && vip,
    notifyEmail: Boolean(u.notify_email), notifyPush: Boolean(u.notify_push),
    consentAt: u.consent_at, createdAt: u.created_at,
  };
}

export const photoOut = p => ({ id: p.id, src: uploadSrc(p.file), status: p.status });
export const myPhotos = (db, userId) => db.all('SELECT * FROM photos WHERE user_id = ? ORDER BY pos, id', userId).map(photoOut);

export function messageOut(m) {
  const o = { id: m.id, from: m.from_id, to: m.to_id, t: m.t, kind: m.kind, read: Boolean(m.read) };
  if (m.text != null) o.text = m.text;
  if (m.src) o.src = uploadSrc(m.src);
  if (m.dur != null) o.dur = m.dur;
  return o;
}

// Кто лайкнул и кто заходил — видно только с VIP, остальным событие приходит без who.
export function eventOut(e, viewerVip) {
  const o = { id: e.id, t: e.t, kind: e.kind };
  if (e.who && (viewerVip || !['like', 'visit'].includes(e.kind))) o.who = e.who;
  if (e.text) o.text = e.text;
  return o;
}

export function addEvent(db, userId, kind, who = null, text = null) {
  db.run('INSERT INTO events (user_id, t, kind, who, text) VALUES (?, ?, ?, ?, ?)', userId, Date.now(), kind, who, text);
}

// Заблокирован ли кто-то из двоих другим.
export const blockedEither = (db, a, b) =>
  Boolean(db.get('SELECT 1 FROM blocks WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)', a, b, b, a));

// Анкета другого человека, если её можно видеть, иначе null.
export function visibleUser(db, me, id) {
  if (typeof id !== 'string' || id === me.id || id === SUPPORT) return null;
  const u = db.get('SELECT * FROM users WHERE id = ?', id);
  if (!u || !u.name || u.banned || blockedEither(db, me.id, id)) return null;
  return u;
}

// Набор id, которые для меня скрыты (блокировки в обе стороны, баны, незаполненные анкеты).
export function hiddenIds(db, meId) {
  const rows = db.all(`SELECT to_id AS id FROM blocks WHERE from_id = :me
    UNION SELECT from_id FROM blocks WHERE to_id = :me
    UNION SELECT id FROM users WHERE banned = 1 OR name IS NULL`, { me: meId });
  return new Set(rows.map(r => r.id));
}

export const mutual = (db, a, b) =>
  Boolean(db.get('SELECT 1 FROM likes l JOIN likes r ON r.from_id = l.to_id AND r.to_id = l.from_id WHERE l.from_id = ? AND l.to_id = ?', a, b));
export const areFriends = (db, a, b) =>
  Boolean(db.get("SELECT 1 FROM friends WHERE status = 'ok' AND ((from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?))", a, b, b, a));
const wroteTo = (db, from, to) => Boolean(db.get('SELECT 1 FROM messages WHERE from_id = ? AND to_id = ? LIMIT 1', from, to));

// Писать (и звонить) можно: при взаимной симпатии, друзьям, с VIP, в ответ тому, кто написал первым, и в поддержку.
export function canTalk(db, me, otherId) {
  if (otherId === SUPPORT) return true;
  if (!visibleUser(db, me, otherId)) return false;
  return isVip(me) || mutual(db, me.id, otherId) || areFriends(db, me.id, otherId) || wroteTo(db, otherId, me.id);
}

// Анкеты для показа другим: только одобренные фото, подарки, VIP/поднятие/онлайн.
export function peopleOut(db, users, viewerId, now = Date.now()) {
  if (!users.length) return [];
  const ids = users.map(u => u.id);
  const marks = ids.map(() => '?').join(',');
  const photos = db.all(`SELECT user_id, file FROM photos WHERE status = 'approved' AND user_id IN (${marks}) ORDER BY pos, id`, ...ids);
  const gifts = db.all(`SELECT from_id, to_id, kind FROM gifts WHERE to_id IN (${marks}) ORDER BY t DESC`, ...ids);
  const media = new Map(), giftMap = new Map();
  for (const p of photos) (media.get(p.user_id) || media.set(p.user_id, []).get(p.user_id)).push({ type: 'photo', src: uploadSrc(p.file) });
  for (const g of gifts) {
    const list = giftMap.get(g.to_id) || giftMap.set(g.to_id, []).get(g.to_id);
    list.push(g.from_id && g.from_id === viewerId ? { kind: g.kind, from: g.from_id } : { kind: g.kind });
  }
  return users.map(u => {
    const vip = isVip(u, now);
    return {
      id: u.id, name: u.name, birth: u.birth, g: u.g, city: u.city, about: u.about,
      verified: u.verify_status === 'approved', hideAge: Boolean(u.hide_age) && vip, vip,
      boosted: u.boost_until > now,
      online: !(u.invisible && vip) && now - u.last_seen < ONLINE_MS,
      media: media.get(u.id) || [], gifts: giftMap.get(u.id) || [],
    };
  });
}

export function friendsOf(db, meId) {
  const rows = db.all('SELECT from_id, to_id, status FROM friends WHERE from_id = :me OR to_id = :me', { me: meId });
  const hidden = hiddenIds(db, meId);
  const out = { list: [], in: [], out: [] };
  for (const r of rows) {
    const other = r.from_id === meId ? r.to_id : r.from_id;
    if (hidden.has(other)) continue;
    if (r.status === 'ok') out.list.push(other);
    else if (r.from_id === meId) out.out.push(other);
    else out.in.push(other);
  }
  return out;
}

export const likesToday = (db, meId, now = Date.now()) =>
  db.get('SELECT COUNT(*) AS n FROM likes WHERE from_id = ? AND t >= ?', meId, dayStartMsk(now)).n;
