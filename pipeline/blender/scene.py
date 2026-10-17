"""Build The Vault warehouse in Blender (stage 1: geometry, materials, lights).

Run:  python scene.py  (with the bpy venv). Saves build/vault.blend and build/layout.json.
Layout is authored in three.js coordinates (x right, y up, z toward the viewer).
"""
import bpy, bmesh, math, os, sys, json, glob
sys.path.insert(0, os.path.dirname(__file__))
from lib import *

OUT = os.environ.get('VAULT_OUT', '/home/claude/vault/build')
os.makedirs(OUT, exist_ok=True)
HX, HZ, HH = 24.0, 16.0, 8.0
layout = {'hall': [HX, HZ, HH], 'cars': [], 'interact': [], 'colliders': [], 'screens': {}, 'spawn': [-2, 0, 6, 0]}

reset()
for c in ('STATIC', 'EMISSIVE', 'LIGHTS', 'CARS', 'DYNAMIC'):
    coll(c)


def col(x0, x1, z0, z1):
    layout['colliders'].append([round(x0, 3), round(x1, 3), round(z0, 3), round(z1, 3)])


def colbox(cx, cz, w, d):
    col(cx - w / 2, cx + w / 2, cz - d / 2, cz + d / 2)


def interact(kind, x, z, r, **kw):
    layout['interact'].append({'kind': kind, 'pos': [x, z], 'r': r, **kw})


# ------------------------------------------------------------------ materials
WARM = kelvin(2700)
NEUTRAL = kelvin(4300)
COOL = kelvin(6500)
M = {
    'concrete': pbr('concrete_garage', 'smooth_concrete_floor', tint=(0.32, 0.32, 0.33), rough_mul=0.45, normal_strength=0.4),
    'concrete_light': pbr('concrete_lounge', 'concrete_floor_02', tint=(0.55, 0.53, 0.5), rough_mul=0.8),
    'parquet': pbr('parquet', 'herringbone_parquet', tint=(0.55, 0.42, 0.33), rough_mul=0.9),
    'brick': pbr('brick', 'dark_brick_wall', tint=(0.75, 0.68, 0.64)),
    'walnut': pbr('walnut', 'smoked_walnut_veneer', rough_mul=0.7),
    'darkwood': pbr('darkwood', 'dark_wood'),
    'marble_w': pbr('marble_white', 'marble_01', rough_mul=0.25, coat=0.3),
    'marble_k': pbr('marble_black', 'acg_Marble016', rough_mul=0.3, coat=0.4),
    'leather_k': pbr('leather_black', 'acg_Leather026', tint=(0.35, 0.35, 0.35)),
    'leather_tan': pbr('leather_tan', 'leather_white', tint=(0.45, 0.24, 0.12)),
    'velvet': pbr('velvet_green', 'velour_velvet', tint=(0.06, 0.18, 0.12)),
    'carpet': pbr('carpet', 'acg_Carpet004', tint=(0.35, 0.08, 0.1)),
    'rug': pbr('rug', 'poly_wool_herringbone', tint=(0.28, 0.26, 0.24)),
    'stone_tile': pbr('stone_tile', 'grey_cartago_01', tint=(0.35, 0.35, 0.37), rough_mul=0.6),
    'steel': pbr('steel_dark', 'acg_Metal009', tint=(0.18, 0.18, 0.2), metal=1.0),
    'brushed': pbr('steel_brushed', 'acg_Metal009', metal=1.0),
    'brass': pbr('brass', 'acg_Metal051A', tint=(0.85, 0.62, 0.32), metal=1.0, rough_mul=0.6),
    'ceiling': pbr('ceiling', 'metal_plate', tint=(0.07, 0.07, 0.08), metal=0.6),
    'black_gloss': pbr('black_gloss', color=(0.01, 0.01, 0.012), rough=0.08, coat=1.0),
    'black_matte': pbr('black_matte', color=(0.02, 0.02, 0.022), rough=0.6),
    'felt_green': pbr('felt_green', 'acg_Fabric029', tint=(0.03, 0.22, 0.12), rough=0.95),
    'felt_blue': pbr('felt_blue', 'acg_Fabric029', tint=(0.03, 0.09, 0.22), rough=0.95),
    'glass': pbr('glass', color=(0.8, 0.85, 0.88), rough=0.02, alpha=0.18),
    'screen_off': pbr('screen', color=(0.005, 0.005, 0.006), rough=0.05, coat=1.0),
}
E = {
    'hex': emissive('led_hex', COOL, 7.0),
    'warm_strip': emissive('led_warm', WARM, 8.0),
    'gold_strip': emissive('led_gold', (1.0, 0.62, 0.25), 10.0),
    'pink': emissive('neon_pink', (1.0, 0.05, 0.35), 18.0),
    'cyan': emissive('neon_cyan', (0.05, 0.75, 1.0), 18.0),
    'white_neon': emissive('neon_white', NEUTRAL, 14.0),
    'backbar': emissive('backbar_glow', (1.0, 0.4, 0.12), 0.22),
    'tv_glow': emissive('tv_glow', (0.35, 0.25, 1.0), 0.35),
    'slot_screen': emissive('slot_screen', (0.9, 0.3, 0.6), 0.5),
    'arcade_screen': emissive('arcade_screen', (0.2, 0.7, 1.0), 0.5),
    'pink_dim': emissive('neon_pink_dim', (1.0, 0.05, 0.35), 4.0),
    'cyan_dim': emissive('neon_cyan_dim', (0.05, 0.75, 1.0), 4.0),
}

# ------------------------------------------------------------------ shell
# floors per zone
box('FLOOR_garage', (-16, -0.05, 0), (16, 0.1, 32), M['concrete'], uv_scale=4.0)
box('FLOOR_lounge', (0, -0.05, -2), (16, 0.1, 28), M['parquet'], uv_scale=2.0)
box('FLOOR_bar', (0, -0.05, 14), (16, 0.1, 4), M['concrete_light'], uv_scale=4.0)
box('FLOOR_casino', (16, -0.05, 8), (16, 0.1, 16), M['carpet'], uv_scale=2.5)
box('FLOOR_east', (16, -0.05, -8), (16, 0.1, 16), M['stone_tile'], uv_scale=1.6)
# walls
T = 0.3
box('WALL_n', (0, HH / 2, -HZ - T / 2), (2 * HX + 2 * T, HH, T), M['brick'], uv_scale=2.4)
box('WALL_s', (0, HH / 2, HZ + T / 2), (2 * HX + 2 * T, HH, T), M['brick'], uv_scale=2.4)
box('WALL_w', (-HX - T / 2, HH / 2, 0), (T, HH, 2 * HZ), M['brick'], uv_scale=2.4)
box('WALL_e', (HX + T / 2, HH / 2, 0), (T, HH, 2 * HZ), M['brick'], uv_scale=2.4)
col(-99, 99, -99, -HZ + 0.15); col(-99, 99, HZ - 0.15, 99); col(-99, -HX + 0.15, -99, 99); col(HX - 0.15, 99, -99, 99)
# black wainscot / plinth
for name, c, s in [('PLINTH_n', (0, 0.6, -HZ + 0.03), (2 * HX, 1.2, 0.06)), ('PLINTH_s', (0, 0.6, HZ - 0.03), (2 * HX, 1.2, 0.06)),
                   ('PLINTH_w', (-HX + 0.03, 0.6, 0), (0.06, 1.2, 2 * HZ)), ('PLINTH_e', (HX - 0.03, 0.6, 0), (0.06, 1.2, 2 * HZ))]:
    box(name, c, s, M['black_matte'])
box('CEILING', (0, HH + 0.05, 0), (2 * HX, 0.1, 2 * HZ), M['ceiling'], uv_scale=3.0)
# trusses and columns
for i in range(9):
    x = -HX + 3 + i * 5.25
    box(f'BEAM_{i}', (x, HH - 0.45, 0), (0.3, 0.7, 2 * HZ), M['steel'], uv_scale=1.0)
    for s in (-1, 1):
        if s < 0 and -7 < x < 24:  # TV wall + arcade/boardroom wall stay clean
            continue
        if s > 0 and -7 < x < 23:  # bar + slot row
            continue
        box(f'COL_{i}_{s}', (x, HH / 2, s * (HZ - 0.25)), (0.4, HH, 0.4), M['steel'], uv_scale=1.0)

# ------------------------------------------------------------------ garage
GX0, GX1 = -23.0, -8.5


def hex_grid(name, x0, x1, z0, z1, y, r=0.95, mat=None):
    """Honeycomb LED ceiling: one joined mesh of thin tubes."""
    bm = bmesh.new()
    w = math.sqrt(3) * r
    edges = set()
    row = 0
    z = z0 + r
    while z < z1 - r * 0.5:
        x = x0 + w / 2 + (w / 2 if row % 2 else 0)
        while x < x1 - w * 0.4:
            pts = [(x + r * math.cos(math.radians(60 * k + 30)), z + r * math.sin(math.radians(60 * k + 30))) for k in range(6)]
            for k in range(6):
                a, b = pts[k], pts[(k + 1) % 6]
                key = tuple(sorted([(round(a[0], 2), round(a[1], 2)), (round(b[0], 2), round(b[1], 2))]))
                edges.add(key)
            x += w
        z += 1.5 * r
        row += 1
    for (ax, az), (bx, bz) in edges:
        L = math.hypot(bx - ax, bz - az)
        ang = math.atan2(-(bz - az), bx - ax)
        res = bmesh.ops.create_cube(bm, size=1.0)
        vs = res['verts']
        bmesh.ops.scale(bm, vec=(L + 0.05, 0.05, 0.035), verts=vs)
        bmesh.ops.rotate(bm, verts=vs, cent=(0, 0, 0), matrix=Matrix.Rotation(ang, 3, 'Z'))
        bmesh.ops.translate(bm, verts=vs, vec=V((ax + bx) / 2, y, (az + bz) / 2))
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(o)
    o.data.materials.append(mat)
    link(o, 'EMISSIVE')
    return o, len(edges)


hex_grid('LED_hex_garage', GX0 + 0.3, GX1 - 0.3, -14.5, 14.5, 6.6, mat=E['hex'])
# hex frame
box('HEX_frame_n', ((GX0 + GX1) / 2, 6.6, -14.7), (GX1 - GX0, 0.06, 0.06), E['hex'], collection='EMISSIVE', uv_scale=0)
box('HEX_frame_s', ((GX0 + GX1) / 2, 6.6, 14.7), (GX1 - GX0, 0.06, 0.06), E['hex'], collection='EMISSIVE', uv_scale=0)
# turntable
cyl('TURNTABLE', (-16, 0.06, 0), 3.2, 0.12, M['black_gloss'], segments=96)
cyl('TURNTABLE_ring', (-16, 0.125, 0), 3.25, 0.01, E['gold_strip'], collection='EMISSIVE', segments=96, uv_scale=0)
cyl('TURNTABLE_ring_cut', (-16, 0.128, 0), 3.2, 0.012, M['black_gloss'], segments=96, uv_scale=0)
colbox(-16, 0, 6, 6)
# signature wall: backlit brushed panels with brass logo bar
box('GARAGE_feature', (-HX + 0.08, 3.4, 0), (0.12, 4.2, 14), M['black_gloss'])
box('GARAGE_feature_glow_top', (-HX + 0.16, 5.55, 0), (0.04, 0.05, 14), E['warm_strip'], collection='EMISSIVE', uv_scale=0)
box('GARAGE_feature_glow_bot', (-HX + 0.16, 1.25, 0), (0.04, 0.05, 14), E['warm_strip'], collection='EMISSIVE', uv_scale=0)


def neon_text(name, text, center, size, mat, ry=0.0, depth=0.04, font_bold=True):
    cu = bpy.data.curves.new(name, 'FONT')
    cu.body = text; cu.size = size; cu.extrude = depth; cu.align_x = 'CENTER'; cu.align_y = 'CENTER'
    o = bpy.data.objects.new(name, cu); bpy.context.scene.collection.objects.link(o)
    o.location = V(*center)
    o.rotation_euler = (math.pi / 2, 0, ry)
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.convert(target='MESH')
    o = bpy.context.view_layer.objects.active
    o.data.materials.clear(); o.data.materials.append(mat)
    link(o, 'EMISSIVE')
    o.select_set(False)
    return o


neon_text('SIGN_garage', 'THE COLLECTION', (-HX + 0.2, 3.4, 0), 0.9, E['white_neon'], ry=math.pi / 2)

# car slots (cars are loaded in the browser; imported here only for baked contact shadows)
CAR_SLOTS = [
    # name, file key, x, z, ry
    ('hero', -16, 0, math.radians(35)),
    ('n1', -21, -11, 0), ('n2', -16, -11, 0), ('n3', -11, -11, 0),
    ('s1', -21, 11, math.pi), ('s2', -16, 11, math.pi), ('s3', -11, 11, math.pi),
]
for key, x, z, ry in CAR_SLOTS:
    layout['cars'].append({'slot': key, 'pos': [x, 0.12 if key == 'hero' else 0, z], 'ry': ry})
    if key != 'hero':
        colbox(x, z, 2.3, 5.0)
        interact('car', x, z + (3.2 if z < 0 else -3.2), 2.4, slot=key)
interact('car', -16, 3.8, 2.6, slot='hero'); interact('car', -12.2, 0, 2.6, slot='hero')
# low black plinth lines under bays
for key, x, z, ry in CAR_SLOTS[1:]:
    box(f'BAY_{key}', (x, 0.01, z), (2.9, 0.02, 5.6), M['black_gloss'], uv_scale=0)

# ------------------------------------------------------------------ lounge
# TV feature wall: walnut slats
slat_w, gap = 0.09, 0.05
nslats = int(11.0 / (slat_w + gap))
bm = bmesh.new()
for i in range(nslats):
    x = -5.5 + i * (slat_w + gap)
    r = bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(slat_w, 0.05, 6.2), verts=r['verts'])
    bmesh.ops.translate(bm, verts=r['verts'], vec=V(x, 3.1, -HZ + 0.12))
me = bpy.data.meshes.new('TVWALL_slats'); bm.to_mesh(me); bm.free()
o = bpy.data.objects.new('TVWALL_slats', me); bpy.context.scene.collection.objects.link(o)
o.data.materials.append(M['walnut']); link(o, 'STATIC'); world_uv(o, 1.2)
box('TVWALL_back', (0, 3.1, -HZ + 0.05), (11.2, 6.2, 0.04), M['black_matte'])
box('TVWALL_cove', (0, 6.25, -HZ + 0.2), (11.2, 0.04, 0.04), E['warm_strip'], collection='EMISSIVE', uv_scale=0)
box('TV_bezel', (0, 3.2, -HZ + 0.25), (6.6, 3.8, 0.08), M['black_gloss'], bevel=0.01)
box('TV_screen', (0, 3.2, -HZ + 0.295), (6.4, 3.6, 0.01), E['tv_glow'], collection='DYNAMIC', uv_scale=0)
layout['screens']['tv'] = {'center': [0, 3.2, -HZ + 0.301], 'size': [6.4, 3.6]}
box('TV_console', (0, 0.28, -HZ + 0.55), (6, 0.56, 0.55), M['marble_k'], bevel=0.008, uv_scale=1.0)
box('TV_console_glow', (0, 0.02, -HZ + 0.84), (5.8, 0.02, 0.02), E['warm_strip'], collection='EMISSIVE', uv_scale=0)
colbox(0, -HZ + 0.55, 6, 0.6)
interact('tv', 0, -9, 4.0)
# rug
box('RUG', (0, 0.012, -8.5), (7.5, 0.012, 5.2), M['rug'], uv_scale=1.0)

# pool table
box('POOL_body', (0, 0.55, 4), (2.9, 0.42, 1.6), M['walnut'], bevel=0.04, uv_scale=1.0)
box('POOL_felt', (0, 0.78, 4), (2.54, 0.04, 1.27), M['felt_green'], uv_scale=1.0)
for i, (lx, lz) in enumerate([(-1.2, -0.6), (1.2, -0.6), (-1.2, 0.6), (1.2, 0.6)]):
    box(f'POOL_leg{i}', (lx, 0.2, 4 + lz), (0.16, 0.4, 0.16), M['walnut'], bevel=0.02)
box('POOL_lamp', (0, 2.3, 4), (1.9, 0.12, 0.45), M['brass'], bevel=0.02)
box('POOL_lamp_light', (0, 2.235, 4), (1.8, 0.01, 0.38), emissive('pool_light', WARM, 6.0), collection='EMISSIVE', uv_scale=0)
colbox(0, 4, 2.9, 1.6)
interact('pool', 0, 5.6, 2.4)

# bar
BX0, BX1, BZ = -6.0, 5.0, 13.4
box('BAR_front', ((BX0 + BX1) / 2, 0.52, BZ), (BX1 - BX0, 1.04, 0.62), M['marble_k'], uv_scale=1.4)
box('BAR_trim', ((BX0 + BX1) / 2, 1.06, BZ - 0.32), (BX1 - BX0, 0.04, 0.03), M['brass'])
box('BAR_top', ((BX0 + BX1) / 2, 1.1, BZ - 0.05), (BX1 - BX0 + 0.3, 0.06, 0.9), M['marble_w'], bevel=0.01, uv_scale=1.5)
box('BAR_kick', ((BX0 + BX1) / 2, 0.06, BZ - 0.33), (BX1 - BX0, 0.03, 0.03), E['gold_strip'], collection='EMISSIVE', uv_scale=0)
colbox((BX0 + BX1) / 2, BZ, BX1 - BX0 + 0.3, 1.0)
box('BACKBAR_panel', ((BX0 + BX1) / 2, 2.6, HZ - 0.08), (BX1 - BX0 + 1, 3.6, 0.08), M['black_matte'])
box('BACKBAR_glow', ((BX0 + BX1) / 2, 2.6, HZ - 0.13), (BX1 - BX0 - 0.2, 3.0, 0.01), E['backbar'], collection='EMISSIVE', uv_scale=0)
for i, y in enumerate((1.5, 2.3, 3.1, 3.9)):
    box(f'BACKBAR_shelf{i}', ((BX0 + BX1) / 2, y, HZ - 0.4), (BX1 - BX0 - 0.2, 0.04, 0.5), M['glass'], uv_scale=0)
box('BACKBAR_counter', ((BX0 + BX1) / 2, 0.45, HZ - 0.4), (BX1 - BX0 + 1, 0.9, 0.6), M['walnut'], uv_scale=1.2)
colbox((BX0 + BX1) / 2, HZ - 0.4, BX1 - BX0 + 1, 0.8)
neon_text('SIGN_bar', 'the vault', ((BX0 + BX1) / 2, 5.3, HZ - 0.15), 1.1, E['pink'], ry=math.pi)
interact('bar', (BX0 + BX1) / 2, BZ - 1.4, 3.0)

# ------------------------------------------------------------------ casino (x 8..24, z 0..16)
neon_text('SIGN_casino', 'CASINO', (HX - 0.15, 5.4, 8), 1.2, emissive('neon_gold', (1.0, 0.7, 0.25), 16.0), ry=-math.pi / 2)


def oval_table(name, cx, cz, felt):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=64, radius1=1.0, radius2=1.0, depth=1.0)
    bm.to_mesh(me); bm.free()
    rail = bpy.data.objects.new(name + '_rail', me); bpy.context.scene.collection.objects.link(rail)
    rail.scale = (1.6, 0.95, 0.14); rail.location = V(cx, 0.82, cz); rail.data.materials.append(M['leather_k'])
    bpy.context.view_layer.objects.active = rail
    rail.select_set(True); bpy.ops.object.transform_apply(scale=True); rail.select_set(False)
    link(rail, 'STATIC'); world_uv(rail, 0.6)
    f = cyl(name + '_felt', (cx, 0.9, cz), 1.0, 0.04, felt)
    f.scale = (1.45, 0.82, 1.0)
    cyl(name + '_ped', (cx, 0.38, cz), 0.45, 0.76, M['walnut'], radius2=0.3)
    cyl(name + '_base', (cx, 0.02, cz), 0.7, 0.04, M['brass'])
    colbox(cx, cz, 3.3, 2.0)


for i, (x, z, w, d) in enumerate([(12.5, 6, 4.6, 3.2), (19.5, 6, 4.6, 3.2), (16, 12, 4.6, 2.6)]):
    box(f'CASINO_coffer_{i}', (x, HH - 0.95, z), (w + 0.4, 0.5, d + 0.4), M['black_gloss'])
    box(f'CASINO_coffer_light_{i}', (x, HH - 1.21, z), (w, 0.02, d), emissive('coffer_warm', WARM, 2.2), collection='EMISSIVE', uv_scale=0)
oval_table('POKER', 12.5, 6, M['felt_green'])
oval_table('BLACKJACK', 19.5, 6, M['felt_blue'])
interact('poker', 12.5, 8.2, 2.8); interact('blackjack', 19.5, 8.2, 2.8)
# roulette
box('ROULETTE_body', (16, 0.45, 12), (3.4, 0.9, 1.5), M['walnut'], bevel=0.03, uv_scale=1.0)
box('ROULETTE_layout', (16.35, 0.905, 12), (2.5, 0.01, 1.3), M['felt_green'], uv_scale=1.0)
cyl('ROULETTE_bowl', (14.75, 0.98, 12), 0.6, 0.16, M['walnut'], radius2=0.5)
cyl('ROULETTE_wheel', (14.75, 1.065, 12), 0.48, 0.02, M['black_gloss'])
cyl('ROULETTE_spindle', (14.75, 1.12, 12), 0.05, 0.12, M['brass'], radius2=0.0)
colbox(16, 12, 3.5, 1.6)
interact('roulette', 16, 10.4, 2.8)
# slot machines along east wall
for i in range(8):
    z = 1.8 + i * 1.6
    x = HX - 0.7
    box(f'SLOT_{i}_body', (x, 0.95, z), (0.8, 1.9, 1.0), M['black_gloss'], bevel=0.05, uv_scale=1.0)
    box(f'SLOT_{i}_trim', (x - 0.05, 1.3, z), (0.82, 0.05, 1.02), M['brass'])
    box(f'SLOT_{i}_topper', (x - 0.42, 2.05, z), (0.02, 0.22, 0.8), E['pink_dim'] if i % 2 else E['cyan_dim'], collection='EMISSIVE', uv_scale=0)
    box(f'SLOT_{i}_screen', (x - 0.41, 1.62, z), (0.01, 0.55, 0.75), E['slot_screen'], collection='DYNAMIC', uv_scale=0)
    layout['screens'][f'slot{i}'] = {'center': [x - 0.42, 1.62, z], 'size': [0.75, 0.55], 'ry': -math.pi / 2}
    colbox(x, z, 0.9, 1.05)
    interact('slot', x - 1.3, z, 0.9, idx=i)
# casino chairs (simple tufted stools)
for (cx, cz) in [(12.5, 6), (19.5, 6)]:
    for k in range(5):
        a = math.radians(30 + k * 30)
        x, z = cx + math.cos(a) * 2.15, cz + math.sin(a) * 1.45
        cyl(f'CSTOOL_{cx}_{k}_seat', (x, 0.66, z), 0.25, 0.12, M['leather_k'], segments=32)
        cyl(f'CSTOOL_{cx}_{k}_pole', (x, 0.32, z), 0.035, 0.6, M['brass'], segments=12)
        cyl(f'CSTOOL_{cx}_{k}_base', (x, 0.015, z), 0.24, 0.03, M['brass'], segments=32)

# ------------------------------------------------------------------ arcade (x 8..16, z -16..-2)
neon_text('SIGN_arcade', 'ARCADE', (12, 5.2, -HZ + 0.12), 1.0, E['cyan'])
ARC = ['NEON SNAKE', 'ASTRO RUN', 'TURBO 88', 'GRID WARS']
for i, nm in enumerate(ARC):
    x = 9.4 + i * 1.75
    z = -HZ + 0.75
    box(f'ARC_{i}_body', (x, 0.95, z), (0.85, 1.9, 0.9), M['black_gloss'], bevel=0.03, uv_scale=1.0)
    for s in (-1, 1):
        box(f'ARC_{i}_side{s}', (x + s * 0.43, 0.95, z), (0.012, 1.85, 0.85), E['pink_dim'] if i % 2 else E['cyan_dim'], collection='EMISSIVE', uv_scale=0)
    box(f'ARC_{i}_screen', (x, 1.45, z + 0.455), (0.7, 0.55, 0.01), E['arcade_screen'], collection='DYNAMIC', uv_scale=0)
    box(f'ARC_{i}_marquee', (x, 1.8, z + 0.45), (0.8, 0.18, 0.02), E['white_neon'], collection='EMISSIVE', uv_scale=0)
    box(f'ARC_{i}_panel', (x, 1.0, z + 0.6), (0.85, 0.08, 0.4), M['black_matte'], bevel=0.01)
    layout['screens'][f'arcade{i}'] = {'center': [x, 1.45, z + 0.462], 'size': [0.7, 0.55], 'name': nm}
    colbox(x, z, 0.9, 1.2)
    interact('arcade', x, z + 1.4, 1.0, idx=i, name=nm)
# air hockey
box('AIRHOCKEY_top', (12, 0.85, -8), (2.3, 0.14, 1.25), pbr('airhockey', color=(0.92, 0.93, 0.95), rough=0.15, coat=1), bevel=0.02)
box('AIRHOCKEY_base', (12, 0.39, -8), (2.1, 0.78, 1.05), M['black_gloss'])
box('AIRHOCKEY_line', (12, 0.925, -8), (0.03, 0.005, 1.2), E['pink'], collection='EMISSIVE', uv_scale=0)
colbox(12, -8, 2.3, 1.25)
interact('airhockey', 12, -6.6, 2.0)

# ------------------------------------------------------------------ boardroom (x 16..24, z -16..-4)
RX0, RZ1 = 16.5, -4.5
box('BOARD_floor', (20.25, 0.012, -10.25), (7.5, 0.012, 11.5), M['walnut'], uv_scale=1.5)
box('BOARD_glass_w', (RX0, 1.6, -10.25), (0.02, 3.2, 11.5), M['glass'], uv_scale=0)
box('BOARD_glass_s1', ((RX0 + 19.5) / 2, 1.6, RZ1), (19.5 - RX0, 3.2, 0.02), M['glass'], uv_scale=0)
box('BOARD_glass_s2', ((21.5 + HX) / 2, 1.6, RZ1), (HX - 21.5, 3.2, 0.02), M['glass'], uv_scale=0)
box('BOARD_frame_top', ((RX0 + HX) / 2, 3.22, RZ1), (HX - RX0, 0.05, 0.06), M['steel'])
box('BOARD_frame_w', (RX0, 3.22, -10.25), (0.06, 0.05, 11.5), M['steel'])
box('BOARD_ceiling', ((RX0 + HX) / 2, 3.3, -10.25), (HX - RX0, 0.1, 11.5), M['black_matte'])
box('BOARD_ceiling_light', ((RX0 + HX) / 2 + 0.5, 3.24, -10.5), (1.2, 0.01, 6.0), emissive('board_light', NEUTRAL, 1.5), collection='EMISSIVE', uv_scale=0)
col(RX0 - 0.1, RX0 + 0.1, -HZ, RZ1); col(RX0, 19.5, RZ1 - 0.1, RZ1 + 0.1); col(21.5, HX, RZ1 - 0.1, RZ1 + 0.1)
box('BOARD_table', (20.75, 0.75, -10.5), (1.8, 0.05, 6.4), M['black_gloss'], bevel=0.01)
for z in (-12.9, -8.1):
    box(f'BOARD_leg{z}', (20.75, 0.37, z), (1.4, 0.72, 0.06), M['brass'])
colbox(20.75, -10.5, 1.9, 6.5)
box('BOARD_screen_bezel', (20.75, 1.7, -HZ + 0.06), (3.6, 2.1, 0.05), M['black_gloss'])
box('BOARD_screen', (20.75, 1.7, -HZ + 0.09), (3.4, 1.9, 0.01), E['tv_glow'], collection='DYNAMIC', uv_scale=0)
layout['screens']['board'] = {'center': [20.75, 1.7, -HZ + 0.096], 'size': [3.4, 1.9]}
neon_text('SIGN_board', 'BOARDROOM', (20.5, 2.9, RZ1 + 0.03), 0.28, E['white_neon'])
interact('board', 20.5, -3.6, 1.8)

# ------------------------------------------------------------------ furniture (Poly Haven, CC0)
MODELS = os.path.join(ASSETS, 'models')


def place(model, x, z, ry=0.0, y=0.0, scale=1.0, collection='STATIC', name=None):
    """Import a Poly Haven glTF and place it (three.js coords, ry about up)."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(MODELS, model, f'{model}_2k.gltf'))
    new = [o for o in bpy.data.objects if o not in before]
    root = bpy.data.objects.new(name or f'FURN_{model}', None)
    bpy.context.scene.collection.objects.link(root)
    for o in new:
        if o.parent is None:
            o.parent = root
        link(o, collection)
    link(root, collection)
    root.location = V(x, y, z); root.rotation_euler = (0, 0, ry); root.scale = (scale,) * 3
    for o in new:
        o['furn'] = model
    return root


def bake_parents(objs_root_names=None):
    """Apply parent transforms so every mesh carries its own world matrix (needed before joining/UV packing)."""
    bpy.ops.object.select_all(action='DESELECT')
    for o in bpy.data.objects:
        if o.type == 'MESH' and o.parent:
            mw = o.matrix_world.copy(); o.parent = None; o.matrix_world = mw


# main lounge facing the TV
place('sofa_03', 0, -5.7, math.pi)
place('mid_century_lounge_chair', -3.5, -9.0, math.pi / 2)
place('mid_century_lounge_chair', 3.5, -9.0, -math.pi / 2)
place('coffee_table_round_01', 0, -8.6)
place('side_table_01', -1.85, -5.7, math.pi); place('side_table_01', 1.85, -5.7, math.pi)
place('throw_pillows_01', 0, -5.62, math.pi, y=0.42)
place('Ottoman_01', 0, -11.2)
place('marble_bust_01', 2.6, -15.45, 0.0, y=0.56)
place('potted_plant_02', -6.6, -14.9, 0.0, scale=1.6); place('potted_plant_02', 6.6, -14.9, 1.2, scale=1.6)
colbox(0, -5.7, 2.8, 1.0); colbox(-3.5, -9.0, 1.1, 1.1); colbox(3.5, -9.0, 1.1, 1.1); colbox(0, -8.6, 1.3, 1.3)
colbox(-1.85, -5.7, 0.55, 0.5); colbox(1.85, -5.7, 0.55, 0.5); colbox(0, -11.2, 0.9, 0.65)
colbox(-6.6, -14.9, 1.1, 1.1); colbox(6.6, -14.9, 1.1, 1.1)
interact('sofa', 0, -4.6, 1.6)
# chess corner between garage and lounge
place('sofa_02', -6.7, -1.2, math.pi / 2)
place('modern_coffee_table_02', -4.8, -1.2)
place('chess_set', -4.8, -1.2, 0.3, y=0.37)
place('ArmChair_01', -3.0, -2.1, -math.pi / 2); place('ArmChair_01', -3.0, -0.3, -math.pi / 2)
colbox(-6.7, -1.2, 0.9, 1.9); colbox(-4.8, -1.2, 1.2, 1.2); colbox(-3.0, -2.1, 0.8, 0.85); colbox(-3.0, -0.3, 0.8, 0.85)
interact('chess', -4.8, 0.3, 1.6)
# bar
for i in range(6):
    place('bar_chair_round_01', -5.0 + i * 1.8, BZ - 0.95, 0.0)
for i, x in enumerate((-4.5, -1.5, 1.5, 3.8)):
    place('wine_bottles_01', x, HZ - 0.4, math.pi, y=1.52); place('wine_bottles_01', x - 0.8, HZ - 0.4, math.pi, y=2.32)
place('brass_goblets', -0.5, BZ - 0.05, math.pi, y=1.13); place('brass_goblets', 2.6, BZ - 0.05, math.pi + 0.5, y=1.13)
for i, x in enumerate((-4.5, -1.5, 1.5, 4.5)):
    place('hanging_industrial_lamp', x - 0.5, BZ - 0.1, 0.0, y=3.95)
    cyl(f'LAMP_cable_{i}', (x - 0.5, 5.975, BZ - 0.1), 0.006, 4.05, M['black_matte'], segments=6, uv_scale=0)
# boardroom
for zc in (-12.5, -10.5, -8.5):
    place('modern_arm_chair_01', 19.55, zc, math.pi / 2); place('modern_arm_chair_01', 21.95, zc, -math.pi / 2)
place('potted_plant_02', 23.2, -5.4, 0.4, scale=1.4)
colbox(23.2, -5.4, 1.0, 1.0)
# garage
place('steel_frame_shelves_03', -21.5, -15.5, 0.0); place('steel_frame_shelves_03', -10.5, -15.5, 0.0)
place('mid_century_lounge_chair', -10.0, -3.6, -math.pi / 2 - 0.4); place('side_table_01', -10.0, -2.5, 0.0)
colbox(-21.5, -15.5, 2.4, 0.8); colbox(-10.5, -15.5, 2.4, 0.8); colbox(-10.0, -3.6, 1.1, 1.1); colbox(-10.0, -2.5, 0.55, 0.5)
# casino corners
place('potted_plant_02', 9.0, 15.2, 0.0, scale=1.5); place('potted_plant_02', 23.2, 0.4, 2.0, scale=1.5)
colbox(9.0, 15.2, 1.0, 1.0); colbox(23.2, 0.4, 1.0, 1.0)

# cars: imported for the bake only (shadows + bounce); the browser loads its own copies
CARS_DIR = os.environ.get('VAULT_CARS', '/home/claude/vault/build/carsn')
LINEUP = {'hero': 'bugatti_chiron_profilee', 'n1': 'porsche_911_turbo_s', 'n2': 'aventador', 'n3': 'huracan',
          's1': 'g900', 's2': 'ferrari_488', 's3': 'rolls_ghost'}
for c in layout['cars']:
    c['model'] = LINEUP[c['slot']]
    f = os.path.join(CARS_DIR, c['model'] + '.glb')
    if not os.path.exists(f):
        continue
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=f)
    new = [o for o in bpy.data.objects if o not in before]
    root = bpy.data.objects.new('CAR_' + c['slot'], None); bpy.context.scene.collection.objects.link(root)
    for o in new:
        if o.parent is None:
            o.parent = root
        link(o, 'CARS')
    link(root, 'CARS')
    root.location = V(*c['pos']); root.rotation_euler = (0, 0, c['ry'])

# ------------------------------------------------------------------ bake lighting rig
# Garage: hex grid is emissive; add soft fills so cars and floor read.
for i, z in enumerate((-9, 0, 9)):
    area_light(f'LGT_garage_{i}', (-15.75, 6.5, z), 6.0, 900, COOL, size_y=4.0)
spot_light('LGT_hero', (-16, 7.6, 0), (-16, 0, 0), 2500, angle=50, color=NEUTRAL, radius=0.4)
# Lounge
area_light('LGT_lounge_main', (0, 6.8, -8), 4.0, 650, WARM, size_y=3.0)
area_light('LGT_lounge_mid', (0, 6.8, 3), 5.0, 500, WARM, size_y=4.0)
for i, x in enumerate((-4.5, -1.5, 1.5, 4.5)):
    point_light(f'LGT_bar_pend_{i}', (x - 0.5, 2.6, BZ - 0.1), 120, WARM, radius=0.08)
point_light('LGT_pool', (0, 2.1, 4), 90, WARM, radius=0.3)
# Casino
for i, (x, z) in enumerate([(12.5, 6), (19.5, 6), (16, 12)]):
    spot_light(f'LGT_casino_{i}', (x, 6.6, z), (x, 0.9, z), 2600, angle=45, color=WARM, radius=0.25)
area_light('LGT_slots', (21.5, 5.5, 8), 3.0, 500, (1.0, 0.4, 0.6), size_y=12.0)
# Arcade
area_light('LGT_arcade', (12, 6, -10), 5.0, 450, (0.4, 0.7, 1.0), size_y=8.0)
# Boardroom
area_light('LGT_board', (20.75, 3.15, -10.5), 2.0, 200, NEUTRAL, size_y=6.0)

layout['spawn'] = [-2.0, 0.0, 6.0, -math.pi / 2]
with open(os.path.join(OUT, 'layout.json'), 'w') as f:
    json.dump(layout, f, indent=1)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'vault_stage1.blend'))
print('STAGE1 OK', len(bpy.data.objects), 'objects')
