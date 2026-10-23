// Загруженные файлы: data:URL → проверка сигнатуры → файл со случайным именем.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fail } from './http.mjs';

// Тип определяем по первым байтам файла, а не по тому, что прислал браузер.
const IMAGE = [
  { ext: '.jpg', test: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: '.png', test: b => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: '.webp', test: b => b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP' },
];
const AUDIO = [
  { ext: '.weba', test: b => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3 },
  { ext: '.ogg', test: b => b.toString('latin1', 0, 4) === 'OggS' },
  { ext: '.m4a', test: b => b.toString('latin1', 4, 8) === 'ftyp' },
];

const DATA_URL = /^data:([\w.+-]+\/[\w.+-]+)((?:;[\w.+-]+=[^;,]*)*);base64,([A-Za-z0-9+/=\s]*)$/;

function decode(dataUrl, maxBytes, kinds, badCode) {
  if (typeof dataUrl !== 'string') fail(400, badCode);
  // Грубая проверка размера до декодирования, чтобы не тратить память.
  if (dataUrl.length > Math.ceil(maxBytes / 3) * 4 + 200) fail(413, 'too_large');
  const m = DATA_URL.exec(dataUrl);
  if (!m) fail(400, badCode);
  const buf = Buffer.from(m[3], 'base64');
  if (buf.length < 12) fail(400, badCode);
  if (buf.length > maxBytes) fail(413, 'too_large');
  const kind = kinds.find(k => k.test(buf));
  if (!kind) fail(400, badCode);
  return { buf, ext: kind.ext };
}

export const decodeImage = (dataUrl, maxBytes = 4 * 1024 * 1024) => decode(dataUrl, maxBytes, IMAGE, 'bad_image');
export const decodeAudio = (dataUrl, maxBytes = 2 * 1024 * 1024) => decode(dataUrl, maxBytes, AUDIO, 'bad_audio');

const SAFE_NAME = /^[a-f0-9]{32}\.(jpg|png|webp|weba|ogg|m4a)$/;
export const isSafeName = name => SAFE_NAME.test(name);

export function saveFile(dir, { buf, ext }) {
  const name = crypto.randomBytes(16).toString('hex') + ext;
  fs.writeFileSync(path.join(dir, name), buf, { mode: 0o640 });
  return name;
}

// Удаление по имени файла или по адресу /uploads/<имя>.
export function removeFile(dir, nameOrSrc) {
  const name = String(nameOrSrc || '').replace(/^\/uploads\//, '');
  if (!isSafeName(name)) return;
  try { fs.unlinkSync(path.join(dir, name)); } catch { /* файла уже нет */ }
}
