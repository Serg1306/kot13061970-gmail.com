"""Рисует иконки «Любовь в цифрах» для PWA и вкладки браузера.

Запуск из корня репозитория:
    python3 site/lyubov-v-cifrah/tools/make_icons.py
Нужны Pillow и numpy. Результат пишется в site/lyubov-v-cifrah/icons/:
    icon-192.png, icon-512.png        — обычные иконки (скруглённый квадрат, прозрачные углы)
    icon-maskable-512.png             — maskable: фон до краёв, кольца в безопасной зоне (80 %)
    apple-touch-icon.png (180×180)    — для iOS: квадрат без прозрачности, iOS скругляет сам
    favicon-32.png                    — для вкладки браузера, кольца толще

Рисунок — два переплетённых кольца, как логотип на сайте: розовое (вы) и морское (партнёр)
на мягком розово-голубом градиенте. Всё рисуется в 4 раза крупнее и уменьшается — так края гладкие.
Функции background() и draw_rings() используются и в make_og_image.py.
"""
import math
import os

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "icons")
SS = 4  # сглаживание: рисуем в SS раз крупнее

# палитра сайта (index.html, :root)
ROSE = "#d93a63"
SEA = "#24857d"
BG_PINK = "#ffd3e3"
BG_MID = "#f1e1f6"
BG_BLUE = "#cde5ff"
PLUM = "#7a4fd1"


def hexrgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def background(w, h):
    """Диагональный градиент: розовый сверху слева → сиреневый → голубой снизу справа,
    плюс два мягких радиальных пятна, как фон body::before на сайте."""
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float64)
    t = (xx / max(w - 1, 1) + yy / max(h - 1, 1)) / 2  # 0..1 по диагонали
    stops = [(0.0, hexrgb(BG_PINK)), (0.5, hexrgb(BG_MID)), (1.0, hexrgb(BG_BLUE))]
    out = np.zeros((h, w, 3))
    for c in range(3):
        out[:, :, c] = np.interp(t, [s[0] for s in stops], [s[1][c] for s in stops])
    d = max(w, h)
    for (px, py, col, rad) in ((0.08, 0.06, BG_PINK, 0.55), (0.95, 0.95, BG_BLUE, 0.55)):
        dist = np.sqrt((xx - px * w) ** 2 + (yy - py * h) ** 2) / (rad * d)
        a = np.clip(1 - dist, 0, 1)[:, :, None] ** 1.5 * 0.6
        out = out * (1 - a) + np.array(hexrgb(col))[None, None, :] * a
    return Image.fromarray(out.clip(0, 255).astype(np.uint8), "RGB")


def ring_mask(size, cx, cy, r, width):
    """Маска кольца (L), центр/радиус/толщина — в пикселях."""
    m = Image.new("L", size, 0)
    ImageDraw.Draw(m).ellipse((cx - r - width / 2, cy - r - width / 2, cx + r + width / 2, cy + r + width / 2), fill=255)
    inner = r - width / 2
    if inner > 0:
        ImageDraw.Draw(m).ellipse((cx - inner, cy - inner, cx + inner, cy + inner), fill=0)
    return m


def disc_mask(size, cx, cy, r):
    m = Image.new("L", size, 0)
    ImageDraw.Draw(m).ellipse((cx - r, cy - r, cx + r, cy + r), fill=255)
    return m


def draw_rings(img, cx, cy, u, stroke=2.5, shadow=True):
    """Рисует логотип на img (RGB) с центром (cx, cy). Единица u — «пиксель» из viewBox 32×32 логотипа:
    кольца радиусом 9u с центрами в ±4u, как в SVG на сайте. Кольца переплетены:
    сверху морское лежит на розовом, снизу — розовое на морском, с тонким просветом фона."""
    size = img.size
    r = 9 * u
    w = stroke * u
    c_rose = (cx - 4 * u, cy)
    c_sea = (cx + 4 * u, cy)
    m_rose = ring_mask(size, *c_rose, r, w)
    m_sea = ring_mask(size, *c_sea, r, w)
    base = img.copy()

    if shadow:  # мягкая тень под кольцами
        sh = ImageChops.lighter(m_rose, m_sea).filter(ImageFilter.GaussianBlur(1.6 * u))
        sh = sh.point(lambda v: int(v * 0.22))
        sh = ImageChops.offset(sh, 0, int(round(0.8 * u)))
        img.paste(Image.new("RGB", size, hexrgb(PLUM)), (0, 0), sh)
        base = img.copy()

    img.paste(Image.new("RGB", size, hexrgb(SEA)), (0, 0), m_sea)
    img.paste(Image.new("RGB", size, hexrgb(ROSE)), (0, 0), m_rose)

    # точки пересечения: x = cx, y = cy ± sqrt(r² − (4u)²)
    dy = math.sqrt(r * r - (4 * u) ** 2)
    gap = 0.55 * u
    for (py, top_c, top_mask, top_col) in ((cy - dy, c_sea, m_sea, SEA), (cy + dy, c_rose, m_rose, ROSE)):
        local = disc_mask(size, cx, py, w * 1.9)
        halo = ImageChops.multiply(ring_mask(size, *top_c, r, w + 2 * gap), local)
        img.paste(base, (0, 0), halo)  # просвет: возвращаем фон вокруг верхнего кольца
        # нижнее кольцо снова под просветом не рисуем; верхнее кольцо — поверх
        img.paste(Image.new("RGB", size, hexrgb(top_col)), (0, 0), ImageChops.multiply(top_mask, local))
        # остальная часть нижнего кольца вне просвета остаётся как была
    return img


def rounded_mask(n, radius):
    m = Image.new("L", (n, n), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, n - 1, n - 1), radius=radius, fill=255)
    return m


def render(px, kind):
    """kind: any | maskable | apple | favicon"""
    n = px * SS
    img = background(n, n)
    if kind == "maskable":
        u = 0.0205 * n          # группа колец целиком внутри круга безопасной зоны (радиус 0.4·n)
        stroke = 2.5
    elif kind == "favicon":
        u = 0.0305 * n          # почти во всю ширину, кольца толще, чтобы читались в 32 px
        stroke = 3.3
    else:
        u = 0.0235 * n
        stroke = 2.5
    draw_rings(img, n / 2, n / 2, u, stroke=stroke, shadow=kind != "favicon")
    img = img.resize((px, px), Image.LANCZOS)
    if kind in ("any", "favicon"):
        out = img.convert("RGBA")
        radius = 0.22 * px if kind == "any" else 0.25 * px
        big = rounded_mask(n, radius * SS).resize((px, px), Image.LANCZOS)
        out.putalpha(big)
        return out
    return img


def main():
    os.makedirs(OUT, exist_ok=True)
    jobs = [
        ("icon-192.png", 192, "any"),
        ("icon-512.png", 512, "any"),
        ("icon-maskable-512.png", 512, "maskable"),
        ("apple-touch-icon.png", 180, "apple"),
        ("favicon-32.png", 32, "favicon"),
    ]
    for name, px, kind in jobs:
        path = os.path.join(OUT, name)
        render(px, kind).save(path, optimize=True)
        print(f"{path}  {px}×{px}  {os.path.getsize(path)} байт")


if __name__ == "__main__":
    main()
