// Общие помощники для тестов: сервер на случайном порту с временной папкой данных и HTTP-клиент с cookie.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.removeAllListeners('warning');
const { createApp } = await import('../app.mjs');

export const ADMIN = 'admin@lvc.test';

// Минимальные «файлы» с правильными сигнатурами.
export const JPEG = 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(60, 1)]).toString('base64');
export const PNG = 'data:image/png;base64,' + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(60, 2)]).toString('base64');
export const FAKE_IMG = 'data:image/jpeg;base64,' + Buffer.from('<script>alert(1)</script> not an image').toString('base64');
export const WEBM = 'data:audio/webm;codecs=opus;base64,' + Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(60, 3)]).toString('base64');

export async function startServer(env = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lvc-test-'));
  const instance = createApp({ DATA_DIR: dataDir, DEV_CODES: '1', ADMIN_EMAILS: ADMIN, ...env }, { log: null });
  const port = await instance.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${port}`;
  return {
    base, dataDir, app: instance.app, cleanup: instance.cleanup, checkOrders: instance.checkOrders,
    client: () => new Client(base),
    // Пользователь с заполненной анкетой.
    async user(email, profile = {}) {
      const c = new Client(base);
      await c.login(email);
      const r = await c.put('/api/profile', { name: 'Тест', birth: '1990-05-01', g: 'f', seek: 'a', city: 'Москва', about: '', consent: true, consentPublic: true, ...profile });
      if (r.status !== 200) throw new Error('profile: ' + JSON.stringify(r.body));
      c.id = r.body.user.id;
      return c;
    },
    async close() {
      await instance.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

export class Client {
  constructor(base) { this.base = base; this.cookie = ''; }

  async req(method, url, body, { csrf = true, headers = {} } = {}) {
    const h = { ...headers };
    if (this.cookie) h.cookie = this.cookie;
    if (csrf) h['x-requested-with'] = 'lvc';
    if (body !== undefined && typeof body !== 'string') { h['content-type'] = 'application/json'; body = JSON.stringify(body); }
    const res = await fetch(this.base + url, { method, headers: h, body });
    const set = res.headers.get('set-cookie');
    if (set) {
      const v = /lvc_s=([^;]*)/.exec(set)?.[1];
      this.cookie = v ? `lvc_s=${v}` : '';
    }
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* не JSON */ }
    return { status: res.status, body: json, text, headers: res.headers };
  }

  get(url) { return this.req('GET', url); }
  post(url, body = {}, opts) { return this.req('POST', url, body, opts); }
  put(url, body = {}, opts) { return this.req('PUT', url, body, opts); }
  del(url, opts) { return this.req('DELETE', url, undefined, opts); }

  async login(email, lang = 'ru') {
    const s = await this.post('/api/auth/start', { email, lang });
    if (s.status !== 200) throw new Error('start: ' + JSON.stringify(s.body));
    const v = await this.post('/api/auth/verify', { email, code: s.body.devCode });
    if (v.status !== 200) throw new Error('verify: ' + JSON.stringify(v.body));
    return v.body;
  }
}

// Сделать пользователю VIP или монеты прямо в базе.
export const setVip = (app, id, days = 30) => app.db.run('UPDATE users SET vip_until = ? WHERE id = ?', Date.now() + days * 864e5, id);
export const setCoins = (app, id, coins) => app.db.run('UPDATE users SET coins = ? WHERE id = ?', coins, id);
export const mutualLike = async (a, b) => { await a.post('/api/like', { id: b.id }); return b.post('/api/like', { id: a.id }); };
