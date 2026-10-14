// Сборка приложения: база, почта, push, маршруты API, статика сайта и загрузок.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { loadConfig } from './config.mjs';
import { openDb } from './db.mjs';
import {
  HttpError, TEXT, clientIp, createLimiter, isHttps, parseCookies, readBody, safeJoin, securityHeaders, sendJson, sendText, serveFile,
} from './http.mjs';
import { createMailer } from './mail.mjs';
import { isSafeName } from './media.mjs';
import { sha256 } from './model.mjs';
import { createNotifier } from './notify.mjs';
import { destroySelfie, loadSecret, purgeBannedEmails } from './pd.mjs';
import { createPush } from './push.mjs';
import actionRoutes from './routes/actions.mjs';
import adminRoutes from './routes/admin.mjs';
import authRoutes from './routes/auth.mjs';
import payRoutes, { checkPendingOrders } from './routes/pay.mjs';
import peopleRoutes from './routes/people.mjs';
import profileRoutes from './routes/profile.mjs';

const COOKIE = 'lvc_s';
const SESSION_TTL = 60 * 24 * 3600 * 1000;
const BODY_LIMIT = 8 * 1024 * 1024;
const MUTATING = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

// Маршрутизатор: '/api/photos/:id' → регулярное выражение с именованными группами.
function createRouter() {
  const routes = [];
  const route = (method, pattern, handler, opts = {}) => {
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$');
    routes.push({ method, re, handler, opts: { auth: 'profile', csrf: true, ...opts } });
  };
  const match = (method, pathname) => {
    let pathMatched = false;
    for (const r of routes) {
      const m = r.re.exec(pathname);
      if (!m) continue;
      pathMatched = true;
      if (r.method === method || (method === 'HEAD' && r.method === 'GET')) return { r, params: m.groups || {} };
    }
    return pathMatched ? 'method' : null;
  };
  return { route, match };
}

// Заглушка, когда push выключен (PUSH_ENABLED не равен 1): ключи не создаются, ничего не отправляется.
const DISABLED_PUSH = { enabled: false, publicKey: null, send: async () => 0 };

const silentLog = { info() {}, warn() {}, error() {} };

export function createApp(env = process.env, { log = console } = {}) {
  const config = loadConfig(env);
  for (const dir of [config.dataDir, config.uploadsDir, config.privateDir]) fs.mkdirSync(dir, { recursive: true });
  const logger = log || silentLog;
  const db = openDb(path.join(config.dataDir, 'lvc.sqlite'));
  const app = { config, db, log: logger, limiter: createLimiter(), mailer: createMailer(config, logger), push: config.pushEnabled ? createPush(config, logger) : DISABLED_PUSH };
  app.secret = loadSecret(config.dataDir);
  app.notify = createNotifier(app);

  const router = createRouter();
  for (const add of [authRoutes, profileRoutes, peopleRoutes, actionRoutes, payRoutes, adminRoutes]) add(router.route);

  // Пользователь по cookie сессии. Время последней активности обновляется не чаще раза в минуту.
  function sessionUser(token) {
    if (!token || !TOKEN_RE.test(token)) return null;
    const now = Date.now();
    const user = db.get('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires > ?', sha256(token), now);
    if (user && now - user.last_seen > 60e3) {
      db.run('UPDATE users SET last_seen = ? WHERE id = ?', now, user.id);
      user.last_seen = now;
    }
    return user || null;
  }

  function cookie(req, value, maxAgeSec) {
    const secure = isHttps(req, config.publicUrl) ? '; Secure' : '';
    return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`;
  }

  async function handleApi(req, res, url) {
    const found = router.match(req.method, url.pathname);
    if (!found) throw new HttpError(404, 'not_found');
    if (found === 'method') throw new HttpError(405, 'method_not_allowed');
    const { r, params } = found;
    const { opts } = r;
    if (MUTATING.has(req.method) && opts.csrf && req.headers['x-requested-with'] !== 'lvc') throw new HttpError(403, 'csrf');

    const token = parseCookies(req.headers.cookie)[COOKIE];
    const user = opts.auth === 'none' ? null : sessionUser(token);
    if (['user', 'profile', 'admin'].includes(opts.auth) && !user) throw new HttpError(401, 'auth');
    if (opts.auth === 'admin' && !config.adminEmails.has(user.email)) throw new HttpError(403, 'forbidden');
    if (opts.auth !== 'admin' && user?.banned && !opts.banned && opts.auth !== 'optional') throw new HttpError(403, 'banned');
    if (opts.auth === 'profile' && !user.name) throw new HttpError(409, 'profile_required');

    let raw = null, body = {};
    if (MUTATING.has(req.method)) {
      raw = await readBody(req, BODY_LIMIT);
      if (!opts.raw && raw.length) {
        try { body = JSON.parse(raw.toString('utf8')); } catch { throw new HttpError(400, 'bad_json'); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'bad_json');
      }
    }

    const ctx = {
      app, req, res, url, params, body, raw, user, token, ip: clientIp(req),
      startSession(userId) {
        const t = crypto.randomBytes(32).toString('base64url');
        const now = Date.now();
        db.run('INSERT INTO sessions (token_hash, user_id, created_at, expires) VALUES (?, ?, ?, ?)', sha256(t), userId, now, now + SESSION_TTL);
        res.setHeader('Set-Cookie', cookie(req, t, SESSION_TTL / 1000));
      },
      endSession() { res.setHeader('Set-Cookie', cookie(req, '', 0)); },
    };
    const out = await r.handler(ctx);
    if (res.headersSent) return;
    if (out && out[TEXT]) return sendText(res, out.status, out.body);
    sendJson(res, 200, out === undefined ? { ok: true } : out);
  }

  function handleStatic(req, res, url) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendText(res, 405, 'Method not allowed');
    const p = url.pathname;
    if (p.startsWith('/uploads/')) {
      const name = p.slice('/uploads/'.length);
      if (isSafeName(name) && serveFile(req, res, path.join(config.uploadsDir, name), 'public, max-age=31536000, immutable')) return;
      return sendText(res, 404, 'Not found');
    }
    // Скрытые файлы и папки (.env, .git) не отдаются никогда.
    if (p.split('/').some(seg => seg.startsWith('.'))) return sendText(res, 404, 'Not found');
    let file = safeJoin(config.siteDir, p.endsWith('/') ? p + 'index.html' : p);
    if (!file) return sendText(res, 400, 'Bad request');
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
      // Папка без завершающего слэша — перенаправляем, чтобы относительные ссылки работали.
      if (!p.endsWith('/')) { res.writeHead(301, { location: p + '/' + url.search }); return res.end(); }
      file = path.join(file, 'index.html');
    }
    const ext = path.extname(file).toLowerCase();
    const cache = ['.html', '.js', '.mjs', '.webmanifest', '.json'].includes(ext) ? 'no-cache' : 'public, max-age=86400';
    if (!serveFile(req, res, file, cache)) sendText(res, 404, 'Not found');
  }

  async function handle(req, res) {
    securityHeaders(res, isHttps(req, config.publicUrl));
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { return sendText(res, 400, 'Bad request'); }
    try {
      if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
      else handleStatic(req, res, url);
    } catch (e) {
      if (res.headersSent) { res.destroy(); return; }
      if (e instanceof HttpError) return sendJson(res, e.status, { error: e.code, ...e.extra });
      logger.error(`${req.method} ${url.pathname}: ${e.stack || e}`);
      sendJson(res, 500, { error: 'server_error' });
    }
  }

  // Уборка: просроченные коды, сессии и сигналы звонков, счётчики лимитов.
  function cleanup() {
    const now = Date.now();
    db.run('DELETE FROM codes WHERE expires < ?', now);
    db.run('DELETE FROM sessions WHERE expires < ?', now);
    db.run('DELETE FROM signals WHERE t < ?', now - 60e3);
    // Селфи для проверки храним не дольше 30 дней (так обещает политика конфиденциальности).
    for (const u of db.all('SELECT id, email, verify_file FROM users WHERE verify_file IS NOT NULL AND verify_at < ?', now - 30 * 86400e3)) {
      destroySelfie(app, u, 'система (срок хранения 30 дней)');
      db.run("UPDATE users SET verify_file = NULL, verify_status = CASE verify_status WHEN 'pending' THEN 'none' ELSE verify_status END WHERE id = ?", u.id);
    }
    purgeBannedEmails(app);
    app.limiter.prune();
  }
  cleanup();
  const timer = setInterval(cleanup, 60e3);
  timer.unref();
  // Сверка неоплаченных счетов с Робокассой раз в 10 минут; ошибки сети не роняют сервер.
  const checkOrders = () => checkPendingOrders(app).catch(e => logger.warn(`сверка счетов: ${e.message}`));
  const payTimer = setInterval(checkOrders, 10 * 60e3);
  payTimer.unref();

  const server = http.createServer((req, res) => { handle(req, res); });
  server.requestTimeout = 60e3;
  server.headersTimeout = 20e3;

  return {
    app, server, cleanup, checkOrders,
    listen(port = config.port, host = config.host) {
      return new Promise(resolve => server.listen(port, host, () => resolve(server.address().port)));
    },
    close() {
      clearInterval(timer);
      clearInterval(payTimer);
      server.closeAllConnections?.();
      return new Promise(resolve => server.close(() => { db.close(); resolve(); }));
    },
  };
}
