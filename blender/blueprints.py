"""
ALCIÓN HX-4 — generación de planos a partir del modelo maestro.

  blender -b blender/ALCION_HX4_master.blend --python blender/blueprints.py

Renderiza proyecciones ORTOGRÁFICAS del modelo (Workbench, sombreado plano
y contornos por objeto) y guarda, junto a cada imagen, la proyección en
píxeles de los componentes y estaciones relevantes (blueprints/_raw/*.json).
Las anotaciones se componen después con blender/blueprint_compose.py.
Las secciones usan el plano de recorte de la cámara ortográfica: el corte es
geométricamente exacto respecto al modelo.
"""
import bpy
import os
import sys
import json
import math
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "blueprints", "_raw")
os.makedirs(OUT, exist_ok=True)
sys.path.insert(0, HERE)
import alcion.spec as S

# Compatibilidad directa con módulo `bpy` (p. ej. .venv-bpy/bin/python blender/blueprints.py)
# manteniendo ALCION_HX4_master.blend intacto (solo lectura, nunca se guarda).
if "ALCION" not in bpy.data.objects:
    bpy.ops.wm.open_mainfile(filepath=os.path.join(HERE, "ALCION_HX4_master.blend"))

scn = bpy.context.scene
scn.render.engine = 'BLENDER_WORKBENCH'
sh = scn.display.shading
sh.light = 'FLAT'
sh.color_type = 'SINGLE'
sh.single_color = (1, 1, 1)
sh.show_object_outline = True
sh.object_outline_color = (0, 0, 0)
sh.show_cavity = True
sh.cavity_type = 'SCREEN'
sh.curvature_ridge_factor = 1.0
sh.curvature_valley_factor = 1.0
sh.show_specular_highlight = False
scn.display.render_aa = '8'
w = scn.world or bpy.data.worlds.new("W")
scn.world = w
w.color = (1, 1, 1)
scn.view_settings.view_transform = 'Standard'
scn.render.film_transparent = False

# las capas opcionales (MLI de depósitos) y luces de horneado no se dibujan en planos
for ob in bpy.data.objects:
    if ob.get("optional_layer") or ob.type == 'LIGHT':
        ob.hide_render = True

cam = bpy.data.objects.new("BPCAM", bpy.data.cameras.new("BPCAM"))
scn.collection.objects.link(cam)
cam.data.type = 'ORTHO'
scn.camera = cam


def node_center(name):
    ob = bpy.data.objects.get(name)
    if not ob:
        return None
    pts = []
    for o in [ob] + list(ob.children_recursive):
        if o.type == 'MESH':
            pts += [o.matrix_world @ Vector(c) for c in o.bound_box]
    if not pts:
        return None
    mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return (mn + mx) / 2, mn, mx


def look(direction, up):
    d = Vector(direction).normalized()
    z = -d
    x = Vector(up).cross(z).normalized()
    y = z.cross(x)
    return Matrix((x, y, z)).transposed().to_4x4()


def render_view(name, direction, up, center, ortho, res=(3200, 2000), clip=None, labels=(), explode=0.0, points=()):
    W, H = res
    scn.render.resolution_x, scn.render.resolution_y = W, H
    scn.render.resolution_percentage = 100
    R = look(direction, up)
    dist = 80.0
    cam.matrix_world = Matrix.Translation(Vector(center) - Vector(direction).normalized() * dist) @ R
    cam.data.ortho_scale = ortho
    cam.data.clip_start = clip if clip is not None else 0.1
    cam.data.clip_end = 400
    bpy.context.view_layer.update()
    ppm = W / ortho
    inv = cam.matrix_world.inverted()

    def proj(p):
        q = inv @ Vector(p)
        return [round(W / 2 + q.x * ppm, 1), round(H / 2 - q.y * ppm, 1)]

    meta = {"name": name, "W": W, "H": H, "ppm": ppm, "labels": [], "points": {}}
    for code in labels:
        r = node_center(code)
        if r:
            c, mn, mx = r
            meta["labels"].append({"code": code, "label": bpy.data.objects[code].get("label", code), "xy": proj(c)})
    for key, p in points:
        meta["points"][key] = proj(p)
    scn.render.filepath = os.path.join(OUT, name + ".png")
    bpy.ops.render.render(write_still=True)
    with open(os.path.join(OUT, name + ".json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
    print("[bp]", name)


def apply_explode(f):
    def stage(d):
        win = {1: (0.0, 0.25), 2: (0.2, 0.5), 3: (0.45, 0.75), 4: (0.7, 0.92)}.get(d, (0.82, 1.0))
        t = max(0.0, min(1.0, (f - win[0]) / (win[1] - win[0])))
        return t * t * (3 - 2 * t)
    for ob in bpy.data.objects:
        ex = ob.get("ex")
        if ex and ob.parent is not None:
            ob.matrix_basis = Matrix.Translation(Vector(ex) * stage(ob.get("depth", 1))) @ ob.matrix_basis
    bpy.context.view_layer.update()


MODULES = ["FWD", "HAB", "SVC", "PRP", "PWR", "THR", "COM", "RBT"]
XMID = (S.DOCK_X1 + S.ENGINE_EXIT_X) / 2 + 0.15
X0, X1 = S.ENGINE_EXIT_X, 13.23
SPAN = S.WING_ROOT_Y + S.WING_L
Ztop = S.RAD_ROOT_Z + 0.06 + 3 * (S.RAD_PANEL_H + 0.06)

ext_points = [
    ("bow", (X1, 0, 0)), ("stern", (X0, 0, 0)), ("tipP", (S.SADA_X, SPAN, 0)), ("tipS", (S.SADA_X, -SPAN, 0)),
    ("radTop", (S.RAD_X1, 0, Ztop)), ("radBot", (S.RAD_X1, 0, -Ztop)),
    ("habTop", (4.7, 0, S.R_S)), ("habBot", (4.7, 0, -S.R_S)), ("habP", (4.7, S.R_P, 0)), ("habS", (4.7, -S.R_P, 0)),
    ("x0", (0.0, 0, -S.R_S)), ("xHabA", (S.X_HAB_A, 0, -S.R_S)), ("xHabF", (S.X_HAB_F, 0, -S.R_S)), ("xNodeA", (S.X_NODE_A, 0, -S.R_N)),
    ("xNodeF", (S.X_NODE_F, 0, -S.R_N)), ("xSvc1", (S.SVC_X1, 0, -S.SVC_APOTHEM)), ("xEng", (S.ENGINE_EXIT_X, 0, -0.9)),
    ("wingRoot", (S.SADA_X, S.WING_ROOT_Y, 0)), ("wingRootS", (S.SADA_X, -S.WING_ROOT_Y, 0)),
    ("wingX0", (S.SADA_X - S.WING_W / 2, SPAN, 0)), ("wingX1", (S.SADA_X + S.WING_W / 2, SPAN, 0)),
    ("cupTop", (S.X_CUPOLA, 0, 2.06)),
]
for i in range(S.N_BARRELS + 1):
    x = S.X_HAB_A + S.BARREL_L * i
    ext_points.append((f"frame{i}", (x, 0, -S.R_S)))

LAB_SIDE = ["FWD.DCK", "FWD.CUP", "HAB.MMOD", "HAB.RCS", "HAB.EXT.WIN", "SVC.EXT.RCS", "PRP.ENG", "PRP.SEP", "THR.R1", "COM", "RBT", "SVC.SKN"]
LAB_TOP = ["FWD.DCK", "FWD.CUP", "RBT", "PWR.W1", "PWR.W2", "SVC.SKN", "PRP.ENG", "HAB.MMOD"]
LAB_FRONT = ["FWD.DCK", "FWD.CUP", "PWR.W1", "PWR.W2", "THR.R1", "THR.R2", "COM", "RBT"]

render_view("side", (0, -1, 0), (0, 0, 1), (XMID, 0, 0), 23.5, labels=LAB_SIDE, points=ext_points)
render_view("top", (0, 0, -1), (1, 0, 0), (S.SADA_X + 0.5, 0, 0), 44, labels=LAB_TOP, points=ext_points)
render_view("bottom", (0, 0, 1), (1, 0, 0), (S.SADA_X + 0.5, 0, 0), 44, labels=["HAB.EXT.WIN", "HAB.EXT.GF1", "THR.R2", "COM", "PRP.ENG", "PWR.W1", "PWR.W2"], points=ext_points)
render_view("front", (-1, 0, 0), (0, 0, 1), (0, 0, 0), 44, labels=LAB_FRONT, points=ext_points)
render_view("rear", (1, 0, 0), (0, 0, 1), (0, 0, 0), 44, labels=["PRP.ENG", "PRP.SEP", "PWR.W1", "PWR.W2", "THR.R1", "THR.R2", "COM"], points=ext_points)

# sección longitudinal: plano y = 0 visto desde +Y (se oculta la mitad de babor)
LAB_INT = [
    "HAB.INT.A", "HAB.INT.B", "HAB.INT.C", "HAB.INT.D", "HAB.INT.D.AFT",
    "FWD.INT.RWS", "FWD.DCK", "FWD.CUP", "FWD.ALK.INT.HI",
    "SVC.PRP.XE", "SVC.PRP.BIP", "PRP.ENG", "SVC.AVX.RWA",
]
hidden = []
for code in ("PWR", "THR", "COM"):
    ob = bpy.data.objects.get(code)
    if not ob:
        continue
    for o in [ob] + list(ob.children_recursive):
        if not o.hide_render:
            o.hide_render = True
            hidden.append(o)
render_view("section_long", (0, -1, 0), (0, 0, 1), (XMID, 0, 0), 21.5, clip=80.0, labels=LAB_INT, points=ext_points)

# secciones transversales: plano x = cte visto desde proa (recorte a la distancia de la estación)
for key, x in (("A", 7.75), ("B", 5.72), ("C", 3.67), ("D", 1.62), ("N", 11.05), ("S", -2.9)):
    render_view(f"xsec_{key}", (-1, 0, 0), (0, 0, 1), (x, 0, 0.15), 5.4, res=(1400, 1400), clip=80.0,
                labels=[], points=[("c", (x, 0, 0)), ("top", (x, 0, S.R_S)), ("port", (x, S.R_S, 0))])

# distribución interior: planta cortada en z = 0 vista desde arriba
render_view("layout", (0, 0, -1), (0, 1, 0), (5.6, 0, 0), 15.5, res=(3200, 2000), clip=80.0,
            labels=[
                "HAB.INT.A.ST1", "HAB.INT.A.PNL",
                "HAB.INT.B.GBX", "HAB.INT.B.FRZ", "HAB.INT.B.MIC", "HAB.INT.B.VEG",
                "HAB.INT.C.Q1", "HAB.INT.C.Q2", "HAB.INT.C.Q3", "HAB.INT.C.Q4",
                "HAB.INT.D.CEV", "HAB.INT.D.HYG", "HAB.INT.D.OVN", "HAB.INT.D.TBL", "HAB.INT.D.AFT",
                "FWD.INT.RWS", "FWD.INT.HF",
            ],
            points=[(f"frame{i}", (S.X_HAB_A + S.BARREL_L * i, 0, 0)) for i in range(5)] + [("nodeA", (S.X_NODE_A, 0, 0)), ("nodeF", (S.X_NODE_F, 0, 0)), ("aisleP", (4.7, 1.15, 0)), ("aisleS", (4.7, -1.15, 0))])
for o in hidden:
    o.hide_render = False

# ensamblaje conceptual: explosión parcial en vista isométrica
apply_explode(0.40)
d = Vector((-0.62, -0.55, -0.42))
render_view("assembly", tuple(d), (0, 0, 1), (1.0, 0, -1.5), 50, labels=["FWD", "HAB", "SVC", "PRP", "PWR.W1", "THR.R1", "COM", "RBT"] + ["HAB.MMOD", "HAB.MLI", "HAB.STR", "HAB.INT", "SVC.PRP", "SVC.AVX", "SVC.SKN"], points=[])
print("[bp] listo")
