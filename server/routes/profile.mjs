// Своя анкета: данные, настройки, фото, проверка селфи.
import { fail } from '../http.mjs';
import { decodeImage, removeFile, saveFile } from '../media.mjs';
import { isVip, myPhotos, userOut } from '../model.mjs';

const MAX_PHOTOS = 10;
const invalid = field => fail(400, 'invalid', { field });
const str = v => (typeof v === 'string' ? v.trim() : '');
const oneLine = v => str(v).replace(/\s+/g, ' ');
// Имя и город — только буквы и немного знаков (защита шаблонов сайта от разметки).
const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M} .'’-]{0,39}$/u;
const CITY_RE = /^[\p{L}\p{M}0-9][\p{L}\p{M}0-9 .,'’()-]{0,59}$/u;

function checkBirth(birth) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birth);
  if (!m) invalid('birth');
  const [y, mo, d] = m.slice(1).map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d || y < 1900) invalid('birth');
  const now = new Date();
  const adult = new Date(Date.UTC(y + 18, mo - 1, d));
  if (adult > now) fail(400, 'under_18');
}

export function validateProfile(body) {
  const p = {
    name: oneLine(body.name), birth: str(body.birth), g: body.g, seek: body.seek,
    city: oneLine(body.city), about: str(body.about), lang: body.lang === 'en' ? 'en' : 'ru',
  };
  if (!NAME_RE.test(p.name)) fail(400, 'bad_name');
  checkBirth(p.birth);
  if (!['m', 'f'].includes(p.g)) invalid('g');
  if (!['m', 'f', 'a'].includes(p.seek)) invalid('seek');
  if (!CITY_RE.test(p.city)) fail(400, 'bad_city');
  if (p.about.length > 500) invalid('about');
  return p;
}

const meAgain = (db, id) => db.get('SELECT * FROM users WHERE id = ?', id);

export default function profileRoutes(route) {
  route('PUT', '/api/profile', ({ app, user, body }) => {
    const { db } = app;
    const p = validateProfile(body);
    if (!user.consent_at && body.consent !== true) fail(400, 'consent_required');
    const consentAt = user.consent_at || Date.now();
    db.run('UPDATE users SET name = ?, birth = ?, g = ?, seek = ?, city = ?, about = ?, lang = ?, consent_at = ? WHERE id = ?',
      p.name, p.birth, p.g, p.seek, p.city, p.about, body.lang ? p.lang : user.lang, consentAt, user.id);
    return { user: userOut(meAgain(db, user.id)) };
  }, { auth: 'user' });

  route('PUT', '/api/settings', ({ app, user, body }) => {
    const { db } = app;
    const sets = [], vals = [];
    for (const [key, col] of [['hideAge', 'hide_age'], ['invisible', 'invisible'], ['notifyEmail', 'notify_email'], ['notifyPush', 'notify_push']]) {
      if (body[key] === undefined) continue;
      if (typeof body[key] !== 'boolean') invalid(key);
      if (body[key] && (key === 'hideAge' || key === 'invisible') && !isVip(user)) fail(403, 'vip_required');
      sets.push(`${col} = ?`); vals.push(body[key] ? 1 : 0);
    }
    if (body.lang !== undefined) {
      if (!['ru', 'en'].includes(body.lang)) invalid('lang');
      sets.push('lang = ?'); vals.push(body.lang);
    }
    if (sets.length) db.run(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, ...vals, user.id);
    return { user: userOut(meAgain(db, user.id)) };
  }, { auth: 'user' });

  route('POST', '/api/photos', ({ app, user, body }) => {
    const { db, config } = app;
    const count = db.get('SELECT COUNT(*) AS n FROM photos WHERE user_id = ?', user.id).n;
    if (count >= MAX_PHOTOS) fail(400, 'too_many');
    const file = saveFile(config.uploadsDir, decodeImage(body.dataUrl));
    const pos = db.get('SELECT COALESCE(MAX(pos), -1) + 1 AS p FROM photos WHERE user_id = ?', user.id).p;
    db.run('INSERT INTO photos (user_id, file, status, pos, created_at) VALUES (?, ?, ?, ?, ?)',
      user.id, file, config.autoApprove ? 'approved' : 'pending', pos, Date.now());
    return { photos: myPhotos(db, user.id) };
  }, { auth: 'user' });

  route('PUT', '/api/photos/order', ({ app, user, body }) => {
    const { db } = app;
    if (!Array.isArray(body.ids)) invalid('ids');
    const mine = db.all('SELECT id FROM photos WHERE user_id = ? ORDER BY pos, id', user.id).map(r => r.id);
    const wanted = [...new Set(body.ids.map(Number))].filter(id => mine.includes(id));
    const order = [...wanted, ...mine.filter(id => !wanted.includes(id))];
    db.tx(() => order.forEach((id, i) => db.run('UPDATE photos SET pos = ? WHERE id = ? AND user_id = ?', i, id, user.id)));
    return { photos: myPhotos(db, user.id) };
  }, { auth: 'user' });

  route('DELETE', '/api/photos/:id', ({ app, user, params }) => {
    const { db, config } = app;
    const photo = db.get('SELECT * FROM photos WHERE id = ? AND user_id = ?', Number(params.id), user.id);
    if (!photo) fail(404, 'not_found');
    db.run('DELETE FROM photos WHERE id = ?', photo.id);
    removeFile(config.uploadsDir, photo.file);
    return { photos: myPhotos(db, user.id) };
  }, { auth: 'user' });

  // Селфи с жестом хранится в закрытой папке, его видят только модераторы.
  route('POST', '/api/verify', ({ app, user, body }) => {
    const { db, config } = app;
    const gesture = str(body.gesture);
    if (gesture.length < 1 || gesture.length > 100) invalid('gesture');
    const file = saveFile(config.privateDir, decodeImage(body.dataUrl));
    if (user.verify_file) removeFile(config.privateDir, user.verify_file);
    db.run("UPDATE users SET verify_status = 'pending', verify_file = ?, verify_gesture = ?, verify_at = ? WHERE id = ?",
      file, gesture, Date.now(), user.id);
    return { user: userOut(meAgain(db, user.id)) };
  }, { auth: 'profile' });
}
