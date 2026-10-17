"""Stage 3: export the baked world (no cars, no lights) to build/world.glb.

Vertex-baked light on VAULT_F is scaled by 1/VSCALE so it fits normalized vertex colours.
"""
import bpy, os, numpy as np

B = '/home/claude/vault/build'
VSCALE = 8.0
bpy.ops.wm.open_mainfile(filepath=B + '/vault_baked.blend')
for o in list(bpy.data.objects):
    c = o.users_collection[0].name if o.users_collection else ''
    if c in ('CARS', 'LIGHTS') or o.type not in ('MESH',):
        bpy.data.objects.remove(o)

f = bpy.data.objects.get('VAULT_F')
if f and 'BAKE' in f.data.color_attributes:
    a = f.data.color_attributes['BAKE']
    px = np.empty(len(a.data) * 4, dtype=np.float32); a.data.foreach_get('color', px)
    px = px.reshape(-1, 4)
    px[:, :3] = np.clip(px[:, :3] / VSCALE, 0, 1); px[:, 3] = 1
    a.data.foreach_set('color', px.reshape(-1))
    f.data.color_attributes.active_color = a

# Glass gets a proper transmission-free transparent look in three; keep the LM layer as TEXCOORD_1.
for o in bpy.data.objects:
    if o.type == 'MESH':
        o.data.uv_layers.active_index = 0

bpy.ops.export_scene.gltf(
    filepath=B + '/world.glb', export_format='GLB', export_texcoords=True, export_normals=True,
    export_tangents=False, export_vertex_color='ACTIVE', export_active_vertex_color_when_no_material=True,
    export_extras=True, export_lights=False, export_cameras=False, export_yup=True, export_apply=False,
    export_image_format='AUTO')
print('EXPORT OK', os.path.getsize(B + '/world.glb'))
