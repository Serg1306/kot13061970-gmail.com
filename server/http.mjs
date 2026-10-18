// HTTP-мелочи без фреймворков: ошибки, JSON, тело запроса, cookie, статика, лимиты.
import fs from 'node:fs';
import path from 'node:path';

export class HttpError extends Error {
  constructor(status, code, extra = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}
export const fail = (status, code, extra) => { throw new HttpError(status, code, extra); };

// Ответ не в JSON (например, OK<InvId> для Робокассы).
export const text = (body, status = 200) => ({ [TEXT]: true, body, status });
export const TEXT = Symbol('text');

export function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

export function sendText(res, status, body) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

// Тело запроса целиком с ограничением размера.
export function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > limit) { req.resume(); return reject(new HttpError(413, 'too_large')); }
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > limit) { req.destroy(); reject(new HttpError(413, 'too_large')); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const isLoopback = a => a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';

// IP клиента: заголовкам X-Real-IP / X-Forwarded-For верим, только если запрос пришёл от nginx на этой же машине.
export function clientIp(req) {
  const remote = req.socket.remoteAddress || '';
  if (isLoopback(remote)) {
    const fwd = req.headers['x-real-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (fwd) return fwd;
  }
  return remote;
}

export const isHttps = (req, publicUrl) =>
  Boolean(req.socket.encrypted) || publicUrl.startsWith('https://') ||
  (isLoopback(req.socket.remoteAddress || '') && req.headers['x-forwarded-proto'] === 'https');

// Ограничение частоты в памяти: не больше max событий за windowMs на ключ.
export function createLimiter() {
  const hits = new Map();
  return {
    check(key, max, windowMs) {
      const now = Date.now();
      let h = hits.get(key);
      if (!h || h.reset <= now) { h = { count: 0, reset: now + windowMs }; hits.set(key, h); }
      h.count++;
      if (h.count > max) fail(429, 'rate_limited', { wait: Math.ceil((h.reset - now) / 1000) });
    },
    prune() {
      const now = Date.now();
      for (const [k, h] of hits) if (h.reset <= now) hits.delete(k);
    },
  };
}

// Заголовки безопасности для всех ответов.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://mc.yandex.ru https://yastatic.net",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob: https://mc.yandex.ru https://mc.yandex.com",
  "media-src 'self' data: blob:",
  "connect-src 'self' https://mc.yandex.ru https://mc.yandex.com wss://mc.yandex.ru",
  'frame-src https://mc.yandex.ru https://mc.yandex.com',
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https://auth.robokassa.ru",
  "frame-ancestors 'none'",
].join('; ');

export function securityHeaders(res, https) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=(), payment=()');
  if (https) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
}

export const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.weba': 'audio/webm',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.woff2': 'font/woff2',
  '.glb': 'model/gltf-binary',
  '.pdf': 'application/pdf',
};

// Путь внутри корня или null (защита от ../ и прочих обходов).
export function safeJoin(root, urlPath) {
  let p;
  try { p = decodeURIComponent(urlPath); } catch { return null; }
  if (p.includes('\0') || p.includes('\\')) return null;
  const full = path.resolve(root, '.' + path.posix.normalize('/' + p));
  const base = path.resolve(root);
  return full === base || full.startsWith(base + path.sep) ? full : null;
}

// Отдача файла: ETag, 304, Range (нужен Safari для видео), HEAD.
export function serveFile(req, res, file, cacheControl) {
  let st;
  try { st = fs.statSync(file); } catch { return false; }
  if (!st.isFile()) return false;
  const type = TYPES[path.extname(file).toLowerCase()];
  if (!type) return false;
  const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
  const headers = {
    'content-type': type, 'cache-control': cacheControl, etag,
    'last-modified': st.mtime.toUTCString(), 'accept-ranges': 'bytes',
  };
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); res.end(); return true; }
  let start = 0, end = st.size - 1, status = 200;
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
  if (m && (m[1] || m[2])) {
    if (m[1]) { start = Number(m[1]); if (m[2]) end = Math.min(Number(m[2]), end); }
    else start = Math.max(0, st.size - Number(m[2]));
    if (start > end || start >= st.size) {
      res.writeHead(416, { 'content-range': `bytes */${st.size}` }); res.end(); return true;
    }
    status = 206;
    headers['content-range'] = `bytes ${start}-${end}/${st.size}`;
  }
  headers['content-length'] = end - start + 1;
  res.writeHead(status, headers);
  if (req.method === 'HEAD') { res.end(); return true; }
  fs.createReadStream(file, { start, end }).pipe(res);
  return true;
}
