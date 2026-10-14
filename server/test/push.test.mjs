import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { test } from 'node:test';
import { b64u, encryptPayload, fromB64u, vapidJwt } from '../push.mjs';
import { mutualLike, startServer } from './helpers.mjs';

// Расшифровка aes128gcm на стороне «браузера» (RFC 8291) — независимая реализация для проверки.
function decrypt(body, receiver, authSecret) {
  const salt = body.subarray(0, 16);
  const rs = body.readUInt32BE(16);
  const idlen = body[20];
  const asPublic = body.subarray(21, 21 + idlen);
  const ciphertext = body.subarray(21 + idlen);
  assert.ok(ciphertext.length <= rs);
  const shared = receiver.computeSecret(asPublic);
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), receiver.getPublicKey(), asPublic]);
  const prkKey = crypto.createHmac('sha256', authSecret).update(shared).digest();
  const ikm = crypto.createHmac('sha256', prkKey).update(Buffer.concat([info, Buffer.from([1])])).digest();
  const prk = crypto.createHmac('sha256', salt).update(ikm).digest();
  const expand = (label, len) => crypto.createHmac('sha256', prk).update(Buffer.concat([Buffer.from(label), Buffer.from([1])])).digest().subarray(0, len);
  const cek = expand('Content-Encoding: aes128gcm\0', 16);
  const nonce = expand('Content-Encoding: nonce\0', 12);
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(ciphertext.subarray(-16));
  const plain = Buffer.concat([d.update(ciphertext.subarray(0, -16)), d.final()]);
  let end = plain.length - 1;
  while (end >= 0 && plain[end] === 0) end--;
  assert.equal(plain[end], 2, 'разделитель последней записи');
  return plain.subarray(0, end).toString('utf8');
}

function receiverKeys() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  return { ecdh, auth, sub: { p256dh: b64u(ecdh.getPublicKey()), auth: b64u(auth) } };
}

function verifyJwt(jwt, publicKey) {
  const [h, c, s] = jwt.split('.');
  const pub = fromB64u(publicKey);
  const key = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33)) }, format: 'jwk' });
  const ok = crypto.verify('sha256', Buffer.from(`${h}.${c}`), { key, dsaEncoding: 'ieee-p1363' }, fromB64u(s));
  return { ok, header: JSON.parse(fromB64u(h)), claims: JSON.parse(fromB64u(c)) };
}

test('aes128gcm: расшифровка ключом получателя даёт исходный текст', () => {
  const r = receiverKeys();
  const text = JSON.stringify({ title: 'Новое сообщение', body: 'Привет 👋', url: '/?go=messages' });
  const enc = encryptPayload(text, r.sub.p256dh, r.sub.auth);
  assert.equal(enc.readUInt32BE(16), 4096);
  assert.equal(enc[20], 65);
  assert.equal(decrypt(enc, r.ecdh, r.auth), text);
  // Чужой ключ не расшифрует.
  const other = receiverKeys();
  assert.throws(() => decrypt(enc, other.ecdh, other.auth));
});

test('VAPID JWT подписан ES256 и проверяется открытым ключом', () => {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const vapid = { publicKey: b64u(ecdh.getPublicKey()), privateKey: b64u(ecdh.getPrivateKey()) };
  const jwt = vapidJwt(vapid, 'https://fcm.googleapis.com', 'mailto:admin@example.ru');
  const v = verifyJwt(jwt, vapid.publicKey);
  assert.equal(v.ok, true);
  assert.deepEqual(v.header, { typ: 'JWT', alg: 'ES256' });
  assert.equal(v.claims.aud, 'https://fcm.googleapis.com');
  assert.equal(v.claims.sub, 'mailto:admin@example.ru');
  assert.ok(v.claims.exp > Date.now() / 1000 && v.claims.exp <= Date.now() / 1000 + 24 * 3600);
  const wrong = crypto.createECDH('prime256v1'); wrong.generateKeys();
  assert.equal(verifyJwt(jwt, b64u(wrong.getPublicKey())).ok, false);
});

test('сервер отправляет push о новом сообщении и забывает подписку после 410', async () => {
  const got = [];
  let status = 201;
  const ps = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => { got.push({ headers: req.headers, body: Buffer.concat(chunks) }); res.writeHead(status); res.end(); });
  });
  await new Promise(r => ps.listen(0, '127.0.0.1', r));
  const srv = await startServer({ PUSH_ENABLED: '1', PUSH_ALLOW_LOCAL: '1' });
  try {
    const pubKey = (await srv.client().get('/api/config')).body.vapidPublicKey;
    assert.match(pubKey, /^[A-Za-z0-9_-]{87}$/);
    const a = await srv.user('push-a@example.ru', { name: 'Анна' });
    const b = await srv.user('push-b@example.ru');
    const r = receiverKeys();
    const endpoint = `http://127.0.0.1:${ps.address().port}/push/1`;
    assert.equal((await b.post('/api/push/subscribe', { subscription: { endpoint, keys: r.sub } })).status, 200);
    await mutualLike(b, a); // b ставит первым, a — взаимно: push о симпатии получает b
    await a.post('/api/messages', { to: b.id, text: 'Привет' });
    for (let i = 0; i < 100 && got.length < 2; i++) await new Promise(res => setTimeout(res, 20));
    assert.equal(got.length, 2);
    const payloads = got.map(g => JSON.parse(decrypt(g.body, r.ecdh, r.auth)));
    assert.deepEqual(payloads.map(p => p.title).sort(), ['Взаимная симпатия!', 'Новое сообщение']);
    assert.ok(payloads.every(p => typeof p.url === 'string' && p.body.includes('Анна')));
    const h = got[0].headers;
    assert.equal(h['content-encoding'], 'aes128gcm');
    const m = /^vapid t=([^,]+), k=(.+)$/.exec(h.authorization);
    assert.equal(m[2], pubKey);
    assert.equal(verifyJwt(m[1], pubKey).ok, true);
    assert.equal(verifyJwt(m[1], pubKey).claims.aud, `http://127.0.0.1:${ps.address().port}`);

    status = 410;
    await a.post('/api/messages', { to: b.id, text: 'Ещё' });
    for (let i = 0; i < 100 && srv.app.db.get('SELECT COUNT(*) AS n FROM push_subs').n; i++) await new Promise(res => setTimeout(res, 20));
    assert.equal(srv.app.db.get('SELECT COUNT(*) AS n FROM push_subs').n, 0);
  } finally {
    await srv.close();
    ps.close();
  }
});

test('push-подписка принимает только службы push', async () => {
  const srv = await startServer({ PUSH_ENABLED: '1' });
  try {
    const a = await srv.user('push@example.ru');
    const keys = { p256dh: 'B'.repeat(87), auth: 'A'.repeat(22) };
    assert.equal((await a.post('/api/push/subscribe', { subscription: { endpoint: 'https://evil.example/x', keys } })).body.field, 'endpoint');
    assert.equal((await a.post('/api/push/subscribe', { subscription: { endpoint: 'http://127.0.0.1:1/x', keys } })).body.field, 'endpoint');
    assert.equal((await a.post('/api/push/subscribe', { subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys } })).status, 200);
    assert.equal((await a.post('/api/push/unsubscribe', { endpoint: 'https://fcm.googleapis.com/fcm/send/abc' })).status, 200);
    assert.equal(srv.app.db.get('SELECT COUNT(*) AS n FROM push_subs').n, 0);
  } finally { await srv.close(); }
});
