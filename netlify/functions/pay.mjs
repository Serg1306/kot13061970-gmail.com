// POST /api/pay {product, email?} → {url, invId}: ссылка на оплату в Робокассе с подписью.
// GET  /api/pay → {configured, catalog}: витрина и признак, что оплата настроена.
import { CATALOG, isConfigured, json, paymentUrl, settings } from '../lib/robokassa.mjs';

export default async (req) => {
  const s = settings();
  if (req.method === 'GET') return json({ configured: isConfigured(s), test: s.test, catalog: CATALOG });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (!isConfigured(s)) return json({ error: 'not_configured' }, 503);
  const body = await req.json().catch(() => null);
  if (!body || !CATALOG[body.product]) return json({ error: 'unknown_product' }, 400);
  return json(paymentUrl(s, body.product, { email: String(body.email || '') }));
};

export const config = { path: '/api/pay' };
