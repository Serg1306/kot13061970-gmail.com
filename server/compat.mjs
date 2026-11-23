// Совместимость по датам рождения на сервере: тот же расчёт, что на сайте (site/.../compat.js),
// загружается из файла сайта, чтобы формула была одна.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { SITE_DIR } from './config.mjs';

let LVC = null;
function load() {
  if (LVC) return LVC;
  const box = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(SITE_DIR, 'compat.js'), 'utf8'), box, { filename: 'compat.js' });
  LVC = box.window.LVC;
  return LVC;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Процент совместимости 0–100 или null, если у кого-то нет даты рождения.
export function compatPct(birthA, birthB) {
  if (!DATE_RE.test(birthA || '') || !DATE_RE.test(birthB || '')) return null;
  return load().compat(birthA, birthB).total;
}
