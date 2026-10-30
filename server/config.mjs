// Настройки сервера из переменных окружения (см. server/.env.example и docs/deploy.md).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { oauthConfig } from './oauth.mjs';
import { normPhone } from './sms.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SITE_DIR = path.join(ROOT, 'site', 'lyubov-v-cifrah');

const list = s => String(s || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);

export function loadConfig(env = process.env) {
  const dataDir = path.resolve(ROOT, env.DATA_DIR || 'data');
  const smtpPort = Number(env.SMTP_PORT) || 465;
  return {
    env,
    port: env.PORT === undefined || env.PORT === '' ? 8080 : Number(env.PORT),
    host: env.HOST || '0.0.0.0',
    dataDir,
    uploadsDir: path.join(dataDir, 'uploads'),
    privateDir: path.join(dataDir, 'private'),
    siteDir: env.SITE_DIR ? path.resolve(env.SITE_DIR) : SITE_DIR,
    publicUrl: String(env.PUBLIC_URL || '').replace(/\/+$/, ''),
    // Админы: почта или телефон (+79991234567), с которыми они входят.
    adminEmails: new Set(list(env.ADMIN_EMAILS).map(x => (x.includes('@') ? x : normPhone(x))).filter(Boolean)),
    smtp: env.SMTP_HOST ? {
      host: env.SMTP_HOST,
      port: smtpPort,
      user: env.SMTP_USER || '',
      pass: env.SMTP_PASS || '',
      from: env.SMTP_FROM || env.SMTP_USER || '',
    } : null,
    // СМС с кодом входа (SMS.ru), см. server/sms.mjs.
    sms: env.SMS_RU_API_ID ? {
      apiId: env.SMS_RU_API_ID,
      from: env.SMS_FROM || '',
      prefixes: String(env.SMS_PREFIXES || '7').split(',').map(x => x.replace(/\D/g, '')).filter(Boolean),
      dailyLimit: Number(env.SMS_DAILY_LIMIT) || 300,
      apiUrl: (env.SMS_API_URL || 'https://sms.ru').replace(/\/+$/, ''),
    } : null,
    // Вход через VK ID и Яндекс ID, см. server/oauth.mjs.
    oauth: oauthConfig(env),
    devCodes: env.DEV_CODES === '1',
    // Вход и регистрация по коду из СМС или письма. По умолчанию выключены: регистрация только через VK ID и Яндекс ID.
    // Админы из ADMIN_EMAILS входят по коду всегда (страница /#admin-login).
    codeLogin: env.CODE_LOGIN === '1' || env.DEV_CODES === '1',
    autoApprove: env.AUTO_APPROVE === '1',
    vapid: {
      publicKey: env.VAPID_PUBLIC_KEY || '',
      privateKey: env.VAPID_PRIVATE_KEY || '',
      subject: env.VAPID_SUBJECT || '',
    },
    // Push выключен по умолчанию: это трансграничная передача (Google/Mozilla/Apple), нужно уведомление РКН.
    pushEnabled: env.PUSH_ENABLED === '1',
    // Только для автотестов: разрешить push на http://127.0.0.1.
    pushAllowLocal: env.PUSH_ALLOW_LOCAL === '1',
    metrikaId: env.METRIKA_ID || null,
    // Редакция текста согласий на обработку ПДн: записывается вместе с согласием.
    consentVersion: env.CONSENT_VERSION || '2026-10-26',
    // ICE_SERVERS — JSON-список STUN/TURN для звонков, например [{"urls":"turn:203.0.113.10:3478","username":"u","credential":"p"}]
    iceServers: parseIce(env.ICE_SERVERS),
  };
}

function parseIce(raw) {
  if (!raw) return null;
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v : null; } catch { return null; }
}
