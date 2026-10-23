// Своя анкета: данные, настройки, фото, проверка селфи.
import { fail } from '../http.mjs';
import { decodeImage, removeFile, saveFile } from '../media.mjs';
import { isVip, myPhotos, userOut } from '../model.mjs';
import { parseDetails } from '../options.mjs';

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
    ...parseDetails(body),
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
  route('PUT', '/api/profile', ({ app, user, body, ip }) => {
    const { db } = app;
    const p = validateProfile(body);
    // Два отдельных согласия (152-ФЗ): на обработку и на распространение (ст. 10.1 — анкету видят другие).
    if (!user.consent_at && body.consent !== true) fail(400, 'consent_required');
    if (!user.consent_public_at && body.consentPublic !== true) fail(400, 'consent_public_required');
    const now = Date.now();
    const fresh = !user.consent_at || !user.consent_public_at;
    db.tx(() => {
      db.run('UPDATE users SET name = ?, birth = ?, g = ?, seek = ?, city = ?, about = ?, lang = ? WHERE id = ?',
        p.name, p.birth, p.g, p.seek, p.city, p.about, body.lang ? p.lang : user.lang, user.id);
      // подробности анкеты необязательны: старый клиент без этих полей их не стирает
      if (['goal', 'interests', 'height', 'kids', 'smoke'].some(k => k in body)) {
        db.run('UPDATE users SET goal = ?, interests = ?, height = ?, kids = ?, smoke = ? WHERE id = ?',
          p.goal, JSON.stringify(p.interests), p.height, p.kids, p.smoke, user.id);
      }
      if (fresh) {
        db.run('UPDATE users SET consent_at = COALESCE(consent_at, ?), consent_public_at = COALESCE(consent_public_at, ?), consent_version = ?, consent_ip = ? WHERE id = ?',
          now, now, app.config.consentVersion, String(ip || '').slice(0, 64), user.id);
      }
    });
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
