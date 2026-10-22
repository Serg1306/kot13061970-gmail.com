// node render.mjs rolik-a out.mp4 [fps]: снимает кадры seek(t) и кодирует H.264 без звука
const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright');  // PLAYWRIGHT — путь к модулю, если он не установлен рядом
import { spawn } from 'node:child_process';
const [, , page, out, fpsArg] = process.argv, fps = +fpsArg || 30;
const b = await chromium.launch({ args: ['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1080, height: 1920 } });
await p.goto(`http://127.0.0.1:8790/redesign/ad/${page}.html`, { waitUntil: 'networkidle' });
await p.evaluate(() => window.ready);
const dur = await p.evaluate(() => window.DURATION);
const ff = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
const n = Math.round(dur * fps);
for (let i = 0; i < n; i++) {
  await p.evaluate(t => seek(t), i / fps);
  const buf = await p.screenshot({ type: 'jpeg', quality: 95 });
  if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
  if (i % 60 === 0) process.stdout.write(`${i}/${n} `);
}
ff.stdin.end();
await new Promise(r => ff.on('close', r));
await b.close();
console.log('done', out);
