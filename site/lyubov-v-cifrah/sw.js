/* Service worker «Любовь в цифрах».
   - Страницы (навигация, *.html): сначала сеть, без сети — копия из кэша, иначе главная из кэша.
   - Статика сайта (media/, icons/, goroda/*.js, css, картинки, manifest): сначала кэш.
   - Шрифты Google: отдаём из кэша и обновляем в фоне (stale-while-revalidate).
   - /api/, /uploads/, admin.html и любые запросы кроме GET — только сеть, никогда не кэшируются
     (личные данные и фото удалённых анкет не должны оседать в кэше).
   - Push: полезная нагрузка JSON { title, body, url } → уведомление; клик открывает или фокусирует вкладку.
   Чтобы обновить кэш у всех, увеличьте VERSION. */
const VERSION = 'v1';
const STATIC = `lvc-static-${VERSION}`;
const PAGES = `lvc-pages-${VERSION}`;
const FONTS = `lvc-fonts-${VERSION}`;
const KEEP = [STATIC, PAGES, FONTS];

const SCOPE = new URL(self.registration ? self.registration.scope : './', self.location).pathname; // например "/" или "/lyubov-v-cifrah/"
const PRECACHE_PAGES = ['./', 'index.html', 'oferta.html', 'privacy.html', 'terms.html', 'consent.html'];
const PRECACHE_STATIC = ['manifest.webmanifest', 'fonts/fonts.css', 'legal.css', 'legal.js', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/favicon-32.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    // по одному файлу: если какого-то нет, установка всё равно проходит
    const pages = await caches.open(PAGES);
    await Promise.allSettled(PRECACHE_PAGES.map(u => pages.add(new Request(u, { cache: 'reload' }))));
    const stat = await caches.open(STATIC);
    await Promise.allSettled(PRECACHE_STATIC.map(u => stat.add(new Request(u, { cache: 'reload' }))));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(n => n.startsWith('lvc-') && !KEEP.includes(n)).map(n => caches.delete(n)));
    if (self.registration.navigationPreload) { try { await self.registration.navigationPreload.enable(); } catch (e) {} }
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING' || (event.data && event.data.type === 'SKIP_WAITING')) self.skipWaiting();
});

function isPrivate(url) {
  const rel = url.pathname.startsWith(SCOPE) ? url.pathname.slice(SCOPE.length) : url.pathname.replace(/^\//, '');
  return url.pathname.includes('/api/') || url.pathname.includes('/uploads/') || rel.startsWith('api/') || rel.startsWith('uploads/') || rel === 'admin.html';
}

function cacheable(res) {
  return res && (res.ok || res.type === 'opaque') && !res.headers.get('Cache-Control')?.includes('no-store');
}

async function networkFirst(event) {
  const req = event.request;
  const cache = await caches.open(PAGES);
  try {
    const preload = event.preloadResponse ? await event.preloadResponse : null;
    const res = preload || await fetch(req);
    // ключ без ?city=… и прочих параметров, чтобы кэш не разрастался
    if (res.ok && res.type === 'basic') { const u = new URL(req.url); cache.put(u.origin + u.pathname, res.clone()); }
    return res;
  } catch (e) {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    const home = await cache.match('./') || await cache.match('index.html');
    if (home) return home;
    return new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Нет сети</title><p style="font:1.1rem system-ui;padding:2rem">Нет подключения к интернету. Проверьте сеть и обновите страницу.</p>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (cacheable(res)) cache.put(req, res.clone());
  return res;
}

async function staleWhileRevalidate(event) {
  const cache = await caches.open(FONTS);
  const hit = await cache.match(event.request);
  const update = fetch(event.request).then(res => { if (cacheable(res)) cache.put(event.request, res.clone()); return res; }).catch(() => null);
  if (hit) { event.waitUntil(update); return hit; }
  return (await update) || Response.error();
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;                 // POST/PUT/DELETE — всегда сеть, без кэша
  const url = new URL(req.url);

  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(staleWhileRevalidate(event));
    return;
  }
  if (url.origin !== self.location.origin) return; // чужие сайты (Метрика, Робокасса) — без вмешательства
  if (isPrivate(url)) return;                       // /api/, /uploads/, admin.html — только сеть
  if (req.headers.has('range')) return;             // видео с перемоткой — напрямую

  const isPage = req.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname.endsWith('/');
  if (isPage) { event.respondWith(networkFirst(event)); return; }
  if (url.pathname.endsWith('sw.js')) return;
  event.respondWith(cacheFirst(req));
});

/* ---------- push-уведомления ---------- */
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { body: event.data ? event.data.text() : '' }; }
  const title = data.title || 'Любовь в цифрах';
  const options = {
    body: data.body || '',
    icon: 'icons/icon-192.png',
    badge: 'icons/favicon-32.png',
    lang: 'ru',
    tag: data.tag || undefined,
    renotify: !!data.tag,
    data: { url: data.url || './' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || './', self.registration.scope).href;
  event.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // 1) вкладка уже открыта на нужном адресе — фокус; 2) любая вкладка сайта — перейти и фокус; 3) новая вкладка
    for (const c of list) if (c.url === target && 'focus' in c) return c.focus();
    for (const c of list) {
      if (new URL(c.url).origin === self.location.origin && 'focus' in c) {
        try { if ('navigate' in c) await c.navigate(target); } catch (e) {}
        return c.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(target);
  })());
});
