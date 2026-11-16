# python3 music.py out.wav [секунды] — весёлая фоновая музыка для ролика, синтезируется здесь же (без чужих прав).
# 120 уд./мин, C – G – Am – F, щипковое арпеджио, бас, шейкер и лёгкие хлопки; последний такт — долгий аккорд до.
import sys, wave
import numpy as np

out = sys.argv[1]
dur = float(sys.argv[2]) if len(sys.argv) > 2 else 20.0
SR, BPM = 48000, 120
beat = 60 / BPM
n = int(SR * dur)
L, R = np.zeros(n), np.zeros(n)
rng = np.random.default_rng(7)

def note(f):  # частота по номеру MIDI
    return 440 * 2 ** ((f - 69) / 12)

def pluck(freq, length, amp):
    t = np.arange(int(SR * length)) / SR
    env = np.exp(-t * 7) * np.minimum(1, t * 400)
    tone = np.sin(2 * np.pi * freq * t) + .35 * np.sin(4 * np.pi * freq * t) + .12 * np.sin(6 * np.pi * freq * t)
    return amp * env * tone

def add(sig, at, pan=0.0):
    i = int(at * SR)
    if i >= n: return
    sig = sig[: n - i]
    L[i:i + len(sig)] += sig * (1 - pan) / 2 * 2 ** .5
    R[i:i + len(sig)] += sig * (1 + pan) / 2 * 2 ** .5

CHORDS = [(60, 64, 67), (55, 59, 62), (57, 60, 64), (53, 57, 60)]   # C, G, Am, F
bar = 4 * beat
bars = int(np.ceil(dur / bar))
for b in range(bars):
    root = CHORDS[b % 4]
    t0 = b * bar
    last = t0 + bar >= dur - .01
    if last:  # финал: аккорд до звучит до конца
        for k, m in enumerate((60, 64, 67, 72)):
            add(pluck(note(m), dur - t0, .16), t0 + k * .03, pan=(k - 1.5) * .3)
        add(pluck(note(36), dur - t0, .35), t0)
        continue
    arp = [root[0] + 12, root[1] + 12, root[2] + 12, root[1] + 12, root[0] + 24, root[2] + 12, root[1] + 12, root[2] + 12]
    for e, m in enumerate(arp):  # восьмые
        add(pluck(note(m), .5, .13), t0 + e * beat / 2, pan=.35 if e % 2 else -.35)
    for q in (0, 2):  # бас на 1 и 3
        add(pluck(note(root[0] - 12), .9, .32), t0 + q * beat)
    for q in range(8):  # шейкер на слабые восьмые
        if q % 2:
            s = rng.standard_normal(int(SR * .05)) * np.exp(-np.arange(int(SR * .05)) / SR * 90)
            s = np.diff(s, prepend=0)  # высокие частоты
            add(s * .05, t0 + q * beat / 2, pan=.5)
    for q in (1, 3):  # хлопки на 2 и 4
        s = rng.standard_normal(int(SR * .12)) * np.exp(-np.arange(int(SR * .12)) / SR * 35)
        add(np.diff(s, prepend=0) * .06, t0 + q * beat, pan=-.2)

mix = np.stack([L, R], 1)
fade = np.ones(n); f = int(SR * .4); fade[-f:] = np.linspace(1, 0, f)
mix *= fade[:, None]
mix /= np.abs(mix).max() / .8
with wave.open(out, 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((mix * 32767).astype('<i2').tobytes())
print('ok', out)
