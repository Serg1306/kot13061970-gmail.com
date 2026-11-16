import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { after, before, test } from 'node:test';
import { startServer } from './helpers.mjs';

// Поддельные VK ID и Яндекс ID: код «good-<id>» выдаёт токен человека <id>, проверяют PKCE.
function startProviderMock() {
  const challenges = new Map();
  const people = {
    vk: { 11: { user_id: 11, first_name: 'Аня', birthday: '4.3.1992', sex: 1, phone: '79120000011', email: 'anya@mail.test' } },
    ya: {
      21: { id: '21', first_name: 'Борис', birthday: '1988-07-15', sex: 'male', default_email: 'Boris@Ya.test', default_phone: { number: '+79120000021' } },
      22: { id: '22', first_name: 'Вера', birthday: null, sex: null, default_email: 'old@lvc.test' },
    },
  };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', () => {
      const q = Object.fromEntries(new URLSearchParams(raw));
      const u = new URL(req.url, 'http://x');
      const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
      const id = /^good-(\d+)$/.exec(q.code || '')?.[1];
      const pkceOk = id && challenges.get(q.code) === crypto.createHash('sha256').update(q.code_verifier || '').digest('base64url');
      if (u.pathname === '/vk/oauth2/auth') {
        if (!pkceOk || !q.device_id || q.client_id !== 'vk-app') return send(400, { error: 'invalid_grant' });
        return send(200, { access_token: 'vk-' + id, user_id: +id });
      }
      if (u.pathname === '/vk/oauth2/user_info') return send(200, { user: people.vk[q.access_token.slice(3)] });
      if (u.pathname === '/ya/token') {
        if (!pkceOk || q.client_secret !== 'ya-secret') return send(400, { error: 'invalid_grant', error_description: 'bad code' });
        return send(200, { access_token: 'ya-' + id });
      }
      if (u.pathname === '/ya-login/info') return send(200, people.ya[req.headers.authorization.replace('OAuth ya-', '')]);
      send(404, { error: 'not_found' });
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({
    url: `http://127.0.0.1:${server.address().port}`, challenges, close: () => server.close(),
  })));
}

let mock, srv;
before(async () => {
  mock = await startProviderMock();
  srv = await startServer({
    PUBLIC_URL: 'https://lyubovvcifrah.ru',
    VK_CLIENT_ID: 'vk-app', VK_ID_URL: mock.url + '/vk',
    YANDEX_CLIENT_ID: 'ya-app', YANDEX_CLIENT_SECRET: 'ya-secret', YANDEX_OAUTH_URL: mock.url + '/ya', YANDEX_LOGIN_URL: mock.url + '/ya-login',
  });
});
after(async () => { await srv.close(); mock.close(); });

const get = (url, cookie = '') => fetch(srv.base + url, { redirect: 'manual', headers: cookie ? { cookie } : {} });
const cookieOf = (res, name) => res.headers.getSetCookie().map(c => c.split(';')[0]).find(c => c.startsWith(name + '='));

// Весь путь: кнопка на сайте → провайдер (подделка выдаёт код) → возврат на сайт.
async function signIn(provider, id, { extra = '', cookie } = {}) {
  const start = await get(`/api/oauth/${provider}?lang=ru&s=vk&m=cpc`);
  assert.equal(start.status, 302);
  const to = new URL(start.headers.get('location'));
  const state = to.searchParams.get('state');
  mock.challenges.set(`good-${id}`, to.searchParams.get('code_challenge'));
  const back = await get(`/api/oauth/${provider}/callback?code=good-${id}&state=${state}${extra}`, cookie ?? cookieOf(start, 'lvc_o'));
  return { start, to, back, session: cookieOf(back, 'lvc_s') };
}

test('конфигурация: сайт знает, какие кнопки показать', async () => {
  assert.deepEqual((await srv.client().get('/api/config')).body.oauth, ['vk', 'yandex']);
  const off = await startServer();
  try {
    assert.deepEqual((await off.client().get('/api/config')).body.oauth, []);
    assert.equal((await fetch(off.base + '/api/oauth/vk', { redirect: 'manual' })).status, 404);
  } finally { await off.close(); }
  assert.equal((await get('/api/oauth/toString')).status, 404);
});

test('VK ID: новый аккаунт по телефону, подсказки для анкеты, повторный вход в тот же аккаунт', async () => {
  const { to, back, session } = await signIn('vk', 11, { extra: '&device_id=dev1' });
  assert.equal(to.origin + to.pathname, mock.url + '/vk/authorize');
  assert.equal(to.searchParams.get('redirect_uri'), 'https://lyubovvcifrah.ru/api/oauth/vk/callback');
  assert.equal(to.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(back.status, 302);
  assert.equal(back.headers.get('location'), '/#join');
  assert.ok(session);
  const me = await (await fetch(srv.base + '/api/me', { headers: { cookie: session } })).json();
  assert.equal(me.user, null);
  assert.deepEqual(me.hint, { name: 'Аня', birth: '1992-03-04', g: 'f' });
  const row = srv.app.db.get('SELECT * FROM users WHERE email = ?', '+79120000011');
  assert.ok(row, 'логин — подтверждённый телефон из VK, почту из VK не берём');
  assert.equal(row.src, 'vk / cpc');

  const again = await signIn('vk', 11, { extra: '&device_id=dev2' });
  const me2 = await (await fetch(srv.base + '/api/me', { headers: { cookie: again.session } })).json();
  assert.equal(srv.app.db.get('SELECT user_id FROM sessions ORDER BY created_at DESC LIMIT 1').user_id, row.id);
  assert.deepEqual(me2.hint, me.hint);
});

test('Яндекс ID: вход в существующий аккаунт с той же почтой; с анкетой — сразу в кабинет', async () => {
  const old = await srv.user('old@lvc.test');
  const { back, session } = await signIn('yandex', 22);
  assert.equal(back.headers.get('location'), '/');
  const me = await (await fetch(srv.base + '/api/me', { headers: { cookie: session } })).json();
  assert.equal(me.user.id, old.id);
  assert.equal(me.hint, undefined);
  const exp = await (await fetch(srv.base + '/api/account/export', { headers: { cookie: session } })).json();
  assert.deepEqual(exp.linkedAccounts.map(a => [a.provider, a.id]), [['yandex', '22']], 'выгрузка данных показывает привязанный вход');

  // Новый человек: логином становится телефон из Яндекса (он идёт первым, почта — запасная).
  const b = await signIn('yandex', 21);
  assert.equal(b.back.headers.get('location'), '/#join');
  const me21 = await (await fetch(srv.base + '/api/me', { headers: { cookie: b.session } })).json();
  assert.deepEqual(me21.hint, { name: 'Борис', birth: '1988-07-15', g: 'm' });
  assert.ok(srv.app.db.get('SELECT 1 FROM users WHERE email = ?', '+79120000021'));
});

test('защита: чужой state, отмена у провайдера, плохой код', async () => {
  const start = await get('/api/oauth/vk');
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  // Ссылка возврата открыта в другом браузере (нет cookie с этим state) — входа нет.
  const stolen = await get(`/api/oauth/vk/callback?code=good-11&state=${state}&device_id=d`);
  assert.equal(stolen.headers.get('location'), '/?auth_err=oauth_state#join');
  assert.equal(cookieOf(stolen, 'lvc_s'), undefined);
  // state одноразовый.
  const reuse = await get(`/api/oauth/vk/callback?code=good-11&state=${state}&device_id=d`, cookieOf(start, 'lvc_o'));
  assert.equal(reuse.headers.get('location'), '/?auth_err=oauth_state#join');

  const s2 = await get('/api/oauth/yandex');
  const st2 = new URL(s2.headers.get('location')).searchParams.get('state');
  const cancel = await get(`/api/oauth/yandex/callback?error=access_denied&state=${st2}`, cookieOf(s2, 'lvc_o'));
  assert.equal(cancel.headers.get('location'), '/?auth_err=oauth_cancel#join');

  const s3 = await get('/api/oauth/yandex');
  const st3 = new URL(s3.headers.get('location')).searchParams.get('state');
  const bad = await get(`/api/oauth/yandex/callback?code=forged&state=${st3}`, cookieOf(s3, 'lvc_o'));
  assert.equal(bad.headers.get('location'), '/?auth_err=oauth_failed#join');
  assert.equal(cookieOf(bad, 'lvc_s'), undefined);
});
