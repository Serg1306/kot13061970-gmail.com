// Конфигурация, вход по коду из письма, выход, удаление аккаунта.
import crypto from 'node:crypto';
import { isConfigured, settings } from '../../netlify/lib/robokassa.mjs';
import { fail } from '../http.mjs';
import { langOf, textFor } from '../langs.mjs';
import { SUPPORT, addEvent, myPhotos, newUserId, sha256, userOut, walletOf } from '../model.mjs';
import { deleteUser, exportUser, isEmailBanned } from '../pd.mjs';

const CODE_TTL = 10 * 60 * 1000;
const CODE_GAP = 60 * 1000;
const MAX_ATTEMPTS = 5;

const EMAIL_RE = /^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$/;
export const normEmail = e => String(e ?? '').trim().toLowerCase();
const codeHash = (email, code) => sha256(`${email}:${code}`);

const WELCOME = {
  ru: {
    support: 'Добро пожаловать в «Любовь в цифрах»! Здесь можно задать вопрос о сайте, оплате или анкете.',
    event: 'Аккаунт создан. Заполните анкету и добавьте фото — так вас заметят быстрее.',
  },
  en: {
    support: 'Welcome to Love in Numbers! Ask us anything about the site, payments or your profile here.',
    event: 'Your account is ready. Fill in your profile and add photos to get noticed faster.',
  },
  uk: {
    support: 'Ласкаво просимо до «Любов у цифрах»! Тут можна поставити запитання про сайт, оплату чи анкету.',
    event: 'Акаунт створено. Заповніть анкету й додайте фото — так вас помітять швидше.',
  },
  kk: {
    support: '«Махаббат сандарда»-ға қош келдіңіз! Мұнда сайт, төлем немесе анкета туралы сұрақ қоюға болады.',
    event: 'Аккаунт жасалды. Анкетаны толтырып, сурет қосыңыз — сонда сізді тезірек байқайды.',
  },
  uz: {
    support: '«Sevgi raqamlarda»ga xush kelibsiz! Bu yerda sayt, toʻlov yoki anketa haqida savol berishingiz mumkin.',
    event: 'Akkaunt yaratildi. Anketani toʻldiring va rasm qoʻshing — shunda sizni tezroq payqashadi.',
  },
  de: {
    support: 'Willkommen bei „Liebe in Zahlen“! Hier kannst du Fragen zur Seite, zur Zahlung oder zum Profil stellen.',
    event: 'Dein Konto ist bereit. Füll dein Profil aus und füge Fotos hinzu, damit man dich schneller bemerkt.',
  },
  es: {
    support: '¡Bienvenido a «Amor en Números»! Aquí puedes preguntar sobre el sitio, los pagos o tu perfil.',
    event: 'Tu cuenta está lista. Completa tu perfil y añade fotos para que te vean antes.',
  },
  fr: {
    support: 'Bienvenue sur « L\'Amour en Chiffres » ! Posez ici vos questions sur le site, le paiement ou votre profil.',
    event: 'Votre compte est prêt. Remplissez votre profil et ajoutez des photos pour être remarqué plus vite.',
  },
};

// Откуда пришёл человек: метки utm_source / utm_medium / utm_campaign первого визита, «vk / cpc / osen».
// Берём только короткие латинские слова, чтобы в базу не попадало ничего лишнего.
export function adSource(src) {
  if (!src || typeof src !== 'object') return null;
  const part = v => String(v ?? '').toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 40);
  const parts = [part(src.s), part(src.m), part(src.c)];
  while (parts.length && !parts[parts.length - 1]) parts.pop();
  return parts.length ? parts.map(x => x || '-').join(' / ') : null;
}

// Новый пользователь: приветствие от поддержки и системное событие.
function createUser(db, email, lang, src = null) {
  const id = newUserId();
  const now = Date.now();
  const t = textFor(WELCOME, lang);
  db.tx(() => {
    db.run('INSERT INTO users (id, email, lang, src, created_at, last_seen) VALUES (?, ?, ?, ?, ?, ?)', id, email, lang, src, now, now);
    db.run("INSERT INTO messages (from_id, to_id, t, kind, text) VALUES (?, ?, ?, 'text', ?)", SUPPORT, id, now, t.support);
    addEvent(db, id, 'system', null, t.event);
  });
  return db.get('SELECT * FROM users WHERE id = ?', id);
}

export default function authRoutes(route) {
  route('GET', '/api/config', ({ app }) => ({
    live: true,
    robokassa: isConfigured(settings(app.config.env)),
    vapidPublicKey: app.push.publicKey || null,
    metrikaId: app.config.metrikaId,
    devCodes: app.config.devCodes,
    ...(app.config.iceServers ? { iceServers: app.config.iceServers } : {}),
  }), { auth: 'none' });

  route('POST', '/api/auth/start', async ({ app, body, ip }) => {
    const { db, limiter, mailer, config, log } = app;
    limiter.check(`start:${ip}`, 40, 600e3);
    const email = normEmail(body.email);
    if (email.length > 254 || !EMAIL_RE.test(email)) fail(400, 'bad_email');
    // Почта удалённого забаненного аккаунта: новая регистрация запрещена.
    if (!db.get('SELECT 1 FROM users WHERE email = ?', email) && isEmailBanned(app, email)) fail(403, 'banned');
    const lang = langOf(body.lang);
    const now = Date.now();
    const prev = db.get('SELECT sent_at FROM codes WHERE email = ?', email);
    if (prev && now - prev.sent_at < CODE_GAP) fail(429, 'too_often', { wait: Math.ceil((prev.sent_at + CODE_GAP - now) / 1000) });
    const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
    db.run(`INSERT INTO codes (email, code_hash, lang, expires, attempts, sent_at) VALUES (?, ?, ?, ?, 0, ?)
      ON CONFLICT(email) DO UPDATE SET code_hash = excluded.code_hash, lang = excluded.lang, expires = excluded.expires, attempts = 0, sent_at = excluded.sent_at`,
    email, codeHash(email, code), lang, now + CODE_TTL, now);
    const userLang = db.get('SELECT lang FROM users WHERE email = ?', email)?.lang || lang;
    if (mailer.configured) {
      try {
        await mailer.send(email, 'code', userLang, { code });
      } catch (e) {
        log.error(`письмо с кодом не отправлено: ${e.message}`);
        db.run('DELETE FROM codes WHERE email = ?', email);
        fail(502, 'mail_failed');
      }
    } else {
      log.info(`Код входа для ${email}: ${code}`);
      mailer.outbox.push({ to: email, kind: 'code', code });
    }
    return config.devCodes ? { ok: true, devCode: code } : { ok: true };
  }, { auth: 'none' });

  route('POST', '/api/auth/verify', ({ app, body, ip, startSession }) => {
    const { db, limiter } = app;
    limiter.check(`verify:${ip}`, 60, 600e3);
    const email = normEmail(body.email);
    const code = String(body.code ?? '').trim();
    const row = db.get('SELECT * FROM codes WHERE email = ?', email);
    const now = Date.now();
    if (!row) fail(400, 'code_expired');
    if (row.expires < now) { db.run('DELETE FROM codes WHERE email = ?', email); fail(400, 'code_expired'); }
    if (row.attempts >= MAX_ATTEMPTS) fail(429, 'too_many_attempts');
    const a = Buffer.from(codeHash(email, code)), b = Buffer.from(row.code_hash);
    if (!/^\d{6}$/.test(code) || !crypto.timingSafeEqual(a, b)) {
      db.run('UPDATE codes SET attempts = attempts + 1 WHERE email = ?', email);
      if (row.attempts + 1 >= MAX_ATTEMPTS) fail(429, 'too_many_attempts');
      fail(400, 'bad_code');
    }
    db.run('DELETE FROM codes WHERE email = ?', email);
    let user = db.get('SELECT * FROM users WHERE email = ?', email);
    if (!user) {
      if (isEmailBanned(app, email)) fail(403, 'banned');
      user = createUser(db, email, row.lang, adSource(body.src));
    }
    startSession(user.id);
    return { user: userOut(user) };
  }, { auth: 'none' });

  route('POST', '/api/auth/logout', ({ app, token, endSession }) => {
    if (token) app.db.run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
    endSession();
    return { ok: true };
  }, { auth: 'none' });

  route('DELETE', '/api/account', ({ app, user, endSession }) => {
    deleteUser(app, user.id, { reason: 'user_request', operator: 'пользователь (сам, через сайт)' });
    endSession();
    return { ok: true };
  }, { auth: 'user', banned: true });

  // Выгрузка своих данных (152-ФЗ, ст. 14) — файлом JSON.
  route('GET', '/api/account/export', ({ app, user, res }) => {
    app.limiter.check(`export:${user.id}`, 5, 3600e3);
    const body = JSON.stringify(exportUser(app, user), null, 2);
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': 'attachment; filename="lyubov-v-cifrah-data.json"',
      'cache-control': 'no-store',
    });
    res.end(body);
  }, { auth: 'user', banned: true });

  route('GET', '/api/me', ({ app, user }) => ({
    user: userOut(user),
    wallet: walletOf(user),
    photos: myPhotos(app.db, user.id),
    admin: app.config.adminEmails.has(user.email),
    banned: Boolean(user.banned),
  }), { auth: 'user', banned: true });
}
