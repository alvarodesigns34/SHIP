"""
ALCIÓN HX-4 · REBIRTH — horneado de iluminación interior por estancias y exportación
del activo inmersivo de tiempo real.

Uso: python3 blender/bake_rebirth.py [--samples 160] [--rooms A,B] [--res 1024] [--no-bake]

1. Abre el modelo maestro y crea las luces de área que representan las luminarias.
2. Para cada estancia (propiedad `room` de las piezas): segundo canal UV "LM"
   (smart project + empaquetado conjunto de todas las piezas de la estancia).
3. Hornea en Cycles la irradiancia difusa (directa + indirecta, sin albedo) de las
   luminarias interiores. La luz solar y terrestre NO se hornea: la aporta el motor
   en tiempo real con sombras, de modo que no hay contribuciones duplicadas.
4. Guarda web/public/textures/lm/lm_<estancia>.png (sRGB, escala LM_SCALE) y exporta
   export/alcion_interior_rt.glb con TEXCOORD_1 = LM.
"""
import sys, os, math, json, time
import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
argv = sys.argv[1:]


def arg(name, default):
    return argv[argv.index(name) + 1] if name in argv else default


SAMPLES = int(arg('--samples', '160'))
RES = int(arg('--res', '1024'))
ROOMS = arg('--rooms', '')
DO_BAKE = '--no-bake' not in argv
LM_SCALE = 4.0     # valor lineal almacenado = irradiancia / LM_SCALE (sRGB 8 bits)
OUT_TEX = os.path.join(ROOT, 'web', 'public', 'textures', 'lm')
os.makedirs(OUT_TEX, exist_ok=True)

bpy.ops.wm.open_mainfile(filepath=os.path.join(HERE, 'ALCION_HX4_master.blend'))
import alcion.habitat as habitat
lights = habitat.bake_lights()
sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.device = 'CPU'
sc.cycles.samples = SAMPLES
sc.cycles.use_denoising = False
sc.cycles.max_bounces = 6
sc.cycles.diffuse_bounces = 4
sc.cycles.sample_clamp_indirect = 4.0
sc.cycles.sample_clamp_direct = 0.0
sc.render.bake.margin = 12
sc.render.bake.use_clear = True
if not sc.world:
    sc.world = bpy.data.worlds.new('w')
sc.world.use_nodes = True
sc.world.node_tree.nodes['Background'].inputs[1].default_value = 0.0

# piezas por estancia
rooms = {}
for ob in bpy.data.objects:
    if ob.type != 'MESH' or 'room' not in ob:
        continue
    rooms.setdefault(ob['room'], []).append(ob)
wanted = ROOMS.split(',') if ROOMS else sorted(rooms)
NO_LM = {'R_Glass', 'R_LED', 'R_LightPanel', 'R_Screen', 'R_Indicator'}


def lm_eligible(ob):
    mats = {m.name for m in ob.data.materials if m}
    if mats and mats <= NO_LM:
        return False
    d = ob.dimensions
    if max(d) < 0.12:
        return False      # piezas diminutas: iluminación por sonda en el motor
    if ob.data.users > 1:
        return False
    return True


def ensure_lm_uv(obs):
    """UV de lightmap con densidad uniforme: se despliega una malla combinada de la estancia
    (orden de caras conocido) y se copian las UV a cada pieza."""
    import bmesh
    for ob in obs:
        me = ob.data
        if len(me.uv_layers) and me.uv_layers[0].name != 'UVMap':
            me.uv_layers[0].name = 'UVMap'
        if 'UVMap' not in me.uv_layers:
            me.uv_layers.new(name='UVMap')
        if 'LM' not in me.uv_layers:
            me.uv_layers.new(name='LM')
    bm = bmesh.new()
    spans = []
    SKIP = {'R_Backing', 'R_LED', 'R_LightPanel', 'R_Glass', 'R_Screen'}
    for ob in obs:
        n0 = len(bm.faces)
        tmp = ob.data.copy()
        tmp.transform(ob.matrix_world)
        names = [m.name if m else '' for m in ob.data.materials]
        keep = [p.index for p in tmp.polygons if (names[p.material_index] if p.material_index < len(names) else '') not in SKIP]
        tb = bmesh.new()
        tb.from_mesh(tmp)
        tb.faces.ensure_lookup_table()
        kept = set(keep)
        bmesh.ops.delete(tb, geom=[f for f in tb.faces if f.index not in kept], context='FACES_ONLY')
        t2 = bpy.data.meshes.new('_t2')
        tb.to_mesh(t2)
        tb.free()
        bm.from_mesh(t2)
        bpy.data.meshes.remove(t2)
        bpy.data.meshes.remove(tmp)
        spans.append((ob, n0, len(bm.faces), keep))
    comb = bpy.data.meshes.new('_lm_comb')
    bm.to_mesh(comb)
    bm.free()
    co = bpy.data.objects.new('_lm_comb', comb)
    bpy.context.scene.collection.objects.link(co)
    comb.uv_layers.active = comb.uv_layers['LM']
    bpy.ops.object.select_all(action='DESELECT')
    co.select_set(True)
    bpy.context.view_layer.objects.active = co
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.0016, area_weight=0.0, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    src = comb.uv_layers['LM'].data
    # copia por bucles (loops): mismo orden de caras y bucles que el bmesh combinado
    li = 0
    loop_start = [p.loop_start for p in comb.polygons]
    for ob, f0, f1, keep in spans:
        dst = ob.data.uv_layers['LM'].data
        for poly in ob.data.polygons:
            for li in poly.loop_indices:
                dst[li].uv = (0.0004, 0.0004)
        fi = f0
        for pi in keep:
            poly = ob.data.polygons[pi]
            ls = loop_start[fi]
            for j, li in enumerate(poly.loop_indices):
                dst[li].uv = src[ls + j].uv
            fi += 1
        ob.data.uv_layers.active = ob.data.uv_layers['UVMap']
        ob.data.uv_layers['UVMap'].active_render = True
    bpy.data.objects.remove(co)
    bpy.data.meshes.remove(comb)


def bake_room(key, obs, res):
    img = bpy.data.images.new(f'lm_{key}', res, res, alpha=False, float_buffer=True)
    nodes_added = []
    for ob in obs:
        for m in ob.data.materials:
            if not m or not m.use_nodes:
                continue
            nt = m.node_tree
            for n in nt.nodes:
                n.select = False
            tex = nt.nodes.new('ShaderNodeTexImage')
            tex.image = img
            uvn = nt.nodes.new('ShaderNodeUVMap')
            uvn.uv_map = 'LM'
            nt.links.new(uvn.outputs['UV'], tex.inputs['Vector'])
            tex.select = True
            nt.nodes.active = tex
            nodes_added.append((nt, tex, uvn))
    bpy.ops.object.select_all(action='DESELECT')
    for ob in obs:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = obs[0]
    for ob in obs:
        ob.data.uv_layers.active = ob.data.uv_layers['LM']
    t0 = time.time()
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'DIRECT', 'INDIRECT'}, margin=12, use_clear=True)
    print(f'[bake] {key}: {len(obs)} piezas, {res}² en {time.time()-t0:.1f}s', flush=True)
    for ob in obs:
        ob.data.uv_layers.active = ob.data.uv_layers['UVMap']
    px = np.array(img.pixels[:], dtype=np.float32).reshape(res, res, 4)
    for nt, tex, uvn in nodes_added:
        nt.nodes.remove(tex)
        nt.nodes.remove(uvn)
    return img, px


def denoise(px, mask):
    """Dos etapas: (1) mediana 3×3 contra puntos calientes; (2) bilateral 9×9 con tolerancia
    relativa amplia (preserva discontinuidades reales de iluminación entre islas)."""
    rgb = px[..., :3].copy()
    lum = rgb.mean(-1)
    stack = np.stack([np.roll(np.roll(lum, dy, 0), dx, 1) for dy in (-1, 0, 1) for dx in (-1, 0, 1)])
    med = np.median(stack, axis=0)
    hot = lum > med * 1.6 + 0.02
    scale = np.where(hot, med / np.maximum(lum, 1e-6), 1.0)[..., None]
    rgb = rgb * scale
    lum = rgb.mean(-1, keepdims=True)
    acc = np.zeros_like(rgb)
    wsum = np.zeros_like(lum)
    for dy in range(-4, 5):
        for dx in range(-4, 5):
            sh = np.roll(np.roll(rgb, dy, 0), dx, 1)
            shl = np.roll(np.roll(lum, dy, 0), dx, 1)
            ws = math.exp(-(dx * dx + dy * dy) / (2 * 2.2 ** 2))
            rel = (shl - lum) / (0.45 * (lum + shl) * 0.5 + 0.01)
            w = ws * np.exp(-0.5 * rel * rel)
            acc += sh * w
            wsum += w
    return acc / np.maximum(wsum, 1e-6)


def save_png(key, px):
    from PIL import Image
    rgb = np.clip(px[..., :3] / LM_SCALE, 0, 1)
    # lineal -> sRGB
    srgb = np.where(rgb <= 0.0031308, rgb * 12.92, 1.055 * np.power(rgb, 1 / 2.4) - 0.055)
    im = Image.fromarray((np.flipud(srgb) * 255 + 0.5).astype(np.uint8), 'RGB')
    path = os.path.join(OUT_TEX, f'lm_{key}.webp')
    im.save(path, 'WEBP', quality=90, method=6)
    print('[bake] guardado', path, os.path.getsize(path) // 1024, 'KiB', 'max', float(px[..., :3].max()), 'p99', float(np.percentile(px[..., :3], 99)))


report = {}
for key in wanted:
    obs = [o for o in rooms.get(key, []) if lm_eligible(o)]
    if not obs:
        continue
    ensure_lm_uv(obs)
    for o in obs:
        o['lm'] = key
    if DO_BAKE:
        res = RES
        img, px = bake_room(key, obs, res)
        mask = (px[..., 3:4] > 0).astype(np.float32) if px[..., 3].min() < 1 else np.ones_like(px[..., :1])
        px[..., :3] = denoise(px, mask)
        save_png(key, px)
        report[key] = {'objects': len(obs), 'res': res, 'max': float(px[..., :3].max())}

# exportación del activo inmersivo (todas las piezas con 'room')
bpy.ops.object.select_all(action='DESELECT')
for key, obs in rooms.items():
    for o in obs:
        o.select_set(True)
        p = o.parent
        while p is not None:
            p.select_set(True)
            p = p.parent
for o in bpy.data.objects:
    if o.name in ('ALCION', 'HAB', 'FWD'):
        o.select_set(True)
glb = os.path.join(ROOT, 'export', 'alcion_interior_rt.glb')
bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB', use_selection=True, export_extras=True, export_apply=True, export_yup=True,
                          export_cameras=False, export_lights=False, export_texcoords=True, export_normals=True, export_materials='EXPORT',
                          export_image_format='NONE')
print('[bake] exportado', glb, os.path.getsize(glb) // 1024, 'KiB')
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, 'ALCION_HX4_master.blend'), compress=True)
with open(os.path.join(OUT_TEX, 'lm.json'), 'w') as f:
    json.dump({'scale': LM_SCALE, 'rooms': report}, f, indent=1)
