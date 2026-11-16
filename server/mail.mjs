// Отправка писем: маленький SMTP-клиент на node:net/node:tls (SMTPS 465 или STARTTLS 587, AUTH LOGIN)
// и тексты писем на русском и английском.
import crypto from 'node:crypto';
import net from 'node:net';
import os from 'node:os';
import tls from 'node:tls';
import { textFor } from './langs.mjs';

const TIMEOUT = 20000;
const b64 = s => Buffer.from(s, 'utf8').toString('base64');
const wrap76 = s => s.replace(/.{1,76}/g, '$&\r\n');
const encodeWord = s => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);
export const addressOf = from => (/<([^>]+)>/.exec(from)?.[1] || from).trim();
const isLocalHost = h => ['localhost', '127.0.0.1', '::1'].includes(h);

// Чтение ответов SMTP-сервера, включая многострочные (250-…, 250 …).
function replyReader(sock) {
  let buf = '', lines = [], pending = null, error = null;
  const feed = () => {
    if (!pending) return;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, '');
      buf = buf.slice(i + 1);
      lines.push(line);
      if (/^\d{3}(?: |$)/.test(line)) {
        const reply = { code: Number(line.slice(0, 3)), text: lines.join('\n') };
        lines = [];
        const p = pending; pending = null;
        p.resolve(reply);
        return;
      }
    }
  };
  const onData = d => { buf += d.toString('utf8'); feed(); };
  const onEnd = e => {
    error = e || new Error('smtp: соединение закрыто');
    if (pending) { pending.reject(error); pending = null; }
  };
  sock.on('data', onData);
  sock.on('error', onEnd);
  sock.on('close', () => onEnd());
  return {
    read: () => new Promise((resolve, reject) => {
      if (error) return reject(error);
      pending = { resolve, reject };
      feed();
    }),
    detach: () => sock.removeListener('data', onData),
  };
}

function connect(opts) {
  return new Promise((resolve, reject) => {
    const sock = opts.secure
      ? tls.connect({ host: opts.host, port: opts.port, servername: opts.host })
      : net.connect({ host: opts.host, port: opts.port });
    sock.setTimeout(TIMEOUT, () => sock.destroy(new Error('smtp: таймаут')));
    sock.once(opts.secure ? 'secureConnect' : 'connect', () => resolve(sock));
    sock.once('error', reject);
  });
}

function upgrade(sock, host) {
  return new Promise((resolve, reject) => {
    const s = tls.connect({ socket: sock, servername: host });
    s.setTimeout(TIMEOUT, () => s.destroy(new Error('smtp: таймаут')));
    s.once('secureConnect', () => resolve(s));
    s.once('error', reject);
  });
}

export function buildMessage({ from, to, subject, text, html }) {
  const boundary = 'lvc' + crypto.randomBytes(12).toString('hex');
  const m = /^(.*?)\s*<([^>]+)>$/.exec(from);
  const fromHeader = m && m[1] ? `${encodeWord(m[1].replace(/^"|"$/g, ''))} <${m[2]}>` : from;
  const domain = addressOf(from).split('@')[1] || 'localhost';
  const lines = [
    `From: ${fromHeader}`,
    `To: ${to}`,
    `Subject: ${encodeWord(subject)}`,
    `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${crypto.randomBytes(12).toString('hex')}@${domain}>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(b64(text)),
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(b64(html)),
    `--${boundary}--`,
    '',
  ];
  // Точка в начале строки удваивается (dot-stuffing), переводы строк — CRLF.
  return lines.join('\r\n').replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
}

// Отправка одного письма. smtp = { host, port, user, pass, from }.
export async function sendSmtp(smtp, mail) {
  const secure = smtp.port === 465;
  let sock = await connect({ host: smtp.host, port: smtp.port, secure });
  let reader = replyReader(sock);
  const expect = async (codes, line) => {
    if (line !== undefined) sock.write(line + '\r\n');
    const r = await reader.read();
    if (!codes.includes(r.code)) throw new Error(`smtp: ${line ? line.split(' ')[0] : 'приветствие'} → ${r.text}`);
    return r;
  };
  try {
    await expect([220]);
    const helo = `EHLO ${os.hostname().replace(/[^\w.-]/g, '') || 'localhost'}`;
    let ehlo = await expect([250], helo);
    if (!secure) {
      if (/STARTTLS/i.test(ehlo.text)) {
        await expect([220], 'STARTTLS');
        reader.detach();
        sock = await upgrade(sock, smtp.host);
        reader = replyReader(sock);
        ehlo = await expect([250], helo);
      } else if (!isLocalHost(smtp.host)) {
        throw new Error('smtp: сервер не поддерживает STARTTLS, пароль не отправлен');
      }
    }
    if (smtp.user) {
      await expect([334], 'AUTH LOGIN');
      await expect([334], b64(smtp.user));
      await expect([235], b64(smtp.pass));
    }
    await expect([250], `MAIL FROM:<${addressOf(smtp.from)}>`);
    await expect([250, 251], `RCPT TO:<${mail.to}>`);
    await expect([354], 'DATA');
    await expect([250], buildMessage({ ...mail, from: smtp.from }) + '\r\n.');
    sock.write('QUIT\r\n');
  } finally {
    sock.end();
  }
}

// ---------- Тексты писем ----------

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const TEXTS = {
  ru: {
    brand: 'Любовь в цифрах',
    code: v => ({
      subject: `Код для входа: ${v.code}`,
      lines: [`Ваш код для входа на сайт «Любовь в цифрах»: ${v.code}`, 'Код действует 10 минут. Если вы не запрашивали код, просто проигнорируйте это письмо.'],
      big: v.code,
    }),
    match: v => ({
      subject: `Взаимная симпатия: ${v.name}`,
      lines: [`${v.name} тоже отметил(а) вашу анкету. Это взаимная симпатия — можно начинать переписку.`],
      link: { url: v.url, label: 'Открыть сайт' },
    }),
    message: v => ({
      subject: `Новое сообщение от ${v.name}`,
      lines: [`${v.name} написал(а) вам на сайте «Любовь в цифрах».`],
      link: { url: v.url, label: 'Прочитать' },
    }),
    footer: 'Уведомления можно отключить в настройках анкеты.',
  },
  en: {
    brand: 'Love in Numbers',
    code: v => ({
      subject: `Your sign-in code: ${v.code}`,
      lines: [`Your sign-in code for Love in Numbers: ${v.code}`, 'The code is valid for 10 minutes. If you did not request it, just ignore this email.'],
      big: v.code,
    }),
    match: v => ({
      subject: `It's a match: ${v.name}`,
      lines: [`${v.name} liked you back. It's a match — say hello!`],
      link: { url: v.url, label: 'Open the site' },
    }),
    message: v => ({
      subject: `New message from ${v.name}`,
      lines: [`${v.name} sent you a message on Love in Numbers.`],
      link: { url: v.url, label: 'Read it' },
    }),
    footer: 'You can turn off notifications in your profile settings.',
  },
  uk: {
    brand: 'Любов у цифрах',
    code: v => ({
      subject: `Код для входу: ${v.code}`,
      lines: [`Ваш код для входу на сайт «Любов у цифрах»: ${v.code}`, 'Код дійсний 10 хвилин. Якщо ви не запитували код, просто проігноруйте цей лист.'],
      big: v.code,
    }),
    match: v => ({
      subject: `Взаємна симпатія: ${v.name}`,
      lines: [`${v.name} теж відзначив(ла) вашу анкету. Це взаємна симпатія — можна починати листування.`],
      link: { url: v.url, label: 'Відкрити сайт' },
    }),
    message: v => ({
      subject: `Нове повідомлення від ${v.name}`,
      lines: [`${v.name} написав(ла) вам на сайті «Любов у цифрах».`],
      link: { url: v.url, label: 'Прочитати' },
    }),
    footer: 'Сповіщення можна вимкнути в налаштуваннях анкети.',
  },
  kk: {
    brand: 'Махаббат сандарда',
    code: v => ({
      subject: `Кіру коды: ${v.code}`,
      lines: [`«Махаббат сандарда» сайтына кіру кодыңыз: ${v.code}`, 'Код 10 минут жарамды. Егер код сұрамаған болсаңыз, бұл хатты елемеңіз.'],
      big: v.code,
    }),
    match: v => ({
      subject: `Өзара ұнату: ${v.name}`,
      lines: [`${v.name} да сіздің анкетаңызды белгіледі. Бұл өзара ұнату — хат алмасуды бастауға болады.`],
      link: { url: v.url, label: 'Сайтты ашу' },
    }),
    message: v => ({
      subject: `Жаңа хабар, жіберуші: ${v.name}`,
      lines: [`${v.name} сізге «Махаббат сандарда» сайтында жазды.`],
      link: { url: v.url, label: 'Оқу' },
    }),
    footer: 'Хабарламаларды анкета баптауларында өшіруге болады.',
  },
  uz: {
    brand: 'Sevgi raqamlarda',
    code: v => ({
      subject: `Kirish kodi: ${v.code}`,
      lines: [`«Sevgi raqamlarda» saytiga kirish kodingiz: ${v.code}`, 'Kod 10 daqiqa amal qiladi. Agar kod soʻramagan boʻlsangiz, bu xatga eʼtibor bermang.'],
      big: v.code,
    }),
    match: v => ({
      subject: `Oʻzaro yoqtirish: ${v.name}`,
      lines: [`${v.name} ham anketangizni belgiladi. Bu oʻzaro yoqtirish — yozishmani boshlash mumkin.`],
      link: { url: v.url, label: 'Saytni ochish' },
    }),
    message: v => ({
      subject: `Yangi xabar: ${v.name}`,
      lines: [`${v.name} sizga «Sevgi raqamlarda» saytida yozdi.`],
      link: { url: v.url, label: 'Oʻqish' },
    }),
    footer: 'Bildirishnomalarni anketa sozlamalarida oʻchirish mumkin.',
  },
  de: {
    brand: 'Liebe in Zahlen',
    code: v => ({
      subject: `Dein Anmeldecode: ${v.code}`,
      lines: [`Dein Anmeldecode für „Liebe in Zahlen“: ${v.code}`, 'Der Code ist 10 Minuten gültig. Wenn du ihn nicht angefordert hast, ignoriere diese E-Mail einfach.'],
      big: v.code,
    }),
    match: v => ({
      subject: `Ein Match: ${v.name}`,
      lines: [`${v.name} mag dich auch. Ein Match — schreib einfach los!`],
      link: { url: v.url, label: 'Seite öffnen' },
    }),
    message: v => ({
      subject: `Neue Nachricht von ${v.name}`,
      lines: [`${v.name} hat dir bei „Liebe in Zahlen“ geschrieben.`],
      link: { url: v.url, label: 'Lesen' },
    }),
    footer: 'Benachrichtigungen kannst du in den Profileinstellungen ausschalten.',
  },
  es: {
    brand: 'Amor en Números',
    code: v => ({
      subject: `Tu código de acceso: ${v.code}`,
      lines: [`Tu código de acceso a «Amor en Números»: ${v.code}`, 'El código es válido durante 10 minutos. Si no lo has pedido, ignora este correo.'],
      big: v.code,
    }),
    match: v => ({
      subject: `Es un match: ${v.name}`,
      lines: [`${v.name} también te ha dado me gusta. ¡Es un match, salúdale!`],
      link: { url: v.url, label: 'Abrir el sitio' },
    }),
    message: v => ({
      subject: `Nuevo mensaje de ${v.name}`,
      lines: [`${v.name} te ha escrito en «Amor en Números».`],
      link: { url: v.url, label: 'Leer' },
    }),
    footer: 'Puedes desactivar las notificaciones en los ajustes del perfil.',
  },
  fr: {
    brand: "L'Amour en Chiffres",
    code: v => ({
      subject: `Votre code de connexion : ${v.code}`,
      lines: [`Votre code de connexion à « L'Amour en Chiffres » : ${v.code}`, "Le code est valable 10 minutes. Si vous ne l'avez pas demandé, ignorez simplement cet e-mail."],
      big: v.code,
    }),
    match: v => ({
      subject: `C'est un match : ${v.name}`,
      lines: [`${v.name} vous a aussi aimé. C'est un match : dites bonjour !`],
      link: { url: v.url, label: 'Ouvrir le site' },
    }),
    message: v => ({
      subject: `Nouveau message de ${v.name}`,
      lines: [`${v.name} vous a écrit sur « L'Amour en Chiffres ».`],
      link: { url: v.url, label: 'Lire' },
    }),
    footer: 'Vous pouvez désactiver les notifications dans les paramètres du profil.',
  },
};

export function renderMail(kind, lang, vars) {
  const t = textFor(TEXTS, lang);
  const m = t[kind](vars);
  const withFooter = kind !== 'code';
  const text = [...m.lines, ...(m.link?.url ? [m.link.url] : []), ...(withFooter ? ['', t.footer] : []), '', `— ${t.brand}`].join('\n');
  const html = `<!doctype html><html><body style="margin:0;background:#f1e1f6;font-family:Arial,sans-serif;color:#23163a">
<div style="max-width:520px;margin:0 auto;padding:24px">
<div style="font-family:Georgia,serif;font-size:22px;margin-bottom:16px">${esc(t.brand)}</div>
<div style="background:#fff;border-radius:16px;padding:20px 22px;line-height:1.55">
${m.lines.map(l => `<p style="margin:0 0 12px">${esc(l)}</p>`).join('')}
${m.big ? `<p style="font-size:32px;letter-spacing:6px;font-weight:bold;margin:8px 0 4px;color:#d93a63">${esc(m.big)}</p>` : ''}
${m.link?.url ? `<p style="margin:16px 0 0"><a href="${esc(m.link.url)}" style="display:inline-block;background:#d93a63;color:#fff;text-decoration:none;padding:10px 18px;border-radius:999px">${esc(m.link.label)}</a></p>` : ''}
</div>
${withFooter ? `<p style="color:#6d6380;font-size:13px;margin-top:14px">${esc(t.footer)}</p>` : ''}
</div></body></html>`;
  return { subject: m.subject, text, html };
}

// Почтальон приложения. Если SMTP не настроен, письма пишутся в журнал (и в outbox для тестов).
export function createMailer(config, log) {
  const outbox = [];
  async function send(to, kind, lang, vars) {
    const mail = { to, ...renderMail(kind, lang, vars) };
    if (!config.smtp) {
      outbox.push({ to, kind, ...vars });
      if (outbox.length > 100) outbox.shift();
      log.info(`[почта не настроена] ${to}: ${mail.subject}`);
      return;
    }
    await sendSmtp(config.smtp, mail);
  }
  return { configured: Boolean(config.smtp), send, outbox };
}
