# python3 voice.py page.html voice out.wav [music.wav] — озвучка субтитров SUBS из страницы ролика синтезатором RHVoice.
# PITCH и RATE (проценты, по умолчанию 130 и 115) — выше и быстрее звучит бодрее. Музыка приглушается под голосом.
import subprocess, sys, re, os
page, V, out = sys.argv[1:4]
music = sys.argv[4] if len(sys.argv) > 4 else None
PITCH, RATE = os.environ.get('PITCH', '130'), os.environ.get('RATE', '115')
R = os.environ.get('RHVOICE', 'rhv/inst')
os.environ['LD_LIBRARY_PATH'] = f'{R}/lib:{R}/lib64'
html = open(page, encoding='utf-8').read()
dur = float(re.search(r'DURATION = ([\d.]+)', html).group(1))
subs = [(float(a), float(b), t) for a, b, t in re.findall(r"\[([\d.]+), ([\d.]+), '([^']+)'\]", html)]
os.makedirs('voice', exist_ok=True)
parts = []
for i, (a, b, t) in enumerate(subs):
    raw, trim = f'voice/{V}-{i}.wav', f'voice/{V}-{i}-t.wav'
    subprocess.run([f'{R}/bin/RHVoice-test', '-p', V, '-t', PITCH, '-r', RATE, '-o', raw], input=t.encode(), check=True)
    sil = 'silenceremove=start_periods=1:start_threshold=-45dB'
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', raw, '-af', f'{sil},areverse,{sil},areverse', '-ar', '48000', '-ac', '1', trim], check=True)
    d = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', trim], capture_output=True, text=True).stdout)
    tempo = max(1.0, d / (b - a - .1))
    parts.append((a, trim, tempo)); print(i, round(d, 2), 'slot', round(b - a - .1, 2), 'tempo', round(tempo, 2))
inputs, flt = [], []
for j, (a, f, tempo) in enumerate(parts):
    ms = int(a * 1000); inputs += ['-i', f]; flt.append(f'[{j}]atempo={tempo:.3f},adelay={ms}|{ms}[v{j}]')
n = len(parts)
clicks = [float(x) for x in re.findall(r'CLICK = ([\d.]+)', html)]
for c in clicks:
    inputs += ['-f', 'lavfi', '-t', '0.06', '-i', 'anoisesrc=color=white:amplitude=0.5:sample_rate=48000']
    ms = int(c * 1000); flt.append(f'[{n}]afade=t=out:st=0:d=0.06,highpass=f=1500,adelay={ms}|{ms}[c{n}]'); n += 1
labels = ''.join(f'[v{j}]' for j in range(len(parts))) + ''.join(f'[c{j}]' for j in range(len(parts), n))
if music:
    inputs += ['-i', music]
    flt.append(f'{labels}amix=inputs={n}:normalize=0,apad=whole_dur={dur},atrim=0:{dur},aformat=channel_layouts=stereo,asplit[vox][key]')
    flt.append(f'[{n}]volume=0.45,aformat=channel_layouts=stereo[mus0]')
    flt.append('[mus0][key]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=300[mus]')
    flt.append(f'[vox][mus]amix=inputs=2:normalize=0,atrim=0:{dur},loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[out]')
else:
    flt.append(f'{labels}amix=inputs={n}:normalize=0,apad=whole_dur={dur},atrim=0:{dur},loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[out]')
subprocess.run(['ffmpeg', '-v', 'error', '-y', *inputs, '-filter_complex', ';'.join(flt), '-map', '[out]', '-ac', '2', '-c:a', 'pcm_s16le', out], check=True)
print('ok', out)
