// Страница разбора пары: /para/24-03-1992-i-17-02-1988.
// Это и ссылка «Отправить разбор партнёру», и страницы для поиска под запросы «совместимость по дате рождения».
// Расчёт тот же, что на сайте (compat.js через server/compat.mjs).
import { lvc } from './compat.mjs';

const SLUG_RE = /^(\d{2})-(\d{2})-(\d{4})-i-(\d{2})-(\d{2})-(\d{4})$/;
const SIGN_SLUG = { Овен: 'oven', Телец: 'telec', Близнецы: 'bliznecy', Рак: 'rak', Лев: 'lev', Дева: 'deva', Весы: 'vesy', Скорпион: 'skorpion', Стрелец: 'strelec', Козерог: 'kozerog', Водолей: 'vodoley', Рыбы: 'ryby' };
const SIGN_ORDER = Object.keys(SIGN_SLUG);

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// «24-03-1992» → «1992-03-24», если такая дата существует и не из будущего.
function isoOf(d, m, y) {
  const iso = `${y}-${m}-${d}`;
  const t = new Date(iso + 'T00:00:00Z');
  if (Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== iso) return null;
  if (+y < 1920 || t.getTime() > Date.now()) return null;
  return iso;
}
const dots = iso => iso.split('-').reverse().join('.');
export const pairSlug = (a, b) => `${a.split('-').reverse().join('-')}-i-${b.split('-').reverse().join('-')}`;

// Пара дат из адреса или null.
export function parsePairSlug(slug) {
  const m = SLUG_RE.exec(slug || '');
  if (!m) return null;
  const a = isoOf(m[1], m[2], m[3]), b = isoOf(m[4], m[5], m[6]);
  return a && b ? { a, b } : null;
}

function signPage(za, zb) {
  const [x, y] = [za.name, zb.name].sort((p, q) => SIGN_ORDER.indexOf(p) - SIGN_ORDER.indexOf(q));
  return `/sovmestimost-znakov/${SIGN_SLUG[x]}-${SIGN_SLUG[y]}.html`;
}

export function pairPage({ a, b }, publicUrl = '') {
  const L = lvc();
  const r = L.compat(a, b), pa = L.parse(a), pb = L.parse(b);
  const fa = { life: L.lifePath(pa), z: L.zodiac(pa), e: L.eastern(pa) }, fb = { life: L.lifePath(pb), z: L.zodiac(pb), e: L.eastern(pb) };
  const base = String(publicUrl || '').replace(/\/$/, '');
  const url = `${base}/para/${pairSlug(a, b)}`;
  const title = `Совместимость ${dots(a)} и ${dots(b)}: ${r.total}% — разбор пары по дате рождения`;
  const desc = `Совместимость по датам рождения ${dots(a)} и ${dots(b)} — ${r.total}%. ${fa.z.name} и ${fb.z.name}, числа судьбы ${fa.life} и ${fb.life}, аркан пары ${r.pairArcanum} «${r.arc[0]}». Разбор по четырём системам.`;
  const who = { num: `${fa.life} и ${fb.life}`, zod: `${fa.z.name} и ${fb.z.name}`, east: `${fa.e.name} и ${fb.e.name}`, arc: `${r.pairArcanum}, ${r.arc[0]}` };
  const lines = r.parts.map(p => `<li style="--c:${p.c}"><div><b>${esc(p.t)}</b> <span class="muted">${esc(who[p.key])}</span><span class="pts">${Math.round(p.v * p.w)} из ${Math.round(p.w * 100)}</span></div><p>${esc(p.key === 'arc' ? r.arc[1] : p.why)}</p></li>`).join('\n');
  const ld = {
    '@context': 'https://schema.org', '@type': 'Article', headline: title.slice(0, 110), description: desc,
    inLanguage: 'ru', url, publisher: { '@type': 'Organization', name: 'Любовь в цифрах', url: base + '/' },
  };
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="theme-color" content="#470a1b">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(url)}">
<meta name="rating" content="adult">
<meta property="og:type" content="article"><meta property="og:site_name" content="Любовь в цифрах"><meta property="og:locale" content="ru_RU">
<meta property="og:title" content="${esc(`Наша совместимость — ${r.total}% 💖`)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${esc(url)}"><meta property="og:image" content="${esc(base)}/og-image.jpg">
<link rel="icon" href="/icons/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/fonts/fonts.css">
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>
<style>:root{--card:#2e0611;--ink:#f6e4e8;--muted:#d4b8c0;--line:#6b2238;--rose:#ff7aa6;--sea:#8eaaff;--sun:#f2b84a;--plum:#c3a2ff;--btn:#d42a64;--f:"Golos Text","Segoe UI",system-ui,sans-serif}
*{box-sizing:border-box}body{margin:0;background:#470a1b;color:var(--ink);font:400 1rem/1.6 var(--f)}a{color:var(--rose)}
.wrap{max-width:720px;margin:0 auto;padding:1.2rem 1rem 3rem}header{display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem}
.logo{font-weight:700;font-size:1.3rem;color:var(--ink);text-decoration:none}.age{border:1.5px solid var(--ink);border-radius:999px;padding:.05rem .55rem;font-weight:700;font-size:.85rem}
h1{font-size:clamp(1.5rem,5vw,2.2rem);line-height:1.15;margin:.3rem 0 .9rem}h2{font-size:1.25rem;margin:1.8rem 0 .5rem}
.card{background:var(--card);border-radius:22px;padding:1.2rem;box-shadow:inset 0 0 0 1px rgb(246 228 232 / .12)}
.top{display:flex;gap:1rem;align-items:center}.pct{font-weight:700;font-size:3.4rem;line-height:1;color:#fff}.pct small{font-size:1.6rem}.muted{color:var(--muted)}
ul.lines{list-style:none;margin:1rem 0 0;padding:0;display:grid;gap:.7rem}ul.lines li{border-left:4px solid var(--c);padding:.1rem 0 .1rem .8rem}
ul.lines li div{display:flex;flex-wrap:wrap;gap:.2rem .6rem;align-items:baseline}.pts{margin-left:auto;font-weight:600}ul.lines p{margin:.2rem 0 0;font-size:.95rem}
.btns{display:grid;gap:.6rem;margin-top:1.2rem}.btn{display:block;text-align:center;border:0;border-radius:999px;padding:.85rem 1.2rem;font:600 1rem/1.2 var(--f);text-decoration:none;cursor:pointer;background:#ffc2d4;color:#3b0a18}
.btn.rose{background:var(--btn);color:#fff}.btn.blue{background:#4f7cff;color:#fff}
form.again{display:grid;grid-template-columns:1fr 1fr;gap:.6rem}form.again label{display:grid;gap:.25rem;font-size:.85rem;color:var(--muted)}
form.again input{height:44px;border:0;border-radius:12px;padding:0 .6rem;font:500 1rem var(--f);color-scheme:light}form.again .btn{grid-column:1/-1}
.toast{position:fixed;left:50%;bottom:1rem;translate:-50% 0;background:#fff;color:#3b0a18;border-radius:14px;padding:.6rem 1rem;opacity:0;transition:opacity .2s;pointer-events:none}.toast.show{opacity:1}
footer{margin-top:2.5rem;color:var(--muted);font-size:.85rem}footer a{color:inherit}</style>
</head>
<body>
<div class="wrap">
<header><a class="logo" href="/">Любовь в цифрах</a><span class="age">18+</span></header>
<h1>Совместимость ${dots(a)} и ${dots(b)}</h1>
<div class="card">
<div class="top"><div class="pct">${r.total}<small>%</small></div><div><b>${esc(L.verdictOf(r.total))}</b><br><span class="muted">${esc(fa.z.glyph)} ${esc(fa.z.name)} + ${esc(fb.z.name)} ${esc(fb.z.glyph)} · аркан пары «${esc(r.arc[0])}»</span></div></div>
<ul class="lines">
${lines}
</ul>
<div class="btns">
<button class="btn rose" type="button" id="send" data-url="${esc(url)}?utm_source=share&amp;utm_medium=pair">Отправить разбор партнёру</button>
<a class="btn" href="/#story=${a},${b}">Скачать картинку для сторис</a>
<a class="btn blue" href="/?utm_source=para&amp;utm_medium=match#join">Кто в вашем городе совпадает на 85%+</a>
</div>
</div>
<h2>Аркан пары: ${r.pairArcanum}, ${esc(r.arc[0])}</h2>
<p>${esc(r.arc[1])} Аркан пары считается из дней рождения: день каждого переводится в аркан от 1 до 22, арканы складываются.</p>
<h2>Как считается процент</h2>
<p>Четыре системы, у каждой свой вес: число судьбы — 30, знак и стихия — 25, восточный год — 25, аркан пары — 20. Итог — сумма баллов. Подробнее о знаках этой пары — <a href="${signPage(fa.z, fb.z)}">совместимость ${esc(fa.z.name)} и ${esc(fb.z.name)}</a>.</p>
<h2>Посчитать другую пару</h2>
<form class="again card" action="/para/" method="get">
<label>Ваша дата рождения<input type="date" name="a" min="1920-01-01" required></label>
<label>Дата партнёра<input type="date" name="b" min="1920-01-01" required></label>
<button class="btn rose" type="submit">Посчитать</button>
</form>
<footer><p>Разбор носит развлекательный характер. Сервис знакомств для лиц старше 18 лет.</p>
<p>ООО «ЦИФРА И РЕШЕНИЕ», ИНН 6684050640 · <a href="/oferta.html">Оферта</a> · <a href="/privacy.html">Политика конфиденциальности</a> · <a href="/recommendations.html">Правила подбора</a></p></footer>
</div>
<div class="toast" id="toast" role="status"></div>
<script>
document.getElementById('send').addEventListener('click', async function () {
  var url = this.dataset.url, text = 'Посмотри наш разбор совместимости по датам рождения', t = document.getElementById('toast');
  if (navigator.share) { try { await navigator.share({ title: 'Любовь в цифрах', text: text, url: url }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  try { await navigator.clipboard.writeText(text + ': ' + url); t.textContent = 'Ссылка скопирована: отправьте её партнёру.'; }
  catch (e) { t.textContent = url; }
  t.classList.add('show'); setTimeout(function () { t.classList.remove('show'); }, 3500);
});
</script>
</body>
</html>
`;
}
