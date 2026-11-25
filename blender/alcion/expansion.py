"""
ALCIÓN HX-4 · BEYOND ORBIT — ampliaciones del modelo maestro para la simulación.

- `mech(...)`: metadatos de mecanismo (bisagra/deslizadera) con pivote y eje en
  coordenadas de nave (Blender). La web los lee de `extras.mech` y compone
  T(explosión) · R(pivote, eje, ángulo) · M(base) sin código específico por pieza.
- `ctl(...)`: identificador de control interactivo (`extras.ctl`).
- Esclusa EVA (FWD.ALK) en el nadir del nodo.
- Panel cenital de 24 interruptores funcionales (cada palanca es una pieza).
- Capa de vida a bordo: objetos cotidianos por bahía.
"""
import math
import random
from mathutils import Vector, Matrix
from .lib import group, part, MB, ring_xyz, TAU, bolt_circle, boolean_cut
from . import spec as S

PI = math.pi
XA = S.X_CUPOLA          # eje de la esclusa (vertical, bajo la cúpula)
ALK_R = 0.86             # radio exterior del casco de la esclusa
ALK_Z0 = -0.92           # arranque del casco (se recorta en silla contra el barril del nodo)
ALK_Z1 = -3.20           # inicio de la cúpula inferior
ALK_Z2 = -3.48           # anillo de la escotilla exterior


def mech(ob, kind, pivot, axis, lo, hi, rest, ident=None, speed=1.0):
    """Registra un mecanismo. kind: 'hinge' (ángulo en rad) o 'slide' (m)."""
    ob["mech"] = {
        "type": kind, "pivot": [float(v) for v in pivot], "axis": [float(v) for v in Vector(axis).normalized()],
        "min": float(lo), "max": float(hi), "rest": float(rest), "id": ident or ob.name, "speed": float(speed),
    }


def ctl(ob, ident):
    ob["ctl"] = ident


# ---------------------------------------------------------------------------
# Panel cenital de interruptores
# ---------------------------------------------------------------------------
SWITCH_ROWS = [
    ("POTENCIA", [("BAT", "Batería maestra"), ("BUSA", "Bus A 120 V"), ("BUSB", "Bus B 120 V"), ("SOLAR", "Alas solares"),
                  ("AVX", "Aviónica"), ("FWD", "Alimentación del nodo")]),
    ("ILUMINACIÓN", [("LT_A", "Luces bahía A"), ("LT_B", "Luces bahía B"), ("LT_C", "Luces bahía C"), ("LT_D", "Luces bahía D"),
                     ("LT_N", "Luces del nodo"), ("LT_EXT", "Focos exteriores")]),
    ("SISTEMAS", [("ECLSS", "Soporte vital"), ("FANS", "Ventilación"), ("THERM", "Bombeo térmico"), ("COMM", "Comunicaciones"),
                  ("SCI", "Laboratorio"), ("HEAT", "Calentadores")]),
    ("PROPULSIÓN", [("RCS", "Armado RCS"), ("MAIN", "Armado motores"), ("SEP", "Propulsión eléctrica"), ("RBT", "Brazo robótico"),
                    ("DOCK", "Sistema de atraque"), ("NAV", "Navegación")]),
]


def switch_panel_body_mesh():
    mb = MB("switch_panel_body")
    mb.box("M_InteriorGrey", 0.90, 1.10, 0.04, center=(0, 0, 0.02))
    for r in range(4):
        y = -0.39 + r * 0.26
        mb.box("M_InteriorDark", 0.84, 0.20, 0.006, center=(0, y + 0.01, 0.043))
        mb.box("M_ShieldWhite", 0.80, 0.018, 0.002, center=(0, y - 0.085, 0.047))
        for c in range(6):
            x = -0.34 + c * 0.136
            mb.box("M_AlBare", 0.06, 0.075, 0.012, center=(x, y, 0.049))
            for s_ in (-1, 1):  # guardas laterales
                mb.box("M_AlAnodBlack", 0.006, 0.07, 0.03, center=(x + s_ * 0.026, y, 0.07))
            mb.box("M_ShieldWhite", 0.055, 0.012, 0.0015, center=(x, y + 0.058, 0.0465))
    for c in (-0.44, 0.44):
        for yy in (-0.53, 0.53):
            mb.bolt("M_Bolt", (c, yy, 0.04), (0, 0, 1), 0.008, 0.005)
    return mb.mesh(smooth=None, bevel=0.003)


def toggle_mesh():
    mb = MB("toggle_lever")
    mb.cyl("M_Steel", 0.007, 0.0055, 0.045, 10, center=(0, 0, 0.0225), axis='Z')
    mb.sphere("M_Steel", 0.008, 10, 6, center=(0, 0, 0.047))
    mb.cyl("M_AlAnodBlack", 0.012, 0.012, 0.006, 12, center=(0, 0, 0.003), axis='Z')
    return mb.mesh(smooth=40)


def build_switch_panel(parent, W, n_world):
    body = part("HAB.INT.A.CL1.SW", "Panel de interruptores cenital", switch_panel_body_mesh(), parent,
                explode=tuple(n_world * 0.3), desc="24 interruptores protegidos en 4 filas (potencia, iluminación, sistemas, propulsión). Cada palanca es una pieza funcional del simulador.")
    body.matrix_basis = W
    g = group("HAB.INT.A.CL1.TGL", "Palancas de interruptor", parent, explode=tuple(n_world * 0.5))
    tm = toggle_mesh()
    R3 = W.to_3x3()
    for r, (row, items) in enumerate(SWITCH_ROWS):
        for c, (ident, lbl) in enumerate(items):
            x = -0.34 + c * 0.136
            y = -0.39 + r * 0.26
            loc = W @ Vector((x, y, 0.055))
            p = part(f"HAB.INT.A.CL1.TGL.{ident}", f"Interruptor: {lbl}", tm, g, explode=tuple(n_world * 0.15),
                     desc=f"Palanca de dos posiciones del grupo {row.lower()}.")
            p.matrix_basis = Matrix.Translation(loc) @ W.to_quaternion().to_matrix().to_4x4()
            axis = R3 @ Vector((1, 0, 0))
            mech(p, "hinge", loc, axis, -0.45, 0.45, -0.45, ident=f"sw:{ident}", speed=6.0)
            ctl(p, f"sw:{ident}")


# ---------------------------------------------------------------------------
# Esclusa EVA
# ---------------------------------------------------------------------------

def suit_mesh(name, seed):
    """Traje EVA conceptual (estilizado, no réplica de ningún traje real)."""
    mb = MB(name)
    # torso rígido y mochila de soporte vital
    mb.box("M_ShieldWhite", 0.42, 0.30, 0.55, center=(0, 0, 0.0))
    mb.box("M_BetaCloth", 0.44, 0.20, 0.62, center=(0, -0.22, 0.02))
    mb.box("M_AlBare", 0.30, 0.04, 0.16, center=(0, 0.16, 0.08))
    mb.box("M_DecalRed" if seed == 0 else "M_FabricBlue", 0.30, 0.005, 0.03, center=(0, 0.175, -0.02))
    # casco y visera
    mb.sphere("M_ShieldWhite", 0.17, 24, 12, center=(0, 0.02, 0.43))
    mb.sphere("M_MLI_Gold", 0.165, 24, 12, center=(0, 0.06, 0.44), scale=(0.92, 0.7, 0.8))
    mb.torus("M_AlBare", 0.15, 0.02, 24, 6, center=(0, 0.0, 0.29), axis='Z')
    # brazos y piernas (segmentos con juntas)
    for s in (-1, 1):
        mb.tube("M_BetaCloth", [(s * 0.25, 0, 0.18), (s * 0.34, 0.02, -0.05), (s * 0.36, 0.06, -0.30)], 0.07, 12, round_r=0.06)
        mb.torus("M_AlBare", 0.075, 0.012, 16, 6, center=(s * 0.25, 0, 0.18), axis='X')
        mb.sphere("M_Fabric", 0.06, 12, 8, center=(s * 0.36, 0.06, -0.38))
        mb.tube("M_BetaCloth", [(s * 0.11, 0, -0.30), (s * 0.13, 0.03, -0.70), (s * 0.13, 0.0, -1.05)], 0.085, 12, round_r=0.08)
        mb.box("M_InteriorDark", 0.11, 0.24, 0.08, center=(s * 0.13, 0.05, -1.10))
    mb.box("M_AlAnodBlack", 0.18, 0.06, 0.10, center=(0, 0.18, -0.12))  # unidad de control frontal
    return mb.mesh(smooth=40)


def build_airlock(fwd):
    g = group("FWD.ALK", "Esclusa EVA (nadir del nodo)", fwd, explode=(0, 0, -1.8),
              desc="Esclusa de tripulación de Ø1,72 m y 2,2 m de altura bajo el nodo, con escotilla interior IDSS de 1,0 m y escotilla exterior de 1,0 m. Aloja 2 trajes EVA conceptuales.",
              func="Despresurización y salida a actividades extravehiculares sin depender del vehículo atracado")
    # casco
    mb = MB("alk_shell")
    prof = [(0.55, ALK_Z0 + 0.02), (ALK_R - 0.03, ALK_Z0 + 0.02), (ALK_R - 0.03, ALK_Z1), (ALK_R, ALK_Z1), (ALK_R, ALK_Z0 + 0.02)]
    mb.lathe("M_AlLi", [(ALK_R - 0.03, ALK_Z0), (ALK_R, ALK_Z0), (ALK_R, ALK_Z1), (ALK_R - 0.03, ALK_Z1), (ALK_R - 0.03, ALK_Z0)], 64, axis='Z', center=(XA, 0, 0))
    dome = []
    for k in range(9):
        t = (PI / 2) * k / 8
        dome.append((0.52 + (ALK_R - 0.52) * math.cos(t), ALK_Z1 - (ALK_Z2 - ALK_Z1) * -math.sin(t) * 1.0))
    inner = [(r - 0.03, z + 0.02) for (r, z) in reversed(dome)]
    mb.lathe("M_AlLi", dome + inner + [dome[0]], 64, axis='Z', center=(XA, 0, 0))
    for z in (ALK_Z0 - 0.02, (ALK_Z0 + ALK_Z1) / 2, ALK_Z1):
        mb.torus("M_AlLi", ALK_R - 0.06, 0.025, 64, 6, center=(XA, 0, z), axis='Z')
    from .exterior import cutter
    me = boolean_cut(mb.mesh(), [cutter(1.33, 3.2, (XA, 0, 0), axis='X', seg=96)], "alk_shell_cut")
    part("FWD.ALK.STR", "Casco presurizado (unión en silla al nodo)", me, g, explode=(0, 0, -0.4),
         desc="Cilindro de Al-Li soldado en silla al barril del nodo, con 3 marcos y cúpula inferior.")
    # manta MMOD/MLI exterior
    mb = MB("alk_blanket")
    mb.lathe("M_BetaCloth", [(ALK_R + 0.01, ALK_Z0), (ALK_R + 0.085, ALK_Z0), (ALK_R + 0.085, ALK_Z1 + 0.02), (ALK_R + 0.01, ALK_Z1 + 0.02)], 64, axis='Z', center=(XA, 0, 0))
    for z in (-1.7, -2.15, -2.6, -3.0):
        mb.torus("M_Fabric", ALK_R + 0.088, 0.006, 64, 4, center=(XA, 0, z), axis='Z')
    lw = []
    for k in range(9):
        t = (PI / 2) * k / 8
        lw.append((0.56 + (ALK_R + 0.08 - 0.56) * math.cos(t), ALK_Z1 + (ALK_Z2 - ALK_Z1) * math.sin(t) - 0.02))
    mb.lathe("M_BetaCloth", lw, 64, axis='Z', center=(XA, 0, 0))
    me = boolean_cut(mb.mesh(), [cutter(1.40, 3.2, (XA, 0, 0), axis='X', seg=96)], "alk_blanket_cut")
    part("FWD.ALK.MMOD", "Manta MMOD y MLI de la esclusa", me, g, explode=("radial", 0.6),
         desc="Manta Whipple flexible (beta cloth, Nextel, Kevlar) sobre MLI de 20 capas, con costuras de unión.")
    # escotilla exterior (EVA)
    hg = group("FWD.ALK.HO", "Escotilla exterior EVA", g, explode=(0, 0, -0.8))
    mb = MB("alk_hatch_ring")
    mb.lathe("M_AlBare", [(0.48, ALK_Z2 + 0.05), (0.60, ALK_Z2 + 0.05), (0.60, ALK_Z2 - 0.03), (0.48, ALK_Z2 - 0.03), (0.48, ALK_Z2 + 0.05)], 64, axis='Z', center=(XA, 0, 0))
    mb.torus("M_Rubber", 0.50, 0.01, 48, 6, center=(XA, 0, ALK_Z2 - 0.03), axis='Z')
    for k in range(4):
        a = TAU * k / 4 + PI / 4
        mb.box("M_EVAYellow", 0.05, 0.05, 0.05, center=(XA + 0.62 * math.cos(a), 0.62 * math.sin(a), ALK_Z2 - 0.02))
    part("FWD.ALK.HO.RNG", "Marco de la escotilla exterior", mb.mesh(), hg, explode=(0, 0, -0.2))
    from .interior import hatch_mesh
    hd = part("FWD.ALK.HO.DOOR", "Escotilla exterior (puerta)", hatch_mesh(0.50, "alk_hatch_out"), hg, explode=(0, 0, -0.5),
              desc="Puerta de 1,0 m con mirilla, válvula de ecualización y cierre de 6 pestillos; abre hacia el interior de la esclusa.")
    hinge_y = -(0.50 + 0.03)
    hd.matrix_basis = Matrix.Translation((XA, 0, ALK_Z2 + 0.02)) @ Matrix.Rotation(PI, 4, 'X') @ Matrix.Rotation(PI / 2, 4, 'Z')
    mech(hd, "hinge", (XA, 0.53, ALK_Z2 + 0.02), (1, 0, 0), -1.75, 0.0, 0.0, ident="hatch:alk_out", speed=0.8)
    ctl(hd, "hatch:alk_out")
    # pasamanos, focos, panel de umbilicales, plataforma de pies
    eg = group("FWD.ALK.EXT", "Equipos exteriores de la esclusa", g, explode=("radial", 0.5))
    mb = MB("alk_handrails")
    for k in range(6):
        a = TAU * k / 6
        p0 = Vector((XA + (ALK_R + 0.12) * math.cos(a), (ALK_R + 0.12) * math.sin(a), -1.6))
        p1 = Vector((XA + (ALK_R + 0.12) * math.cos(a), (ALK_R + 0.12) * math.sin(a), -3.0))
        mb.tube("M_EVAYellow", [p0, p1], 0.0125, 8)
        for z in (-1.6, -2.3, -3.0):
            mb.tube("M_EVAYellow", [Vector((XA + (ALK_R + 0.09) * math.cos(a), (ALK_R + 0.09) * math.sin(a), z)), Vector((XA + (ALK_R + 0.12) * math.cos(a), (ALK_R + 0.12) * math.sin(a), z))], 0.011, 8)
    mb.torus("M_EVAYellow", 0.72, 0.0125, 48, 8, center=(XA, 0, ALK_Z2 - 0.06), axis='Z')
    part("FWD.ALK.EXT.HR", "Pasamanos EVA de la esclusa", mb.mesh(), eg, explode=("radial", 0.3),
         desc="6 pasamanos longitudinales y anillo de traslación alrededor de la escotilla.")
    from .exterior import light_mesh, camera_mesh
    lm = light_mesh("alk_light")
    for k, a in enumerate((PI / 2, -PI / 2)):
        p = part(f"FWD.ALK.EXT.L{k+1}", f"Foco EVA {k+1}", lm, eg, explode=("radial", 0.3), desc="Foco LED de la zona de salida.")
        sg_ = 1 if math.sin(a) > 0 else -1
        p.matrix_basis = Matrix.Translation((XA, sg_ * (ALK_R + 0.1), -3.05)) @ Matrix.Rotation(-sg_ * PI / 2, 4, 'X')
    mb = MB("alk_umb_panel")
    mb.box("M_AlBare", 0.30, 0.05, 0.40, center=(XA + ALK_R + 0.03, 0, -2.0))
    for k in range(3):
        mb.cyl("M_GoldPlate", 0.025, 0.025, 0.05, 12, center=(XA + ALK_R + 0.07, -0.08 + 0.08 * k, -1.92), axis='X')
    mb.box("M_EVAYellow", 0.02, 0.24, 0.02, center=(XA + ALK_R + 0.06, 0, -2.18))
    mb.box("M_DecalRed", 0.002, 0.10, 0.03, center=(XA + ALK_R + 0.056, 0, -2.08))
    part("FWD.ALK.EXT.UMB", "Panel de umbilicales y punto de anclaje", mb.mesh(), eg, explode=(0.5, 0, 0),
         desc="Conexiones de oxígeno, agua y datos para los trajes y punto de anclaje de la línea de seguridad.")
    mb = MB("alk_foot")
    mb.box("M_AlBare", 0.50, 0.30, 0.03, center=(XA - 0.95, 0, -3.25), rot=Matrix.Rotation(0.3, 4, 'Y'))
    mb.box("M_EVAYellow", 0.12, 0.26, 0.05, center=(XA - 1.0, 0, -3.21), rot=Matrix.Rotation(0.3, 4, 'Y'))
    mb.tube("M_AlBare", [(XA - 0.82, 0, -3.0), (XA - 0.95, 0, -3.25)], 0.02, 8)
    part("FWD.ALK.EXT.APFR", "Plataforma de sujeción de pies", mb.mesh(), eg, explode=(-0.4, 0, 0),
         desc="Restricción de pies orientable para trabajos junto a la escotilla.")
    # interior: escotilla interior, trajes, paneles
    ig = group("FWD.ALK.INT", "Interior de la esclusa", g, explode=(0, -1.2, 0))
    hi = part("FWD.ALK.INT.HI", "Escotilla interior nodo–esclusa", hatch_mesh(0.50, "alk_hatch_in"), ig, explode=(0, 0, 0.3),
              desc="Escotilla de 1,0 m en el suelo del nodo; se abre hacia el nodo.")
    hi.matrix_basis = Matrix.Translation((XA, 0, -1.26)) @ Matrix.Rotation(PI / 2, 4, 'Z')
    mech(hi, "hinge", (XA, -0.53, -1.26), (1, 0, 0), 0.0, 1.75, 0.0, ident="hatch:alk_in", speed=0.8)
    ctl(hi, "hatch:alk_in")
    for k, (dx, dy, yaw, nm) in enumerate(((-0.22, 0.36, -PI / 2 - 0.5, "A"), (0.22, -0.36, PI / 2 - 0.5, "B"))):
        p = part(f"FWD.ALK.INT.SUIT{nm}", f"Traje EVA {nm}", suit_mesh(f"suit_{nm}", k), ig, explode=("radial", 0.5),
                 desc="Traje EVA conceptual de torso rígido con mochila de soporte vital; representación estilizada.")
        p.matrix_basis = Matrix.Translation((XA + dx, dy, -2.18)) @ Matrix.Rotation(yaw, 4, 'Z') @ Matrix.Diagonal((0.92, 0.92, 0.92, 1))
    mb = MB("alk_panel")
    mb.box("M_InteriorGrey", 0.04, 0.42, 0.50, center=(XA + ALK_R - 0.07, 0, -1.85))
    mb.box("M_InteriorDark", 0.01, 0.30, 0.18, center=(XA + ALK_R - 0.095, 0, -1.75))
    for k in range(3):
        mb.box("M_LEDGreen" if k else "M_LEDRed", 0.006, 0.03, 0.03, center=(XA + ALK_R - 0.095, -0.08 + 0.08 * k, -1.98))
    mb.cyl("M_DecalRed", 0.04, 0.04, 0.03, 16, center=(XA + ALK_R - 0.1, 0.13, -2.02), axis='X')
    pp = part("FWD.ALK.INT.PNL", "Panel de control de despresurización", mb.mesh(), ig, explode=(0.3, 0, 0),
              desc="Panel con manómetro digital, válvulas de despresurización/represurización y luz de estado.")
    ctl(pp, "airlock:panel")
    mb = MB("alk_int_rails")
    for k in range(4):
        a = TAU * k / 4 + PI / 4
        mb.tube("M_Handrail", [(XA + 0.72 * math.cos(a), 0.72 * math.sin(a), -1.5), (XA + 0.72 * math.cos(a), 0.72 * math.sin(a), -3.0)], 0.012, 8)
    mb.box("M_LED", 0.03, 0.5, 0.02, center=(XA - 0.78, 0, -1.6))
    mb.box("M_LED", 0.03, 0.5, 0.02, center=(XA + 0.78, 0, -2.8))
    part("FWD.ALK.INT.HR", "Pasamanos y luminarias interiores", mb.mesh(), ig, explode=("radial", 0.3))


def cut_node_for_airlock(fwd_objects):
    """Recorta la abertura de la escotilla en el barril y las mantas del nodo."""
    import bpy
    from .exterior import cutter
    for name, r in (("FWD.STR.BRL", 0.52), ("FWD.MMOD.BLK3", 0.88), ("FWD.MMOD.BLK4", 0.88),
                    ("FWD.MMOD.BLK3.Q", 0.88), ("FWD.MMOD.BLK4.Q", 0.88)):
        ob = bpy.data.objects.get(name)
        if ob is None:
            continue
        mats = list(ob.data.materials)
        new = boolean_cut(ob.data, [cutter(r, 1.2, (XA, 0, -1.3))], ob.data.name + "_alk")
        ob.data = new


# ---------------------------------------------------------------------------
# Vida a bordo
# ---------------------------------------------------------------------------

def _pouch(rnd):
    mb = MB(f"pouch_{rnd.randint(0, 9999)}")
    mb.box("M_Teflon", 0.10, 0.16, 0.02, center=(0, 0, 0.01))
    mb.box(rnd.choice(["M_DecalRed", "M_FabricBlue", "M_Accent", "M_EVAYellow"]), 0.10, 0.04, 0.021, center=(0, 0.04, 0.01))
    mb.cyl("M_Rubber", 0.004, 0.004, 0.06, 8, center=(0.0, 0.10, 0.012), axis='Y')
    return mb.mesh(smooth=None)


def _tablet():
    mb = MB("tablet")
    mb.box("M_InteriorDark", 0.25, 0.17, 0.008, center=(0, 0, 0.004))
    mb.box("M_ScreenAmber", 0.22, 0.14, 0.001, center=(0, 0, 0.0085))
    mb.box("M_Fabric", 0.04, 0.12, 0.004, center=(-0.14, 0, 0.004))
    return mb.mesh(smooth=None)


def _laptop():
    mb = MB("laptop")
    mb.box("M_InteriorDark", 0.34, 0.24, 0.015, center=(0, 0, 0.0075))
    mb.box("M_InteriorDark", 0.34, 0.012, 0.23, center=(0, 0.12, 0.12), rot=Matrix.Rotation(-0.25, 4, 'X'))
    mb.box("M_Screen", 0.31, 0.003, 0.19, center=(0, 0.112, 0.125), rot=Matrix.Rotation(-0.25, 4, 'X'))
    mb.box("M_InteriorGrey", 0.28, 0.12, 0.002, center=(0, -0.03, 0.016))
    return mb.mesh(smooth=None)


def _camera():
    mb = MB("dslr")
    mb.box("M_InteriorDark", 0.14, 0.08, 0.10, center=(0, 0, 0.05))
    mb.cyl("M_AlAnodBlack", 0.04, 0.04, 0.12, 20, center=(0, -0.10, 0.05), axis='Y')
    mb.cyl("M_Lens", 0.032, 0.032, 0.004, 20, center=(0, -0.161, 0.05), axis='Y')
    mb.box("M_FabricBlue", 0.02, 0.10, 0.004, center=(0.07, 0, 0.09))
    return mb.mesh(smooth=40)


def _clipboard():
    mb = MB("clipboard")
    mb.box("M_InteriorGrey", 0.24, 0.32, 0.006, center=(0, 0, 0.003))
    mb.box("M_ShieldWhite", 0.21, 0.28, 0.002, center=(0, -0.01, 0.007))
    for k in range(9):
        mb.box("M_Decal", 0.16, 0.004, 0.0005, center=(0, 0.09 - 0.024 * k, 0.0083))
    mb.box("M_AlBare", 0.10, 0.03, 0.01, center=(0, 0.15, 0.01))
    return mb.mesh(smooth=None)


def _plant_unit():
    mb = MB("plant_unit")
    mb.box("M_InteriorPanel", 0.42, 0.30, 0.03, center=(0, 0, 0.015))
    mb.box("M_LEDRed", 0.38, 0.02, 0.01, center=(0, 0.12, 0.33))
    mb.box("M_LED", 0.38, 0.02, 0.01, center=(0, 0.09, 0.33))
    for x in (-0.19, 0.19):
        mb.box("M_AlBare", 0.015, 0.015, 0.34, center=(x, 0.12, 0.17))
    mb.box("M_GlassInner", 0.40, 0.003, 0.30, center=(0, -0.14, 0.17))
    rnd = random.Random(3)
    for k in range(9):
        x, y = -0.14 + 0.14 * (k % 3), -0.08 + 0.08 * (k // 3)
        mb.box("M_Fabric", 0.08, 0.06, 0.03, center=(x, y, 0.045))
        for j in range(4):
            h = 0.06 + rnd.random() * 0.14
            mb.tube("M_Leaf", [(x, y, 0.06), (x + (rnd.random() - 0.5) * 0.04, y + (rnd.random() - 0.5) * 0.04, 0.06 + h)], 0.003, 5)
            mb.sphere("M_Leaf", 0.018 + rnd.random() * 0.01, 8, 5, center=(x + (rnd.random() - 0.5) * 0.05, y + (rnd.random() - 0.5) * 0.05, 0.06 + h), scale=(1.2, 0.8, 0.5))
    return mb.mesh(smooth=40)


def _bungee(length):
    mb = MB(f"bungee_{length:.2f}")
    for k in range(3):
        mb.tube("M_Cable", [(-length / 2, -0.25 + 0.25 * k, 0.02), (0, -0.25 + 0.25 * k, 0.035), (length / 2, -0.25 + 0.25 * k, 0.02)], 0.004, 6)
        mb.box("M_AlBare", 0.02, 0.012, 0.012, center=(-length / 2, -0.25 + 0.25 * k, 0.02))
        mb.box("M_AlBare", 0.02, 0.012, 0.012, center=(length / 2, -0.25 + 0.25 * k, 0.02))
    return mb.mesh(smooth=40)


def _patch(mat):
    mb = MB(f"patch_{mat}")
    mb.cyl("M_FabricBlue", 0.06, 0.06, 0.003, 32, center=(0, 0, 0.0015), axis='Z')
    mb.torus("M_EVAYellow", 0.058, 0.004, 32, 4, center=(0, 0, 0.003), axis='Z')
    mb.box(mat, 0.07, 0.012, 0.001, center=(0, -0.01, 0.0035), rot=Matrix.Rotation(0.6, 4, 'Z'))
    mb.box("M_ShieldWhite", 0.035, 0.035, 0.001, center=(0.01, 0.018, 0.0035), rot=Matrix.Rotation(0.78, 4, 'Z'))
    return mb.mesh(smooth=None)


def _photo(seed):
    mb = MB(f"photo_{seed}")
    mb.box("M_ShieldWhite", 0.10, 0.075, 0.001, center=(0, 0, 0.0005))
    mb.box(["M_FabricBlue", "M_Water", "M_Accent", "M_SolarBack"][seed % 4], 0.088, 0.058, 0.0012, center=(0, 0.004, 0.0008))
    return mb.mesh(smooth=None)


def _towel():
    mb = MB("towel")
    mb.box("M_Fabric", 0.30, 0.45, 0.012, center=(0, 0, 0.006), rot=Matrix.Rotation(0.04, 4, 'X'))
    mb.box("M_FabricBlue", 0.30, 0.03, 0.013, center=(0, 0.20, 0.006))
    return mb.mesh(smooth=30)


def _toolbag():
    mb = MB("toolbag")
    mb.box("M_Fabric", 0.36, 0.22, 0.10, center=(0, 0, 0.05))
    mb.box("M_FabricBlue", 0.37, 0.03, 0.105, center=(0, 0.06, 0.05))
    for k in range(5):
        mb.cyl("M_Steel", 0.006, 0.006, 0.09, 8, center=(-0.12 + 0.06 * k, -0.05, 0.12), axis='Z')
    mb.box("M_EVAYellow", 0.05, 0.02, 0.12, center=(0.14, -0.05, 0.13))
    return mb.mesh(smooth=None)


def _headset():
    mb = MB("headset")
    mb.torus("M_InteriorDark", 0.09, 0.008, 24, 6, center=(0, 0, 0.0), axis='Y')
    for s in (-1, 1):
        mb.cyl("M_SeatCushion", 0.04, 0.04, 0.03, 16, center=(s * 0.09, 0, 0.0), axis='X')
    mb.tube("M_InteriorDark", [(0.09, 0, -0.02), (0.07, -0.06, -0.06), (0.03, -0.08, -0.07)], 0.003, 6)
    return mb.mesh(smooth=40)


def _velcro():
    mb = MB("velcro")
    for k in range(4):
        mb.box("M_InteriorDark", 0.05, 0.05, 0.002, center=(-0.09 + 0.06 * k, 0, 0.001))
    return mb.mesh(smooth=None)


def build_lived_in(hab):
    """Objetos cotidianos colocados sobre las caras de los bastidores
    (coordenadas de pared: x a lo largo de la nave, y transversal, z hacia el pasillo)."""
    from .interior import wall_matrix, XS
    g = group("HAB.INT.LIV", "Vida a bordo: objetos cotidianos", hab, explode=(0, 0, -9.0),
              desc="Objetos personales y de trabajo sujetos con velcro y cintas elásticas: indican que cuatro personas viven y trabajan aquí.",
              func="Contexto de habitabilidad")
    rnd = random.Random(42)
    items = [
        # (bahía, pared, dx desde el centro de la bahía, y, objeto, etiqueta, desc)
        ("A", "port", -0.5, 0.15, "clipboard", "Lista de comprobación de vuelo", "Procedimientos impresos de respaldo."),
        ("A", "stbd", -0.5, 0.20, "tablet", "Tableta de procedimientos", "Tableta con procedimientos electrónicos."),
        ("A", "deck", -0.55, 0.55, "velcro", "Parches de velcro", "Puntos de sujeción para objetos sueltos."),
        ("A", "ceil", -0.55, -0.6, "headset", "Auriculares de comunicaciones", "Auriculares con micrófono para el circuito de voz."),
        ("B", "stbd", -0.5, -0.65, "laptop", "Portátil del laboratorio", "Estación de control de experimentos."),
        ("B", "ceil", 0.45, 0.35, "plant", "Unidad de cultivo vegetal", "Cámara de crecimiento con LED rojo/azul y 9 almohadillas de cultivo."),
        ("B", "port", 0.5, -0.75, "camera", "Cámara fotográfica", "Cámara con objetivo de 100 mm para fotografía científica."),
        ("B", "deck", 0.0, 0.85, "toolbag", "Bolsa de herramientas", "Herramientas manuales de mantenimiento."),
        ("C", "port", -0.50, 0.75, "photo", "Fotografías personales", "Recuerdos personales del tripulante."),
        ("C", "port", 0.50, 0.70, "photo", "Fotografías personales", "Recuerdos personales del tripulante."),
        ("C", "stbd", -0.50, 0.78, "photo", "Fotografías personales", "Recuerdos personales del tripulante."),
        ("C", "stbd", 0.50, 0.72, "patch", "Parche de misión", "Emblema de la misión de servicio."),
        ("D", "port", 0.35, 0.02, "pouch", "Bolsa de bebida", "Bolsa de bebida con pajita y pinza."),
        ("D", "port", 0.52, 0.06, "pouch", "Bolsa de bebida", "Bolsa de bebida con pajita y pinza."),
        ("D", "port", -0.45, 0.30, "bungee", "Cintas elásticas de estiba", "Cintas elásticas para sujetar paquetes de comida."),
        ("D", "stbd", 0.55, 0.40, "towel", "Toalla", "Toalla de microfibra del compartimento de higiene."),
        ("D", "ceil", -0.5, 0.0, "clipboard", "Registro de mantenimiento", "Registro de cambios de filtros del soporte vital."),
        ("D", "deck", 0.4, -0.75, "pouch", "Bolsa de bebida", "Bolsa de bebida con pajita y pinza."),
    ]
    makers = {"clipboard": _clipboard, "tablet": _tablet, "velcro": _velcro, "headset": _headset, "laptop": _laptop,
              "plant": _plant_unit, "camera": _camera, "toolbag": _toolbag, "photo": lambda: _photo(rnd.randint(0, 3)),
              "patch": lambda: _patch("M_Accent"), "pouch": lambda: _pouch(rnd), "bungee": lambda: _bungee(0.8), "towel": _towel}
    bayx = {"A": (XS[3] + XS[4]) / 2, "B": (XS[2] + XS[3]) / 2, "C": (XS[1] + XS[2]) / 2, "D": (XS[0] + XS[1]) / 2}
    groups = {}
    for k, (bay, wall, dx, yy, kind, lbl, desc) in enumerate(items):
        if bay not in groups:
            groups[bay] = group(f"HAB.INT.LIV.{bay}", f"Objetos de la bahía {bay}", g, explode=("axial", 1.5))
        W = wall_matrix(wall, bayx[bay] + dx)
        me = makers[kind]()
        rot = Matrix.Rotation((rnd.random() - 0.5) * 0.25, 4, 'Z')
        p = part(f"HAB.INT.LIV.{bay}.O{k+1:02d}", lbl, me, groups[bay], explode=tuple((W.to_3x3() @ Vector((0, 0, 1))) * 0.35), desc=desc)
        p.matrix_basis = W @ Matrix.Translation((0, yy, 0.035 if kind not in ("plant",) else 0.03)) @ rot
        p["inspect"] = True
