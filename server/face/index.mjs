// Проверка «на фото есть лицо человека» прямо на нашем сервере, без внешних сервисов (фото — персональные данные).
// Детектор — каскад деревьев pico (Nenad Markus, MIT, файл facefinder.bin), JPEG декодирует jpeg-js (BSD/Apache 2.0),
// PNG — встроенный zlib. Картинки, рисунки и пейзажи лица не дают; фото человека анфас или вполоборота — дают.
// WebP не декодируем: браузер сайта всегда присылает JPEG, аватарки VK и Яндекса тоже JPEG.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import zlib from 'node:zlib';

const require = createRequire(import.meta.url);
const decodeJpeg = require('./jpeg-decoder.cjs');

/* ---------- каскад pico (порт picojs, MIT) ---------- */
function unpackCascade(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tdepth = dv.getInt32(8, true), ntrees = dv.getInt32(12, true), leaves = 2 ** tdepth;
  const tcodes = new Int8Array(ntrees * 4 * leaves), tpreds = new Float32Array(ntrees * leaves), thresh = new Float32Array(ntrees);
  let p = 16;
  for (let t = 0; t < ntrees; t++) {
    tcodes.set(new Int8Array(bytes.buffer, bytes.byteOffset + p, 4 * leaves - 4), t * 4 * leaves + 4);
    p += 4 * leaves - 4;
    for (let i = 0; i < leaves; i++, p += 4) tpreds[t * leaves + i] = dv.getFloat32(p, true);
    thresh[t] = dv.getFloat32(p, true); p += 4;
  }
  return function classify(r, c, s, pixels, ldim) {
    r *= 256; c *= 256;
    let root = 0, o = 0;
    for (let i = 0; i < ntrees; i++) {
      let idx = 1;
      for (let j = 0; j < tdepth; j++) {
        const k = root + 4 * idx;
        idx = 2 * idx + (pixels[((r + tcodes[k] * s) >> 8) * ldim + ((c + tcodes[k + 1] * s) >> 8)]
          <= pixels[((r + tcodes[k + 2] * s) >> 8) * ldim + ((c + tcodes[k + 3] * s) >> 8)]);
      }
      o += tpreds[leaves * i + idx - leaves];
      if (o <= thresh[i]) return -1;
      root += 4 * leaves;
    }
    return o - thresh[ntrees - 1];
  };
}

let classify;
const cascade = () => classify ??= unpackCascade(fs.readFileSync(new URL('./facefinder.bin', import.meta.url)));

function runCascade(img, params) {
  const { pixels, nrows, ncols } = img, dets = [];
  for (let scale = params.minsize; scale <= params.maxsize; scale *= params.scalefactor) {
    const step = Math.max(params.shiftfactor * scale, 1) >> 0, offset = (scale / 2 + 1) >> 0;
    for (let r = offset; r <= nrows - offset; r += step) {
      for (let c = offset; c <= ncols - offset; c += step) {
        const q = cascade()(r, c, scale, pixels, ncols);
        if (q > 0) dets.push([r, c, scale, q]);
      }
    }
  }
  return dets;
}

// Объединяем пересекающиеся срабатывания; оценка кластера — сумма оценок.
function cluster(dets, iou = 0.2) {
  dets.sort((a, b) => b[3] - a[3]);
  const over = (a, b) => {
    const r = Math.max(0, Math.min(a[0] + a[2] / 2, b[0] + b[2] / 2) - Math.max(a[0] - a[2] / 2, b[0] - b[2] / 2));
    const c = Math.max(0, Math.min(a[1] + a[2] / 2, b[1] + b[2] / 2) - Math.max(a[1] - a[2] / 2, b[1] - b[2] / 2));
    return r * c / (a[2] * a[2] + b[2] * b[2] - r * c);
  };
  const used = new Uint8Array(dets.length), out = [];
  for (let i = 0; i < dets.length; i++) {
    if (used[i]) continue;
    let r = 0, c = 0, s = 0, q = 0, n = 0;
    for (let j = i; j < dets.length; j++) {
      if (used[j] || over(dets[i], dets[j]) <= iou) continue;
      used[j] = 1; r += dets[j][0]; c += dets[j][1]; s += dets[j][2]; q += dets[j][3]; n++;
    }
    out.push({ r: r / n, c: c / n, s: s / n, q });
  }
  return out;
}

/* ---------- PNG (8 бит, без чересстрочности) ---------- */
function decodePng(buf) {
  let p = 8, w = 0, h = 0, depth = 0, type = 0, interlace = 0;
  const idat = [];
  while (p + 8 <= buf.length) {
    const len = buf.readUInt32BE(p), kind = buf.toString('latin1', p + 4, p + 8), data = buf.subarray(p + 8, p + 8 + len);
    if (kind === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; type = data[9]; interlace = data[12]; }
    else if (kind === 'IDAT') idat.push(data);
    else if (kind === 'IEND') break;
    p += 12 + len;
  }
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[type];
  if (!w || !h || depth !== 8 || !ch || interlace || w * h > 30e6) throw new Error('png_unsupported');
  const raw = zlib.inflateSync(Buffer.concat(idat), { maxOutputLength: (w * ch + 1) * h + 1 });
  const bpr = w * ch, out = Buffer.alloc(bpr * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (bpr + 1)], line = raw.subarray(y * (bpr + 1) + 1, (y + 1) * (bpr + 1));
    for (let x = 0; x < bpr; x++) {
      const a = x >= ch ? out[y * bpr + x - ch] : 0, b = y ? out[(y - 1) * bpr + x] : 0, c = x >= ch && y ? out[(y - 1) * bpr + x - ch] : 0;
      const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
      const pred = f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : f === 4 ? (pa <= pb && pa <= pc ? a : pb <= pc ? b : c) : 0;
      out[y * bpr + x] = (line[x] + pred) & 255;
    }
  }
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const s = i * ch;
    if (ch <= 2) { rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = out[s]; rgba[i * 4 + 3] = ch === 2 ? out[s + 1] : 255; }
    else { rgba[i * 4] = out[s]; rgba[i * 4 + 1] = out[s + 1]; rgba[i * 4 + 2] = out[s + 2]; rgba[i * 4 + 3] = ch === 4 ? out[s + 3] : 255; }
  }
  return { width: w, height: h, data: rgba };
}

function decode(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8) return decodeJpeg(buf, { useTArray: true, maxResolutionInMP: 30, maxMemoryUsageInMB: 256 });
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return decodePng(buf);
  throw new Error('format_unsupported');
}

// Серое изображение, уменьшенное до MAX точек по большей стороне (среднее по блоку), с поворотом на угол deg вокруг центра.
function gray(img, deg, MAX) {
  const k = Math.max(1, Math.max(img.width, img.height) / MAX);
  const w0 = Math.max(1, Math.round(img.width / k)), h0 = Math.max(1, Math.round(img.height / k));
  const small = new Float32Array(w0 * h0);
  for (let y = 0; y < h0; y++) {
    const y1 = Math.floor(y * k), y2 = Math.max(y1 + 1, Math.floor((y + 1) * k));
    for (let x = 0; x < w0; x++) {
      const x1 = Math.floor(x * k), x2 = Math.max(x1 + 1, Math.floor((x + 1) * k));
      let sum = 0, n = 0;
      for (let yy = y1; yy < y2 && yy < img.height; yy++) {
        for (let xx = x1; xx < x2 && xx < img.width; xx++) {
          const i = (yy * img.width + xx) * 4, a = img.data[i + 3] / 255;
          // прозрачное — как белый фон
          sum += (0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2]) * a + 255 * (1 - a); n++;
        }
      }
      small[y * w0 + x] = n ? sum / n : 255;
    }
  }
  const rad = deg * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad);
  const right = Math.abs(deg) === 90;
  const w = right ? h0 : w0, h = right ? w0 : h0, pixels = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - w / 2, dy = y - h / 2;
      const sx = Math.round(cos * dx + sin * dy + w0 / 2), sy = Math.round(-sin * dx + cos * dy + h0 / 2);
      pixels[y * w + x] = sx >= 0 && sy >= 0 && sx < w0 && sy < h0 ? small[sy * w0 + sx] : 128;
    }
  }
  return { pixels, nrows: h, ncols: w };
}

// Два прохода. Первый — лица от 12% кадра на картинке 480 точек: на фото людей оценка обычно 20–200, на пейзажах,
// рисунках, смайликах и логотипах — 0, поэтому порог низкий. Второй — мелкие лица (от 7% на 640 точках),
// там шум выше (большой смайлик даёт до 5), поэтому порог 8. Пороги подобраны на фото из site/lyubov-v-cifrah/media.
export const PASSES = [{ max: 480, min: 0.12, score: 1 }, { max: 640, min: 0.07, score: 8 }];
const ANGLES = [0, -20, 20, 90, -90];

// Лучшие оценки лица по проходам; проверка останавливается, как только лицо найдено.
export function faceScores(buf) {
  const img = decode(buf), out = [];
  for (const pass of PASSES) {
    let best = 0;
    for (const deg of ANGLES) {
      const g = gray(img, deg, pass.max), min = Math.min(g.nrows, g.ncols);
      const dets = cluster(runCascade(g, { shiftfactor: 0.1, scalefactor: 1.1, minsize: Math.max(20, min * pass.min) >> 0, maxsize: min }));
      for (const d of dets) best = Math.max(best, d.q);
      if (best >= pass.score) break;
    }
    out.push(best);
    if (best >= pass.score) break;
  }
  return out;
}

// true — есть лицо; false — нет; null — проверить не удалось (неподдерживаемый формат или битый файл).
export function hasFace(buf) {
  try { return faceScores(buf).some((q, i) => q >= PASSES[i].score); } catch { return null; }
}
