"""
ALCIÓN HX-4 — interior presurizado.

Sección del pasillo: cuadrada de 2,30 m (S.AISLE). Cuatro paredes de
bastidores ("deck", "ceil", "port", "stbd") cuya trasera poligonal sigue el
casco cilíndrico; las esquinas entre bastidores alojan los conductos,
cableado y líneas de fluido (zona de "standoffs", principio análogo al de los
módulos de la ISS, con disposición propia).
"""
import math
import os
import bpy
import bmesh
from mathutils import Vector, Matrix
from .lib import group, part, MB, ring_xyz, TAU, bolt_circle, text_mesh
from .materials import M, MATS
from . import spec as S
from .exterior import lathe_x, shell_profile

PI = math.pi
A2 = S.AISLE / 2.0            # 1,15 m
RACK_W = 0.98                 # anchura (eje X) de un bastidor
XS = [S.X_HAB_A + S.BARREL_L * i for i in range(S.N_BARRELS + 1)]
TEX = os.path.join(os.path.dirname(os.path.dirname(__file__)), "textures")

# sección trasera del bastidor (y, z) en coordenadas locales: z=0 cara frontal
RACK_SECTION = [(-1.10, 0.0), (1.10, 0.0), (1.10, -0.47), (0.55, -0.79), (-0.55, -0.79), (-1.10, -0.47)]


def wall_matrix(wall, x):
    if wall == "deck":
        return Matrix.Translation((x, 0, -A2))
    if wall == "ceil":
        return Matrix.Translation((x, 0, A2)) @ Matrix.Rotation(PI, 4, 'X')
    if wall == "port":
        return Matrix.Translation((x, A2, 0)) @ Matrix.Rotation(PI / 2, 4, 'X')
    if wall == "stbd":
        return Matrix.Translation((x, -A2, 0)) @ Matrix.Rotation(-PI / 2, 4, 'X')
    raise ValueError(wall)


WALL_LBL = {"deck": "suelo", "ceil": "techo", "port": "babor", "stbd": "estribor"}


# ---------------------------------------------------------------------------
# materiales de pantalla con textura de interfaz
# ---------------------------------------------------------------------------

def screen_mat(key):
    name = f"M_Screen_{key}"
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes.get("Principled BSDF")
    img = bpy.data.images.load(os.path.join(TEX, f"ui_{key.lower()}.png"))
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    nt.links.new(tex.outputs["Color"], b.inputs["Base Color"])
    nt.links.new(tex.outputs["Color"], b.inputs["Emission Color"])
    b.inputs["Emission Strength"].default_value = 2.2
    b.inputs["Roughness"].default_value = 0.08
    m["desc"] = "Pantalla LCD de cabina (interfaz ficticia)"
    MATS[name] = m
    return m


def screen_mesh(name, w, h, key):
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    v = [bm.verts.new(p) for p in ((-w / 2, -h / 2, 0), (w / 2, -h / 2, 0), (w / 2, h / 2, 0), (-w / 2, h / 2, 0))]
    f = bm.faces.new(v)
    for loop, (u, vv) in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
        loop[uv].uv = (u, vv)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(screen_mat(key))
    return me


# ---------------------------------------------------------------------------
# bastidores
# ---------------------------------------------------------------------------
_SHARED = {}


def shared(key, fn):
    if key not in _SHARED:
        _SHARED[key] = fn()
    return _SHARED[key]


def rack_body_mesh():
    mb = MB("rack_body")
    sec = RACK_SECTION
    w = RACK_W
    bot = [Vector((-w / 2, y, z - 0.03)) for (y, z) in sec]
    top = [Vector((w / 2, y, z - 0.03)) for (y, z) in sec]
    mb.poly("M_InteriorDark", bot, top)
    # postes frontales y marco
    for y in (-1.10, 1.10):
        mb.box("M_AlBare", w, 0.04, 0.05, center=(0, y - math.copysign(0.02, y), -0.025))
    for x in (-w / 2 + 0.02, w / 2 - 0.02):
        mb.box("M_AlBare", 0.04, 2.20, 0.05, center=(x, 0, -0.025))
    # pivotes de giro (para abatir el bastidor hacia el pasillo en mantenimiento)
    for x in (-w / 2 + 0.06, w / 2 - 0.06):
        mb.cyl("M_Steel", 0.025, 0.025, 0.06, 12, center=(x, -1.05, -0.7), axis='X')
    return mb.mesh(smooth=None, bevel=0.005)


def locker_mesh(w=0.44, h=0.34):
    mb = MB(f"locker_{w:.2f}_{h:.2f}")
    mb.box("M_InteriorPanel", w - 0.012, h - 0.012, 0.022, center=(0, 0, 0.011))
    mb.box("M_InteriorGrey", w - 0.06, 0.035, 0.012, center=(0, -h / 2 + 0.045, 0.028))  # tirador
    for x in (-w / 2 + 0.03, w / 2 - 0.03):
        mb.cyl("M_Steel", 0.008, 0.008, 0.006, 10, center=(x, h / 2 - 0.03, 0.025), axis='Z')
    mb.box("M_ShieldWhite", 0.10, 0.035, 0.002, center=(w / 2 - 0.085, h / 2 - 0.035, 0.023))
    mb.box("M_Decal", 0.07, 0.008, 0.001, center=(w / 2 - 0.085, h / 2 - 0.035, 0.0245))
    return mb.mesh(smooth=None, bevel=0.003)


def handrail_int_mesh():
    mb = MB("ivahandrail")
    mb.tube("M_Handrail", [(-0.22, 0, 0.0), (-0.20, 0, 0.06), (0.20, 0, 0.06), (0.22, 0, 0.0)], 0.013, 10, round_r=0.03)
    for x in (-0.22, 0.22):
        mb.box("M_AlBare", 0.05, 0.04, 0.01, center=(x, 0, 0.005))
    return mb.mesh(smooth=45)


def place(code, label, me, parent, W, local=Matrix.Identity(4), explode=None, desc="", func=None):
    p = part(code, label, me, parent, explode=explode, desc=desc, func=func)
    p.matrix_basis = W @ local
    return p


def L(x=0.0, y=0.0, z=0.0, rx=0.0, ry=0.0, rz=0.0):
    return (Matrix.Translation((x, y, z)) @ Matrix.Rotation(rz, 4, 'Z') @ Matrix.Rotation(ry, 4, 'Y') @ Matrix.Rotation(rx, 4, 'X'))


def rack(parent, code, label, wall, x, desc="", lockers=True, grid=(2, 6), func=None):
    """Bastidor estándar: cuerpo + rejilla de taquillas + pasamanos."""
    W = wall_matrix(wall, x)
    n_world = (W.to_3x3() @ Vector((0, 0, 1))).normalized()
    g = group(code, label, parent, explode=("radial", 1.0), desc=desc, func=func)
    g["wall"] = wall
    place(f"{code}.BDY", "Estructura del bastidor", shared("rack_body", rack_body_mesh), g, W, explode=("none", 0),
          desc="Bastidor de compuesto con trasera poligonal adaptada al casco, pivotable para acceso a utilidades.")
    if lockers:
        nx, ny = grid
        lw = (RACK_W - 0.04) / nx
        lh = 2.16 / ny
        lm = shared(f"locker_{nx}_{ny}", lambda: locker_mesh(lw, lh))
        for i in range(nx):
            for j in range(ny):
                xx = -RACK_W / 2 + 0.02 + lw * (i + 0.5)
                yy = -1.08 + lh * (j + 0.5)
                place(f"{code}.L{i+1}{j+1}", f"Taquilla {i+1}-{j+1}", lm, g, W, L(xx, yy, 0.0),
                      explode=tuple(n_world * 0.25), desc="Taquilla de estiba con cierre de leva y etiqueta de inventario RFID.")
    place(f"{code}.HR", "Pasamanos interior", shared("ivahr", handrail_int_mesh), g, W, L(0, 1.0 if wall != "deck" else -1.0, 0.0),
          explode=tuple(n_world * 0.4), desc="Pasamanos IVA de aluminio anodizado.")
    return g, W, n_world


def front_panel(mb, w, h, mat="M_InteriorPanel", z=0.0):
    mb.box(mat, w, h, 0.02, center=(0, 0, z + 0.01))


# ---------------------------------------------------------------------------
# Construcción del interior
# ---------------------------------------------------------------------------

def build_interior(hab):
    it = group("HAB.INT", "Equipamiento interior presurizado", hab, explode=(0, 0, -7.0),
               desc="Interior organizado en 4 bahías de 2,05 m (cabina de vuelo, laboratorio, refugio/habitáculos, servicios) más el mamparo de popa.",
               func="Habitabilidad para 4 tripulantes durante salidas de hasta 45 días (hipótesis)")
    bays = [
        ("A", "Bahía A — Cabina de vuelo", "Puesto de pilotaje con 4 asientos, 2 consolas de 3 pantallas y paneles de mando cenitales."),
        ("B", "Bahía B — Laboratorio", "Guantera científica, congeladores de muestras, bastidores experimentales y estación de observación de nadir."),
        ("C", "Bahía C — Habitáculos y refugio antiradiación", "Cuatro habitáculos individuales rodeados por el muro de agua (refugio para eventos de partículas solares)."),
        ("D", "Bahía D — Servicios y soporte vital", "Cocina, compartimento de higiene, equipos de soporte vital y dispositivo de ejercicio."),
    ]
    xb = {"A": (XS[3], XS[4]), "B": (XS[2], XS[3]), "C": (XS[1], XS[2]), "D": (XS[0], XS[1])}
    groups = {}
    for key, lbl, desc in bays:
        groups[key] = group(f"HAB.INT.{key}", lbl, it, explode=("axial", 2.2), desc=desc)
    _bay_A(groups["A"], *xb["A"])
    _bay_B(groups["B"], *xb["B"])
    _bay_C(groups["C"], *xb["C"])
    _bay_D(groups["D"], *xb["D"])
    _aft_bulkhead(it)
    _utilities(hab)
    _lighting(it)
    return it


def _x2(x0, x1):
    xc = (x0 + x1) / 2
    return xc - RACK_W / 2 - 0.02, xc + RACK_W / 2 + 0.02


# --- Bahía A: cabina de vuelo ----------------------------------------------

def seat_mesh(cmd=False):
    mb = MB("seat_cmd" if cmd else "seat")
    # coordenadas locales: el tripulante mira a +X, +Z "arriba" de cabina
    # bastidor tubular
    for y in (-0.24, 0.24):
        mb.tube("M_AlBare", [(-0.30, y, -0.55), (-0.30, y, -0.20), (0.15, y, -0.20), (0.32, y, -0.05)], 0.018, 10, round_r=0.05)
        mb.tube("M_AlBare", [(-0.30, y, -0.20), (-0.42, y, 0.45)], 0.018, 10)
    mb.tube("M_AlBare", [(-0.30, -0.24, -0.55), (-0.30, 0.24, -0.55)], 0.02, 10)
    mb.tube("M_AlBare", [(0.32, -0.24, -0.05), (0.32, 0.24, -0.05)], 0.016, 10)
    # asiento y respaldo
    mb.box("M_InteriorGrey", 0.46, 0.50, 0.03, center=(-0.06, 0, -0.17))
    mb.box("M_SeatCushion", 0.44, 0.46, 0.06, center=(-0.06, 0, -0.125))
    R = Matrix.Rotation(-0.18, 4, 'Y')
    mb.box("M_InteriorGrey", 0.03, 0.50, 0.66, center=(-0.37, 0, 0.13), rot=R)
    mb.box("M_SeatCushion", 0.06, 0.46, 0.62, center=(-0.33, 0, 0.13), rot=R)
    mb.box("M_SeatCushion", 0.08, 0.28, 0.18, center=(-0.40, 0, 0.56), rot=R)
    for y in (-0.17, 0.17):
        mb.box("M_SeatCushion", 0.07, 0.07, 0.22, center=(-0.35, y, 0.56), rot=R)
    # arnés de 5 puntos
    for y in (-0.12, 0.12):
        mb.box("M_FabricBlue", 0.012, 0.045, 0.52, center=(-0.285, y, 0.15), rot=R)
    mb.box("M_FabricBlue", 0.012, 0.42, 0.045, center=(-0.11, 0, -0.085))
    mb.cyl("M_AlBare", 0.045, 0.045, 0.02, 20, center=(-0.12, 0, -0.07), axis='X')
    # apoyabrazos
    for y in (-0.29, 0.29):
        mb.box("M_InteriorGrey", 0.36, 0.07, 0.04, center=(-0.12, y, 0.02))
        mb.box("M_AlBare", 0.03, 0.03, 0.18, center=(-0.24, y, -0.07))
    if cmd:
        # controladores manuales de traslación (izq.) y rotación (dcha.)
        mb.cyl("M_AlAnodBlack", 0.035, 0.035, 0.07, 16, center=(0.02, 0.29, 0.08), axis='Z')
        mb.sphere("M_InteriorDark", 0.04, 16, 8, center=(0.02, 0.29, 0.14), scale=(1, 1, 1.4))
        mb.box("M_AlAnodBlack", 0.07, 0.07, 0.06, center=(0.02, -0.29, 0.07))
        mb.cyl("M_InteriorDark", 0.02, 0.03, 0.12, 16, center=(0.02, -0.29, 0.15), axis='Z')
    # reposapiés
    mb.tube("M_AlBare", [(0.32, -0.24, -0.05), (0.62, -0.20, -0.30), (0.62, 0.20, -0.30), (0.32, 0.24, -0.05)], 0.016, 10, round_r=0.06)
    mb.box("M_Rubber", 0.10, 0.40, 0.02, center=(0.62, 0, -0.31))
    return mb.mesh(smooth=40)


def console_mesh(side):
    mb = MB(f"console_{side}")
    # pedestal anclado al suelo, panel inclinado mirando a -X (hacia los asientos)
    mb.box("M_InteriorDark", 0.30, 0.78, 0.70, center=(0.0, 0, -0.80))
    R = Matrix.Rotation(-0.55, 4, 'Y')
    mb.box("M_InteriorGrey", 0.08, 0.86, 0.62, center=(-0.05, 0, -0.18), rot=R)
    mb.box("M_InteriorDark", 0.04, 0.80, 0.56, center=(-0.10, 0, -0.17), rot=R)
    # filas de teclas de bisel
    for k in range(6):
        for s in (-1, 1):
            mb.box("M_InteriorGrey", 0.02, 0.035, 0.025, center=(-0.12, s * 0.38, -0.40 + 0.08 * k), rot=R)
    mb.box("M_InteriorGrey", 0.28, 0.70, 0.04, center=(-0.22, 0, -0.50))
    for k in range(12):
        for j in range(3):
            mb.box("M_InteriorDark", 0.03, 0.045, 0.012, center=(-0.28 + 0.06 * j, -0.30 + 0.055 * k, -0.475))
    mb.tube("M_Handrail", [(-0.30, -0.42, -0.42), (-0.36, -0.42, -0.36), (-0.36, 0.42, -0.36), (-0.30, 0.42, -0.42)], 0.012, 10, round_r=0.04)
    return mb.mesh(smooth=35, bevel=0.006)


def switch_panel_mesh():
    mb = MB("switch_panel")
    mb.box("M_InteriorGrey", 0.90, 1.10, 0.04, center=(0, 0, 0.02))
    for r in range(4):
        for c in range(9):
            x = -0.36 + c * 0.09
            y = -0.42 + r * 0.26
            mb.box("M_AlBare", 0.045, 0.06, 0.012, center=(x, y, 0.046))
            mb.cyl("M_Steel", 0.006, 0.006, 0.04, 8, center=(x, y + 0.012, 0.07), axis='Z')
            mb.box("M_LEDGreen" if (r + c) % 3 else "M_LEDRed", 0.012, 0.012, 0.004, center=(x, y + 0.045, 0.043))
        mb.box("M_ShieldWhite", 0.80, 0.02, 0.002, center=(0, -0.42 + r * 0.26 - 0.06, 0.041))
    return mb.mesh(smooth=None)


def _bay_A(g, x0, x1):
    xa, xb = _x2(x0, x1)
    # paredes: suelo/techo/babor/estribor
    rack(g, "HAB.INT.A.DK1", "Bastidor de estiba de suelo A1", "deck", xa, "Estiba de repuestos de aviónica y kits de emergencia.")
    rack(g, "HAB.INT.A.DK2", "Bastidor de estiba de suelo A2", "deck", xb, "Estiba de trajes de presión IVA (4 unidades).")
    gc, W, n = rack(g, "HAB.INT.A.CL1", "Panel de mando cenital", "ceil", xb, "Paneles de interruptores de los buses de potencia, armado de RCS y pirotecnia.", lockers=False)
    place("HAB.INT.A.CL1.SW", "Panel de interruptores cenital", shared("swp", switch_panel_mesh), gc, W, L(0, 0.0, 0.0),
          explode=tuple(n * 0.3), desc="36 interruptores protegidos con indicadores LED de estado.")
    place("HAB.INT.A.CL1.SCR", "Pantalla de estado de buses", screen_mesh("scr_switch", 0.55, 0.34, "SWITCH"), gc, W, L(0, 0.0, 0.08),
          explode=tuple(n * 0.45), desc="Sinóptico de distribución eléctrica.")
    rack(g, "HAB.INT.A.CL2", "Bastidor de estiba cenital A", "ceil", xa, "Estiba de procedimientos y equipos de fotografía.")
    for side, wall in (("P", "port"), ("S", "stbd")):
        gw, W, n = rack(g, f"HAB.INT.A.{side}W", f"Estación de vuelo lateral ({WALL_LBL[wall]})", wall, xb,
                        "Bastidor de aviónica de cabina con pantalla multifunción auxiliar.", lockers=False)
        mb = MB(f"avx_front_{side}")
        front_panel(mb, RACK_W - 0.04, 2.16, "M_InteriorGrey")
        mb.box("M_InteriorDark", 0.62, 0.42, 0.03, center=(0, 0.45, 0.03))
        for k in range(8):
            mb.box("M_InteriorPanel", 0.08, 0.03, 0.03, center=(-0.30 + 0.085 * k, 0.18, 0.03))
        for k in range(10):
            mb.box("M_AlAnodBlack", 0.86, 0.008, 0.012, center=(0, -0.95 + 0.06 * k, 0.026))
        place(f"HAB.INT.A.{side}W.FRT", "Panel frontal de aviónica", mb.mesh(smooth=None), gw, W, explode=tuple(n * 0.3),
              desc="Panel con rejilla de ventilación forzada y teclado de función.")
        place(f"HAB.INT.A.{side}W.SCR", "Pantalla multifunción auxiliar", screen_mesh(f"scr_aux_{side}", 0.56, 0.36, "ECLSS" if side == "P" else "TRAJ"),
              gw, W, L(0, 0.45, 0.047), explode=tuple(n * 0.45), desc="Pantalla de 26\" de sistemas.")
        rack(g, f"HAB.INT.A.{side}2", f"Bastidor de estiba A ({WALL_LBL[wall]})", wall, xa, "Estiba de uso diario.")
    # consolas y asientos
    cg = group("HAB.INT.A.CNS", "Consolas de pilotaje", g, explode=(0.0, 0, 0.9),
               desc="Dos consolas independientes (comandante y piloto) con 3 pantallas cada una; el pasillo central queda libre hacia la escotilla del nodo.")
    for i, (y, lbl) in enumerate(((0.62, "comandante"), (-0.62, "piloto"))):
        sub = group(f"HAB.INT.A.CNS.C{i+1}", f"Consola del {lbl}", cg, explode=(0, 0.5 * (1 if y > 0 else -1), 0))
        Wc = Matrix.Translation((x1 - 0.22, y, -0.15))
        place(f"HAB.INT.A.CNS.C{i+1}.STR", "Pedestal y bisel", shared(f"console", lambda: console_mesh("x")), sub, Wc,
              explode=("none", 0), desc="Pedestal con electrónica de pantalla y teclado de entrada de datos.")
        keys = ("PFD", "TRAJ", "CAMERA") if i == 0 else ("CAMERA", "PFD", "ECLSS")
        for k, key in enumerate(keys):
            yy = (-0.27 + 0.27 * k)
            Rp = Matrix.Translation((-0.105, yy, -0.18)) @ Matrix.Rotation(-0.55, 4, 'Y') @ Matrix.Rotation(-PI / 2, 4, 'Y') @ Matrix.Rotation(PI / 2, 4, 'Z')
            place(f"HAB.INT.A.CNS.C{i+1}.D{k+1}", f"Pantalla de vuelo {k+1}", screen_mesh(f"scr_{i}_{k}", 0.25, 0.34, key), sub, Wc @ Rp,
                  explode=(-0.25, 0, 0.12), desc="Pantalla táctil de 13\" de alto brillo con unidad de visualización redundante.")
    sg = group("HAB.INT.A.SEAT", "Asientos de tripulación", g, explode=(-0.6, 0, 0.5),
               desc="4 asientos con arnés de 5 puntos para fases dinámicas (encendidos de motor, atraque).")
    for i, (x, y, cmd, lbl) in enumerate([(x1 - 1.05, 0.62, True, "Comandante"), (x1 - 1.05, -0.62, True, "Piloto"),
                                           (x0 + 0.42, 0.62, False, "Especialista 1"), (x0 + 0.42, -0.62, False, "Especialista 2")]):
        z = -0.42 if cmd else -0.30
        p = part(f"HAB.INT.A.SEAT.S{i+1}", f"Asiento {lbl}", shared(f"seat_{cmd}", lambda: seat_mesh(cmd)), sg,
                 loc=(x, y, z), explode=("auto", 0.5), desc="Asiento de CFRP/aluminio con amortiguación, regulable en altura" + (" con controladores manuales de traslación y rotación." if cmd else "."))


# --- Bahía B: laboratorio ---------------------------------------------------

def glovebox_mesh():
    mb = MB("glovebox")
    front_panel(mb, RACK_W - 0.04, 2.16, "M_InteriorPanel")
    mb.box("M_InteriorGrey", 0.88, 0.95, 0.38, center=(0, 0.25, 0.19))
    mb.box("M_GlassInner", 0.80, 0.70, 0.01, center=(0, 0.30, 0.385))
    mb.box("M_Glass", 0.80, 0.70, 0.005, center=(0, 0.30, 0.39))
    for x in (-0.2, 0.2):
        mb.torus("M_InteriorDark", 0.075, 0.018, 24, 8, center=(x, -0.12, 0.39), axis='Z')
        mb.cyl("M_Rubber", 0.07, 0.05, 0.25, 16, center=(x, -0.12, 0.27), axis='Z')
    mb.box("M_LED", 0.70, 0.02, 0.01, center=(0, 0.66, 0.37))
    mb.box("M_InteriorDark", 0.88, 0.20, 0.06, center=(0, -0.55, 0.03))
    for k in range(5):
        mb.cyl("M_AlBare", 0.015, 0.015, 0.02, 12, center=(-0.3 + 0.15 * k, -0.55, 0.07), axis='Z')
    return mb.mesh(smooth=None)


def freezer_mesh():
    mb = MB("freezer")
    front_panel(mb, RACK_W - 0.04, 2.16, "M_InteriorPanel")
    for j in range(4):
        y = -0.80 + 0.52 * j
        mb.box("M_ShieldWhite", 0.86, 0.46, 0.05, center=(0, y, 0.035))
        mb.box("M_InteriorGrey", 0.40, 0.04, 0.03, center=(0, y - 0.18, 0.075))
        mb.box("M_LEDGreen", 0.03, 0.015, 0.006, center=(0.36, y + 0.18, 0.063))
        mb.box("M_ScreenAmber", 0.12, 0.05, 0.004, center=(0.27, y + 0.18, 0.062))
    return mb.mesh(smooth=None)


def exp_rack_mesh(seed):
    import random
    rnd = random.Random(seed)
    mb = MB(f"exp_rack_{seed}")
    front_panel(mb, RACK_W - 0.04, 2.16, "M_InteriorGrey")
    y = -1.05
    while y < 0.95:
        h = rnd.choice([0.18, 0.26, 0.34, 0.44])
        if y + h > 1.05:
            h = 1.05 - y
        mb.box(rnd.choice(["M_InteriorPanel", "M_AlChromate", "M_InteriorPanel", "M_AlBare"]), 0.86, h - 0.02, 0.06, center=(0, y + h / 2, 0.04))
        for k in range(rnd.randint(1, 4)):
            mb.cyl("M_GoldPlate", 0.012, 0.012, 0.03, 10, center=(-0.35 + 0.08 * k, y + h / 2, 0.08), axis='Z')
        mb.box(rnd.choice(["M_LEDGreen", "M_LEDRed", "M_LEDGreen"]), 0.015, 0.015, 0.005, center=(0.38, y + h - 0.04, 0.073))
        y += h
    return mb.mesh(smooth=None)


def _bay_B(g, x0, x1):
    xa, xb = _x2(x0, x1)
    gw, W, n = rack(g, "HAB.INT.B.PG", "Guantera científica", "port", xb, "Volumen de trabajo sellado con presión negativa, filtración HEPA e iluminación propia.", lockers=False,
                    func="Manipulación segura de muestras lunares y experimentos biológicos")
    place("HAB.INT.B.PG.GBX", "Guantera (ventana, puertos de guantes, filtros)", shared("gbx", glovebox_mesh), gw, W, explode=tuple(n * 0.4))
    gw, W, n = rack(g, "HAB.INT.B.PF", "Congelador de muestras −80 °C", "port", xa, "4 cajones de congelación criogénica por ciclo Stirling.", lockers=False)
    place("HAB.INT.B.PF.FRZ", "Cajones de congelación", shared("frz", freezer_mesh), gw, W, explode=tuple(n * 0.4))
    for i, xx in enumerate((xa, xb)):
        gw, W, n = rack(g, f"HAB.INT.B.SE{i+1}", f"Bastidor experimental {i+1}", "stbd", xx, "Bastidor de cargas útiles intercambiables con interfaces de potencia, datos, vacío y refrigeración.", lockers=False)
        place(f"HAB.INT.B.SE{i+1}.EXP", "Cargas útiles experimentales", exp_rack_mesh(i + 3), gw, W, explode=tuple(n * 0.4))
    rack(g, "HAB.INT.B.CL1", "Bastidor de estiba cenital B1", "ceil", xa, "Consumibles científicos.")
    rack(g, "HAB.INT.B.CL2", "Bastidor de estiba cenital B2", "ceil", xb, "Consumibles científicos.")
    # estación de observación de nadir sobre las ventanas
    og = group("HAB.INT.B.NAD", "Estación de observación de nadir", g, explode=(0, 0, -1.0),
               desc="Pozos de ventana con cámaras científicas, cubiertas internas de protección y asideros.")
    from .exterior import LAB_WINDOWS_X
    for i, xw in enumerate(LAB_WINDOWS_X):
        mb = MB(f"nadir_well_{i}")
        mb.lathe("M_InteriorPanel", [(0.24, -2.05), (0.27, -2.05), (0.27, -A2 + 0.01), (0.24, -A2 + 0.01), (0.24, -2.05)], 32, axis='Z', center=(xw, 0, 0))
        mb.torus("M_InteriorDark", 0.27, 0.02, 32, 8, center=(xw, 0, -A2 + 0.02), axis='Z')
        mb.cyl("M_GlassInner", 0.205, 0.205, 0.008, 32, center=(xw, 0, -2.04), axis='Z')
        place(f"HAB.INT.B.NAD.W{i+1}", f"Pozo de ventana de nadir {i+1}", mb.mesh(), og, Matrix.Identity(4), explode=(0, 0, -0.3),
              desc="Túnel de ventana con panel interior antirayado.")
    mb = MB("nadir_camera")
    mb.box("M_AlAnodBlack", 0.16, 0.12, 0.10, center=(0, 0, 0.0))
    mb.cyl("M_AlAnodBlack", 0.05, 0.05, 0.22, 20, center=(0, 0, -0.14), axis='Z')
    mb.cyl("M_Lens", 0.045, 0.045, 0.005, 20, center=(0, 0, -0.25), axis='Z')
    mb.box("M_AlBare", 0.35, 0.04, 0.02, center=(0.12, 0, 0.06))
    place("HAB.INT.B.NAD.CAM", "Cámara científica de nadir", mb.mesh(), og, Matrix.Translation((LAB_WINDOWS_X[0], 0.0, -A2 + 0.16)),
          explode=(0, 0, 0.4), desc="Cámara multiespectral montada sobre brazo de bloqueo.")
    for i, xx in enumerate((xa, xb)):
        W = wall_matrix("deck", xx)
        mb = MB(f"nadir_closeout_{i}")
        xw = LAB_WINDOWS_X[i] - xx
        # paneles de suelo alrededor del pozo
        mb.box("M_InteriorPanel", RACK_W - 0.04, 0.80, 0.02, center=(0, 0.66, 0.01))
        mb.box("M_InteriorPanel", RACK_W - 0.04, 0.80, 0.02, center=(0, -0.66, 0.01))
        mb.box("M_InteriorDark", RACK_W - 0.04, 0.04, 0.03, center=(0, 0.27, 0.015))
        mb.box("M_InteriorDark", RACK_W - 0.04, 0.04, 0.03, center=(0, -0.27, 0.015))
        for s in (-1, 1):
            mb.tube("M_Handrail", [(-0.3, s * 0.38, 0.0), (-0.28, s * 0.38, 0.06), (0.28, s * 0.38, 0.06), (0.3, s * 0.38, 0.0)], 0.012, 8, round_r=0.03)
        place(f"HAB.INT.B.NAD.CLS{i+1}", f"Paneles de cierre de suelo {i+1}", mb.mesh(smooth=None), og, W, explode=(0, 0, -0.15),
              desc="Paneles de suelo alrededor de los pozos con asideros para fijación de los pies.")


# --- Bahía C: habitáculos y refugio ----------------------------------------

def cq_mesh(open_door=True):
    mb = MB("crew_quarter")
    w = RACK_W - 0.04
    # caja interior del habitáculo (paredes laterales y trasera)
    mb.box("M_InteriorPanel", 0.02, 2.14, 0.70, center=(-w / 2 + 0.01, 0, -0.35))
    mb.box("M_InteriorPanel", 0.02, 2.14, 0.70, center=(w / 2 - 0.01, 0, -0.35))
    mb.box("M_InteriorPanel", w, 0.02, 0.70, center=(0, 1.06, -0.35))
    mb.box("M_InteriorPanel", w, 0.02, 0.70, center=(0, -1.06, -0.35))
    mb.box("M_HDPE", w, 2.12, 0.03, center=(0, 0, -0.70))
    # marco frontal
    for x in (-w / 2, w / 2):
        mb.box("M_InteriorGrey", 0.04, 2.16, 0.04, center=(x, 0, 0.0))
    for y in (-1.08, 1.08):
        mb.box("M_InteriorGrey", w, 0.04, 0.04, center=(0, y, 0.0))
    # puerta plegada (acordeón) a un lado
    for k in range(6):
        mb.box("M_InteriorPanel", 0.025, 2.05, 0.10, center=(w / 2 - 0.05 - 0.028 * k, 0, 0.03 + (0.025 if k % 2 else 0.0)), rot=Matrix.Rotation(0.5 if k % 2 else -0.5, 4, 'Y'))
    return mb.mesh(smooth=None)


def sleeping_bag_mesh():
    mb = MB("sleeping_bag")
    mb.box("M_FabricBlue", 0.50, 1.75, 0.16, center=(0, -0.05, -0.50))
    mb.sphere("M_FabricBlue", 0.25, 16, 8, center=(0, 0.80, -0.50), scale=(1, 0.5, 0.35))
    for k in range(5):
        mb.box("M_Fabric", 0.52, 0.03, 0.17, center=(0, -0.8 + 0.35 * k, -0.50))
    for y in (-0.6, 0.6):
        mb.box("M_FabricBlue", 0.04, 0.04, 0.32, center=(0.24, y, -0.42))
    return mb.mesh(smooth=50)


def cq_equipment_mesh():
    mb = MB("cq_equipment")
    # portátil en brazo articulado
    mb.tube("M_AlBare", [(-0.40, 0.55, -0.62), (-0.30, 0.55, -0.40), (-0.15, 0.50, -0.30)], 0.012, 8, round_r=0.05)
    mb.box("M_InteriorDark", 0.30, 0.22, 0.015, center=(-0.12, 0.48, -0.28), rot=Matrix.Rotation(-0.4, 4, 'X'))
    mb.box("M_InteriorGrey", 0.30, 0.20, 0.012, center=(-0.12, 0.55, -0.18), rot=Matrix.Rotation(-1.3, 4, 'X'))
    # luz de lectura y difusor de ventilación
    mb.cyl("M_LED", 0.05, 0.05, 0.012, 20, center=(0.0, 0.95, -0.35), axis='Y')
    mb.box("M_InteriorGrey", 0.25, 0.02, 0.18, center=(0.25, 1.04, -0.35))
    for k in range(6):
        mb.box("M_InteriorDark", 0.22, 0.004, 0.008, center=(0.25, 1.03, -0.42 + 0.028 * k))
    # red de estiba personal
    for k in range(7):
        mb.box("M_Fabric", 0.005, 0.60, 0.005, center=(0.42, -0.6 + 0.0, -0.65 + 0.04 * k))
        mb.box("M_Fabric", 0.005, 0.005, 0.26, center=(0.42, -0.9 + 0.1 * k, -0.53))
    return mb.mesh(smooth=None)


def water_wall_mesh():
    mb = MB("water_wall")
    # bolsas de agua acolchadas entre la trasera del habitáculo y el casco
    for j in range(4):
        for i in range(2):
            mb.box("M_Water", 0.44, 0.50, 0.08, center=(-0.23 + 0.46 * i, -0.78 + 0.52 * j, -0.76))
            mb.box("M_Fabric", 0.45, 0.02, 0.09, center=(-0.23 + 0.46 * i, -0.78 + 0.52 * j + 0.25, -0.76))
    return mb.mesh(smooth=None)


def water_tank_rack_mesh():
    mb = MB("water_tank_rack")
    front_panel(mb, RACK_W - 0.04, 2.16, "M_InteriorPanel")
    for j in range(3):
        y = -0.72 + 0.72 * j
        mb.box("M_Water", 0.86, 0.66, 0.40, center=(0, y, -0.30))
        mb.cyl("M_AlBare", 0.03, 0.03, 0.05, 12, center=(0.30, y + 0.2, 0.03), axis='Z')
        mb.box("M_ShieldWhite", 0.20, 0.05, 0.003, center=(-0.25, y + 0.25, 0.022))
    return mb.mesh(smooth=None)


def _bay_C(g, x0, x1):
    xa, xb = _x2(x0, x1)
    k = 0
    for wall in ("port", "stbd"):
        for xx in (xa, xb):
            k += 1
            W = wall_matrix(wall, xx)
            n = (W.to_3x3() @ Vector((0, 0, 1))).normalized()
            cg = group(f"HAB.INT.C.CQ{k}", f"Habitáculo de tripulante {k}", g, explode=("radial", 1.2),
                       desc="Habitáculo individual de ~1,3 m³ con saco de dormir, puesto informático, luz, ventilación propia y paredes de HDPE.",
                       func="Descanso, privacidad y refugio frente a radiación")
            place(f"HAB.INT.C.CQ{k}.ENC", "Envolvente y puerta plegable", shared("cq", cq_mesh), cg, W, explode=("none", 0),
                  desc="Paneles de compuesto con capa de polietileno de alta densidad (HDPE) y puerta acordeón acústica.")
            place(f"HAB.INT.C.CQ{k}.BAG", "Saco de dormir con sujeciones", shared("bag", sleeping_bag_mesh), cg, W, explode=tuple(n * 0.6))
            place(f"HAB.INT.C.CQ{k}.EQP", "Portátil, luz, ventilación y red de estiba", shared("cqe", cq_equipment_mesh), cg, W, explode=tuple(n * 0.9))
            place(f"HAB.INT.C.CQ{k}.WTR", "Bolsas del muro de agua", shared("ww", water_wall_mesh), cg, W, explode=tuple(-n * 0.5),
                  desc="Bolsas de agua potable de reserva que añaden ~8 g/cm² de blindaje en la trasera del habitáculo.")
    for wall in ("deck", "ceil"):
        for i, xx in enumerate((xa, xb)):
            gw, W, n = rack(g, f"HAB.INT.C.{wall.upper()[:2]}{i+1}", f"Depósito del muro de agua ({WALL_LBL[wall]} {i+1})", wall, xx,
                            "Depósitos de agua flexibles que completan el blindaje del refugio por encima y por debajo.", lockers=False,
                            func="Blindaje frente a eventos de partículas solares")
            place(f"{gw.name}.TNK", "Depósitos de agua flexibles", shared("wtr", water_tank_rack_mesh), gw, W, explode=tuple(n * 0.3))


# --- Bahía D: servicios -----------------------------------------------------

def galley_mesh():
    mb = MB("galley")
    front_panel(mb, RACK_W - 0.04, 2.16, "M_InteriorPanel")
    mb.box("M_AlBare", 0.80, 0.45, 0.25, center=(0, 0.45, 0.13))  # calentador
    mb.box("M_InteriorDark", 0.70, 0.35, 0.01, center=(0, 0.45, 0.26))
    mb.box("M_ScreenAmber", 0.12, 0.05, 0.004, center=(0.30, 0.71, 0.03))
    for k in range(3):
        mb.cyl("M_Steel", 0.015, 0.015, 0.10, 12, center=(-0.25 + 0.25 * k, -0.10, 0.08), axis='Z')
        mb.cyl("M_InteriorDark", 0.03, 0.03, 0.04, 12, center=(-0.25 + 0.25 * k, -0.10, 0.03), axis='Z')
    # mesa abatible desplegada, perpendicular a la pared
    mb.box("M_InteriorGrey", 0.85, 0.025, 0.52, center=(0, -0.55, 0.28))
    mb.box("M_AlBare", 0.86, 0.04, 0.03, center=(0, -0.55, 0.015))
    for x in (-0.4, 0.4):
        mb.tube("M_AlBare", [(x, -0.56, 0.02), (x, -0.85, 0.02), (x, -0.57, 0.50)], 0.008, 8)
    for k in range(6):
        mb.box("M_Fabric", 0.12, 0.008, 0.09, center=(-0.30 + 0.12 * k, -0.535, 0.30))
    for x in (-0.3, 0.3):
        mb.box("M_FabricBlue", 0.02, 0.004, 0.50, center=(x, -0.534, 0.28))
    return mb.mesh(smooth=None)


def hygiene_mesh():
    mb = MB("hygiene")
    w = RACK_W - 0.04
    mb.box("M_InteriorPanel", w, 2.16, 0.02, center=(0, 0, -0.70))
    for x in (-w / 2, w / 2):
        mb.box("M_InteriorPanel", 0.02, 2.16, 0.70, center=(x, 0, -0.35))
    # inodoro (embudo, asiento y unidad de separación)
    mb.box("M_AlBare", 0.40, 0.40, 0.40, center=(0, -0.70, -0.45))
    mb.cyl("M_ShieldWhite", 0.15, 0.18, 0.12, 24, center=(0, -0.70, -0.20), axis='Z')
    mb.torus("M_InteriorDark", 0.17, 0.02, 24, 8, center=(0, -0.70, -0.13), axis='Z')
    mb.tube("M_DuctFlex", [(0.20, -0.55, -0.30), (0.32, -0.30, -0.10), (0.30, -0.10, -0.05)], 0.03, 10, round_r=0.08)
    mb.lathe("M_InteriorDark", [(0.0, 0.0), (0.035, 0.0), (0.05, 0.14), (0.0, 0.14)], 16, axis='Z', center=(0.30, -0.10, -0.06))
    for x in (-0.15, 0.15):
        mb.tube("M_Handrail", [(x, -0.95, -0.25), (x, -0.95, -0.05)], 0.012, 8)
    # lavabo/ducha de toallitas, espejo, estiba de higiene
    mb.box("M_GlassInner", 0.40, 0.30, 0.01, center=(0, 0.55, -0.68))
    mb.box("M_AlBare", 0.50, 0.30, 0.12, center=(0, 0.15, -0.62))
    mb.box("M_Fabric", 0.80, 0.25, 0.15, center=(0, 0.88, -0.60))
    # cortina/puerta
    mb.box("M_FabricBlue", 0.02, 2.0, 0.02, center=(-w / 2 + 0.02, 0, 0.0))
    for k in range(8):
        mb.box("M_FabricBlue", 0.10, 2.0, 0.01, center=(-w / 2 + 0.06 + 0.09 * k, 0, 0.02 + 0.015 * (k % 2)), rot=Matrix.Rotation(0.35 if k % 2 else -0.35, 4, 'Y'))
    return mb.mesh(smooth=None)


def eclss_mesh(kind):
    mb = MB(f"eclss_{kind}")
    front_panel(mb, RACK_W - 0.04, 2.16, "M_InteriorPanel")
    if kind == "OGA":
        mb.box("M_AlChromate", 0.80, 0.80, 0.55, center=(0, 0.45, -0.28))
        for k in range(10):
            mb.box("M_AlBare", 0.78, 0.02, 0.50, center=(0, 0.10 + 0.07 * k, -0.28))
        mb.cyl("M_TankTi", 0.12, 0.12, 0.60, 24, center=(0.2, -0.45, -0.35), axis='Y')
        mb.cyl("M_TankTi", 0.08, 0.08, 0.60, 24, center=(-0.2, -0.45, -0.35), axis='Y')
        mb.tube("M_Steel", [(0.2, -0.15, -0.35), (0.2, 0.0, -0.2), (0.0, 0.05, -0.2)], 0.012, 8, round_r=0.05)
    elif kind == "CDRA":
        for k in range(2):
            mb.box("M_AlBare", 0.36, 1.20, 0.45, center=(-0.21 + 0.42 * k, 0.1, -0.30))
            for j in range(8):
                mb.box("M_AlChromate", 0.37, 0.02, 0.46, center=(-0.21 + 0.42 * k, -0.45 + 0.15 * j, -0.30))
        mb.cyl("M_AlAnodBlack", 0.13, 0.13, 0.20, 24, center=(0, -0.80, -0.20), axis='Z')
        mb.tube("M_DuctFlex", [(0, -0.80, -0.05), (0, -0.95, 0.0), (0.3, -0.95, 0.0)], 0.05, 12, round_r=0.07)
    elif kind == "WRS":
        for k in range(3):
            mb.cyl("M_Steel", 0.10, 0.10, 0.90, 24, center=(-0.28 + 0.28 * k, 0.25, -0.35), axis='Y')
        mb.box("M_AlChromate", 0.80, 0.40, 0.45, center=(0, -0.60, -0.30))
        mb.tube("M_Steel", [(-0.28, 0.72, -0.35), (-0.28, 0.85, -0.2), (0.28, 0.85, -0.2), (0.28, 0.72, -0.35)], 0.012, 8, round_r=0.05)
    # panel frontal con pantalla de estado y conectores
    mb.box("M_InteriorGrey", 0.80, 0.30, 0.03, center=(0, 0.80, 0.035))
    mb.box("M_ScreenAmber" if kind == "WRS" else "M_LEDGreen", 0.10, 0.05, 0.004, center=(0.28, 0.80, 0.052))
    for k in range(4):
        mb.cyl("M_GoldPlate", 0.015, 0.015, 0.03, 10, center=(-0.30 + 0.12 * k, 0.80, 0.06), axis='Z')
    for k in range(12):
        mb.box("M_InteriorDark", 0.70, 0.006, 0.01, center=(0, -0.95 + 0.06 * k, 0.025))
    return mb.mesh(smooth=None)


def exercise_mesh():
    mb = MB("exercise")
    # cicloergómetro anclado al suelo + dispositivo resistivo de vacío
    mb.box("M_AlBare", 0.60, 0.40, 0.04, center=(0, 0, 0.02))
    mb.cyl("M_AlAnodBlack", 0.20, 0.20, 0.08, 32, center=(0, 0, 0.28), axis='Y')
    mb.cyl("M_AlBare", 0.06, 0.06, 0.12, 20, center=(0, 0, 0.28), axis='Y')
    for s in (-1, 1):
        mb.tube("M_AlBare", [(0, s * 0.08, 0.28), (0.12 * s, s * 0.16, 0.28 + 0.12 * s)], 0.012, 8)
        mb.box("M_InteriorDark", 0.12, 0.05, 0.03, center=(0.12 * s, s * 0.20, 0.28 + 0.12 * s))
    mb.tube("M_AlBare", [(-0.25, 0, 0.04), (-0.25, 0, 0.75), (-0.10, 0, 0.92)], 0.02, 10, round_r=0.08)
    mb.tube("M_AlBare", [(-0.10, -0.25, 0.92), (-0.10, 0.25, 0.92)], 0.015, 10)
    mb.box("M_InteriorGrey", 0.30, 0.30, 0.03, center=(0.35, 0, 0.62), rot=Matrix.Rotation(0.4, 4, 'Y'))
    # dispositivo resistivo (cilindros de vacío y barra)
    for s in (-1, 1):
        mb.cyl("M_AlBare", 0.06, 0.06, 0.70, 20, center=(0.55, s * 0.35, 0.37), axis='Z')
        mb.cyl("M_AlAnodBlack", 0.065, 0.065, 0.06, 20, center=(0.55, s * 0.35, 0.05), axis='Z')
    mb.tube("M_Steel", [(0.55, -0.42, 0.78), (0.55, 0.42, 0.78)], 0.018, 10)
    mb.box("M_Rubber", 0.40, 0.70, 0.02, center=(0.55, 0, 0.05))
    return mb.mesh(smooth=40)


def _bay_D(g, x0, x1):
    xa, xb = _x2(x0, x1)
    gw, W, n = rack(g, "HAB.INT.D.PG", "Cocina", "port", xb, "Calentador de alimentos por conducción, dispensador de agua caliente/fría y mesa abatible con sujeciones.", lockers=False)
    place("HAB.INT.D.PG.GAL", "Calentador, dispensador y mesa", shared("gal", galley_mesh), gw, W, explode=tuple(n * 0.4))
    rack(g, "HAB.INT.D.PS", "Estiba de alimentos", "port", xa, "Despensa para 45 días × 4 tripulantes (~1,8 kg/persona/día).", grid=(2, 8))
    gw, W, n = rack(g, "HAB.INT.D.SH", "Compartimento de higiene", "stbd", xa, "Inodoro de separación por flujo de aire, puesto de aseo con toallitas y cortina de privacidad.", lockers=False)
    place("HAB.INT.D.SH.HYG", "Inodoro, aseo y cortina", shared("hyg", hygiene_mesh), gw, W, explode=tuple(n * 0.4))
    gw, W, n = rack(g, "HAB.INT.D.SO", "Generador de oxígeno (OGA)", "stbd", xb, "Electrolizador de membrana de intercambio protónico: divide agua en O₂ para cabina e H₂.", lockers=False,
                    func="Producción de oxígeno a partir de agua")
    place("HAB.INT.D.SO.EQP", "Celdas de electrólisis y separadores", shared("oga", lambda: eclss_mesh("OGA")), gw, W, explode=tuple(n * 0.4))
    gw, W, n = rack(g, "HAB.INT.D.CL1", "Eliminación de CO₂ (tamices moleculares)", "ceil", xb, "Dos lechos de tamiz molecular regenerativos alternos, con ventilador de proceso.", lockers=False,
                    func="Mantener la presión parcial de CO₂ por debajo del límite operativo")
    place("HAB.INT.D.CL1.EQP", "Lechos adsorbentes y ventilador", shared("cdra", lambda: eclss_mesh("CDRA")), gw, W, explode=tuple(n * 0.4))
    rack(g, "HAB.INT.D.CL2", "Bastidor de control de contaminantes y estiba", "ceil", xa, "Filtros de carbón activo, catalizador de trazas y estiba de filtros de repuesto.")
    gw, W, n = rack(g, "HAB.INT.D.DK1", "Recuperación de agua (WRS)", "deck", xb, "Destilación por compresión de vapor de orina y procesado de condensado por filtración multicapa y oxidación catalítica.", lockers=False,
                    func="Recuperar el agua de condensado y orina")
    place("HAB.INT.D.DK1.EQP", "Destilador y lechos de filtración", shared("wrs", lambda: eclss_mesh("WRS")), gw, W, explode=tuple(n * 0.4))
    gw, W, n = rack(g, "HAB.INT.D.DK2", "Plataforma de ejercicio", "deck", xa, "Cicloergómetro aislado de vibraciones y dispositivo resistivo de cilindros de vacío.", lockers=False,
                    func="Contramedida frente a la pérdida ósea y muscular")
    mb = MB("deck_plate_ex")
    mb.box("M_InteriorDark", RACK_W - 0.04, 2.16, 0.03, center=(0, 0, 0.015))
    for k in range(10):
        mb.box("M_AlBare", RACK_W - 0.06, 0.01, 0.006, center=(0, -1.0 + 0.22 * k, 0.033))
    place("HAB.INT.D.DK2.PLT", "Placa base con aislamiento de vibraciones", mb.mesh(smooth=None), gw, W, explode=tuple(n * 0.2))
    place("HAB.INT.D.DK2.EXD", "Cicloergómetro y dispositivo resistivo", shared("exd", exercise_mesh), gw, W @ L(0, 0.0, 0.03, rz=PI / 2), explode=tuple(n * 0.6))


# --- mamparo de popa, utilidades e iluminación -------------------------------

def _aft_bulkhead(it):
    g = group("HAB.INT.AFT", "Estiba y depósitos del mamparo de popa", it, explode=(-2.0, 0, 0),
              desc="Volumen del mamparo elipsoidal: depósitos de O₂/N₂ de alta presión, bolsas de transferencia y extintor.")
    for i, a in enumerate((PI / 4, 3 * PI / 4, 5 * PI / 4, 7 * PI / 4)):
        c = ring_xyz(1.15, a, 0.55)
        mb = MB(f"o2n2_{i}")
        mb.cyl("M_COPV", 0.16, 0.16, 0.55, 24, center=(0, 0, 0), axis='X')
        mb.sphere("M_COPV", 0.16, 24, 10, center=(0.275, 0, 0), scale=(0.6, 1, 1))
        mb.sphere("M_COPV", 0.16, 24, 10, center=(-0.275, 0, 0), scale=(0.6, 1, 1))
        mb.cyl("M_Steel", 0.03, 0.03, 0.08, 12, center=(0.40, 0, 0), axis='X')
        mb.torus("M_AlBare", 0.165, 0.012, 24, 6, center=(0.1, 0, 0), axis='X')
        mb.torus("M_AlBare", 0.165, 0.012, 24, 6, center=(-0.1, 0, 0), axis='X')
        p = part(f"HAB.INT.AFT.T{i+1}", f"Depósito de {'O₂' if i % 2 == 0 else 'N₂'} de alta presión {i//2+1}", mb.mesh(), g, loc=c,
                 explode=("radial", 0.6), desc="COPV a ~20 MPa para reposición de atmósfera y repress de emergencia.")
    mb = MB("ctb_bags")
    for j in range(3):
        for i in range(3):
            mb.box("M_Fabric", 0.42, 0.25, 0.30, center=(0.40, -0.45 + 0.45 * i, -0.45 + 0.45 * j))
            mb.box("M_FabricBlue", 0.43, 0.03, 0.02, center=(0.40, -0.45 + 0.45 * i, -0.45 + 0.45 * j + 0.14))
            mb.box("M_ShieldWhite", 0.12, 0.003, 0.08, center=(0.40, -0.45 + 0.45 * i - 0.126, -0.45 + 0.45 * j))
    part("HAB.INT.AFT.CTB", "Bolsas de transferencia de carga (9)", mb.mesh(smooth=None), g, explode=(-0.6, 0, 0),
         desc="Bolsas de Nomex de tamaño normalizado fijadas a la red del mamparo.")
    mb = MB("extinguisher")
    mb.cyl("M_DecalRed", 0.07, 0.07, 0.45, 20, center=(0, 0, 0), axis='Z')
    mb.sphere("M_DecalRed", 0.07, 20, 8, center=(0, 0, 0.225), scale=(1, 1, 0.5))
    mb.box("M_AlAnodBlack", 0.10, 0.04, 0.06, center=(0, 0.05, 0.27))
    mb.tube("M_Rubber", [(0, 0.06, 0.27), (0, 0.12, 0.2), (0, 0.10, 0.0)], 0.01, 8, round_r=0.04)
    part("HAB.INT.AFT.EXT", "Extintor de niebla de agua", mb.mesh(), g, loc=(0.62, 0.90, 0.65), explode=(-0.3, 0.3, 0.3),
         desc="Extintor portátil de niebla de agua presurizada con N₂.")


def _utilities(hab):
    g = group("HAB.UTL", "Utilidades distribuidas", hab, explode=(0, 0, -3.6),
              desc="Ventilación, distribución eléctrica, datos y lazo de agua de refrigeración enrutados por las cuatro esquinas del pasillo, tras los bastidores.",
              func="Distribuir aire, potencia, datos y refrigeración a todos los bastidores")
    x0, x1 = S.X_HAB_A + 0.10, S.X_HAB_F - 0.05
    corners = [(1, 1, "superior babor"), (-1, 1, "superior estribor"), (1, -1, "inferior babor"), (-1, -1, "inferior estribor")]
    for k, (sy, sz, lbl) in enumerate(corners):
        cg = group(f"HAB.UTL.C{k+1}", f"Esquina de utilidades {lbl}", g, explode=(0, sy * 0.9, sz * 0.9))
        def P(d, y_off=0.0, z_off=0.0):
            return Vector((0, sy * (1.36 + y_off), sz * (1.36 + z_off)))
        mb = MB(f"duct_{k}")
        c = P(0, 0.05, 0.05)
        mb.tube("M_DuctFlex", [Vector((x0, c.y, c.z)), Vector((x1, c.y, c.z))], 0.085, 20)
        for x in [x0 + 0.5 * i for i in range(int((x1 - x0) / 0.5) + 1)]:
            mb.torus("M_AlBare", 0.088, 0.008, 24, 6, center=(x, c.y, c.z), axis='X')
        part(f"HAB.UTL.C{k+1}.DCT", f"Conducto de {'impulsión' if sz > 0 else 'retorno'} de aire", mb.mesh(), cg, explode=(0, sy * 0.35, sz * 0.35),
             desc="Conducto de aluminio corrugado Ø170 mm con difusores en cada bahía.")
        mb = MB(f"tray_{k}")
        c = P(0, -0.12, 0.18)
        mb.box("M_AlBare", x1 - x0, 0.16, 0.006, center=((x0 + x1) / 2, c.y, c.z - sz * 0.03))
        mb.box("M_AlBare", x1 - x0, 0.006, 0.05, center=((x0 + x1) / 2, c.y + 0.08, c.z))
        mb.box("M_AlBare", x1 - x0, 0.006, 0.05, center=((x0 + x1) / 2, c.y - 0.08, c.z))
        for i, (dy, mat) in enumerate(((-0.05, "M_Cable"), (-0.015, "M_CableOrange"), (0.02, "M_CableWhite"), (0.055, "M_Cable"))):
            mb.tube(mat, [Vector((x0, c.y + dy, c.z + 0.012)), Vector((x1, c.y + dy, c.z + 0.012))], 0.014, 8)
        for x in [x0 + 0.4 * i for i in range(int((x1 - x0) / 0.4) + 1)]:
            mb.box("M_InteriorDark", 0.02, 0.17, 0.035, center=(x, c.y, c.z + 0.01))
        part(f"HAB.UTL.C{k+1}.TRY", "Bandeja y mazos de cables", mb.mesh(), cg, explode=(0, sy * 0.15, sz * 0.6),
             desc="Bandeja con mazos de potencia de 120 V CC (naranja), datos (blanco) y señal (negro), con abrazaderas cada 0,4 m.")
        mb = MB(f"water_{k}")
        c = P(0, 0.20, -0.12)
        for i, (dz, mat) in enumerate(((0.0, "M_Water"), (0.04, "M_DecalRed"))):
            mb.tube(mat, [Vector((x0, c.y, c.z + dz)), Vector((x1, c.y, c.z + dz))], 0.012, 10)
        for x in [x0 + 0.5 * i for i in range(int((x1 - x0) / 0.5) + 1)]:
            mb.box("M_AlBare", 0.03, 0.05, 0.08, center=(x, c.y, c.z + 0.02))
        part(f"HAB.UTL.C{k+1}.H2O", "Líneas del lazo de agua de refrigeración", mb.mesh(), cg, explode=(0, sy * 0.6, sz * 0.15),
             desc="Suministro (azul) y retorno (rojo) del lazo interno de agua, con soportes cada 0,5 m.")
    # carriles de asiento (seat track) en las 4 aristas del pasillo
    mb = MB("seat_tracks")
    for sy in (1, -1):
        for sz in (1, -1):
            mb.box("M_AlBare", x1 - x0, 0.035, 0.035, center=((x0 + x1) / 2, sy * (A2 - 0.035), sz * (A2 - 0.035)))
            for x in [x0 + 0.0254 * 4 * i for i in range(int((x1 - x0) / 0.1016))]:
                mb.cyl("M_InteriorDark", 0.007, 0.007, 0.002, 8, center=(x, sy * (A2 - 0.035), sz * (A2 - 0.017)), axis='Z')
    part("HAB.UTL.STK", "Carriles de fijación (seat track)", mb.mesh(smooth=None), g, explode=(0, 0, 0.0),
         desc="Carriles continuos con orificios cada 25,4 mm para fijar equipos, pies y cámaras en cualquier punto del pasillo.")


def _lighting(it):
    g = group("HAB.INT.LGT", "Iluminación general de cabina", it, explode=(0, 0, 0.8),
              desc="Luminarias LED de espectro ajustable (ritmo circadiano), dos por bahía en las aristas del techo.")
    me = None
    mb = MB("light_strip")
    mb.box("M_InteriorGrey", 1.60, 0.12, 0.03, center=(0, 0, 0))
    mb.box("M_LED", 1.50, 0.08, 0.01, center=(0, 0, -0.018))
    me = mb.mesh(smooth=None)
    k = 0
    for i in range(S.N_BARRELS):
        xc = (XS[i] + XS[i + 1]) / 2
        for sy in (1, -1):
            k += 1
            R = Matrix.Rotation(sy * PI / 4, 4, 'X')
            part(f"HAB.INT.LGT.L{k}", f"Luminaria LED {k}", me, g, loc=(xc, sy * (A2 - 0.10), A2 - 0.10), rot=(sy * PI / 4 * 1, 0, 0),
                 explode=(0, 0, 0), desc="Luminaria de 4 canales (blanco cálido/frío, azul, rojo) con difusor de policarbonato.")


# ---------------------------------------------------------------------------
# Interior del nodo
# ---------------------------------------------------------------------------

def hatch_mesh(r, name, window=True):
    mb = MB(name)
    mb.cyl("M_AlBare", r, r, 0.05, 48, center=(0, 0, 0.0), axis='Z')
    for k in range(4):
        a = PI / 4 * k
        mb.box("M_AlBare", 2 * r * 0.9, 0.03, 0.04, center=(0, 0, 0.04), rot=Matrix.Rotation(a, 4, 'Z'))
    mb.torus("M_Rubber", r - 0.02, 0.01, 48, 8, center=(0, 0, -0.025), axis='Z')
    if window:
        mb.cyl("M_Glass", 0.08, 0.08, 0.06, 24, center=(0, r * 0.45, 0.01), axis='Z')
        mb.torus("M_AlBare", 0.085, 0.012, 24, 6, center=(0, r * 0.45, 0.04), axis='Z')
    mb.cyl("M_AlAnodBlack", 0.06, 0.06, 0.04, 20, center=(0, 0, 0.08), axis='Z')
    mb.tube("M_AlAnodBlack", [(-0.20, 0, 0.10), (0.20, 0, 0.10)], 0.015, 10)
    mb.cyl("M_Steel", 0.025, 0.025, 0.05, 12, center=(r * 0.6, -r * 0.3, 0.06), axis='Z')
    mb.cyl("M_Steel", 0.03, 0.03, 0.16, 12, center=(-r - 0.03, 0, 0.0), axis='Y')
    return mb.mesh(smooth=40)


def build_node_interior(fwd):
    g = group("FWD.INT", "Interior del nodo", fwd, explode=(0, 0, -3.0),
              desc="Escotillas, estación de trabajo robótica bajo la cúpula y estiba de acceso rápido.")
    p = part("FWD.INT.HF", "Escotilla de atraque IDSS (cerrada)", hatch_mesh(0.46, "hatch_fwd"), g, explode=(0.5, 0, 0),
             desc="Escotilla de 0,92 m con mirilla, válvula de ecualización de presión y mecanismo de cierre de 6 pestillos.")
    p.matrix_basis = Matrix.Translation((S.X_NODE_F - 0.05, 0, 0)) @ Matrix.Rotation(-PI / 2, 4, 'Y')
    p = part("FWD.INT.HA", "Escotilla nodo–hábitat (abierta)", hatch_mesh(0.56, "hatch_aft"), g, explode=(-0.4, 0, 0),
             desc="Escotilla de 1,12 m abierta 100° y retenida contra la pared del nodo.")
    p.matrix_basis = Matrix.Translation((S.X_NODE_A + 0.70, 0.85, 0.0)) @ Matrix.Rotation(PI / 2, 4, 'X') @ Matrix.Rotation(0.15, 4, 'Y')
    # estación de trabajo robótica (RWS)
    rws = group("FWD.INT.RWS", "Estación de trabajo robótica", g, explode=(0, 0, 0.6),
                desc="Puesto bajo la cúpula con 2 pantallas, controladores manuales de traslación y rotación y portátil de mando.",
                func="Control directo del brazo robótico con visión desde la cúpula")
    mb = MB("rws_frame")
    xc = S.X_CUPOLA
    mb.box("M_InteriorDark", 0.10, 1.10, 0.45, center=(xc + 0.55, 0, 0.55))
    mb.box("M_InteriorGrey", 0.30, 1.10, 0.04, center=(xc + 0.42, 0, 0.32))
    mb.tube("M_Handrail", [(xc + 0.25, -0.55, 0.30), (xc + 0.25, 0.55, 0.30)], 0.013, 10)
    for s in (-1, 1):
        mb.box("M_AlAnodBlack", 0.10, 0.10, 0.08, center=(xc + 0.38, s * 0.35, 0.38))
        mb.cyl("M_InteriorDark", 0.025, 0.035, 0.13, 16, center=(xc + 0.38, s * 0.35, 0.48), axis='Z')
    mb.tube("M_AlBare", [(xc + 0.58, 0.0, 0.80), (xc + 0.55, 0.0, 1.00), (xc + 0.40, 0.0, 1.05)], 0.015, 10, round_r=0.06)
    place("FWD.INT.RWS.FRM", "Bastidor, reposamanos y controladores manuales", mb.mesh(), rws, Matrix.Identity(4), explode=(0.3, 0, 0))
    for k, (y, key) in enumerate(((0.27, "CAMERA"), (-0.27, "TRAJ"))):
        Wd = Matrix.Translation((xc + 0.495, y, 0.58)) @ Matrix.Rotation(-PI / 2, 4, 'Y') @ Matrix.Rotation(PI / 2, 4, 'Z')
        place(f"FWD.INT.RWS.D{k+1}", f"Pantalla de la estación robótica {k+1}", screen_mesh(f"rws_scr_{k}", 0.48, 0.32, key), rws, Wd,
              explode=(-0.3, 0, 0.1), desc="Pantalla de 22\" para vídeo de las cámaras del brazo.")
    # estiba del nodo
    st = group("FWD.INT.STW", "Estiba del nodo", g, explode=("radial", 0.0))
    lm = shared("node_locker", lambda: locker_mesh(0.46, 0.40))
    k = 0
    for a in (-PI / 2 - 0.55, -PI / 2, -PI / 2 + 0.55, PI + 0.3, -0.3):
        for x in (10.35, 10.85, 11.35, 11.85):
            if a in (PI + 0.3, -0.3) and x > 11.5:
                continue
            k += 1
            Wl = Matrix.Translation(ring_xyz(S.R_N - 0.16, a, x)) @ Matrix.Rotation(a - PI / 2, 4, 'X') @ Matrix.Rotation(PI, 4, 'X') @ Matrix.Rotation(PI / 2, 4, 'Z')
            mb = MB(f"node_locker_box_{k}")
            place(f"FWD.INT.STW.L{k:02d}", f"Taquilla del nodo {k:02d}", lm, st, Wl, explode=("radial", 0.4),
                  desc="Taquilla de acceso rápido (equipos de emergencia, herramientas, cámaras).")
    mb = MB("node_backing")
    for a in (-PI / 2 - 0.55, -PI / 2, -PI / 2 + 0.55):
        mb.box("M_InteriorDark", 2.0, 0.46, 0.14, center=Vector(ring_xyz(S.R_N - 0.09, a, 11.1)), rot=Matrix.Rotation(a - PI / 2, 4, 'X'))
    for a in (PI + 0.3, -0.3):
        mb.box("M_InteriorDark", 1.5, 0.46, 0.14, center=Vector(ring_xyz(S.R_N - 0.09, a, 10.85)), rot=Matrix.Rotation(a - PI / 2, 4, 'X'))
    place("FWD.INT.STW.BCK", "Bastidores de soporte de taquillas", mb.mesh(smooth=None), st, Matrix.Identity(4), explode=("radial", 0.2))
    mb = MB("node_lights")
    for a in (PI / 2 + 0.9, PI / 2 - 0.9):
        mb.box("M_LED", 1.2, 0.06, 0.01, center=Vector(ring_xyz(S.R_N - 0.04, a, 11.05)), rot=Matrix.Rotation(a - PI / 2, 4, 'X'))
    place("FWD.INT.LGT", "Luminarias del nodo", mb.mesh(smooth=None), g, Matrix.Identity(4), explode=(0, 0, 0.3))
    return g
