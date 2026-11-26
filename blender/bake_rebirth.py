"""
ALCIÓN HX-4 · REBIRTH — horneado de iluminación interior por estancias y exportación
del activo inmersivo de tiempo real.

Uso: python3 blender/bake_rebirth.py [--samples 96] [--rooms A,B] [--res 2048] [--no-bake]

1. Abre el modelo maestro y crea las luces de área que representan las luminarias.
2. Para cada estancia (propiedad `room` de las piezas): segundo canal UV "LM"
   (smart project + empaquetado conjunto de todas las piezas de la estancia).
3. Hornea en Cycles la irradiancia difusa (directa + indirecta, sin albedo) de las
   luminarias interiores (aislando BVH interior y luces de estancias vecinas para máxima
   velocidad en CPU sin pérdida física). La luz solar y terrestre NO se hornea: la aporta
   el motor en tiempo real con sombras, de modo que no hay contribuciones duplicadas.
4. Aplica filtro antifireflies + OIDN, guarda web/public/textures/lm/lm_<estancia>.webp
   (sRGB, escala LM_SCALE) y exporta export/alcion_interior_rt.glb con TEXCOORD_1 = LM.
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


SAMPLES = int(arg('--samples', '96'))
RES = int(arg('--res', '2048'))
ADAPTIVE = float(arg('--adaptive', '0.035'))
ROOMS = arg('--rooms', '')
DO_BAKE = '--no-bake' not in argv
DO_EXPORT = '--no-export' not in argv
REUSE_UV = '--reuse-uv' in argv
LM_SCALE = 4.0     # valor lineal almacenado = irradiancia / LM_SCALE (sRGB 8 bits)
OUT_TEX = os.path.join(ROOT, 'web', 'public', 'textures', 'lm')
os.makedirs(OUT_TEX, exist_ok=True)

bpy.ops.wm.open_mainfile(filepath=os.path.join(HERE, 'ALCION_HX4_master.blend'))
import alcion.habitat as habitat
# Eliminar luces antiguas si el .blend ya había sido horneado parcialmente
old_coll = bpy.data.collections.get("BAKE_LIGHTS")
if old_coll:
    for o in list(old_coll.objects):
        bpy.data.objects.remove(o, do_unlink=True)
lights = habitat.bake_lights()

sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.device = 'CPU'
sc.cycles.samples = SAMPLES
sc.cycles.use_adaptive_sampling = True
sc.cycles.adaptive_threshold = ADAPTIVE
sc.cycles.adaptive_min_samples = min(8, SAMPLES)
sc.cycles.use_denoising = False
sc.cycles.use_light_tree = True
sc.cycles.max_bounces = 3
sc.cycles.diffuse_bounces = 2
sc.cycles.glossy_bounces = 0
sc.cycles.transmission_bounces = 1
sc.cycles.volume_bounces = 0
sc.cycles.transparent_max_bounces = 2
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
wanted = [r.strip() for r in ROOMS.split(',') if r.strip()] if ROOMS else sorted(rooms)
NO_LM = {'R_Glass', 'R_LED', 'R_LightPanel', 'R_Screen', 'R_Indicator', 'R_Warning', 'R_Alarm'}
# Desactivar MIS de 3000+ triángulos emisivos diminutos: las luces AREA de bake_lights() aportan la irradiancia limpia
for mn in ('R_LED', 'R_LightPanel', 'R_Screen', 'R_Indicator', 'R_Warning', 'R_Alarm'):
    mat = bpy.data.materials.get(mn)
    if mat and hasattr(mat, 'cycles'):
        mat.cycles.emission_sampling = 'NONE'
ADJ = {
    'A': {'A', 'B', 'N'},
    'B': {'A', 'B', 'C'},
    'C': {'B', 'C', 'D'},
    'D': {'C', 'D'},
    'N': {'A', 'N'},
}

# Ocultar geometría exterior lejana y props dinámicos cogibles durante el horneado interior
# (reduce BVH y evita sombras estáticas grabadas bajo objetos que el tripulante puede coger)
hidden_ext = []
for ob in bpy.data.objects:
    if ob.type == 'MESH' and (('room' not in ob and not ob.name.startswith('FWD.CUP')) or 'prop_id' in ob):
        if not ob.hide_render:
            ob.hide_render = True
            hidden_ext.append(ob)


def lm_eligible(ob):
    if 'prop_id' in ob:
        return False      # objeto interactivo cogible: iluminación dinámica por sonda IBL
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
    SKIP = {'R_Backing', 'R_LED', 'R_LightPanel', 'R_Glass', 'R_Screen', 'R_Warning', 'R_Alarm'}
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
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.0045, area_weight=0.0, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    src = comb.uv_layers['LM'].data
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
    # Activar sólo las luces de esta estancia y sus vecinas inmediatas
    active_bays = ADJ.get(key, {key})
    for l_ob in lights:
        l_ob.hide_render = l_ob.get('bay', 'A') not in active_bays
    img = bpy.data.images.new(f'lm_{key}', res, res, alpha=False, float_buffer=True)
    nodes_added = []
    seen_mats = set()
    for ob in obs:
        for m in ob.data.materials:
            if not m or not m.use_nodes or m.name in seen_mats:
                continue
            seen_mats.add(m.name)
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
    # Unir copias temporales en un solo objeto para realizar 1 sola pasada de Cycles y 1 sola dilatación de margen
    tmp_obs = []
    for ob in obs:
        me_cp = ob.data.copy()
        me_cp.transform(ob.matrix_world)
        if 'LM' in me_cp.uv_layers:
            me_cp.uv_layers.active = me_cp.uv_layers['LM']
        to = bpy.data.objects.new(f'_bk_{ob.name}', me_cp)
        bpy.context.scene.collection.objects.link(to)
        tmp_obs.append(to)
        ob.hide_render = True
    bpy.ops.object.select_all(action='DESELECT')
    for to in tmp_obs:
        to.select_set(True)
    bpy.context.view_layer.objects.active = tmp_obs[0]
    if len(tmp_obs) > 1:
        bpy.ops.object.join()
    joined = bpy.context.view_layer.objects.active
    joined.data.uv_layers.active = joined.data.uv_layers['LM']
    t0 = time.time()
    print(f'[bake] iniciando {key}: {len(obs)} piezas (unidas en 1 malla), {res}², {SAMPLES} muestras (luces {sorted(active_bays)})...', flush=True)
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'DIRECT', 'INDIRECT'}, margin=12, use_clear=True)
    dt = time.time() - t0
    print(f'[bake] {key}: {len(obs)} piezas, {res}² en {dt:.1f}s', flush=True)
    joined_me = joined.data
    bpy.data.objects.remove(joined, do_unlink=True)
    bpy.data.meshes.remove(joined_me)
    for ob in obs:
        ob.hide_render = False
        ob.data.uv_layers.active = ob.data.uv_layers['UVMap']
    px = np.array(img.pixels[:], dtype=np.float32).reshape(res, res, 4)
    for nt, tex, uvn in nodes_added:
        nt.nodes.remove(tex)
        nt.nodes.remove(uvn)
    return img, px, dt


def denoise(px, mask, key='x'):
    """Antifireflies (mediana 3×3) + OIDN (nodo Denoise del compositor de Blender) sobre datos HDR."""
    t0 = time.time()
    rgb = px[..., :3].copy()
    lum = rgb.mean(-1)
    stack = np.stack([np.roll(np.roll(lum, dy, 0), dx, 1) for dy in (-1, 0, 1) for dx in (-1, 0, 1)])
    med = np.median(stack, axis=0)
    hot = lum > med * 2.2 + 0.05
    rgb = rgb * np.where(hot, med / np.maximum(lum, 1e-6), 1.0)[..., None]
    H_, W_ = rgb.shape[:2]
    src = bpy.data.images.new(f'_dn_src_{key}', W_, H_, alpha=False, float_buffer=True)
    buf = np.ones((H_, W_, 4), np.float32); buf[..., :3] = rgb
    src.pixels.foreach_set(buf.ravel())
    sc = bpy.context.scene
    prev_engine = sc.render.engine
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = W_, H_, 100
    tree = bpy.data.node_groups.new("dn", "CompositorNodeTree")
    sc.compositing_node_group = tree
    n_in = tree.nodes.new("CompositorNodeImage"); n_in.image = src
    n_dn = tree.nodes.new("CompositorNodeDenoise")
    tree.interface.new_socket("Image", in_out='OUTPUT', socket_type='NodeSocketColor')
    n_out = tree.nodes.new("NodeGroupOutput")
    tree.links.new(n_in.outputs["Image"], n_dn.inputs["Image"])
    tree.links.new(n_dn.outputs["Image"], n_out.inputs[0])
    path = os.path.join(bpy.app.tempdir or '/tmp', f'_dn_{key}.exr')
    sc.render.filepath = path
    sc.render.image_settings.file_format = 'OPEN_EXR'
    sc.render.image_settings.color_depth = '32'
    sc.view_settings.view_transform = 'Standard'
    bpy.ops.render.render(write_still=True)
    out = bpy.data.images.load(path)
    res = np.array(out.pixels[:], dtype=np.float32).reshape(H_, W_, 4)[..., :3]
    sc.render.engine = prev_engine
    sc.compositing_node_group = None
    bpy.data.node_groups.remove(tree)
    bpy.data.images.remove(out); bpy.data.images.remove(src)
    print(f'[bake] OIDN {key} en {time.time()-t0:.1f}s', flush=True)
    if not np.isfinite(res).all() or res.mean() <= 0:
        print('[bake] OIDN falló; se conserva el horneado filtrado', flush=True)
        return rgb
    return res


def save_png(key, px):
    from PIL import Image
    rgb = np.clip(px[..., :3] / LM_SCALE, 0, 1)
    # lineal -> sRGB
    srgb = np.where(rgb <= 0.0031308, rgb * 12.92, 1.055 * np.power(rgb, 1 / 2.4) - 0.055)
    im = Image.fromarray((np.flipud(srgb) * 255 + 0.5).astype(np.uint8), 'RGB')
    path = os.path.join(OUT_TEX, f'lm_{key}.webp')
    im.save(path, 'WEBP', quality=90, method=6)
    print('[bake] guardado', path, os.path.getsize(path) // 1024, 'KiB', 'max', float(px[..., :3].max()), 'p99', float(np.percentile(px[..., :3], 99)), flush=True)


lm_json_path = os.path.join(OUT_TEX, 'lm.json')
report = {}
if os.path.exists(lm_json_path):
    try:
        with open(lm_json_path) as f:
            report = json.load(f).get('rooms', {})
    except Exception:
        report = {}

for key in wanted:
    obs = [o for o in rooms.get(key, []) if lm_eligible(o)]
    if not obs:
        continue
    if not (REUSE_UV and all('LM' in o.data.uv_layers for o in obs)):
        t_uv = time.time()
        ensure_lm_uv(obs)
        print(f'[bake] UV LM {key}: {len(obs)} piezas en {time.time()-t_uv:.1f}s', flush=True)
    for o in obs:
        o['lm'] = key
    if DO_BAKE:
        res = RES
        img, px, dt = bake_room(key, obs, res)
        mask = (px[..., 3:4] > 0).astype(np.float32) if px[..., 3].min() < 1 else np.ones_like(px[..., :1])
        px[..., :3] = denoise(px, mask, key)
        save_png(key, px)
        report[key] = {'objects': len(obs), 'res': res, 'samples': SAMPLES, 'bake_s': round(dt, 1), 'max': float(px[..., :3].max())}

# Restaurar visibilidad de objetos exteriores, props cogibles y luces antes de guardar/exportar
for ob in hidden_ext:
    ob.hide_render = False
for l_ob in lights:
    l_ob.hide_render = False

if DO_EXPORT:
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
    print('[bake] exportado', glb, os.path.getsize(glb) // 1024, 'KiB', flush=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, 'ALCION_HX4_master.blend'), compress=True)
if DO_BAKE:
    with open(lm_json_path, 'w') as f:
        json.dump({'scale': LM_SCALE, 'rooms': report}, f, indent=1)
