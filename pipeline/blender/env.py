"""Render equirect environment panoramas (cars hidden) for runtime reflections. env: RES (width), SAMPLES.
Output: build/env/<name>.npy float16 HxWx3 in three.js equirect convention (u=0.5 faces +X, u=0.75 faces +Z)."""
import bpy, os, sys, math, numpy as np
sys.path.insert(0, os.path.dirname(__file__))
from lib import V
B = '/home/claude/vault/build'; os.makedirs(B + '/env', exist_ok=True)
W = int(os.environ.get('RES', '1024')); S = int(os.environ.get('SAMPLES', '64'))
PROBES = {'garage': (-16, 1.4, 0), 'hall': (4, 1.6, 0), 'casino': (16, 1.6, 6)}
sel = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else list(PROBES)
bpy.ops.wm.open_mainfile(filepath=B + '/vault_stage1.blend')
sc = bpy.context.scene
for o in bpy.data.objects:
    if o.users_collection and o.users_collection[0].name == 'CARS':
        o.hide_render = True
sc.render.engine = 'CYCLES'; sc.cycles.samples = S; sc.cycles.use_denoising = True
sc.render.resolution_x = W; sc.render.resolution_y = W // 2; sc.render.resolution_percentage = 100
sc.view_settings.view_transform = 'Standard'
sc.render.image_settings.file_format = 'OPEN_EXR'; sc.render.image_settings.color_depth = '32'
sc.world = sc.world or bpy.data.worlds.new('w'); sc.world.use_nodes = True
sc.world.node_tree.nodes['Background'].inputs[1].default_value = 0.0
cam = bpy.data.objects.new('pano', bpy.data.cameras.new('pano')); sc.collection.objects.link(cam); sc.camera = cam
cam.data.type = 'PANO'
try:
    cam.data.panorama_type = 'EQUIRECTANGULAR'
except Exception:
    cam.data.cycles.panorama_type = 'EQUIRECTANGULAR'
cam.rotation_euler = (math.pi / 2, 0, math.pi / 2)
for name in sel:
    cam.location = V(*PROBES[name])
    sc.render.filepath = f'/tmp/env_{name}.exr'
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(f'/tmp/env_{name}.exr')
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32); img.pixels.foreach_get(px)
    np.save(f'{B}/env/{name}.npy', np.roll(px.reshape(h, w, 4)[::-1, :, :3], w // 2, axis=1).astype(np.float16))  # Cycles u=0.5 faces -X; three expects +X
    print('ENV', name, w, h, float(px.max()))
