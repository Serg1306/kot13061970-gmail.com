// Web Push только на node:crypto: подпись VAPID (JWT ES256, RFC 8292)
// и шифрование содержимого aes128gcm (RFC 8291 + RFC 8188).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const b64u = buf => Buffer.from(buf).toString('base64url');
export const fromB64u = s => Buffer.from(String(s), 'base64url');

// Ключи VAPID: из переменных окружения или из DATA_DIR/vapid.json (создаются при первом запуске).
export function loadVapid(config) {
  const { publicKey, privateKey } = config.vapid;
  if (publicKey && privateKey) return { publicKey, privateKey };
  const file = path.join(config.dataDir, 'vapid.json');
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (saved.publicKey && saved.privateKey) return saved;
  } catch { /* файла ещё нет */ }
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const keys = { publicKey: b64u(ecdh.getPublicKey()), privateKey: b64u(ecdh.getPrivateKey()) };
  fs.writeFileSync(file, JSON.stringify(keys, null, 2), { mode: 0o600 });
  return keys;
}

// Закрытый ключ P-256 из «сырых» 32 байт d и 65 байт открытого ключа.
function privateKeyObject(publicKey, privateKey) {
  const pub = fromB64u(publicKey);
  return crypto.createPrivateKey({
    key: { kty: 'EC', crv: 'P-256', d: b64u(fromB64u(privateKey)), x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) },
    format: 'jwk',
  });
}

export function vapidJwt(vapid, audience, subject, ttlSec = 12 * 3600) {
  const header = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64u(JSON.stringify({ aud: audience, exp: Math.floor(Date.now() / 1000) + ttlSec, sub: subject }));
  const data = `${header}.${claims}`;
  const sig = crypto.sign('sha256', Buffer.from(data), { key: privateKeyObject(vapid.publicKey, vapid.privateKey), dsaEncoding: 'ieee-p1363' });
  return `${data}.${b64u(sig)}`;
}

// Шифрование одной записью: заголовок salt(16) | rs(4) | idlen(1) | keyid(открытый ключ сервера, 65) | шифротекст.
export function encryptPayload(plaintext, p256dh, auth, { salt = crypto.randomBytes(16), ecdh } = {}) {
  const uaPublic = fromB64u(p256dh);
  const authSecret = fromB64u(auth);
  if (uaPublic.length !== 65 || authSecret.length < 16) throw new Error('push: неверные ключи подписки');
  const server = ecdh || crypto.createECDH('prime256v1');
  if (!ecdh) server.generateKeys();
  const asPublic = server.getPublicKey();
  const shared = server.computeSecret(uaPublic);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, authSecret, keyInfo, 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const data = Buffer.concat([Buffer.from(plaintext), Buffer.from([2])]); // 0x02 — последняя запись
  const rs = 4096;
  if (data.length + 16 > rs) throw new Error('push: слишком длинное сообщение');
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(data), cipher.final(), cipher.getAuthTag()]);
  const head = Buffer.alloc(21);
  salt.copy(head, 0);
  head.writeUInt32BE(rs, 16);
  head[20] = asPublic.length;
  return Buffer.concat([head, asPublic, body]);
}

// Куда можно отправлять push: только известные службы (защита от запросов на произвольные адреса).
const PUSH_HOSTS = ['fcm.googleapis.com', 'android.googleapis.com', 'updates.push.services.mozilla.com', 'push.services.mozilla.com', 'push.apple.com', 'notify.windows.com'];
export function endpointAllowed(endpoint, allowLocal) {
  let u;
  try { u = new URL(endpoint); } catch { return false; }
  if (allowLocal && u.protocol === 'http:' && u.hostname === '127.0.0.1') return true;
  if (u.protocol !== 'https:') return false;
  return PUSH_HOSTS.some(h => u.hostname === h || u.hostname.endsWith('.' + h));
}

export function createPush(config, log) {
  const vapid = loadVapid(config);
  const subject = config.vapid.subject || (config.publicUrl.startsWith('https://') ? config.publicUrl : 'mailto:admin@example.com');

  // Отправка одной подписке. Возвращает HTTP-статус службы push (404/410 — подписка больше не действует).
  async function send(sub, payload) {
    const body = encryptPayload(JSON.stringify(payload), sub.p256dh, sub.auth);
    const jwt = vapidJwt(vapid, new URL(sub.endpoint).origin, subject);
    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        authorization: `vapid t=${jwt}, k=${vapid.publicKey}`,
        'content-encoding': 'aes128gcm',
        'content-type': 'application/octet-stream',
        ttl: '86400',
        urgency: 'high',
      },
      body,
      signal: AbortSignal.timeout(10000),
    });
    await res.arrayBuffer().catch(() => null);
    if (res.status >= 400 && res.status !== 404 && res.status !== 410) log.warn(`push: ${res.status} от ${new URL(sub.endpoint).host}`);
    return res.status;
  }
  return { publicKey: vapid.publicKey, send };
}
