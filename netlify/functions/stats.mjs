// GET /api/stats?key=… — страница для владельца: сколько людей зарегистрировалось (данные /api/signup).
// Ключ задаётся переменной окружения STATS_KEY в Netlify; без неё страница закрыта.
import { getStore } from '@netlify/blobs';
import { timingSafeEqual } from 'node:crypto';

const page = (body, status = 200) => new Response(`<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Регистрации — Любовь в цифрах</title><style>
body{margin:0;padding:24px 16px;font:16px/1.5 system-ui,sans-serif;background:#5b0f24;color:#fff4f1}
main{max-width:640px;margin:auto}h1{font-size:22px;margin:0 0 16px}
.big{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:24px}.big div{flex:1 1 140px;background:#ffffff14;padding:16px}
.big b{display:block;font-size:40px;line-height:1.1}table{width:100%;border-collapse:collapse;margin-bottom:24px}
th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #ffffff22}td:last-child,th:last-child{text-align:right}
h2{font-size:17px;margin:0 0 8px}</style></head><body><main>${body}</main></body></html>`,
  { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const same = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const table = (title, rows) => rows.length
  ? `<h2>${title}</h2><table>${rows.map(([k, n]) => `<tr><td>${esc(k)}</td><td>${n}</td></tr>`).join('')}</table>` : '';
const top = (map, n = 15) => [...map].sort((a, b) => b[1] - a[1]).slice(0, n);

export default async (req) => {
  const want = process.env.STATS_KEY || '';
  const key = new URL(req.url).searchParams.get('key') || '';
  if (!want) return page('<h1>Статистика закрыта</h1><p>Задайте переменную STATS_KEY в настройках Netlify.</p>', 403);
  if (!same(key, want)) return page('<h1>Неверный ключ</h1>', 403);

  const store = getStore('signups');
  const { blobs } = await store.list();
  const days = new Map(), srcs = new Map(), cities = new Map();
  let f = 0, m = 0;
  const recent = new Set(Array.from({ length: 7 }, (_, i) => new Date(Date.now() - i * 864e5).toISOString().slice(0, 10)));
  let week = 0;
  for (const { key: k } of blobs) {
    const day = k.slice(0, 10);
    days.set(day, (days.get(day) || 0) + 1);
    if (recent.has(day)) week++;
  }
  // источники, города и пол — по последним 1000 записям, чтобы страница открывалась быстро
  for (const { key: k } of blobs.slice(-1000)) {
    const r = await store.get(k, { type: 'json' }).catch(() => null);
    if (!r) continue;
    const s = r.src || 'без метки'; srcs.set(s, (srcs.get(s) || 0) + 1);
    if (r.city) cities.set(r.city, (cities.get(r.city) || 0) + 1);
    if (r.g === 'f') f++; else if (r.g === 'm') m++;
  }
  const today = days.get(new Date().toISOString().slice(0, 10)) || 0;
  const daysRows = [...days].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 30)
    .map(([d, n]) => [d.split('-').reverse().join('.'), n]);
  return page(`<h1>Регистрации на lyubovvcifrah.ru</h1>
<div class="big"><div><b>${blobs.length}</b>всего</div><div><b>${today}</b>сегодня</div><div><b>${week}</b>за 7 дней</div></div>
<p>Женщин: ${f} · мужчин: ${m}</p>
${table('По дням (последние 30)', daysRows)}${table('Откуда пришли', top(srcs))}${table('Города', top(cities))}
<p style="opacity:.7">Считаются анкеты, созданные с 23.10.2026. Время — UTC.</p>`);
};

export const config = { path: '/api/stats' };
