"""Рисует демо-фото и демо-видео для анкет «Любовь в цифрах».

Запуск из корня репозитория:
    python3 site/lyubov-v-cifrah/tools/make_demo_media.py
Нужны Pillow, numpy и ffmpeg (libx264). Результат пишется в site/lyubov-v-cifrah/media/.
Это иллюстрации-заглушки: в боевой версии анкеты показывают фото и видео, загруженные людьми.
"""
import math
import os
import random
import subprocess

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT = os.path.join(os.path.dirname(__file__), "..", "media")
W, H, SS = 600, 800, 2  # размер кадра и коэффициент сглаживания


def hexrgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def vgrad(w, h, stops):
    """Вертикальный градиент по списку (позиция 0..1, цвет)."""
    y = np.linspace(0, 1, h)[:, None]
    out = np.zeros((h, w, 3))
    for c in range(3):
        xs = [s[0] for s in stops]
        ys = [hexrgb(s[1])[c] for s in stops]
        out[:, :, c] = np.interp(y, xs, ys)
    return Image.fromarray(out.astype(np.uint8))


def canvas(stops):
    return vgrad(W * SS, H * SS, stops)


def finish(img, name, blur=0):
    img = img.resize((W, H), Image.LANCZOS)
    if blur:
        img = img.filter(ImageFilter.GaussianBlur(blur))
    img.save(os.path.join(OUT, name), quality=80, optimize=True, progressive=True)


S = lambda v: int(v * SS)  # noqa: E731


# ---------- портреты-силуэты (главное фото анкеты) ----------
PORTRAITS = [
    ("#f6c8b6", "#d93a63", "#3b1f3f"), ("#bfe3dd", "#24857d", "#173634"),
    ("#ffe1a8", "#e8a21f", "#4a2c0b"), ("#d9ccf5", "#7a4fd1", "#2a1a4d"),
    ("#ffd0d8", "#c2456b", "#3a1424"), ("#cfe0f7", "#3d6fb6", "#13284a"),
]


def portrait(i, gender):
    bg, mid, ink = PORTRAITS[i]
    img = canvas([(0, bg), (1, mid)])
    d = ImageDraw.Draw(img)
    cx = W * SS // 2
    # мягкое пятно света за головой
    d.ellipse([cx - S(230), S(120), cx + S(230), S(580)], fill=bg)
    if gender == "f":  # длинные волосы
        d.rounded_rectangle([cx - S(150), S(200), cx + S(150), S(620)], radius=S(140), fill=ink)
    d.ellipse([cx - S(250), S(560), cx + S(250), S(1100)], fill=ink)  # плечи
    d.rectangle([cx - S(48), S(440), cx + S(48), S(600)], fill=ink)  # шея
    d.ellipse([cx - S(110), S(220), cx + S(110), S(480)], fill=ink)  # голова
    if gender == "m":
        d.chord([cx - S(118), S(205), cx + S(118), S(400)], 180, 360, fill=ink)
    finish(img, f"portrait-{gender}-{i + 1}.jpg")


# ---------- сюжетные фото ----------
def sea(name, sky, water, sun):
    img = canvas([(0, sky[0]), (.55, sky[1]), (.551, water[0]), (1, water[1])])
    d = ImageDraw.Draw(img)
    hz = S(440)
    d.ellipse([S(300) - S(90), hz - S(150), S(300) + S(90), hz + S(30)], fill=sun)
    d.rectangle([0, hz, W * SS, H * SS], fill=None)
    img.paste(vgrad(W * SS, H * SS - hz, [(0, water[0]), (1, water[1])]), (0, hz))
    d = ImageDraw.Draw(img)
    rnd = random.Random(name)
    for k in range(26):
        y = hz + S(12) + k * S(14)
        w = S(30 + k * 7)
        d.rounded_rectangle([S(300) - w, y, S(300) + w, y + S(4)], radius=S(2), fill=sun)
    for _ in range(40):
        x, y = rnd.randint(0, W * SS), rnd.randint(hz + S(20), H * SS)
        d.line([x, y, x + S(rnd.randint(20, 60)), y], fill=water[0], width=S(2))
    finish(img, name)


def mountains(name, sky, layers, sun):
    img = canvas([(0, sky[0]), (1, sky[1])])
    d = ImageDraw.Draw(img)
    d.ellipse([S(380), S(140), S(500), S(260)], fill=sun)
    rnd = random.Random(name)
    for li, col in enumerate(layers):
        base = S(420 + li * 110)
        pts = [(0, H * SS)]
        x = -S(40)
        while x < W * SS + S(80):
            pts.append((x, base - S(rnd.randint(60, 200))))
            x += S(rnd.randint(90, 170))
            pts.append((x, base - S(rnd.randint(0, 40))))
            x += S(rnd.randint(60, 120))
        pts.append((W * SS, H * SS))
        d.polygon(pts, fill=col)
    finish(img, name)


def city(name, sky, bld, win):
    img = canvas([(0, sky[0]), (1, sky[1])])
    d = ImageDraw.Draw(img)
    rnd = random.Random(name)
    d.ellipse([S(440), S(90), S(510), S(160)], fill="#f4ecd8")
    x = 0
    while x < W * SS:
        bw, bh = S(rnd.randint(70, 140)), S(rnd.randint(260, 600))
        d.rectangle([x, H * SS - bh, x + bw, H * SS], fill=bld)
        for wy in range(H * SS - bh + S(20), H * SS - S(10), S(28)):
            for wx in range(x + S(12), x + bw - S(14), S(22)):
                if rnd.random() < .45:
                    d.rectangle([wx, wy, wx + S(10), wy + S(14)], fill=win)
        x += bw + S(rnd.randint(4, 14))
    finish(img, name)


def forest(name, sky, trees, ground):
    img = canvas([(0, sky[0]), (1, sky[1])])
    d = ImageDraw.Draw(img)
    rnd = random.Random(name)
    d.rectangle([0, S(640), W * SS, H * SS], fill=ground)
    for row, col in enumerate(trees):
        for _ in range(9):
            x = rnd.randint(-S(40), W * SS + S(40))
            h = S(rnd.randint(220, 380) - row * 40)
            b = S(560 + row * 70)
            for t in range(3):
                w = S(60 + t * 25)
                top = b - h + t * h // 4
                d.polygon([(x, top), (x - w, top + h // 2), (x + w, top + h // 2)], fill=col)
    finish(img, name)


def cafe(name, table, cup, saucer, accent):
    img = canvas([(0, table[0]), (1, table[1])])
    d = ImageDraw.Draw(img)
    for k in range(0, H * SS, S(60)):
        d.line([0, k, W * SS, k + S(20)], fill=table[0], width=S(3))
    cx, cy = S(300), S(380)
    d.ellipse([cx - S(190), cy - S(190), cx + S(190), cy + S(190)], fill=saucer)
    d.ellipse([cx - S(130), cy - S(130), cx + S(130), cy + S(130)], fill=cup)
    d.ellipse([cx - S(105), cy - S(105), cx + S(105), cy + S(105)], fill="#5a3420")
    d.ellipse([cx - S(40), cy - S(30), cx + S(40), cy + S(30)], fill="#e9d2b4")
    d.rounded_rectangle([cx + S(125), cy - S(25), cx + S(200), cy + S(25)], radius=S(25), fill=cup)
    d.rounded_rectangle([S(70), S(620), S(330), S(760)], radius=S(16), fill=accent)
    d.rounded_rectangle([S(90), S(645), S(310), S(655)], radius=S(4), fill=table[0])
    d.rounded_rectangle([S(90), S(675), S(260), S(685)], radius=S(4), fill=table[0])
    finish(img, name)


def balloons(name, sky, cols):
    img = canvas([(0, sky[0]), (1, sky[1])])
    d = ImageDraw.Draw(img)
    rnd = random.Random(name)
    for _ in range(8):
        x, y = rnd.randint(S(60), S(540)), rnd.randint(S(120), S(700))
        d.ellipse([x - S(120), y - S(26), x + S(120), y + S(26)], fill="#ffffff")
    for k, col in enumerate(cols):
        x, y, r = S(150 + k * 160), S(260 + (k % 2) * 160), S(70 - k * 8)
        d.ellipse([x - r, y - r, x + r, y + int(r * 1.15)], fill=col)
        d.line([x - r // 2, y + r, x - r // 5, y + int(r * 1.9)], fill="#4a3a30", width=S(2))
        d.line([x + r // 2, y + r, x + r // 5, y + int(r * 1.9)], fill="#4a3a30", width=S(2))
        d.rectangle([x - r // 4, y + int(r * 1.9), x + r // 4, y + int(r * 2.2)], fill="#8a5a33")
    finish(img, name)


def flowers(name, sky, field, petals):
    img = canvas([(0, sky[0]), (.5, sky[1]), (.501, field[0]), (1, field[1])])
    d = ImageDraw.Draw(img)
    rnd = random.Random(name)
    for _ in range(260):
        y = rnd.randint(S(420), H * SS)
        k = (y - S(400)) / (H * SS)
        x = rnd.randint(0, W * SS)
        r = S(4 + 26 * k)
        d.ellipse([x - r, y - r, x + r, y + r], fill=rnd.choice(petals))
        d.ellipse([x - r // 3, y - r // 3, x + r // 3, y + r // 3], fill="#f2c94c")
    finish(img, name)


def books(name, wall, cols):
    img = canvas([(0, wall[0]), (1, wall[1])])
    d = ImageDraw.Draw(img)
    rnd = random.Random(name)
    for shelf in (S(330), S(600)):
        x = S(40)
        while x < S(540):
            bw, bh = S(rnd.randint(26, 52)), S(rnd.randint(150, 230))
            d.rounded_rectangle([x, shelf - bh, x + bw, shelf], radius=S(4), fill=rnd.choice(cols))
            x += bw + S(4)
        d.rectangle([S(20), shelf, S(580), shelf + S(18)], fill="#5b3a26")
    d.ellipse([S(400), S(650), S(560), S(790)], fill=cols[0])
    d.rectangle([S(470), S(610), S(490), S(660)], fill="#3d6b3a")
    d.ellipse([S(420), S(560), S(540), S(640)], fill="#4f8a4a")
    finish(img, name)


# ---------- видео ----------
VW, VH, FPS, SEC = 360, 480, 24, 4


def encode(name, frames):
    path = os.path.join(OUT, name)
    p = subprocess.Popen([
        "ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
        "-s", f"{VW}x{VH}", "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-preset", "slow",
        "-crf", "30", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", path,
    ], stdin=subprocess.PIPE)
    first = None
    for f in frames:
        if first is None:
            first = f
        p.stdin.write(f.tobytes())
    p.stdin.close()
    p.wait()
    first.save(path.replace(".mp4", ".jpg"), quality=78)
    # копия в WebM (VP9) для браузеров без H.264
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", path, "-c:v", "libvpx-vp9",
                    "-crf", "40", "-b:v", "0", "-an", path.replace(".mp4", ".webm")], check=True)


def v_sea():
    sky = vgrad(VW, VH, [(0, "#ffb38a"), (.55, "#ff7a8a"), (.551, "#4b5aa8"), (1, "#1d2557")])
    for t in range(FPS * SEC):
        img = sky.copy()
        d = ImageDraw.Draw(img)
        hz = 264
        d.ellipse([140, hz - 90 + t // 6, 220, hz - 10 + t // 6], fill="#ffe2a8")
        d.rectangle([0, hz, VW, VH], fill=None)
        img.paste(vgrad(VW, VH - hz, [(0, "#4b5aa8"), (1, "#1d2557")]), (0, hz))
        d = ImageDraw.Draw(img)
        for k in range(22):
            y = hz + 6 + k * 10
            w = 14 + k * 5 + int(6 * math.sin(t / 4 + k))
            d.rounded_rectangle([180 - w, y, 180 + w, y + 2], radius=1, fill="#ffd59a")
        yield img


def v_snow():
    base = vgrad(VW, VH, [(0, "#1b1f45"), (1, "#3e3a72")])
    rnd = random.Random(7)
    d = ImageDraw.Draw(base)
    x = 0
    while x < VW:
        bw, bh = rnd.randint(40, 80), rnd.randint(140, 320)
        d.rectangle([x, VH - bh, x + bw, VH], fill="#14122b")
        for wy in range(VH - bh + 12, VH - 8, 16):
            for wx in range(x + 6, x + bw - 8, 13):
                if rnd.random() < .4:
                    d.rectangle([wx, wy, wx + 5, wy + 8], fill="#f2c45a")
        x += bw + rnd.randint(2, 8)
    flakes = [(rnd.uniform(0, VW), rnd.uniform(0, VH), rnd.uniform(.8, 2.6)) for _ in range(140)]
    for t in range(FPS * SEC):
        img = base.copy()
        d = ImageDraw.Draw(img)
        for fx, fy, r in flakes:
            y = (fy + t * r * 1.6) % VH
            x = fx + 6 * math.sin((t + fy) / 12)
            d.ellipse([x - r, y - r, x + r, y + r], fill="#ffffff")
        yield img


def v_balloon():
    sky = vgrad(VW, VH, [(0, "#8fd3f4"), (1, "#e9f7ff")])
    rnd = random.Random(3)
    clouds = [(rnd.uniform(0, VW), rnd.uniform(40, VH - 40), rnd.uniform(.4, 1.2)) for _ in range(9)]
    for t in range(FPS * SEC):
        img = sky.copy()
        d = ImageDraw.Draw(img)
        for cx, cy, sp in clouds:
            x = (cx - t * sp * 2) % (VW + 200) - 100
            d.ellipse([x - 70, cy - 16, x + 70, cy + 16], fill="#ffffff")
        y = 230 + 14 * math.sin(t / 14)
        d.ellipse([130, y - 80, 230, y + 30], fill="#d93a63")
        d.line([150, y + 22, 170, y + 85], fill="#4a3a30", width=2)
        d.line([210, y + 22, 190, y + 85], fill="#4a3a30", width=2)
        d.rectangle([166, y + 85, 194, y + 105], fill="#8a5a33")
        yield img


def v_fire():
    bg = vgrad(VW, VH, [(0, "#120d1f"), (1, "#2a1626")])
    rnd = random.Random(11)
    stars = [(rnd.randint(0, VW), rnd.randint(0, 240)) for _ in range(60)]
    for t in range(FPS * SEC):
        img = bg.copy()
        d = ImageDraw.Draw(img)
        for sx, sy in stars:
            if (sx + sy + t) % 9:
                d.point((sx, sy), fill="#d8d2f0")
        d.ellipse([60, 380, 300, 470], fill="#3a2230")
        for k, col in enumerate(["#e8a21f", "#f2603a", "#ffd36b"]):
            h = 130 - k * 35 + 18 * math.sin(t / 3 + k * 2)
            w = 60 - k * 15 + 6 * math.sin(t / 2 + k)
            d.polygon([(180 - w, 410), (180 + w, 410), (180 + 6 * math.sin(t / 2 + k), 410 - h)], fill=col)
        d.rounded_rectangle([110, 405, 250, 422], radius=8, fill="#5b3a26")
        yield img


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for i in range(len(PORTRAITS)):
        portrait(i, "f")
        portrait(i, "m")
    sea("sea-1.jpg", ("#ffb38a", "#ff7a8a"), ("#4b5aa8", "#1d2557"), "#ffe2a8")
    sea("sea-2.jpg", ("#a9def9", "#e4f6ff"), ("#2f9fb5", "#0f4f6b"), "#fff6cf")
    mountains("mountains-1.jpg", ("#cfe6ff", "#fbe3d6"), ["#9aa8d6", "#6c76b3", "#3f4783"], "#fff1c9")
    mountains("mountains-2.jpg", ("#2b2150", "#b6597a"), ["#5d3a78", "#3c2659", "#1f1536"], "#ffd27a")
    city("city-1.jpg", ("#1b1f45", "#5e3b75"), "#14122b", "#f2c45a")
    city("city-2.jpg", ("#ffd7b0", "#f08c9b"), "#5b3d63", "#ffe6a8")
    forest("forest-1.jpg", ("#e7f3e3", "#bfe0c7"), ["#7fb08a", "#4f8a63", "#2f5f45"], "#2a4a39")
    forest("forest-2.jpg", ("#fde6c9", "#f7c08a"), ["#c9864e", "#9b5a34", "#5e331d"], "#3f2416")
    cafe("cafe-1.jpg", ("#c99a6e", "#a8754a"), "#ffffff", "#efe6dc", "#d93a63")
    cafe("cafe-2.jpg", ("#7aa9a1", "#4d7f78"), "#f6efe6", "#ffffff", "#e8a21f")
    balloons("balloons-1.jpg", ("#8fd3f4", "#e9f7ff"), ["#d93a63", "#e8a21f", "#7a4fd1"])
    balloons("balloons-2.jpg", ("#ffc4a3", "#ffe9d6"), ["#24857d", "#d93a63", "#3d6fb6"])
    flowers("flowers-1.jpg", ("#cfe6ff", "#f5f3f8"), ("#7fb36a", "#3e7a3a"), ["#d93a63", "#ffffff", "#f08c9b"])
    flowers("flowers-2.jpg", ("#ffe0b8", "#fff4e0"), ("#9ab86a", "#5b7a33"), ["#7a4fd1", "#e8a21f", "#ffffff"])
    books("books-1.jpg", ("#efe4d6", "#d9c7b0"), ["#d93a63", "#24857d", "#e8a21f", "#3d6fb6", "#7a4fd1"])
    books("books-2.jpg", ("#2c2438", "#1d1726"), ["#f08c9b", "#4fb8ae", "#f2b84a", "#a283f0", "#cfe0f7"])
    encode("video-sea.mp4", v_sea())
    encode("video-snow.mp4", v_snow())
    encode("video-balloon.mp4", v_balloon())
    encode("video-fire.mp4", v_fire())
    print("ok")
