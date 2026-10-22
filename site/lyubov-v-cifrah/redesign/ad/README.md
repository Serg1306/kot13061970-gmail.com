# Рекламные ролики

`rolik-a.html` — ролик А «Сколько процентов между вами?» (1080×1920, 20 с). Кадр задаёт `seek(t)`, субтитры и время реплик — массив `SUBS` в странице.

Сборка (сайт раздаётся на http://127.0.0.1:8790/ из `site/lyubov-v-cifrah`):

```sh
node render.mjs rolik-a video.mp4 30                    # кадры → H.264 без звука
python3 voice.py rolik-a.html irina track.wav        # черновая озвучка RHVoice по SUBS (RHVOICE — папка установки RHVoice)
ffmpeg -i video.mp4 -i track.wav -c:v copy -c:a aac -b:a 192k -movflags +faststart rolik-a.mp4
```

Чистовой голос (свой, диктор, SpeechKit) подставляется вместо `track.wav`: реплики должны начинаться во время, указанное в `SUBS`.

Проверка разборчивости озвучки — локальный Whisper (small, q8) без сети: `npm i @huggingface/transformers sts-whisper-small` рядом со скриптом, затем `node transcribe.mjs rolik-a.mp4`. Голос RHVoice «irina» распознаётся без ошибок, «victoria» путает «по дате рождения».

Новые ролики удобнее собирать в Remotion: проект в папке `video/` в корне репозитория (`npm i`, `npx remotion studio`; в облачной среде `REMOTION_BROWSER=/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell npx remotion render`). Remotion бесплатен для команд до 3 человек.
