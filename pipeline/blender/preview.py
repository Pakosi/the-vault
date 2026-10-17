import bpy, sys, os, math
sys.path.insert(0, os.path.dirname(__file__))
from lib import V
from mathutils import Vector
B='/home/claude/vault/build'
bpy.ops.wm.open_mainfile(filepath=B+'/vault_stage1.blend')
sc=bpy.context.scene; sc.render.engine='CYCLES'; sc.cycles.samples=int(os.environ.get('S','24'))
sc.cycles.use_denoising=True
try: sc.cycles.denoiser='OPENIMAGEDENOISE'
except Exception as e: print('nodenoise',e)
sc.render.resolution_x=640; sc.render.resolution_y=360
sc.view_settings.view_transform='AgX'; sc.view_settings.look='AgX - Medium High Contrast' if 'AgX - Medium High Contrast' in [l for l in ['AgX - Medium High Contrast']] else 'None'
sc.cycles.max_bounces=6
w=bpy.data.worlds.new('w'); sc.world=w; w.use_nodes=True; w.node_tree.nodes['Background'].inputs[1].default_value=0.0
cam=bpy.data.objects.new('cam',bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera=cam; cam.data.lens=20
views={'garage':((-5,2.4,6),(-16,0.8,-2)),'lounge':((0,2.0,0.5),(0,1.6,-16)),'bar':((2,1.9,4),(-2,1.2,16)),'casino':((7,2.4,0),(18,0.8,10)),'arcade':((14,1.9,-2),(11,1,-16)),'board':((19,1.7,-3),(21,1,-14))}
sel=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else list(views)
for k in sel:
    p,t=views[k]; cam.location=V(*p); cam.rotation_euler=(V(*t)-V(*p)).to_track_quat('-Z','Y').to_euler()
    sc.render.filepath=f'{B}/prev/{k}.png'; bpy.ops.render.render(write_still=True)
