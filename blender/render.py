"""
ALCIÓN HX-4 — renderizado.

  blender -b blender/ALCION_HX4_master.blend --python blender/render.py -- \
      --mode preview|final --views hero,side,... --out renders/ [--res 1920x1080] [--samples 128]

mode=preview usa Workbench (inspección geométrica rápida);
mode=final usa Cycles con iluminación física (Sol 5800 K + albedo terrestre +
fondo estelar procedural) y desenfoque de ruido OpenImageDenoise.
"""
import bpy
import sys
import os
import math
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name, default=None):
    if name in argv:
        return argv[argv.index(name) + 1]
    return default


MODE = arg("--mode", "preview")
OUT = arg("--out", "renders")
RES = [int(v) for v in arg("--res", "1600x900").split("x")]
SAMPLES = int(arg("--samples", "96"))
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
os.makedirs(os.path.join(ROOT, OUT), exist_ok=True)
EXPLODE = float(arg("--explode", "0"))

# vistas: nombre -> (posición cámara, objetivo, focal mm, opciones)
VIEWS = {
    "hero":     ((22.0, 30.0, 11.0), (2.0, 0.0, 0.0), 40, {"moon": True}),
    "hero2":    ((-24.0, -20.0, 9.0), (1.5, 0.0, 0.0), 40, {"moon": True}),
    "front34":  ((26.0, 9.0, 6.5), (6.0, 0.0, 0.3), 55, {"moon": True}),
    "aft34":    ((-17.0, 11.0, -6.0), (-3.0, 0.0, 0.0), 45, {}),
    "top":      ((2.0, 0.0, 60.0), (2.0, 0.0, 0.0), 40, {"up": (1, 0, 0)}),
    "side":     ((3.5, 48.0, 0.0), (3.5, 0.0, 0.0), 50, {}),
    "dock":     ((17.5, 3.5, 2.6), (12.5, 0.0, 0.3), 40, {}),
    "cupola":   ((13.5, 4.5, 4.2), (10.8, 0.0, 1.6), 35, {}),
    "engines":  ((-11.0, 3.5, -2.5), (-5.5, 0.0, 0.0), 35, {}),
    "hall":     ((-8.5, 6.0, 1.5), (-5.2, 2.5, 0.0), 35, {}),
    "interior_fwd": ((1.6, 0.0, 0.15), (8.8, 0.0, -0.1), 16, {"interior": True}),
    "interior_aft": ((8.3, -0.3, 0.35), (1.0, 0.25, -0.2), 16, {"interior": True}),
    "interior_cq":  ((3.65, -0.4, 0.5), (3.65, 1.4, -0.3), 14, {"interior": True}),
    "interior_lab": ((4.2, 0.4, 0.6), (6.6, -0.9, -0.6), 16, {"interior": True}),
    "cockpit":      ((6.3, 0.0, 0.55), (8.8, 0.0, -0.35), 18, {"interior": True}),
    "exploded":     ((30.0, 40.0, 20.0), (0.5, 0.0, -2.8), 32, {"fill": 1.6}),
    "exploded_mid": ((28.0, 36.0, 16.0), (1.0, 0.0, -1.5), 32, {"fill": 1.4}),
    "section":      ((3.3, 22.0, 1.2), (3.3, 0.0, 0.0), 42, {"section": True, "fill": 1.2, "lights": True}),
}
sel = arg("--views", "hero,side,top,front34")
views = list(VIEWS.keys()) if sel == "all" else sel.split(",")

scn = bpy.context.scene
scn.render.resolution_x, scn.render.resolution_y = RES
scn.render.resolution_percentage = 100
scn.render.film_transparent = False


def apply_explode(f):
    """Aplica la vista explosionada al modelo (misma ley que la web)."""
    if f <= 0:
        return
    import mathutils
    def stage(d):
        win = {1: (0.0, 0.25), 2: (0.2, 0.5), 3: (0.45, 0.75), 4: (0.7, 0.92)}.get(d, (0.82, 1.0))
        t = (f - win[0]) / (win[1] - win[0])
        t = max(0.0, min(1.0, t))
        return t * t * (3 - 2 * t)
    for ob in bpy.data.objects:
        ex = ob.get("ex")
        if not ex or ob.parent is None:
            continue
        v = mathutils.Vector(ex) * stage(ob.get("depth", 1))
        ob.matrix_basis = mathutils.Matrix.Translation(v) @ ob.matrix_basis


apply_explode(EXPLODE)


def setup_camera(name, pos, tgt, lens, opts):
    cam = bpy.data.objects.get("CAM") or bpy.data.objects.new("CAM", bpy.data.cameras.new("CAM"))
    if cam.name not in scn.collection.objects:
        scn.collection.objects.link(cam)
    cam.location = Vector(pos)
    d = Vector(tgt) - Vector(pos)
    up = opts.get("up", (0, 0, 1))
    cam.rotation_mode = 'QUATERNION'
    cam.rotation_quaternion = d.to_track_quat('-Z', 'Y')
    if "up" in opts:
        import mathutils
        z = -d.normalized()
        x = Vector(up).cross(z).normalized() * -1
        x = z.cross(Vector(up)).normalized() * -1
        y = z.cross(x)
        m = mathutils.Matrix((x, y, z)).transposed()
        cam.rotation_quaternion = m.to_quaternion()
    cam.data.lens = lens
    cam.data.clip_start = 0.02 if opts.get("interior") else 0.1
    cam.data.clip_end = 20000
    if opts.get("section"):
        cam.data.clip_start = Vector(pos).y - 0.02
    scn.camera = cam
    return cam


def hide_for_interior(on):
    """En vistas interiores se ocultan las capas opcionales."""
    for ob in bpy.data.objects:
        if ob.get("optional_layer"):
            ob.hide_render = True


def setup_preview():
    scn.render.engine = 'BLENDER_WORKBENCH'
    sh = scn.display.shading
    sh.light = 'STUDIO'
    sh.color_type = 'MATERIAL'
    sh.show_cavity = True
    sh.cavity_type = 'BOTH'
    sh.show_shadows = True
    sh.show_specular_highlight = True
    scn.display.shading.background_type = 'VIEWPORT' if hasattr(sh, 'background_type') else None
    w = bpy.data.worlds.new("W") if not scn.world else scn.world
    scn.world = w
    w.color = (0.02, 0.025, 0.035)


opts_cur = {}


def setup_final(interior=False):
    scn.render.engine = 'CYCLES'
    c = scn.cycles
    c.device = 'CPU'
    c.samples = SAMPLES
    c.use_denoising = True
    c.denoiser = 'OPENIMAGEDENOISE'
    c.max_bounces = 8
    c.diffuse_bounces = 4
    c.glossy_bounces = 4
    c.transmission_bounces = 6
    c.use_adaptive_sampling = True
    c.adaptive_threshold = 0.02
    scn.render.threads_mode = 'AUTO'
    scn.view_settings.view_transform = 'AgX'
    scn.view_settings.look = 'AgX - Medium High Contrast'
    scn.view_settings.exposure = 0.0 if not interior else 0.6
    # mundo: estrellas procedurales tenues + albedo terrestre azulado inferior
    w = bpy.data.worlds.get("SPACE") or bpy.data.worlds.new("SPACE")
    w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputWorld")
    lp = nt.nodes.new("ShaderNodeLightPath")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    vor = nt.nodes.new("ShaderNodeTexVoronoi")
    vor.feature = 'F1'
    vor.inputs["Scale"].default_value = 260.0
    vor.inputs["Randomness"].default_value = 1.0
    nt.links.new(tc.outputs["Generated"], vor.inputs["Vector"])
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.0
    ramp.color_ramp.elements[0].color = (1, 1, 1, 1)
    ramp.color_ramp.elements[1].position = 0.018
    ramp.color_ramp.elements[1].color = (0, 0, 0, 1)
    nt.links.new(vor.outputs["Distance"], ramp.inputs["Fac"])
    stars = nt.nodes.new("ShaderNodeEmission")
    stars.inputs["Strength"].default_value = 0.6
    nt.links.new(ramp.outputs["Color"], stars.inputs["Color"])
    # gradiente: albedo terrestre (-Z) frente a espacio negro
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["Generated"], sep.inputs["Vector"])
    grad = nt.nodes.new("ShaderNodeMapRange")
    grad.inputs["From Min"].default_value = -0.05
    grad.inputs["From Max"].default_value = -1.0
    nt.links.new(sep.outputs["Z"], grad.inputs["Value"])
    albedo = nt.nodes.new("ShaderNodeEmission")
    albedo.inputs["Color"].default_value = (0.52, 0.52, 0.55, 1)
    albedo.inputs["Strength"].default_value = 0.30
    mix = nt.nodes.new("ShaderNodeMixShader")
    mix.inputs["Fac"].default_value = 0.0
    nt.links.new(stars.outputs["Emission"], mix.inputs[1])
    nt.links.new(stars.outputs["Emission"], mix.inputs[2])
    # las estrellas solo para rayos de cámara; la iluminación usa el albedo
    black = nt.nodes.new("ShaderNodeBackground")
    black.inputs["Color"].default_value = (0, 0, 0, 1)
    mix2 = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(lp.outputs["Is Camera Ray"], mix2.inputs["Fac"])
    lit = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(grad.outputs["Result"], lit.inputs["Fac"])
    nt.links.new(black.outputs["Background"], lit.inputs[1])
    nt.links.new(albedo.outputs["Emission"], lit.inputs[2])
    nt.links.new(lit.outputs["Shader"], mix2.inputs[1])
    nt.links.new(mix.outputs["Shader"], mix2.inputs[2])
    nt.links.new(mix2.outputs["Shader"], out.inputs["Surface"])
    scn.world = w
    # Sol
    sun = bpy.data.objects.get("SUN")
    if not sun:
        sd = bpy.data.lights.new("SUN", 'SUN')
        sun = bpy.data.objects.new("SUN", sd)
        scn.collection.objects.link(sun)
    sun.data.energy = 6.5 if not interior else 3.0
    sun.data.color = (1.0, 0.97, 0.92)
    sun.data.angle = math.radians(0.53)
    sun.rotation_euler = (math.radians(38), math.radians(-28), math.radians(-35))
    # luz de relleno suave (reflejo de la Luna / Tierra)
    fill = bpy.data.objects.get("FILL")
    if not fill:
        fd = bpy.data.lights.new("FILL", 'SUN')
        fill = bpy.data.objects.new("FILL", fd)
        scn.collection.objects.link(fill)
    fill.data.energy = 0.25
    fill.data.color = (0.6, 0.75, 1.0)
    fill.data.angle = math.radians(20)
    fill.rotation_euler = (math.radians(-130), math.radians(10), math.radians(140))
    if interior or opts_cur.get("lights"):
        add_interior_lights()
    fill.data.energy = 0.25 * opts_cur.get("fill", 1.0) * (4 if opts_cur.get("fill") else 1)


def add_interior_lights():
    if bpy.data.objects.get("INT_L1"):
        return

    xs = [0.6 + 2.05 * i for i in range(5)]
    k = 0
    for i in range(4):
        xc = (xs[i] + xs[i + 1]) / 2
        for sy in (1, -1):
            k += 1
            ld = bpy.data.lights.new(f"INT_L{k}", 'AREA')
            ld.shape = 'RECTANGLE'
            ld.size = 1.5
            ld.size_y = 0.08
            ld.energy = 140
            ld.color = (1.0, 0.95, 0.88)
            lo = bpy.data.objects.new(f"INT_L{k}", ld)
            lo.location = (xc, sy * 1.03, 1.03)
            lo.rotation_euler = (sy * math.radians(-45) + 0 * math.pi, 0, 0)
            lo.rotation_euler = (math.radians(180 + sy * 45), 0, 0)
            scn.collection.objects.link(lo)
    for x in (10.6, 11.6):
        ld = bpy.data.lights.new(f"INT_N{x}", 'POINT')
        ld.energy = 60
        ld.shadow_soft_size = 0.3
        lo = bpy.data.objects.new(f"INT_N{x}", ld)
        lo.location = (x, 0, 0.6)
        scn.collection.objects.link(lo)


def setup_moon(pos, tgt, cam, on):
    mo = bpy.data.objects.get("MOON")
    if not on:
        if mo:
            mo.hide_render = True
        return
    if not mo:
        bpy.ops.mesh.primitive_uv_sphere_add(segments=192, ring_count=96, radius=1737.0)
        mo = bpy.context.active_object
        mo.name = "MOON"
        for p_ in mo.data.polygons:
            p_.use_smooth = True
        m = bpy.data.materials.new("M_Moon")
        m.use_nodes = True
        nt = m.node_tree
        b = nt.nodes.get("Principled BSDF")
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = bpy.data.images.load(os.path.join(HERE, "textures", "nasa", "moon_lroc_color_2k.jpg"))
        nt.links.new(tex.outputs["Color"], b.inputs["Base Color"])
        hm = nt.nodes.new("ShaderNodeTexImage")
        hm.image = bpy.data.images.load(os.path.join(HERE, "textures", "nasa", "moon_height.png"))
        hm.image.colorspace_settings.name = 'Non-Color'
        bump = nt.nodes.new("ShaderNodeBump")
        bump.inputs["Strength"].default_value = 0.6
        nt.links.new(hm.outputs["Color"], bump.inputs["Height"])
        nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
        b.inputs["Roughness"].default_value = 1.0
        b.inputs["Specular IOR Level"].default_value = 0.1
        mo.data.materials.append(m)
    mo.hide_render = False
    fwd = (Vector(tgt) - Vector(pos)).normalized()
    up = cam.matrix_world.to_3x3() @ Vector((0, 1, 0))
    D = 5200.0
    mo.location = Vector(tgt) + fwd * D - up * (1737.0 + D * 0.055)
    mo.rotation_euler = (0.3, 0.2, 1.1)


for v in views:
    pos, tgt, lens, opts = VIEWS[v]
    interior = opts.get("interior", False)
    opts_cur = opts
    if MODE == "preview":
        setup_preview()
    else:
        setup_final(interior)
    hide_for_interior(interior)
    cam = setup_camera(v, pos, tgt, lens, opts)
    bpy.context.view_layer.update()
    setup_moon(pos, tgt, cam, MODE == "final" and opts.get("moon", False))
    suffix = "" if EXPLODE <= 0 else f"_x{int(EXPLODE*100)}"
    scn.render.filepath = os.path.join(ROOT, OUT, f"{v}{suffix}_{MODE}.png")
    bpy.ops.render.render(write_still=True)
    print("[render]", scn.render.filepath)
