"""
ALCIÓN HX-4 · REBIRTH — laboratorio, habitáculos, servicios y nodo.

Cada estancia combina el revestimiento común (habitat.lining_module) con módulos de
mobiliario propios. Los puntos de interacción se definen en las propias piezas (`ctl`):
act:<actividad>, locker, hatch:<id>, seat:<n>, scr:<id>, airlock:panel.
Las luminarias específicas se declaran como marcadores LMARK_* (sólo para el horneado).
"""
import math
import random
import bpy
import bmesh
from mathutils import Vector, Matrix
from .lib import group, part, MB, boolean_cut
from .kit import fillet, rrect, prism, loft, arc_panel, cushion, draped_sheet, strap, place, rot_to
from .expansion import mech, ctl
from . import spec as S
from . import habitat as H

PI = math.pi
D = math.radians
FLOOR, WT, R_L, FACE, TOE = H.FLOOR, H.WT, H.R_L, H.FACE, H.TOE


def spot(name, loc, power, s=1, bay='A', angle=70, color=(1.0, 0.92, 0.84)):
    return lmark(name, "spot", loc, power, color, (math.radians(angle), 0.6), (s * D(14), 0, 0), bay)


def lmark(name, kind, loc, power, color=(1.0, 0.86, 0.72), size=(0.2, 0.2), rot=(PI, 0, 0), bay='A'):
    """Marcador de luminaria para el horneado (no se exporta)."""
    ob = bpy.data.objects.new(f"LMARK_{name}", None)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = loc
    ob.rotation_euler = rot
    ob["lkind"] = kind
    ob["power"] = power
    ob["color"] = list(color)
    ob["size"] = list(size)
    ob["bay"] = bay
    return ob


def shell(key, g, x0, x1, sides, lower=True, worktop=True, upper=True, floor=True, backing=True):
    """Revestimiento común de una bahía; `sides` decide qué costados usan el módulo estándar."""
    wall, dark, frame, led, top = MB(f"{key}_wall"), MB(f"{key}_dark"), MB(f"{key}_frame"), MB(f"{key}_led"), MB(f"{key}_top")
    xm = (x0 + x1) / 2
    for s in (1, -1):
        cfg = sides.get(s, {})
        for (a, b) in ((x0, xm), (xm, x1)):
            seg = cfg.get((a, b), cfg.get('all', {}))
            H.lining_module(wall, dark, frame, led, a, b, s, lower=seg.get('lower', lower), worktop=seg.get('worktop', worktop),
                            upper=seg.get('upper', upper), ceiling=True, mb_top=top)
    H.ceiling_channel(led, frame, x0, x1)
    H.rib(frame, x0); H.rib(frame, xm); H.rib(frame, x1)
    if floor:
        H.floor_run(dark, frame, x0, x1)
    if backing:
        H.backing_shell(dark, x0, x1)
    sign = {"B": "bayB", "C": "bayC", "D": "bayD"}[key]
    for s_ in (1, -1):
        H.wall_decal(x0 + 0.25, s_, D(45), 0.26, 0.065, H.SIGN[sign])
    H.P(f"HAB.INT.{key}.SHL.WALL", "Revestimiento", wall, g, key, "Paneles curvos de PPSU con juntas y compartimentos altos.", bevel=0.004)
    H.P(f"HAB.INT.{key}.SHL.LOW", "Zócalos y suelo", dark, g, key, "Frentes de armario grafito y pavimento de caucho.", bevel=0.005)
    H.P(f"HAB.INT.{key}.SHL.FRM", "Nervios y perfiles", frame, g, key, "Nervios grafito, cornisas, raíles de anclaje.", bevel=0.003)
    H.P(f"HAB.INT.{key}.SHL.TOP", "Encimeras", top, g, key, "Encimera de compuesto de lino.", bevel=0.003)
    H.P(f"HAB.INT.{key}.SHL.LED", "Iluminación integrada", led, g, key)


def screen_quad(name, M, w, h, room, parent, ident=None, label="Pantalla"):
    scr = MB(name)
    bm = scr.bm
    uv = bm.loops.layers.uv.new("UVMap")
    corners = [(-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)]
    vv = [bm.verts.new(M @ Vector((0.0, u, v))) for (u, v) in corners]
    f = bm.faces.new(vv)
    f.material_index = scr.mi("R_Screen")
    for loop, (u, v) in zip(f.loops, corners):
        loop[uv].uv = (u / w + 0.5, v / h + 0.5)
    ob = H.P(name, label, scr, parent, room, "Pantalla.", smooth=None)
    if ident:
        ctl(ob, ident)
    return ob


def wall_frame(x, s, a, inward=0.0):
    """Matriz sobre la pared curva en el ángulo a (local +X hacia el interior, +Z hacia arriba de la pared)."""
    p = H.arc_pt(R_L - inward, a, s)
    n = -Vector((0, s * math.cos(a), math.sin(a)))
    up = Vector((0, -s * math.sin(a), math.cos(a)))
    return Matrix.Translation((x, p.y, p.z)) @ rot_to(n, up=up)


# ====================================================================== LABORATORIO (B)
def build_lab(intg):
    key = "B"
    x0, x1 = H.BAYS[key]
    g = group("HAB.INT.B", "Laboratorio (bahía B)", intg, explode=(0, 0, 0.6),
              desc="Laboratorio de ciencias de la vida y observación terrestre: guantera estanca, congelador de muestras a −80 °C, microscopio, cámara de cultivo y dos ventanas de nadir en el suelo.",
              func="Experimentación, observación y conservación de muestras")
    shell(key, g, x0, x1, {1: {'all': {'upper': False}}, -1: {}}, floor=False, backing=False)
    from .exterior import cutter as _cut, LAB_WINDOWS_X as _LW
    bk = MB("b_backing")
    H.backing_shell(bk, x0, x1)
    me = boolean_cut(bk.mesh(smooth=None), [_cut(0.33, 0.8, (xw, 0, -1.9)) for xw in _LW], "b_back_cut")
    ob = part("HAB.INT.B.BCK", "Trasdós del laboratorio", me, g); ob["room"] = key
    # --- suelo con dos ventanas de nadir (pozos con vidrio pisable)
    fl, fr = MB("b_floor"), MB("b_floor_frame")
    H.floor_run(fl, fr, x0, x1)
    from .exterior import cutter, LAB_WINDOWS_X
    me = boolean_cut(fl.mesh(smooth=None, bevel=0.004), [cutter(0.30, 0.5, (xw, 0, FLOOR)) for xw in LAB_WINDOWS_X], "b_floor_cut")
    ob = part("HAB.INT.B.FLR", "Suelo del laboratorio", me, g, desc="Pavimento con dos pozos de observación de nadir.")
    ob["room"] = key
    me2 = boolean_cut(fr.mesh(smooth=None), [cutter(0.30, 0.5, (xw, 0, FLOOR)) for xw in LAB_WINDOWS_X], "b_floorfr_cut")
    ob = part("HAB.INT.B.FLF", "Raíles y subsuelo", me2, g); ob["room"] = key
    wells = MB("b_nadir")
    glass = MB("b_nadir_glass")
    for xw in LAB_WINDOWS_X:
        secs = []
        for z, r in ((FLOOR + 0.005, 0.30), (FLOOR - 0.04, 0.30), (FLOOR - 0.05, 0.27), (-1.95, 0.24), (-2.06, 0.215)):
            secs.append([Vector((xw + r * math.cos(t), r * math.sin(t), z)) for t in [2 * PI * k / 48 for k in range(48)]])
        loft(wells, "R_Frame", secs, closed=True, cap=False)
        # brocal bermellón y anillo de luz
        secs = [[Vector((xw + r * math.cos(t), r * math.sin(t), z)) for t in [2 * PI * k / 48 for k in range(48)]]
                for (r, z) in ((0.33, FLOOR + 0.002), (0.33, FLOOR + 0.012), (0.30, FLOOR + 0.012), (0.30, FLOOR + 0.002))]
        loft(wells, "R_Accent", secs, closed=True, cap=False)
        glass.cyl("R_Glass", 0.295, 0.295, 0.02, 48, center=(xw, 0, FLOOR - 0.012))
    H.P("HAB.INT.B.NAD", "Pozos de observación de nadir", wells, g, key, "Pozos de aluminio anodizado mate con brocal de seguridad.", smooth=40)
    ob = H.P("HAB.INT.B.NADG", "Vidrios pisables de nadir", glass, g, key, "Policarbonato laminado pisable sobre las ventanas ópticas.", smooth=None)
    ctl(ob, "act:photo") if False else None
    # --- babor: pared de instrumentos (racks) + cámara de cultivo + microscopio
    s = 1
    rk = MB("b_racks")
    for (xa, xb) in ((x0 + 0.02, (x0 + x1) / 2 - 0.02), ((x0 + x1) / 2 + 0.02, x1 - 0.02)):
        # paneles de rack siguiendo la pared alta (cajones e instrumentos)
        H.arc(rk, "R_LiningDark", R_L - 0.05, R_L + 0.01, D(1), D(62), xa, xb, s, 10)
        for k, (a0, a1) in enumerate(((D(4), D(20)), (D(22), D(40)), (D(42), D(60)))):
            H.arc(rk, "R_Frame", R_L - 0.065, R_L - 0.045, a0, a1, xa + 0.03, xb - 0.03, s, 6)
            am = (a0 + a1) / 2
            c = H.arc_pt(R_L - 0.07, am, s)
            rk.box("R_Alu", (xb - xa) * 0.3, 0.012, 0.014, center=((xa + xb) / 2, c.y, c.z), rot=Matrix.Rotation(H.mirror_a(am, s) - PI / 2, 4, 'X'))
            for b in range(4):
                cc = H.arc_pt(R_L - 0.068, a0 + D(3), s)
                rk.box("R_Indicator" if (b + k) % 3 else "R_Accent", 0.012, 0.006, 0.006, center=(xa + 0.07 + b * 0.03, cc.y, cc.z))
    H.P("HAB.INT.B.RCK", "Bastidores de instrumentos", rk, g, key, "Dos bastidores de experimentos con cajones normalizados e indicadores de estado.", bevel=0.003)
    # pantallas de laboratorio en el rack
    for k, xc in enumerate((5.2, 6.25)):
        M = wall_frame(xc, s, D(31), inward=0.072)
        screen_quad(f"HAB.INT.B.SCR{k+1}", M, 0.36, 0.22, key, g, None, "Pantalla de experimento")
    # cámara de cultivo (sobre la encimera, mitad de proa)
    pc = MB("b_plants")
    xa, xb = 5.82, 6.62
    pc.box("R_Lining", xb - xa, 0.44, 0.52, center=((xa + xb) / 2, s * 1.66, WT + 0.27))
    pc.box("R_LightPanel", xb - xa - 0.06, 0.30, 0.012, center=((xa + xb) / 2, s * 1.64, WT + 0.505))
    pc.box("R_Black", xb - xa - 0.04, 0.012, 0.46, center=((xa + xb) / 2, s * 1.442, WT + 0.27))
    rnd = random.Random(5)
    for k in range(18):
        px, py = xa + 0.08 + (k % 6) * 0.12, s * (1.56 + (k // 6) * 0.1)
        for leaf in range(4):
            a = rnd.random() * 2 * PI
            pc.sphere("R_Plant", 0.035, 8, 5, center=(px + 0.02 * math.cos(a), py + 0.02 * math.sin(a), WT + 0.07 + rnd.random() * 0.06), scale=(1.4, 0.8, 0.35))
    pc.box("R_Rubber", xb - xa - 0.04, 0.32, 0.03, center=((xa + xb) / 2, s * 1.65, WT + 0.03))
    ob = H.P("HAB.INT.B.VEG", "Cámara de cultivo", pc, g, key, "Cámara de crecimiento con iluminación LED de espectro completo y riego por mecha capilar.", bevel=0.004)
    ctl(ob, "act:plants")
    pg = MB("b_plants_glass")
    pg.box("R_Glass", xb - xa - 0.05, 0.006, 0.44, center=((xa + xb) / 2, s * 1.437, WT + 0.27))
    H.P("HAB.INT.B.VEGG", "Puerta acristalada de la cámara", pg, g, key, smooth=None)
    for i, (x, ss) in enumerate(((5.15, 1), (6.2, 1), (5.6, -1))):
        spot(f"labspot{i}", (x, ss * 1.45, 1.62), 55, ss, 'B', color=(0.96, 0.97, 1.0))
    lmark("veg", "area", ((xa + xb) / 2, s * 1.64, WT + 0.49), 25, (1.0, 0.92, 0.95), (0.7, 0.3), (PI, 0, 0), 'B')
    # microscopio (mitad de popa)
    mc = MB("b_micro")
    cx, cy = 5.15, s * 1.58
    mc.box("R_Lining", 0.30, 0.24, 0.04, center=(cx, cy, WT + 0.02))
    mc.box("R_Lining", 0.08, 0.10, 0.36, center=(cx, cy + s * 0.06, WT + 0.20))
    mc.box("R_Lining", 0.20, 0.10, 0.08, center=(cx - 0.02, cy - s * 0.01, WT + 0.40), rot=Matrix.Rotation(D(-8), 4, 'Y'))
    mc.cyl("R_Black", 0.022, 0.018, 0.12, 16, center=(cx - 0.12, cy - s * 0.01, WT + 0.46), rot=Matrix.Rotation(D(-50), 4, 'Y'))
    mc.cyl("R_Alu", 0.03, 0.03, 0.08, 16, center=(cx, cy - s * 0.01, WT + 0.30))
    mc.box("R_Black", 0.16, 0.14, 0.012, center=(cx, cy - s * 0.01, WT + 0.21))
    H.P("HAB.INT.B.MIC", "Microscopio óptico", mc, g, key, "Microscopio invertido con cámara digital y platina motorizada.", bevel=0.005)
    # congelador de muestras (bajo encimera de babor, frentes con asa bermellón)
    fz = MB("b_freezer")
    for k in range(4):
        xa = x0 + 0.06 + k * 0.5
        fz.box("R_Lining", 0.46, 0.03, 0.42, center=(xa + 0.23, s * (FACE + 0.0), (FLOOR + TOE + WT - 0.05) / 2 + 0.02))
        fz.box("R_Accent", 0.22, 0.03, 0.025, center=(xa + 0.23, s * (FACE - 0.02), WT - 0.12))
        fz.box("R_Indicator", 0.03, 0.006, 0.01, center=(xa + 0.40, s * (FACE - 0.016), WT - 0.2))
    ob = H.P("HAB.INT.B.FRZ", "Congelador de muestras −80 °C", fz, g, key, "Cuatro cajones de congelación con registro de muestras.", bevel=0.004)
    ctl(ob, "act:sample")
    # --- estribor: guantera
    s = -1
    gb = MB("b_glovebox")
    gx0, gx1 = 5.05, 6.15
    gy0, gy1 = 1.30, 1.88
    gb.box("R_Frame", gx1 - gx0, gy1 - gy0, 0.05, center=((gx0 + gx1) / 2, s * (gy0 + gy1) / 2, WT + 0.025))
    gb.box("R_Lining", gx1 - gx0, gy1 - gy0 - 0.1, 0.10, center=((gx0 + gx1) / 2, s * ((gy0 + gy1) / 2 + 0.05), WT + 0.62))
    for xx in (gx0 + 0.02, gx1 - 0.02):
        gb.box("R_Frame", 0.04, gy1 - gy0, 0.58, center=(xx, s * (gy0 + gy1) / 2, WT + 0.33))
    gb.box("R_LightPanel", gx1 - gx0 - 0.1, 0.25, 0.01, center=((gx0 + gx1) / 2, s * 1.62, WT + 0.565))
    for xg in (5.38, 5.82):
        gb.torus("R_Black", 0.075, 0.016, 32, 8, center=(xg, s * (gy0 + 0.02), WT + 0.28), axis='Y')
        secs = []
        for k in range(6):
            yy = gy0 + 0.03 + k * 0.05
            r = 0.065 - k * 0.004
            zz = WT + 0.28 - k * 0.025
            secs.append([Vector((xg + r * math.cos(t), s * yy, zz + r * math.sin(t))) for t in [2 * PI * j / 16 for j in range(16)]])
        loft(gb, "R_Rubber", secs)
    gb.box("R_Black", 0.24, 0.18, 0.12, center=(5.95, s * 1.62, WT + 0.11))
    gb.box("R_Indicator", 0.05, 0.005, 0.02, center=(5.95, s * 1.528, WT + 0.13))
    ob = H.P("HAB.INT.B.GBX", "Guantera estanca", gb, g, key, "Volumen de trabajo de 0,26 m³ con dos puertos de guante, iluminación y esclusa de transferencia.", bevel=0.004)
    ctl(ob, "act:science")
    gg = MB("b_glovebox_glass")
    gg.box("R_Glass", gx1 - gx0 - 0.08, 0.008, 0.52, center=((gx0 + gx1) / 2, s * (gy0 + 0.005), WT + 0.32), rot=None)
    H.P("HAB.INT.B.GBXG", "Frontal transparente de la guantera", gg, g, key, smooth=None)
    lmark("gbx", "area", ((gx0 + gx1) / 2, s * 1.6, WT + 0.55), 18, (0.95, 0.97, 1.0), (0.9, 0.3), (PI, 0, 0), 'B')
    # monitor sobre brazo
    M = wall_frame(5.6, s, D(28), inward=0.09)
    mm = MB("b_mon_arm")
    vs = prism(mm, "R_Black", rrect(0.46, 0.30, 0.012), -0.02, 0.0, 'X')
    place(mm, vs, M)
    H.P("HAB.INT.B.MON", "Monitor de la guantera", mm, g, key, bevel=0.002)
    screen_quad("HAB.INT.B.SCR3", M @ Matrix.Translation((0.001, 0, 0)), 0.43, 0.27, key, g, None, "Monitor de la guantera")
    H.decal(Matrix.Translation((x0 + 0.29, FACE - 0.017, WT - 0.24)) @ rot_to((0, -1, 0), up=(0, 0, 1)), 0.16, 0.04, H.SIGN["crio"])
    H.decal(Matrix.Translation((5.6, -(1.30 - 0.052), WT + 0.635)) @ rot_to((0, 1, 0), up=(0, 0, 1)), 0.26, 0.065, H.SIGN["guantera"])
    for xw in LAB_WINDOWS_X:
        H.decal(Matrix.Translation((xw - 0.42, 0.0, FLOOR + 0.0015)) @ rot_to((0, 0, 1), up=(1, 0, 0)), 0.2, 0.05, H.SIGN["nopisar"])
    H.flush_decals(g, key, "HAB.INT.B.DCL")


# ====================================================================== HABITÁCULOS (C)
def crew_pod(g, key, idx, s, xa, xb, name_tag):
    """Cabina privada: paredes, techo, cortina, saco de dormir con volumen, luz de lectura y objetos personales."""
    y_front = 1.10
    top_a = D(52)
    ztop = H.arc_pt(R_L, top_a, s).z
    yt = abs(H.arc_pt(R_L, top_a, s).y)
    pod = MB(f"c_pod{idx}")
    # paredes laterales (paneles con perfil de pared) y frente superior
    for xx, sign in ((xa, 1), (xb, -1)):
        prof = [(s * y_front, FLOOR), (s * 1.62, FLOOR), (s * 1.62, -0.5), (s * 1.80, 0.25), (s * yt, ztop), (s * y_front, ztop)]
        prism(pod, "R_Lining", fillet(prof, [0, 0, 0.1, 0.2, 0, 0.02], 4), xx - 0.02 * (1 if sign > 0 else 0), xx + 0.02 * (1 if sign < 0 else 0) + (0.02 if sign > 0 else 0), 'X')
    # techo de la cabina (con tira LED interior)
    prism(pod, "R_Lining", fillet([(s * y_front, ztop - 0.03), (s * (yt + 0.05), ztop - 0.03), (s * (yt + 0.05), ztop), (s * y_front, ztop)], 0.008, 2), xa + 0.02, xb - 0.02, 'X')
    # zócalo frontal y marco de la abertura con canto bermellón
    prism(pod, "R_LiningDark", rrect(0.04, 0.32, 0.01, cx=s * (y_front + 0.02), cy=FLOOR + 0.16), xa + 0.02, xb - 0.02, 'X')
    prism(pod, "R_Frame", rrect(0.05, 0.06, 0.01, cx=s * (y_front + 0.02), cy=ztop - 0.06), xa + 0.02, xb - 0.02, 'X')
    prism(pod, "R_Accent", rrect(0.012, 0.012, 0.004, cx=s * (y_front - 0.005), cy=ztop - 0.09), xa + 0.04, xb - 0.04, 'X')
    # pared trasera tapizada (acústica)
    H.arc(pod, "R_Fabric", R_L - 0.03, R_L - 0.005, D(-30), top_a - D(2), xa + 0.04, xb - 0.04, s, 10)
    prism(pod, "R_Fabric", [(s * 1.58, FLOOR + 0.32), (s * 1.62, FLOOR + 0.32), (s * 1.62, -0.48), (s * 1.58, -0.48)], xa + 0.04, xb - 0.04, 'X')
    # suelo interior elevado (cajón de pertenencias)
    prism(pod, "R_LiningDark", rrect(1.62 - y_front - 0.04, 0.32, 0.01, cx=s * (y_front + 1.62) / 2 + s * 0.02, cy=FLOOR + 0.16), xa + 0.02, xb - 0.02, 'X')
    # estante y portátil
    sh_y = s * 1.50
    pod.box("R_Worktop", (xb - xa) * 0.5, 0.20, 0.02, center=(xa + (xb - xa) * 0.3, sh_y, 0.22))
    lap = Matrix.Translation((xa + (xb - xa) * 0.3, sh_y + (-s) * 0.02, 0.235))
    vs = pod.box("R_Frame", 0.30, 0.21, 0.012, center=(0, 0, 0))
    place(pod, vs, lap)
    vs = pod.box("R_Frame", 0.30, 0.01, 0.20, center=(0, s * 0.105, 0.1))
    place(pod, vs, lap @ Matrix.Rotation(D(-15 * s), 4, 'X'))
    vs = pod.box("R_Screen", 0.27, 0.004, 0.17, center=(0, s * 0.098, 0.1))
    place(pod, vs, lap @ Matrix.Rotation(D(-15 * s), 4, 'X'))
    # fotos personales y red de estiba
    rnd = random.Random(idx * 7 + 3)
    for k in range(3):
        a = D(10 + k * 9)
        c = H.arc_pt(R_L - 0.036, a, s)
        pod.box("R_Label", 0.09 + 0.03 * rnd.random(), 0.004, 0.07, center=(xb - 0.18 - k * 0.11, c.y, c.z), rot=Matrix.Rotation(H.mirror_a(a, s) - PI / 2, 4, 'X'))
    pod.box("R_Bag", 0.22, 0.10, 0.16, center=(xb - 0.2, s * 1.52, -0.2))
    # placa con el nombre
    H.decal(Matrix.Translation(((xa + xb) / 2, s * (y_front - 0.0035), ztop - 0.15)) @ rot_to((0, -s, 0), up=(0, 0, 1)), 0.18, 0.045, H.SIGN[f"trip{idx}"])
    H.P(f"HAB.INT.C.Q{idx}", f"Cabina privada {idx} ({name_tag})", pod, g, key,
        "Cabina individual de 1,9 m³ con pared acústica tapizada, estante, portátil, luz de lectura y cortina.", bevel=0.004)
    # saco de dormir (volumen acolchado) sobre la pared trasera
    sb = MB(f"c_bag{idx}")
    M = Matrix.Translation(((xa + xb) / 2, s * 1.62, -0.38)) @ rot_to((0, -s, 0), up=(0, 0, 1))
    vs = cushion(sb, "R_FabricBlue", 0.12, 0.58, 1.45, center=(0, 0, 0), puff=0.03, round_=0.06, sub=4, seed=idx, wrinkle=0.006)
    place(sb, vs, M)
    vs = cushion(sb, "R_FabricBlue", 0.10, 0.36, 0.22, center=(0.03, 0, 0.82), puff=0.02, round_=0.05, sub=3, seed=idx + 20, wrinkle=0.004)
    place(sb, vs, M)
    for zz in (0.35, -0.25):
        vs = strap(sb, "R_Frame", [(0.07, -0.33, zz), (0.075, 0.0, zz + 0.01), (0.07, 0.33, zz)], 0.035, 0.004, up=(1, 0, 0))
        place(sb, vs, M)
    ob = H.P(f"HAB.INT.C.Q{idx}.BAG", "Saco de dormir", sb, g, key, "Saco de dormir sujeto a la pared con cinchas ajustables.", smooth=60)
    ctl(ob, "act:sleep")
    # cortina semiabierta (tejido con pliegues reales)
    ct = MB(f"c_curtain{idx}")
    h = ztop - 0.1 - (FLOOR + 0.34)
    M = Matrix.Translation((xa + 0.16, s * (y_front + 0.01), (ztop - 0.1 + FLOOR + 0.34) / 2)) @ rot_to((1, 0, 0), up=(0, -s, 0))
    draped_sheet(ct, "R_FabricBlue", 0.26, h, 14, 10, M, folds=0.028, seed=idx, thickness=0.004)
    H.P(f"HAB.INT.C.Q{idx}.CRT", "Cortina", ct, g, key, "Cortina de tejido técnico ignífugo recogida.", smooth=60)
    # luz de lectura
    lm = MB(f"c_lamp{idx}")
    lm.cyl("R_Frame", 0.03, 0.03, 0.025, 16, center=(xa + 0.2, s * 1.30, ztop - 0.045))
    lm.cyl("R_LED", 0.024, 0.024, 0.004, 16, center=(xa + 0.2, s * 1.30, ztop - 0.059))
    H.P(f"HAB.INT.C.Q{idx}.LMP", "Luz de lectura", lm, g, key)
    lmark(f"pod{idx}", "area", ((xa + xb) / 2, s * 1.40, ztop - 0.05), 9, (1.0, 0.78, 0.55), (0.6, 0.3), (0, 0, 0), 'C')


def build_quarters(intg):
    key = "C"
    x0, x1 = H.BAYS[key]
    g = group("HAB.INT.C", "Habitáculos (bahía C)", intg, explode=(0, 0, 0.6),
              desc="Cuatro cabinas privadas (dos por costado) con aislamiento acústico, ventilación individual e iluminación regulable.",
              func="Descanso y privacidad de la tripulación")
    shell(key, g, x0, x1, {1: {'all': {'lower': False, 'worktop': False, 'upper': False}}, -1: {'all': {'lower': False, 'worktop': False, 'upper': False}}})
    xm = (x0 + x1) / 2
    names = ["Comandante", "Piloto", "Especialista 1", "Especialista 2"]
    crew_pod(g, key, 1, 1, x0 + 0.04, xm - 0.02, names[0])
    crew_pod(g, key, 2, 1, xm + 0.02, x1 - 0.04, names[1])
    crew_pod(g, key, 3, -1, x0 + 0.04, xm - 0.02, names[2])
    crew_pod(g, key, 4, -1, xm + 0.02, x1 - 0.04, names[3])
    # paños de pared por encima de las cabinas
    up = MB("c_upper")
    for s in (1, -1):
        H.arc(up, "R_Lining", R_L - 0.01, R_L + 0.012, D(53), D(62.5), x0 + 0.004, x1 - 0.004, s, 4)
    H.P("HAB.INT.C.UPR", "Paños superiores", up, g, key, bevel=0.003)
    H.flush_decals(g, key, "HAB.INT.C.DCL")


# ====================================================================== SERVICIOS (D)
def build_services(intg):
    key = "D"
    x0, x1 = H.BAYS[key]
    g = group("HAB.INT.D", "Servicios (bahía D)", intg, explode=(0, 0, 0.6),
              desc="Cocina con dispensador de agua y calentador, mesa de comidas, compartimento de higiene y cicloergómetro.",
              func="Alimentación, higiene, ejercicio y estiba")
    xm = (x0 + x1) / 2
    shell(key, g, x0, x1, {-1: {'all': {'lower': False, 'worktop': False}}})
    H.build_aft_wall(g)
    # --- babor: cocina
    s = 1
    gl = MB("d_galley")
    # dispensador de agua
    gl.box("R_Lining", 0.30, 0.34, 0.46, center=(1.95, s * 1.70, WT + 0.23))
    gl.box("R_Black", 0.22, 0.01, 0.12, center=(1.95, s * 1.528, WT + 0.36))
    for k, col in enumerate(("R_Indicator", "R_Accent", "R_Indicator")):
        gl.cyl(col, 0.012, 0.012, 0.01, 12, center=(1.88 + k * 0.07, s * 1.523, WT + 0.25), axis='Y')
    gl.cyl("R_Steel", 0.01, 0.008, 0.06, 12, center=(1.95, s * 1.56, WT + 0.15))
    ob = H.P("HAB.INT.D.H2O", "Dispensador de agua", gl, g, key, "Dispensador de agua caliente y fría con dosificación en bolsas de bebida.", bevel=0.005)
    ctl(ob, "act:drink")
    fw = MB("d_warmer")
    fw.box("R_Lining", 0.46, 0.34, 0.34, center=(1.42, s * 1.70, WT + 0.17))
    fw.box("R_Frame", 0.40, 0.012, 0.26, center=(1.42, s * 1.528, WT + 0.17))
    fw.box("R_Accent", 0.18, 0.02, 0.02, center=(1.42, s * 1.515, WT + 0.29))
    fw.box("R_Indicator", 0.04, 0.005, 0.015, center=(1.60, s * 1.523, WT + 0.06))
    ob = H.P("HAB.INT.D.OVN", "Calentador de alimentos", fw, g, key, "Calentador por conducción para raciones y bolsas termoestabilizadas.", bevel=0.005)
    ctl(ob, "act:eat")
    # envases y utensilios sobre la encimera
    cn = MB("d_containers")
    rnd = random.Random(11)
    for k in range(7):
        x = 0.78 + k * 0.08
        hgt = 0.08 + rnd.random() * 0.07
        cn.cyl(rnd.choice(["R_Lining", "R_Bag", "R_Steel"]), 0.032, 0.032, hgt, 20, center=(x, s * (1.75 - (k % 2) * 0.09), WT + hgt / 2))
        cn.cyl("R_Frame", 0.034, 0.034, 0.012, 20, center=(x, s * (1.75 - (k % 2) * 0.09), WT + hgt + 0.006))
    for k in range(3):
        cn.box("R_Bag", 0.16, 0.11, 0.03, center=(1.12 + k * 0.05, s * 1.55, WT + 0.015 + k * 0.03), rot=Matrix.Rotation(D(8 * k), 4, 'Z'))
    H.P("HAB.INT.D.CNT", "Envases y raciones", cn, g, key, "Contenedores de raciones, bolsas de bebida y utensilios con sujeción magnética.", bevel=0.003)
    # mesa de comidas central (pedestal) con tablet de planificación
    tb = MB("d_table")
    prism(tb, "R_Worktop", fillet([(-0.42, -0.30), (0.42, -0.30), (0.42, 0.30), (-0.42, 0.30)], 0.12, 5), -0.02, 0.0, 'Z',
          M=Matrix.Translation((1.55, 0.0, -0.08)))
    tb.cyl("R_Frame", 0.05, 0.07, 1.05, 24, center=(1.55, 0, -0.62))
    tb.cyl("R_Frame", 0.20, 0.20, 0.02, 32, center=(1.55, 0, FLOOR + 0.01))
    tb.box("R_Alu", 0.80, 0.02, 0.02, center=(1.55, 0.27, -0.42))
    tb.box("R_Alu", 0.80, 0.02, 0.02, center=(1.55, -0.27, -0.42))
    H.P("HAB.INT.D.TBL", "Mesa de comidas", tb, g, key, "Mesa de pie con barra de sujeción para los pies y anclajes magnéticos.", bevel=0.004)
    tbl = MB("d_tablet")
    tbl.box("R_Black", 0.24, 0.17, 0.008, center=(1.70, 0.08, -0.064), rot=Matrix.Rotation(D(12), 4, 'Z'))
    ob = H.P("HAB.INT.D.TAB", "Tableta del plan del día", tbl, g, key, bevel=0.002)
    ctl(ob, "act:read")
    for i, x in enumerate((1.42, 1.95)):
        spot(f"galspot{i}", (x, 1.45, 1.62), 50, 1, 'D')
    lmark("table", "area", (1.55, 0.0, 1.20), 22, (1.0, 0.86, 0.7), (0.5, 0.4), (0, 0, 0), 'D')
    # --- estribor: compartimento de higiene + cicloergómetro
    s = -1
    hy = MB("d_hygiene")
    hx0, hx1 = 0.66, 1.62
    yf = 1.05
    for xx in (hx0, hx1):
        prism(hy, "R_Lining", [(s * yf, FLOOR), (s * 1.75, FLOOR), (s * 1.75, 0.8), (s * 1.30, 1.45), (s * yf, 1.45)], xx - 0.02, xx + 0.02, 'X')
    prism(hy, "R_Lining", [(s * yf, 1.42), (s * 1.30, 1.42), (s * 1.30, 1.46), (s * yf, 1.46)], hx0, hx1, 'X')
    prism(hy, "R_Frame", rrect(0.04, 1.0, 0.01, cx=s * (yf + 0.01), cy=1.42 - 0.03), hx0, hx0 + 0.05, 'X')
    # puerta corredera (panel con asa bermellón) semiabierta
    hy.box("R_LiningDark", 0.62, 0.03, 2.40, center=(hx0 + 0.34, s * (yf - 0.02), FLOOR + 1.25))
    hy.box("R_Accent", 0.03, 0.04, 0.30, center=(hx0 + 0.62, s * (yf - 0.05), 0.0))
    hy.box("R_Black", 0.14, 0.006, 0.05, center=(hx0 + 0.34, s * (yf - 0.037), 0.45))
    ob = H.P("HAB.INT.D.HYG", "Compartimento de higiene", hy, g, key, "Cabina cerrada con lavado por toallitas, aspiración de residuos y ventilación propia.", bevel=0.004)
    ctl(ob, "act:hygiene")
    lmark("hyg", "area", ((hx0 + hx1) / 2 + 0.2, s * 1.4, 1.38), 10, (0.95, 0.97, 1.0), (0.5, 0.4), (0, 0, 0), 'D')
    # cicloergómetro
    cy = MB("d_cycle")
    cx = 2.15
    cy.box("R_Frame", 0.9, 0.10, 0.06, center=(cx, s * 0.95, FLOOR + 0.04))
    cy.cyl("R_Lining", 0.20, 0.20, 0.10, 32, center=(cx + 0.18, s * 0.95, FLOOR + 0.30), axis='Y')
    cy.cyl("R_Frame", 0.04, 0.04, 0.12, 16, center=(cx + 0.18, s * 0.95, FLOOR + 0.30), axis='Y')
    for d in (-1, 1):
        cy.box("R_Black", 0.14, 0.03, 0.02, center=(cx + 0.18 + d * 0.09, s * (0.95 + d * 0.08), FLOOR + 0.30 + d * 0.08), rot=Matrix.Rotation(D(30 * d), 4, 'Y'))
    cy.beam("R_Frame", (cx - 0.15, s * 0.95, FLOOR + 0.05), (cx - 0.22, s * 0.95, -0.32), 0.05, 0.05)
    cushion(cy, "R_Leather", 0.26, 0.20, 0.06, center=(cx - 0.24, s * 0.95, -0.30), puff=0.008, round_=0.025, sub=2, seed=3)
    cy.beam("R_Frame", (cx + 0.32, s * 0.95, FLOOR + 0.1), (cx + 0.38, s * 0.95, -0.08), 0.05, 0.05)
    cy.box("R_Rubber", 0.05, 0.46, 0.04, center=(cx + 0.38, s * 0.95, -0.06))
    cy.box("R_Black", 0.16, 0.02, 0.11, center=(cx + 0.39, s * 0.95, 0.02), rot=Matrix.Rotation(D(-20), 4, 'Y'))
    ob = H.P("HAB.INT.D.CEV", "Cicloergómetro", cy, g, key, "Cicloergómetro con aislamiento de vibraciones, sujeción de pies y monitor de esfuerzo.", bevel=0.005)
    ctl(ob, "act:exercise")
    # pared de popa: bolsas de estiba
    bg = MB("d_bags")
    rnd = random.Random(4)
    for i in range(3):
        for j in range(4):
            y = -1.05 + j * 0.7 + rnd.random() * 0.05
            z = -0.6 + i * 0.55
            if abs(y) > 1.75 - abs(z) * 0.3:
                continue
            cushion(bg, "R_Bag", 0.26, 0.55, 0.42, center=(0.75, y, z), puff=0.02, round_=0.05, sub=2, seed=i * 7 + j, wrinkle=0.004)
            bg.box("R_Label", 0.006, 0.18, 0.06, center=(0.885, y, z + 0.1))
    H.P("HAB.INT.D.BAG", "Bolsas de estiba", bg, g, key, "Bolsas de Nomex con etiquetas de inventario y cintas de sujeción.", smooth=50)
    H.decal(Matrix.Translation((1.95, 1.526, WT + 0.43)) @ rot_to((0, -1, 0), up=(0, 0, 1)), 0.22, 0.055, H.SIGN["agua"])
    H.decal(Matrix.Translation((0.625, 1.15, 0.85)) @ rot_to((1, 0, 0), up=(0, 0, 1)), 0.30, 0.075, H.SIGN["auxilios"])
    H.decal(Matrix.Translation((0.625, -1.15, 0.85)) @ rot_to((1, 0, 0), up=(0, 0, 1)), 0.30, 0.075, H.SIGN["extintor"])
    H.flush_decals(g, key, "HAB.INT.D.DCL")


# ====================================================================== NODO (N), CÚPULA Y ESCLUSA
def build_node(fwd):
    key = "N"
    g = group("FWD.INT", "Interior del nodo", fwd, explode=(0, 0, 0.8),
              desc="Nodo de proa: estación de trabajo robótica, acceso a la cúpula de observación, escotilla de atraque y pozo de la esclusa.",
              func="Distribución, observación y salida EVA")
    xa, xb = 10.12, 12.12
    RN = H.NODE_RL
    zf = H.NODE_FLOOR
    xc = S.X_CUPOLA
    from .exterior import cutter
    # revestimiento cilíndrico con huecos de cúpula (arriba) y esclusa (abajo)
    lw = MB("n_lining")
    for q in range(8):
        a0, a1 = q * PI / 4 + 0.003, (q + 1) * PI / 4 - 0.003
        arc_panel(lw, "R_Lining", RN, RN + 0.022, a0, a1, xa, xb, 6)
    me = boolean_cut(lw.mesh(smooth=35, bevel=0.003), [cutter(0.64, 1.0, (xc, 0, 1.3)), cutter(0.60, 1.2, (xc, 0, -1.2))], "n_lining_cut")
    ob = part("FWD.INT.LIN", "Revestimiento del nodo", me, g, desc="Paneles curvos del nodo con huecos de cúpula y esclusa."); ob["room"] = key
    bk = MB("n_backing")
    # trasdós como sólidos cerrados por sectores: la booleana exacta sobre superficies abiertas dejaba tapas espurias
    for q in range(8):
        arc_panel(bk, "R_Backing", RN + 0.07, RN + 0.085, q * PI / 4, (q + 1) * PI / 4, xa - 0.05, xb + 0.02, 6)
    me = boolean_cut(bk.mesh(smooth=None), [cutter(0.64, 1.6, (xc, 0, 1.5)), cutter(0.60, 2.0, (xc, 0, -1.4))], "n_back_cut")
    ob = part("FWD.INT.BCK", "Trasdós del nodo", me, g); ob["room"] = key
    # suelo con hueco de la esclusa: dos mitades con muesca semicircular (sin booleanas, que fallaban en silencio)
    fl = MB("n_floor")
    hw = math.sqrt(RN * RN - zf * zf) - 0.02
    rh = 0.60
    for sy in (1, -1):
        pts = [(xa, 0.0), (xc - rh, 0.0)]
        for k in range(1, 24):
            t = PI - PI * k / 24
            pts.append((xc + rh * math.cos(t), sy * rh * math.sin(t)))
        pts += [(xc + rh, 0.0), (xb, 0.0), (xb, sy * hw), (xa, sy * hw)]
        prism(fl, "R_Floor", fillet(pts, 0.0, 1), zf - 0.03, zf, 'Z')
    ob = H.P("FWD.INT.FLR", "Suelo del nodo", fl, g, key, "Pavimento sobre el pozo de la esclusa.", smooth=None)
    # brocales: cúpula (aluminio) y esclusa (bermellón) con pozos cilíndricos
    wl = MB("n_wells")
    def ring(r_in, r_out, z0, z1, mat, seg=64):
        secs = []
        for (r, z) in ((r_out, z0), (r_in, z0), (r_in, z1), (r_out, z1)):
            secs.append([Vector((xc + r * math.cos(2 * PI * k / seg), r * math.sin(2 * PI * k / seg), z)) for k in range(seg)])
        loft(wl, mat, secs, closed=True, cap=False)
    ring(0.60, 0.66, 1.05, 1.38, "R_Lining")
    ring(0.60, 0.70, 1.02, 1.06, "R_Frame")
    ring(0.56, 0.62, -3.15, zf - 0.02, "R_Lining")
    ring(0.56, 0.66, zf - 0.02, zf + 0.012, "R_Accent")
    # escalerilla del pozo de la esclusa
    for k in range(7):
        z = zf - 0.25 - k * 0.33
        wl.beam("R_Alu", (xc + 0.5, -0.18, z), (xc + 0.5, 0.18, z), 0.025, 0.025)
    wl.beam("R_Alu", (xc + 0.52, -0.2, -3.1), (xc + 0.52, -0.2, zf), 0.03, 0.03)
    wl.beam("R_Alu", (xc + 0.52, 0.2, -3.1), (xc + 0.52, 0.2, zf), 0.03, 0.03)
    # asideros de la cúpula
    for k in range(4):
        a = PI / 4 + k * PI / 2
        wl.torus("R_Accent", 0.05, 0.01, 16, 6, center=(xc + 0.58 * math.cos(a), 0.58 * math.sin(a), 1.2), axis='Z')
    # suelo de la esclusa
    wl.cyl("R_Floor", 0.6, 0.6, 0.03, 48, center=(xc, 0, -3.16))
    H.P("FWD.INT.WEL", "Pozos de cúpula y esclusa", wl, g, key, "Brocales, escalerilla y asideros.", smooth=40)
    # mamparos: popa (escotilla hacia el hábitat) y proa (escotilla de atraque cerrada)
    bh = MB("n_bulkheads")
    for x, hole in ((xa, H.HATCH_R), (xb, 0.42)):
        for q in range(4):
            a0, a1 = q * PI / 2, (q + 1) * PI / 2
            pts = [(RN * math.cos(a0 + (a1 - a0) * t / 12), RN * math.sin(a0 + (a1 - a0) * t / 12)) for t in range(13)]
            pts += [(hole * math.cos(a1 - (a1 - a0) * t / 12), hole * math.sin(a1 - (a1 - a0) * t / 12)) for t in range(13)]
            prism(bh, "R_Lining", pts, x - (0.03 if x == xa else 0.0), x + (0.0 if x == xa else 0.03), 'X')
    H.P("FWD.INT.BHD", "Mamparos del nodo", bh, g, key, bevel=0.003)
    # escotilla de atraque (cerrada) y escotilla de popa (abierta, abatida)
    hd = MB("n_dock_hatch")
    hd.cyl("R_Lining", 0.44, 0.44, 0.05, 48, center=(xb - 0.03, 0, 0), axis='X')
    hd.torus("R_Accent", 0.36, 0.014, 48, 8, center=(xb - 0.06, 0, 0), axis='X')
    hd.cyl("R_Black", 0.05, 0.05, 0.03, 24, center=(xb - 0.07, 0, 0.18), axis='X')
    hd.box("R_Steel", 0.04, 0.26, 0.03, center=(xb - 0.08, 0, 0))
    ob = H.P("FWD.INT.HF", "Escotilla de atraque (IDSS)", hd, g, key, "Escotilla de paso de 0,80 m hacia el vehículo atracado; cerrada sin vehículo.", bevel=0.004)
    ctl(ob, "hatch:idss")
    mech(ob, "hinge", (xb - 0.03, 0.44, 0), (0, 0, 1), -1.6, 0.0, 0.0, ident="hatch:idss", speed=0.9)
    # estación de trabajo robótica (babor) con dos pantallas
    s = 1
    rw = MB("n_rws")
    prism(rw, "R_LiningDark", fillet([(s * 0.55, zf), (s * 1.0, zf), (s * 1.0, -0.05), (s * 0.70, 0.02), (s * 0.55, -0.15)], [0, 0, 0.03, 0.04, 0.02], 4), 10.35, 11.55 - 0.65, 'X')
    for k in range(2):
        rw.box("R_Black", 0.36, 0.02, 0.24, center=(10.48 + k * 0.4, s * 0.98, 0.45), rot=Matrix.Rotation(D(-14), 4, 'X'))
    hand_ctl = Matrix.Translation((10.55, s * 0.72, 0.03))
    H.hand_controller(rw, hand_ctl)
    H.hand_controller(rw, Matrix.Translation((10.78, s * 0.72, 0.03)))
    H.P("FWD.INT.RWS", "Estación robótica", rw, g, key, "Puesto de control del brazo robótico con dos pantallas y controladores manuales.", bevel=0.004)
    for k in range(2):
        M = Matrix.Translation((10.48 + k * 0.4, s * 0.968, 0.45)) @ Matrix.Rotation(D(-14), 4, 'X') @ rot_to((0, -1, 0), up=(0, 0, 1))
        screen_quad(f"FWD.INT.RWS.S{k+1}", M, 0.33, 0.21, key, g, f"scr:RWS{k+1}", "Pantalla de la estación robótica")
    # estribor: estiba de bolsas
    bg = MB("n_bags")
    for k in range(3):
        cushion(bg, "R_Bag", 0.5, 0.22, 0.36, center=(10.4 + k * 0.55, -0.98, 0.15), R=Matrix.Rotation(D(-20), 4, 'X'), puff=0.02, round_=0.05, sub=2, seed=40 + k, wrinkle=0.004)
    H.P("FWD.INT.BAG", "Estiba de acceso rápido", bg, g, key, smooth=50)
    # luminarias
    led = MB("n_led")
    for a in (D(60), D(120)):
        arc_panel(led, "R_LED", RN - 0.01, RN - 0.004, a - D(2), a + D(2), xa + 0.1, xb - 0.1, 2)
    H.P("FWD.INT.LGT", "Luminarias del nodo", led, g, key)
    H.decal(Matrix.Translation((xa + 0.002, -0.72, 0.15)) @ rot_to((1, 0, 0), up=(0, 0, 1)), 0.30, 0.075, H.SIGN["esclusa"])
    H.decal(Matrix.Translation((xa + 0.002, 0.72, 0.15)) @ rot_to((1, 0, 0), up=(0, 0, 1)), 0.30, 0.075, H.SIGN["cierre"])
    H.flush_decals(g, key, "FWD.INT.DCL")
    lmark("node1", "area", ((xa + xb) / 2, 0.62, 1.0), 70, (1.0, 0.93, 0.85), (1.6, 0.08), (D(-30), 0, 0), 'N')
    lmark("node2", "area", ((xa + xb) / 2, -0.62, 1.0), 70, (1.0, 0.93, 0.85), (1.6, 0.08), (D(30), 0, 0), 'N')
    lmark("node3", "area", (10.5, 0.0, 1.12), 30, (1.0, 0.93, 0.85), (0.4, 0.4), (0, 0, 0), 'N')
    lmark("alk", "point", (xc, 0, -2.2), 25, (0.95, 0.97, 1.0), (0.1, 0.1), (0, 0, 0), 'N')
    # la esclusa (interior conservado de Beyond Orbit) pertenece a esta estancia
    for o in bpy.data.objects:
        if o.name.startswith("FWD.ALK.INT"):
            o["room"] = key
