"""
ALCIÓN HX-4 · REBIRTH — interior habitable reconstruido.

Lenguaje visual propio de ALCIÓN (ver docs/REBIRTH_STATE.md · Dirección artística):
- sección arquitectónica, no un pasillo cuadrado de bastidores: suelo continuo,
  zócalo de almacenaje con encimera de compuesto de lino, pared alta curva con
  compartimentos, cornisa de luz indirecta y canal lumínico cenital;
- polímero técnico cálido (no blanco puro), aluminio anodizado grafito en marcos
  y nervios estructurales, tejidos acústicos y tapizados con volumen real,
  acento bermellón ALCIÓN únicamente en elementos de agarre y seguridad;
- el volumen interior es cerrado: revestimiento continuo + trasdós oscuro, de
  modo que nunca se ve el casco, el espacio o el módulo de servicio por huecos.

Coordenadas de nave (Blender): X proa, Y babor, Z cenit. Ángulos de sección
medidos desde +Y hacia +Z.
"""
import math
import bpy
import bmesh
from mathutils import Vector, Matrix
from .lib import group, part, MB
from .materials import MATS
from . import spec as S
from . import canopy
from .kit import (fillet, rrect, prism, loft, arc_panel, cone_frustum_panel, cushion, draped_sheet, strap, place, rot_to)
from .expansion import mech, ctl, SWITCH_ROWS

PI = math.pi
D = math.radians

FLOOR = -1.15        # cubierta (z)
WT = -0.03           # cota superior de la encimera
R_L = 1.92           # radio interior del revestimiento
R_BK = 1.985         # trasdós oscuro
FACE = 1.28          # plano de frentes de armario (|y|)
TOE = 0.11           # altura del zócalo retranqueado
BAYS = {"D": (0.62, 2.65), "C": (2.65, 4.70), "B": (4.70, 6.75), "A": (6.75, 8.80)}
X_CONE0, X_CONE1 = S.X_HAB_F, 9.92
R_CONE_L1 = 1.24     # radio del revestimiento al final del cono
HATCH_R = 0.54
NODE_RL = 1.22       # radio interior del revestimiento del nodo
NODE_FLOOR = -0.62

# ------------------------------------------------------------------ materiales
RMAT = {
    # nombre: (color lineal, metal, rugosidad, emisión, descripción)
    "R_Lining":     ((0.56, 0.54, 0.50), 0.0, 0.55, None, "Revestimiento interior: polímero técnico PPSU texturizado, tono hueso cálido"),
    "R_LiningDark": ((0.085, 0.09, 0.10), 0.0, 0.60, None, "Revestimiento inferior: polímero grafito resistente a rozaduras"),
    "R_Fabric":     ((0.16, 0.155, 0.15), 0.0, 0.95, None, "Tejido acústico de lana técnica en espiga, gris cálido"),
    "R_FabricBlue": ((0.030, 0.060, 0.080), 0.0, 0.92, None, "Tejido técnico petróleo (tapizados, sacos de dormir)"),
    "R_Leather":    ((0.055, 0.06, 0.068), 0.0, 0.55, None, "Tapizado de piel técnica perforada, grafito cálido"),
    "R_Frame":      ((0.045, 0.047, 0.052), 0.9, 0.38, None, "Aluminio 6061 anodizado grafito (marcos, nervios, pozos)"),
    "R_Alu":        ((0.80, 0.80, 0.79), 1.0, 0.30, None, "Aluminio satinado"),
    "R_Steel":      ((0.62, 0.62, 0.62), 1.0, 0.26, None, "Acero inoxidable cepillado"),
    "R_Floor":      ((0.085, 0.086, 0.09), 0.0, 0.78, None, "Pavimento de caucho técnico con relieve antideslizante"),
    "R_Worktop":    ((0.40, 0.33, 0.24), 0.0, 0.48, None, "Encimera de compuesto de fibra de lino y resina bio"),
    "R_Rubber":     ((0.018, 0.018, 0.02), 0.0, 0.82, None, "Elastómero negro"),
    "R_Accent":     ((0.62, 0.11, 0.03), 0.0, 0.42, None, "Bermellón ALCIÓN (agarres y seguridad)"),
    "R_Black":      ((0.012, 0.012, 0.014), 0.0, 0.35, None, "Polímero negro (biseles de pantalla)"),
    "R_Backing":    ((0.01, 0.01, 0.012), 0.0, 0.9, None, "Trasdós oscuro"),
    "R_Glass":      ((0.80, 0.88, 0.95), 0.0, 0.02, None, "Panel interior antirayado"),
    "R_Screen":     ((0.01, 0.012, 0.016), 0.0, 0.06, (0.20, 0.42, 0.62), "Pantalla multifunción (contenido dinámico)"),
    "R_LED":        ((1.0, 0.96, 0.90), 0.0, 0.4, (1.0, 0.86, 0.70), "Tira LED cálida 3500 K"),
    "R_LightPanel": ((1.0, 0.98, 0.95), 0.0, 0.4, (1.0, 0.93, 0.84), "Difusor lumínico 4000 K"),
    "R_Indicator":  ((0.4, 0.8, 0.5), 0.0, 0.3, (0.3, 1.0, 0.5), "Indicador"),
    "R_Bag":        ((0.48, 0.44, 0.37), 0.0, 0.90, None, "Bolsa de estiba de Nomex"),
    "R_Plant":      ((0.06, 0.20, 0.04), 0.0, 0.55, None, "Cultivo de hoja"),
    "R_Label":      ((0.50, 0.49, 0.46), 0.0, 0.5, None, "Rotulación serigrafiada"),
}


def build_materials():
    for name, (col, metal, rough, emit, desc) in RMAT.items():
        if name in MATS:
            continue
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        b = m.node_tree.nodes.get("Principled BSDF")
        b.inputs["Base Color"].default_value = (*col, 1)
        b.inputs["Metallic"].default_value = metal
        b.inputs["Roughness"].default_value = rough
        if emit:
            b.inputs["Emission Color"].default_value = (*emit, 1)
            b.inputs["Emission Strength"].default_value = 4.0 if name != "R_Screen" else 1.2
        if name in ("R_Glass",):
            b.inputs["Transmission Weight"].default_value = 1.0
            b.inputs["Alpha"].default_value = 0.15
        m.diffuse_color = (*col, 1)
        m["desc"] = desc
        MATS[name] = m


# ------------------------------------------------------------------ utilidades
def P(code, label, mb, parent, room, desc="", bevel=None, smooth=35, explode=None, interact=None):
    me = mb.mesh(smooth=smooth, bevel=bevel)
    ob = part(code, label, me, parent, desc=desc, explode=explode)
    ob["room"] = room
    if interact:
        ob["interact"] = interact
    return ob


def side_y(y, s):
    return y * s


def arc_pt(r, a, s=1):
    return Vector((0, s * r * math.cos(a), r * math.sin(a)))


def mirror_a(a, s):
    """Ángulo de sección para el costado s (+1 babor, −1 estribor)."""
    return a if s > 0 else PI - a


def arc(mb, mat, r_in, r_out, a0, a1, x0, x1, s=1, seg=8):
    if s > 0:
        return arc_panel(mb, mat, r_in, r_out, a0, a1, x0, x1, seg)
    return arc_panel(mb, mat, r_in, r_out, PI - a1, PI - a0, x0, x1, seg)


def r_cone(x):
    t = (x - X_CONE0) / (X_CONE1 - X_CONE0)
    return R_L + (R_CONE_L1 - R_L) * max(0.0, min(1.0, t))


# ------------------------------------------------------------------ envolvente común
def lining_module(mb_wall, mb_dark, mb_frame, mb_led, x0, x1, s, lower=True, upper=True, ceiling=True, worktop=True, mb_top=None):
    """Módulo de revestimiento de ~1 m en un costado."""
    g = 0.004
    if upper:
        # pared alta curva en dos paneles con junta; el superior es la puerta del compartimento
        arc(mb_wall, "R_Lining", R_L, R_L + 0.022, D(1.0), D(30.5), x0 + g, x1 - g, s, 6)
        arc(mb_wall, "R_Lining", R_L - 0.012, R_L + 0.010, D(31.5), D(62.5), x0 + g, x1 - g, s, 6)
        # tirador rebajado del compartimento alto
        a = D(34.5)
        c = arc_pt(R_L - 0.016, a, s)
        mb_frame.box("R_Frame", (x1 - x0) * 0.42, 0.012, 0.016, center=(x0 + (x1 - x0) / 2, c.y, c.z),
                     rot=Matrix.Rotation(mirror_a(a, s) - PI / 2, 4, 'X'))
    if ceiling:
        # cornisa: repisa que oculta la tira LED y bañará el techo curvo
        a0 = D(63.0)
        w = arc_pt(R_L, a0, s)
        lip = [(w.y, w.z), (w.y - s * 0.085, w.z - 0.015), (w.y - s * 0.10, w.z + 0.035), (w.y - s * 0.088, w.z + 0.04),
               (w.y - s * 0.075, w.z + 0.005), (w.y + s * 0.01, w.z + 0.022)]
        prism(mb_frame, "R_Lining", lip, x0 + g, x1 - g, 'X')
        led = [(w.y - s * 0.02, w.z + 0.012), (w.y - s * 0.07, w.z + 0.002), (w.y - s * 0.07, w.z + 0.012), (w.y - s * 0.02, w.z + 0.022)]
        prism(mb_led, "R_LED", led, x0 + 0.02, x1 - 0.02, 'X')
        # techo curvo hasta el canal lumínico central
        arc(mb_wall, "R_Lining", R_L, R_L + 0.022, D(64.0), D(85.6), x0 + g, x1 - g, s, 8)
        # perfil del canal
        e = arc_pt(R_L, D(85.6), s)
        prism(mb_frame, "R_Frame", [(e.y, e.z), (e.y - s * 0.012, e.z - 0.012), (e.y - s * 0.018, e.z + 0.03), (e.y - s * 0.004, e.z + 0.03)], x0 + g, x1 - g, 'X')
    if worktop:
        top = mb_top or mb_frame
        # encimera con canto redondeado
        prof = fillet([(s * (FACE - 0.04), WT - 0.034), (s * 1.935, WT - 0.034), (s * 1.935, WT), (s * (FACE - 0.04), WT)], [0, 0, 0, 0.012] if s > 0 else [0, 0, 0, 0.012], 3)
        prism(top, "R_Worktop", prof, x0 + g, x1 - g, 'X')
        # canto de aluminio
        prism(mb_frame, "R_Alu", rrect(0.006, 0.03, 0.002, cx=s * (FACE - 0.043), cy=WT - 0.017), x0 + g, x1 - g, 'X')
    if upper:
        # pasamanos de microgravedad (grafito con remates bermellón) y rejilla de impulsión de aire
        a = D(12)
        c = arc_pt(R_L - 0.075, a, s)
        L = (x1 - x0) * 0.7
        xm = (x0 + x1) / 2
        mb_frame.cyl("R_Frame", 0.014, 0.014, L, 16, center=(xm, c.y, c.z), axis='X')
        for xe in (xm - L / 2, xm + L / 2):
            b0 = arc_pt(R_L - 0.005, a, s)
            mb_frame.beam("R_Frame", (xe, b0.y, b0.z), (xe, c.y, c.z), 0.02, 0.02)
            mb_frame.cyl("R_Accent", 0.016, 0.016, 0.03, 16, center=(xe + (0.015 if xe < xm else -0.015), c.y, c.z), axis='X')
        for k in range(7):
            av = D(58.5)
            cc = arc_pt(R_L - 0.013, av, s)
            mb_frame.box("R_Black", 0.012, 0.05, 0.004, center=(xm - 0.15 + k * 0.05, cc.y, cc.z), rot=Matrix.Rotation(mirror_a(av, s) - PI / 2, 4, 'X'))
    if lower:
        # frentes de armario con uñero superior
        n = max(1, round((x1 - x0) / 0.5))
        w = (x1 - x0) / n
        for k in range(n):
            xa, xb = x0 + k * w + g, x0 + (k + 1) * w - g
            prof = rrect(0.022, (WT - 0.04) - (FLOOR + TOE + 0.004) - 0.05, 0.004, cx=s * (FACE + 0.011), cy=(WT - 0.04 + FLOOR + TOE) / 2 - 0.025)
            prism(mb_dark, "R_LiningDark", prof, xa, xb, 'X')
            # uñero (franja grafito profunda) y placa de inventario
            prism(mb_frame, "R_Frame", rrect(0.03, 0.03, 0.004, cx=s * (FACE + 0.02), cy=WT - 0.06), xa, xb, 'X')
            prism(mb_frame, "R_Label", rrect(0.004, 0.035, 0.002, cx=s * (FACE - 0.001), cy=WT - 0.16), xa + 0.05, xa + 0.16, 'X')
        # zócalo retranqueado con luz rasante
        prism(mb_dark, "R_Backing", [(s * (FACE + 0.06), FLOOR), (s * (FACE + 0.07), FLOOR), (s * (FACE + 0.07), FLOOR + TOE + 0.01), (s * (FACE + 0.06), FLOOR + TOE + 0.01)], x0, x1, 'X')
        prism(mb_led, "R_LED", [(s * (FACE + 0.05), FLOOR + TOE - 0.01), (s * (FACE + 0.058), FLOOR + TOE - 0.01), (s * (FACE + 0.058), FLOOR + TOE), (s * (FACE + 0.05), FLOOR + TOE)], x0 + 0.03, x1 - 0.03, 'X')
        # trasdós del armario (cierra la cavidad hasta el revestimiento)
        prism(mb_dark, "R_Backing", [(s * (FACE + 0.025), FLOOR + TOE), (s * 1.70, FLOOR + TOE), (s * 1.70, FLOOR + TOE + 0.01), (s * (FACE + 0.025), FLOOR + TOE + 0.01)], x0, x1, 'X')


def ceiling_channel(mb_led, mb_frame, x0, x1):
    """Canal lumínico cenital continuo (difusor) entre los techos curvos."""
    a0, a1 = D(85.6), D(94.4)
    arc_panel(mb_frame, "R_Frame", R_L + 0.06, R_L + 0.075, a0, a1, x0, x1, 4)
    arc_panel(mb_led, "R_LightPanel", R_L + 0.03, R_L + 0.038, a0 + D(0.5), a1 - D(0.5), x0 + 0.01, x1 - 0.01, 4)


def rib(mb, x, a0=D(-40), a1=D(220), w=0.05, depth=0.03):
    """Nervio estructural grafito en la junta entre módulos (ritmo arquitectónico)."""
    arc_panel(mb, "R_Frame", R_L - depth, R_L + 0.02, a0, a1, x - w / 2, x + w / 2, 48)


def floor_run(mb_floor, mb_frame, x0, x1, half=FACE - 0.005, step=1.025):
    n = max(1, round((x1 - x0) / step))
    w = (x1 - x0) / n
    for k in range(n):
        xa, xb = x0 + k * w + 0.004, x0 + (k + 1) * w - 0.004
        for ya, yb in ((-half, -0.46), (-0.44, 0.44), (0.46, half)):
            prism(mb_floor, "R_Floor", rrect(yb - ya, 0.03, 0.004, cx=(ya + yb) / 2, cy=FLOOR - 0.015), xa, xb, 'X')
    for y in (-0.45, 0.45):
        prism(mb_frame, "R_Alu", [(y - 0.011, FLOOR - 0.03), (y + 0.011, FLOOR - 0.03), (y + 0.011, FLOOR + 0.001), (y + 0.006, FLOOR + 0.004),
                                  (y - 0.006, FLOOR + 0.004), (y - 0.011, FLOOR + 0.001)], x0, x1, 'X')
    # subsuelo oscuro (cierra las juntas)
    prism(mb_frame, "R_Backing", [(-1.6, FLOOR - 0.06), (1.6, FLOOR - 0.06), (1.6, FLOOR - 0.05), (-1.6, FLOOR - 0.05)], x0, x1, 'X')


def backing_shell(mb, x0, x1):
    """Trasdós cilíndrico oscuro: garantiza que ninguna junta deja ver el exterior."""
    secs = [[Vector((x, R_BK * math.cos(2 * PI * k / 64), R_BK * math.sin(2 * PI * k / 64))) for k in range(64)] for x in (x0, x1)]
    loft(mb, "R_Backing", secs, closed=True, cap=False)


# ------------------------------------------------------------------ cabina (bahía A + cono)
def seat_mesh(mb, M, accent=True):
    """Asiento de piloto: pedestal, bastidor, cojines tapizados con volumen y arnés."""
    vs = []
    # pedestal y raíles
    vs += prism(mb, "R_Frame", fillet([(-0.22, -1.15), (0.22, -1.15), (0.18, -0.78), (-0.16, -0.78)], 0.03, 3), -0.17, 0.17, 'Y')
    vs += prism(mb, "R_Alu", rrect(0.5, 0.025, 0.006, cx=0.0, cy=-1.137), -0.2, -0.17, 'Y')
    vs += prism(mb, "R_Alu", rrect(0.5, 0.025, 0.006, cx=0.0, cy=-1.137), 0.17, 0.2, 'Y')
    # bastidor de asiento y respaldo (perfil en L redondeado)
    shell = fillet([(-0.30, -0.80), (0.24, -0.80), (0.26, -0.72), (-0.22, -0.70), (-0.30, 0.10), (-0.36, 0.12), (-0.38, -0.74)], [0.02, 0.03, 0.02, 0.05, 0.03, 0.02, 0.06], 4)
    vs += prism(mb, "R_Frame", shell, -0.255, 0.255, 'Y')
    # cojín de asiento y respaldo con volumen
    vs += cushion(mb, "R_Leather", 0.48, 0.46, 0.09, center=(-0.02, 0, -0.665), puff=0.014, round_=0.035, sub=3, seed=3, wrinkle=0.002)
    R = Matrix.Rotation(D(-11), 4, 'Y')
    vs += cushion(mb, "R_Leather", 0.085, 0.44, 0.62, center=(-0.285, 0, -0.30), R=R, puff=0.0, round_=0.035, sub=3, seed=4, wrinkle=0.002)
    # alas laterales del respaldo (soporte lateral)
    for sy in (-1, 1):
        vs += cushion(mb, "R_Leather", 0.10, 0.07, 0.5, center=(-0.25, sy * 0.235, -0.33), R=Matrix.Rotation(D(-11), 4, 'Y') @ Matrix.Rotation(D(-14 * sy), 4, 'X'),
                      puff=0.0, round_=0.03, sub=2, seed=5 + sy)
    # reposacabezas
    vs += cushion(mb, "R_Leather", 0.10, 0.27, 0.17, center=(-0.37, 0, 0.17), R=Matrix.Rotation(D(-6), 4, 'Y'), puff=0.0, round_=0.045, sub=2, seed=7)
    vs += prism(mb, "R_Alu", rrect(0.02, 0.05, 0.008, cx=-0.36, cy=0.03), -0.06, -0.04, 'Y')
    vs += prism(mb, "R_Alu", rrect(0.02, 0.05, 0.008, cx=-0.36, cy=0.03), 0.04, 0.06, 'Y')
    # reposabrazos
    for sy in (-1, 1):
        vs += prism(mb, "R_Frame", fillet([(-0.24, -0.66), (0.20, -0.66), (0.20, -0.52), (-0.20, -0.50)], 0.02, 3), sy * 0.25, sy * 0.25 + sy * 0.03, 'Y')
        vs += cushion(mb, "R_Leather", 0.36, 0.075, 0.04, center=(0.0, sy * 0.295, -0.49), puff=0.004, round_=0.018, sub=2, seed=9 + sy)
    # arnés de cinco puntos
    if accent:
        for sy in (-1, 1):
            vs += strap(mb, "R_FabricBlue", [(-0.33, sy * 0.13, 0.08), (-0.30, sy * 0.12, -0.02), (-0.24, sy * 0.10, -0.25), (-0.18, sy * 0.06, -0.48)], 0.045, 0.004, up=(1, 0, 0))
            vs += strap(mb, "R_FabricBlue", [(-0.24, sy * 0.22, -0.62), (-0.16, sy * 0.14, -0.58), (-0.12, sy * 0.05, -0.55)], 0.045, 0.004, up=(0, 0, 1))
        vs += mb.cyl("R_Alu", 0.045, 0.045, 0.018, 24, center=(-0.12, 0, -0.53), axis='X')
        vs += mb.cyl("R_Accent", 0.02, 0.02, 0.02, 16, center=(-0.105, 0, -0.53), axis='X')
    place(mb, vs, M)


def hand_controller(mb, M, rot_handle=True):
    vs = []
    vs += mb.cyl("R_Frame", 0.035, 0.04, 0.05, 24, center=(0, 0, 0.025))
    vs += mb.cyl("R_Rubber", 0.042, 0.042, 0.012, 24, center=(0, 0, 0.055))
    # empuñadura ergonómica
    sec = []
    for k in range(7):
        z = 0.06 + k * 0.022
        r = 0.022 + 0.006 * math.sin(k / 6 * PI)
        sec.append([Vector((r * math.cos(a) * 1.15, r * math.sin(a), z)) for a in [i / 16 * 2 * PI for i in range(16)]])
    vs += loft(mb, "R_Rubber", sec)
    vs += mb.sphere("R_Frame", 0.027, 16, 8, center=(0, 0, 0.20), scale=(1.15, 1, 0.6))
    vs += mb.cyl("R_Accent", 0.007, 0.007, 0.01, 12, center=(0.012, 0, 0.215))
    place(mb, vs, M)


def build_cockpit(intg, hab_parent):
    room = "A"
    x0, x1 = BAYS["A"]
    g = group("HAB.INT.A", "Cabina de vuelo (bahía A)", intg, explode=(1.6, 0, 0.6),
              desc="Cabina de dos puestos orientada a proa con banda panorámica de nueve ventanas en el cono, paneles multifunción, consolas laterales de interruptores y controladores manuales.",
              func="Pilotaje, navegación, atraque y supervisión de sistemas")
    # --- envolvente
    wall, dark, frame, led, top = MB("a_wall"), MB("a_dark"), MB("a_frame"), MB("a_led"), MB("a_top")
    xm = (x0 + x1) / 2
    for s in (1, -1):
        for (a, b) in ((x0, xm), (xm, x1)):
            lining_module(wall, dark, frame, led, a, b, s, lower=False, worktop=False, mb_top=top)
    ceiling_channel(led, frame, x0, x1)
    rib(frame, x0); rib(frame, xm); rib(frame, x1)
    floor_run(dark, frame, x0, X_CONE0 + 0.40)
    backing_shell(dark, x0 - 0.01, x1)
    # --- consolas laterales (sustituyen zócalo y encimera): tapa inclinada con interruptores
    for s in (1, -1):
        prof = fillet([(s * 1.10, FLOOR), (s * 1.62, FLOOR), (s * 1.75, -0.45), (s * 1.62, -0.33), (s * 1.10, -0.40)], [0, 0, 0.03, 0.04, 0.03], 4)
        prism(dark, "R_LiningDark", prof, 6.95, 8.40, 'X')
        prism(frame, "R_Frame", fillet([(s * 1.09, -0.405), (s * 1.62, -0.335), (s * 1.62, -0.315), (s * 1.09, -0.385)], 0.006, 2), 6.94, 8.41, 'X')
        # paños tapizados entre consola y pared
        arc(wall, "R_Fabric", R_L - 0.035, R_L - 0.005, D(-34), D(-3), x0 + 0.03, x1 - 0.03, s, 8)
        arc(wall, "R_LiningDark", R_L - 0.005, R_L + 0.02, D(-38), D(0.5), x0, x1, s, 8)
        # pared baja trasera (zona sin consola)
        prism(dark, "R_LiningDark", [(s * FACE, FLOOR), (s * 1.60, FLOOR), (s * 1.60, -0.42), (s * FACE, -0.42)], x0, 6.95, 'X')
    # --- cono: revestimiento facetado con 9 huecos de ventana
    cone = MB("a_cone")
    half = canopy.WIN_HALF
    for xa, xb in ((X_CONE0, canopy.WIN_X0), (canopy.WIN_X1, X_CONE1)):
        for q in range(4):
            cone_frustum_panel(cone, "R_Lining", xa, r_cone(xa), xb, r_cone(xb), q * PI / 2 + 0.002, (q + 1) * PI / 2 - 0.002, 0.022, 10)
    fa = canopy.facet_angle
    xa, xb = canopy.WIN_X0, canopy.WIN_X1
    for k in range(8):
        cone_frustum_panel(cone, "R_Lining", xa, r_cone(xa), xb, r_cone(xb), fa(k) + half, fa(k + 1) - half, 0.03, 2)
    cone_frustum_panel(cone, "R_Lining", xa, r_cone(xa), xb, r_cone(xb), fa(8) + half, fa(16) - half, 0.022, 24)
    # pozos de ventana y paneles interiores antirayado
    wells = MB("a_wells")
    for i in canopy.WIN_FACETS:
        canopy.well(wells, "R_Frame", i, lambda x: r_cone(x) + 0.001, lambda x: canopy.cone_r(x) - 0.03)
        # marco interior con sello bermellón fino
        canopy.surface_patch(wells, "R_Frame", i, lambda x: r_cone(x) - 0.012, 0.012, nx=1, na=1, x0=xa - 0.03, x1=xa, half=half + 0.02)
        canopy.surface_patch(wells, "R_Frame", i, lambda x: r_cone(x) - 0.012, 0.012, nx=1, na=1, x0=xb, x1=xb + 0.03, half=half + 0.02)
    panes = MB("a_panes")
    for i in canopy.WIN_FACETS:
        canopy.surface_patch(panes, "R_Glass", i, lambda x: r_cone(x) + 0.05, 0.008, nx=2, na=2)
    # mamparo de proa con escotilla hacia el nodo
    bh = MB("a_bulkhead")
    ann = []
    for k in range(65):
        a = 2 * PI * k / 64
        ann.append((R_CONE_L1 * math.cos(a), R_CONE_L1 * math.sin(a)))
    hole = [(HATCH_R * math.cos(2 * PI * k / 64), HATCH_R * math.sin(2 * PI * k / 64)) for k in range(64, -1, -1)]
    for q in range(4):
        sec = []
        a0, a1 = q * PI / 2, (q + 1) * PI / 2
        pts = [(R_CONE_L1 * math.cos(a0 + (a1 - a0) * t / 12), R_CONE_L1 * math.sin(a0 + (a1 - a0) * t / 12)) for t in range(13)]
        pts += [(HATCH_R * math.cos(a1 - (a1 - a0) * t / 12), HATCH_R * math.sin(a1 - (a1 - a0) * t / 12)) for t in range(13)]
        prism(bh, "R_Lining", pts, X_CONE1, X_CONE1 + 0.03, 'X')
    # brocal de la escotilla (bermellón) y túnel
    ring = [(HATCH_R + 0.05) * math.cos(2 * PI * k / 64) for k in range(64)]
    prof = []
    for k in range(65):
        a = 2 * PI * k / 64
        prof.append(Vector((X_CONE1 - 0.03, (HATCH_R + 0.06) * math.cos(a), (HATCH_R + 0.06) * math.sin(a))))
    secs = []
    for x, r in ((X_CONE1 - 0.035, HATCH_R + 0.07), (X_CONE1 - 0.035, HATCH_R), (10.12, HATCH_R), (10.12, HATCH_R + 0.03)):
        secs.append([Vector((x, r * math.cos(2 * PI * k / 64), r * math.sin(2 * PI * k / 64))) for k in range(64)])
    loft(bh, "R_Accent", secs[:2], closed=True, cap=False)
    loft(bh, "R_Frame", secs[1:3], closed=True, cap=False)
    # escalones centrales hacia la escotilla
    steps = MB("a_steps")
    for (sx0, sx1, zt) in ((8.70, 9.25, -0.86), (9.25, X_CONE1, -0.57)):
        prism(steps, "R_LiningDark", rrect(0.74, zt - FLOOR, 0.01, cx=0, cy=(zt + FLOOR) / 2), sx0, sx1, 'X')
        prism(steps, "R_Floor", rrect(0.70, 0.02, 0.004, cx=0, cy=zt + 0.008), sx0 + 0.01, sx1 - 0.01, 'X')
        prism(steps, "R_Accent", rrect(0.70, 0.012, 0.003, cx=0, cy=zt + 0.006), sx0, sx0 + 0.03, 'X')
    # --- panel principal: dos cuerpos envolventes (curvos en planta, orientados a cada piloto)
    pnl = MB("a_panel")
    screens = []
    PIL = 0.78                      # |y| del eje de cada puesto

    def x_front(y):
        u = (abs(y) - PIL) / 0.62
        return 8.30 + 0.20 * u * u

    def body_prof(dx):
        return fillet([(8.20 + dx, FLOOR), (9.55, FLOOR), (9.55, 0.06), (8.64 + dx, 0.07), (8.47 + dx, 0.04), (8.30 + dx, -0.50),
                       (8.25 + dx, -0.60), (8.27 + dx, -0.78), (8.42 + dx, -0.86), (8.42 + dx, FLOOR)],
                      [0, 0, 0, 0.03, 0.05, 0.04, 0.03, 0.04, 0.03, 0], 5)

    def visor_prof(dx):
        return fillet([(8.36 + dx, 0.075), (8.62 + dx, 0.09), (9.05, 0.11), (9.05, 0.135), (8.60 + dx, 0.125), (8.33 + dx, 0.105)],
                      [0, 0.03, 0, 0, 0.04, 0.012], 4)
    for sd in (1, -1):
        ys = [sd * (0.42 + (1.50 - 0.42) * k / 14) for k in range(15)]
        if sd < 0:
            ys = ys[::-1]
        for prof_fn, mat, shrink in ((body_prof, "R_LiningDark", 0.0), (visor_prof, "R_Fabric", -0.012)):
            secs = []
            for k, y in enumerate(ys):
                dx = x_front(y) - 8.30
                # extremos redondeados: la sección se retrae en los bordes
                e = min(k, len(ys) - 1 - k)
                inset = [0.035, 0.012, 0.004][e] if e < 3 else 0.0
                pr = prof_fn(dx + inset)
                secs.append([Vector((px, y, pz)) for (px, pz) in pr])
            loft(pnl, mat, secs)
        # franja de aluminio bajo la visera y reposapiés
        secs = []
        for y in ys:
            dx = x_front(y) - 8.30
            secs.append([Vector((px, y, pz)) for (px, pz) in rrect(0.012, 0.012, 0.004, cx=8.47 + dx - 0.004, cy=0.045)])
        loft(pnl, "R_Alu", secs)
        prism(pnl, "R_Alu", rrect(0.05, 0.035, 0.012, cx=8.55, cy=-0.98), sd * 0.55, sd * 1.05, 'Y')
    t_face = (Vector((8.47, 0.04)) - Vector((8.30, -0.50))).normalized()
    for sd, cid in ((1, "C1"), (-1, "C2")):
        for k, yc in enumerate((0.48 + 0.16, 0.78 + 0.02, 1.12 - 0.02)):
            yc = [0.47, 0.79, 1.11][k] + 0.0
            y = sd * yc
            dx = x_front(y) - 8.30
            # tangente en planta para orientar la pantalla hacia el piloto
            h = 0.01
            slope = (x_front(y + h) - x_front(y - h)) / (2 * h)
            yaw = math.atan(slope)
            c2 = Vector((8.30 + dx, -0.50)) + t_face * 0.29
            n3 = Vector((-t_face.y, 0, t_face.x))  # normal de la cara (x,z) hacia popa-arriba
            n3 = Matrix.Rotation(-yaw, 3, 'Z') @ Vector((-abs(n3.x), 0, abs(n3.z)))
            up3 = Matrix.Rotation(-yaw, 3, 'Z') @ Vector((t_face.x, 0, t_face.y))
            M = Matrix.Translation((c2.x - 0.004, y, c2.y)) @ rot_to(-n3, up=up3)
            vs = prism(pnl, "R_Black", rrect(0.30, 0.245, 0.014), -0.010, 0.006, 'X')
            place(pnl, vs, M)
            vs = []
            for bb in range(5):
                vs += pnl.box("R_Frame", 0.008, 0.02, 0.012, center=(0.008, -0.12 + bb * 0.06, -0.136))
            place(pnl, vs, M)
            scr = MB(f"a_scr_{cid}D{k+1}")
            bm = scr.bm
            uv = bm.loops.layers.uv.new("UVMap")
            w, hh = 0.278, 0.212
            corners = [(-w / 2, -hh / 2), (w / 2, -hh / 2), (w / 2, hh / 2), (-w / 2, hh / 2)]
            vv = [bm.verts.new(M @ Vector((-0.0115, -u, v))) for (u, v) in corners]
            f = bm.faces.new(vv)
            f.material_index = scr.mi("R_Screen")
            for loop, (u, v) in zip(f.loops, corners):
                loop[uv].uv = (u / w + 0.5, v / hh + 0.5)
            screens.append((f"{cid}D{k+1}", scr))
    # --- pantallas auxiliares en la pared alta
    for s, sid in ((1, "AUXP"), (-1, "AUXS")):
        a = D(20)
        c = arc_pt(R_L - 0.03, a, s)
        M = Matrix.Translation((7.55, c.y, c.z)) @ rot_to((0, -s * math.cos(a), -math.sin(a)) if s > 0 else (0, math.cos(PI - a) * -1, -math.sin(a)), up=(0, 0, 1))
        nrm = -Vector((0, s * math.cos(a), math.sin(a)))
        M = Matrix.Translation((7.55, c.y, c.z)) @ rot_to(nrm, up=(1, 0, 0))
        vs = prism(pnl, "R_Black", rrect(0.40, 0.26, 0.012), -0.025, 0.0, 'X')
        place(pnl, vs, M)
        scr = MB(f"a_scr_{sid}")
        bm = scr.bm
        uv = bm.loops.layers.uv.new("UVMap")
        w, h = 0.37, 0.23
        corners = [(-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)]
        vv = [bm.verts.new(M @ Vector((0.0015, u, v))) for (u, v) in corners]
        f = bm.faces.new(vv)
        f.material_index = scr.mi("R_Screen")
        for loop, (u, v) in zip(f.loops, corners):
            loop[uv].uv = (u / w + 0.5, v / h + 0.5)
        screens.append((sid, scr))
    # --- asientos
    seats = []
    for k, s in ((1, 1), (2, -1)):
        mb = MB(f"a_seat_{k}")
        seat_mesh(mb, Matrix.Translation((7.62, s * 0.78, 0.0)))
        seats.append((k, s, mb))
        # controladores manuales en los reposabrazos (traslación a la izquierda, rotación a la derecha)
    hc = MB("a_hand_ctl")
    for s in (1, -1):
        hand_controller(hc, Matrix.Translation((7.80, s * 0.78 + s * 0.30, -0.47)))
        hand_controller(hc, Matrix.Translation((7.80, s * 0.78 - s * 0.30, -0.47)) @ Matrix.Scale(0.85, 4))
    # --- panel de interruptores repartido en las consolas laterales
    sw_parts = []
    swb = MB("a_switch_body")
    tg = None
    for row_i, (row, items) in enumerate(SWITCH_ROWS):
        s = 1 if row_i < 2 else -1
        rr = row_i % 2
        for c, (ident, lbl) in enumerate(items):
            x = 7.10 + c * 0.2
            y = s * (1.28 + rr * 0.20)
            z = -0.40 + (abs(y) - 1.09) * (0.07 / 0.53) + 0.012
            sw_parts.append((ident, lbl, row, Vector((x, y, z))))
            swb.box("R_Black", 0.11, 0.13, 0.012, center=(x, y, z - 0.006), rot=Matrix.Rotation(-s * math.atan(0.07 / 0.53), 4, 'X'))
            for d in (-1, 1):
                swb.box("R_Frame", 0.008, 0.06, 0.03, center=(x + d * 0.03, y, z + 0.008), rot=Matrix.Rotation(-s * math.atan(0.07 / 0.53), 4, 'X'))
    # --- iluminación horneable: luces de área (sólo Cycles; no se exportan)
    lights = [("cove", 6.75, 8.80), ("chan", 6.75, 8.80)]
    # --- emisión de partes
    P("HAB.INT.A.SHL.WALL", "Revestimiento de la cabina", wall, g, room, "Paneles curvos de PPSU con juntas de 4 mm y compartimentos altos.", bevel=0.004)
    P("HAB.INT.A.SHL.LOW", "Zócalos, consolas y suelo de cabina", dark, g, room, "Consolas laterales, zócalos y pavimento de caucho.", bevel=0.005)
    P("HAB.INT.A.SHL.FRM", "Nervios, cornisas y perfiles", frame, g, room, "Nervios grafito, cornisas de luz indirecta, raíles de anclaje.", bevel=0.003)
    P("HAB.INT.A.SHL.LED", "Iluminación integrada", led, g, room, "Tiras LED de cornisa, zócalo y canal cenital.")
    P("HAB.INT.A.CON", "Revestimiento facetado del cono", cone, g, room, "Dieciséis facetas con nueve huecos de ventana.", bevel=0.004, smooth=20)
    P("HAB.INT.A.WEL", "Pozos de ventana", wells, g, room, "Pozos de aluminio anodizado mate que eliminan reflejos parásitos.", smooth=None)
    P("HAB.INT.A.PAN", "Paneles interiores antirayado", panes, g, room, "Paneles de policarbonato de protección.", smooth=None)
    P("HAB.INT.A.BHD", "Mamparo de proa y brocal de escotilla", bh, g, room, "Mamparo con brocal bermellón y túnel hacia el nodo.", bevel=0.004)
    P("HAB.INT.A.STP", "Escalones de acceso al nodo", steps, g, room, "", bevel=0.006)
    P("HAB.INT.A.PNL", "Panel de instrumentos", pnl, g, room, "Dos cuerpos con seis pantallas multifunción y visera tapizada.", bevel=0.006)
    P("HAB.INT.A.HC", "Controladores manuales", hc, g, room, "Controladores de traslación y rotación en los reposabrazos.")
    P("HAB.INT.A.SWB", "Bases de interruptores", swb, g, room, "Bases y guardas de los 24 interruptores repartidos en las consolas laterales.", bevel=0.002)
    for sid, scr in screens:
        ob = P(f"HAB.INT.A.SCR.{sid}", f"Pantalla {sid}", scr, g, room, "Pantalla multifunción táctil.", smooth=None)
        ctl(ob, f"scr:{sid}")
    for k, s, mb in seats:
        ob = P(f"HAB.INT.A.ST{k}", "Asiento del comandante" if k == 1 else "Asiento del piloto", mb, g, room,
               "Asiento con pedestal sobre raíles, cojines de piel técnica perforada, alas laterales y arnés de cinco puntos.", bevel=0.004)
        ctl(ob, f"seat:{k}")
    tgm = MB("a_toggle")
    tgm.cyl("R_Steel", 0.0065, 0.005, 0.045, 12, center=(0, 0, 0.0225))
    tgm.sphere("R_Steel", 0.0075, 12, 6, center=(0, 0, 0.047))
    tgm.cyl("R_Frame", 0.012, 0.012, 0.006, 16, center=(0, 0, 0.003))
    tme = tgm.mesh(smooth=40)
    tgg = group("HAB.INT.A.TGL", "Palancas de interruptor", g, explode=(0, 0, 0.3))
    for ident, lbl, row, p in sw_parts:
        s = 1 if p.y > 0 else -1
        R = Matrix.Rotation(-s * math.atan(0.07 / 0.53), 4, 'X')
        ob = part(f"HAB.INT.A.TGL.{ident}", f"Interruptor: {lbl}", tme, tgg, desc=f"Palanca protegida de dos posiciones del grupo {row.lower()}.")
        ob.matrix_basis = Matrix.Translation(p) @ R
        ob["room"] = room
        axis = R.to_3x3() @ Vector((0, 1, 0))
        mech(ob, "hinge", p, axis, -0.45, 0.45, -0.45, ident=f"sw:{ident}", speed=6.0)
        ctl(ob, f"sw:{ident}")
    return g


# ------------------------------------------------------------------ bahías provisionales (envolvente completa)
def build_generic_bay(intg, key, label):
    x0, x1 = BAYS[key]
    g = group(f"HAB.INT.{key}", label, intg, explode=(0, 0, 0.6))
    wall, dark, frame, led, top = MB(f"{key}_wall"), MB(f"{key}_dark"), MB(f"{key}_frame"), MB(f"{key}_led"), MB(f"{key}_top")
    xm = (x0 + x1) / 2
    for s in (1, -1):
        for (a, b) in ((x0, xm), (xm, x1)):
            lining_module(wall, dark, frame, led, a, b, s, mb_top=top)
    ceiling_channel(led, frame, x0, x1)
    rib(frame, x0); rib(frame, xm); rib(frame, x1)
    floor_run(dark, frame, x0, x1)
    backing_shell(dark, x0, x1)
    P(f"HAB.INT.{key}.SHL.WALL", "Revestimiento", wall, g, key, bevel=0.004)
    P(f"HAB.INT.{key}.SHL.LOW", "Zócalos y suelo", dark, g, key, bevel=0.005)
    P(f"HAB.INT.{key}.SHL.FRM", "Nervios y perfiles", frame, g, key, bevel=0.003)
    P(f"HAB.INT.{key}.SHL.TOP", "Encimeras", top, g, key, bevel=0.003)
    P(f"HAB.INT.{key}.SHL.LED", "Iluminación integrada", led, g, key)
    return g


def build_aft_wall(g):
    x = BAYS["D"][0]
    mb = MB("d_aftwall")
    pts = [(R_L * math.cos(2 * PI * k / 96), R_L * math.sin(2 * PI * k / 96)) for k in range(96)]
    prism(mb, "R_Lining", pts, x - 0.03, x, 'X')
    P("HAB.INT.D.AFT", "Mamparo de popa", mb, g, "D", bevel=0.004)


def build(hab, fwd):
    build_materials()
    intg = group("HAB.INT", "Interior habitable", hab, explode=(0, 0, 0),
                 desc="Interior Rebirth: volumen continuo de 8,2 m con cabina, laboratorio, habitáculos y servicios.",
                 func="Habitabilidad, trabajo científico y pilotaje")
    from . import habitat_rooms as R
    import importlib
    importlib.reload(R)
    build_cockpit(intg, hab)
    R.build_lab(intg)
    R.build_quarters(intg)
    R.build_services(intg)
    R.build_node(fwd)
    return intg


# ------------------------------------------------------------------ luces de horneado
def bake_lights():
    """Luces de área de Cycles que representan las luminarias integradas (no se exportan)."""
    made = []
    coll = bpy.data.collections.get("BAKE_LIGHTS") or bpy.data.collections.new("BAKE_LIGHTS")
    if coll.name not in bpy.context.scene.collection.children:
        bpy.context.scene.collection.children.link(coll)

    def area(name, loc, size_x, size_y, rot, power, color, bay):
        ld = bpy.data.lights.new(name, 'AREA')
        ld.shape = 'RECTANGLE'
        ld.size, ld.size_y = size_x, size_y
        ld.energy = power
        ld.color = color
        ob = bpy.data.objects.new(name, ld)
        ob.location = loc
        ob.rotation_euler = rot
        ob["bay"] = bay
        coll.objects.link(ob)
        made.append(ob)
    for key, (x0, x1) in BAYS.items():
        L = x1 - x0
        xc = (x0 + x1) / 2
        for s in (1, -1):
            w = arc_pt(R_L, D(63.0), s)
            # cornisa: emite hacia el techo curvo
            area(f"L_cove_{key}_{s}", (xc, w.y - s * 0.045, w.z + 0.03), L - 0.1, 0.03, (D(180) - s * D(35), 0, 0) if False else (0, 0, 0), 34.0 * L, (1.0, 0.92, 0.84), key)
            made[-1].rotation_euler = (PI + s * D(40), 0, 0)
            # zócalo
            area(f"L_toe_{key}_{s}", (xc, s * (FACE + 0.054), FLOOR + TOE - 0.012), L - 0.1, 0.01, (0, 0, 0), 3.0 * L, (1.0, 0.92, 0.84), key)
        # canal cenital (difusor)
        area(f"L_chan_{key}", (xc, 0, R_L + 0.02), L - 0.04, 0.24, (0, 0, 0), 45.0 * L, (1.0, 0.93, 0.85), key)
    # luminarias específicas declaradas por las estancias (marcadores LMARK_*)
    for mk in [o for o in bpy.data.objects if o.name.startswith("LMARK_")]:
        kind = mk.get("lkind", "area")
        if kind == "point":
            ld = bpy.data.lights.new(mk.name[6:], 'POINT')
            ld.shadow_soft_size = 0.1
        else:
            ld = bpy.data.lights.new(mk.name[6:], 'AREA')
            ld.shape = 'RECTANGLE'
            ld.size, ld.size_y = mk["size"][0], mk["size"][1]
        ld.energy = mk["power"]
        ld.color = tuple(mk["color"])
        ob = bpy.data.objects.new("L_" + mk.name[6:], ld)
        ob.matrix_world = mk.matrix_world
        ob["bay"] = mk.get("bay", "A")
        coll.objects.link(ob)
        made.append(ob)
    return made
