"""Stage 2: merge static geometry into lightmap groups, unwrap a second UV, bake Cycles GI, export.

env: RES (lightmap size, default 4096), SAMPLES (default 128), ONLY (A or B to bake one group).
Writes build/lm/{A,B}.npy (float16 HxWx4 irradiance), build/vault_baked.blend, build/world.glb.
"""
import bpy, bmesh, os, sys, math, time
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))

B = os.environ.get('VAULT_BUILD', '/home/claude/vault/build')
REMOTE = os.environ.get('REMOTE_LM', '')  # dir with A.npz/B.npz/F.npz baked elsewhere: apply instead of baking
RES = int(os.environ.get('RES', '4096'))
SAMPLES = int(os.environ.get('SAMPLES', '128'))
ONLY = os.environ.get('ONLY', '')
os.makedirs(B + '/lm', exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=B + '/vault_stage1.blend')
sc = bpy.context.scene

NOLM = {'chess_set', 'wine_bottles_01', 'brass_goblets', 'marble_bust_01', 'potted_plant_02', 'hanging_industrial_lamp', 'throw_pillows_01'}
ARCH = ('FLOOR_', 'WALL_', 'CEILING', 'BEAM_', 'COL_', 'PLINTH_', 'TVWALL_', 'BOARD_floor', 'BOARD_ceiling', 'RUG', 'BAY_',
        'GARAGE_feature', 'CASINO_coffer', 'BACKBAR_panel')


def coll_of(o):
    return o.users_collection[0].name if o.users_collection else ''


# flatten furniture hierarchies (keep world transforms), make data single-user
for o in list(bpy.data.objects):
    if o.type == 'MESH' and o.parent:
        mw = o.matrix_world.copy(); o.parent = None; o.matrix_world = mw
for o in list(bpy.data.objects):
    if o.type == 'EMPTY' and coll_of(o) != 'CARS':
        bpy.data.objects.remove(o)

groups = {'A': [], 'B': [], 'F': [], 'EMIT': [], 'GLASS': []}
for o in bpy.data.objects:
    if o.type != 'MESH':
        continue
    c = coll_of(o)
    if c == 'EMISSIVE':
        groups['EMIT'].append(o)
    elif c == 'STATIC':
        mats = {m.name for m in o.data.materials if m}
        if mats == {'glass'}:
            groups['GLASS'].append(o)
        elif o.get('furn'):
            groups['F'].append(o)
        elif o.name.startswith(ARCH):
            groups['A'].append(o)
        else:
            groups['B'].append(o)
print({k: len(v) for k, v in groups.items()})


def merge(objs, name):
    if not objs:
        return None
    for o in objs:
        if o.data.users > 1:
            o.data = o.data.copy()
        me = o.data
        # exactly one UV layer called UVMap so joins line up
        while len(me.uv_layers) > 1:
            me.uv_layers.remove(me.uv_layers[-1])
        if not me.uv_layers:
            me.uv_layers.new(name='UVMap')
        me.uv_layers[0].name = 'UVMap'
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    o.name = name; o.data.name = name
    return o


merged = {k: merge(v, 'VAULT_' + k) for k, v in groups.items()}


def unwrap(o, res, pad=2.0):
    """Per-face planar charts at uniform texel density, shelf-packed into one square atlas.

    Coplanar faces sharing an edge are grouped into one chart so flat walls/floors stay seamless.
    """
    me = o.data
    lm = me.uv_layers.new(name='LM')
    me.uv_layers.active = lm  # bake rasterizes through the active UV map
    bm = bmesh.new(); bm.from_mesh(me); bm.faces.ensure_lookup_table()
    uvl = bm.loops.layers.uv['LM']
    # charts: flood fill across edges between faces with (nearly) identical normals
    chart_of = {}
    charts = []
    for f in bm.faces:
        if f.index in chart_of:
            continue
        cid = len(charts); stack = [f]; chart_of[f.index] = cid; members = []
        while stack:
            g = stack.pop(); members.append(g)
            for e in g.edges:
                for h in e.link_faces:
                    if h.index not in chart_of and h.normal.dot(f.normal) > 0.999 and abs((h.calc_center_median() - f.calc_center_median()).dot(f.normal)) < 1e-3:
                        chart_of[h.index] = cid; stack.append(h)
        charts.append(members)
    rects = []
    for members in charts:
        n = members[0].normal.normalized()
        # longest edge of the first face as the chart tangent
        e = max(members[0].edges, key=lambda e: e.calc_length())
        u = (e.verts[1].co - e.verts[0].co).normalized()
        u = (u - n * u.dot(n)).normalized()
        v = n.cross(u)
        pts = {}
        for g in members:
            for l in g.loops:
                pts[l] = (l.vert.co.dot(u), l.vert.co.dot(v))
        xs = [p[0] for p in pts.values()]; ys = [p[1] for p in pts.values()]
        if max(ys) - min(ys) > max(xs) - min(xs):  # lay charts flat: better shelf packing
            pts = {l: (q[1], q[0]) for l, q in pts.items()}
            xs, ys = ys, xs
        x0, y0 = min(xs), min(ys)
        rects.append([max(xs) - x0, max(ys) - y0, x0, y0, pts])

    def pack(D):
        order = sorted(range(len(rects)), key=lambda i: -(rects[i][1] * D))
        x = y = shelf = 0.0; place = {}
        for i in order:
            w = math.ceil(rects[i][0] * D) + 2 * pad; h = math.ceil(rects[i][1] * D) + 2 * pad
            if w > res:
                return None
            if x + w > res:
                x = 0; y += shelf; shelf = 0
            if y + h > res:
                return None
            place[i] = (x, y); x += w; shelf = max(shelf, h)
        return place
    lo, hi = 1.0, 2000.0
    for _ in range(30):
        mid = (lo + hi) / 2
        if pack(mid):
            lo = mid
        else:
            hi = mid
    D = lo; place = pack(D)
    for i, (w, h, x0, y0, pts) in enumerate(rects):
        px, py = place[i]
        for l, (a, b2) in pts.items():
            l[uvl].uv = ((px + pad + (a - x0) * D) / res, (py + pad + (b2 - y0) * D) / res)
    bm.to_mesh(me); bm.free()
    print('unwrap', o.name, len(charts), 'charts', round(D, 1), 'texels/m', flush=True)


def vcol_layer(o):
    me = o.data
    a = me.color_attributes.new('BAKE', 'FLOAT_COLOR', 'POINT')
    me.color_attributes.active_color = a
    return a


def cull_hidden(o):
    """Delete faces nobody can see: floor undersides, ceiling top, outer wall faces, bottoms resting on the floor."""
    bm = bmesh.new(); bm.from_mesh(o.data)
    HX, HZ, HH = 24.0, 16.0, 8.0
    kill = []
    for f in bm.faces:
        c = f.calc_center_median(); n = f.normal
        # Blender: x, y=-z(three), z=up
        if n.z < -0.99 and c.z < 0.02:
            kill.append(f)
        elif n.z > 0.99 and c.z > HH - 0.01:
            kill.append(f)
        elif abs(c.x) > HX + 0.01 or abs(c.y) > HZ + 0.01:
            kill.append(f)
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    bm.to_mesh(o.data); bm.free()
    print('culled', o.name, len(kill))


for k in ('A', 'B'):
    if merged[k]:
        cull_hidden(merged[k])
LMRES = {'A': RES, 'B': RES // 2}
for k in ('A', 'B'):
    if merged[k]:
        unwrap(merged[k], LMRES[k])
if merged['F']:
    vcol_layer(merged['F'])

# ------------------------------------------------------------------ bake
sc.render.engine = 'CYCLES'
sc.cycles.device = 'CPU'
if os.environ.get('VAULT_GPU'):
    cp = bpy.context.preferences.addons['cycles'].preferences
    cp.compute_device_type = 'METAL'; cp.get_devices()
    for d in cp.devices:
        d.use = True
    sc.cycles.device = 'GPU'
    print('GPU devices', [d.name for d in cp.devices], flush=True)
sc.cycles.samples = SAMPLES
sc.cycles.max_bounces = 6; sc.cycles.diffuse_bounces = 4; sc.cycles.glossy_bounces = 2; sc.cycles.transmission_bounces = 4
sc.cycles.sample_clamp_indirect = 8.0
sc.world = sc.world or bpy.data.worlds.new('w')
sc.world.use_nodes = True
sc.world.node_tree.nodes['Background'].inputs[1].default_value = 0.0
bk = sc.render.bake
bk.use_pass_direct = True; bk.use_pass_indirect = True; bk.use_pass_color = False
bk.margin = 0; bk.target = 'IMAGE_TEXTURES'; bk.use_clear = True

for k in ('A', 'B'):
    o = merged[k]
    if not o or (ONLY and ONLY != k):
        continue
    R = LMRES[k]
    img = bpy.data.images.new('LM_' + k, R, R, alpha=True, float_buffer=True)
    img.generated_color = (0, 0, 0, 0)
    for m in o.data.materials:
        nt = m.node_tree
        n = nt.nodes.get('LM_BAKE') or nt.nodes.new('ShaderNodeTexImage')
        n.name = 'LM_BAKE'; n.image = img
        uvn = nt.nodes.get('LM_UV') or nt.nodes.new('ShaderNodeUVMap')
        uvn.name = 'LM_UV'; uvn.uv_map = 'LM'
        nt.links.new(uvn.outputs['UV'], n.inputs['Vector'])
        for x in nt.nodes:
            x.select = False
        n.select = True; nt.nodes.active = n
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True); bpy.context.view_layer.objects.active = o
    t = time.time()
    if REMOTE:
        rgb = np.load(f'{REMOTE}/{k}.npz')['rgb'].astype(np.float16)
        np.save(f'{B}/lm/{k}.npy', np.concatenate([rgb, np.ones(rgb.shape[:2] + (1,), np.float16)], -1))
        print('applied remote', k, rgb.shape, flush=True)
        continue
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'DIRECT', 'INDIRECT'}, margin=0, use_clear=True)
    print('baked', k, RES, SAMPLES, round(time.time() - t, 1), 's', flush=True)
    px = np.empty(R * R * 4, dtype=np.float32); img.pixels.foreach_get(px)
    a4 = px.reshape(R, R, 4)[::-1].astype(np.float16)  # flip to top-down rows
    np.save(f'{B}/lm/{k}.npy', a4)
    np.savez_compressed(f'{B}/lm/{k}.npz', rgb=a4[..., :3])

o = merged['F']
if o and (not ONLY or ONLY == 'F'):
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True); bpy.context.view_layer.objects.active = o
    bk.target = 'VERTEX_COLORS'
    t = time.time()
    me = o.data; nv = len(me.vertices)
    pos = np.empty(nv * 3, np.float32); me.vertices.foreach_get('co', pos); pos = pos.reshape(-1, 3)
    attr = me.color_attributes['BAKE']
    if REMOTE:
        from mathutils.kdtree import KDTree
        r = np.load(f'{REMOTE}/F.npz'); rp, rc = r['pos'], r['col'].astype(np.float32)
        kd = KDTree(len(rp))
        for i, q in enumerate(rp):
            kd.insert(q, i)
        kd.balance()
        col = np.ones((nv, 4), np.float32)
        for i in range(nv):
            col[i, :3] = rc[kd.find(pos[i])[1]]
        attr.data.foreach_set('color', col.reshape(-1))
        print('applied remote F', nv, len(rp), flush=True)
    else:
        bpy.ops.object.bake(type='DIFFUSE', pass_filter={'DIRECT', 'INDIRECT'}, margin=0)
        print('baked F verts', nv, round(time.time() - t, 1), 's', flush=True)
        col = np.empty(nv * 4, np.float32); attr.data.foreach_get('color', col)
        np.savez_compressed(f'{B}/lm/F.npz', pos=pos, col=col.reshape(-1, 4)[:, :3].astype(np.float16))
    bk.target = 'IMAGE_TEXTURES'

# drop bake nodes before saving/export
for m in bpy.data.materials:
    for nm in ('LM_BAKE', 'LM_UV'):
        if m.node_tree and m.node_tree.nodes.get(nm):
            m.node_tree.nodes.remove(m.node_tree.nodes[nm])
bpy.ops.wm.save_as_mainfile(filepath=B + '/vault_baked.blend')
print('BAKE DONE')
