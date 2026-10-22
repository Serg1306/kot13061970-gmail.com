# Рекламные ролики

`rolik-a.html` — ролик А «Сколько процентов между вами?» (1080×1920, 20 с). Кадр задаёт `seek(t)`, субтитры и время реплик — массив `SUBS` в странице.

Сборка (сайт раздаётся на http://127.0.0.1:8790/ из `site/lyubov-v-cifrah`):

```sh
node render.mjs rolik-a video.mp4 30                    # кадры → H.264 без звука
python3 voice.py rolik-a.html victoria track.wav        # черновая озвучка RHVoice по SUBS (RHVOICE — папка установки RHVoice)
ffmpeg -i video.mp4 -i track.wav -c:v copy -c:a aac -b:a 192k -movflags +faststart rolik-a.mp4
```

Чистовой голос (свой, диктор, SpeechKit) подставляется вместо `track.wav`: реплики должны начинаться во время, указанное в `SUBS`.
