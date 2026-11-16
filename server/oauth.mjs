// Вход через VK ID и Яндекс ID (OAuth 2.0 с PKCE). Ключи — в .env сервера, в браузер не попадают:
//   VK_CLIENT_ID                         — ID приложения VK ID (id.vk.com/about/business/go)
//   YANDEX_CLIENT_ID, YANDEX_CLIENT_SECRET — ClientID и Client secret приложения Яндекс ID (oauth.yandex.ru)
//   VK_ID_URL, YANDEX_OAUTH_URL, YANDEX_LOGIN_URL — адреса API (меняются только в автотестах)
// Адрес возврата: PUBLIC_URL + /api/oauth/vk/callback (или /yandex/callback), его же указывают в настройках приложений.
import crypto from 'node:crypto';

const trim = s => String(s || '').replace(/\/+$/, '');

export function oauthConfig(env) {
  return {
    vk: env.VK_CLIENT_ID ? {
      clientId: env.VK_CLIENT_ID,
      base: trim(env.VK_ID_URL || 'https://id.vk.com'),
    } : null,
    yandex: env.YANDEX_CLIENT_ID && env.YANDEX_CLIENT_SECRET ? {
      clientId: env.YANDEX_CLIENT_ID,
      secret: env.YANDEX_CLIENT_SECRET,
      base: trim(env.YANDEX_OAUTH_URL || 'https://oauth.yandex.ru'),
      info: trim(env.YANDEX_LOGIN_URL || 'https://login.yandex.ru'),
    } : null,
  };
}

export const pkce = () => {
  const verifier = crypto.randomBytes(32).toString('base64url');
  return { verifier, challenge: crypto.createHash('sha256').update(verifier).digest('base64url') };
};

export function authorizeUrl(provider, c, { state, challenge, redirectUri }) {
  const q = new URLSearchParams({
    response_type: 'code', client_id: c.clientId, redirect_uri: redirectUri, state,
    code_challenge: challenge, code_challenge_method: 'S256',
  });
  if (provider === 'vk') q.set('scope', 'vkid.personal_info phone');
  return `${c.base}/authorize?${q}`;
}

async function call(url, opts) {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(15000) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) throw new Error(`${new URL(url).host}: ${body.error || res.status} ${body.error_description || ''}`.trim());
  return body;
}

const form = data => ({
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(data),
});

// ДД.ММ.ГГГГ или ГГГГ-ММ-ДД → ГГГГ-ММ-ДД; год обязателен.
function isoDate(s) {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s || '');
  const d = m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : String(s || '');
  return /^\d{4}-\d{2}-\d{2}$/.test(d) && d !== '0000-00-00' ? d : '';
}

// Код из адреса возврата → профиль: sub (постоянный ID у провайдера), телефон и почта, если они подтверждены, подсказки для анкеты.
export async function fetchProfile(provider, c, { code, verifier, deviceId, state, redirectUri }) {
  if (provider === 'vk') {
    const t = await call(`${c.base}/oauth2/auth`, form({
      grant_type: 'authorization_code', code, code_verifier: verifier, client_id: c.clientId, device_id: deviceId || '', redirect_uri: redirectUri, state,
    }));
    const { user: u = {} } = await call(`${c.base}/oauth2/user_info`, form({ client_id: c.clientId, access_token: t.access_token }));
    const sub = String(u.user_id || t.user_id || '');
    if (!/^\d+$/.test(sub)) throw new Error('VK ID: нет user_id');
    // Почту из VK не берём: VK не гарантирует, что она подтверждена. Телефон VK подтверждает всегда.
    return { sub, phone: u.phone || '', email: '', name: u.first_name || '', birth: isoDate(u.birthday), g: u.sex === 1 ? 'f' : u.sex === 2 ? 'm' : '' };
  }
  const t = await call(`${c.base}/token`, form({
    grant_type: 'authorization_code', code, code_verifier: verifier, client_id: c.clientId, client_secret: c.secret,
  }));
  const u = await call(`${c.info}/info?format=json`, { headers: { authorization: `OAuth ${t.access_token}` } });
  const sub = String(u.id || '');
  if (!/^\d+$/.test(sub)) throw new Error('Яндекс ID: нет id');
  return {
    sub, phone: u.default_phone?.number || '', email: u.default_email || '', name: u.first_name || '',
    birth: isoDate(u.birthday), g: u.sex === 'female' ? 'f' : u.sex === 'male' ? 'm' : '',
  };
}
