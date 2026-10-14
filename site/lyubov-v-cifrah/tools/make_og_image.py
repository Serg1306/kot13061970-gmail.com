"""Рисует картинку для соцсетей (Open Graph) «Любовь в цифрах»: site/lyubov-v-cifrah/og-image.jpg, 1200×630.

Запуск из корня репозитория:
    python3 site/lyubov-v-cifrah/tools/make_og_image.py
Нужны Pillow и numpy (и make_icons.py рядом — оттуда берутся фон и кольца).

Шрифты — те же, что на сайте: Great Vibes (название), Prata (слоган), Golos Text (подпись).
Скрипт один раз скачивает их с Google Fonts в ~/.cache/lvc-fonts/. Если интернета нет,
берутся системные шрифты с засечками (FreeSerif / DejaVu Serif / Liberation Serif), найденные через fc-list.
"""
import os
import re
import subprocess
import sys
import urllib.request

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from make_icons import PLUM, ROSE, SEA, background, draw_rings, hexrgb  # noqa: E402

OUT = os.path.join(HERE, "..", "og-image.jpg")
CACHE = os.path.join(os.path.expanduser("~"), ".cache", "lvc-fonts")
W, H, SS = 1200, 630, 2
INK = "#23163a"
MUTED = "#6d6380"

GOOGLE = {
    "script": "Great+Vibes",
    "serif": "Prata",
    "sans": "Golos+Text:wght@600",
}
FALLBACK = {
    "script": ["FreeSerif:style=Italic", "DejaVu Serif:style=Italic", "Liberation Serif:style=Italic"],
    "serif": ["FreeSerif", "DejaVu Serif", "Liberation Serif"],
    "sans": ["Inter:style=SemiBold", "DejaVu Sans:style=Bold", "Liberation Sans:style=Bold"],
}


def google_font(kind):
    """Скачивает TTF с Google Fonts (старый User-Agent → ссылка на .ttf). Возвращает путь или None."""
    family = GOOGLE[kind]
    path = os.path.join(CACHE, kind + ".ttf")
    if os.path.exists(path) and os.path.getsize(path) > 10000:
        return path
    try:
        req = urllib.request.Request(f"https://fonts.googleapis.com/css2?family={family}", headers={"User-Agent": "Mozilla/4.0"})
        css = urllib.request.urlopen(req, timeout=15).read().decode()
        url = re.search(r"url\((https://[^)]+\.ttf)\)", css).group(1)
        data = urllib.request.urlopen(url, timeout=30).read()
        os.makedirs(CACHE, exist_ok=True)
        with open(path, "wb") as f:
            f.write(data)
        return path
    except Exception as e:  # нет сети — берём системный шрифт
        print(f"Google Fonts недоступен для {family}: {e}")
        return None


def system_font(kind):
    for pattern in FALLBACK[kind]:
        try:
            out = subprocess.run(["fc-match", "-f", "%{file}", pattern], capture_output=True, text=True, timeout=10).stdout.strip()
            if out and os.path.exists(out):
                return out
        except Exception:
            pass
    return None


def font(kind, size):
    path = google_font(kind) or system_font(kind)
    print(f"шрифт {kind}: {path}")
    return ImageFont.truetype(path, size) if path else ImageFont.load_default(size)


def gradient_text(img, xy, text, fnt, colors):
    """Текст с горизонтальным градиентом (как .brand на сайте: розовый → сливовый → морской)."""
    d = ImageDraw.Draw(img)
    x0, y0, x1, y1 = d.textbbox(xy, text, font=fnt)
    w, h = x1 - x0, y1 - y0
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).text(xy, text, font=fnt, fill=255)
    t = np.linspace(0, 1, w)
    stops = [(0.1, hexrgb(colors[0])), (0.55, hexrgb(colors[1])), (0.95, hexrgb(colors[2]))]
    row = np.stack([np.interp(t, [s[0] for s in stops], [s[1][c] for s in stops]) for c in range(3)], axis=1)
    grad = np.zeros((img.size[1], img.size[0], 3), dtype=np.uint8)
    x0c, x1c = max(x0, 0), min(x0 + w, img.size[0])
    grad[:, x0c:x1c] = row[None, x0c - x0:x1c - x0, :].astype(np.uint8)
    img.paste(Image.fromarray(grad, "RGB"), (0, 0), mask)
    return (x0, y0, x1, y1)


def main():
    w, h = W * SS, H * SS
    img = background(w, h)

    # большой логотип слева
    draw_rings(img, 255 * SS, h / 2, 8.6 * SS, stroke=2.5)

    x = 470 * SS
    avail = w - x - 40 * SS
    size = 128
    f_brand = font("script", size * SS)
    while ImageDraw.Draw(img).textlength("Любовь в цифрах", font=f_brand) > avail and size > 40:
        size -= 2
        f_brand = f_brand.font_variant(size=size * SS)
    f_tag = font("serif", 46 * SS)
    f_small = font("sans", 25 * SS)
    d = ImageDraw.Draw(img)

    gradient_text(img, (x, 150 * SS), "Любовь в цифрах", f_brand, (ROSE, PLUM, SEA))
    d.text((x + 6 * SS, 345 * SS), "Знакомства", font=f_tag, fill=hexrgb(INK))
    d.text((x + 6 * SS, 402 * SS), "по дате рождения", font=f_tag, fill=hexrgb(INK))
    d.text((x + 8 * SS, 500 * SS), "Число судьбы · Зодиак · Восточный год · Аркан", font=f_small, fill=hexrgb(MUTED))

    img = img.resize((W, H), Image.LANCZOS)
    img.save(OUT, "JPEG", quality=88, optimize=True, progressive=True)
    print(f"{os.path.abspath(OUT)}  {W}×{H}  {os.path.getsize(OUT)} байт")


if __name__ == "__main__":
    main()
