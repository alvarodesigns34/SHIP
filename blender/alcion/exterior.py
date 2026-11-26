"""
ALCIÓN HX-4 — geometría exterior: nodo de proa, módulo habitable (estructura,
aislamiento, escudo MMOD), RCS y equipos exteriores del casco.
"""
import math
from mathutils import Vector, Matrix
from .lib import (group, part, MB, cyl, box, lathe, torus, tube, sphere,
                  bolt_circle, text_mesh, attach, TAU, ring_xyz, boolean_cut)
from .materials import M
from . import spec as S

PI = math.pi


# ---------------------------------------------------------------------------
# Utilidades geométricas comunes
# ---------------------------------------------------------------------------

def cutter(r, depth, center, axis='Z', seg=48):
    mb = MB("cutter")
    mb.cyl("M_AlBare", r, r, depth, seg, center=center, axis=axis)
    return mb.mesh(smooth=None)


LAB_WINDOWS_X = (5.25, 6.20)


def _delete_within(me, centers_xy, r, zmax=0.0):
    """Borra las caras que invadan el radio r (en planta X–Y) de algún centro y con z < zmax."""
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(me)
    def hits(p):
        return p.z < zmax and any(math.hypot(p.x - cx, p.y - cy) < r for cx, cy in centers_xy)
    kill = [f for f in bm.faces if hits(f.calc_center_median()) or any(hits(v.co) for v in f.verts)]
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    bm.to_mesh(me)
    bm.free()
    return me


def shell_profile(r_in, r_out, x0, x1):
    """Perfil (r, z) de tubo de pared delgada para lathe sobre eje X."""
    return [(r_in, x0), (r_out, x0), (r_out, x1), (r_in, x1), (r_in, x0)]


def lathe_x(mb, mat, profile_rx, seg=64):
    """Lathe alrededor de X: el perfil se da como (r, x)."""
    return mb.lathe(mat, profile_rx, seg=seg, axis='X')


def ring_frame(name, r_in, r_out, x, w, mat="M_AlLi", seg=64):
    mb = MB(name)
    lathe_x(mb, mat, shell_profile(r_in, r_out, x - w / 2, x + w / 2), seg)
    return mb.mesh(smooth=35)


def handrail_mesh(name, length, height=0.07, r=0.0125, mat="M_EVAYellow", stanchions=None):
    """Pasamanos EVA: barra con montantes; eje longitudinal X local, normal +Y."""
    mb = MB(name)
    n = stanchions or max(2, int(length / 0.5) + 1)
    pts = [(-length / 2, height, 0), (length / 2, height, 0)]
    mb.tube(mat, pts, r, 10)
    for i in range(n):
        x = -length / 2 + length * i / (n - 1)
        mb.cyl(mat, r * 0.9, r * 0.9, height, 8, center=(x, height / 2, 0), axis='Y')
        mb.cyl("M_Bolt", 0.022, 0.022, 0.008, 10, center=(x, 0.004, 0), axis='Y')
    return mb.mesh(smooth=50)


def light_mesh(name, r=0.07, depth=0.09):
    mb = MB(name)
    mb.cyl("M_AlAnodBlack", r, r * 0.85, depth, 20, center=(0, 0, depth / 2), axis='Z')
    mb.cyl("M_NavLight", r * 0.8, r * 0.8, 0.006, 20, center=(0, 0, depth + 0.002), axis='Z')
    mb.box("M_AlAnodBlack", r * 2.4, 0.03, 0.04, center=(0, 0, 0.02))
    return mb.mesh(smooth=40)


def camera_mesh(name):
    mb = MB(name)
    mb.box("M_AlBare", 0.12, 0.10, 0.16, center=(0, 0, 0.08))
    mb.cyl("M_AlAnodBlack", 0.035, 0.04, 0.06, 16, center=(0, 0, 0.19), axis='Z')
    mb.cyl("M_Lens", 0.028, 0.028, 0.004, 16, center=(0, 0, 0.222), axis='Z')
    mb.box("M_MLI_Silver", 0.13, 0.11, 0.02, center=(0, 0, 0.17))
    mb.cyl("M_Cable", 0.008, 0.008, 0.1, 8, center=(0, -0.06, 0.03), axis='Y')
    return mb.mesh(smooth=35)


def nav_light_mesh(name, led_mat="M_NavLight"):
    """Baliza de navegación con carenado estructural, visera lateral y cúpula emisiva."""
    mb = MB(name)
    # base atornillada
    mb.cyl("M_AlBare", 0.056, 0.062, 0.012, 20, center=(0, 0, 0.006), axis='Z')
    mb.bolts("M_Bolt", bolt_circle((0, 0, 0.013), (0, 0, 1), 0.048, 4), 0.005, 0.004)
    # cuerpo y carenado aerodinámico-técnico
    mb.cyl("M_AlAnodBlack", 0.044, 0.038, 0.048, 20, center=(0, 0, 0.036), axis='Z')
    mb.box("M_AlBare", 0.095, 0.046, 0.028, center=(-0.018, 0, 0.026))
    # collarín y lente emisiva
    mb.torus("M_AlBare", 0.034, 0.005, 20, 6, center=(0, 0, 0.060), axis='Z')
    mb.sphere(led_mat, 0.030, 18, 10, center=(0, 0, 0.064))
    # micro-visera protectora
    mb.box("M_AlAnodBlack", 0.022, 0.072, 0.038, center=(-0.036, 0, 0.064))
    return mb.mesh(smooth=40)


def patch_antenna_mesh(name, r=0.09):
    mb = MB(name)
    # placa de masa con tornillería perimetral
    mb.cyl("M_AlBare", r * 1.24, r * 1.28, 0.010, 24, center=(0, 0, 0.005), axis='Z')
    mb.bolts("M_Bolt", bolt_circle((0, 0, 0.011), (0, 0, 1), r * 1.12, 6), 0.005, 0.004)
    # radomo cerámico biselado con anillo protector
    mb.lathe("M_Teflon", [(0.0, 0.010), (r * 1.02, 0.010), (r * 1.02, 0.024), (r * 0.88, 0.034), (0.0, 0.034)], 24, axis='Z')
    mb.torus("M_AlAnodBlack", r * 1.02, 0.004, 24, 6, center=(0, 0, 0.012), axis='Z')
    # conector RF dorado y pasamuros blindado
    mb.cyl("M_GoldPlate", 0.012, 0.012, 0.024, 12, center=(0, -r * 1.05, 0.016), axis='Y')
    mb.cyl("M_Cable", 0.008, 0.008, 0.11, 8, center=(0, -r * 1.15 - 0.05, 0.012), axis='Y')
    mb.box("M_AlBare", 0.026, 0.018, 0.020, center=(0, -r * 1.15 - 0.08, 0.010))
    return mb.mesh(smooth=40)


def grapple_fixture_mesh(name):
    """Accesorio de agarre (grapple fixture) para el brazo robótico."""
    mb = MB(name)
    mb.box("M_AlBare", 0.36, 0.36, 0.03, center=(0, 0, 0.015))
    mb.cyl("M_AlBare", 0.12, 0.10, 0.08, 24, center=(0, 0, 0.07), axis='Z')
    mb.cyl("M_AlAnodBlack", 0.025, 0.025, 0.22, 12, center=(0, 0, 0.2), axis='Z')
    mb.sphere("M_AlAnodBlack", 0.035, 12, 8, center=(0, 0, 0.31))
    mb.box("M_Decal", 0.02, 0.18, 0.12, center=(0.12, 0, 0.12))
    for c in [(-0.15, -0.15), (0.15, -0.15), (-0.15, 0.15), (0.15, 0.15)]:
        mb.bolt("M_Bolt", (c[0], c[1], 0.03), (0, 0, 1), 0.01, 0.007)
    mb.box("M_EVAYellow", 0.30, 0.012, 0.003, center=(0, 0.17, 0.031))
    return mb.mesh(smooth=40)


def rcs_quad_mesh(name):
    """Cuadrete RCS: carcasa con 4 propulsores orientados ±X, ±tangencial
    y radial. Construido con +Z = radial exterior, +X = eje de la nave."""
    mb = MB(name)
    mb.box("M_MLI_Gold", 0.34, 0.30, 0.16, center=(0, 0, 0.08))
    mb.box("M_AlBare", 0.36, 0.32, 0.02, center=(0, 0, 0.0))
    mb.box("M_BetaCloth", 0.30, 0.26, 0.012, center=(0, 0, 0.166))
    noz = [((0.17, 0, 0.09), 'X'), ((-0.17, 0, 0.09), '-X'), ((0, 0.15, 0.09), 'Y'), ((0, -0.15, 0.09), '-Y'), ((0, 0, 0.17), 'Z')]
    for c, ax in noz:
        v = {'X': Vector((1, 0, 0)), '-X': Vector((-1, 0, 0)), 'Y': Vector((0, 1, 0)), '-Y': Vector((0, -1, 0)), 'Z': Vector((0, 0, 1))}[ax]
        base = Vector(c)
        mb.cyl("M_Steel", 0.022, 0.022, 0.05, 16, center=base + v * 0.025, axis=ax)
        mb.lathe("M_Nozzle", [(0.012, 0.0), (0.016, 0.01), (0.034, 0.07), (0.036, 0.072), (0.030, 0.072), (0.010, 0.012)],
                 seg=20, axis=ax, center=base + v * 0.05)
    return mb.mesh(smooth=40)


# ---------------------------------------------------------------------------
# NODO DE PROA
# ---------------------------------------------------------------------------

def build_forward(root):
    fwd = group("FWD", "Módulo Nodo de Proa", root, explode=(5.0, 0, 0),
                desc="Nodo presurizado de proa con puerto de atraque IDSS activo y cúpula de observación de 7 ventanas. Aloja la estación de trabajo robótica y la estiba de acceso rápido.",
                func="Interfaz de atraque, observación directa y control del brazo robótico")
    _node_structure(fwd)
    _node_shield(fwd)
    _docking(fwd)
    _cupola(fwd)
    _node_exterior(fwd)
    return fwd


def _node_structure(fwd):
    g = group("FWD.STR", "Estructura primaria del nodo", fwd, explode=(0, 0, 0),
              desc="Barril presurizado de Al-Li 2195 soldado por fricción-agitación, con mamparos mecanizados y marcos anulares.")
    mb = MB("node_barrel")
    lathe_x(mb, "M_AlLi", shell_profile(S.R_N - 0.03, S.R_N, S.X_NODE_A, S.X_NODE_F), 64)
    me = boolean_cut(mb.mesh(), [cutter(0.66, 1.0, (S.X_CUPOLA, 0, 1.3))])
    part("FWD.STR.BRL", "Barril presurizado del nodo", me, g, explode=("radial", 0.0),
         desc="Cilindro de Ø2,70 m y 2,30 m de longitud; pared de Al-Li con refuerzo isogrid interno.",
         func="Contener la atmósfera de cabina (101,3 kPa nominal)")
    # mamparo de proa: placa anular con brida IDSS
    mb = MB("node_fwd_bulkhead")
    lathe_x(mb, "M_AlLi", [(0.47, S.X_NODE_F - 0.02), (S.R_N, S.X_NODE_F - 0.02), (S.R_N, S.X_NODE_F + 0.04),
                            (1.0, S.X_NODE_F + 0.05), (0.6, S.X_NODE_F + 0.07), (0.47, S.X_NODE_F + 0.07), (0.47, S.X_NODE_F - 0.02)], 64)
    mb.bolts("M_Bolt", bolt_circle((S.X_NODE_F + 0.072, 0, 0), (1, 0, 0), 0.55, 36))
    part("FWD.STR.BHF", "Mamparo de proa", mb.mesh(), g, explode=(0.9, 0, 0),
         desc="Mamparo mecanizado con abertura de paso IDSS de 0,80 m y círculo de 36 tornillos de la brida de atraque.",
         func="Transferir cargas de atraque y cerrar el volumen presurizado")
    mb = MB("node_aft_bulkhead")
    lathe_x(mb, "M_AlLi", [(0.52, S.X_NODE_A + 0.06), (S.R_N - 0.03, S.X_NODE_A + 0.06), (S.R_N - 0.03, S.X_NODE_A),
                            (0.52, S.X_NODE_A), (0.52, S.X_NODE_A + 0.06)], 64)
    part("FWD.STR.BHA", "Mamparo de popa del nodo", mb.mesh(), g, explode=(-0.6, 0, 0),
         desc="Mamparo anular con escotilla de 1,04 m hacia el módulo habitable.")
    for i, x in enumerate([S.X_NODE_A + 0.1, S.X_NODE_A + 0.36, S.X_NODE_F - 0.1]):
        part(f"FWD.STR.FRM{i+1}", f"Marco anular del nodo {i+1}", ring_frame(f"node_frame{i}", S.R_N - 0.11, S.R_N - 0.03, x, 0.05),
             g, explode=("auto", 0.4), desc="Marco de rigidización circunferencial (sección en T).")
    # anillo de base de la cúpula
    mb = MB("cupola_ring")
    mb.lathe("M_AlLi", [(0.66, 1.02), (0.80, 1.02), (0.80, 1.355), (0.66, 1.355), (0.66, 1.02)], 48, axis='Z', center=(S.X_CUPOLA, 0, 0))
    mb.bolts("M_Bolt", bolt_circle((S.X_CUPOLA, 0, 1.356), (0, 0, 1), 0.73, 24))
    part("FWD.STR.CPR", "Anillo de interfaz de la cúpula", mb.mesh(), g, explode=(0, 0, 0.5),
         desc="Anillo forjado que une la cúpula al barril del nodo; 24 tornillos de alta resistencia.")


def _node_shield(fwd):
    g = group("FWD.MMOD", "Protección MMOD y térmica del nodo", fwd, explode=(0, 0, 0),
              desc="Mantas MMOD blandas tipo 'stuffed Whipple' (beta cloth + Nextel + Kevlar) sobre MLI. Se eligen mantas flexibles en el nodo por su geometría compleja (cúpula, atraque).")
    for q in range(4):
        a0 = q * PI / 2 + 0.01
        a1 = (q + 1) * PI / 2 - 0.01
        mb = MB(f"node_blanket_{q}")
        prof = []
        seg = 16
        for side in range(2):
            pass
        # manta acolchada: sector de cilindro con costuras (anillos finos)
        from .lib import curved_panel
        me = curved_panel(f"node_blanket_{q}", S.R_N + 0.02, S.R_N_SHIELD, a0, a1, S.X_NODE_A + 0.02, S.X_NODE_F - 0.02, seg=16)
        me.materials.append(M("M_BetaCloth"))
        if q in (0, 1):
            me = boolean_cut(me, [cutter(0.745, 1.2, (S.X_CUPOLA, 0, 1.3))])
        p = part(f"FWD.MMOD.BLK{q+1}", f"Manta MMOD del nodo, cuadrante {q+1}", me, g, explode=("radial", 0.7),
                 desc="Manta de 6 capas: beta cloth exterior, 2× Nextel AF62, 2× Kevlar 710 y MLI de 15 capas.",
                 func="Fragmentar micrometeoroides y limitar el flujo térmico radiativo")
        # costuras de acolchado
        mb = MB(f"node_quilt_{q}")
        for k in range(1, 6):
            x = S.X_NODE_A + (S.X_NODE_F - S.X_NODE_A) * k / 6
            mb.lathe("M_Fabric", [(S.R_N_SHIELD + 0.002, x - 0.006), (S.R_N_SHIELD + 0.006, x), (S.R_N_SHIELD + 0.002, x + 0.006)],
                     seg=12, axis='X', angle=(a1 - a0), start=a0 + PI / 2)
            # lathe empieza en +Y local tras axis_matrix X: compensamos con rotación posterior
        me2 = mb.mesh()
        pq = part(f"FWD.MMOD.BLK{q+1}.Q", f"Costuras de acolchado, cuadrante {q+1}", me2, g, explode=("radial", 0.7),
                  rot=(0, 0, 0), desc="Costuras de unión de capas (hilo de PTFE).")
        pq["ex_follow"] = p.name


def _docking(fwd):
    g = group("FWD.DCK", "Sistema de atraque IDSS (activo)", fwd, explode=(1.6, 0, 0),
              desc="Mecanismo de atraque andrógino compatible con el International Docking System Standard: captura blanda con plataforma de 6 actuadores y captura dura con 12 ganchos. Paso libre de 0,80 m.",
              func="Atraque con estaciones, vehículos de tripulación y módulos logísticos")
    x0 = S.DOCK_X0
    # túnel / adaptador
    mb = MB("dock_tunnel")
    lathe_x(mb, "M_AlBare", [(0.40, x0), (0.62, x0), (0.62, x0 + 0.05), (0.56, x0 + 0.08), (0.56, x0 + 0.30), (0.40, x0 + 0.30), (0.40, x0)], 64)
    mb.bolts("M_Bolt", bolt_circle((x0 + 0.052, 0, 0), (1, 0, 0), 0.59, 36))
    part("FWD.DCK.TUN", "Túnel adaptador de atraque", mb.mesh(), g, explode=(0.3, 0, 0),
         desc="Túnel mecanizado que conecta el mamparo del nodo con la base del mecanismo.")
    # anillo de captura dura con 12 ganchos
    xh = x0 + 0.30
    mb = MB("hard_capture")
    lathe_x(mb, "M_AlBare", [(0.40, xh), (0.79, xh), (0.79, xh + 0.06), (0.70, xh + 0.09), (0.40, xh + 0.09), (0.40, xh)], 64)
    for i in range(12):
        a = TAU * i / 12 + TAU / 24
        c = ring_xyz(0.73, a, xh + 0.12)
        R = Matrix.Rotation(a, 4, 'X')
        mb.box("M_Steel", 0.07, 0.05, 0.035, center=c, rot=R)
        mb.box("M_AlAnodBlack", 0.05, 0.08, 0.05, center=ring_xyz(0.73, a, xh + 0.07), rot=R)
    mb.torus("M_Rubber", 0.62, 0.012, 64, 8, center=(xh + 0.092, 0, 0), axis='X')
    mb.torus("M_Rubber", 0.66, 0.012, 64, 8, center=(xh + 0.092, 0, 0), axis='X')
    part("FWD.DCK.HCS", "Sistema de captura dura (12 ganchos)", mb.mesh(), g, explode=(0.6, 0, 0),
         desc="Anillo estructural con 12 pares de ganchos accionados eléctricamente y doble sello elastomérico de silicona.",
         func="Unión estructural rígida y estanca tras la captura")
    # actuadores de la plataforma Stewart (6)
    xs = xh + 0.38
    act = group("FWD.DCK.SCS", "Sistema de captura blanda", g, explode=(0.9, 0, 0),
                desc="Anillo de captura blanda sobre plataforma de 6 grados de libertad que absorbe la energía de contacto y alinea los vehículos.")
    for i in range(6):
        a_base = TAU * (i // 2) / 3 + (0.35 if i % 2 else -0.35)
        a_top = TAU * (((i + 1) // 2) % 3) / 3 + (-0.35 if i % 2 else 0.35) + (TAU / 6 if False else 0)
        pb = ring_xyz(0.55, a_base, xh + 0.09)
        pt = ring_xyz(0.55, a_base + (0.5 if i % 2 else -0.5), xs - 0.02)
        mb = MB(f"actuator_{i}")
        mid = pb.lerp(pt, 0.55)
        mb.tube("M_AlBare", [pb, mid], 0.028, 12)
        mb.tube("M_Steel", [mid, pt], 0.016, 12)
        mb.sphere("M_Steel", 0.03, 10, 6, center=pb)
        mb.sphere("M_Steel", 0.025, 10, 6, center=pt)
        part(f"FWD.DCK.SCS.ACT{i+1}", f"Actuador lineal de captura blanda {i+1}", mb.mesh(), act, explode=("radial", 0.35),
             desc="Actuador electromecánico con amortiguador de carga y sensor de fuerza.")
    mb = MB("soft_ring")
    lathe_x(mb, "M_AlBare", [(0.55, xs), (0.72, xs), (0.72, xs + 0.05), (0.55, xs + 0.05), (0.55, xs)], 64)
    for i in range(3):
        a = TAU * i / 3 + PI / 2
        p0 = ring_xyz(0.70, a - 0.33, xs + 0.05)
        p1 = ring_xyz(0.70, a + 0.33, xs + 0.05)
        p2 = ring_xyz(0.50, a, xs + 0.30)
        q0 = ring_xyz(0.66, a - 0.30, xs + 0.05)
        q1 = ring_xyz(0.66, a + 0.30, xs + 0.05)
        q2 = ring_xyz(0.47, a, xs + 0.28)
        mb.poly("M_AlBare", [p0, p1, p2], [q0, q1, q2])
        for k in (0.2, 0.5, 0.8):
            mb.bolt("M_Bolt", ring_xyz(0.715, a - 0.33 + 0.66 * k, xs + 0.03), Vector((0, math.cos(a), math.sin(a))), 0.008, 0.006)
    for i in range(3):
        a = TAU * i / 3 + PI / 2 + PI / 3
        mb.box("M_Steel", 0.04, 0.06, 0.06, center=ring_xyz(0.64, a, xs + 0.075), rot=Matrix.Rotation(a, 4, 'X'))
    sr = part("FWD.DCK.SCS.RNG", "Anillo de captura blanda con 3 pétalos guía", mb.mesh(), act, explode=(0.5, 0, 0),
              desc="Anillo con tres pétalos de guiado y tres pestillos de captura magnéticos-mecánicos.")
    from .expansion import mech
    mech(sr, "slide", (xs, 0, 0), (1, 0, 0), -0.26, 0.0, -0.26, ident="dock:ring", speed=0.25)
    # cámaras, luces, diana, láser
    eq = group("FWD.DCK.SNS", "Sensores de aproximación y atraque", g, explode=("radial", 0.6),
               desc="Cámaras de visión estéreo, LIDAR de destello y luces de atraque para la aproximación final autónoma.")
    cam = camera_mesh("dock_cam")
    for i, a in enumerate([PI / 4, 3 * PI / 4]):
        p = part(f"FWD.DCK.SNS.CAM{i+1}", f"Cámara de atraque {i+1}", cam, eq, loc=ring_xyz(0.92, a, x0 - 0.12),
                 rot=(a - PI / 2, PI / 2 * 0, 0), explode=("radial", 0.3), desc="Cámara monocromo de alto rango dinámico con iluminación sincronizada.")
        p.rotation_euler = (a - PI / 2, 0, 0)
        p.rotation_mode = 'XYZ'
        # orientar hacia +X: rotamos la cámara (su +Z) al eje X
        p.matrix_basis = Matrix.Translation(ring_xyz(1.05, a, x0 + 0.01)) @ Matrix.Rotation(a - PI / 2, 4, 'X') @ Matrix.Rotation(PI / 2, 4, 'Y')
    lid = MB("lidar")
    lid.box("M_AlAnodBlack", 0.18, 0.16, 0.14, center=(0, 0, 0.07))
    lid.cyl("M_Sensor", 0.05, 0.05, 0.02, 24, center=(0, 0, 0.15), axis='Z')
    lid.cyl("M_Lens", 0.03, 0.03, 0.01, 16, center=(0.05, 0.04, 0.145), axis='Z')
    lid.box("M_MLI_Gold", 0.19, 0.17, 0.02, center=(0, 0, 0.11))
    p = part("FWD.DCK.SNS.LDR", "LIDAR de destello 3D", lid.mesh(), eq, explode=("radial", 0.3),
             desc="Sensor LIDAR flash para medición de distancia y actitud relativas (0,5–3000 m).")
    p.matrix_basis = Matrix.Translation(ring_xyz(1.05, -PI / 2, x0 + 0.01)) @ Matrix.Rotation(-PI / 2 - PI / 2, 4, 'X') @ Matrix.Rotation(PI / 2, 4, 'Y')
    lm = light_mesh("dock_light")
    for i, a in enumerate([0.0, PI]):
        p = part(f"FWD.DCK.SNS.LGT{i+1}", f"Foco de atraque {i+1}", lm, eq, explode=("radial", 0.3),
                 desc="Foco LED de 5000 K para iluminación de la zona de contacto.")
        p.matrix_basis = Matrix.Translation(ring_xyz(1.05, a, x0 + 0.01)) @ Matrix.Rotation(a - PI / 2, 4, 'X') @ Matrix.Rotation(PI / 2, 4, 'Y')
    # diana de atraque (target)
    mb = MB("dock_target")
    mb.cyl("M_Graphite", 0.16, 0.16, 0.01, 32, center=(0, 0, 0.005), axis='Z')
    mb.box("M_ShieldWhite", 0.30, 0.03, 0.004, center=(0, 0, 0.012))
    mb.box("M_ShieldWhite", 0.03, 0.30, 0.004, center=(0, 0, 0.012))
    mb.cyl("M_AlAnodBlack", 0.012, 0.012, 0.22, 10, center=(0, 0, 0.12), axis='Z')
    mb.cyl("M_ShieldWhite", 0.05, 0.05, 0.01, 20, center=(0, 0, 0.235), axis='Z')
    p = part("FWD.DCK.SNS.TGT", "Diana de atraque centrada", mb.mesh(), eq, explode=("radial", 0.3),
             desc="Diana visual de referencia para atraques pilotados por la tripulación del vehículo visitante.")
    p.matrix_basis = Matrix.Translation(ring_xyz(1.05, PI / 2 + 0.6, x0 + 0.01)) @ Matrix.Rotation(PI / 2 + 0.6 - PI / 2, 4, 'X') @ Matrix.Rotation(PI / 2, 4, 'Y')
    # conectores umbilicales
    mb = MB("umbilicals")
    for a in (PI / 2 + PI / 6, -PI / 2 - PI / 6):
        c = ring_xyz(0.50, a, xh + 0.1)
        mb.box("M_AlAnodBlack", 0.10, 0.12, 0.08, center=c, rot=Matrix.Rotation(a, 4, 'X'))
        for k in range(4):
            mb.cyl("M_GoldPlate", 0.008, 0.008, 0.03, 8, center=c + Vector((0.06, (k - 1.5) * 0.025 * math.sin(a), -(k - 1.5) * 0.025 * math.cos(a))), axis='X')
    part("FWD.DCK.UMB", "Conectores umbilicales de potencia y datos", mb.mesh(), g, explode=(0.75, 0, 0.2),
         desc="Dos conectores de acoplamiento automático (potencia 120 V CC y datos Ethernet determinista).")


def _cupola(fwd):
    g = group("FWD.CUP", "Cúpula de observación", fwd, explode=(0, 0, 1.4),
              desc="Cúpula hexagonal de 7 ventanas para observación directa durante operaciones de proximidad y robótica.",
              func="Visibilidad directa de 360° del hemisferio cenital")
    xc, z0 = S.X_CUPOLA, 1.36
    rb, rt, h = 0.70, 0.46, 0.52
    # cuerpo (marco hexagonal tronco-piramidal — anillos HUECOS para visión cenital y paso libre!)
    mb = MB("cupola_body")
    # Anillo forjado de base HUECO (antes cilindro macizo que sellaba la entrada desde el nodo)
    mb.lathe("M_AlBare", [
        (0.64, z0), (0.75, z0), (0.75, z0 + 0.12), (0.64, z0 + 0.12), (0.64, z0)
    ], 48, axis='Z', center=(xc, 0, 0))
    mb.torus("M_Handrail", 0.61, 0.012, 48, 8, center=(xc, 0, z0 + 0.05), axis='Z')
    bot = [Vector((xc + rb * math.cos(TAU * i / 6), rb * math.sin(TAU * i / 6), z0 + 0.12)) for i in range(6)]
    top = [Vector((xc + rt * math.cos(TAU * i / 6), rt * math.sin(TAU * i / 6), z0 + 0.12 + h)) for i in range(6)]
    for i in range(6):
        j = (i + 1) % 6
        mb.beam("M_AlBare", bot[i], top[i], 0.072, 0.075, up=(bot[i] - Vector((xc, 0, bot[i].z))))
        mb.beam("M_AlAnodBlack", bot[i], top[i], 0.032, 0.082, up=(bot[i] - Vector((xc, 0, bot[i].z))))
        mb.beam("M_AlBare", top[i], top[j], 0.062, 0.062, up=(0, 0, 1))
        mb.beam("M_AlBare", bot[i], bot[j], 0.070, 0.070, up=(0, 0, 1))
    # Anillo superior HUECO de la ventana cenital (antes cilindro macizo que bloqueaba W7!)
    z_top_base = z0 + 0.12 + h
    mb.lathe("M_AlBare", [
        (0.305, z_top_base - 0.01), (0.41, z_top_base - 0.01),
        (0.41, z_top_base + 0.065), (0.305, z_top_base + 0.065), (0.305, z_top_base - 0.01)
    ], 48, axis='Z', center=(xc, 0, 0))
    mb.torus("M_AlAnodBlack", 0.312, 0.012, 48, 8, center=(xc, 0, z_top_base + 0.065), axis='Z')
    mb.bolts("M_Bolt", bolt_circle((xc, 0, z_top_base + 0.066), (0, 0, 1), 0.365, 24), 0.007, 0.005)
    part("FWD.CUP.FRM", "Estructura de la cúpula (forja de aluminio)", mb.mesh(), g, explode=(0, 0, 0.0),
         desc="Forja de aluminio 2219 con seis montantes y anillo superior hueco de ventana cenital.")
    gl = group("FWD.CUP.WIN", "Ventanas de la cúpula", g, explode=(0, 0, 0.35),
               desc="Cada ventana: panel de escombros exterior, dos paneles de presión redundantes de sílice fundida y panel interior de protección.")
    for i in range(6):
        j = (i + 1) % 6
        c = (bot[i] + bot[j] + top[i] + top[j]) / 4
        n = ((bot[i] + bot[j]) / 2 - Vector((xc, 0, z0 + 0.12)))
        n.z = 0
        n.normalize()
        b0 = bot[i].lerp(c, 0.12)
        b1 = bot[j].lerp(c, 0.12)
        t1 = top[j].lerp(c, 0.12)
        t0 = top[i].lerp(c, 0.12)
        mb = MB(f"cup_win_{i}")
        mb.poly("M_Glass", [b0, b1, t1, t0], [b0 + n * 0.025, b1 + n * 0.025, t1 + n * 0.025, t0 + n * 0.025])
        mb.poly("M_GlassInner", [b0 - n * 0.03, b1 - n * 0.03, t1 - n * 0.03, t0 - n * 0.03],
                [b0 - n * 0.02, b1 - n * 0.02, t1 - n * 0.02, t0 - n * 0.02])
        part(f"FWD.CUP.WIN.W{i+1}", f"Ventana trapezoidal {i+1}", mb.mesh(), gl, explode=("auto", 0.35),
             desc="Conjunto de 4 paneles; paneles de presión de 25 mm.")
    mb = MB("cup_top_win")
    mb.cyl("M_Glass", 0.304, 0.304, 0.018, 48, center=(xc, 0, z0 + 0.12 + h + 0.056), axis='Z')
    mb.cyl("M_GlassInner", 0.300, 0.300, 0.008, 48, center=(xc, 0, z0 + 0.12 + h + 0.016), axis='Z')
    part("FWD.CUP.WIN.W7", "Ventana cenital circular", mb.mesh(), gl, explode=(0, 0, 0.4),
         desc="Ventana circular de 0,62 m, la mayor del vehículo.")
    # contraventanas abiertas (protección MMOD con marco rigidizado, nervios en X y bielas)
    sg = group("FWD.CUP.SHT", "Contraventanas MMOD", g, explode=(0, 0, 0.6),
               desc="Contraventanas giratorias de aluminio con manta MMOD, accionadas manualmente desde el interior.")
    from .singularity_geo import build_detailed_cupola_shutter_mesh
    for i in range(6):
        j = (i + 1) % 6
        mtop = (top[i] + top[j]) / 2
        n = mtop - Vector((xc, 0, mtop.z))
        n.normalize()
        tdir = (top[j] - top[i]).normalized()
        w_top = (top[j] - top[i]).length * 0.92
        w_bot = (bot[j] - bot[i]).length * 0.92
        # abierta: girada sobre la bisagra superior, proyectada hacia fuera como un alero
        dirv = (n * math.cos(0.50) + Vector((0, 0, 1)) * math.sin(0.50)).normalized()
        nrm = tdir.cross(dirv).normalized()
        if nrm.z < 0:
            nrm = -nrm
        h0 = mtop + n * 0.05 + Vector((0, 0, 0.02))
        Lsh = (top[i] - bot[i]).length * 0.95
        a0 = h0 - tdir * w_top / 2
        a1 = h0 + tdir * w_top / 2
        b1 = h0 + dirv * Lsh + tdir * w_bot / 2
        b0 = h0 + dirv * Lsh - tdir * w_bot / 2
        me_sh = build_detailed_cupola_shutter_mesh(i, a0, a1, b1, b0, h0, n, nrm, tdir, w_top)
        sp = part(f"FWD.CUP.SHT.S{i+1}", f"Contraventana {i+1}", me_sh, sg, explode=("auto", 0.4),
                  desc="Contraventana de aluminio con marco rigidizado y manta MMOD sobre bisagra superior con retén; se cierra desde la cúpula.")
        from .expansion import mech, ctl
        tgt = ((bot[i] + bot[j]) / 2 - mtop).normalized()
        phi = math.atan2(tdir.dot(dirv.cross(tgt)), dirv.dot(tgt))
        mech(sp, "hinge", h0, tdir, min(0.0, phi * 0.97), max(0.0, phi * 0.97), 0.0, ident=f"shutter:{i+1}", speed=1.2)
        ctl(sp, "shutters")
    mb = MB("cup_top_shutter")
    ztop = z0 + 0.12 + h + 0.06
    hinge = Vector((xc - 0.38, 0, ztop))
    dirv = Vector((-math.sin(0.25), 0, math.cos(0.25)))
    q0 = hinge + Vector((0, -0.32, 0))
    q1 = hinge + Vector((0, 0.32, 0))
    q2 = hinge + Vector((0, 0.32, 0)) + dirv * 0.68
    q3 = hinge + Vector((0, -0.32, 0)) + dirv * 0.68
    quad = [q0, q1, q2, q3]
    nn = Vector((math.cos(0.25), 0, math.sin(0.25)))
    mb.poly("M_ShieldWhite", quad, [q + nn * 0.018 for q in quad])
    for p, q in ((q0, q1), (q1, q2), (q2, q3), (q3, q0)):
        mb.beam("M_AlBare", p + nn * 0.022, q + nn * 0.022, 0.024, 0.014, up=nn)
    mb.beam("M_AlBare", q0 + nn * 0.020, q2 + nn * 0.020, 0.015, 0.010, up=nn)
    mb.beam("M_AlBare", q1 + nn * 0.020, q3 + nn * 0.020, 0.015, 0.010, up=nn)
    mb.poly("M_BetaCloth", [q - nn * 0.014 for q in quad], [q - nn * 0.002 for q in quad])
    mb.cyl("M_Steel", 0.018, 0.018, 0.60, 14, center=hinge, axis='Y')
    for sy in (-0.22, 0.22):
        mb.box("M_AlBare", 0.055, 0.05, 0.055, center=hinge + Vector((0.02, sy, -0.01)))
    sp = part("FWD.CUP.SHT.S7", "Contraventana cenital", mb.mesh(smooth=40), sg, explode=(-0.3, 0, 0.3),
              desc="Contraventana de la ventana cenital con marco rigidizado, abierta hacia popa.")
    from .expansion import mech, ctl
    mech(sp, "hinge", hinge, (0, 1, 0), 0.0, 1.80, 0.0, ident="shutter:7", speed=1.2)
    ctl(sp, "shutters")
    # pasamanos cúpula
    hr = MB("cup_handrails")
    for i in range(6):
        a = TAU * i / 6 + TAU / 12
        p0 = Vector((xc + 0.82 * math.cos(a), 0.82 * math.sin(a), z0 + 0.05))
        p1 = Vector((xc + 0.82 * math.cos(a), 0.82 * math.sin(a), z0 + 0.12))
        hr.tube("M_EVAYellow", [p0, p1], 0.0125, 8)
    hr.torus("M_EVAYellow", 0.82, 0.0125, 48, 8, center=(xc, 0, z0 + 0.13), axis='Z')
    part("FWD.CUP.HRL", "Pasamanos EVA perimetral de la cúpula", hr.mesh(), g, explode=(0, 0, 0.2))


def _node_exterior(fwd):
    g = group("FWD.EXT", "Equipos exteriores del nodo", fwd, explode=("radial", 0.0),
              desc="Antenas de baja ganancia banda S, balizas de navegación carenadas, placas de servicio y pasamanos EVA del nodo.")
    pa = patch_antenna_mesh("lga_patch")
    for i, a in enumerate([-PI / 2 + 0.5, -PI / 2 - 0.5]):
        p = part(f"FWD.EXT.LGA{i+1}", f"Antena de baja ganancia banda S {i+1}", pa, g, explode=("radial", 0.5),
                 desc="Antena de parche omnidireccional de banda S con radomo de PTFE y conector coaxial blindado.")
        p.matrix_basis = Matrix.Translation(ring_xyz(S.R_N_SHIELD, a, 11.6)) @ Matrix.Rotation(a - PI / 2, 4, 'X')
    for i, (a, mat, lbl, xn) in enumerate([
        (0.0, "M_LEDRed", "babor (roja)", 12.02),
        (PI, "M_LEDGreen", "estribor (verde)", 12.02),
        (PI / 2 - 0.35, "M_NavLight", "proa dorsal (blanca)", 12.06),
    ]):
        p = part(f"FWD.EXT.NAV{i+1}", f"Baliza de navegación {lbl}", nav_light_mesh(f"navlight_{i}", mat), g, explode=("radial", 0.5),
                 desc="Baliza LED de navegación con carenado protector y visera direccional.")
        p.matrix_basis = Matrix.Translation(ring_xyz(S.R_N_SHIELD, a, xn)) @ Matrix.Rotation(a - PI / 2, 4, 'X')
    # Bandas térmicas de remate y placas de servicio/inspección en los flancos del nodo
    mb = MB("node_trim")
    for xband in (S.X_NODE_A + 0.08, S.X_NODE_F - 0.08):
        mb.lathe("M_MLI_Gold", [(S.R_N_SHIELD + 0.001, xband - 0.032), (S.R_N_SHIELD + 0.007, xband - 0.024),
                                (S.R_N_SHIELD + 0.007, xband + 0.024), (S.R_N_SHIELD + 0.001, xband + 0.032)], 56, axis='X')
        mb.lathe("M_AlBare", [(S.R_N_SHIELD + 0.005, xband - 0.008), (S.R_N_SHIELD + 0.010, xband - 0.006),
                              (S.R_N_SHIELD + 0.010, xband + 0.006), (S.R_N_SHIELD + 0.005, xband + 0.008)], 56, axis='X')
    # Dos paneles de servicio / tomas de pruebas de presión en los flancos de babor y estribor
    for sgn in (1, -1):
        a = 0.22 if sgn > 0 else PI - 0.22
        R = Matrix.Translation(ring_xyz(S.R_N_SHIELD + 0.004, a, 10.62)) @ Matrix.Rotation(a - PI / 2, 4, 'X')
        vs = []
        vs += mb.box("M_AlBare", 0.34, 0.24, 0.014, center=(0, 0, 0.007))
        vs += mb.box("M_Graphite", 0.28, 0.18, 0.006, center=(0, 0, 0.016))
        vs += mb.box("M_Accent", 0.28, 0.022, 0.003, center=(0, -0.075, 0.019))
        for dx in (-0.07, 0.0, 0.07):
            vs += mb.cyl("M_GoldPlate", 0.016, 0.016, 0.014, 12, center=(dx, 0.02, 0.022), axis='Z')
        for cx in (-0.14, 0.14):
            for cy in (-0.09, 0.09):
                vs += mb.bolt("M_Bolt", (cx, cy, 0.015), (0, 0, 1), 0.006, 0.005)
        mb.transform(R, vs)
    part("FWD.EXT.TRM", "Bandas térmicas y placas de servicio del nodo", mb.mesh(smooth=40), g, explode=("radial", 0.5),
         desc="Cintas de sellado térmico de Kapton/aluminio en los bordes del nodo y paneles de servicio de presurización.")
    hm = handrail_mesh("node_handrail", 1.6)
    for i, a in enumerate([PI / 2 + 0.75, PI / 2 - 0.75, -PI / 2 + 0.9, -PI / 2 - 0.9]):
        p = part(f"FWD.EXT.HR{i+1}", f"Pasamanos EVA del nodo {i+1}", hm, g, explode=("radial", 0.5))
        p.matrix_basis = Matrix.Translation(ring_xyz(S.R_N_SHIELD, a, 11.05)) @ Matrix.Rotation(a, 4, 'X')


# ---------------------------------------------------------------------------
# MÓDULO HABITABLE — exterior y estructura
# ---------------------------------------------------------------------------

def build_hab_exterior(hab):
    from . import canopy
    _hab_structure(hab)
    canopy.build_exterior_windows(hab)
    _hab_mli(hab)
    panels = _hab_shield(hab)
    _hab_rcs(hab)
    _hab_exterior_eq(hab, panels)


def _isogrid_mesh(name, x0, x1, r_out, depth=0.035, cell=0.46, w=0.012):
    mb = MB(name)
    circ = TAU * r_out
    ncol = int(round(circ / cell))
    ds = circ / ncol
    h = ds * math.sqrt(3) / 2
    nrow = max(1, int(round((x1 - x0) / h)))
    h = (x1 - x0) / nrow
    rr = r_out - depth / 2

    def P(i, j):
        s = (j + (0.5 if i % 2 else 0.0)) * ds
        a = s / r_out
        return ring_xyz(rr, a, x0 + i * h), a

    for i in range(nrow + 1):
        for j in range(ncol):
            p, a = P(i, j)
            q, a2 = P(i, j + 1)
            up = Vector((0, math.cos(a), math.sin(a)))
            mb.beam("M_AlLi", p, q, w, depth, up=up)
            if i < nrow:
                q1, _ = P(i + 1, j)
                q2, _ = P(i + 1, j - 1 if i % 2 == 0 else j + 1)
                mb.beam("M_AlLi", p, q1, w, depth, up=up)
                mb.beam("M_AlLi", p, q2, w, depth, up=up)
    return mb.mesh(smooth=None)


def _hab_structure(hab):
    g = group("HAB.STR", "Estructura primaria presurizada", hab, explode=(0, 0, 0),
              desc="Casco presurizado de Al-Li 2195: 4 barriles con isogrid mecanizado interno, cono adaptador, mamparo de popa elipsoidal y 5 marcos anulares.",
              func="Contención de presión, rigidez estructural y soporte de equipos")
    xs = [S.X_HAB_A + S.BARREL_L * i for i in range(S.N_BARRELS + 1)]
    for i in range(S.N_BARRELS):
        bg = group(f"HAB.STR.B{i+1}", f"Barril presurizado {i+1}", g, explode=("auto", 0.0),
                   desc=f"Barril de {S.BARREL_L:.2f} m entre X={xs[i]:.2f} y X={xs[i+1]:.2f} m.")
        mb = MB(f"barrel_{i}")
        lathe_x(mb, "M_AlLi", shell_profile(S.R_P - 0.006, S.R_P, xs[i] + 0.01, xs[i + 1] - 0.01), 72)
        # soldaduras longitudinales (relieve)
        for k in range(3):
            a = TAU * k / 3 + 0.3
            mb.box("M_AlBare", S.BARREL_L - 0.04, 0.03, 0.003, center=ring_xyz(S.R_P + 0.001, a, (xs[i] + xs[i + 1]) / 2),
                   rot=Matrix.Rotation(a - PI / 2, 4, 'X'))
        me = mb.mesh()
        iso = _isogrid_mesh(f"isogrid_{i}", xs[i] + 0.03, xs[i + 1] - 0.03, S.R_P - 0.006)
        if i == 2:
            cuts = lambda: [cutter(0.205, 0.6, (x, 0, -S.R_P)) for x in LAB_WINDOWS_X]
            me = boolean_cut(me, cuts())
            # la retícula isogrid no es una malla cerrada: la booleana exacta dejaba tapas
            # espurias sobre la ventana; se eliminan las caras dentro del radio del hueco
            iso = _delete_within(iso, [(x, 0.0) for x in LAB_WINDOWS_X], 0.255, zmax=0.0)
        part(f"HAB.STR.B{i+1}.SKN", f"Piel del barril {i+1}", me, bg, explode=("auto", 0.0),
             desc="Piel de 6 mm (zona de membrana) con tres soldaduras longitudinales FSW.")
        part(f"HAB.STR.B{i+1}.ISO", f"Isogrid interno del barril {i+1}", iso,
             bg, explode=("auto", 0.0), desc="Retícula triangular mecanizada (nervios de 12 mm × 35 mm) que proporciona rigidez frente a pandeo con mínima masa.")
    for k, x in enumerate(xs):
        mb = MB(f"hab_frame_{k}")
        lathe_x(mb, "M_AlLi", [(S.R_P - 0.11, x - 0.03), (S.R_P - 0.005, x - 0.03), (S.R_P - 0.005, x + 0.03), (S.R_P - 0.11, x + 0.03), (S.R_P - 0.11, x - 0.03)], 72)
        lathe_x(mb, "M_AlLi", [(S.R_P - 0.13, x - 0.015), (S.R_P - 0.11, x - 0.015), (S.R_P - 0.11, x + 0.015), (S.R_P - 0.13, x + 0.015), (S.R_P - 0.13, x - 0.015)], 72)
        mb.torus("M_AlBare", S.R_P + 0.002, 0.006, 96, 6, center=(x, 0, 0), axis='X')
        part(f"HAB.STR.FRM{k+1}", f"Marco anular {k+1} (X={x:.2f})", mb.mesh(), g, explode=("auto", 0.0),
             desc="Marco anular de unión entre barriles con soldadura circunferencial.")
    # cono adaptador
    mb = MB("hab_cone")
    lathe_x(mb, "M_AlLi", [(S.R_P - 0.03, S.X_HAB_F), (S.R_P, S.X_HAB_F), (S.R_CONE_F, S.X_CONE_F), (S.R_CONE_F - 0.03, S.X_CONE_F), (S.R_P - 0.03, S.X_HAB_F)], 72)
    mb.bolts("M_Bolt", bolt_circle((S.X_CONE_F - 0.02, 0, 0), (1, 0, 0), S.R_CONE_F - 0.05, 48))
    from . import canopy
    part("HAB.STR.CON", "Cono adaptador HAB–nodo", boolean_cut(mb.mesh(), canopy.cutters(), "hab_cone_win"), g, explode=(0.6, 0, 0),
         desc="Tronco de cono de Al-Li que transita de Ø4,20 m a Ø2,80 m, con nueve huecos de ventana panorámica para la cabina de vuelo.")
    # mamparo de popa elipsoidal
    prof = []
    n = 14
    for i in range(n + 1):
        t = (PI / 2) * i / n
        prof.append((S.R_P * math.cos(t), S.X_HAB_A - (S.X_HAB_A - S.X_DOME_A) * math.sin(t)))
    prof_in = [(r * 0.985, x + 0.02) for (r, x) in reversed(prof)]
    mb = MB("aft_dome")
    lathe_x(mb, "M_AlLi", prof + prof_in[:-1] + [prof[0]], 72)
    mb.cyl("M_AlBare", 0.22, 0.22, 0.06, 32, center=(S.X_DOME_A + 0.01, 0, 0), axis='X')
    for k in range(6):
        a = TAU * k / 6
        mb.cyl("M_AlBare", 0.045, 0.045, 0.07, 16, center=ring_xyz(0.9, a, S.X_DOME_A + 0.25), axis='X')
    part("HAB.STR.DOM", "Mamparo de popa elipsoidal", mb.mesh(), g, explode=(-0.9, 0, 0),
         desc="Cúpula elipsoidal 2:1 con 6 pasamuros de fluidos y potencia hacia el módulo de servicio.")
    # anillo de interfaz con el módulo de servicio
    mb = MB("svc_interface_ring")
    lathe_x(mb, "M_AlBare", [(S.R_P - 0.06, S.X_HAB_A - 0.05), (S.R_P + 0.06, S.X_HAB_A - 0.05), (S.R_P + 0.06, S.X_HAB_A + 0.03),
                              (S.R_P - 0.06, S.X_HAB_A + 0.03), (S.R_P - 0.06, S.X_HAB_A - 0.05)], 72)
    mb.bolts("M_Bolt", bolt_circle((S.X_HAB_A + 0.032, 0, 0), (1, 0, 0), S.R_P + 0.03, 64))
    part("HAB.STR.IFR", "Anillo de interfaz HAB/servicio", mb.mesh(), g, explode=(-0.5, 0, 0),
         desc="Anillo en Y forjado con 64 tornillos; transmite el empuje del módulo de servicio al casco.")


def _hab_mli(hab):
    from .lib import curved_panel
    g = group("HAB.MLI", "Aislamiento multicapa (MLI)", hab, explode=(0, 0, 0),
              desc="Mantas MLI de 20 capas (Mylar aluminizado con separador de red de Dacron) entre casco y escudo MMOD.",
              func="Reducir el intercambio radiativo del casco con el entorno")
    for q in range(4):
        a0 = q * PI / 2 + 0.004
        a1 = (q + 1) * PI / 2 - 0.004
        me = curved_panel(f"mli_q{q}", S.R_P + 0.004, S.R_MLI, a0, a1, S.X_HAB_A + 0.03, S.X_HAB_F - 0.03, seg=18)
        me.materials.append(M("M_MLI_Gold"))
        if q in (2, 3):
            me = boolean_cut(me, [cutter(0.25, 0.6, (x, 0, -S.R_P)) for x in LAB_WINDOWS_X])
        part(f"HAB.MLI.Q{q+1}", f"Manta MLI del barril, cuadrante {q+1}", me, g, explode=("radial", 0.55),
             desc="Manta de 20 capas con cara exterior de Kapton aluminizado y velcro de unión.")
    mb = MB("mli_cone")
    lathe_x(mb, "M_MLI_Gold", [(S.R_P + 0.004, S.X_HAB_F), (S.R_MLI, S.X_HAB_F), (S.R_CONE_F + 0.035, S.X_CONE_F - 0.02), (S.R_CONE_F + 0.005, S.X_CONE_F - 0.02), (S.R_P + 0.004, S.X_HAB_F)], 64)
    from . import canopy
    part("HAB.MLI.CON", "Manta MLI del cono", boolean_cut(mb.mesh(), canopy.cutters(grow=0.01), "mli_cone_win"), g, explode=(0.4, 0, 0.0))
    prof = []
    for i in range(13):
        t = (PI / 2) * i / 12
        prof.append(((S.R_P + 0.03) * math.cos(t), S.X_HAB_A - (S.X_HAB_A - S.X_DOME_A + 0.03) * math.sin(t)))
    mb = MB("mli_dome")
    lathe_x(mb, "M_MLI_Gold", prof, 64)
    part("HAB.MLI.DOM", "Manta MLI del mamparo de popa", mb.mesh(), g, explode=(-0.5, 0, 0))


def _shield_panel_mesh(name, length, variant="std"):
    """Panel MMOD plano (bumper Whipple) construido en ángulo 0 (+Y).
    Variantes: std, service (con trampilla de inspección), accent (franja bermellón), graphite (franja grafito)."""
    w = 2 * S.R_S * math.tan(PI / S.N_FACETS) - 0.035
    t = 0.016
    mb = MB(name)
    yc = S.R_S - t / 2
    mb.box("M_ShieldWhite", length - 0.02, t, w, center=(0, yc, 0))
    # pestaña perimetral (rigidizador)
    mb.box("M_AlBare", length - 0.02, 0.006, 0.02, center=(0, S.R_S + 0.002, w / 2 - 0.01))
    mb.box("M_AlBare", length - 0.02, 0.006, 0.02, center=(0, S.R_S + 0.002, -w / 2 + 0.01))
    # escuadras de refuerzo en las 4 esquinas del panel
    for sx in (-1, 1):
        for sz in (-1, 1):
            mb.box("M_AlBare", 0.09, 0.003, 0.07, center=(sx * (length / 2 - 0.06), S.R_S + 0.0015, sz * (w / 2 - 0.05)))
    # tornillería perimetral
    nb = int(length / 0.35)
    pns = []
    for k in range(nb + 1):
        x = -length / 2 + 0.06 + (length - 0.12) * k / nb
        pns += [((x, S.R_S + 0.005, w / 2 - 0.03), (0, 1, 0)), ((x, S.R_S + 0.005, -w / 2 + 0.03), (0, 1, 0))]
    for z in (-w / 4, 0, w / 4):
        pns += [((length / 2 - 0.04, S.R_S, z), (0, 1, 0)), ((-length / 2 + 0.04, S.R_S, z), (0, 1, 0))]
    mb.bolts("M_Bolt", pns, 0.009, 0.006)
    # casquillos de pasamanos / puntos de anclaje EVA
    for x in (-length / 4, length / 4):
        mb.cyl("M_AlBare", 0.02, 0.02, 0.012, 12, center=(x, S.R_S + 0.006, 0), axis='Y')
    # etiqueta de identificación de panel
    mb.box("M_Decal", 0.10, 0.001, 0.04, center=(length / 2 - 0.16, S.R_S + 0.0006, -w / 2 + 0.09))
    if variant == "service":
        # trampilla de inspección / acceso a mantas MLI con marco biselado, cierres y junta térmica
        hx, hw, hl = 0.08, min(0.46, w * 0.56), 0.58
        mb.box("M_AlBare", hl + 0.04, 0.005, hw + 0.04, center=(hx, S.R_S + 0.0025, 0))
        mb.box("M_ShieldWhite", hl, 0.009, hw, center=(hx, S.R_S + 0.0055, 0))
        mb.box("M_Graphite", hl + 0.012, 0.002, 0.012, center=(hx, S.R_S + 0.0052, hw / 2 + 0.005))
        mb.box("M_Graphite", hl + 0.012, 0.002, 0.012, center=(hx, S.R_S + 0.0052, -hw / 2 - 0.005))
        # 4 cierres de cuarto de vuelta + tirador empotrado
        for sx in (-1, 1):
            for sz in (-1, 1):
                mb.box("M_AlAnodBlack", 0.032, 0.006, 0.024, center=(hx + sx * (hl / 2 - 0.05), S.R_S + 0.010, sz * (hw / 2 - 0.04)))
        mb.box("M_Steel", 0.036, 0.010, 0.11, center=(hx - hl / 2 + 0.07, S.R_S + 0.011, 0))
        mb.box("M_Accent", 0.018, 0.0015, hw - 0.04, center=(hx + hl / 2 - 0.03, S.R_S + 0.0105, 0))
    if variant == "accent":
        mb.box("M_Accent", 0.16, 0.0012, w - 0.002, center=(length / 2 - 0.22, S.R_S + 0.0006, 0))
        mb.box("M_Graphite", 0.035, 0.0012, w - 0.002, center=(length / 2 - 0.35, S.R_S + 0.0006, 0))
    if variant == "graphite":
        mb.box("M_Graphite", 0.42, 0.0012, w - 0.002, center=(-length / 2 + 0.3, S.R_S + 0.0006, 0))
        mb.box("M_Accent", 0.03, 0.0012, w - 0.002, center=(-length / 2 + 0.55, S.R_S + 0.0006, 0))
    return mb.mesh(smooth=None, bevel=0.004)


def _standoffs_mesh(name, x0, x1):
    mb = MB(name)
    for i in range(S.N_FACETS):
        a = S.facet_angle(i) + PI / S.N_FACETS  # en las juntas entre facetas
        for x in (x0 + 0.25, (x0 + x1) / 2, x1 - 0.25):
            p0 = ring_xyz(S.R_P + 0.005, a, x)
            p1 = ring_xyz(S.R_S / math.cos(PI / S.N_FACETS) - 0.03, a, x)
            mb.beam("M_Titanium", p0, p1, 0.03, 0.05, up=(1, 0, 0))
            mb.box("M_AlBare", 0.08, 0.004, 0.08, center=p0 + Vector((0, 0.0, 0)), rot=Matrix.Rotation(a - PI / 2, 4, 'X'))
    return mb.mesh(smooth=None)


def _hab_shield(hab):
    g = group("HAB.MMOD", "Escudo MMOD poligonal (Whipple relleno)", hab, explode=(0, 0, 0),
              desc="64 paneles planos de aluminio 6061-T6 de 1,6 mm (bumper) en 16 facetas, separados ~12 cm del casco. Entre ambos: capas de Nextel/Kevlar integradas en la manta MLI (configuración 'stuffed Whipple').",
              func="Fragmentar y dispersar partículas hipervelocidad antes de alcanzar el casco")
    xs = [S.X_HAB_A + S.BARREL_L * i for i in range(S.N_BARRELS + 1)]
    meshes = {
        "std": _shield_panel_mesh("shield_panel_std", S.BARREL_L, "std"),
        "service": _shield_panel_mesh("shield_panel_service", S.BARREL_L, "service"),
        "accent": _shield_panel_mesh("shield_panel_accent", S.BARREL_L, "accent"),
        "graphite": _shield_panel_mesh("shield_panel_graphite", S.BARREL_L, "graphite"),
    }
    xc3 = (xs[2] + xs[3]) / 2
    meshes["window"] = boolean_cut(_shield_panel_mesh("shield_panel_win", S.BARREL_L, "std"),
                                   [cutter(0.25, 0.3, (x - xc3, S.R_S, 0), axis='Y') for x in LAB_WINDOWS_X], "shield_panel_window")
    # Facetas seleccionadas con trampillas de inspección (lejos de ventanas nadir i=12 y rótulos i=0,8)
    service_facets = {(1, 2), (1, 6), (1, 10), (1, 14), (2, 1), (2, 7), (2, 9), (2, 15)}
    panels = {}
    for r in range(S.N_BARRELS):
        rg = group(f"HAB.MMOD.R{r+1}", f"Anillo de paneles MMOD {r+1}", g, explode=("auto", 0.0),
                   desc=f"16 paneles del anillo {r+1} (X={xs[r]:.2f}–{xs[r+1]:.2f} m).")
        base_var = "graphite" if r == 0 else ("accent" if r == S.N_BARRELS - 1 else "std")
        xc = (xs[r] + xs[r + 1]) / 2
        for i in range(S.N_FACETS):
            a = S.facet_angle(i)
            if r == 2 and i == 12:
                mv = meshes["window"]
            elif (r, i) in service_facets:
                mv = meshes["service"]
            else:
                mv = meshes[base_var]
            p = part(f"HAB.MMOD.R{r+1}.P{i+1:02d}", f"Panel MMOD R{r+1}-F{i+1:02d}", mv, rg,
                     loc=(xc, 0, 0), rot=(a, 0, 0), explode=("radial", 0.9 + 0.15 * r),
                     desc="Panel bumper de Al 6061-T6 pintado con recubrimiento térmico blanco; 12+6 fijaciones de titanio.")
            panels[(r, i)] = p
        part(f"HAB.MMOD.R{r+1}.STO", f"Soportes del escudo, anillo {r+1}", _standoffs_mesh(f"standoffs_{r}", xs[r], xs[r + 1]),
             rg, explode=("radial", 0.35), desc="48 soportes de titanio con base de aluminio unidos al casco.")
    # Cintas térmicas metálicas / Kapton en las costuras entre anillos MMOD
    mb = MB("mmod_ring_seams")
    r_seam = S.R_S + 0.002
    for xj in (xs[1], xs[2], xs[3], S.X_HAB_F):
        lathe_x(mb, "M_MLI_Gold", [(r_seam - 0.006, xj - 0.022), (r_seam + 0.003, xj - 0.018),
                                   (r_seam + 0.003, xj + 0.018), (r_seam - 0.006, xj + 0.022)], 16)
        lathe_x(mb, "M_AlBare", [(r_seam + 0.001, xj - 0.006), (r_seam + 0.007, xj - 0.005),
                                 (r_seam + 0.007, xj + 0.005), (r_seam + 0.001, xj + 0.006)], 16)
    part("HAB.MMOD.SEAM", "Cintas térmicas y flejes de costura entre anillos", mb.mesh(smooth=None), g, explode=("radial", 0.4),
         desc="Sellado térmico de Kapton aluminizado y flejes de aluminio en las juntas circunferenciales entre anillos MMOD.")
    # paneles del cono (trapezoidales)
    cg = group("HAB.MMOD.CN", "Paneles MMOD del cono", g, explode=(0.5, 0, 0),
               desc="16 paneles trapezoidales que siguen el cono adaptador.")
    x0, x1 = S.X_HAB_F + 0.02, S.X_CONE_F - 0.05
    r0 = S.R_S
    r1 = S.R_CONE_F + 0.13
    half = PI / S.N_FACETS
    t = 0.016
    def corner(rap, x, sgn, off=0.0):
        rc = rap / math.cos(half)
        a = sgn * (half - 0.012)
        return Vector((x, (rc + off) * math.cos(a), (rc + off) * math.sin(a)))
    b = [corner(r0, x0, -1), corner(r0, x0, 1), corner(r1, x1, 1), corner(r1, x1, -1)]
    # normal de la faceta cónica
    nrm = ((b[3] - b[0]).cross(b[1] - b[0])).normalized()
    if nrm.y < 0:
        nrm = -nrm
    mb = MB("cone_panel")
    mb.poly("M_ShieldWhite", [p - nrm * t for p in b], b)
    for k in range(4):
        pass
    for p0, p1 in ((b[0], b[3]), (b[1], b[2])):
        for s in (0.15, 0.5, 0.85):
            c = p0.lerp(p1, s)
            mb.bolt("M_Bolt", c + (b[1] - b[0]).normalized() * (0.03 if p0 is b[0] else -0.03) * 1.0, nrm, 0.009, 0.006)
    me = mb.mesh(smooth=None)
    from . import canopy
    me_win = boolean_cut(me.copy(), [canopy.wedge(0, 1.6, 2.8, grow=0.012)], "cone_panel_win")
    for i in range(S.N_FACETS):
        part(f"HAB.MMOD.CN.P{i+1:02d}", f"Panel MMOD cónico {i+1:02d}", me_win if i in canopy.WIN_FACETS else me, cg, rot=(S.facet_angle(i), 0, 0),
             explode=("radial", 0.8), desc="Panel trapezoidal del cono.")
    hab["_panels"] = len(panels)
    return panels


def _hab_rcs(hab):
    g = group("HAB.RCS", "RCS delantero (4 cuadretes)", hab, explode=(0, 0, 0),
              desc="Cuatro cuadretes de control de reacción en la zona del cono, situados en diagonal para maximizar el brazo de palanca.",
              func="Control de actitud y traslación fina en proximidad")
    me = rcs_quad_mesh("rcs_quad")
    for i, a in enumerate([PI / 4, 3 * PI / 4, 5 * PI / 4, 7 * PI / 4]):
        p = part(f"HAB.RCS.Q{i+1}", f"Cuadrete RCS de proa {i+1}", me, g, explode=("radial", 1.2),
                 desc="Carcasa con 5 propulsores bipropelentes de clase 100–200 N y válvulas de doble asiento.")
        p.matrix_basis = Matrix.Translation(ring_xyz(S.R_S + 0.0, a, 8.35)) @ Matrix.Rotation(a - PI / 2, 4, 'X')


def _hab_exterior_eq(hab, panels):
    g = group("HAB.EXT", "Equipos exteriores del casco", hab, explode=(0, 0, 0),
              desc="Pasamanos EVA, accesorio de agarre robótico, iluminación, ventanas de laboratorio y marcas de identidad.")
    hg = group("HAB.EXT.HR", "Pasamanos EVA del casco", g, explode=("radial", 0.0))
    hm = handrail_mesh("hab_handrail", 1.7)
    k = 0
    for a in (S.facet_angle(5), S.facet_angle(3), S.facet_angle(11), S.facet_angle(13)):
        for x in (1.62, 3.67, 5.72, 7.77):
            k += 1
            p = part(f"HAB.EXT.HR.H{k:02d}", f"Pasamanos EVA {k:02d}", hm, hg, explode=("radial", 1.9),
                     desc="Pasamanos de aluminio anodizado amarillo, carga de diseño 900 N.")
            p.matrix_basis = Matrix.Translation(ring_xyz(S.R_S, a, x)) @ Matrix.Rotation(a, 4, 'X') @ Matrix.Rotation(0, 4, 'Z')
            # handrail construido con normal +Y: rotación alrededor de X por a lleva +Y a radial(a)
    gf = grapple_fixture_mesh("grapple")
    p = part("HAB.EXT.GF1", "Accesorio de agarre robótico (PDGF-like)", gf, g, explode=("radial", 1.6),
             desc="Base de agarre con interfaz de potencia y datos que permite reubicar el brazo robótico.")
    p.matrix_basis = Matrix.Translation(ring_xyz(S.R_S + 0.0, -PI / 2 + PI / 8 * 0, 4.70)) @ Matrix.Rotation(-PI / 2 - PI / 2, 4, 'X')
    # ventanas de laboratorio (nadir)
    wg = group("HAB.EXT.WIN", "Ventanas científicas de nadir", g, explode=(0, 0, -1.3),
               desc="Dos ventanas de calidad óptica (Ø0,40 m) para observación terrestre/lunar e instrumentos.")
    for i, x in enumerate(LAB_WINDOWS_X):
        mb = MB(f"lab_window_{i}")
        a = -PI / 2
        # marco anular (antes un cilindro macizo que tapaba la vista desde el pozo)
        mb.lathe("M_AlBare", [(0.205, 0.0), (0.27, 0.0), (0.27, 0.15), (0.205, 0.15), (0.205, 0.0)], 40, axis='Z')
        mb.cyl("M_Glass", 0.205, 0.205, 0.03, 40, center=(0, 0, 0.16), axis='Z')
        # contraventana MMOD abatida 90° fuera del campo de visión de la ventana
        mb.box("M_ShieldWhite", 0.48, 0.48, 0.012, center=(-0.285, 0, 0.40), rot=Matrix.Rotation(-PI / 2, 4, 'Y'))
        mb.cyl("M_Steel", 0.012, 0.012, 0.46, 10, center=(-0.285, 0, 0.16), axis='Y')
        mb.bolts("M_Bolt", bolt_circle((0, 0, 0.151), (0, 0, 1), 0.24, 16), 0.008, 0.006)
        p = part(f"HAB.EXT.WIN.W{i+1}", f"Ventana científica de nadir {i+1}", mb.mesh(), wg, explode=(0, 0, -0.4),
                 desc="Marco con paneles de presión redundantes y contraventana MMOD (abierta).")
        p.matrix_basis = Matrix.Translation(ring_xyz(S.R_P, a, x)) @ Matrix.Rotation(a - PI / 2, 4, 'X')
    # focos exteriores
    lm = light_mesh("hab_light")
    for i, (a, x) in enumerate([(S.facet_angle(7), 8.6), (S.facet_angle(9), 8.6), (S.facet_angle(3), 0.8)]):
        p = part(f"HAB.EXT.LGT{i+1}", f"Foco exterior {i+1}", lm, g, explode=("radial", 1.6),
                 desc="Foco LED orientable para EVA y operaciones robóticas.")
        p.matrix_basis = Matrix.Translation(ring_xyz(S.R_S, a, x)) @ Matrix.Rotation(a - PI / 2, 4, 'X')
    # canalizaciones umbilicales exteriores (raceways) conectando módulo de servicio ↔ habitable ↔ proa
    _hab_raceways(g)
    # marcas
    _hab_markings(g, panels)


def _hab_raceways(g):
    """Tendido exterior de conductos de fluidos, potencia y datos con abrazaderas sobre las facetas 1 y 7."""
    rg = group("HAB.EXT.RCW", "Canalizaciones umbilicales exteriores", g, explode=("radial", 0.0),
               desc="Dos tendidos longitudinales (babor y estribor) con bandeja protectora, líneas de fluidos en acero inoxidable, mazo de potencia 120 V y abrazaderas térmicas.")
    x_aft, x_fwd = -0.35, 8.35
    L = x_fwd - x_aft
    xm = (x_aft + x_fwd) / 2
    for idx, (facet, side_lbl) in enumerate(((1, "babor"), (7, "estribor"))):
        a = S.facet_angle(facet)
        mb = MB(f"hab_raceway_{idx}")
        # Construido en local con +Y = radial exterior, X = eje de la nave
        r0 = S.R_S + 0.004
        # bandeja base de aluminio mecanizado
        mb.box("M_AlBare", L, 0.012, 0.145, center=(xm, r0 + 0.006, 0))
        # labios laterales de protección
        for sz in (-1, 1):
            mb.box("M_AlBare", L, 0.036, 0.010, center=(xm, r0 + 0.022, sz * 0.072))
        # conductos longitudinales (2 líneas de fluidos de acero + mazo de potencia naranja + datos)
        mb.cyl("M_Steel", 0.014, 0.014, L - 0.06, 12, center=(xm, r0 + 0.028, -0.042), axis='X')
        mb.cyl("M_Steel", 0.011, 0.011, L - 0.06, 10, center=(xm, r0 + 0.026, -0.010), axis='X')
        mb.cyl("M_CableOrange", 0.012, 0.012, L - 0.06, 10, center=(xm, r0 + 0.026, 0.022), axis='X')
        mb.cyl("M_Cable", 0.009, 0.009, L - 0.06, 8, center=(xm, r0 + 0.024, 0.048), axis='X')
        # abrazaderas periódicas con tornillería cada ~0,85 m
        n_clamps = 11
        for k in range(n_clamps):
            xc = x_aft + 0.20 + (L - 0.40) * k / (n_clamps - 1)
            mb.box("M_AlAnodBlack", 0.045, 0.016, 0.165, center=(xc, r0 + 0.042, 0))
            for sz in (-1, 1):
                mb.bolt("M_Bolt", (xc, r0 + 0.050, sz * 0.068), (0, 1, 0), 0.006, 0.005)
        # tapas térmicas segmentadas intermedias con aislamiento MLI en las uniones de anillos
        for xcov in (2.65, 4.70, 6.75):
            mb.box("M_MLI_Gold", 0.24, 0.018, 0.160, center=(xcov, r0 + 0.046, 0))
        # cajas de empalme umbilical en popa (interfaz SVC) y proa (distribución cabina/nodo)
        for xb in (0.18, 8.15):
            mb.box("M_AlBare", 0.28, 0.056, 0.19, center=(xb, r0 + 0.028, 0))
            mb.box("M_Graphite", 0.22, 0.006, 0.14, center=(xb, r0 + 0.058, 0))
            mb.box("M_Accent", 0.22, 0.003, 0.018, center=(xb, r0 + 0.061, 0.055))
            for dz in (-0.04, 0.04):
                mb.cyl("M_GoldPlate", 0.014, 0.014, 0.024, 10, center=(xb + 0.15, r0 + 0.030, dz), axis='X')
        p = part(f"HAB.EXT.RCW.{idx+1}", f"Canalización umbilical exterior ({side_lbl})", mb.mesh(smooth=35), rg,
                 rot=(a, 0, 0), explode=("radial", 1.35),
                 desc="Tendido externo protegido de líneas térmicas, bus 120 V y datos con cajas de empalme.")


def _hab_markings(g, panels):
    """Serigrafías: cada marca se emparenta al panel MMOD sobre el que está
    pintada, de modo que viaja con él en la vista explosionada."""
    mg = group("HAB.EXT.MRK", "Marcas de identidad y técnicas", g, explode=("none", 0.0),
               desc="Serigrafías del nombre, matrícula, fabricante y avisos técnicos (pintura de poliuretano de baja desgasificación). Cada marca pertenece físicamente a su panel.")
    xs = [S.X_HAB_A + S.BARREL_L * i for i in range(S.N_BARRELS + 1)]
    items = []

    def place(code, label, body, size, mat, ring, facet, x, dy=0.0):
        a = S.facet_angle(facet)
        tm = text_mesh(code.replace(".", "_"), body, size=size, extrude=0.0008)
        tm.materials.append(M(mat))
        Mt = Matrix.Translation(ring_xyz(S.R_S + 0.0015, a, x)) @ Matrix.Rotation(a - PI / 2, 4, 'X')
        # legibilidad desde el exterior: en el semiespacio y>0 se gira 180°
        if math.cos(a) > 0.01 or (abs(math.cos(a)) <= 0.01 and math.sin(a) < 0):
            Mt = Mt @ Matrix.Rotation(PI, 4, 'Z')
        Mt = Mt @ Matrix.Translation((0, dy, 0))
        items.append((code, label, tm, Mt, panels[(ring, facet)]))

    for side, f in (("BABOR", 0), ("ESTRIBOR", 8)):
        xc = (xs[2] + xs[3]) / 2
        place(f"HAB.EXT.MRK.NAME_{side}", f"Nombre 'ALCIÓN' ({side.lower()})", "ALCIÓN", 0.42, "M_Graphite", 2, f, xc, 0.04)
        place(f"HAB.EXT.MRK.REG_{side}", f"Matrícula VLA·HX-4·01 ({side.lower()})", "VLA · HX-4 · 01", 0.12, "M_Graphite", 2, f, xc, -0.29)
        xc2 = (xs[1] + xs[2]) / 2
        place(f"HAB.EXT.MRK.MKR_{side}", f"Fabricante ({side.lower()})", "VARRO-LINDQVIST ASTRONAUTICS", 0.07, "M_Graphite", 1, f, xc2, 0.0)
    place("HAB.EXT.MRK.W1", "Aviso: NO PISAR", "NO PISAR · NO STEP", 0.05, "M_Decal", 0, 4, 2.0)
    place("HAB.EXT.MRK.W2", "Aviso: peligro RCS", "RCS · PELIGRO · HAZARD", 0.05, "M_DecalRed", 3, 2, 7.6)
    place("HAB.EXT.MRK.W3", "Rótulo del accesorio de agarre", "GRAPPLE · VLA-GF-01", 0.05, "M_Decal", 1, 11, 4.3)
    place("HAB.EXT.MRK.W4", "Aviso: NO PISAR", "NO PISAR · NO STEP", 0.05, "M_Decal", 3, 12, 7.5)
    for code, label, me, Mt, panel in items:
        p = part(code, label, me, mg, explode=("none", 0.0), desc="Serigrafía técnica sobre panel MMOD", smooth=None)
        p.matrix_basis = Mt
        attach(p, panel)
    return mg
