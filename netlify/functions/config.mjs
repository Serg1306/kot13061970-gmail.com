// На Netlify сервера с базой нет: сайт работает в демо-режиме. Ответ нужен, чтобы запрос не заканчивался ошибкой 404.
export default () => new Response(JSON.stringify({ live: false }), { headers: { 'content-type': 'application/json; charset=utf-8' } });

export const config = { path: '/api/config' };
