// Лента канала https://t.me/artparty_pvk для сайта.
// Берёт публичную веб-версию канала t.me/s/<канал> и отдаёт последние посты в JSON.
// Ответ кешируется на CDN Netlify на минуту, так что новые посты появляются на сайте почти сразу.

const CHANNEL = "artparty_pvk";
const LIMIT = 6;

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };
const decode = s => s
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_, e) => ENTITIES[e]);

const toText = html => decode(html.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")).trim();

export function parse(html) {
  const posts = [];
  for (const chunk of html.split('class="tgme_widget_message_wrap').slice(1)) {
    const id = chunk.match(/data-post="([^"]+)"/)?.[1];
    if (!id) continue;
    const text = chunk.match(/<div class="tgme_widget_message_text[^"]*js-message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/)?.[1];
    const img = chunk.match(/class="(?:tgme_widget_message_photo_wrap|tgme_widget_message_video_thumb|link_preview_image)[^"]*"[^>]*background-image:url\('([^']+)'\)/)?.[1];
    const date = chunk.match(/<time datetime="([^"]+)"/)?.[1];
    if (!text && !img) continue;
    posts.push({ url: `https://t.me/${id}`, text: text ? toText(text) : "", img: img || null, date: date || null });
  }
  return posts.reverse().slice(0, LIMIT);
}

export default async () => {
  try {
    const res = await fetch(`https://t.me/s/${CHANNEL}`, { headers: { "User-Agent": "Mozilla/5.0 (ART PARTY site feed)" } });
    if (!res.ok) throw new Error(`t.me ответил ${res.status}`);
    return Response.json({ channel: CHANNEL, posts: parse(await res.text()) }, {
      headers: { "Cache-Control": "public, max-age=60", "Netlify-CDN-Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" },
    });
  } catch (e) {
    return Response.json({ channel: CHANNEL, posts: [], error: String(e.message || e) }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
};
