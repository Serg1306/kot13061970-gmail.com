// POST /api/pay-confirm с параметрами, с которыми Робокасса вернула человека на SuccessURL.
// Проверяет подпись паролем #1 и отвечает, что именно оплачено, чтобы сайт начислил VIP или монеты.
import { checkPaid, isConfigured, json, readParams, settings } from '../lib/robokassa.mjs';

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const s = settings();
  if (!isConfigured(s)) return json({ error: 'not_configured' }, 503);
  const paid = checkPaid(s, await readParams(req), s.pass1);
  if (!paid) return json({ error: 'bad_signature' }, 400);
  return json({ ok: true, invId: paid.invId, product: paid.productKey, ...paid.product });
};

export const config = { path: '/api/pay-confirm' };
