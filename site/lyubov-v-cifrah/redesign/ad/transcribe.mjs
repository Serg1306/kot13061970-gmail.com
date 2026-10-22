// node transcribe.mjs file.(wav|mp4) [lang] — распознаёт речь локальной моделью Whisper (small, q8), без сети
import { pipeline, env } from '@huggingface/transformers';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
env.allowRemoteModels = false;
env.localModelPath = path.join(here, 'node_modules/sts-whisper-small/models') + '/';
const [, , file, lang = 'russian'] = process.argv;
const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
const audio = new Float32Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 4);
const asr = await pipeline('automatic-speech-recognition', 'Xenova/whisper-small', { dtype: 'q8' });
const out = await asr(audio, { language: lang, task: 'transcribe', chunk_length_s: 30, return_timestamps: true });
for (const c of out.chunks || []) console.log(`[${c.timestamp[0]?.toFixed(1)}–${c.timestamp[1]?.toFixed(1)}] ${c.text.trim()}`);
if (!out.chunks) console.log(out.text);
