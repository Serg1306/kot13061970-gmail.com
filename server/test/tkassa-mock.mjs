// Поддельный API Т-Кассы для тестов: проверяет подпись запросов, состояние заказов задаёт тест.
import http from 'node:http';
import { makeToken } from '../tkassa.mjs';

export const TERMINAL = 'TestShopDEMO';
export const PASSWORD = 'tk-secret';

export async function startTkassaMock() {
  const orders = new Map(); // invId → { status, amount }
  const hits = [];
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw || '{}');
    const method = req.url.split('/').pop();
    const tokenOk = body.TerminalKey === TERMINAL && body.Token === makeToken(body, PASSWORD);
    hits.push({ method, body, tokenOk });
    res.writeHead(200, { 'content-type': 'application/json' });
    if (!tokenOk) return res.end(JSON.stringify({ Success: false, ErrorCode: '204', Message: 'Неверный токен' }));
    if (method === 'Init') {
      return res.end(JSON.stringify({
        Success: true, ErrorCode: '0', TerminalKey: TERMINAL, Status: 'NEW', PaymentId: '7' + body.OrderId,
        OrderId: body.OrderId, Amount: body.Amount, PaymentURL: `https://securepay.example/new/${body.OrderId}`,
      }));
    }
    if (method === 'CheckOrder') {
      const o = orders.get(body.OrderId);
      if (!o) return res.end(JSON.stringify({ Success: false, ErrorCode: '7', Message: 'Заказ не найден' }));
      return res.end(JSON.stringify({ Success: true, ErrorCode: '0', OrderId: body.OrderId,
        Payments: [{ PaymentId: '7' + body.OrderId, Amount: o.amount, Status: o.status, Success: true, ErrorCode: '0' }] }));
    }
    res.end(JSON.stringify({ Success: false, ErrorCode: '9999' }));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return {
    orders, hits,
    env: { TKASSA_TERMINAL: TERMINAL, TKASSA_PASSWORD: PASSWORD, TKASSA_API_URL: `http://127.0.0.1:${server.address().port}/v2` },
    close: () => new Promise(r => server.close(r)),
  };
}

// Уведомление об оплате так, как его присылает Т-Касса.
export function notification(invId, amount, status = 'CONFIRMED', password = PASSWORD) {
  const n = { TerminalKey: TERMINAL, OrderId: invId, Success: true, Status: status, PaymentId: 7001, ErrorCode: '0', Amount: amount, CardId: 1, Pan: '430000******0777', ExpDate: '1230' };
  n.Token = makeToken(n, password);
  return n;
}
