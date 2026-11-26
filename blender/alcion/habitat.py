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
from .kit import (
    fillet, rrect, prism, loft, arc_panel, cone_frustum_panel, cushion, draped_sheet,
    strap, place, rot_to, beveled_frame, louver_grille, gauge, knob, buckle, bolt_ring, pipe_bundle,
)
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
X_CONE0, X_CONE1 = S.X_HAB_F, 9.88   # 2 cm a popa de FWD.STR.BHA (9.90) para evitar solape exterior
R_CONE_L1 = 1.25     # radio del revestimiento al final del cono
HATCH_R = 0.505      # radio interior del túnel de escotilla (cubre borde de FWD.STR.BHA en 0.52)
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
    "R_Indicator":  ((0.4, 0.8, 0.5), 0.0, 0.3, (0.3, 1.0, 0.5), "Indicador nominal verde"),
    "R_Warning":    ((0.95, 0.62, 0.08), 0.0, 0.3, (1.0, 0.65, 0.12), "Avisador de cautela ámbar"),
    "R_Alarm":      ((0.95, 0.12, 0.08), 0.0, 0.3, (1.0, 0.14, 0.08), "Avisador de alarma rojo"),
    "R_Bag":        ((0.48, 0.44, 0.37), 0.0, 0.90, None, "Bolsa de estiba de Nomex arena"),
    "R_BagTech":    ((0.18, 0.20, 0.21), 0.0, 0.88, None, "Bolsa de estiba de tejido técnico gris pizarra"),
    "R_Plant":      ((0.06, 0.22, 0.045), 0.0, 0.52, None, "Cultivo de hoja verde"),
    "R_PlantDark":  ((0.03, 0.11, 0.025), 0.0, 0.48, None, "Tallos y follaje oscuro de cultivo"),
    "R_Dial":       ((0.78, 0.77, 0.73), 0.0, 0.35, None, "Esfera de instrumento / manómetro"),
    "R_Label":      ((0.50, 0.49, 0.46), 0.0, 0.5, None, "Rotulación serigrafiada"),
    "R_Decal":      ((0.62, 0.60, 0.55), 0.0, 0.6, None, "Etiquetas y señalización (atlas)"),
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
            b.inputs["Emission Strength"].default_value = 4.0 if name not in ("R_Screen", "R_Warning", "R_Alarm") else 1.6
        if name in ("R_Glass",):
            b.inputs["Transmission Weight"].default_value = 1.0
            b.inputs["Alpha"].default_value = 0.15
        m.diffuse_color = (*col, 1)
        m["desc"] = desc
        MATS[name] = m


# ------------------------------------------------------------------ rotulación (atlas blender/textures/labels_atlas.png, 8×20 teselas)
ATLAS_COLS, ATLAS_ROWS = 8, 20
DECALS = []
_DRND = __import__("random").Random(21)
SIGN = {
    "extintor": 96, "mascara": 97, "auxilios": 98, "salida": 99, "proa": 100, "popa": 101, "nopisar": 102, "caliente": 103,
    "tension": 104, "agua": 105, "aguagris": 106, "o2": 107, "n2": 108, "bayA": 109, "bayB": 110, "bayC": 111,
    "bayD": 112, "nodo": 113, "esclusa": 114, "cierre": 115, "anclaje": 116, "libre": 117, "co2": 118, "vent": 119,
    "alcion": 120, "trip1": 121, "trip2": 122, "trip3": 123, "trip4": 124, "crio": 125, "guantera": 126, "asidero": 127,
    # nuevas placas técnicas (filas 16..19 -> teselas 128..159)
    "avionica": 128, "eclss": 129, "potencia": 130, "gnc": 131, "mwarn": 132, "mcaut": 133, "avisadores": 134, "ilum": 135,
    "sistemas": 136, "propulsion": 137, "ctb1": 138, "ctb2": 139, "ctb3": 140, "ctb4": 141, "ctb5": 142, "ctb6": 143,
    "ctb7": 144, "ctb8": 145, "presur": 146, "ecual": 147, "cupula": 148, "rws": 149, "cultivo": 150, "micro": 151,
    "congelador": 152, "dispagua": 153, "calentador": 154, "ciclo": 155, "consolap": 156, "idss": 157, "eth28": 158, "vla": 159,
}


def decal(M, w, h, tile=None):
    """Calcomanía: M lleva +X local hacia el observador, +Y a la derecha del texto y +Z hacia arriba."""
    if tile is None:
        tile = _DRND.randint(0, 95)
    DECALS.append((M.copy(), w, h, tile))


def wall_decal(x, s, a, w, h, tile=None, inward=0.0):
    p = arc_pt(R_L - 0.0015 - inward, a, s)
    n = -Vector((0, s * math.cos(a), math.sin(a)))
    up = Vector((0, -s * math.sin(a), math.cos(a)))
    decal(Matrix.Translation((x, p.y, p.z)) @ rot_to(n, up=up), w, h, tile)


def flush_decals(parent, room, code):
    if not DECALS:
        return None
    mb = MB(f"decals_{room}")
    bm = mb.bm
    uv = bm.loops.layers.uv.new("UVMap")
    idx = mb.mi("R_Decal")
    for M, w, h, t in DECALS:
        c, r = t % ATLAS_COLS, t // ATLAS_COLS
        u0, u1 = c / ATLAS_COLS + 0.002, (c + 1) / ATLAS_COLS - 0.002
        v0, v1 = 1 - (r + 1) / ATLAS_ROWS + 0.0025, 1 - r / ATLAS_ROWS - 0.0025
        corners = [(-w / 2, -h / 2, u0, v0), (w / 2, -h / 2, u1, v0), (w / 2, h / 2, u1, v1), (-w / 2, h / 2, u0, v1)]
        vv = [bm.verts.new(M @ Vector((0.0, x, y))) for x, y, _, _ in corners]
        f = bm.faces.new(vv)
        f.material_index = idx
        for loop, (_, _, u, v) in zip(f.loops, corners):
            loop[uv].uv = (u, v)
    DECALS.clear()
    me = mb.mesh(smooth=None)
    ob = part(code, "Rotulación", me, parent, desc="Etiquetas de inventario y señalización de seguridad y orientación.")
    ob["room"] = room
    return ob


# ------------------------------------------------------------------ utilidades
def P(code, label, mb, parent, room, desc="", bevel=None, smooth=35, explode=None, interact=None):
    me = mb.mesh(smooth=smooth, bevel=bevel)
    ob = part(code, label, me, parent, desc=desc, explode=explode)
    ob["room"] = room
    if interact:
        ob["interact"] = interact
    return ob


def set_interact_pose(ob, pos, rot=(0.0, 0.0, 0.0)):
    """Guarda extra glTF `interact_pose` = [px, py, pz, rx, ry, rz] en coordenadas Blender."""
    ob["interact_pose"] = [round(float(v), 4) for v in (*pos, *rot)]
    return ob


def set_prop(ob, prop_id, pos, rot=(0.0, 0.0, 0.0)):
    """Marca un objeto interactivo físico (prop_id + interact_pose) para el contrato H1 ↔ H2."""
    ob["prop_id"] = prop_id
    return set_interact_pose(ob, pos, rot)


def screen_mesh_quad(name, M, w, h, x_off=0.0, flip_u=False):
    """Construye un quad de pantalla con winding determinista (sin recalc_face_normals)
    para que la normal apunte siempre hacia el observador y las UVs queden al derecho."""
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    corners = [(-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)]
    s_u = -1.0 if flip_u else 1.0
    vv = [bm.verts.new(M @ Vector((x_off, s_u * u, v))) for (u, v) in corners]
    f = bm.faces.new(vv)
    f.material_index = 0
    for loop, (u, v) in zip(f.loops, corners):
        loop[uv].uv = (u / w + 0.5, v / h + 0.5)
    bm.normal_update()
    expected = (M.to_3x3() @ Vector((-1.0 if flip_u else 1.0, 0.0, 0.0))).normalized()
    if f.normal.dot(expected) < 0.99:
        bm.free()
        raise ValueError(f"Normal invertida en pantalla {name}: {tuple(f.normal)} vs {tuple(expected)}")
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(MATS["R_Screen"])
    return me


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
        # tirador rebajado del compartimento alto y pestillos de cuarto de vuelta
        a = D(34.5)
        c = arc_pt(R_L - 0.016, a, s)
        xm = (x0 + x1) / 2
        mb_frame.box("R_Frame", (x1 - x0) * 0.42, 0.012, 0.018, center=(xm, c.y, c.z),
                     rot=Matrix.Rotation(mirror_a(a, s) - PI / 2, 4, 'X'))
        for dx in (-(x1 - x0) * 0.36, (x1 - x0) * 0.36):
            mb_frame.cyl("R_Alu", 0.007, 0.007, 0.008, 8, center=(xm + dx, c.y, c.z),
                         rot=Matrix.Rotation(mirror_a(a, s), 4, 'X'))
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
        prof = fillet([(s * (FACE - 0.04), WT - 0.034), (s * 1.935, WT - 0.034), (s * 1.935, WT), (s * (FACE - 0.04), WT)], [0, 0, 0, 0.012], 3)
        prism(top, "R_Worktop", prof, x0 + g, x1 - g, 'X')
        # canto de aluminio
        prism(mb_frame, "R_Alu", rrect(0.006, 0.03, 0.002, cx=s * (FACE - 0.043), cy=WT - 0.017), x0 + g, x1 - g, 'X')
    if upper:
        # pasamanos de microgravedad (grafito con remates bermellón y bases mecanizadas) y rejilla de impulsión
        a = D(12)
        c = arc_pt(R_L - 0.075, a, s)
        L = (x1 - x0) * 0.7
        xm = (x0 + x1) / 2
        mb_frame.cyl("R_Frame", 0.014, 0.014, L, 14, center=(xm, c.y, c.z), axis='X')
        b0 = arc_pt(R_L - 0.005, a, s)
        for xe in (xm - L / 2, xm + L / 2):
            mb_frame.beam("R_Frame", (xe, b0.y, b0.z), (xe, c.y, c.z), 0.02, 0.02)
            mb_frame.box("R_Alu", 0.038, 0.010, 0.034, center=(xe, b0.y - s * 0.004, b0.z),
                         rot=Matrix.Rotation(mirror_a(a, s) - PI / 2, 4, 'X'))
            mb_frame.cyl("R_Accent", 0.016, 0.016, 0.03, 14, center=(xe + (0.015 if xe < xm else -0.015), c.y, c.z), axis='X')
        # rejilla de impulsión de aire enmarcada
        av = D(58.5)
        cc = arc_pt(R_L - 0.014, av, s)
        Mv = Matrix.Translation((xm, cc.y, cc.z)) @ rot_to(-Vector((0, s * math.cos(av), math.sin(av))), up=Vector((0, -s * math.sin(av), math.cos(av))))
        louver_grille(mb_frame, "R_Frame", "R_Alu", 0.36, 0.065, depth=0.009, slats=4, M=Mv)
    if lower:
        # frentes de armario con relieve perimetral, tirador empotrado, cierre 1/4 de vuelta y bisagras
        n = max(1, round((x1 - x0) / 0.5))
        w = (x1 - x0) / n
        z_bot = FLOOR + TOE + 0.004
        z_top = WT - 0.04
        dh = (z_top - z_bot) - 0.05
        zm = (z_top + z_bot) / 2 - 0.025
        for k in range(n):
            xa, xb = x0 + k * w + g, x0 + (k + 1) * w - g
            xm = (xa + xb) / 2
            dw = xb - xa
            prof = rrect(0.022, dh, 0.004, cx=s * (FACE + 0.011), cy=zm)
            prism(mb_dark, "R_LiningDark", prof, xa, xb, 'X')
            # uñero (franja grafito profunda) + tirador empotrado en aluminio
            prism(mb_frame, "R_Frame", rrect(0.03, 0.03, 0.004, cx=s * (FACE + 0.02), cy=WT - 0.06), xa, xb, 'X')
            mb_frame.box("R_Alu", dw * 0.38, 0.008, 0.014, center=(xm, s * (FACE + 0.003), WT - 0.062))
            # cierre de cuarto de vuelta (esquina superior derecha) y 2 bisagras laterales
            mb_frame.cyl("R_Alu", 0.009, 0.009, 0.006, 10, center=(xb - 0.045, s * (FACE - 0.001), zm + dh * 0.36), axis='Y')
            mb_frame.box("R_Black", 0.012, 0.007, 0.003, center=(xb - 0.045, s * (FACE - 0.0035), zm + dh * 0.36))
            for zh in (zm - dh * 0.32, zm + dh * 0.28):
                mb_frame.cyl("R_Frame", 0.006, 0.006, 0.032, 8, center=(xa + 0.005, s * (FACE - 0.001), zh), axis='Z')
            # ranura de ventilación inferior en puertas alternas
            if k % 2 == 1:
                for sl in range(3):
                    mb_frame.box("R_Black", dw * 0.52, 0.004, 0.007, center=(xm, s * (FACE - 0.001), z_bot + 0.06 + sl * 0.016))
            decal(Matrix.Translation((xa + 0.12, s * (FACE - 0.0018), WT - 0.15)) @ rot_to((0, -s, 0), up=(0, 0, 1)), 0.15, 0.0375)
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
    for q in range(8):
        arc_panel(mb, "R_Backing", R_BK, R_BK + 0.012, q * PI / 4, (q + 1) * PI / 4, x0, x1, 8)


# ------------------------------------------------------------------ cabina (bahía A + cono)
def seat_mesh(mb, M, accent=True):
    """Asiento de piloto esculpido: raíles deslizantes, bastidor mecanizado con amortiguador,
    carcasa trasera anatómica con nervios, cojines segmentados + bolsters, reposacabezas
    en doble barra de acero, reposabrazos perfilados y arnés de 4 puntos con hebilla central."""
    vs = []
    # --- 1. Raíles deslizantes y carros mecanizados
    for sy in (-1, 1):
        vs += prism(mb, "R_Alu", rrect(0.56, 0.024, 0.005, cx=-0.02, cy=-1.138), sy * 0.175 - 0.018, sy * 0.175 + 0.018, 'Y')
        vs += mb.box("R_Frame", 0.34, 0.044, 0.028, center=(-0.03, sy * 0.175, -1.116))
        # topes de fin de carrera
        for ex in (-0.29, 0.25):
            vs += mb.box("R_Frame", 0.022, 0.042, 0.030, center=(ex, sy * 0.175, -1.135))
        # patas estructurales inclinadas con perfil aligerado
        leg = fillet([(-0.18, -1.105), (0.12, -1.105), (0.16, -0.78), (0.08, -0.76), (-0.16, -0.78), (-0.21, -0.92)], 0.018, 3)
        vs += prism(mb, "R_Frame", leg, sy * 0.175 - 0.016, sy * 0.175 + 0.016, 'Y')
    # travesaños + cilindro amortiguador hidráulico central + palanca de ajuste
    vs += mb.cyl("R_Frame", 0.018, 0.018, 0.36, 12, center=(-0.10, 0, -0.94), axis='Y')
    vs += mb.cyl("R_Frame", 0.018, 0.018, 0.36, 12, center=(0.08, 0, -0.84), axis='Y')
    vs += mb.cyl("R_Frame", 0.034, 0.034, 0.16, 16, center=(-0.03, 0, -1.02), rot=Matrix.Rotation(D(14), 4, 'Y'))
    vs += mb.cyl("R_Steel", 0.018, 0.018, 0.19, 16, center=(-0.01, 0, -0.88), rot=Matrix.Rotation(D(14), 4, 'Y'))
    # palanca delantera de deslizamiento (remate bermellón)
    vs += mb.tube("R_Steel", [(0.16, -0.14, -0.79), (0.25, -0.11, -0.79), (0.25, 0.11, -0.79), (0.16, 0.14, -0.79)], 0.007, 8, round_r=0.02)
    vs += mb.cyl("R_Accent", 0.012, 0.012, 0.09, 10, center=(0.25, 0.0, -0.79), axis='Y')

    # --- 2. Bandeja base de asiento (carcasa inferior en R_Frame)
    base_pan = fillet([(-0.30, -0.79), (0.22, -0.79), (0.26, -0.73), (0.23, -0.70), (-0.24, -0.71), (-0.33, -0.74)], 0.018, 3)
    vs += prism(mb, "R_Frame", base_pan, -0.25, 0.25, 'Y')

    # --- 3. Carcasa trasera esculpida en S con estrechamiento superior (loft limpio, nunca atravesado por el cojín)
    # secciones: (z, x_back_center, half_width, curve_fwd_at_edge, thickness)
    shell_specs = [
        (-0.74, -0.325, 0.252, 0.045, 0.036),
        (-0.60, -0.300, 0.255, 0.055, 0.034),
        (-0.42, -0.315, 0.248, 0.058, 0.032),
        (-0.22, -0.348, 0.240, 0.052, 0.030),
        (-0.04, -0.378, 0.225, 0.042, 0.028),
        (0.08,  -0.398, 0.190, 0.028, 0.026),
        (0.125, -0.405, 0.145, 0.015, 0.024),
    ]
    secs_shell = []
    ny_pts = 9
    for z, xb, hw, cf, th in shell_specs:
        ring = []
        # cara trasera (desde -hw a +hw)
        for i in range(ny_pts):
            u = -1.0 + 2.0 * i / (ny_pts - 1)
            y = u * hw
            x = xb + cf * (u * u)
            ring.append(Vector((x, y, z)))
        # cara interior/frontal (desde +hw a -hw)
        for i in range(ny_pts - 1, -1, -1):
            u = -1.0 + 2.0 * i / (ny_pts - 1)
            y = u * (hw - 0.008)
            x = xb + th + cf * (u * u) * 0.85
            ring.append(Vector((x, y, z)))
        secs_shell.append(ring)
    vs += loft(mb, "R_Frame", secs_shell, closed=True, cap=True)

    # nervios estructurales traseros mecanizados (visibles desde la vista general de cabina!)
    for sy in (-1, 1):
        rib_pts = [
            Vector((-0.332, sy * 0.115, -0.68)),
            Vector((-0.310, sy * 0.115, -0.52)),
            Vector((-0.335, sy * 0.110, -0.30)),
            Vector((-0.378, sy * 0.095, -0.06)),
            Vector((-0.406, sy * 0.075, 0.08)),
        ]
        vs += mb.tube("R_Alu", rib_pts, 0.013, 8, round_r=0.05)
    # placa trasera de registro + tornillos + asidero superior bermellón en el respaldo
    Rback = Matrix.Rotation(D(-11), 4, 'Y')
    vs += mb.box("R_LiningDark", 0.014, 0.17, 0.24, center=(-0.348, 0, -0.32), rot=Rback)
    vs += beveled_frame(mb, "R_Alu", 0.178, 0.248, 0.010, 0.012,
                        M=Matrix.Translation((-0.354, 0, -0.32)) @ Rback)
    # asidero de microgravedad trasero superior (bermellón)
    vs += mb.tube("R_Accent", [(-0.405, -0.105, 0.05), (-0.445, -0.095, 0.055), (-0.445, 0.095, 0.055), (-0.405, 0.105, 0.05)], 0.010, 8, round_r=0.025)

    # --- 4. Cojines de banqueta segmentados (3 paños horizontales + bolsters laterales)
    # (cx, sx, sz, zc, pitch_deg)
    seat_pads = [
        (-0.145, 0.145, 0.072, -0.672, 2.0),
        (0.005,  0.145, 0.074, -0.668, -2.0),
        (0.155,  0.140, 0.078, -0.658, -7.0),
    ]
    for idx_p, (px, sx, sz, pz, ang) in enumerate(seat_pads):
        vs += cushion(mb, "R_Leather", sx, 0.34, sz, center=(px, 0, pz),
                      R=Matrix.Rotation(D(ang), 4, 'Y'), puff=0.012, round_=0.024, sub=1, seed=10 + idx_p, wrinkle=0.0015)
    # bolsters laterales de banqueta
    for sy in (-1, 1):
        vs += cushion(mb, "R_Leather", 0.44, 0.092, 0.095, center=(0.01, sy * 0.215, -0.642),
                      R=Matrix.Rotation(D(-16 * sy), 4, 'X') @ Matrix.Rotation(D(-2), 4, 'Y'),
                      puff=0.008, round_=0.032, sub=1, seed=20 + sy)

    # --- 5. Cojines del respaldo segmentados en 4 celdas ergonómicas + bolsters laterales altos
    # todos desplazados a +X delante de la carcasa (x >= -0.295) para CERO penetración trasera
    back_pads = [
        (-0.228, -0.525, 0.155, 0.34, 0.072, -8.0),   # soporte lumbar (más prominente)
        (-0.246, -0.365, 0.155, 0.33, 0.066, -11.0),  # dorsal bajo
        (-0.276, -0.205, 0.155, 0.31, 0.064, -12.0),  # dorsal alto
        (-0.308, -0.045, 0.150, 0.27, 0.060, -10.0),  # zona escapular
    ]
    for idx_b, (bx, bz, bh, bw, bt, ang) in enumerate(back_pads):
        vs += cushion(mb, "R_Leather", bt, bw, bh, center=(bx, 0, bz),
                      R=Matrix.Rotation(D(ang), 4, 'Y'), puff=0.009, round_=0.022, sub=1, seed=30 + idx_b, wrinkle=0.0015)
    # bolsters laterales contorneados del respaldo
    for sy in (-1, 1):
        vs += cushion(mb, "R_Leather", 0.105, 0.082, 0.50, center=(-0.235, sy * 0.208, -0.32),
                      R=Matrix.Rotation(D(-11), 4, 'Y') @ Matrix.Rotation(D(-20 * sy), 4, 'Z') @ Matrix.Rotation(D(-10 * sy), 4, 'X'),
                      puff=0.008, round_=0.030, sub=1, seed=40 + sy)

    # --- 6. Reposacabezas anatómico sobre doble barra de acero
    for sy in (-1, 1):
        vs += mb.cyl("R_Steel", 0.009, 0.009, 0.13, 12, center=(-0.375, sy * 0.068, 0.135), rot=Matrix.Rotation(D(-8), 4, 'Y'))
        vs += mb.cyl("R_Frame", 0.015, 0.015, 0.022, 12, center=(-0.382, sy * 0.068, 0.112), rot=Matrix.Rotation(D(-8), 4, 'Y'))
    # carcasa trasera del reposacabezas + cojín central + alas laterales
    Rhd = Matrix.Rotation(D(-6), 4, 'Y')
    vs += cushion(mb, "R_Frame", 0.032, 0.23, 0.145, center=(-0.398, 0, 0.215), R=Rhd, puff=0.006, round_=0.015, sub=1, seed=49)
    vs += cushion(mb, "R_Leather", 0.072, 0.21, 0.155, center=(-0.352, 0, 0.215), R=Rhd, puff=0.010, round_=0.032, sub=1, seed=50)
    for sy in (-1, 1):
        vs += cushion(mb, "R_Leather", 0.068, 0.058, 0.145, center=(-0.332, sy * 0.118, 0.212),
                      R=Rhd @ Matrix.Rotation(D(-22 * sy), 4, 'Z'), puff=0.005, round_=0.022, sub=1, seed=52 + sy)

    # --- 7. Reposabrazos perfilados (mantiene cota superior z = -0.47 para los hand_controller)
    for sy in (-1, 1):
        arm_frame = fillet([(-0.24, -0.66), (-0.16, -0.66), (-0.14, -0.535), (0.21, -0.535), (0.21, -0.505), (-0.21, -0.505)], 0.016, 3)
        vs += prism(mb, "R_Frame", arm_frame, sy * 0.252, sy * 0.282, 'Y')
        vs += mb.cyl("R_Alu", 0.022, 0.022, 0.038, 14, center=(-0.19, sy * 0.268, -0.53), axis='Y')
        vs += cushion(mb, "R_Leather", 0.36, 0.078, 0.038, center=(0.01, sy * 0.292, -0.490), puff=0.005, round_=0.015, sub=1, seed=60 + sy)

    # --- 8. Arnés de 4 puntos bien asentado sobre los cojines + pasos metálicos + hebilla central
    if accent:
        for sy in (-1, 1):
            # ojal/pasador metálico en el hombro
            vs += mb.box("R_Alu", 0.024, 0.056, 0.014, center=(-0.342, sy * 0.105, 0.055), rot=Matrix.Rotation(D(-10), 4, 'Y'))
            # cinta de hombro siguiendo exactamente la superficie frontal de los cojines
            sh_pts = [
                (-0.340, sy * 0.105, 0.055),
                (-0.272, sy * 0.102, -0.045),
                (-0.238, sy * 0.095, -0.205),
                (-0.205, sy * 0.082, -0.365),
                (-0.180, sy * 0.062, -0.500),
                (-0.130, sy * 0.035, -0.545),
            ]
            vs += strap(mb, "R_FabricBlue", sh_pts, 0.046, 0.004, up=(1, 0, 0))
            # tensor deslizante metálico en el pecho
            vs += mb.box("R_Alu", 0.012, 0.054, 0.024, center=(-0.232, sy * 0.094, -0.225), rot=Matrix.Rotation(D(-12), 4, 'Y'))
            # cintas abdominales desde los costados de la banqueta hasta la hebilla
            lap_pts = [
                (-0.17, sy * 0.215, -0.605),
                (-0.14, sy * 0.145, -0.575),
                (-0.118, sy * 0.048, -0.555),
            ]
            vs += strap(mb, "R_FabricBlue", lap_pts, 0.046, 0.004, up=(0, 0, 1))
            vs += mb.box("R_Alu", 0.022, 0.016, 0.050, center=(-0.148, sy * 0.165, -0.585), rot=Matrix.Rotation(D(20 * sy), 4, 'Z'))
        # hebilla rotativa aeroespacial central
        vs += mb.cyl("R_Alu", 0.046, 0.046, 0.018, 20, center=(-0.115, 0, -0.552), axis='X')
        vs += mb.torus("R_Frame", 0.044, 0.005, 20, 6, center=(-0.106, 0, -0.552), axis='X')
        vs += mb.cyl("R_Accent", 0.022, 0.020, 0.014, 16, center=(-0.102, 0, -0.552), axis='X')
    place(mb, vs, M)


def hand_controller(mb, M, rot_handle=True):
    """Controlador manual aeroespacial: base con fuelle articulado, reposamuñecas,
    empuñadura anatómica inclinada, gatillo, hat-switch y botón bermellón."""
    vs = []
    # base mecanizada con anillo de montaje y 4 tornillos
    vs += mb.cyl("R_Frame", 0.044, 0.040, 0.024, 20, center=(0, 0, 0.012))
    vs += mb.cyl("R_Alu", 0.048, 0.048, 0.006, 20, center=(0, 0, 0.003))
    # fuelle de goma escalonado (3 pliegues)
    for k in range(3):
        z = 0.028 + k * 0.014
        vs += mb.cyl("R_Rubber", 0.036 - k * 0.003, 0.028 - k * 0.002, 0.012, 16, center=(0, 0, z))
    # plataforma reposamuñecas en la base de la empuñadura
    vs += mb.box("R_Frame", 0.052, 0.068, 0.010, center=(-0.012, 0, 0.072))
    if rot_handle:
        # sidestick de rotación: empuñadura ergonómica inclinada ligeramente hacia popa
        sec = []
        for k in range(7):
            u = k / 6
            z = 0.072 + k * 0.022
            x_off = -0.018 * u + 0.006 * math.sin(u * PI)
            r = 0.020 + 0.006 * math.sin(u * PI)
            sec.append([Vector((x_off + r * math.cos(a) * 1.18, r * math.sin(a), z)) for a in [i / 14 * 2 * PI for i in range(14)]])
        vs += loft(mb, "R_Rubber", sec)
        # cabeza superior ensanchada con botones y hat-switch
        vs += mb.sphere("R_Frame", 0.027, 16, 8, center=(-0.018, 0, 0.210), scale=(1.22, 1.05, 0.65))
        vs += mb.cyl("R_Accent", 0.008, 0.007, 0.012, 12, center=(-0.006, 0.008, 0.226))
        vs += mb.cyl("R_Alu", 0.009, 0.005, 0.014, 10, center=(-0.026, -0.008, 0.226))  # hat switch
        vs += mb.box("R_Alu", 0.014, 0.008, 0.028, center=(0.012, 0, 0.168), rot=Matrix.Rotation(D(15), 4, 'Y'))  # gatillo
    else:
        # controlador de traslación 3-DOF en T ergonómica
        vs += mb.cyl("R_Frame", 0.018, 0.016, 0.085, 14, center=(0, 0, 0.115))
        vs += mb.cyl("R_Rubber", 0.022, 0.022, 0.115, 16, center=(0, 0, 0.165), axis='Y')
        for sy in (-1, 1):
            vs += mb.cyl("R_Alu", 0.024, 0.024, 0.010, 14, center=(0, sy * 0.060, 0.165), axis='Y')
        vs += mb.cyl("R_Accent", 0.009, 0.009, 0.010, 12, center=(0.018, 0, 0.165), axis='X')
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
    # --- consolas laterales (sustituyen zócalo y encimera): tapa inclinada con subpaneles y rejillas
    for s in (1, -1):
        prof = fillet([(s * 1.10, FLOOR), (s * 1.62, FLOOR), (s * 1.75, -0.45), (s * 1.62, -0.33), (s * 1.10, -0.40)], [0, 0, 0.03, 0.04, 0.03], 4)
        prism(dark, "R_LiningDark", prof, 6.95, 8.40, 'X')
        prism(frame, "R_Frame", fillet([(s * 1.09, -0.405), (s * 1.62, -0.335), (s * 1.62, -0.315), (s * 1.09, -0.385)], 0.006, 2), 6.94, 8.41, 'X')
        # borde de aluminio cepillado en el canto interior de la consola
        prism(frame, "R_Alu", rrect(0.012, 0.014, 0.003, cx=s * 1.092, cy=-0.395), 6.95, 8.40, 'X')
        # rejillas de refrigeración de aviónica en el costado vertical hacia el pasillo
        for gx in (7.30, 7.95):
            Mg = Matrix.Translation((gx, s * 1.098, -0.78)) @ rot_to((0, -s, 0), up=(0, 0, 1))
            louver_grille(frame, "R_Frame", "R_Alu", 0.34, 0.14, depth=0.012, slats=5, M=Mg)
        # subpanel auxiliar en el extremo proa de la consola lateral (x = 8.26, libre de los toggles 7.10..8.10)
        slope_ang = -s * math.atan(0.07 / 0.53)
        n_top = Vector((0, -s * math.sin(abs(slope_ang)), math.cos(abs(slope_ang)))).normalized()
        for ky, y_pos in enumerate((1.26, 1.44)):
            z_pos = -0.40 + (y_pos - 1.09) * (0.07 / 0.53) + 0.010
            knob(frame, "R_Frame", "R_Accent" if ky == 0 else "R_Alu", (8.26, s * y_pos, z_pos), n_top, r=0.016, h=0.015, up=(1, 0, 0))
        # conector circular de comunicaciones
        z_conn = -0.40 + (1.56 - 1.09) * (0.07 / 0.53) + 0.009
        frame.cyl("R_Steel", 0.016, 0.016, 0.012, 12, center=(8.26, s * 1.56, z_conn), rot=Matrix.Rotation(slope_ang, 4, 'X'))
        frame.cyl("R_Black", 0.010, 0.010, 0.014, 10, center=(8.26, s * 1.56, z_conn), rot=Matrix.Rotation(slope_ang, 4, 'X'))
        # etiquetas de grupo en el borde proa/exterior de la consola (sin tapar los toggles)
        for rr in (0, 1):
            y_lbl = s * (1.28 + rr * 0.20)
            z_lbl = -0.40 + (abs(y_lbl) - 1.09) * (0.07 / 0.53) + 0.014
            Mlbl = Matrix.Translation((6.995, y_lbl, z_lbl)) @ rot_to(n_top, up=(1, 0, 0))
            tile_k = [SIGN["potencia"], SIGN["ilum"], SIGN["sistemas"], SIGN["propulsion"]][(0 if s > 0 else 2) + rr]
            decal(Mlbl, 0.14, 0.035, tile_k)
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
        canopy.surface_patch(wells, "R_Frame", i, lambda x: r_cone(x) - 0.012, 0.012, nx=1, na=1, x0=xa - 0.03, x1=xa, half=half + 0.02)
        canopy.surface_patch(wells, "R_Frame", i, lambda x: r_cone(x) - 0.012, 0.012, nx=1, na=1, x0=xb, x1=xb + 0.03, half=half + 0.02)
    panes = MB("a_panes")
    for i in canopy.WIN_FACETS:
        canopy.surface_patch(panes, "R_Glass", i, lambda x: r_cone(x) + 0.05, 0.008, nx=2, na=2)

    # --- mamparo de proa con escotilla hacia el nodo (en X_CONE1 = 9.88, delante de FWD.STR.BHA en 9.90!)
    bh = MB("a_bulkhead")
    for q in range(4):
        a0, a1 = q * PI / 2, (q + 1) * PI / 2
        pts = [(R_CONE_L1 * math.cos(a0 + (a1 - a0) * t / 12), R_CONE_L1 * math.sin(a0 + (a1 - a0) * t / 12)) for t in range(13)]
        pts += [(HATCH_R * math.cos(a1 - (a1 - a0) * t / 12), HATCH_R * math.sin(a1 - (a1 - a0) * t / 12)) for t in range(13)]
        prism(bh, "R_Lining", pts, X_CONE1, X_CONE1 + 0.022, 'X')
    # anillo estructural mecanizado de escotilla + tornillería + brocal bermellón + túnel
    secs = []
    for x, r in ((X_CONE1 - 0.036, HATCH_R + 0.075), (X_CONE1 - 0.036, HATCH_R), (10.12, HATCH_R), (10.12, HATCH_R + 0.03)):
        secs.append([Vector((x, r * math.cos(2 * PI * k / 64), r * math.sin(2 * PI * k / 64))) for k in range(64)])
    loft(bh, "R_Accent", secs[:2], closed=True, cap=False)
    loft(bh, "R_Frame", secs[1:3], closed=True, cap=False)
    # brida exterior mecanizada de aluminio con 24 tornillos hexagonales
    brida_secs = []
    for x, r in ((X_CONE1 - 0.014, HATCH_R + 0.145), (X_CONE1 - 0.014, HATCH_R + 0.072), (X_CONE1, HATCH_R + 0.072), (X_CONE1, HATCH_R + 0.145)):
        brida_secs.append([Vector((x, r * math.cos(2 * PI * k / 64), r * math.sin(2 * PI * k / 64))) for k in range(64)])
    loft(bh, "R_Alu", brida_secs, closed=True, cap=False)
    bolt_ring(bh, "R_Steel", (X_CONE1 - 0.014, 0, 0), (-1, 0, 0), HATCH_R + 0.112, 24, r_head=0.007, h=0.006)
    # 6 pestillos radiales mecanizados alrededor de la escotilla
    for k in range(6):
        a = k * PI / 3 + PI / 6
        c = Vector((X_CONE1 - 0.024, (HATCH_R + 0.088) * math.cos(a), (HATCH_R + 0.088) * math.sin(a)))
        bh.box("R_Frame", 0.024, 0.072, 0.030, center=c, rot=Matrix.Rotation(a, 4, 'X'))
        bh.box("R_Alu", 0.030, 0.026, 0.014, center=c + Vector((-0.008, 0, 0)), rot=Matrix.Rotation(a, 4, 'X'))
    # maneta/palanca principal de cierre de escotilla a babor
    bh.cyl("R_Frame", 0.026, 0.026, 0.032, 16, center=(X_CONE1 - 0.028, HATCH_R + 0.105, 0.0), axis='X')
    bh.tube("R_Accent", [(X_CONE1 - 0.044, HATCH_R + 0.105, 0.0), (X_CONE1 - 0.068, HATCH_R + 0.115, 0.0),
                         (X_CONE1 - 0.068, HATCH_R + 0.115, 0.14)], 0.011, 10, round_r=0.02)
    # anillo LED de cortesía alrededor de la brida
    bh.torus("R_LED", HATCH_R + 0.155, 0.007, 72, 8, center=(X_CONE1 - 0.005, 0, 0), axis='X')
    # panelado radial del mamparo (8 nervios estructurales grafito)
    for k in range(8):
        a = PI / 8 + k * PI / 4
        p0 = Vector((X_CONE1 - 0.004, (HATCH_R + 0.165) * math.cos(a), (HATCH_R + 0.165) * math.sin(a)))
        p1 = Vector((X_CONE1 - 0.004, (R_CONE_L1 - 0.02) * math.cos(a), (R_CONE_L1 - 0.02) * math.sin(a)))
        bh.beam("R_Frame", p0, p1, 0.016, 0.010, up=(1, 0, 0))
    # 2 cajas de aviónica superiores (babor: AVIÓNICA, estribor: ECLSS) con aletas, conectores circulares e indicadores
    for s_ in (1, -1):
        yc, zc = s_ * 0.72, 0.44
        bh.box("R_Frame", 0.065, 0.28, 0.20, center=(X_CONE1 - 0.033, yc, zc))
        bh.box("R_Black", 0.010, 0.24, 0.16, center=(X_CONE1 - 0.064, yc, zc))
        # aletas disipadoras superiores
        for fk in range(6):
            bh.box("R_Alu", 0.056, 0.005, 0.020, center=(X_CONE1 - 0.033, yc - 0.10 + fk * 0.04, zc + 0.108))
        # 3 conectores circulares aeroespaciales + 2 indicadores
        for ck in range(3):
            cy = yc - 0.075 + ck * 0.055
            bh.cyl("R_Alu", 0.015, 0.015, 0.018, 12, center=(X_CONE1 - 0.072, cy, zc - 0.035), axis='X')
            bh.cyl("R_Steel", 0.011, 0.011, 0.024, 10, center=(X_CONE1 - 0.074, cy, zc - 0.035), axis='X')
        bh.box("R_Indicator", 0.006, 0.016, 0.010, center=(X_CONE1 - 0.070, yc + 0.085, zc + 0.045))
        bh.box("R_Warning" if s_ < 0 else "R_Indicator", 0.006, 0.016, 0.010, center=(X_CONE1 - 0.070, yc + 0.085, zc + 0.020))
        decal(Matrix.Translation((X_CONE1 - 0.071, yc - 0.015, zc + 0.045)) @ rot_to((-1, 0, 0), up=(0, 0, 1)),
              0.18, 0.045, SIGN["avionica"] if s_ > 0 else SIGN["eclss"])
        # caja de distribución + manómetro en cuadrante medio-bajo (visible junto a las consolas)
        yd, zd = s_ * 0.78, -0.18
        bh.box("R_Frame", 0.048, 0.18, 0.14, center=(X_CONE1 - 0.024, yd, zd))
        gauge(bh, (X_CONE1 - 0.048, yd - s_ * 0.035, zd + 0.01), (-1, 0, 0), radius=0.030)
        knob(bh, "R_Accent", "R_Alu", (X_CONE1 - 0.048, yd + s_ * 0.045, zd - 0.01), (-1, 0, 0), r=0.014, h=0.016)
        # mazo de cableado y conductos embridados siguiendo el perímetro del mamparo
        pts_a, pts_b = [], []
        for step_k in range(7):
            ang = D(18 + step_k * 10) if s_ > 0 else D(162 - step_k * 10)
            pts_a.append((X_CONE1 - 0.018, 1.04 * math.cos(ang), 1.04 * math.sin(ang)))
            pts_b.append((X_CONE1 - 0.018, 1.08 * math.cos(ang), 1.08 * math.sin(ang)))
        pipe_bundle(bh, ["R_Frame", "R_Steel"], [pts_a, pts_b], [0.011, 0.008], clamps=4, clamp_mat="R_Alu")
    # asidero superior en el mamparo (sobre la escotilla)
    bh.tube("R_Accent", [(X_CONE1 - 0.004, -0.22, 0.90), (X_CONE1 - 0.055, -0.20, 0.90),
                         (X_CONE1 - 0.055, 0.20, 0.90), (X_CONE1 - 0.004, 0.22, 0.90)], 0.012, 10, round_r=0.025)

    from .habitat_rooms import lmark as _lm
    for s_ in (1, -1):
        _lm(f"bulkwash{s_}", "area", (9.45, s_ * 0.55, -0.35), 42, (1.0, 0.92, 0.84), (0.30, 0.30), (0, D(-115), 0), 'A')
    _lm("bulk", "area", (9.50, 0.0, 1.02), 68, (1.0, 0.93, 0.85), (0.95, 0.32), (0, D(-55), 0), 'A')
    _lm("hatchring", "point", (X_CONE1 - 0.10, 0.0, 0.0), 10, (1.0, 0.92, 0.84), (0.1, 0.1), (0, 0, 0), 'A')

    # escalones centrales hacia la escotilla
    steps = MB("a_steps")
    for (sx0, sx1, zt) in ((8.70, 9.25, -0.86), (9.25, X_CONE1, -0.57)):
        prism(steps, "R_LiningDark", rrect(0.74, zt - FLOOR, 0.01, cx=0, cy=(zt + FLOOR) / 2), sx0, sx1, 'X')
        prism(steps, "R_Floor", rrect(0.70, 0.02, 0.004, cx=0, cy=zt + 0.008), sx0 + 0.01, sx1 - 0.01, 'X')
        prism(steps, "R_Accent", rrect(0.70, 0.012, 0.003, cx=0, cy=zt + 0.006), sx0, sx0 + 0.03, 'X')

    # --- panel principal: dos cuerpos envolventes con glareshield, avisadores y subpaneles
    pnl = MB("a_panel")
    screens = []
    PIL = 0.78                      # |y| del eje de cada puesto

    def x_front(y):
        u = (abs(y) - PIL) / 0.62
        return 8.30 + 0.20 * u * u

    def body_prof(dx):
        return fillet([(8.20 + dx, FLOOR), (9.52, FLOOR), (9.52, 0.06), (8.64 + dx, 0.07), (8.47 + dx, 0.04), (8.30 + dx, -0.50),
                       (8.25 + dx, -0.60), (8.27 + dx, -0.78), (8.42 + dx, -0.86), (8.42 + dx, FLOOR)],
                      [0, 0, 0, 0.03, 0.05, 0.04, 0.03, 0.04, 0.03, 0], 5)

    def visor_prof(dx):
        # glareshield moldeado con labio delantero antideslumbrante y alojamiento de avisadores
        return fillet([(8.30 + dx, 0.070), (8.62 + dx, 0.088), (9.08, 0.112), (9.08, 0.142),
                       (8.60 + dx, 0.136), (8.32 + dx, 0.120), (8.27 + dx, 0.095)],
                      [0.006, 0.025, 0, 0, 0.035, 0.018, 0.012], 4)

    for sd in (1, -1):
        ys = [sd * (0.42 + (1.50 - 0.42) * k / 14) for k in range(15)]
        if sd < 0:
            ys = ys[::-1]
        for prof_fn, mat in ((body_prof, "R_LiningDark"), (visor_prof, "R_Leather")):
            secs = []
            for k, y in enumerate(ys):
                dx = x_front(y) - 8.30
                e = min(k, len(ys) - 1 - k)
                inset = [0.035, 0.012, 0.004][e] if e < 3 else 0.0
                pr = prof_fn(dx + inset)
                secs.append([Vector((px, y, pz)) for (px, pz) in pr])
            loft(pnl, mat, secs)
        # franja de aluminio bajo la visera y reposapiés antideslizante
        secs = []
        for y in ys:
            dx = x_front(y) - 8.30
            secs.append([Vector((px, y, pz)) for (px, pz) in rrect(0.012, 0.012, 0.004, cx=8.47 + dx - 0.004, cy=0.045)])
        loft(pnl, "R_Alu", secs)
        prism(pnl, "R_Alu", rrect(0.05, 0.035, 0.012, cx=8.55, cy=-0.98), sd * 0.55, sd * 1.05, 'Y')

        # --- Panel de avisadores luminosos en el borde del glareshield (Master Warning / Caution + anunciadores)
        y_cw = sd * PIL
        dx_cw = x_front(y_cw) - 8.30
        M_cw = Matrix.Translation((8.275 + dx_cw, y_cw, 0.096)) @ rot_to((-1, 0, -0.22), up=(0, 0, 1))
        vs = []
        vs += pnl.box("R_Frame", 0.026, 0.52, 0.042, center=(0, 0, 0))
        vs += beveled_frame(pnl, "R_Alu", 0.524, 0.044, 0.004, 0.028)
        # Master Warning (rojo) y Master Caution (ámbar) a cada lado
        vs += pnl.box("R_Alarm", 0.014, 0.042, 0.024, center=(0.012, -0.21, 0.0))
        vs += pnl.box("R_Warning", 0.014, 0.042, 0.024, center=(0.012, -0.155, 0.0))
        # matriz de 6 anunciadores de estado en el centro
        for ak in range(6):
            ay = -0.075 + ak * 0.032
            mat_a = "R_Indicator" if ak in (0, 1, 4) else ("R_Warning" if ak == 3 else "R_Black")
            vs += pnl.box(mat_a, 0.010, 0.024, 0.018, center=(0.011, ay, 0.0))
        # selector rotativo de brillo/prueba a la derecha del glareshield
        vs += knob(pnl, "R_Frame", "R_Alu", (0.012, 0.165, 0.0), (1, 0, 0), r=0.011, h=0.012)
        vs += knob(pnl, "R_Frame", "R_Accent", (0.012, 0.215, 0.0), (1, 0, 0), r=0.011, h=0.012)
        place(pnl, vs, M_cw)

        # --- Subpanel inferior (bajo las 3 MFD): botonera secundaria, selectores rotativos y rejillas de aireación
        M_sub = Matrix.Translation((8.258 + dx_cw, y_cw, -0.665)) @ rot_to((-1, 0, -0.10), up=(0, 0, 1))
        vs = []
        vs += pnl.box("R_Black", 0.018, 0.62, 0.145, center=(0, 0, 0))
        vs += beveled_frame(pnl, "R_Frame", 0.635, 0.156, 0.010, 0.022)
        # 4 selectores rotativos + 6 pulsadores enmarcados en el centro
        for rk in range(4):
            vs += knob(pnl, "R_Frame", "R_Alu", (0.010, -0.12 + rk * 0.08, 0.030), (1, 0, 0), r=0.014, h=0.014)
        for bk in range(6):
            vs += pnl.box("R_Frame", 0.014, 0.026, 0.020, center=(0.010, -0.125 + bk * 0.05, -0.028))
            vs += pnl.box("R_Indicator" if bk % 2 == 0 else "R_Alu", 0.016, 0.018, 0.008, center=(0.011, -0.125 + bk * 0.05, -0.028))
        # 2 rejillas de ventilación a ambos extremos del subpanel
        for sy_v in (-1, 1):
            vs += louver_grille(pnl, "R_Frame", "R_Alu", 0.10, 0.095, depth=0.012, slats=4,
                                M=Matrix.Translation((0.009, sy_v * 0.235, 0.0)))
        place(pnl, vs, M_sub)
        decal(M_sub @ Matrix.Translation((0.012, 0.0, 0.062)), 0.22, 0.032, SIGN["gnc"])

    # --- 6 pantallas multifunción (conservan códigos y ctl='scr:C1D1..C2D3')
    t_face = (Vector((8.47, 0.04)) - Vector((8.30, -0.50))).normalized()
    for sd, cid in ((1, "C1"), (-1, "C2")):
        for k in range(3):
            yc = [0.47, 0.79, 1.11][k]
            y = sd * yc
            dx = x_front(y) - 8.30
            h = 0.01
            slope = (x_front(y + h) - x_front(y - h)) / (2 * h)
            yaw = math.atan(slope)
            c2 = Vector((8.30 + dx, -0.50)) + t_face * 0.29
            n3 = Vector((-t_face.y, 0, t_face.x))
            n3 = Matrix.Rotation(-yaw, 3, 'Z') @ Vector((-abs(n3.x), 0, abs(n3.z)))
            up3 = Matrix.Rotation(-yaw, 3, 'Z') @ Vector((t_face.x, 0, t_face.y))
            M = Matrix.Translation((c2.x - 0.004, y, c2.y)) @ rot_to(-n3, up=up3)
            vs = prism(pnl, "R_Black", rrect(0.30, 0.245, 0.014), -0.010, 0.006, 'X')
            # marco interior fino en aluminio alrededor del bisel de cada MFD
            vs += beveled_frame(pnl, "R_Frame", 0.304, 0.249, 0.007, 0.010, M=Matrix.Translation((-0.006, 0, 0)))
            place(pnl, vs, M)
            vs = []
            for bb in range(5):
                vs += pnl.box("R_Frame", 0.008, 0.022, 0.013, center=(-0.012, -0.12 + bb * 0.06, -0.136))
                vs += pnl.box("R_Alu", 0.004, 0.014, 0.005, center=(-0.015, -0.12 + bb * 0.06, -0.136))
            place(pnl, vs, M)
            me_scr = screen_mesh_quad(f"a_scr_{cid}D{k+1}", M, 0.278, 0.212, x_off=-0.0115, flip_u=True)
            screens.append((f"{cid}D{k+1}", me_scr))

    # --- pantallas auxiliares en la pared alta (orientadas horizontalmente con normal hacia el interior de cabina)
    for s, sid in ((1, "AUXP"), (-1, "AUXS")):
        a = D(20)
        c = arc_pt(R_L - 0.03, a, s)
        nrm = -Vector((0, s * math.cos(a), math.sin(a)))
        up_w = Vector((0, -s * math.sin(a), math.cos(a)))
        M = Matrix.Translation((7.55, c.y, c.z)) @ rot_to(nrm, up=up_w)
        vs = prism(pnl, "R_Black", rrect(0.40, 0.26, 0.012), -0.025, 0.0, 'X')
        vs += beveled_frame(pnl, "R_Frame", 0.406, 0.266, 0.008, 0.014, M=Matrix.Translation((-0.008, 0, 0)))
        place(pnl, vs, M)
        me_scr = screen_mesh_quad(f"a_scr_{sid}", M, 0.37, 0.23, x_off=0.0015, flip_u=False)
        screens.append((sid, me_scr))

    # --- asientos esculpidos (conservan HAB.INT.A.ST1/ST2 y ctl='seat:1'/'seat:2')
    seats = []
    for k, s in ((1, 1), (2, -1)):
        mb = MB(f"a_seat_{k}")
        seat_mesh(mb, Matrix.Translation((7.62, s * 0.78, 0.0)))
        seats.append((k, s, mb))
    # controladores manuales en los reposabrazos (rotación a estribor / traslación a babor de cada piloto)
    hc = MB("a_hand_ctl")
    for s in (1, -1):
        hand_controller(hc, Matrix.Translation((7.80, s * 0.78 - 0.30, -0.47)), rot_handle=True)
        hand_controller(hc, Matrix.Translation((7.80, s * 0.78 + 0.30, -0.47)), rot_handle=False)

    # --- panel de interruptores repartido en las consolas laterales (posiciones y mecanismos intactos!)
    sw_parts = []
    swb = MB("a_switch_body")
    for row_i, (row, items) in enumerate(SWITCH_ROWS):
        s = 1 if row_i < 2 else -1
        rr = row_i % 2
        R_sw = Matrix.Rotation(-s * math.atan(0.07 / 0.53), 4, 'X')
        # placa base de grupo bajo la fila de 6 interruptores (sin interferir con palancas)
        y_row = s * (1.28 + rr * 0.20)
        z_row = -0.40 + (abs(y_row) - 1.09) * (0.07 / 0.53) + 0.004
        swb.box("R_Alu", 1.18, 0.158, 0.004, center=(7.60, y_row, z_row - 0.003), rot=R_sw)
        for c, (ident, lbl) in enumerate(items):
            x = 7.10 + c * 0.2
            y = s * (1.28 + rr * 0.20)
            z = -0.40 + (abs(y) - 1.09) * (0.07 / 0.53) + 0.012
            sw_parts.append((ident, lbl, row, Vector((x, y, z))))
            swb.box("R_Black", 0.11, 0.13, 0.012, center=(x, y, z - 0.006), rot=R_sw)
            for d in (-1, 1):
                swb.box("R_Frame", 0.008, 0.06, 0.03, center=(x + d * 0.03, y, z + 0.008), rot=R_sw)

    # --- rótulos y placas técnicas de cabina
    for s_ in (1, -1):
        wall_decal(6.95, s_, D(42), 0.26, 0.065, SIGN["bayA"])
        wall_decal(8.55, s_, D(26), 0.20, 0.050, SIGN["extintor"] if s_ > 0 else SIGN["mascara"])
    decal(Matrix.Translation((X_CONE1 - 0.004, 0, HATCH_R + 0.22)) @ rot_to((-1, 0, 0), up=(0, 0, 1)), 0.34, 0.085, SIGN["nodo"])
    decal(Matrix.Translation((X_CONE1 - 0.004, 0, -HATCH_R - 0.18)) @ rot_to((-1, 0, 0), up=(0, 0, 1)), 0.26, 0.065, SIGN["libre"])
    flush_decals(g, room, "HAB.INT.A.DCL")

    from .habitat_rooms import spot as _spot
    for s_ in (1, -1):
        _spot(f"cockspot{s_}", (7.55, s_ * 1.32, 1.62), 40, s_, 'A')
    P("HAB.INT.A.SHL.WALL", "Revestimiento de la cabina", wall, g, room, "Paneles curvos de PPSU con juntas de 4 mm y compartimentos altos.", bevel=0.004)
    P("HAB.INT.A.SHL.LOW", "Zócalos, consolas y suelo de cabina", dark, g, room, "Consolas laterales, zócalos y pavimento de caucho.", bevel=0.005)
    P("HAB.INT.A.SHL.FRM", "Nervios, cornisas y perfiles", frame, g, room, "Nervios grafito, cornisas de luz indirecta, raíles de anclaje.", bevel=0.003)
    P("HAB.INT.A.SHL.LED", "Iluminación integrada", led, g, room, "Tiras LED de cornisa, zócalo y canal cenital.")
    P("HAB.INT.A.CON", "Revestimiento facetado del cono", cone, g, room, "Dieciséis facetas con nueve huecos de ventana.", bevel=0.004, smooth=20)
    P("HAB.INT.A.WEL", "Pozos de ventana", wells, g, room, "Pozos de aluminio anodizado mate que eliminan reflejos parásitos.", smooth=None)
    P("HAB.INT.A.PAN", "Paneles interiores antirayado", panes, g, room, "Paneles de policarbonato de protección.", smooth=None)
    P("HAB.INT.A.BHD", "Mamparo de proa y brocal de escotilla", bh, g, room, "Mamparo mecanizado con brida atornillada, cajas de aviónica, cableado y túnel hacia el nodo.", bevel=None)
    P("HAB.INT.A.STP", "Escalones de acceso al nodo", steps, g, room, "", bevel=0.006)
    P("HAB.INT.A.PNL", "Panel de instrumentos", pnl, g, room, "Dos cuerpos con seis pantallas multifunción, visera antideslumbrante, avisadores y subpaneles.", bevel=None)
    P("HAB.INT.A.HC", "Controladores manuales", hc, g, room, "Controladores ergonómicos de traslación y rotación en los reposabrazos.")
    P("HAB.INT.A.SWB", "Bases de interruptores", swb, g, room, "Bases y guardas de los 24 interruptores repartidos en las consolas laterales.", bevel=0.002)
    for sid, me_scr in screens:
        ob = part(f"HAB.INT.A.SCR.{sid}", f"Pantalla {sid}", me_scr, g, desc="Pantalla multifunción táctil.")
        ob["room"] = room
        ctl(ob, f"scr:{sid}")
    for k, s, mb in seats:
        ob = P(f"HAB.INT.A.ST{k}", "Asiento del comandante" if k == 1 else "Asiento del piloto", mb, g, room,
               "Asiento esculpido sobre raíles deslizantes con carcasa anatómica, cojines segmentados, reposacabezas en doble barra y arnés de cuatro puntos.", bevel=None)
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
    # nervios horizontales y verticales de refuerzo del mamparo de popa
    for z in (-0.95, -0.35, 0.25, 0.85):
        half_y = math.sqrt(max(0.05, R_L * R_L - z * z)) - 0.06
        mb.box("R_Frame", 0.012, half_y * 2, 0.016, center=(x + 0.004, 0, z))
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
            area(f"L_cove_{key}_{s}", (xc, w.y - s * 0.045, w.z + 0.03), L - 0.1, 0.03, (0, 0, 0), 30.0 * L, (1.0, 0.92, 0.84), key)
            made[-1].rotation_euler = (PI + s * D(40), 0, 0)
            # zócalo
            area(f"L_toe_{key}_{s}", (xc, s * (FACE + 0.054), FLOOR + TOE - 0.012), L - 0.1, 0.01, (0, 0, 0), 3.0 * L, (1.0, 0.92, 0.84), key)
        # canal cenital (difusor)
        area(f"L_chan_{key}", (xc, 0, R_L + 0.02), L - 0.04, 0.24, (0, 0, 0), 24.0 * L, (1.0, 0.93, 0.85), key)
    # luminarias específicas declaradas por las estancias (marcadores LMARK_*)
    for mk in [o for o in bpy.data.objects if o.name.startswith("LMARK_")]:
        kind = mk.get("lkind", "area")
        if kind == "point":
            ld = bpy.data.lights.new(mk.name[6:], 'POINT')
            ld.shadow_soft_size = 0.1
        elif kind == "spot":
            ld = bpy.data.lights.new(mk.name[6:], 'SPOT')
            ld.spot_size = mk["size"][0]
            ld.spot_blend = mk["size"][1]
            ld.shadow_soft_size = 0.04
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
