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
