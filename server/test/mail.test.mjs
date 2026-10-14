import assert from 'node:assert/strict';
import net from 'node:net';
import { test } from 'node:test';
import { renderMail } from '../mail.mjs';
import { startServer } from './helpers.mjs';

// Простейший SMTP-сервер для проверки диалога: EHLO, AUTH LOGIN, MAIL, RCPT, DATA.
function fakeSmtp() {
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
          sock.write(auth.length === 2 ? '334 UGFzc3dvcmQ6\r\n' : '235 ok\r\n');
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
