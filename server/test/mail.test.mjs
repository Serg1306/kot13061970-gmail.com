import assert from 'node:assert/strict';
import net from 'node:net';
import { test } from 'node:test';
import { renderMail, sendSmtp } from '../mail.mjs';
import { startServer } from './helpers.mjs';

// Простейший SMTP-сервер для проверки диалога: EHLO, AUTH LOGIN, MAIL, RCPT, DATA.
function fakeSmtp({ rejectPass = false } = {}) {
  const mails = [];
  const server = net.createServer(sock => {
    let buf = '', inData = false, data = '', auth = [];
    const mail = { auth };
    sock.write('220 fake ESMTP\r\n');
    sock.on('data', d => {
      buf += d.toString('utf8');
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (inData) {
          if (line === '.') { inData = false; mail.data = data; mails.push(mail); sock.write('250 queued\r\n'); } else data += line + '\r\n';
          continue;
        }
        if (auth.length === 1 || auth.length === 2) {
          auth.push(Buffer.from(line, 'base64').toString());
          sock.write(auth.length === 2 ? '334 UGFzc3dvcmQ6\r\n' : rejectPass ? '535 5.7.8 Invalid user or password\r\n' : '235 ok\r\n');
          continue;
        }
        if (/^EHLO/.test(line)) sock.write('250-fake\r\n250-AUTH LOGIN PLAIN\r\n250 8BITMIME\r\n');
        else if (line === 'AUTH LOGIN') { auth.push('start'); sock.write('334 VXNlcm5hbWU6\r\n'); }
        else if (/^MAIL FROM:/.test(line)) { mail.from = line; sock.write('250 ok\r\n'); }
        else if (/^RCPT TO:/.test(line)) { mail.to = line; sock.write('250 ok\r\n'); }
        else if (line === 'DATA') { inData = true; sock.write('354 go\r\n'); }
        else if (line === 'QUIT') { sock.end('221 bye\r\n'); }
        else sock.write('500 ?\r\n');
      }
    });
  });
  return { server, mails };
}

const textPart = data => {
  const m = /Content-Type: text\/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n([\s\S]*?)\r\n--/.exec(data);
  return Buffer.from(m[1].replace(/\s+/g, ''), 'base64').toString('utf8');
};

test('письмо с кодом уходит через SMTP с AUTH LOGIN', async () => {
  const smtp = fakeSmtp();
  await new Promise(r => smtp.server.listen(0, '127.0.0.1', r));
  const srv = await startServer({
    SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.server.address().port),
    SMTP_USER: 'robot@lvc.ru', SMTP_PASS: 'secret', SMTP_FROM: 'Любовь в цифрах <robot@lvc.ru>',
  });
  try {
    const r = await srv.client().post('/api/auth/start', { email: 'Mail@Example.ru', lang: 'ru' });
    assert.equal(r.status, 200);
    assert.equal(smtp.mails.length, 1);
    const m = smtp.mails[0];
    assert.deepEqual(m.auth, ['start', 'robot@lvc.ru', 'secret']);
    assert.equal(m.from, 'MAIL FROM:<robot@lvc.ru>');
    assert.equal(m.to, 'RCPT TO:<mail@example.ru>');
    assert.match(m.data, /^From: =\?UTF-8\?B\?[^?]+\?= <robot@lvc\.ru>/m);
    assert.match(m.data, /multipart\/alternative/);
    assert.match(textPart(m.data), new RegExp(`Ваш код для входа.*${r.body.devCode}`));
  } finally {
    await srv.close();
    smtp.server.close();
  }
});

test('тексты писем на двух языках', () => {
  const ru = renderMail('match', 'ru', { name: 'Анна', url: 'https://x.ru/' });
  assert.match(ru.subject, /Взаимная симпатия: Анна/);
  assert.match(ru.html, /href="https:\/\/x\.ru\/"/);
  const en = renderMail('message', 'en', { name: '<b>Bob</b>', url: '' });
  assert.equal(en.subject, 'New message from <b>Bob</b>');
  assert.match(en.html, /&lt;b&gt;Bob&lt;\/b&gt;/);
  assert.match(renderMail('code', 'en', { code: '123456' }).text, /Your sign-in code for Love in Numbers: 123456/);
});

test('письма на всех языках сайта, неизвестный язык — по-русски', () => {
  for (const [lang, re] of [['uk', /^Код для входу/], ['kk', /^Кіру коды/], ['uz', /^Kirish kodi/], ['de', /^Dein Anmeldecode/], ['es', /^Tu código/], ['fr', /^Votre code/], [undefined, /^Код для входа/]]) {
    assert.match(renderMail('code', lang, { code: '123456' }).subject, re);
  }
  assert.match(renderMail('message', 'es', { name: 'Ana', url: 'https://x' }).text, /Ana te ha escrito/);
});

test('вход по почте включается сам, когда настроена почта; телефон — нет; EMAIL_LOGIN=0 выключает', async () => {
  const smtp = fakeSmtp();
  await new Promise(r => smtp.server.listen(0, '127.0.0.1', r));
  const mail = { SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.server.address().port), SMTP_USER: 'robot@lvc.ru', SMTP_PASS: 'secret', SMTP_FROM: 'robot@lvc.ru', DEV_CODES: '' };
  const srv = await startServer(mail);
  try {
    const c = srv.client();
    const cfg = (await c.get('/api/config')).body;
    assert.equal(cfg.emailLogin, true);
    assert.equal(cfg.codeLogin, false);
    assert.equal(cfg.phoneLogin, false);
    assert.equal((await c.post('/api/auth/start', { phone: '+79120000000' })).body.error, 'code_login_off');
    assert.equal((await c.post('/api/auth/start', { email: 'guest@example.ru', lang: 'ru' })).status, 200);
    const code = /(\d{6})/.exec(textPart(smtp.mails.at(-1).data))[1];
    assert.equal((await c.post('/api/auth/verify', { email: 'guest@example.ru', code })).status, 200);
    assert.equal((await c.get('/api/me')).status, 200);
  } finally { await srv.close(); }
  const off = await startServer({ ...mail, EMAIL_LOGIN: '0' });
  try {
    const c = off.client();
    assert.equal((await c.get('/api/config')).body.emailLogin, false);
    assert.equal((await c.post('/api/auth/start', { email: 'guest@example.ru' })).body.error, 'code_login_off');
  } finally { await off.close(); smtp.server.close(); }
});

test('ошибка SMTP не уносит в журнал логин и пароль из AUTH LOGIN', async () => {
  const smtp = fakeSmtp({ rejectPass: true });
  await new Promise(r => smtp.server.listen(0, '127.0.0.1', r));
  const pass = 'Super-Secret-Pass', user = 'robot@lvc.ru';
  try {
    const err = await sendSmtp({ host: '127.0.0.1', port: smtp.server.address().port, user, pass, from: user }, { to: 'x@y.ru', subject: 's', text: 't', html: 't' }).then(() => null, e => e);
    assert.ok(err);
    assert.match(err.message, /AUTH \(пароль\) → 535/);
    for (const secret of [pass, user, Buffer.from(pass).toString('base64'), Buffer.from(user).toString('base64')]) assert.ok(!err.message.includes(secret), secret);
  } finally { smtp.server.close(); }
});
