import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';
import { maskEmail } from '../pd.mjs';
import { codeText, normPhone } from '../sms.mjs';
import { startServer } from './helpers.mjs';

// Поддельный SMS.ru: запоминает запросы; номер 79990000000 отвечает ошибкой, как при недоступном номере.
function startSmsMock() {
  const hits = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', () => {
      const q = Object.fromEntries(new URLSearchParams(raw));
      hits.push({ path: req.url, ...q });
      const body = { status: 'OK', status_code: 100, balance: 500, sms: { [q.to]: q.to === '79990000000'
        ? { status: 'ERROR', status_code: 207, status_text: 'На этот номер нельзя отправлять сообщения' }
        : { status: 'OK', status_code: 100, sms_id: '000000-1' } } };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({
    hits, url: `http://127.0.0.1:${server.address().port}`, close: () => server.close(),
  })));
}

let mock, srv, dev;
before(async () => {
  mock = await startSmsMock();
  srv = await startServer({
    DEV_CODES: '', CODE_LOGIN: '1', SMS_RU_API_ID: 'test-api-id', SMS_API_URL: mock.url, SMS_PREFIXES: '7,998', SMS_DAILY_LIMIT: '4',
    PUBLIC_URL: 'https://lyubovvcifrah.ru', ADMIN_EMAILS: 'admin@lvc.test, 8 (900) 555-00-11',
  });
  dev = await startServer();
});
after(async () => { await srv.close(); await dev.close(); mock.close(); });

test('номер телефона приводится к виду +79991234567', () => {
  assert.equal(normPhone('8 (999) 123-45-67'), '+79991234567');
  assert.equal(normPhone('+7 999 123 45 67'), '+79991234567');
  assert.equal(normPhone('9991234567'), '+79991234567');
  assert.equal(normPhone('+998 90 123 45 67'), '+998901234567');
  assert.equal(normPhone('+7 999 123'), '');
  assert.equal(normPhone('12345'), '');
  assert.equal(normPhone('abc'), '');
  assert.equal(maskEmail('+79991234567'), '+7********67');
  assert.equal(codeText('1234', 'ru', 'https://lyubovvcifrah.ru'), 'Код входа в «Любовь в цифрах»: 1234\n\n@lyubovvcifrah.ru #1234');
});

test('вход по телефону: код из 4 цифр уходит в СМС, второй вход — в тот же аккаунт', async () => {
  const cfg = await srv.client().get('/api/config');
  assert.equal(cfg.body.phoneLogin, true);

  const c = srv.client();
  const s = await c.post('/api/auth/start', { phone: '8 912 345-67-89', lang: 'ru' });
  assert.equal(s.status, 200);
  assert.equal(s.body.devCode, undefined, 'без DEV_CODES код в ответе не отдаётся');
  const hit = mock.hits.at(-1);
  assert.equal(hit.path, '/sms/send');
  assert.equal(hit.api_id, 'test-api-id');
  assert.equal(hit.to, '79123456789');
  const code = /: (\d{4})\n/.exec(hit.msg)[1];
  assert.match(hit.msg, /@lyubovvcifrah\.ru #\d{4}$/);

  const v = await c.post('/api/auth/verify', { phone: '+7 912 345 67 89', code });
  assert.equal(v.status, 200);
  const prof = await c.put('/api/profile', { name: 'Оля', birth: '1992-03-04', g: 'f', seek: 'm', city: 'Москва', about: '', consent: true, consentPublic: true });
  assert.equal(prof.status, 200);
  assert.equal(prof.body.user.email, '+79123456789');

  const c2 = srv.client();
  assert.equal((await c2.post('/api/auth/start', { phone: '89123456789' })).status, 200);
  assert.equal((await c2.post('/api/auth/start', { phone: '89123456789' })).body.error, 'too_often', 'новый код не раньше чем через минуту');
  const code2 = /: (\d{4})\n/.exec(mock.hits.at(-1).msg)[1];
  const v2 = await c2.post('/api/auth/verify', { phone: '89123456789', code: code2 });
  assert.equal(v2.body.user.id, prof.body.user.id);
});

test('телефон: неверный номер, чужая страна, ошибка SMS.ru, суточный лимит', async () => {
  const c = srv.client();
  assert.equal((await c.post('/api/auth/start', { phone: '123' })).body.error, 'bad_phone');
  assert.equal((await c.post('/api/auth/start', { phone: '+380 50 123 45 67' })).body.error, 'phone_country');
  const failed = await c.post('/api/auth/start', { phone: '+7 999 000 00 00' });
  assert.equal(failed.status, 502);
  assert.equal(failed.body.error, 'sms_failed');
  assert.equal(srv.app.db.get('SELECT 1 FROM codes WHERE email = ?', '+79990000000'), undefined, 'код без СМС не остаётся');
  // В этом сервере лимит 4 СМС в сутки: два ушло в прошлом тесте, ещё два — и дальше отказ.
  assert.equal((await c.post('/api/auth/start', { phone: '+998 90 123 45 67' })).status, 200);
  assert.equal((await c.post('/api/auth/start', { phone: '+7 901 111 22 33' })).status, 200);
  const limit = await c.post('/api/auth/start', { phone: '+7 901 111 22 44' });
  assert.equal(limit.status, 503);
  assert.equal(limit.body.error, 'sms_limit');
});

test('режим разработки: код в ответе; телефон в списке админов', async () => {
  const c = dev.client();
  // На сервере без SMS.ru, но с DEV_CODES вход по телефону работает с кодом в ответе.
  assert.equal((await c.get('/api/config')).body.phoneLogin, true);
  const s = await c.post('/api/auth/start', { phone: '+7 900 555 00 11' });
  assert.match(s.body.devCode, /^\d{4}$/);
  assert.equal(srv.app.config.adminEmails.has('+79005550011'), true);
});

test('без SMS.ru и без DEV_CODES вход по телефону выключен', async () => {
  const off = await startServer({ DEV_CODES: '', CODE_LOGIN: '1' });
  try {
    const c = off.client();
    assert.equal((await c.get('/api/config')).body.phoneLogin, false);
    assert.equal((await c.post('/api/auth/start', { phone: '+79991234567' })).body.error, 'sms_off');
  } finally { await off.close(); }
});
