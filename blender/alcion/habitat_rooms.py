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
from .kit import (
    fillet, rrect, prism, loft, arc_panel, cushion, draped_sheet, curtain_sheet,
    strap, place, rot_to, beveled_frame, louver_grille, gauge, knob, buckle, bolt_ring, pipe_bundle,
)
from .expansion import mech, ctl
from . import spec as S
from . import habitat as H

PI = math.pi
TAU = math.tau
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


def _ctb_bag(mb, M, dx, dy, dz, body_mat="R_Bag", handle_mat="R_Accent", seed=1, tile=None):
    """Bolsa aeroespacial CTB (Cargo Transfer Bag) en espacio local (+X frente, Y ancho, Z alto):
    cuerpo acolchado, solapa con cremallera, 2 correas con hebillas, asas laterales y porta-etiqueta."""
    vs = []
    # cuerpo principal ligeramente acolchado
    vs += cushion(mb, body_mat, dx, dy, dz, center=(0, 0, 0), puff=0.010, round_=0.026, sub=1, seed=seed, wrinkle=0.004)
    fx = dx / 2 + 0.008
    # solapa frontal en relieve con borde de cremallera
    vs += mb.box(body_mat, 0.014, dy * 0.85, dz * 0.77, center=(fx - 0.002, 0, 0.0))
    vs += beveled_frame(mb, "R_Black", dy * 0.87, dz * 0.79, 0.008, 0.006, M=Matrix.Translation((fx + 0.003, 0, 0)))
    # tirador de cremallera metálico en la esquina superior derecha
    vs += mb.box("R_Alu", 0.012, 0.020, 0.009, center=(fx + 0.008, dy * 0.34, dz * 0.39))
    # 2 correas de compresión verticales (abrazan los laterales sin tapar la etiqueta central)
    for sy in (-1, 1):
        yc = sy * dy * 0.31
        pts = [
            (-dx * 0.32, yc, -dz * 0.51),
            (fx + 0.009, yc, -dz * 0.45),
            (fx + 0.011, yc, 0.0),
            (fx + 0.009, yc, dz * 0.45),
            (-dx * 0.32, yc, dz * 0.51),
        ]
        vs += strap(mb, "R_Frame", pts, 0.024, 0.004, up=(1, 0, 0))
        vs += buckle(mb, Matrix.Translation((fx + 0.013, yc, -dz * 0.14)), w=0.032, h=0.026, t=0.009)
    # 2 asas laterales de sujeción (bermellón o grafito)
    for sy in (-1, 1):
        yh = sy * (dy * 0.48)
        vs += strap(mb, handle_mat, [(fx - 0.03, yh, -0.065), (fx + 0.025, yh + sy * 0.012, -0.04),
                                     (fx + 0.025, yh + sy * 0.012, 0.04), (fx - 0.03, yh, 0.065)], 0.022, 0.005, up=(0, sy, 0))
    # porta-etiqueta enmarcado centrado en la parte alta de la solapa (despejado entre las 2 correas)
    lw = min(0.18, dy * 0.46)
    lh = lw * 0.25
    vs += beveled_frame(mb, "R_Frame", lw + 0.014, lh + 0.014, 0.006, 0.006, M=Matrix.Translation((fx + 0.008, 0, dz * 0.14)))
    place(mb, vs, M)
    H.decal(M @ Matrix.Translation((fx + 0.012, 0, dz * 0.14)), lw, lh, tile)


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

    # --- suelo limpio con dos ventanas de nadir (construcción procedural sin cortes diagonales de booleana)
    from .exterior import LAB_WINDOWS_X
    fl, fr = MB("b_floor"), MB("b_floor_frame")
    half = FACE - 0.005
    xm_bay = (x0 + x1) / 2
    # bandas laterales intactas (fuera de |y| < 0.44)
    for xa_f, xb_f in ((x0 + 0.004, xm_bay - 0.004), (xm_bay + 0.004, x1 - 0.004)):
        for ya, yb in ((-half, -0.46), (0.46, half)):
            prism(fl, "R_Floor", rrect(yb - ya, 0.03, 0.004, cx=(ya + yb) / 2, cy=FLOOR - 0.015), xa_f, xb_f, 'X')
    # pasillo central dividido en 2 placas (popa y proa), cada una con 2 mitades Y rodeando su ventana de nadir
    rh = 0.302
    for (xa_f, xb_f), xw in (((x0 + 0.004, xm_bay - 0.004), LAB_WINDOWS_X[0]), ((xm_bay + 0.004, x1 - 0.004), LAB_WINDOWS_X[1])):
        for sy in (1, -1):
            pts = [(xa_f, 0.0), (xw - rh, 0.0)]
            for k in range(1, 24):
                t = PI - PI * k / 24
                pts.append((xw + rh * math.cos(t), sy * rh * math.sin(t)))
            pts += [(xw + rh, 0.0), (xb_f, 0.0), (xb_f, sy * 0.44), (xa_f, sy * 0.44)]
            prism(fl, "R_Floor", pts, FLOOR - 0.03, FLOOR, 'Z')
    # raíles metálicos laterales del pasillo y subsuelo perforado limpiamente
    for y in (-0.45, 0.45):
        prism(fr, "R_Alu", [(y - 0.011, FLOOR - 0.03), (y + 0.011, FLOOR - 0.03), (y + 0.011, FLOOR + 0.001),
                            (y + 0.006, FLOOR + 0.004), (y - 0.006, FLOOR + 0.004), (y - 0.011, FLOOR + 0.001)], x0, x1, 'X')
    for sy in (1, -1):
        pts = [(x0, 0.0)]
        for xw in LAB_WINDOWS_X:
            pts.append((xw - rh, 0.0))
            for k in range(1, 16):
                t = PI - PI * k / 16
                pts.append((xw + rh * math.cos(t), sy * rh * math.sin(t)))
            pts.append((xw + rh, 0.0))
        pts += [(x1, 0.0), (x1, sy * 1.6), (x0, sy * 1.6)]
        prism(fr, "R_Backing", pts, FLOOR - 0.06, FLOOR - 0.05, 'Z')
    H.P("HAB.INT.B.FLR", "Suelo del laboratorio", fl, g, key, "Pavimento con dos pozos de observación de nadir.", smooth=None)
    H.P("HAB.INT.B.FLF", "Raíles y subsuelo", fr, g, key, smooth=None)

    wells = MB("b_nadir")
    glass = MB("b_nadir_glass")
    for xw in LAB_WINDOWS_X:
        secs = []
        for z, r in ((FLOOR + 0.005, 0.30), (FLOOR - 0.04, 0.30), (FLOOR - 0.05, 0.27), (-1.95, 0.24), (-2.06, 0.215)):
            secs.append([Vector((xw + r * math.cos(t), r * math.sin(t), z)) for t in [2 * PI * k / 48 for k in range(48)]])
        loft(wells, "R_Frame", secs, closed=True, cap=False)
        # brocal bermellón con aro de aluminio exterior y 12 tornillos
        secs = [[Vector((xw + r * math.cos(t), r * math.sin(t), z)) for t in [2 * PI * k / 48 for k in range(48)]]
                for (r, z) in ((0.33, FLOOR + 0.002), (0.33, FLOOR + 0.012), (0.30, FLOOR + 0.012), (0.30, FLOOR + 0.002))]
        loft(wells, "R_Accent", secs, closed=True, cap=False)
        bolt_ring(wells, "R_Alu", (xw, 0, FLOOR + 0.012), (0, 0, 1), 0.315, 12, r_head=0.005, h=0.003)
        glass.cyl("R_Glass", 0.295, 0.295, 0.02, 48, center=(xw, 0, FLOOR - 0.012))
    H.P("HAB.INT.B.NAD", "Pozos de observación de nadir", wells, g, key, "Pozos de aluminio anodizado mate con brocal de seguridad.", smooth=40)
    H.P("HAB.INT.B.NADG", "Vidrios pisables de nadir", glass, g, key, "Policarbonato laminado pisable sobre las ventanas ópticas.", smooth=None)

    # --- babor: pared de instrumentos (racks) + cámara de cultivo abierta + microscopio detallado + congelador
    s = 1
    rk = MB("b_racks")
    for mod_i, (xa, xb) in enumerate(((x0 + 0.02, xm_bay - 0.02), (xm_bay + 0.02, x1 - 0.02))):
        H.arc(rk, "R_LiningDark", R_L - 0.05, R_L + 0.01, D(1), D(62), xa, xb, s, 10)
        for k, (a0, a1) in enumerate(((D(4), D(20)), (D(22), D(40)), (D(42), D(60)))):
            H.arc(rk, "R_Frame", R_L - 0.065, R_L - 0.045, a0, a1, xa + 0.03, xb - 0.03, s, 6)
            am = (a0 + a1) / 2
            # tirador empotrado en aluminio (en k==1 se coloca abajo para no cruzar las pantallas)
            a_hdl = a0 + D(2.8) if k == 1 else am
            c = H.arc_pt(R_L - 0.072, a_hdl, s)
            rk.box("R_Alu", (xb - xa) * 0.32, 0.012, 0.014, center=((xa + xb) / 2, c.y, c.z),
                   rot=Matrix.Rotation(H.mirror_a(a_hdl, s) - PI / 2, 4, 'X'))
            # cierres de cuarto de vuelta en las esquinas del panel de rack
            for dx_c in (xa + 0.06, xb - 0.06):
                cc = H.arc_pt(R_L - 0.068, a1 - D(2.5), s)
                rk.cyl("R_Steel", 0.008, 0.008, 0.008, 8, center=(dx_c, cc.y, cc.z), rot=Matrix.Rotation(H.mirror_a(a1 - D(2.5), s), 4, 'X'))
            # indicadores LED de estado y conectores en la fila inferior
            for b in range(4):
                cc = H.arc_pt(R_L - 0.068, a0 + D(3), s)
                mat_i = "R_Indicator" if (b + k) % 3 else ("R_Warning" if k == 1 else "R_Accent")
                rk.box(mat_i, 0.014, 0.006, 0.008, center=(xa + 0.07 + b * 0.032, cc.y, cc.z))
            if k == 2:
                # rejilla de ventilación ranurada en el compartimento superior del rack
                Mv = wall_frame((xa + xb) / 2, s, am, inward=0.068)
                louver_grille(rk, "R_Frame", "R_Alu", 0.34, 0.11, depth=0.010, slats=4, M=Mv)
            if k == 0:
                # conectores umbilicales de datos/potencia en el rack bajo
                for ck in range(3):
                    cp = H.arc_pt(R_L - 0.070, a0 + D(6), s)
                    rk.cyl("R_Alu", 0.013, 0.013, 0.016, 10, center=(xb - 0.12 - ck * 0.042, cp.y, cp.z),
                           rot=Matrix.Rotation(H.mirror_a(a0 + D(6), s), 4, 'X'))
    # mazo de cableado y conductos gestionados a lo largo de la junta central entre los dos bastidores
    pts_r1, pts_r2 = [], []
    for st in range(9):
        ang = D(4 + st * 7)
        p1 = H.arc_pt(R_L - 0.042, ang, s)
        p2 = H.arc_pt(R_L - 0.042, ang, s)
        pts_r1.append((xm_bay - 0.012, p1.y, p1.z))
        pts_r2.append((xm_bay + 0.012, p2.y, p2.z))
    pipe_bundle(rk, ["R_Frame", "R_Steel"], [pts_r1, pts_r2], [0.009, 0.007], clamps=4, clamp_mat="R_Alu")
    # anclajes de pies (foot restraints) junto a la encimera de ambos costados (fuera del pasillo central |y| < 0.55)
    for sf in (1, -1):
        for fx in (5.20, 6.20):
            rk.tube("R_Alu", [(fx - 0.14, sf * 1.24, FLOOR + 0.02), (fx - 0.14, sf * 1.15, FLOOR + 0.055),
                              (fx + 0.14, sf * 1.15, FLOOR + 0.055), (fx + 0.14, sf * 1.24, FLOOR + 0.02)], 0.011, 8, round_r=0.02)
            rk.cyl("R_Accent", 0.013, 0.013, 0.10, 10, center=(fx, sf * 1.15, FLOOR + 0.055), axis='X')
    H.P("HAB.INT.B.RCK", "Bastidores de instrumentos", rk, g, key, "Dos bastidores de experimentos con cajones, ventilación, cableado y anclajes de pies.", bevel=0.003)

    # pantallas de laboratorio en el rack
    for k, xc in enumerate((5.2, 6.25)):
        M = wall_frame(xc, s, D(31), inward=0.072)
        screen_quad(f"HAB.INT.B.SCR{k+1}", M, 0.36, 0.22, key, g, None, "Pantalla de experimento")

    # --- cámara de cultivo (corregida: SIN frente negro opaco -> marco de aluminio + vidrio + plantas reales!)
    pc = MB("b_plants")
    xa, xb = 5.82, 6.64
    xm_p = (xa + xb) / 2
    pw = xb - xa
    # carcasa abierta por el frente (y_front = 1.44, y_back = 1.88, z = WT..WT+0.54)
    pc.box("R_Lining", pw, 0.026, 0.54, center=(xm_p, s * 1.87, WT + 0.27))                  # pared trasera
    pc.box("R_Alu", pw - 0.05, 0.008, 0.46, center=(xm_p, s * 1.852, WT + 0.27))            # fondo interior reflectante
    pc.box("R_Lining", pw, 0.44, 0.042, center=(xm_p, s * 1.66, WT + 0.52))                 # techo
    pc.box("R_Frame", pw, 0.44, 0.055, center=(xm_p, s * 1.66, WT + 0.0275))                # depósito hidropónico base
    for xx in (xa + 0.016, xb - 0.016):
        pc.box("R_Lining", 0.032, 0.44, 0.50, center=(xx, s * 1.66, WT + 0.27))             # costados
    # doble barra LED de crecimiento en el techo interior
    for dy_l in (1.56, 1.72):
        pc.box("R_LightPanel", pw - 0.10, 0.055, 0.012, center=(xm_p, s * dy_l, WT + 0.492))
        pc.box("R_Alu", pw - 0.08, 0.070, 0.008, center=(xm_p, s * dy_l, WT + 0.498))
    # panel estrecho de control hidropónico integrado en el pilar derecho (x = xb - 0.02)
    pc.box("R_Black", 0.055, 0.012, 0.22, center=(xb - 0.045, s * 1.445, WT + 0.36))
    for ik, mat_i in enumerate(("R_Indicator", "R_Indicator", "R_Warning")):
        pc.box(mat_i, 0.016, 0.008, 0.010, center=(xb - 0.045, s * 1.438, WT + 0.42 - ik * 0.028))
    # marco frontal hueco de aluminio con 2 bisagras a la izquierda y tirador bermellón a la derecha
    M_pf = Matrix.Translation((xm_p - 0.025, s * 1.442, WT + 0.275)) @ rot_to((0, -s, 0), up=(0, 0, 1))
    beveled_frame(pc, "R_Alu", pw - 0.09, 0.44, 0.022, 0.020, M=M_pf)
    for zh in (WT + 0.14, WT + 0.40):
        pc.cyl("R_Steel", 0.008, 0.008, 0.036, 10, center=(xa + 0.020, s * 1.434, zh), axis='Z')
    pc.tube("R_Accent", [(xb - 0.085, s * 1.436, WT + 0.22), (xb - 0.085, s * 1.406, WT + 0.23),
                         (xb - 0.085, s * 1.406, WT + 0.33), (xb - 0.085, s * 1.436, WT + 0.34)], 0.008, 8, round_r=0.015)
    # 2 bandejas hidropónicas reales con cápsulas de sustrato, tubos de riego y plantas con tallos y hojas diferenciadas
    rnd = random.Random(15)
    for row_i, py_row in enumerate((1.56, 1.72)):
        z_tray = WT + 0.068 + row_i * 0.055  # segunda fila ligeramente escalonada para máxima visibilidad!
        pc.box("R_Frame", pw - 0.14, 0.135, 0.028, center=(xm_p - 0.02, s * py_row, z_tray))
        pc.box("R_Alu", pw - 0.15, 0.125, 0.006, center=(xm_p - 0.02, s * py_row, z_tray + 0.016))
        # tubo de riego capilar a lo largo de la bandeja
        pc.cyl("R_Alu", 0.006, 0.006, pw - 0.14, 8, center=(xm_p - 0.02, s * (py_row + 0.055), z_tray + 0.024), axis='X')
        for col_i in range(5):
            px = xa + 0.10 + col_i * 0.132
            py = s * py_row
            # cápsula de sustrato
            pc.cyl("R_Rubber", 0.028, 0.024, 0.026, 10, center=(px, py, z_tray + 0.025))
            # tallo principal + 5 hojas lanceoladas orientadas radialmente
            h_stem = 0.065 + rnd.random() * 0.045
            pc.tube("R_PlantDark", [(px, py, z_tray + 0.032), (px + (rnd.random() - 0.5) * 0.015, py, z_tray + 0.032 + h_stem)], 0.005, 6)
            for lf in range(5):
                ang = lf * (2 * PI / 5) + rnd.random() * 0.5
                tilt = D(28 + rnd.random() * 28)
                lz = z_tray + 0.055 + (lf / 5.0) * h_stem * 0.85
                lr = 0.024 + rnd.random() * 0.012
                lx = px + math.cos(ang) * lr
                ly = py + math.sin(ang) * lr
                Rlf = Matrix.Rotation(ang, 4, 'Z') @ Matrix.Rotation(tilt, 4, 'Y')
                mat_lf = "R_Plant" if lf % 2 == 0 else "R_PlantDark"
                vs_l = pc.sphere(mat_lf, 0.026, 8, 5, center=(0, 0, 0), scale=(1.55, 0.62, 0.18))
                place(pc, vs_l, Matrix.Translation((lx, ly, lz)) @ Rlf)
    ob = H.P("HAB.INT.B.VEG", "Cámara de cultivo", pc, g, key, "Cámara hidropónica acristalada con iluminación LED, bandejas escalonadas y cultivos de hoja.", bevel=0.003)
    ctl(ob, "act:plants")
    pg = MB("b_plants_glass")
    pg.box("R_Glass", pw - 0.13, 0.006, 0.395, center=(xm_p - 0.025, s * 1.440, WT + 0.275))
    H.P("HAB.INT.B.VEGG", "Puerta acristalada de la cámara", pg, g, key, smooth=None)
    H.decal(Matrix.Translation((xm_p - 0.025, s * 1.430, WT + 0.518)) @ rot_to((0, -s, 0), up=(0, 0, 1)), 0.26, 0.045, H.SIGN["cultivo"])
    for i, (x, ss) in enumerate(((5.15, 1), (6.2, 1), (5.6, -1))):
        spot(f"labspot{i}", (x, ss * 1.45, 1.62), 55, ss, 'B', color=(0.96, 0.97, 1.0))
    lmark("veg", "area", (xm_p, s * 1.64, WT + 0.47), 34, (0.98, 0.94, 0.96), (0.68, 0.28), (PI, 0, 0), 'B')

    # --- microscopio óptico detallado (mitad de popa, cx=5.15, cy=1.58)
    mc = MB("b_micro")
    cx, cy = 5.15, s * 1.58
    # base pesada biselada + patas de goma + condensador iluminado
    base_p = fillet([(-0.14, -0.11), (0.14, -0.11), (0.16, 0.10), (-0.16, 0.10)], 0.022, 3)
    prism(mc, "R_Lining", base_p, WT + 0.008, WT + 0.042, 'Z', M=Matrix.Translation((cx, cy, 0)))
    prism(mc, "R_Frame", fillet([(-0.15, -0.12), (0.15, -0.12), (0.17, 0.11), (-0.17, 0.11)], 0.022, 3),
          WT, WT + 0.012, 'Z', M=Matrix.Translation((cx, cy, 0)))
    mc.cyl("R_Frame", 0.036, 0.032, 0.030, 16, center=(cx, cy - s * 0.02, WT + 0.052))
    mc.cyl("R_LightPanel", 0.024, 0.024, 0.006, 16, center=(cx, cy - s * 0.02, WT + 0.068))
    # brazo curvado en C ergonómico + ruedas coaxiales macro/micro de enfoque
    arm_pts = [
        (cx, cy + s * 0.075, WT + 0.04),
        (cx, cy + s * 0.105, WT + 0.16),
        (cx, cy + s * 0.085, WT + 0.30),
        (cx, cy + s * 0.015, WT + 0.39),
        (cx, cy - s * 0.025, WT + 0.385),
    ]
    mc.tube("R_Lining", arm_pts, 0.032, 10, round_r=0.05)
    for dx_w in (-0.048, 0.048):
        mc.cyl("R_Frame", 0.028, 0.028, 0.018, 16, center=(cx + dx_w, cy + s * 0.088, WT + 0.13), axis='X')
        mc.cyl("R_Alu", 0.016, 0.016, 0.014, 14, center=(cx + dx_w * 1.25, cy + s * 0.088, WT + 0.13), axis='X')
    # platina XY mecanizada con pinzas y portaobjetos de vidrio
    mc.box("R_Black", 0.165, 0.145, 0.014, center=(cx, cy - s * 0.015, WT + 0.195))
    mc.box("R_Alu", 0.076, 0.026, 0.003, center=(cx, cy - s * 0.015, WT + 0.204))  # portaobjetos
    for dx_cl in (-0.045, 0.045):
        mc.box("R_Steel", 0.010, 0.055, 0.004, center=(cx + dx_cl, cy - s * 0.010, WT + 0.207))
    mc.cyl("R_Steel", 0.008, 0.008, 0.055, 10, center=(cx + 0.088, cy - s * 0.045, WT + 0.168))  # mando XY
    # revólver giratorio con 3 objetivos de distintas longitudes
    mc.cyl("R_Frame", 0.036, 0.030, 0.020, 16, center=(cx, cy - s * 0.018, WT + 0.305))
    for ok, (ang, olen, ring_m) in enumerate(((0.0, 0.058, "R_Accent"), (2.1, 0.046, "R_Indicator"), (4.2, 0.036, "R_Alu"))):
        ox = cx + 0.018 * math.cos(ang)
        oy = cy - s * 0.018 + 0.018 * math.sin(ang)
        mc.cyl("R_Alu", 0.010, 0.008, olen, 12, center=(ox, oy, WT + 0.295 - olen / 2))
        mc.cyl(ring_m, 0.011, 0.011, 0.006, 12, center=(ox, oy, WT + 0.295 - olen * 0.72))
    # cabezal binocular inclinado hacia el pasillo (-Y) con 2 oculares + tubo fotográfico superior
    mc.box("R_Lining", 0.095, 0.105, 0.068, center=(cx, cy - s * 0.025, WT + 0.388))
    for dx_e in (-0.032, 0.032):
        Re = Matrix.Rotation(D(s * 42), 4, 'X')
        mc.cyl("R_Frame", 0.015, 0.013, 0.115, 14, center=(cx + dx_e, cy - s * 0.095, WT + 0.435), rot=Re)
        mc.cyl("R_Rubber", 0.018, 0.016, 0.018, 14, center=(cx + dx_e, cy - s * 0.135, WT + 0.478), rot=Re)
    mc.cyl("R_Black", 0.022, 0.022, 0.055, 14, center=(cx, cy - s * 0.015, WT + 0.448))  # cámara CCD trinocular
    H.P("HAB.INT.B.MIC", "Microscopio óptico", mc, g, key, "Microscopio binocular con platina XY, revólver de tres objetivos y cámara digital.", bevel=0.003)

    # --- congelador de muestras −80 °C (bajo encimera de babor)
    fz = MB("b_freezer")
    for k in range(4):
        xa_f = x0 + 0.06 + k * 0.5
        xm_f = xa_f + 0.23
        zc_f = (FLOOR + TOE + WT - 0.05) / 2 + 0.02
        fz.box("R_Lining", 0.46, 0.03, 0.44, center=(xm_f, s * (FACE + 0.0), zc_f))
        beveled_frame(fz, "R_Frame", 0.44, 0.42, 0.012, 0.012, M=Matrix.Translation((xm_f, s * (FACE - 0.015), zc_f)) @ rot_to((0, -s, 0), up=(0, 0, 1)))
        # asa térmica bermellón sobre separadores de acero
        fz.box("R_Accent", 0.24, 0.022, 0.022, center=(xm_f, s * (FACE - 0.032), WT - 0.12))
        for dx_h in (-0.10, 0.10):
            fz.box("R_Steel", 0.016, 0.026, 0.018, center=(xm_f + dx_h, s * (FACE - 0.018), WT - 0.12))
        # visor de temperatura y LED
        fz.box("R_Black", 0.068, 0.008, 0.024, center=(xa_f + 0.39, s * (FACE - 0.016), WT - 0.20))
        fz.box("R_Indicator", 0.036, 0.006, 0.010, center=(xa_f + 0.39, s * (FACE - 0.019), WT - 0.20))
        # bisagras en el costado izquierdo
        for zh in (zc_f - 0.14, zc_f + 0.14):
            fz.cyl("R_Alu", 0.007, 0.007, 0.032, 8, center=(xa_f + 0.008, s * (FACE - 0.016), zh), axis='Z')
    ob = H.P("HAB.INT.B.FRZ", "Congelador de muestras −80 °C", fz, g, key, "Cuatro cajones de congelación criogénica con registro y tiradores térmicos.", bevel=0.003)
    ctl(ob, "act:sample")

    # --- estribor: guantera sellada profesional (marco biselado, vidrio inclinado, bridas de bayoneta, esclusa lateral, interior equipado)
    s = -1
    gb = MB("b_glovebox")
    gx0, gx1 = 4.98, 6.08
    gy0, gy1 = 1.30, 1.88
    gxm = (gx0 + gx1) / 2
    gw = gx1 - gx0
    # base y superficie interior de trabajo en acero inoxidable
    gb.box("R_Frame", gw, gy1 - gy0, 0.055, center=(gxm, s * (gy0 + gy1) / 2, WT + 0.0275))
    gb.box("R_Steel", gw - 0.08, gy1 - gy0 - 0.08, 0.010, center=(gxm, s * (gy0 + gy1) / 2, WT + 0.058))
    # techo y corona superior biselada con luminaria integrada
    gb.box("R_Lining", gw, gy1 - gy0 - 0.11, 0.11, center=(gxm, s * ((gy0 + 0.11 + gy1) / 2), WT + 0.625))
    gb.box("R_LightPanel", gw - 0.12, 0.22, 0.012, center=(gxm, s * 1.64, WT + 0.568))
    # pared trasera interior reflectante con 2 boquillas de gas N2
    gb.box("R_Lining", gw - 0.04, 0.024, 0.56, center=(gxm, s * (gy1 - 0.012), WT + 0.33))
    for xn in (5.25, 5.80):
        gb.cyl("R_Steel", 0.010, 0.008, 0.06, 10, center=(xn, s * (gy1 - 0.045), WT + 0.44), axis='Y')
    # paredes laterales inclinadas (perfil trapezoidal ergonómico: y=1.30 abajo -> y=1.42 arriba)
    side_prof = fillet([(s * gy0, WT + 0.05), (s * gy1, WT + 0.05), (s * gy1, WT + 0.58), (s * (gy0 + 0.12), WT + 0.58)], 0.018, 3)
    for xx in (gx0, gx1 - 0.042):
        prism(gb, "R_Frame", side_prof, xx, xx + 0.042, 'X')
    # marco frontal inclinado hueco (13° de inclinación) que encuadra el vidrio transparente
    tilt_rad = math.atan2(0.12, 0.53)
    y_mid_g = s * (gy0 + 0.06)
    z_mid_g = WT + 0.315
    n_glass = Vector((0, math.cos(tilt_rad), math.sin(tilt_rad))).normalized()  # apunta hacia +Y (pasillo) y +Z
    up_glass = Vector((0, -math.sin(tilt_rad), math.cos(tilt_rad))).normalized()
    M_gf = Matrix.Translation((gxm, y_mid_g, z_mid_g)) @ rot_to(n_glass, up=up_glass)
    beveled_frame(gb, "R_Alu", gw - 0.06, 0.54, 0.026, 0.022, M=M_gf)

    # 2 puertos de guante con brida de bayoneta mecanizada (R_Alu + R_Steel + R_Rubber + 8 tornillos) y guantes esculpidos
    for xg in (5.34, 5.74):
        p_port = Vector((xg, s * (gy0 + 0.052), WT + 0.275))
        M_port = Matrix.Translation(p_port) @ rot_to(n_glass, up=up_glass)
        vs = []
        vs += mb_cyl_al(gb, 0.095, 0.092, 0.018)
        vs += gb.torus("R_Steel", 0.082, 0.010, 28, 8, center=(0.012, 0, 0), axis='X')
        vs += gb.torus("R_Rubber", 0.070, 0.012, 24, 8, center=(0.016, 0, 0), axis='X')
        vs += bolt_ring(gb, "R_Steel", (0.012, 0, 0), (1, 0, 0), 0.088, 8, r_head=0.0045, h=0.004)
        place(gb, vs, M_port)
        # guante esculpido hacia el interior (manga plisada + muñeca + mano/pulgar)
        secs_gl = []
        gl_prof = [
            (0.00, 0.068, 0.068, 0.00),
            (-0.06, 0.062, 0.058, -0.018),
            (-0.13, 0.058, 0.052, -0.040),
            (-0.20, 0.048, 0.042, -0.068),
            (-0.26, 0.036, 0.030, -0.090),   # muñeca
            (-0.32, 0.046, 0.022, -0.105),   # palma plana
            (-0.38, 0.038, 0.014, -0.112),   # dedos
        ]
        for yy_off, rx, rz, zz_off in gl_prof:
            ring = [Vector((xg + rx * math.cos(t), s * (gy0 + 0.06 - yy_off), WT + 0.275 + zz_off + rz * math.sin(t)))
                    for t in [2 * PI * j / 14 for j in range(14)]]
            secs_gl.append(ring)
        loft(gb, "R_Rubber", secs_gl)
        # pulgar sugerido hacia dentro
        gb.cyl("R_Rubber", 0.012, 0.009, 0.055, 10, center=(xg + (0.042 if xg < gxm else -0.042), s * (gy0 + 0.39), WT + 0.168),
               rot=Matrix.Rotation(D(55), 4, 'X') @ Matrix.Rotation(D(25 if xg < gxm else -25), 4, 'Z'))

    # esclusa lateral de transferencia (antechamber) en el extremo de proa (x = 6.08..6.42)
    ax0, ax1 = gx1, 6.42
    axm = (ax0 + ax1) / 2
    ay, az = s * 1.62, WT + 0.24
    gb.cyl("R_Alu", 0.145, 0.145, ax1 - ax0, 24, center=(axm, ay, az), axis='X')
    gb.cyl("R_Frame", 0.158, 0.158, 0.024, 24, center=(ax0 + 0.012, ay, az), axis='X')
    gb.cyl("R_Frame", 0.158, 0.158, 0.028, 24, center=(ax1 - 0.014, ay, az), axis='X')
    bolt_ring(gb, "R_Steel", (ax1, ay, az), (1, 0, 0), 0.132, 10, r_head=0.005, h=0.004)
    # tirador bermellón de la compuerta de esclusa + manómetro superior + válvula de purga
    gb.tube("R_Accent", [(ax1 + 0.004, ay - 0.05, az), (ax1 + 0.036, ay - 0.04, az),
                         (ax1 + 0.036, ay + 0.04, az), (ax1 + 0.004, ay + 0.05, az)], 0.008, 8, round_r=0.012)
    gauge(gb, (axm, ay + 0.11, az + 0.12), (0, 1, 0.5), radius=0.032)
    knob(gb, "R_Accent", "R_Alu", (axm + 0.07, ay + 0.13, az + 0.04), (0, 1, 0), r=0.012, h=0.016)

    # interior científico equipado: gradilla de viales, soporte de pipetas y placa iluminada de muestras
    gb.box("R_Alu", 0.18, 0.08, 0.055, center=(5.24, s * 1.68, WT + 0.090))
    for vk in range(6):
        vx = 5.175 + vk * 0.026
        gb.cyl("R_Glass", 0.008, 0.008, 0.085, 8, center=(vx, s * 1.68, WT + 0.115))
        gb.cyl("R_Accent" if vk % 2 == 0 else "R_Indicator", 0.009, 0.009, 0.014, 8, center=(vx, s * 1.68, WT + 0.160))
    # placa iluminada de análisis de muestras en el centro
    gb.box("R_Frame", 0.22, 0.16, 0.022, center=(5.56, s * 1.66, WT + 0.072))
    gb.box("R_LightPanel", 0.16, 0.11, 0.006, center=(5.56, s * 1.66, WT + 0.085))
    gb.box("R_Glass", 0.06, 0.025, 0.004, center=(5.55, s * 1.66, WT + 0.091))
    # soporte de micropipetas y analizador a la derecha
    gb.box("R_Black", 0.16, 0.13, 0.10, center=(5.90, s * 1.68, WT + 0.112))
    gb.box("R_Indicator", 0.048, 0.006, 0.020, center=(5.90, s * 1.612, WT + 0.135))
    for pk in range(2):
        gb.cyl("R_Alu", 0.005, 0.003, 0.16, 8, center=(5.76 + pk * 0.028, s * 1.72, WT + 0.155), rot=Matrix.Rotation(D(14), 4, 'X'))
        gb.cyl("R_Accent", 0.007, 0.007, 0.025, 8, center=(5.76 + pk * 0.028, s * 1.74, WT + 0.228), rot=Matrix.Rotation(D(14), 4, 'X'))

    # panel de control lateral integrado en el extremo de popa (x = 4.92..5.02)
    gb.box("R_Frame", 0.09, 0.14, 0.36, center=(gx0 - 0.045, s * 1.44, WT + 0.30))
    gb.box("R_Black", 0.07, 0.010, 0.12, center=(gx0 - 0.045, s * 1.368, WT + 0.39))
    for bk, mat_b in enumerate(("R_Indicator", "R_Indicator", "R_Warning", "R_Alarm")):
        gb.box(mat_b, 0.014, 0.008, 0.012, center=(gx0 - 0.065 + (bk % 2) * 0.036, s * 1.364, WT + 0.28 - (bk // 2) * 0.028))
    knob(gb, "R_Frame", "R_Alu", (gx0 - 0.045, s * 1.368, WT + 0.18), (0, 1, 0), r=0.015, h=0.014)

    ob = H.P("HAB.INT.B.GBX", "Guantera estanca", gb, g, key,
             "Guantera científica con vidrio inclinado, bridas de bayoneta, esclusa de transferencia, viales y panel de control.", bevel=None)
    ctl(ob, "act:science")
    gg = MB("b_glovebox_glass")
    vs_gg = gg.box("R_Glass", 0.008, gw - 0.11, 0.49, center=(0, 0, 0))
    place(gg, vs_gg, M_gf)
    H.P("HAB.INT.B.GBXG", "Frontal transparente de la guantera", gg, g, key, smooth=None)
    lmark("gbx", "area", (gxm, s * 1.62, WT + 0.55), 26, (0.95, 0.97, 1.0), (0.85, 0.28), (PI, 0, 0), 'B')

    # monitor sobre brazo articulado
    M = wall_frame(5.55, s, D(28), inward=0.09)
    mm = MB("b_mon_arm")
    vs = prism(mm, "R_Black", rrect(0.46, 0.30, 0.012), -0.02, 0.0, 'X')
    vs += beveled_frame(mm, "R_Frame", 0.466, 0.306, 0.008, 0.014, M=Matrix.Translation((-0.008, 0, 0)))
    vs += mm.cyl("R_Alu", 0.016, 0.016, 0.08, 12, center=(-0.05, 0, 0), axis='X')
    place(mm, vs, M)
    H.P("HAB.INT.B.MON", "Monitor de la guantera", mm, g, key, bevel=0.002)
    screen_quad("HAB.INT.B.SCR3", M @ Matrix.Translation((0.001, 0, 0)), 0.43, 0.27, key, g, None, "Monitor de la guantera")

    H.decal(Matrix.Translation((x0 + 0.29, FACE - 0.017, WT - 0.24)) @ rot_to((0, -1, 0), up=(0, 0, 1)), 0.16, 0.04, H.SIGN["crio"])
    H.decal(Matrix.Translation((gxm, -(gy0 + 0.108), WT + 0.635)) @ rot_to((0, 1, 0), up=(0, 0, 1)), 0.28, 0.062, H.SIGN["guantera"])
    for xw in LAB_WINDOWS_X:
        H.decal(Matrix.Translation((xw - 0.42, 0.0, FLOOR + 0.0015)) @ rot_to((0, 0, 1), up=(1, 0, 0)), 0.20, 0.05, H.SIGN["nopisar"])
    H.flush_decals(g, key, "HAB.INT.B.DCL")


def mb_cyl_al(mb, r1, r2, d):
    """Brida anular hueca de aluminio (puerto de guante abierto hacia el interior)."""
    rin = max(0.01, min(r1, r2) - 0.022)
    seg = 24
    secs = []
    for x, r in ((0.0, r1), (0.0, rin), (d, rin), (d, r2), (0.0, r1)):
        secs.append([Vector((x, r * math.cos(TAU * k / seg), r * math.sin(TAU * k / seg))) for k in range(seg)])
    return loft(mb, "R_Alu", secs, closed=True, cap=False)


# ====================================================================== HABITÁCULOS (C)
def crew_pod(g, key, idx, s, xa, xb, name_tag):
    """Cabina privada: paredes, techo, cortina recogida con riel/anillas, saco de dormir acolchado
    en baffles con cremallera/hebillas, consola personal real, bolsillos organizadores y lámpara articulada."""
    y_front = 1.10
    top_a = D(52)
    ztop = H.arc_pt(R_L, top_a, s).z
    yt = abs(H.arc_pt(R_L, top_a, s).y)
    pod = MB(f"c_pod{idx}")
    # paredes laterales (paneles con perfil de pared)
    for xx, sign in ((xa, 1), (xb, -1)):
        prof = [(s * y_front, FLOOR), (s * 1.62, FLOOR), (s * 1.62, -0.5), (s * 1.80, 0.25), (s * yt, ztop), (s * y_front, ztop)]
        prism(pod, "R_Lining", fillet(prof, [0, 0, 0.1, 0.2, 0, 0.02], 4),
              xx - 0.02 * (1 if sign > 0 else 0), xx + 0.02 * (1 if sign < 0 else 0) + (0.02 if sign > 0 else 0), 'X')
    # techo de la cabina
    prism(pod, "R_Lining", fillet([(s * y_front, ztop - 0.03), (s * (yt + 0.05), ztop - 0.03), (s * (yt + 0.05), ztop), (s * y_front, ztop)], 0.008, 2), xa + 0.02, xb - 0.02, 'X')
    # zócalo frontal (cajón bajo) y dintel con marco grafito y filo bermellón
    prism(pod, "R_LiningDark", rrect(0.04, 0.32, 0.01, cx=s * (y_front + 0.02), cy=FLOOR + 0.16), xa + 0.02, xb - 0.02, 'X')
    prism(pod, "R_Frame", rrect(0.05, 0.06, 0.01, cx=s * (y_front + 0.02), cy=ztop - 0.06), xa + 0.02, xb - 0.02, 'X')
    prism(pod, "R_Accent", rrect(0.012, 0.012, 0.004, cx=s * (y_front - 0.005), cy=ztop - 0.09), xa + 0.04, xb - 0.04, 'X')
    # pared trasera tapizada acústica
    H.arc(pod, "R_Fabric", R_L - 0.03, R_L - 0.005, D(-30), top_a - D(2), xa + 0.04, xb - 0.04, s, 10)
    prism(pod, "R_Fabric", [(s * 1.58, FLOOR + 0.32), (s * 1.62, FLOOR + 0.32), (s * 1.62, -0.48), (s * 1.58, -0.48)], xa + 0.04, xb - 0.04, 'X')
    # suelo interior elevado (cajón de pertenencias con tirador)
    prism(pod, "R_LiningDark", rrect(1.62 - y_front - 0.04, 0.32, 0.01, cx=s * (y_front + 1.62) / 2 + s * 0.02, cy=FLOOR + 0.16), xa + 0.02, xb - 0.02, 'X')
    pod.box("R_Alu", 0.22, 0.010, 0.016, center=((xa + xb) / 2, s * (y_front - 0.002), FLOOR + 0.26))

    # --- Equipamiento personal en pared lateral interior (xb - 0.022), SIN atravesar el saco de dormir!
    x_side = xb - 0.024
    # consola personal empotrada (pantalla, interruptores, 2 puertos USB, rejilla de ventilación)
    M_cp = Matrix.Translation((x_side, s * 1.34, 0.16)) @ rot_to((-1, 0, 0), up=(0, 0, 1))
    vs = []
    vs += pod.box("R_Frame", 0.018, 0.24, 0.30, center=(0, 0, 0))
    vs += beveled_frame(pod, "R_Alu", 0.246, 0.306, 0.007, 0.020)
    # pantalla pequeña retroiluminada
    vs += pod.box("R_Black", 0.008, 0.16, 0.095, center=(0.009, 0.0, 0.075))
    vs += pod.box("R_Screen", 0.004, 0.145, 0.080, center=(0.013, 0.0, 0.075))
    # 3 pulsadores iluminados + selector rotativo + doble puerto USB metálico
    for bk, bm in enumerate(("R_Indicator", "R_Alu", "R_Accent")):
        vs += pod.box(bm, 0.010, 0.020, 0.014, center=(0.010, -0.065 + bk * 0.035, -0.005))
    vs += knob(pod, "R_Frame", "R_Alu", (0.009, 0.065, -0.005), (1, 0, 0), r=0.012, h=0.012)
    for uk in (-0.014, 0.014):
        vs += pod.box("R_Steel", 0.008, 0.016, 0.009, center=(0.010, -0.055 + uk, -0.042))
        vs += pod.box("R_Black", 0.010, 0.010, 0.004, center=(0.011, -0.055 + uk, -0.042))
    # rejilla de ventilación personal ranurada en la parte baja de la consola
    vs += louver_grille(pod, "R_Frame", "R_Alu", 0.18, 0.065, depth=0.010, slats=4, M=Matrix.Translation((0.008, 0.0, -0.095)))
    place(pod, vs, M_cp)
    H.decal(M_cp @ Matrix.Translation((0.012, 0.0, 0.132)), 0.18, 0.028, H.SIGN["consolap"])

    # bolsillos organizadores de tela bajo la consola (con cuaderno y auriculares visibles!)
    M_pk = Matrix.Translation((x_side, s * 1.33, -0.22)) @ rot_to((-1, 0, 0), up=(0, 0, 1))
    vs = []
    vs += pod.box("R_FabricBlue", 0.010, 0.28, 0.24, center=(0, 0, 0))
    vs += cushion(pod, "R_Bag", 0.042, 0.12, 0.15, center=(0.024, -0.065, -0.02), puff=0.006, round_=0.012, sub=1, seed=idx + 41)
    vs += cushion(pod, "R_Bag", 0.040, 0.11, 0.13, center=(0.022, 0.068, -0.03), puff=0.005, round_=0.012, sub=1, seed=idx + 47)
    # cuaderno con tapa bermellón y hojas asomando del bolsillo izquierdo
    vs += pod.box("R_Accent", 0.014, 0.095, 0.12, center=(0.022, -0.065, 0.055), rot=Matrix.Rotation(D(5), 4, 'X'))
    vs += pod.box("R_Lining", 0.010, 0.088, 0.114, center=(0.022, -0.065, 0.058), rot=Matrix.Rotation(D(5), 4, 'X'))
    # auriculares colgados en un gancho junto al bolsillo derecho
    vs += pod.cyl("R_Alu", 0.005, 0.005, 0.028, 8, center=(0.016, 0.068, 0.095), axis='X')
    vs += pod.torus("R_Frame", 0.055, 0.006, 16, 6, center=(0.024, 0.068, 0.055), axis='X')
    for sy_h in (-1, 1):
        vs += pod.cyl("R_Leather", 0.026, 0.024, 0.020, 12, center=(0.024, 0.068 + sy_h * 0.050, 0.015), axis='Y')
    place(pod, vs, M_pk)

    # fotos personales en la pared acústica alta (despejadas sobre el saco)
    rnd = random.Random(idx * 7 + 3)
    for k in range(3):
        a = D(22 + k * 7)
        c = H.arc_pt(R_L - 0.036, a, s)
        pod.box("R_Label", 0.085 + 0.025 * rnd.random(), 0.004, 0.068,
                center=(xa + 0.24 + k * 0.13, c.y, c.z), rot=Matrix.Rotation(H.mirror_a(a, s) - PI / 2, 4, 'X'))
    # placa identificativa del tripulante
    H.decal(Matrix.Translation(((xa + xb) / 2, s * (y_front - 0.0035), ztop - 0.15)) @ rot_to((0, -s, 0), up=(0, 0, 1)),
            0.18, 0.045, H.SIGN[f"trip{idx}"])
    H.P(f"HAB.INT.C.Q{idx}", f"Cabina privada {idx} ({name_tag})", pod, g, key,
        "Cabina individual de 1,9 m³ con consola personal, bolsillos organizadores, pared acústica y cajón.", bevel=0.003)

    # --- Saco de dormir acolchado en baffles horizontales con capucha, cremallera metálica y hebillas
    sb = MB(f"c_bag{idx}")
    x_bag = xa + (xb - xa) * 0.48
    M = Matrix.Translation((x_bag, s * 1.63, -0.22)) @ rot_to((0, -s, 0), up=(0, 0, 1))
    secs = []
    nz, na = 44, 22
    rnd_b = random.Random(idx * 17 + 5)
    ph_b = rnd_b.random() * TAU
    for iz in range(nz + 1):
        u = iz / nz
        z = -0.60 + 1.24 * u  # de -0.60 (pies, justo sobre el suelo elevado) a +0.64 (hombros)
        # silueta anatómica tipo momia: más estrecho en pies, más ancho en torso/hombros
        taper = 0.72 + 0.28 * math.sin(min(1.0, u * 1.25) * PI * 0.5)
        if u > 0.88:
            taper *= 1.0 - 0.25 * ((u - 0.88) / 0.12) ** 2
        # 9 celdas horizontales acolchadas (baffles profundos con costuras nítidas)
        baffle = abs(math.sin(u * 9.0 * PI)) ** 0.65
        quilt = 0.022 * baffle
        ring = []
        for ia in range(na):
            t = 2 * PI * ia / na
            w = 0.275 * taper
            wr = 0.005 * math.sin(t * 3.0 + u * 8.0 + ph_b) * math.sin(u * PI)
            d = (0.068 + quilt + wr) * (1.0 if math.sin(t) > 0 else 0.35)
            # pequeña depresión en el borde superior (escote del saco)
            ring.append(Vector((d * math.sin(t) + 0.032, w * math.cos(t), z)))
        secs.append(ring)
    vs = loft(sb, "R_FabricBlue", secs)
    # cuello vuelto / forro interior de lana cálida asomando en la apertura superior
    vs += cushion(sb, "R_Fabric", 0.082, 0.34, 0.075, center=(0.060, 0, 0.635), puff=0.012, round_=0.028, sub=2, seed=idx + 15)
    # capucha / almohada anatómica moldeada integrada
    vs += cushion(sb, "R_FabricBlue", 0.105, 0.34, 0.24, center=(0.042, 0, 0.775), puff=0.022, round_=0.055, sub=2, seed=idx + 20, wrinkle=0.004)
    vs += cushion(sb, "R_Fabric", 0.055, 0.24, 0.15, center=(0.075, 0, 0.765), puff=0.012, round_=0.032, sub=2, seed=idx + 25)
    # cremallera lateral a todo lo largo con ribete, dientes metálicos y tirador bermellón
    zip_pts = [(0.105, 0.135, -0.48 + k * 0.18) for k in range(7)]
    vs += strap(sb, "R_Black", zip_pts, 0.014, 0.005, up=(1, 0, 0))
    vs += strap(sb, "R_Alu", [(p[0] + 0.003, p[1], p[2]) for p in zip_pts], 0.005, 0.004, up=(1, 0, 0))
    vs += sb.box("R_Accent", 0.014, 0.016, 0.028, center=(0.114, 0.135, 0.46))  # tirador
    # 2 correas de retención siguiendo el contorno del saco + hebillas de liberación rápida
    for zz in (0.30, -0.24):
        pts_s = [
            (0.015, -0.31, zz),
            (0.095, -0.24, zz),
            (0.128, -0.10, zz + 0.006),
            (0.132, 0.0, zz + 0.008),
            (0.128, 0.10, zz + 0.006),
            (0.095, 0.24, zz),
            (0.015, 0.31, zz),
        ]
        vs += strap(sb, "R_Frame", pts_s, 0.034, 0.004, up=(1, 0, 0))
        vs += buckle(sb, Matrix.Translation((0.135, 0.0, zz + 0.008)), w=0.044, h=0.032, t=0.010)
    place(sb, vs, M)
    ob = H.P(f"HAB.INT.C.Q{idx}.BAG", "Saco de dormir", sb, g, key,
             "Saco de dormir acolchado en cámaras horizontales con capucha, cremallera y hebillas de liberación rápida.", smooth=60)
    ctl(ob, "act:sleep")

    # --- Cortina con pliegues naturales, riel superior con anillas y cinta recogedora
    ct = MB(f"c_curtain{idx}")
    h = ztop - 0.11 - (FLOOR + 0.34)
    yc_rail = s * (y_front + 0.015)
    z_rail = ztop - 0.10
    # riel tubular superior de aluminio de lado a lado + 5 anillas en la zona recogida
    ct.cyl("R_Alu", 0.009, 0.009, (xb - xa) - 0.06, 12, center=((xa + xb) / 2, yc_rail, z_rail), axis='X')
    for rk in range(5):
        ct.torus("R_Steel", 0.015, 0.003, 12, 6, center=(xa + 0.07 + rk * 0.042, yc_rail, z_rail), axis='X')
    M_ct = Matrix.Translation((xa + 0.17, yc_rail, (z_rail - 0.01 + FLOOR + 0.34) / 2)) @ rot_to((1, 0, 0), up=(0, -s, 0))
    curtain_sheet(ct, "R_FabricBlue", 0.28, h, 16, 14, M_ct, folds=0.030, seed=idx * 3 + 1, thickness=0.004, pinch_v=0.42, pinch_amt=0.40)
    # cinta recogedora en la cintura con broche bermellón
    z_tie = (FLOOR + 0.34) + h * 0.42
    ct.box("R_Frame", 0.18, 0.055, 0.030, center=(xa + 0.15, yc_rail, z_tie))
    ct.box("R_Accent", 0.032, 0.062, 0.022, center=(xa + 0.22, yc_rail, z_tie))
    H.P(f"HAB.INT.C.Q{idx}.CRT", "Cortina", ct, g, key, "Cortina ignífuga sobre riel con anillas y cinta recogedora.", smooth=60)

    # --- Lámpara de lectura con brazo articulado orientable
    lm = MB(f"c_lamp{idx}")
    p_base = Vector((x_side, s * 1.48, 0.56))
    p_elbow = Vector((x_side - 0.10, s * 1.40, 0.62))
    p_head = Vector((x_side - 0.16, s * 1.36, 0.54))
    lm.cyl("R_Frame", 0.026, 0.026, 0.016, 14, center=p_base, axis='X')
    lm.tube("R_Alu", [p_base, p_elbow, p_head], 0.007, 8, round_r=0.02)
    lm.sphere("R_Frame", 0.013, 10, 6, center=p_elbow)
    Rh = rot_to((0.25, s * 0.4, -1.0), up=(1, 0, 0))
    vs_h = lm.cyl("R_Frame", 0.020, 0.026, 0.055, 14, center=(0, 0, 0), axis='X')
    vs_h += lm.cyl("R_LED", 0.022, 0.022, 0.006, 14, center=(0.028, 0, 0), axis='X')
    place(lm, vs_h, Matrix.Translation(p_head) @ Rh)
    H.P(f"HAB.INT.C.Q{idx}.LMP", "Luz de lectura", lm, g, key, "Lámpara LED orientable sobre brazo articulado.")
    lmark(f"pod{idx}", "area", ((xa + xb) / 2, s * 1.40, ztop - 0.06), 11, (1.0, 0.80, 0.58), (0.6, 0.3), (0, 0, 0), 'C')


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
    shell(key, g, x0, x1, {-1: {'all': {'lower': False, 'worktop': False}}})
    H.build_aft_wall(g)

    # --- babor: cocina (dispensador de agua con nicho/boquilla/bandeja/bolsa + calentador con puerta/visor)
    s = 1
    gl = MB("d_galley")
    # dispensador de agua con cavidad/nicho real (en C)
    gx, gy = 1.96, s * 1.70
    gl.box("R_Lining", 0.32, 0.14, 0.48, center=(gx, gy + s * 0.10, WT + 0.24))             # espalda
    gl.box("R_Lining", 0.32, 0.34, 0.21, center=(gx, gy, WT + 0.375))                       # cabeza superior
    gl.box("R_Frame", 0.32, 0.34, 0.045, center=(gx, gy, WT + 0.0225))                      # base
    for dx_s in (-0.145, 0.145):
        gl.box("R_Lining", 0.030, 0.34, 0.24, center=(gx + dx_s, gy, WT + 0.16))            # laterales del nicho
    # interior del nicho: chapa de acero, bandeja antigoteo ranurada, boquilla metálica y bolsa de bebida acoplada
    gl.box("R_Steel", 0.25, 0.008, 0.22, center=(gx, gy + s * 0.028, WT + 0.16))
    gl.box("R_Steel", 0.24, 0.16, 0.012, center=(gx, gy - s * 0.07, WT + 0.050))
    for sl in range(5):
        gl.box("R_Black", 0.18, 0.008, 0.004, center=(gx, gy - s * (0.03 + sl * 0.022), WT + 0.057))
    gl.cyl("R_Steel", 0.012, 0.009, 0.065, 14, center=(gx, gy - s * 0.07, WT + 0.238))      # boquilla
    gl.cyl("R_Alu", 0.018, 0.018, 0.014, 14, center=(gx, gy - s * 0.07, WT + 0.265))
    # bolsa de bebida acoplada bajo la boquilla
    cushion(gl, "R_Bag", 0.085, 0.036, 0.13, center=(gx, gy - s * 0.07, WT + 0.125), puff=0.008, round_=0.012, sub=1, seed=91)
    gl.cyl("R_Accent", 0.010, 0.010, 0.016, 10, center=(gx, gy - s * 0.07, WT + 0.195))
    # frente superior del dispensador: marco, pantalla de temperatura/dosis, botones fría/caliente y selector
    M_gp = Matrix.Translation((gx, gy - s * 0.172, WT + 0.375)) @ rot_to((0, -s, 0), up=(0, 0, 1))
    beveled_frame(gl, "R_Frame", 0.26, 0.16, 0.010, 0.012, M=M_gp)
    gl.box("R_Black", 0.22, 0.008, 0.082, center=(gx, gy - s * 0.172, WT + 0.405))
    gl.box("R_Screen", 0.20, 0.004, 0.068, center=(gx, gy - s * 0.176, WT + 0.405))
    for k, col in enumerate(("R_Indicator", "R_Alarm", "R_Warning")):
        gl.cyl(col, 0.013, 0.013, 0.012, 12, center=(gx - 0.075 + k * 0.055, gy - s * 0.174, WT + 0.330), axis='Y')
    knob(gl, "R_Frame", "R_Alu", (gx + 0.085, gy - s * 0.172, WT + 0.330), (0, -s, 0), r=0.014, h=0.014)
    ob = H.P("HAB.INT.D.H2O", "Dispensador de agua", gl, g, key, "Dispensador de agua fría y caliente con boquilla dosificadora, bandeja antigoteo y bolsa acoplada.", bevel=0.003)
    ctl(ob, "act:drink")

    # calentador de alimentos (puerta biselada, tirador térmico, pantalla de temperatura, ranuras superiores)
    fw = MB("d_warmer")
    wx, wy = 1.40, s * 1.70
    fw.box("R_Lining", 0.48, 0.34, 0.36, center=(wx, wy, WT + 0.18))
    # puerta frontal biselada con marco metálico
    fw.box("R_Frame", 0.36, 0.022, 0.27, center=(wx - 0.035, wy - s * 0.172, WT + 0.165))
    fw.box("R_LiningDark", 0.31, 0.012, 0.22, center=(wx - 0.035, wy - s * 0.182, WT + 0.165))
    # tirador térmico aislado (barra bermellón sobre 2 pilares de acero)
    fw.box("R_Accent", 0.22, 0.018, 0.018, center=(wx - 0.035, wy - s * 0.212, WT + 0.268))
    for dx_h in (-0.09, 0.09):
        fw.box("R_Steel", 0.014, 0.028, 0.014, center=(wx - 0.035 + dx_h, wy - s * 0.195, WT + 0.268))
    # bisagras laterales de la puerta
    for zh in (WT + 0.09, WT + 0.23):
        fw.cyl("R_Alu", 0.007, 0.007, 0.028, 8, center=(wx - 0.218, wy - s * 0.178, zh), axis='Z')
    # columna de control derecha (pantalla 75 °C, selector temporizador, piloto cálido)
    fw.box("R_Black", 0.082, 0.010, 0.26, center=(wx + 0.190, wy - s * 0.172, WT + 0.17))
    fw.box("R_Screen", 0.064, 0.005, 0.048, center=(wx + 0.190, wy - s * 0.177, WT + 0.255))
    knob(fw, "R_Frame", "R_Alu", (wx + 0.190, wy - s * 0.174, WT + 0.165), (0, -s, 0), r=0.016, h=0.016)
    fw.box("R_Warning", 0.026, 0.006, 0.012, center=(wx + 0.190, wy - s * 0.177, WT + 0.090))
    # ranuras de ventilación en la corona superior
    for sl in range(6):
        fw.box("R_Black", 0.34, 0.008, 0.006, center=(wx - 0.03, wy - s * (0.04 + sl * 0.024), WT + 0.361))
    ob = H.P("HAB.INT.D.OVN", "Calentador de alimentos", fw, g, key, "Calentador por conducción con puerta aislada, control de temperatura y ventilación.", bevel=0.003)
    ctl(ob, "act:eat")

    # envases y utensilios sobre la encimera
    cn = MB("d_containers")
    rnd = random.Random(11)
    for k in range(7):
        x = 0.78 + k * 0.075
        hgt = 0.08 + rnd.random() * 0.07
        cn.cyl(rnd.choice(["R_Lining", "R_Bag", "R_Steel"]), 0.030, 0.030, hgt, 18, center=(x, s * (1.75 - (k % 2) * 0.09), WT + hgt / 2))
        cn.cyl("R_Frame", 0.032, 0.032, 0.012, 18, center=(x, s * (1.75 - (k % 2) * 0.09), WT + hgt + 0.006))
    for k in range(3):
        cushion(cn, "R_Bag" if k != 1 else "R_BagTech", 0.15, 0.105, 0.028,
                center=(1.04 + k * 0.04, s * 1.54, WT + 0.015 + k * 0.028), R=Matrix.Rotation(D(8 * k), 4, 'Z'), puff=0.004, round_=0.008, sub=1, seed=80 + k)
    H.P("HAB.INT.D.CNT", "Envases y raciones", cn, g, key, "Contenedores de raciones, bolsas de bebida y utensilios con sujeción magnética.", bevel=0.002)

    # --- Mesa de comidas central con reborde perimetral, bandas elásticas, vaso/bolsa y tableta detallada
    tb = MB("d_table")
    M_tb = Matrix.Translation((1.55, 0.0, -0.08))
    prism(tb, "R_Worktop", fillet([(-0.42, -0.30), (0.42, -0.30), (0.42, 0.30), (-0.42, 0.30)], 0.10, 5), -0.022, 0.0, 'Z', M=M_tb)
    # reborde perimetral de aluminio anodizado (8 mm sobre el tablero en z=-0.08)
    outer_rim = fillet([(-0.425, -0.305), (0.425, -0.305), (0.425, 0.305), (-0.425, 0.305)], 0.105, 5)
    inner_rim = fillet([(-0.408, -0.288), (0.408, -0.288), (0.408, 0.288), (-0.408, 0.288)], 0.092, 5)
    rim_s = [[Vector((p[0] + 1.55, p[1], z)) for p in outer_rim] for z in (-0.102, -0.072)]
    loft(tb, "R_Alu", rim_s, closed=True, cap=False)
    rim_in = [[Vector((p[0] + 1.55, p[1], z)) for p in inner_rim] for z in (-0.072, -0.080)]
    loft(tb, "R_Alu", rim_in, closed=True, cap=False)
    rim_top = [[Vector((p[0] + 1.55, p[1], -0.072)) for p in outer_rim], [Vector((p[0] + 1.55, p[1], -0.072)) for p in inner_rim]]
    loft(tb, "R_Alu", rim_top, closed=True, cap=False)
    # 2 bandas elásticas de retención (bungee straps) a la izquierda de la mesa
    for dy_b in (-0.16, -0.07):
        tb.tube("R_Accent", [(1.17, dy_b, -0.074), (1.30, dy_b, -0.068), (1.42, dy_b, -0.074)], 0.0045, 8)
        for ex in (1.17, 1.42):
            tb.cyl("R_Alu", 0.008, 0.008, 0.008, 8, center=(ex, dy_b, -0.076))
    # vaso/bolsa espacial con tapa y pajita retenido bajo la banda elástica
    tb.cyl("R_Steel", 0.036, 0.032, 0.115, 16, center=(1.28, -0.115, -0.020))
    tb.cyl("R_Frame", 0.038, 0.038, 0.018, 16, center=(1.28, -0.115, 0.042))
    tb.tube("R_Alu", [(1.28, -0.115, 0.048), (1.28, -0.115, 0.088), (1.305, -0.105, 0.108)], 0.004, 6, round_r=0.01)
    # paquete de ración sujeto junto al vaso
    cushion(tb, "R_Bag", 0.15, 0.10, 0.022, center=(1.34, 0.13, -0.068), R=Matrix.Rotation(D(-8), 4, 'Z'), puff=0.005, round_=0.008, sub=1, seed=72)
    # pedestal con brida atornillada y apoyapiés con fundas de goma
    tb.cyl("R_Frame", 0.048, 0.068, 1.05, 24, center=(1.55, 0, -0.62))
    tb.cyl("R_Alu", 0.074, 0.074, 0.024, 24, center=(1.55, 0, -0.14))
    tb.cyl("R_Frame", 0.21, 0.21, 0.022, 32, center=(1.55, 0, FLOOR + 0.011))
    bolt_ring(tb, "R_Alu", (1.55, 0, FLOOR + 0.022), (0, 0, 1), 0.175, 8, r_head=0.006, h=0.005)
    for sy_f in (-1, 1):
        tb.cyl("R_Alu", 0.012, 0.012, 0.78, 12, center=(1.55, sy_f * 0.27, -0.42), axis='X')
        tb.cyl("R_Rubber", 0.015, 0.015, 0.26, 12, center=(1.55, sy_f * 0.27, -0.42), axis='X')
        tb.beam("R_Frame", (1.55, 0.0, -0.42), (1.55, sy_f * 0.27, -0.42), 0.024, 0.022)
    H.P("HAB.INT.D.TBL", "Mesa de comidas", tb, g, key, "Mesa con reborde perimetral, bandas elásticas de retención, vaso y barra apoyapiés.", bevel=0.003)

    # tableta detallada (conserva HAB.INT.D.TAB y ctl='act:read')
    tbl = MB("d_tablet")
    M_tab = Matrix.Translation((1.70, 0.07, -0.062)) @ Matrix.Rotation(D(14), 4, 'Z') @ Matrix.Rotation(D(-8), 4, 'Y')
    vs_t = tbl.box("R_Frame", 0.245, 0.175, 0.010, center=(0, 0, 0))
    vs_t += tbl.box("R_Black", 0.232, 0.162, 0.003, center=(0, 0, 0.0055))
    vs_t += tbl.box("R_Screen", 0.214, 0.144, 0.002, center=(0, 0, 0.0072))
    vs_t += tbl.box("R_Alu", 0.14, 0.07, 0.014, center=(0.04, 0, -0.012))  # soporte trasero antideslizante
    place(tbl, vs_t, M_tab)
    ob = H.P("HAB.INT.D.TAB", "Tableta del plan del día", tbl, g, key, "Tableta táctica con pantalla iluminada sobre soporte antideslizante.", bevel=0.002)
    ctl(ob, "act:read")

    for i, x in enumerate((1.42, 1.95)):
        spot(f"galspot{i}", (x, 1.45, 1.62), 50, 1, 'D')
    lmark("table", "area", (1.55, 0.0, 1.20), 24, (1.0, 0.86, 0.72), (0.55, 0.42), (0, 0, 0), 'D')

    # --- estribor: compartimento de higiene + cicloergómetro rehecho
    s = -1
    hy = MB("d_hygiene")
    hx0, hx1 = 0.66, 1.62
    yf = 1.05
    for xx in (hx0, hx1):
        prism(hy, "R_Lining", [(s * yf, FLOOR), (s * 1.75, FLOOR), (s * 1.75, 0.8), (s * 1.30, 1.45), (s * yf, 1.45)], xx - 0.02, xx + 0.02, 'X')
    prism(hy, "R_Lining", [(s * yf, 1.42), (s * 1.30, 1.42), (s * 1.30, 1.46), (s * yf, 1.46)], hx0, hx1, 'X')
    # rieles superior e inferior de la puerta corredera
    prism(hy, "R_Alu", rrect(0.032, 0.036, 0.006, cx=s * (yf - 0.02), cy=1.41), hx0, hx1, 'X')
    prism(hy, "R_Frame", rrect(0.036, 0.024, 0.005, cx=s * (yf - 0.02), cy=FLOOR + 0.012), hx0, hx1, 'X')
    # puerta corredera con asa bermellón, rejilla de ventilación e indicador ocupado/libre
    hy.box("R_LiningDark", 0.62, 0.030, 2.38, center=(hx0 + 0.34, s * (yf - 0.02), FLOOR + 1.23))
    hy.tube("R_Accent", [(hx0 + 0.61, s * (yf - 0.035), -0.14), (hx0 + 0.61, s * (yf - 0.072), -0.12),
                         (hx0 + 0.61, s * (yf - 0.072), 0.12), (hx0 + 0.61, s * (yf - 0.035), 0.14)], 0.011, 8, round_r=0.02)
    hy.box("R_Frame", 0.12, 0.012, 0.065, center=(hx0 + 0.50, s * (yf - 0.037), 0.04))
    hy.box("R_Indicator", 0.048, 0.006, 0.018, center=(hx0 + 0.50, s * (yf - 0.043), 0.04))
    louver_grille(hy, "R_Frame", "R_Alu", 0.34, 0.14, depth=0.012, slats=5,
                  M=Matrix.Translation((hx0 + 0.34, s * (yf - 0.036), FLOOR + 0.32)) @ rot_to((0, 1, 0), up=(0, 0, 1)))
    ob = H.P("HAB.INT.D.HYG", "Compartimento de higiene", hy, g, key, "Cabina cerrada con puerta corredera, ventilación dedicada y cerradura con indicador.", bevel=0.003)
    ctl(ob, "act:hygiene")
    lmark("hyg", "area", ((hx0 + hx1) / 2 + 0.2, s * 1.4, 1.38), 10, (0.95, 0.97, 1.0), (0.5, 0.4), (0, 0, 0), 'D')

    # --- Cicloergómetro CEVIS rehecho (bastidor tubular con aislamiento, volante ranurado, bielas/pedales con correas, arnés cintura y consola)
    cy = MB("d_cycle")
    cx, cy_y = 2.15, s * 0.96
    # plataforma de aislamiento de vibraciones con 4 amortiguadores elastómero + aluminio
    cy.box("R_Frame", 0.96, 0.16, 0.034, center=(cx, cy_y, FLOOR + 0.055))
    for dx_v in (-0.42, 0.42):
        for dy_v in (-0.16, 0.16):
            cy.cyl("R_Rubber", 0.034, 0.038, 0.038, 12, center=(cx + dx_v, cy_y + dy_v, FLOOR + 0.019))
            cy.cyl("R_Alu", 0.024, 0.024, 0.016, 12, center=(cx + dx_v, cy_y + dy_v, FLOOR + 0.044))
        cy.box("R_Alu", 0.065, 0.38, 0.024, center=(cx + dx_v, cy_y, FLOOR + 0.055))
    # bastidor tubular mecanizado triangulado
    p_bb = Vector((cx + 0.14, cy_y, FLOOR + 0.34))   # caja de pedalier / eje del volante
    p_seat = Vector((cx - 0.22, cy_y, -0.34))
    p_head = Vector((cx + 0.36, cy_y, -0.14))
    p_fbase = Vector((cx + 0.32, cy_y, FLOOR + 0.07))
    p_rbase = Vector((cx - 0.30, cy_y, FLOOR + 0.07))
    cy.tube("R_Frame", [p_rbase, p_seat, p_bb, p_fbase], 0.024, 10, round_r=0.04)
    cy.tube("R_Frame", [p_bb, p_head], 0.024, 10)
    cy.tube("R_Alu", [p_rbase, p_bb], 0.016, 8)
    cy.tube("R_Alu", [Vector((cx - 0.16, cy_y, FLOOR + 0.56)), Vector((cx + 0.27, cy_y, FLOOR + 0.66))], 0.016, 8)
    # volante de inercia ranurado con llanta de acero, 6 radios y pinza de freno magnético
    cy.torus("R_Steel", 0.195, 0.024, 32, 10, center=p_bb, axis='Y')
    cy.cyl("R_Frame", 0.175, 0.175, 0.020, 28, center=p_bb, axis='Y')
    cy.cyl("R_Alu", 0.045, 0.045, 0.095, 16, center=p_bb, axis='Y')
    for rk in range(6):
        ang = rk * PI / 3
        p1 = p_bb + Vector((0.175 * math.cos(ang), 0, 0.175 * math.sin(ang)))
        cy.beam("R_Alu", p_bb, p1, 0.024, 0.014, up=(0, 1, 0))
    # pinza de resistencia electromagnética (acento bermellón)
    cy.box("R_Accent", 0.065, 0.075, 0.060, center=p_bb + Vector((0.17, 0, 0.11)), rot=Matrix.Rotation(D(-32), 4, 'Y'))
    # bielas acodadas en oposición a 180°, pedales con plataforma y correas/calapiés
    for d in (-1, 1):
        ang_c = D(35) if d > 0 else D(215)
        y_crank = cy_y + d * 0.078
        p_ped = Vector((p_bb.x + 0.155 * math.cos(ang_c), y_crank, p_bb.z + 0.155 * math.sin(ang_c)))
        cy.beam("R_Alu", (p_bb.x, y_crank, p_bb.z), p_ped, 0.014, 0.022, up=(0, 1, 0))
        cy.cyl("R_Steel", 0.008, 0.008, 0.085, 10, center=(p_ped.x, y_crank + d * 0.042, p_ped.z), axis='Y')
        cy.box("R_Black", 0.105, 0.085, 0.016, center=(p_ped.x, y_crank + d * 0.055, p_ped.z))
        # correa calapié sobre el pedal
        cy.tube("R_Accent", [
            (p_ped.x - 0.02, y_crank + d * 0.018, p_ped.z + 0.008),
            (p_ped.x, y_crank + d * 0.055, p_ped.z + 0.048),
            (p_ped.x + 0.02, y_crank + d * 0.092, p_ped.z + 0.008),
        ], 0.006, 6, round_r=0.015)
    # sillín ergonómico + arnés de cintura para microgravedad
    cy.cyl("R_Alu", 0.016, 0.016, 0.12, 12, center=(p_seat.x - 0.01, cy_y, p_seat.z + 0.04))
    cushion(cy, "R_Leather", 0.24, 0.17, 0.055, center=(p_seat.x - 0.02, cy_y, p_seat.z + 0.095), puff=0.010, round_=0.024, sub=2, seed=3)
    for sy_h in (-1, 1):
        strap(cy, "R_FabricBlue", [
            (cx - 0.34, cy_y + sy_h * 0.15, FLOOR + 0.07),
            (p_seat.x - 0.04, cy_y + sy_h * 0.14, p_seat.z + 0.08),
            (p_seat.x + 0.02, cy_y + sy_h * 0.06, p_seat.z + 0.16),
        ], 0.032, 0.004, up=(1, 0, 0))
    buckle(cy, Matrix.Translation((p_seat.x + 0.03, cy_y, p_seat.z + 0.165)), w=0.040, h=0.028, t=0.009)
    # manillar multiposición + consola ergonómica inclinada con pantalla
    cy.tube("R_Frame", [(p_head.x, cy_y - 0.22, p_head.z + 0.05), (p_head.x, cy_y - 0.19, p_head.z + 0.02),
                        (p_head.x, cy_y + 0.19, p_head.z + 0.02), (p_head.x, cy_y + 0.22, p_head.z + 0.05)], 0.014, 10, round_r=0.03)
    for sy_g in (-1, 1):
        cy.cyl("R_Rubber", 0.018, 0.018, 0.11, 12, center=(p_head.x - 0.03, cy_y + sy_g * 0.21, p_head.z + 0.05), rot=Matrix.Rotation(D(75), 4, 'Y'))
    M_con = Matrix.Translation((p_head.x + 0.015, cy_y, p_head.z + 0.095)) @ rot_to((-1, 0, 0.45), up=(0, 0, 1))
    vs_c = cy.box("R_Frame", 0.026, 0.19, 0.125, center=(0, 0, 0))
    vs_c += cy.box("R_Screen", 0.006, 0.145, 0.075, center=(0.014, 0, 0.014))
    for bk, bm in enumerate(("R_Indicator", "R_Alu", "R_Accent")):
        vs_c += cy.box(bm, 0.008, 0.022, 0.014, center=(0.014, -0.045 + bk * 0.045, -0.040))
    place(cy, vs_c, M_con)
    ob = H.P("HAB.INT.D.CEV", "Cicloergómetro", cy, g, key,
             "Cicloergómetro CEVIS con aislamiento de vibraciones, volante ranurado, pedales con correas, arnés de cintura y consola.", bevel=0.003)
    ctl(ob, "act:exercise")

    # --- pared de popa: 12 bolsas CTB aeroespaciales con variación orgánica de forma, tono, asas y etiquetas limpias
    bg = MB("d_bags")
    rnd = random.Random(4)
    bag_palette = [
        ("R_Bag", "R_Accent", H.SIGN["ctb1"]),
        ("R_BagTech", "R_Accent", H.SIGN["ctb2"]),
        ("R_Bag", "R_Frame", H.SIGN["ctb3"]),
        ("R_FabricBlue", "R_Accent", H.SIGN["ctb4"]),
        ("R_BagTech", "R_Frame", H.SIGN["ctb5"]),
        ("R_Bag", "R_Accent", H.SIGN["ctb6"]),
        ("R_Bag", "R_Frame", H.SIGN["ctb8"]),
        ("R_FabricBlue", "R_Accent", None),
        ("R_Bag", "R_Accent", None),
        ("R_BagTech", "R_Accent", None),
        ("R_Bag", "R_Frame", None),
        ("R_BagTech", "R_Frame", None),
    ]
    b_idx = 0
    for i in range(3):
        for j in range(4):
            y = -1.04 + j * 0.695 + (rnd.random() - 0.5) * 0.03
            z = -0.60 + i * 0.56
            if abs(y) > 1.75 - abs(z) * 0.3:
                continue
            b_mat, h_mat, b_tile = bag_palette[b_idx % len(bag_palette)]
            dx = 0.21 + (rnd.random() - 0.5) * 0.025
            dy = 0.46 + (rnd.random() - 0.5) * 0.03
            dz = 0.35 + (rnd.random() - 0.5) * 0.02
            roll = D((rnd.random() - 0.5) * 3.0)
            M_bg = Matrix.Translation((0.745, y, z)) @ Matrix.Rotation(roll, 4, 'X')
            _ctb_bag(bg, M_bg, dx, dy, dz, body_mat=b_mat, handle_mat=h_mat, seed=i * 11 + j * 3 + 7, tile=b_tile)
            b_idx += 1
    H.P("HAB.INT.D.BAG", "Bolsas de estiba", bg, g, key,
        "Bolsas aeroespaciales CTB en Nomex y tejido técnico con cremallera, correas de compresión, asas y etiquetas.", smooth=50)

    H.decal(Matrix.Translation((gx, gy - s * 0.172, WT + 0.460)) @ rot_to((0, -1, 0), up=(0, 0, 1)), 0.22, 0.044, H.SIGN["agua"])
    H.decal(Matrix.Translation((wx - 0.035, wy - s * 0.172, WT + 0.332)) @ rot_to((0, -1, 0), up=(0, 0, 1)), 0.22, 0.040, H.SIGN["calentador"])
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
    for q in range(8):
        arc_panel(bk, "R_Backing", RN + 0.07, RN + 0.085, q * PI / 4, (q + 1) * PI / 4, xa - 0.05, xb + 0.02, 6)
    me = boolean_cut(bk.mesh(smooth=None), [cutter(0.64, 1.6, (xc, 0, 1.5)), cutter(0.60, 2.0, (xc, 0, -1.4))], "n_back_cut")
    ob = part("FWD.INT.BCK", "Trasdós del nodo", me, g); ob["room"] = key

    # suelo con hueco de la esclusa
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
    H.P("FWD.INT.FLR", "Suelo del nodo", fl, g, key, "Pavimento sobre el pozo de la esclusa.", smooth=None)

    # --- brocales y detalle interior de CÚPULA + POZO DE ESCLUSA
    wl = MB("n_wells")

    def ring(r_in, r_out, z0, z1, mat, seg=48):
        secs = []
        for (r, z) in ((r_out, z0), (r_in, z0), (r_in, z1), (r_out, z1), (r_out, z0)):
            secs.append([Vector((xc + r * math.cos(2 * PI * k / seg), r * math.sin(2 * PI * k / seg), z)) for k in range(seg)])
        loft(wl, mat, secs, closed=True, cap=False)

    # cúpula: pozo de acceso + pasamanos perimetral + conductos de desempañado + 6 cerraduras de contraventanas + cámara montada
    ring(0.60, 0.66, 1.05, 1.38, "R_Lining")
    ring(0.60, 0.70, 1.02, 1.06, "R_Frame")
    # pasamanos perimetral interior de la cúpula con 6 soportes mecanizados
    wl.torus("R_Frame", 0.562, 0.013, 48, 8, center=(xc, 0, 1.24), axis='Z')
    for k in range(6):
        a = k * PI / 3
        p_w = Vector((xc + 0.605 * math.cos(a), 0.605 * math.sin(a), 1.24))
        p_r = Vector((xc + 0.562 * math.cos(a), 0.562 * math.sin(a), 1.24))
        wl.beam("R_Alu", p_w, p_r, 0.022, 0.018)
        wl.cyl("R_Accent", 0.016, 0.016, 0.036, 10, center=(xc + 0.562 * math.cos(a + 0.08), 0.562 * math.sin(a + 0.08), 1.24),
               rot=Matrix.Rotation(a + PI / 2, 4, 'Z') @ Matrix.Rotation(PI / 2, 4, 'Y'))
    # anillo difusor de desempañado + 6 boquillas hacia las ventanas + 6 cerraduras/manetas internas de contraventanas
    wl.torus("R_Alu", 0.618, 0.014, 48, 8, center=(xc, 0, 1.375), axis='Z')
    for k in range(6):
        a = (k + 0.5) * PI / 3  # centro de cada una de las 6 caras trapezoidales de la cúpula
        ca, sa = math.cos(a), math.sin(a)
        # boquilla de desempañado orientada hacia el vidrio
        wl.box("R_Frame", 0.028, 0.14, 0.018, center=(xc + 0.625 * ca, 0.625 * sa, 1.405),
               rot=Matrix.Rotation(a, 4, 'Z') @ Matrix.Rotation(D(-20), 4, 'Y'))
        # mecanismo de cerradura y maneta de contraventana interior (visible al mirar la cúpula!)
        p_lk = Vector((xc + 0.615 * ca, 0.615 * sa, 1.445))
        M_lk = Matrix.Translation(p_lk) @ Matrix.Rotation(a + PI, 4, 'Z')
        vs_l = wl.box("R_Frame", 0.026, 0.075, 0.036, center=(0, 0, 0))
        vs_l += wl.cyl("R_Steel", 0.010, 0.010, 0.028, 10, center=(0.016, 0, 0), axis='X')
        vs_l += wl.box("R_Accent", 0.012, 0.068, 0.014, center=(0.026, 0.020, 0.004), rot=Matrix.Rotation(D(12), 4, 'X'))
        place(wl, vs_l, M_lk)
    # cámara DSLR con teleobjetivo montada en brazo articulado en la cúpula (ángulo 150°, despejada de la entrada)
    ac = D(150)
    p_c0 = Vector((xc + 0.562 * math.cos(ac), 0.562 * math.sin(ac), 1.24))
    p_c1 = Vector((xc + 0.48 * math.cos(ac), 0.48 * math.sin(ac), 1.42))
    p_c2 = Vector((xc + 0.44 * math.cos(ac + 0.15), 0.44 * math.sin(ac + 0.15), 1.54))
    wl.cyl("R_Alu", 0.022, 0.022, 0.036, 12, center=p_c0, axis='Z')
    wl.tube("R_Frame", [p_c0, p_c1, p_c2], 0.010, 8, round_r=0.02)
    wl.sphere("R_Alu", 0.016, 10, 6, center=p_c1)
    M_cam = Matrix.Translation(p_c2) @ rot_to((math.cos(ac), math.sin(ac), 0.55), up=(0, 0, 1))
    vs_cm = wl.box("R_Black", 0.078, 0.138, 0.098, center=(0, 0, 0))
    vs_cm += wl.box("R_Black", 0.055, 0.062, 0.028, center=(0.005, 0, 0.060))      # pentaprisma
    vs_cm += wl.box("R_Screen", 0.004, 0.075, 0.052, center=(-0.041, -0.012, -0.008))
    vs_cm += wl.cyl("R_Frame", 0.038, 0.044, 0.145, 18, center=(0.110, 0, 0), axis='X')  # teleobjetivo
    vs_cm += wl.torus("R_Accent", 0.044, 0.0035, 18, 6, center=(0.165, 0, 0), axis='X')
    vs_cm += wl.cyl("R_Glass", 0.034, 0.034, 0.006, 16, center=(0.184, 0, 0), axis='X')
    place(wl, vs_cm, M_cam)

    # pozo de esclusa: brocal limpio en aluminio + bermellón (sin halo negro), escalerilla mejorada y válvulas/manómetros
    ring(0.56, 0.62, -3.15, zf - 0.02, "R_Lining")
    ring(0.57, 0.645, zf - 0.02, zf + 0.008, "R_Alu")
    ring(0.555, 0.595, zf + 0.004, zf + 0.016, "R_Accent")
    bolt_ring(wl, "R_Steel", (xc, 0, zf + 0.008), (0, 0, 1), 0.620, 16, r_head=0.005, h=0.003)
    # escalerilla del pozo de la esclusa con soportes a pared y peldaños antideslizantes
    for k in range(7):
        z = zf - 0.25 - k * 0.33
        wl.box("R_Alu", 0.032, 0.36, 0.018, center=(xc + 0.49, 0.0, z))
        wl.box("R_Rubber", 0.024, 0.30, 0.004, center=(xc + 0.49, 0.0, z + 0.011))
    for sy_l in (-0.20, 0.20):
        wl.cyl("R_Alu", 0.015, 0.015, zf + 3.10, 10, center=(xc + 0.51, sy_l, (zf - 3.10) / 2))
        for zs in (zf - 0.30, -1.75, -2.90):
            wl.beam("R_Frame", (xc + 0.51, sy_l, zs), (xc + 0.57, sy_l, zs), 0.022, 0.022)
    # tuberías verticales O2/N2 + panel de válvulas de presurización con 2 manómetros en el pozo (lado popa -X)
    pipe_bundle(wl, ["R_Alu", "R_Steel"], [
        [(xc - 0.535, -0.05, zf - 0.06), (xc - 0.535, -0.05, -2.95)],
        [(xc - 0.535, 0.05, zf - 0.06), (xc - 0.535, 0.05, -2.95)],
    ], [0.014, 0.012], clamps=5, clamp_mat="R_Frame")
    # panel de válvulas a media altura del pozo (visible desde el nodo mirando abajo!)
    wl.box("R_Frame", 0.036, 0.30, 0.24, center=(xc - 0.535, 0.0, -1.25))
    for sy_g in (-0.075, 0.075):
        gauge(wl, (xc - 0.516, sy_g, -1.19), (1, 0, 0), radius=0.034)
        knob(wl, "R_Accent" if sy_g < 0 else "R_FabricBlue", "R_Alu", (xc - 0.516, sy_g, -1.30), (1, 0, 0), r=0.020, h=0.020)
    # suelo de la esclusa
    wl.cyl("R_Floor", 0.6, 0.6, 0.03, 48, center=(xc, 0, -3.16))
    H.P("FWD.INT.WEL", "Pozos de cúpula y esclusa", wl, g, key,
        "Brocales, pasamanos y contraventanas de cúpula, cámara montada, escalerilla y válvulas del pozo.", smooth=40)

    # --- mamparos del nodo con nervios, válvulas de presurización O2/N2 y asideros
    bh = MB("n_bulkheads")
    for x, hole in ((xa, H.HATCH_R), (xb, 0.42)):
        for q in range(4):
            a0, a1 = q * PI / 2, (q + 1) * PI / 2
            pts = [(RN * math.cos(a0 + (a1 - a0) * t / 12), RN * math.sin(a0 + (a1 - a0) * t / 12)) for t in range(13)]
            pts += [(hole * math.cos(a1 - (a1 - a0) * t / 12), hole * math.sin(a1 - (a1 - a0) * t / 12)) for t in range(13)]
            prism(bh, "R_Lining", pts, x - (0.03 if x == xa else 0.0), x + (0.0 if x == xa else 0.03), 'X')
    # detalles del mamparo de proa (xb = 12.12, mirando hacia -X)
    for k in range(8):
        a = PI / 8 + k * PI / 4
        bh.beam("R_Frame", (xb - 0.004, 0.48 * math.cos(a), 0.48 * math.sin(a)),
                (xb - 0.004, (RN - 0.04) * math.cos(a), (RN - 0.04) * math.sin(a)), 0.014, 0.008, up=(1, 0, 0))
    # panel de válvulas de presurización y ecualización en el mamparo de proa (estribor, y = -0.76, z = 0.24)
    bh.box("R_Frame", 0.046, 0.30, 0.34, center=(xb - 0.023, -0.76, 0.24))
    for dy_v, col_v in ((-0.07, "R_Accent"), (0.07, "R_FabricBlue")):
        gauge(bh, (xb - 0.046, -0.76 + dy_v, 0.31), (-1, 0, 0), radius=0.034)
        # volante de válvula de 3 radios
        bh.cyl("R_Steel", 0.010, 0.010, 0.032, 10, center=(xb - 0.060, -0.76 + dy_v, 0.18), axis='X')
        bh.torus(col_v, 0.036, 0.007, 18, 6, center=(xb - 0.074, -0.76 + dy_v, 0.18), axis='X')
    pipe_bundle(bh, ["R_Alu", "R_Steel"], [
        [(xb - 0.020, -0.82, 0.41), (xb - 0.020, -0.76, 0.72), (xb - 0.020, -0.50, 0.96)],
        [(xb - 0.020, -0.70, 0.41), (xb - 0.020, -0.64, 0.72), (xb - 0.020, -0.42, 0.98)],
    ], [0.011, 0.010], clamps=3, clamp_mat="R_Alu")
    # caja de distribución de potencia/datos del nodo (babor, y = 0.76, z = 0.24)
    bh.box("R_Frame", 0.050, 0.26, 0.28, center=(xb - 0.025, 0.76, 0.24))
    bh.box("R_Black", 0.010, 0.21, 0.18, center=(xb - 0.050, 0.76, 0.25))
    for ck in range(3):
        bh.cyl("R_Alu", 0.014, 0.014, 0.018, 10, center=(xb - 0.058, 0.69 + ck * 0.065, 0.19), axis='X')
    bh.box("R_Indicator", 0.006, 0.018, 0.010, center=(xb - 0.056, 0.82, 0.32))
    # asideros bermellón flanqueando la escotilla de atraque
    for sy_h in (-1, 1):
        bh.tube("R_Accent", [(xb - 0.004, sy_h * 0.56, -0.18), (xb - 0.055, sy_h * 0.56, -0.16),
                             (xb - 0.055, sy_h * 0.56, 0.16), (xb - 0.004, sy_h * 0.56, 0.18)], 0.011, 8, round_r=0.02)
    H.P("FWD.INT.BHD", "Mamparos del nodo", bh, g, key, "Mamparos estructurales con válvulas de presurización, manómetros y asideros.", bevel=None)

    # --- escotilla de atraque IDSS detallada (conserva pivote/eje mech y ctl='hatch:idss')
    hd = MB("n_dock_hatch")
    hd.cyl("R_Lining", 0.45, 0.45, 0.052, 48, center=(xb - 0.03, 0, 0), axis='X')
    hd.torus("R_Alu", 0.435, 0.016, 48, 8, center=(xb - 0.052, 0, 0), axis='X')
    hd.torus("R_Accent", 0.375, 0.012, 48, 8, center=(xb - 0.058, 0, 0), axis='X')
    bolt_ring(hd, "R_Steel", (xb - 0.056, 0, 0), (-1, 0, 0), 0.410, 16, r_head=0.006, h=0.005)
    # 6 pestillos radiales de bloqueo
    for k in range(6):
        a = k * PI / 3 + PI / 6
        hd.box("R_Frame", 0.024, 0.055, 0.024, center=(xb - 0.062, 0.36 * math.cos(a), 0.36 * math.sin(a)), rot=Matrix.Rotation(a, 4, 'X'))
    # mirilla óptica superior con bisel de aluminio y vidrio
    hd.cyl("R_Alu", 0.068, 0.068, 0.022, 24, center=(xb - 0.062, 0, 0.21), axis='X')
    hd.cyl("R_Black", 0.052, 0.052, 0.026, 24, center=(xb - 0.064, 0, 0.21), axis='X')
    hd.cyl("R_Glass", 0.048, 0.048, 0.006, 20, center=(xb - 0.072, 0, 0.21), axis='X')
    # volante central de cierre de 3 radios con aro bermellón
    hd.cyl("R_Steel", 0.030, 0.030, 0.055, 16, center=(xb - 0.078, 0, -0.02), axis='X')
    hd.torus("R_Accent", 0.115, 0.012, 28, 8, center=(xb - 0.102, 0, -0.02), axis='X')
    for k in range(3):
        a = k * 2 * PI / 3 + PI / 6
        hd.beam("R_Steel", (xb - 0.102, 0, -0.02), (xb - 0.102, 0.112 * math.cos(a), -0.02 + 0.112 * math.sin(a)), 0.014, 0.012, up=(1, 0, 0))
    # válvula de ecualización + manómetro pequeño en la parte inferior derecha de la escotilla
    gauge(hd, (xb - 0.058, -0.17, -0.16), (-1, 0, 0), radius=0.028)
    knob(hd, "R_Alu", "R_Accent", (xb - 0.058, 0.17, -0.16), (-1, 0, 0), r=0.015, h=0.018)
    # bisagra reforzada en y = +0.44
    hd.cyl("R_Steel", 0.022, 0.022, 0.22, 12, center=(xb - 0.03, 0.44, 0), axis='Z')
    ob = H.P("FWD.INT.HF", "Escotilla de atraque (IDSS)", hd, g, key,
             "Escotilla de paso de 0,80 m con volante de 3 radios, mirilla óptica, seis pestillos y válvula de ecualización.", bevel=None)
    ctl(ob, "hatch:idss")
    mech(ob, "hinge", (xb - 0.03, 0.44, 0), (0, 0, 1), -1.6, 0.0, 0.0, ident="hatch:idss", speed=0.9)

    # --- estación de trabajo robótica RWS (babor) enriquecida con subpanel, reposamuñecas y viseras de pantalla
    s = 1
    rw = MB("n_rws")
    prism(rw, "R_LiningDark", fillet([(s * 0.55, zf), (s * 1.0, zf), (s * 1.0, -0.05), (s * 0.70, 0.02), (s * 0.55, -0.15)], [0, 0, 0.03, 0.04, 0.02], 4), 10.35, 10.95, 'X')
    prism(rw, "R_Alu", rrect(0.014, 0.014, 0.003, cx=s * 0.70, cy=0.024), 10.35, 10.95, 'X')
    # reposamuñecas tapizado + subpanel de control inclinado con botones e indicadores
    cushion(rw, "R_Leather", 0.52, 0.075, 0.024, center=(10.65, s * 0.62, -0.035), R=Matrix.Rotation(D(28), 4, 'X'), puff=0.005, round_=0.010, sub=1, seed=55)
    rw.box("R_Black", 0.46, 0.09, 0.014, center=(10.65, s * 0.87, 0.005), rot=Matrix.Rotation(D(-12), 4, 'X'))
    for bk in range(6):
        bm = "R_Indicator" if bk < 3 else ("R_Warning" if bk == 3 else ("R_Alarm" if bk == 5 else "R_Alu"))
        rw.box(bm, 0.024, 0.018, 0.012, center=(10.48 + bk * 0.068, s * 0.87, 0.014), rot=Matrix.Rotation(D(-12), 4, 'X'))
    louver_grille(rw, "R_Frame", "R_Alu", 0.36, 0.14, depth=0.012, slats=5,
                  M=Matrix.Translation((10.65, s * 0.548, -0.36)) @ rot_to((0, -1, 0), up=(0, 0, 1)))
    # 2 pantallas con marco biselado, visera superior y soporte
    for k in range(2):
        cx_s = 10.48 + k * 0.40
        rw.box("R_Black", 0.36, 0.022, 0.24, center=(cx_s, s * 0.98, 0.45), rot=Matrix.Rotation(D(-14), 4, 'X'))
        rw.box("R_Frame", 0.368, 0.055, 0.010, center=(cx_s, s * 0.955, 0.575), rot=Matrix.Rotation(D(-14), 4, 'X'))  # visera
        rw.cyl("R_Alu", 0.015, 0.015, 0.14, 10, center=(cx_s, s * 1.06, 0.45), axis='Y')
    H.hand_controller(rw, Matrix.Translation((10.55, s * 0.72, 0.02)), rot_handle=False)
    H.hand_controller(rw, Matrix.Translation((10.78, s * 0.72, 0.02)), rot_handle=True)
    H.P("FWD.INT.RWS", "Estación robótica", rw, g, key, "Puesto de control del brazo robótico con pantallas con visera, subpanel y controladores.", bevel=0.003)
    for k in range(2):
        M = Matrix.Translation((10.48 + k * 0.4, s * 0.968, 0.45)) @ Matrix.Rotation(D(-14), 4, 'X') @ rot_to((0, -1, 0), up=(0, 0, 1))
        screen_quad(f"FWD.INT.RWS.S{k+1}", M, 0.33, 0.21, key, g, f"scr:RWS{k+1}", "Pantalla de la estación robótica")

    # --- estribor: estiba EVA detallada (2 bolsas CTB + caja metálica de herramientas EVA asegurada)
    bg = MB("n_bags")
    for k, (bmat, btile) in enumerate((("R_Bag", H.SIGN["ctb7"]), ("R_BagTech", H.SIGN["ctb2"]))):
        M_nb = Matrix.Translation((10.45 + k * 0.56, -0.98, 0.15)) @ Matrix.Rotation(D(-18), 4, 'X') @ rot_to((0, 1, 0), up=(0, 0, 1))
        _ctb_bag(bg, M_nb, 0.21, 0.46, 0.34, body_mat=bmat, handle_mat="R_Accent", seed=40 + k, tile=btile)
    # caja rígida de herramientas EVA en el tercer espacio (x = 11.58)
    M_ev = Matrix.Translation((11.58, -0.98, 0.15)) @ Matrix.Rotation(D(-18), 4, 'X')
    vs_e = bg.box("R_Frame", 0.44, 0.20, 0.30, center=(0, 0, 0))
    vs_e += beveled_frame(bg, "R_Alu", 0.448, 0.308, 0.016, 0.014, M=Matrix.Translation((0, 0.100, 0)) @ rot_to((0, 1, 0), up=(0, 0, 1)))
    for dx_l in (-0.14, 0.14):
        vs_e += bg.box("R_Accent", 0.026, 0.018, 0.055, center=(dx_l, 0.106, 0.06))
    vs_e += bg.tube("R_Accent", [(-0.08, 0.105, -0.05), (-0.07, 0.140, -0.05), (0.07, 0.140, -0.05), (0.08, 0.105, -0.05)], 0.009, 8, round_r=0.015)
    place(bg, vs_e, M_ev)
    H.P("FWD.INT.BAG", "Estiba EVA de acceso rápido", bg, g, key, "Bolsas CTB y caja rígida de herramientas EVA con sujeción rápida.", smooth=50)

    # luminarias del nodo
    led = MB("n_led")
    for a in (D(60), D(120)):
        arc_panel(led, "R_LED", RN - 0.01, RN - 0.004, a - D(2), a + D(2), xa + 0.1, xb - 0.1, 2)
    H.P("FWD.INT.LGT", "Luminarias del nodo", led, g, key)

    # rótulos y placas técnicas del nodo
    H.decal(Matrix.Translation((xa + 0.004, -0.72, 0.15)) @ rot_to((1, 0, 0), up=(0, 0, 1)), 0.30, 0.075, H.SIGN["esclusa"])
    H.decal(Matrix.Translation((xa + 0.004, 0.72, 0.15)) @ rot_to((1, 0, 0), up=(0, 0, 1)), 0.30, 0.075, H.SIGN["cierre"])
    H.decal(Matrix.Translation((xb - 0.048, -0.76, 0.385)) @ rot_to((-1, 0, 0), up=(0, 0, 1)), 0.24, 0.044, H.SIGN["presur"])
    H.decal(Matrix.Translation((xb - 0.006, 0.0, 0.56)) @ rot_to((-1, 0, 0), up=(0, 0, 1)), 0.28, 0.058, H.SIGN["idss"])
    H.decal(Matrix.Translation((10.65, 0.546, -0.19)) @ rot_to((0, -1, 0), up=(0, 0, 1)), 0.28, 0.052, H.SIGN["rws"])
    H.flush_decals(g, key, "FWD.INT.DCL")

    lmark("node1", "area", ((xa + xb) / 2, 0.62, 1.0), 72, (1.0, 0.93, 0.85), (1.6, 0.08), (D(-30), 0, 0), 'N')
    lmark("node2", "area", ((xa + xb) / 2, -0.62, 1.0), 72, (1.0, 0.93, 0.85), (1.6, 0.08), (D(30), 0, 0), 'N')
    lmark("node3", "area", (10.5, 0.0, 1.12), 34, (1.0, 0.93, 0.85), (0.4, 0.4), (0, 0, 0), 'N')
    lmark("node4", "area", (11.65, 0.0, 0.85), 32, (1.0, 0.93, 0.85), (0.6, 0.3), (0, D(-35), 0), 'N')
    lmark("alklip", "point", (xc, 0, zf + 0.12), 14, (1.0, 0.94, 0.86), (0.1, 0.1), (0, 0, 0), 'N')
    lmark("alk", "point", (xc, 0, -2.0), 30, (0.95, 0.97, 1.0), (0.1, 0.1), (0, 0, 0), 'N')
    # la esclusa (interior conservado de Beyond Orbit) pertenece a esta estancia
    for o in bpy.data.objects:
        if o.name.startswith("FWD.ALK.INT"):
            o["room"] = key
