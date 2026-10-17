"""Shared helpers for building The Vault in Blender.

Coordinates: everything is authored in three.js space (x right, y up, z toward viewer)
and converted here to Blender space (x, -z, y). Units are metres.
"""
import bpy, bmesh, math, os, glob
from mathutils import Vector, Matrix

ASSETS = os.environ.get('VAULT_ASSETS', '/home/claude/vault/assets')


def V(x, y, z):
    return Vector((x, -z, y))


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.unit_settings.system = 'METRIC'
    return sc


def coll(name):
    c = bpy.data.collections.get(name)
    if not c:
        c = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(c)
    return c


def link(obj, collection):
    for c in obj.users_collection:
        c.objects.unlink(obj)
    coll(collection).objects.link(obj)
    return obj


# ------------------------------------------------------------------ materials
_tex_cache = {}


def find_tex(name):
    """Locate a Poly Haven / ambientCG texture set folder and return a dict of map paths."""
    if name in _tex_cache:
        return _tex_cache[name]
    roots = glob.glob(os.path.join(ASSETS, 'textures', name)) + glob.glob(os.path.join(ASSETS, 'textures', name + '*'))
    out = {}
    if roots:
        files = glob.glob(os.path.join(roots[0], '**', '*.*'), recursive=True)
        low = [(f, os.path.basename(f).lower()) for f in files]
        def pick(*keys, avoid=()):
            for f, b in low:
                if any(k in b for k in keys) and not any(a in b for a in avoid):
                    return f
        out['color'] = pick('_diff', '_color', 'albedo', 'basecolor')
        out['normal'] = pick('nor_gl', 'normalgl', '_normal_gl') or pick('_nor', 'normal', avoid=('dx',))
        out['rough'] = pick('_rough', 'roughness', avoid=('ness_',))
        out['metal'] = pick('metalness', '_metal.')
        out['arm'] = pick('_arm')
        out['ao'] = pick('_ao', 'ambientocclusion')
    _tex_cache[name] = {k: v for k, v in out.items() if v}
    return _tex_cache[name]


def _img(path, color=True):
    img = bpy.data.images.load(path, check_existing=True)
    if not color:
        img.colorspace_settings.name = 'Non-Color'
    return img


def pbr(name, tex=None, color=(0.5, 0.5, 0.5), rough=0.5, metal=0.0, tint=None, emission=None, estr=0.0,
        normal_strength=1.0, rough_mul=None, alpha=None, coat=0.0):
    """Principled material, optionally driven by a texture set found under assets/textures."""
    mat = bpy.data.materials.get(name)
    if mat:
        return mat
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    b = nt.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if coat:
        b.inputs['Coat Weight'].default_value = coat
        b.inputs['Coat Roughness'].default_value = 0.03
    maps = find_tex(tex) if tex else {}
    if maps.get('color'):
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = _img(maps['color'])
        if tint:
            mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.blend_type = 'MULTIPLY'
            mix.inputs['Factor'].default_value = 1.0
            nt.links.new(t.outputs['Color'], mix.inputs['A']); mix.inputs['B'].default_value = (*tint, 1)
            nt.links.new(mix.outputs['Result'], b.inputs['Base Color'])
        else:
            nt.links.new(t.outputs['Color'], b.inputs['Base Color'])
    elif tint:
        b.inputs['Base Color'].default_value = (*tint, 1)
    if maps.get('rough'):
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = _img(maps['rough'], False)
        if rough_mul:
            m = nt.nodes.new('ShaderNodeMath'); m.operation = 'MULTIPLY'; m.inputs[1].default_value = rough_mul
            nt.links.new(t.outputs['Color'], m.inputs[0]); nt.links.new(m.outputs[0], b.inputs['Roughness'])
        else:
            nt.links.new(t.outputs['Color'], b.inputs['Roughness'])
    elif maps.get('arm'):
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = _img(maps['arm'], False)
        sep = nt.nodes.new('ShaderNodeSeparateColor'); nt.links.new(t.outputs['Color'], sep.inputs['Color'])
        nt.links.new(sep.outputs['Green'], b.inputs['Roughness'])
    if maps.get('metal'):
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = _img(maps['metal'], False)
        nt.links.new(t.outputs['Color'], b.inputs['Metallic'])
    if maps.get('normal'):
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = _img(maps['normal'], False)
        n = nt.nodes.new('ShaderNodeNormalMap'); n.inputs['Strength'].default_value = normal_strength
        nt.links.new(t.outputs['Color'], n.inputs['Color']); nt.links.new(n.outputs['Normal'], b.inputs['Normal'])
    if emission:
        b.inputs['Emission Color'].default_value = (*emission, 1)
        b.inputs['Emission Strength'].default_value = estr
    if alpha is not None:
        b.inputs['Alpha'].default_value = alpha
        mat.surface_render_method = 'BLENDED'
    mat['vault_tex'] = tex or ''
    return mat


def emissive(name, color, strength):
    return pbr(name, color=(0, 0, 0), rough=0.5, emission=color, estr=strength)


# ------------------------------------------------------------------ geometry
def _finish(obj, mat, collection, uv_scale):
    if mat:
        obj.data.materials.append(mat)
    link(obj, collection)
    if uv_scale:
        world_uv(obj, uv_scale)
    return obj


def box(name, center, size, mat=None, collection='STATIC', bevel=0.0, uv_scale=1.0, ry=0.0):
    """center/size in three.js space: size = (w along x, h along y, d along z)."""
    w, h, d = size
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(w, d, h), verts=bm.verts)
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=3, affect='EDGES', profile=0.5)
    bm.to_mesh(me); bm.free()
    obj = bpy.data.objects.new(name, me)
    obj.location = V(*center)
    obj.rotation_euler = (0, 0, ry)
    bpy.context.scene.collection.objects.link(obj)
    for p in me.polygons:
        p.use_smooth = bevel > 0
    return _finish(obj, mat, collection, uv_scale)


def cyl(name, center, radius, height, mat=None, collection='STATIC', segments=48, uv_scale=1.0, radius2=None):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=segments, radius1=radius, radius2=radius if radius2 is None else radius2, depth=height)
    bm.to_mesh(me); bm.free()
    obj = bpy.data.objects.new(name, me)
    obj.location = V(*center)
    bpy.context.scene.collection.objects.link(obj)
    for p in me.polygons:
        p.use_smooth = len(p.vertices) == 4
    return _finish(obj, mat, collection, uv_scale)


def plane(name, center, w, d, mat=None, collection='STATIC', uv_scale=1.0, facing='up', ry=0.0):
    """Horizontal plane (facing up/down) w along x, d along z; or vertical facing +z/-z/+x/-x."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=0.5)
    bmesh.ops.scale(bm, vec=(w, d, 1), verts=bm.verts)
    rot = {
        'up': Matrix.Identity(3), 'down': Matrix.Rotation(math.pi, 3, 'X'),
        '+z': Matrix.Rotation(math.pi / 2, 3, 'X'), '-z': Matrix.Rotation(-math.pi / 2, 3, 'X') @ Matrix.Rotation(math.pi, 3, 'Z'),
        '+x': Matrix.Rotation(math.pi / 2, 3, 'Z') @ Matrix.Rotation(math.pi / 2, 3, 'X'),
        '-x': Matrix.Rotation(-math.pi / 2, 3, 'Z') @ Matrix.Rotation(math.pi / 2, 3, 'X'),
    }[facing]
    # '+z' in three space faces the viewer = Blender -Y
    if facing == '+z':
        rot = Matrix.Rotation(math.pi / 2, 3, 'X')  # normal -> -Y
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=rot)
    bm.to_mesh(me); bm.free()
    obj = bpy.data.objects.new(name, me)
    obj.location = V(*center)
    obj.rotation_euler = (0, 0, ry)
    bpy.context.scene.collection.objects.link(obj)
    return _finish(obj, mat, collection, uv_scale)


def world_uv(obj, scale=1.0, layer='UVMap'):
    """Tri-planar style UVs in world metres so textures tile at a physical size."""
    me = obj.data
    if layer not in me.uv_layers:
        me.uv_layers.new(name=layer)
    bm = bmesh.new(); bm.from_mesh(me)
    uvl = bm.loops.layers.uv[layer]
    mw = obj.matrix_world
    rot = mw.to_3x3()
    for f in bm.faces:
        n = (rot @ f.normal).normalized()
        ax = max(range(3), key=lambda i: abs(n[i]))
        for l in f.loops:
            p = mw @ l.vert.co
            if ax == 2:
                u, v = p.x, p.y
            elif ax == 1:
                u, v = p.x * (1 if n.y < 0 else -1), p.z
            else:
                u, v = p.y * (1 if n.x > 0 else -1), p.z
            l[uvl].uv = (u / scale, v / scale)
    bm.to_mesh(me); bm.free()


def area_light(name, center, size, power, color=(1, 1, 1), shape='RECTANGLE', size_y=None, point_down=True, collection='LIGHTS'):
    d = bpy.data.lights.new(name, 'AREA')
    d.shape = shape; d.size = size; d.size_y = size_y or size; d.energy = power; d.color = color
    o = bpy.data.objects.new(name, d); o.location = V(*center)
    if not point_down:
        pass
    bpy.context.scene.collection.objects.link(o); link(o, collection)
    return o


def spot_light(name, center, target, power, angle=60, blend=0.5, color=(1, 1, 1), radius=0.05, collection='LIGHTS'):
    d = bpy.data.lights.new(name, 'SPOT')
    d.energy = power; d.spot_size = math.radians(angle); d.spot_blend = blend; d.color = color; d.shadow_soft_size = radius
    o = bpy.data.objects.new(name, d); o.location = V(*center)
    direction = V(*target) - V(*center)
    o.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.collection.objects.link(o); link(o, collection)
    return o


def point_light(name, center, power, color=(1, 1, 1), radius=0.1, collection='LIGHTS'):
    d = bpy.data.lights.new(name, 'POINT')
    d.energy = power; d.color = color; d.shadow_soft_size = radius
    o = bpy.data.objects.new(name, d); o.location = V(*center)
    bpy.context.scene.collection.objects.link(o); link(o, collection)
    return o


def kelvin(k):
    """Approximate blackbody colour for a colour temperature."""
    t = k / 100.0
    r = 255 if t <= 66 else 329.698727446 * ((t - 60) ** -0.1332047592)
    g = 99.4708025861 * math.log(t) - 161.1195681661 if t <= 66 else 288.1221695283 * ((t - 60) ** -0.0755148492)
    b = 255 if t >= 66 else (0 if t <= 19 else 138.5177312231 * math.log(t - 10) - 305.0447927307)
    c = [max(0, min(255, x)) / 255 for x in (r, g, b)]
    return tuple(x ** 2.2 for x in c)
