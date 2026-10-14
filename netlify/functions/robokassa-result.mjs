// ResultURL для Робокассы: сюда приходит уведомление об успешной оплате.
// Подпись проверяется паролем #2; в ответ Робокасса ждёт строку OK<номер счёта>.
import { checkPaid, isConfigured, readParams, settings } from '../lib/robokassa.mjs';

export default async (req) => {
  const s = settings();
  if (!isConfigured(s)) return new Response('not configured', { status: 503 });
  const paid = checkPaid(s, await readParams(req), s.pass2);
  if (!paid) return new Response('bad sign', { status: 400 });
  // Здесь в боевой версии заказ отмечается оплаченным в базе данных.
  console.log(`robokassa: paid invId=${paid.invId} product=${paid.productKey} sum=${paid.product.price}`);
  return new Response(`OK${paid.invId}`, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
};

export const config = { path: '/api/robokassa-result' };
