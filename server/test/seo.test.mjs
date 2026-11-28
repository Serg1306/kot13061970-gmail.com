import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';
import { startServer } from './helpers.mjs';

let srv;
before(async () => { srv = await startServer({ PUBLIC_URL: 'https://lyubovvcifrah.ru' }); });
after(() => srv.close());

// fetch не даёт подменить Host, поэтому обычный http.request.
const get = (path, host) => new Promise((resolve, reject) => {
  const req = http.request(srv.base + path, { headers: host ? { host } : {} }, res => {
    res.resume(); res.on('end', () => resolve({ status: res.statusCode, headers: { get: k => res.headers[k] } }));
  });
  req.on('error', reject); req.end();
});

test('www ведёт на адрес без www с тем же путём (301)', async () => {
  const r = await get('/goroda/moskva.html?x=1', 'www.lyubovvcifrah.ru');
  assert.equal(r.status, 301);
  assert.equal(r.headers.get('location'), 'https://lyubovvcifrah.ru/goroda/moskva.html?x=1');
});

test('/index.html ведёт на папку (301)', async () => {
  const r = await get('/index.html', 'lyubovvcifrah.ru');
  assert.equal(r.status, 301);
  assert.equal(r.headers.get('location'), '/');
  assert.equal((await get('/goroda/index.html', 'lyubovvcifrah.ru')).headers.get('location'), '/goroda/');
});

test('основной адрес и API не перенаправляются', async () => {
  assert.equal((await get('/', 'lyubovvcifrah.ru')).status, 200);
  assert.equal((await get('/', '127.0.0.1')).status, 200);
  assert.notEqual((await get('/api/config', 'www.lyubovvcifrah.ru')).status, 301);
});

test('адрес без .html ведёт на страницу с .html (301)', async () => {
  const r = await get('/goroda/chelyabinsk', 'lyubovvcifrah.ru');
  assert.equal(r.status, 301);
  assert.equal(r.headers.get('location'), '/goroda/chelyabinsk.html');
  assert.equal((await get('/goroda/net-takogo', 'lyubovvcifrah.ru')).status, 404);
});

test('разбор пары: свой адрес /para/ДД-ММ-ГГГГ-i-ДД-ММ-ГГГГ', async () => {
  const r = await fetch(srv.base + '/para/24-03-1992-i-17-02-1988');
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /Совместимость 24\.03\.1992 и 17\.02\.1988/);
  assert.match(html, /rel="canonical" href="https:\/\/lyubovvcifrah\.ru\/para\/24-03-1992-i-17-02-1988"/);
  assert.match(html, /Отправить разбор партнёру/);
  assert.match(html, /Аркан пары/);
  // форма без скрипта ведёт на адрес разбора
  const q = await get('/para/?a=1992-03-24&b=1988-02-17', 'lyubovvcifrah.ru');
  assert.equal(q.status, 301);
  assert.equal(q.headers.get('location'), '/para/24-03-1992-i-17-02-1988');
  // несуществующая дата и мусор — 404
  assert.equal((await fetch(srv.base + '/para/31-02-1992-i-17-02-1988')).status, 404);
  assert.equal((await fetch(srv.base + '/para/abc')).status, 404);
  assert.equal((await get('/para/?a=x&b=y', 'lyubovvcifrah.ru')).status, 302);
});

test('страницы совместимости чисел судьбы: 81 пара, индекс, sitemap и ссылка с /para/', async () => {
  const hub = await fetch(srv.base + '/sovmestimost-chisel/');
  assert.equal(hub.status, 200);
  const h = await hub.text();
  assert.equal((h.match(/href="\/sovmestimost-chisel\/muzhchina-\d-zhenshchina-\d\.html"/g) || []).length >= 81, true);
  const r = await fetch(srv.base + '/sovmestimost-chisel/muzhchina-2-zhenshchina-8.html');
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /<h1>Совместимость чисел судьбы 2 и 8: мужчина 2 и женщина 8<\/h1>/);
  assert.match(html, /rel="canonical" href="https:\/\/lyubovvcifrah\.ru\/sovmestimost-chisel\/muzhchina-2-zhenshchina-8\.html"/);
  assert.match(html, />94<small>%/); // 2 и 8 — одна семья чисел, как в compat.js
  const sm = await (await fetch(srv.base + '/sitemap-sovmestimost.xml')).text();
  assert.equal((sm.match(/sovmestimost-chisel\/muzhchina-/g) || []).length, 81);
  // 24.03.1992 — число судьбы 3, 17.02.1988 — 9
  const para = await (await fetch(srv.base + '/para/24-03-1992-i-17-02-1988')).text();
  assert.match(para, /href="\/sovmestimost-chisel\/muzhchina-3-zhenshchina-9\.html"/);
});
