// POST /api/signup {src?, city?, g?} — демо-режим: анкета хранится в браузере, а здесь только отмечается,
// что зарегистрировался ещё один человек. Имени, почты и даты рождения сюда не попадает.
import { getStore } from '@netlify/blobs';
import { json } from '../lib/http.mjs';

const clip = (v, n) => String(v ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, n);

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const body = await req.json().catch(() => ({}));
  const src = body?.src && typeof body.src === 'object'
    ? [body.src.s, body.src.m, body.src.c].map(v => clip(v, 40)).filter(Boolean).join(' / ')
    : '';
  const at = new Date().toISOString();
  await getStore('signups').setJSON(`${at.slice(0, 10)}/${crypto.randomUUID()}`, {
    at, src, city: clip(body?.city, 60), g: body?.g === 'f' ? 'f' : body?.g === 'm' ? 'm' : ''
  });
  return json({ ok: true });
};

export const config = { path: '/api/signup' };
