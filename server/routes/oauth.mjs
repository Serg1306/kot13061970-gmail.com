// Вход через VK ID и Яндекс ID: переход к провайдеру и возврат с кодом (см. server/oauth.mjs).
import crypto from 'node:crypto';
import { HttpError, isHttps, parseCookies } from '../http.mjs';
import { langOf } from '../langs.mjs';
import { authorizeUrl, fetchProfile, pkce } from '../oauth.mjs';
import { isEmailBanned } from '../pd.mjs';
import { normPhone } from '../sms.mjs';
import { adSource, createUser, normEmail } from './auth.mjs';

const STATE_COOKIE = 'lvc_o';
const STATE_TTL = 10 * 60 * 1000;
const HINT_TTL = 60 * 60 * 1000;
const STATE_RE = /^[A-Za-z0-9_-]{32}$/;

const redirect = (res, location, cookies = []) => {
  const all = [].concat(res.getHeader('Set-Cookie') || [], cookies);
  res.writeHead(302, { location, 'cache-control': 'no-store', ...(all.length ? { 'set-cookie': all } : {}) });
  res.end();
};

// Аккаунт по профилю провайдера: уже привязанный, иначе с тем же подтверждённым телефоном или почтой, иначе новый.
function userFor(app, provider, p, lang, src) {
  const { db } = app;
  const link = db.get('SELECT u.* FROM oauth_ids o JOIN users u ON u.id = o.user_id WHERE o.provider = ? AND o.sub = ?', provider, p.sub);
  if (link) return link;
  const logins = [normPhone(p.phone), normEmail(p.email)].filter(x => x && (x.startsWith('+') || x.includes('@')));
  let user = logins.map(l => db.get('SELECT * FROM users WHERE email = ?', l)).find(Boolean);
  if (!user) {
    const own = `${provider}:${p.sub}`;
    if ([...logins, own].some(l => isEmailBanned(app, l))) throw new HttpError(403, 'banned');
    user = createUser(db, logins[0] || own, lang, src);
  }
  db.run('INSERT OR IGNORE INTO oauth_ids (provider, sub, user_id, created_at) VALUES (?, ?, ?, ?)', provider, p.sub, user.id, Date.now());
  return user;
}

export default function oauthRoutes(route) {
  const states = new Map();
  const prune = () => { const now = Date.now(); for (const [k, v] of states) if (now - v.t > STATE_TTL) states.delete(k); };
  const conf = (app, provider) => {
    const c = Object.hasOwn(app.config.oauth, provider) && app.config.oauth[provider];
    if (!c) throw new HttpError(404, 'not_found');
    return c;
  };
  const base = (app, req) => app.config.publicUrl || `${isHttps(req, '') ? 'https' : 'http'}://${req.headers.host}`;
  const stateCookie = (app, req, v, age) =>
    `${STATE_COOKIE}=${v}; Path=/api/oauth/; HttpOnly; SameSite=Lax; Max-Age=${age}${isHttps(req, app.config.publicUrl) ? '; Secure' : ''}`;

  // Кнопка на сайте ведёт сюда, отсюда — на страницу входа VK или Яндекса.
  route('GET', '/api/oauth/:provider', ({ app, req, res, url, params, ip }) => {
    const c = conf(app, params.provider);
    app.limiter.check(`oauth:${ip}`, 30, 600e3);
    prune();
    if (states.size > 10000) throw new HttpError(429, 'too_many');
    const state = crypto.randomBytes(24).toString('base64url');
    const { verifier, challenge } = pkce();
    const q = url.searchParams;
    states.set(state, {
      provider: params.provider, verifier, t: Date.now(), lang: langOf(q.get('lang')),
      src: adSource({ s: q.get('s'), m: q.get('m'), c: q.get('c') }),
    });
    const redirectUri = `${base(app, req)}/api/oauth/${params.provider}/callback`;
    redirect(res, authorizeUrl(params.provider, c, { state, challenge, redirectUri }), [stateCookie(app, req, state, STATE_TTL / 1000)]);
  }, { auth: 'none' });

  // Возврат от провайдера: код → профиль → аккаунт и сессия. Ошибки показываем на сайте, в окне входа.
  route('GET', '/api/oauth/:provider/callback', async ({ app, req, res, url, params, startSession }) => {
    const c = conf(app, params.provider);
    const q = url.searchParams, state = q.get('state') || '';
    const saved = STATE_RE.test(state) && states.get(state);
    const clear = stateCookie(app, req, '', 0);
    states.delete(state);
    const fail = code => redirect(res, `/?auth_err=${code}#join`, [clear]);
    if (q.get('error')) return fail('oauth_cancel');
    // Состояние должно совпасть и с сохранённым на сервере, и с cookie этого браузера: так чужую ссылку не подсунуть.
    if (!saved || saved.provider !== params.provider || parseCookies(req.headers.cookie)[STATE_COOKIE] !== state || Date.now() - saved.t > STATE_TTL) {
      return fail('oauth_state');
    }
    let profile;
    try {
      profile = await fetchProfile(params.provider, c, {
        code: q.get('code') || '', verifier: saved.verifier, deviceId: q.get('device_id') || '', state,
        redirectUri: `${base(app, req)}/api/oauth/${params.provider}/callback`,
      });
    } catch (e) {
      app.log.error(`вход через ${params.provider}: ${e.message}`);
      return fail('oauth_failed');
    }
    let user;
    try { user = userFor(app, params.provider, profile, saved.lang, saved.src); } catch (e) {
      if (e instanceof HttpError) return fail(e.code);
      throw e;
    }
    startSession(user.id);
    if (!user.name) {
      const hints = app.oauthHints ??= new Map();
      const now = Date.now();
      for (const [k, v] of hints) if (now - v.t > HINT_TTL) hints.delete(k);
      hints.set(user.id, { t: now, hint: { name: profile.name.slice(0, 30), birth: profile.birth, g: profile.g } });
    }
    redirect(res, user.name ? '/' : '/#join', [clear]);
  }, { auth: 'none' });
}
