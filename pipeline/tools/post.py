"""Post-process bakes into web assets.

lightmaps: build/lm/{A,B}.npy -> dilate, OpenImageDenoise, dilate -> site/assets/world/lm_{A,B}.webp (sRGB, value/scale)
env maps:  build/env/*.npy -> site/assets/world/env_<name>.json  ({w,h,data: base64(gzip(float16 RGBA))})
Prints the scales to put in layout.json.
"""
import numpy as np, json, gzip, base64, os, sys
from PIL import Image
sys.path.insert(0, os.path.dirname(__file__))
from tools_oidn import denoise

B = '/home/claude/vault/build'
OUT = os.environ.get('OUT', '/home/claude/vault/site/assets/world')
os.makedirs(OUT, exist_ok=True)


def dilate(rgb, valid, iters):
    rgb = rgb.copy(); valid = valid.copy()
    for _ in range(iters):
        acc = np.zeros_like(rgb); cnt = np.zeros(valid.shape, np.float32)
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0), (1, 1), (-1, -1), (1, -1), (-1, 1)):
            v = np.roll(np.roll(valid, dy, 0), dx, 1); c = np.roll(np.roll(rgb, dy, 0), dx, 1)
            acc += c * v[..., None]; cnt += v
        fill = (~valid) & (cnt > 0)
        rgb[fill] = acc[fill] / cnt[fill][:, None]; valid = valid | fill
    return rgb, valid


scales = {}
for k in sys.argv[1:] or ['A', 'B']:
    f = f'{B}/lm/{k}.npy'
    if not os.path.exists(f):
        continue
    rgb = np.load(f).astype(np.float32)[..., :3]
    valid = rgb.sum(-1) > 0
    rgb, valid2 = dilate(rgb, valid, 4)
    rgb = np.maximum(denoise(rgb), 0)
    rgb[~valid] = 0
    rgb, _ = dilate(rgb, valid, 6)
    S = float(np.percentile(rgb[valid], 99.7))
    enc = (np.clip(rgb / S, 0, 1) ** (1 / 2.2) * 255 + 0.5).astype(np.uint8)
    im = Image.fromarray(enc)
    im.save(f'{OUT}/lm_{k}.webp', quality=92, method=6)
    scales[k] = round(S, 4)
    print(k, rgb.shape, 'scale', S, 'webp', os.path.getsize(f'{OUT}/lm_{k}.webp'))
    # preview for review
    im.resize((1024, 1024)).save(f'{B}/lm/prev_{k}.png')

for f in sorted(os.listdir(f'{B}/env')) if os.path.isdir(f'{B}/env') else []:
    if not f.endswith('.npy'):
        continue
    a = np.load(f'{B}/env/{f}').astype(np.float32)
    h, w = a.shape[:2]
    rgba = np.concatenate([a, np.ones((h, w, 1), np.float32)], -1).astype(np.float16)
    data = base64.b64encode(gzip.compress(rgba.tobytes(), 9)).decode()
    name = f[:-4]
    json.dump({'w': w, 'h': h, 'data': data}, open(f'{OUT}/env_{name}.json', 'w'))
    print('env', name, w, h, len(data))
print(json.dumps(scales))
# merge scales into the runtime layout
lay = json.load(open(f'{B}/layout.json'))
old = {}
if os.path.exists(f'{OUT}/layout.json'):
    old = json.load(open(f'{OUT}/layout.json')).get('lightmaps', {})
lay['lightmaps'] = {**old, **scales, 'F': 8.0}
json.dump(lay, open(f'{OUT}/layout.json', 'w'))
print('layout written', lay['lightmaps'])
