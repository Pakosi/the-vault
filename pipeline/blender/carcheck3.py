import bpy, os, sys
from mathutils import Vector
D='/home/claude/vault/build/carsn'; OUT=D+'/png'; os.makedirs(OUT,exist_ok=True)
names=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else sorted(x[:-4] for x in os.listdir(D) if x.endswith('.glb'))
for n in names:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=f'{D}/{n}.glb')
    sc=bpy.context.scene; sc.render.engine='CYCLES'; sc.cycles.samples=8; sc.render.resolution_x=400; sc.render.resolution_y=260
    w=bpy.data.worlds.new('w'); sc.world=w; w.use_nodes=True; w.node_tree.nodes['Background'].inputs[1].default_value=1.2
    bpy.ops.mesh.primitive_plane_add(size=30)
    cam=bpy.data.objects.new('cam',bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera=cam
    cam.location=Vector((-4.5,-6.5,2.2))  # three.js (-4.5, 2.2, +6.5): front-left
    cam.rotation_euler=(Vector((0,0,0.6))-cam.location).to_track_quat('-Z','Y').to_euler()
    sc.render.filepath=f'{OUT}/{n}.png'; bpy.ops.render.render(write_still=True)
