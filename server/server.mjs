// Точка входа: node server/server.mjs (или npm start).
// Настройки берутся из переменных окружения и, если есть, из файла .env в корне проекта.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// node:sqlite пока помечен как экспериментальный — прячем только это предупреждение.
process.removeAllListeners('warning');
process.on('warning', w => { if (w.name !== 'ExperimentalWarning') console.warn(w); });

// Простой разбор .env: КЛЮЧ=значение, # — комментарий; уже заданные переменные не перезаписываются.
function loadDotEnv(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return; }
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadDotEnv(path.join(root, '.env'));

const { createApp } = await import('./app.mjs');
const instance = createApp(process.env);
const port = await instance.listen();
const { config } = instance.app;
console.log(`«Любовь в цифрах»: сервер запущен на порту ${port}, данные в ${config.dataDir}`);
if (!config.smtp) console.log('Почта не настроена (SMTP_HOST): коды входа пишутся в этот журнал.');
if (!config.adminEmails.size) console.log('ADMIN_EMAILS не задан: страница admin.html никому не доступна.');

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    console.log('Остановка сервера…');
    await instance.close();
    process.exit(0);
  });
}
