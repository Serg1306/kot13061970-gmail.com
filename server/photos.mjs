// Фото анкет: только реальные люди. Лицо ищем на нашем сервере (server/face), без внешних сервисов.
import fs from 'node:fs';
import path from 'node:path';
import { hasFace } from './face/index.mjs';

// true — лицо есть (или проверка выключена), false — лица нет или файл не проверить.
export const faceOk = (app, buf) => !app.config.faceCheck || hasFace(buf) === true;

// Уже загруженные фото проверяем в фоне по одному, чтобы не задерживать запросы. Фото без лица
// возвращаются в «Новые фото» админки с пометкой «лицо не найдено» (с сайта сами не убираются).
export function scanFaces(app, { pause = 300 } = {}) {
  const { db, config } = app;
  if (!config.faceCheck) return { done: Promise.resolve(), stop() {} };
  let stopped = false, timer;
  const done = new Promise(resolve => {
    const step = () => {
      if (stopped) return resolve();
      const ph = db.get("SELECT id, file FROM photos WHERE face IS NULL AND status = 'approved' ORDER BY id LIMIT 1");
      if (!ph) return resolve();
      let face = 0;
      try { face = hasFace(fs.readFileSync(path.join(config.uploadsDir, ph.file))) ? 1 : 0; } catch { face = 0; }
      db.run(face ? 'UPDATE photos SET face = 1 WHERE id = ?' : 'UPDATE photos SET face = 0, checked = NULL WHERE id = ?', ph.id);
      timer = setTimeout(step, pause); timer.unref?.();
    };
    timer = setTimeout(step, pause); timer.unref?.();
  });
  return { done, stop() { stopped = true; clearTimeout(timer); } };
}
