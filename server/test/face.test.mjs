import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { hasFace } from '../face/index.mjs';
import { scanFaces } from '../photos.mjs';
import { ADMIN, JPEG, startServer } from './helpers.mjs';

const MEDIA = new URL('../../site/lyubov-v-cifrah/media/', import.meta.url);
const file = name => fs.readFileSync(new URL(name, MEDIA));
const dataUrl = name => 'data:image/jpeg;base64,' + file(name).toString('base64');

let srv, admin;
before(async () => {
  srv = await startServer({ FACE_CHECK: '1' });
  admin = srv.client();
  await admin.login(ADMIN);
});
after(() => srv.close());

test('детектор: лица людей находит, пейзажи и предметы — нет', () => {
  for (const f of ['avatar-f-1.jpg', 'avatar-f-11.jpg', 'avatar-m-2.jpg', 'avatar-m-9.jpg']) assert.equal(hasFace(file(f)), true, f);
  for (const f of ['books-1.jpg', 'sea-1.jpg', 'flowers-2.jpg', 'city-1.jpg']) assert.equal(hasFace(file(f)), false, f);
  assert.equal(hasFace(Buffer.from(JPEG.split(',')[1], 'base64')), null, 'битый файл не проверить');
});

test('загрузка: фото без лица не публикуется, с лицом — сразу видно', async () => {
  const a = await srv.user('face@example.ru');
  const bad = await a.post('/api/photos', { dataUrl: dataUrl('forest-1.jpg') });
  assert.equal(bad.status, 422);
  assert.equal(bad.body.error, 'no_face');
  assert.equal((await a.post('/api/photos', { dataUrl: JPEG })).body.error, 'no_face', 'непроверяемый файл тоже не берём');
  const ok = await a.post('/api/photos', { dataUrl: dataUrl('avatar-m-2.jpg') });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.photos.length, 1);
  assert.equal(srv.app.db.get('SELECT face FROM photos WHERE id = ?', ok.body.photos[0].id).face, 1);
});

test('уже загруженные фото: без лица возвращаются в «Новые фото» с пометкой', async () => {
  const a = await srv.user('old-photos@example.ru');
  const put = (name, checked) => {
    const f = crypto.randomBytes(16).toString('hex') + '.jpg';
    fs.writeFileSync(path.join(srv.app.config.uploadsDir, f), file(name));
    return srv.app.db.run("INSERT INTO photos (user_id, file, status, pos, created_at, checked) VALUES (?, ?, 'approved', 0, ?, ?)", a.id, f, Date.now(), checked).lastInsertRowid;
  };
  const face = put('avatar-f-11.jpg', 1), pic = put('mountains-1.jpg', 1);
  await scanFaces(srv.app, { pause: 0 }).done;
  const row = id => srv.app.db.get('SELECT face, checked FROM photos WHERE id = ?', id);
  assert.deepEqual({ ...row(face) }, { face: 1, checked: 1 });
  assert.deepEqual({ ...row(pic) }, { face: 0, checked: null });
  const q = (await admin.get('/api/admin/queue')).body.photos;
  assert.equal(q[0].id, Number(pic));
  assert.equal(q[0].noFace, true);
  assert.ok(!q.some(p => p.id === Number(face)));
});
