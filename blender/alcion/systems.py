"""
ALCIÓN HX-4 — módulo de servicio, propulsión, potencia, térmico,
comunicaciones y brazo robótico.
"""
import math
from mathutils import Vector, Matrix
from .lib import (group, part, MB, bolt_circle, ring_xyz, TAU, boolean_cut)
from .materials import M
from . import spec as S
from .exterior import (lathe_x, shell_profile, rcs_quad_mesh, handrail_mesh,
                       camera_mesh, light_mesh, patch_antenna_mesh, cutter)

PI = math.pi
HALF = PI / S.N_OCT
RC = S.SVC_APOTHEM / math.cos(HALF)  # radio de esquina del octógono


def oct_corner(i, r=RC, x=0.0):
    a = S.oct_angle(i) + HALF
    return ring_xyz(r, a, x)


def Rx(a):
    return Matrix.Rotation(a, 4, 'X')


# ---------------------------------------------------------------------------
# MÓDULO DE SERVICIO
# ---------------------------------------------------------------------------

def build_service(root):
    svc = group("SVC", "Módulo de Servicio", root, explode=(-4.2, 0, 0),
                desc="Módulo no presurizado octogonal que integra propulsante, aviónica, potencia, control térmico activo y sensores de navegación. Estructura de longerones y marcos de aluminio 7075 con paneles sándwich de nido de abeja.",
                func="Proveer propulsión, potencia, rechazo térmico y guiado al módulo habitable")
    _svc_structure(svc)
    _svc_skin(svc)
    _svc_tanks(svc)
    _svc_avionics(svc)
    _svc_thermal(svc)
    _svc_external(svc)
    return svc


def _svc_structure(svc):
    g = group("SVC.STR", "Estructura primaria del módulo de servicio", svc, explode=(0, 0, 0),
              desc="8 longerones, 3 marcos octogonales, 16 diagonales y cono de empuje central de CFRP.")
    rb = RC - 0.07
    for k, x in enumerate([S.SVC_X0 - 0.04, S.SVC_MID, S.SVC_X1 + 0.04]):
        mb = MB(f"svc_frame_{k}")
        for i in range(8):
            mb.beam("M_AlBare", oct_corner(i, rb, x), oct_corner(i + 1, rb, x), 0.07, 0.09, up=(1, 0, 0))
            mb.box("M_AlBare", 0.12, 0.12, 0.12, center=oct_corner(i, rb, x), rot=Rx(S.oct_angle(i) + HALF))
            mb.bolt("M_Bolt", oct_corner(i, rb + 0.06, x + 0.03), (Vector(oct_corner(i, 1, 0)) - Vector((0, 0, 0))).normalized(), 0.01, 0.007)
        part(f"SVC.STR.FRM{k+1}", f"Marco octogonal {k+1} (X={x:.2f})", mb.mesh(), g, explode=("auto", 0.0),
             desc="Marco mecanizado de Al 7075-T7351 con nodos de esquina.")
    lg = group("SVC.STR.LNG", "Longerones", g, explode=("radial", 0.0))
    for i in range(8):
        mb = MB(f"longeron_{i}")
        mb.beam("M_AlBare", oct_corner(i, rb, S.SVC_X0 - 0.04), oct_corner(i, rb, S.SVC_X1 + 0.04), 0.08, 0.08, up=oct_corner(i, 1, 0))
        part(f"SVC.STR.LNG.L{i+1}", f"Longerón {i+1}", mb.mesh(), lg, explode=("radial", 0.6),
             desc="Perfil en I de Al 7075 (80 × 80 mm).")
    dg = group("SVC.STR.DIA", "Diagonales de cizalladura", g, explode=("radial", 0.0))
    k = 0
    for i in range(8):
        for (x0, x1) in ((S.SVC_X0 - 0.04, S.SVC_MID), (S.SVC_MID, S.SVC_X1 + 0.04)):
            k += 1
            mb = MB(f"diag_{k}")
            a, b = (oct_corner(i, rb - 0.05, x0), oct_corner(i + 1, rb - 0.05, x1)) if (k % 2) else (oct_corner(i + 1, rb - 0.05, x0), oct_corner(i, rb - 0.05, x1))
            mb.tube("M_CFRP", [a, b], 0.025, 10)
            mb.cyl("M_Titanium", 0.035, 0.035, 0.08, 12, center=a.lerp(b, 0.04), rot=(b - a).to_track_quat('Z', 'Y').to_matrix().to_4x4())
            mb.cyl("M_Titanium", 0.035, 0.035, 0.08, 12, center=a.lerp(b, 0.96), rot=(b - a).to_track_quat('Z', 'Y').to_matrix().to_4x4())
            part(f"SVC.STR.DIA.D{k:02d}", f"Diagonal CFRP {k:02d}", mb.mesh(), dg, explode=("radial", 0.9),
                 desc="Tubo de CFRP con terminales de titanio pegados.")
    # cono de empuje
    mb = MB("thrust_cone")
    lathe_x(mb, "M_CFRP", [(0.48, -3.55), (0.52, -3.55), (1.62, S.SVC_X1 + 0.02), (1.58, S.SVC_X1 + 0.02), (0.48, -3.55)], 48)
    lathe_x(mb, "M_AlBare", shell_profile(0.46, 0.56, -3.60, -3.50), 48)
    lathe_x(mb, "M_AlBare", shell_profile(1.52, 1.66, S.SVC_X1 + 0.0, S.SVC_X1 + 0.06), 48)
    part("SVC.STR.CON", "Cono de empuje central (CFRP)", mb.mesh(), g, explode=(-0.6, 0, 0),
         desc="Cono de sándwich CFRP/nido de abeja que soporta el depósito de xenón y transmite el empuje principal.")


def _svc_panel_mesh(name, length, cover):
    w = 2 * S.SVC_APOTHEM * math.tan(HALF) - 0.035
    t = 0.022
    mb = MB(name)
    y = S.SVC_APOTHEM + t / 2
    mb.box("M_AlBare", length - 0.03, t, w, center=(0, y, 0))
    cov = {"gold": "M_MLI_Gold", "silver": "M_MLI_Silver", "black": "M_MLI_Black", "rad": "M_Radiator"}[cover]
    if cover == "rad":
        mb.box(cov, length - 0.06, 0.003, w - 0.04, center=(0, y + t / 2 + 0.0015, 0))
        # tiras de cinta OSR
        for k in range(1, 8):
            z = -w / 2 + w * k / 8
            mb.box("M_AlBare", length - 0.07, 0.0008, 0.004, center=(0, y + t / 2 + 0.0034, z))
    else:
        mb.box(cov, length - 0.05, 0.02, w - 0.03, center=(0, y + t / 2 + 0.01, 0))
        # costuras/velcro del MLI
        mb.box("M_BetaCloth", length - 0.05, 0.002, 0.02, center=(0, y + t / 2 + 0.021, 0))
        for k in (-1, 1):
            mb.box("M_BetaCloth", 0.02, 0.002, w - 0.03, center=(k * (length / 2 - 0.05), y + t / 2 + 0.021, 0))
    pns = []
    n = int(length / 0.4)
    for k in range(n + 1):
        x = -length / 2 + 0.05 + (length - 0.1) * k / n
        pns += [((x, y + t / 2, w / 2 - 0.015), (0, 1, 0)), ((x, y + t / 2, -w / 2 + 0.015), (0, 1, 0))]
    mb.bolts("M_Bolt", pns, 0.008, 0.006)
    return mb.mesh(smooth=None)


SVC_COVER = {0: "gold", 1: "silver", 2: "rad", 3: "gold", 4: "gold", 5: "silver", 6: "rad", 7: "gold"}


def _svc_skin(svc):
    g = group("SVC.SKN", "Paneles de cierre del módulo de servicio", svc, explode=(0, 0, 0),
              desc="16 paneles sándwich Al/nido de abeja de 22 mm: los cenitales/nadirales son radiadores corporales con OSR; el resto, MLI.")
    L = (S.SVC_X0 - S.SVC_MID)
    meshes = {c: _svc_panel_mesh(f"svc_panel_{c}", L, c) for c in set(SVC_COVER.values())}
    for row, (x0, x1) in enumerate(((S.SVC_X0, S.SVC_MID), (S.SVC_MID, S.SVC_X1))):
        rg = group(f"SVC.SKN.R{row+1}", f"Fila de paneles {row+1}", g, explode=("auto", 0.0))
        for i in range(8):
            c = SVC_COVER[i]
            lbl = {"gold": "MLI ámbar", "silver": "MLI plata", "rad": "radiador corporal", "black": "MLI negro"}[c]
            part(f"SVC.SKN.R{row+1}.P{i+1}", f"Panel de cierre R{row+1}-F{i+1} ({lbl})", meshes[c], rg,
                 loc=((x0 + x1) / 2, 0, 0), rot=(S.oct_angle(i), 0, 0), explode=("radial", 1.1),
                 desc="Panel sándwich desmontable para acceso de integración y mantenimiento.")


def _sphere_tank_mesh(name, r, mat, ring=True):
    mb = MB(name)
    mb.sphere(mat, r, 40, 20)
    if ring:
        mb.torus("M_TankTi", r + 0.012, 0.018, 48, 8, axis='X')
        for k in range(4):
            a = TAU * k / 4 + PI / 4
            mb.box("M_TankTi", 0.06, 0.05, 0.05, center=ring_xyz(r + 0.03, a, 0), rot=Rx(a))
    mb.cyl("M_TankTi", 0.05, 0.05, 0.08, 16, center=(-(r + 0.03), 0, 0), axis='X')
    mb.cyl("M_TankTi", 0.04, 0.04, 0.07, 16, center=((r + 0.03), 0, 0), axis='X')
    return mb.mesh(smooth=60)


def _svc_tanks(svc):
    g = group("SVC.PRP", "Almacenamiento y distribución de propulsante", svc, explode=(0, 0, 0),
              desc="Bipropelente MMH/MON-3 en 4 depósitos esféricos de titanio con PMD; xenón supercrítico en COPV central; helio presurizante en 2 COPV esféricos.",
              func="Almacenar ~4,6 t de bipropelente y ~1,1 t de xenón (hipótesis de dimensionado)")
    tk = group("SVC.PRP.BIP", "Depósitos de bipropelente", g, explode=("radial", 0.0))
    for i, a in enumerate([PI / 4, 3 * PI / 4, 5 * PI / 4, 7 * PI / 4]):
        fuel = i % 2 == 0
        sub = group(f"SVC.PRP.BIP.T{i+1}", f"Depósito {'MMH' if fuel else 'MON-3'} {i//2+1}", tk, explode=("radial", 1.5),
                    desc=("Combustible monometilhidracina" if fuel else "Oxidante tetróxido de nitrógeno con 3 % NO") + " — esfera de Ti-6Al-4V de Ø1,04 m con dispositivo de gestión de propulsante (PMD).")
        c = ring_xyz(1.30, a, -2.90)
        part(f"SVC.PRP.BIP.T{i+1}.SHL", "Envolvente esférica de titanio", _sphere_tank_mesh(f"biptank_{i}", 0.52, "M_TankTi"), sub,
             loc=c, explode=("auto", 0.0), desc="Envolvente de Ti-6Al-4V con anillo ecuatorial de montaje.")
        mb = MB(f"tank_struts_{i}")
        for k in range(4):
            aa = TAU * k / 4 + PI / 4
            p0 = c + Vector(ring_xyz(0.56, aa, 0.0))
            corner_i = int(round((a - HALF) / (TAU / 8))) % 8
            tgt = oct_corner(corner_i + (k % 2), RC - 0.12, -2.9 + (0.6 if k < 2 else -0.6))
            mb.tube("M_Titanium", [p0, tgt], 0.016, 8)
        part(f"SVC.PRP.BIP.T{i+1}.STR", "Puntales de soporte del depósito", mb.mesh(), sub, explode=("radial", 0.4),
             desc="4 puntales bípode de titanio con rótulas.")
        mb = MB(f"tank_mli_{i}")
        mb.sphere("M_MLI_Silver", 0.535, 32, 16, center=c, scale=(1, 1, 1))
        p = part(f"SVC.PRP.BIP.T{i+1}.MLI", "Manta MLI del depósito", mb.mesh(), sub, explode=("radial", 0.6),
                 desc="Manta MLI con calentadores de película para mantener el propulsante entre 10 y 40 °C.")
        p.hide_render = True  # oculta en render (mostraría solo la manta); visible en la web como capa opcional
        p["optional_layer"] = True
    # xenón
    mb = MB("xenon_copv")
    prof = []
    L0, L1, rr = -0.55, -3.45, 0.45
    for k in range(9):
        t = (PI / 2) * k / 8
        prof.append((rr * math.sin(t) + 0.001, L0 - rr * 0.5 * (1 - math.cos(t)) + rr * 0.5))
    prof = [(0.0, L0 + 0.0)]
    n = 10
    for k in range(n + 1):
        t = (PI / 2) * k / n
        prof.append((rr * math.sin(t), L0 - (rr * 0.55) * (1 - math.sin(PI / 2 - t)) + 0.0))
    prof = [(rr * math.sin((PI / 2) * k / n), L0 + rr * 0.55 * math.cos((PI / 2) * k / n) - rr * 0.55) for k in range(n + 1)]
    prof2 = [(rr * math.sin((PI / 2) * k / n), L1 - rr * 0.55 * math.cos((PI / 2) * k / n) + rr * 0.55) for k in reversed(range(n + 1))]
    mb.lathe("M_COPV", prof + prof2, 48, axis='X')
    mb.cyl("M_TankTi", 0.06, 0.06, 0.1, 16, center=(L0 + 0.05, 0, 0), axis='X')
    mb.cyl("M_TankTi", 0.06, 0.06, 0.1, 16, center=(L1 - 0.05, 0, 0), axis='X')
    for x in (L0 - 0.5, (L0 + L1) / 2, L1 + 0.5):
        mb.torus("M_AlBare", rr + 0.01, 0.015, 48, 6, center=(x, 0, 0), axis='X')
    part("SVC.PRP.XE", "Depósito COPV de xenón", mb.mesh(), g, explode=(-1.4, 0, 0),
         desc="Recipiente compuesto (liner de titanio, bobinado de fibra de carbono T1000) para xenón supercrítico a ~15 MPa.",
         func="Propulsante del sistema de propulsión eléctrica solar (SEP)")
    for i, a in enumerate([0.0, PI]):
        c = ring_xyz(1.35, a, -0.95)
        mb = MB(f"he_copv_{i}")
        mb.sphere("M_COPV", 0.30, 32, 16)
        mb.torus("M_AlBare", 0.31, 0.014, 40, 6, axis='X')
        mb.cyl("M_TankTi", 0.04, 0.04, 0.08, 12, center=(0.32, 0, 0), axis='X')
        part(f"SVC.PRP.HE{i+1}", f"Depósito de helio presurizante {i+1}", mb.mesh(), g, loc=c, explode=("radial", 1.2),
             desc="COPV esférico de Ø0,60 m para presurización regulada de los depósitos bipropelentes.")
    # panel de control de fluidos
    mb = MB("fluid_panel")
    base = Vector(ring_xyz(1.70, 3 * PI / 4 + 0.0, -1.20))
    R = Rx(3 * PI / 4 - PI / 2)
    mb.box("M_AlBare", 0.9, 0.6, 0.03, center=(0, 0, 0))
    for k in range(6):
        x = -0.35 + 0.14 * k
        mb.cyl("M_Steel", 0.035, 0.035, 0.09, 16, center=(x, 0.12, 0.05), axis='Z')
        mb.box("M_AlAnodBlack", 0.06, 0.06, 0.06, center=(x, -0.12, 0.05))
        mb.tube("M_Steel", [(x, 0.12, 0.10), (x, 0.12, 0.16), (x, -0.12, 0.16), (x, -0.12, 0.08)], 0.008, 8, round_r=0.03)
    mb.box("M_GoldPlate", 0.08, 0.05, 0.03, center=(0.38, 0.22, 0.03))
    mb.transform(Matrix.Translation(base) @ R @ Matrix.Rotation(PI / 2, 4, 'X') @ Matrix.Rotation(PI, 4, 'Z'), list(mb.bm.verts))
    part("SVC.PRP.FCA", "Conjunto de control de fluidos (FCA)", mb.mesh(), g, explode=("radial", 1.2),
         desc="Panel con válvulas pirotécnicas, reguladores de presión, filtros y transductores.")
    # líneas de propulsante
    lg = group("SVC.PRP.LIN", "Líneas de propulsante", g, explode=(-0.3, 0, 0))
    for i, a in enumerate([PI / 4, 3 * PI / 4, 5 * PI / 4, 7 * PI / 4]):
        mb = MB(f"prop_line_{i}")
        p0 = ring_xyz(1.30, a, -3.45)
        p1 = ring_xyz(1.30, a, -3.80)
        p2 = ring_xyz(S.ENGINE_R, a, -4.05)
        p3 = ring_xyz(S.ENGINE_R, a, -4.18)
        mb.tube("M_Steel", [p0, p1, p2, p3], 0.012, 10, round_r=0.08)
        mb.cyl("M_Steel", 0.02, 0.02, 0.05, 12, center=p1, axis='X')
        part(f"SVC.PRP.LIN.L{i+1}", f"Línea de alimentación {i+1}", mb.mesh(), lg, explode=("radial", 0.5),
             desc="Tubo de titanio de 3/4\" soldado orbitalmente con aislamiento y calentadores.")
    mb = MB("xe_lines")
    for sgn in (1, -1):
        mb.tube("M_Steel", [(-3.55, 0, 0), (-3.75, 0, 0), (-3.9, sgn * 0.6, 0.05), (-4.2, sgn * 1.5, 0.05), (-4.8, sgn * 1.9, 0.05)], 0.008, 8, round_r=0.1)
    part("SVC.PRP.LIN.XE", "Líneas de xenón a los propulsores Hall", mb.mesh(), lg, explode=(-0.4, 0, 0),
         desc="Tubería de acero inoxidable de 1/4\" con controladores de flujo proporcionales.")


def _box_unit(mb, mat, size, center, R, fins=0, conn=2, label=True):
    sx, sy, sz = size
    c = Vector(center)
    mb.box(mat, sx, sy, sz, center=c, rot=R)
    mb.box("M_AlBare", sx + 0.02, sy + 0.04, 0.012, center=c + (R.to_3x3() @ Vector((0, 0, -sz / 2 - 0.006))), rot=R)
    for k in range(fins):
        x = -sx / 2 + sx * (k + 0.5) / fins
        mb.box(mat, 0.006, sy * 0.96, 0.025, center=c + (R.to_3x3() @ Vector((x, 0, sz / 2 + 0.012))), rot=R)
    for k in range(conn):
        y = -sy / 4 + (sy / 2) * k / max(1, conn - 1)
        mb.cyl("M_GoldPlate", 0.018, 0.018, 0.035, 14, center=c + (R.to_3x3() @ Vector((sx / 2 + 0.017, y, 0))), rot=R @ Matrix.Rotation(PI / 2, 4, 'Y'))
    if label:
        mb.box("M_ShieldWhite", sx * 0.4, 0.001, sz * 0.3, center=c + (R.to_3x3() @ Vector((0, -sy / 2 - 0.0006, 0))), rot=R)


def _svc_avionics(svc):
    g = group("SVC.AVX", "Aviónica, potencia y guiado", svc, explode=(0, 0, 0),
              desc="Equipos disipativos montados en la cara interior de los paneles-radiador cenital y nadiral para evacuar su calor por conducción.",
              func="Mando y control, gestión de potencia, almacenamiento de energía y control de actitud")
    items = [
        ("SVC.AVX.FCC1", "Ordenador de vuelo A", "Ordenador de vuelo tolerante a fallos (procesador endurecido, votación triple).", 2, -0.10, (0.45, 0.32, 0.22), "M_AlChromate", 6),
        ("SVC.AVX.FCC2", "Ordenador de vuelo B", "Canal redundante B.", 2, -0.65, (0.45, 0.32, 0.22), "M_AlChromate", 6),
        ("SVC.AVX.FCC3", "Ordenador de vuelo C", "Canal redundante C.", 2, -1.20, (0.45, 0.32, 0.22), "M_AlChromate", 6),
        ("SVC.AVX.PCDU", "Unidad de control y distribución de potencia (PCDU)", "Regulación del bus de 120 V CC y protección de cargas.", 6, -0.35, (0.80, 0.50, 0.28), "M_AlChromate", 10),
        ("SVC.AVX.BAT1", "Batería Li-ion 1", "Módulo de 32 celdas; capacidad útil conceptual ~12 kWh.", 6, -1.15, (0.55, 0.42, 0.26), "M_Battery", 0),
        ("SVC.AVX.BAT2", "Batería Li-ion 2", "Módulo redundante.", 6, -1.70, (0.55, 0.42, 0.26), "M_Battery", 0),
        ("SVC.AVX.PPU1", "Unidad de procesado de potencia SEP 1", "Convierte el bus primario en las tensiones de descarga (~300–600 V) de los propulsores Hall.", 2, -2.60, (0.70, 0.50, 0.25), "M_AlChromate", 12),
        ("SVC.AVX.PPU2", "Unidad de procesado de potencia SEP 2", "Segunda PPU.", 6, -2.60, (0.70, 0.50, 0.25), "M_AlChromate", 12),
        ("SVC.AVX.IMU", "Unidad inercial (IMU)", "Giróscopos de fibra óptica y acelerómetros.", 2, -3.40, (0.28, 0.28, 0.22), "M_AlAnodBlack", 0),
        ("SVC.AVX.TRX", "Transpondedor de espacio profundo", "Transpondedor banda X/Ka con amplificadores de estado sólido.", 6, -3.40, (0.40, 0.30, 0.18), "M_AlChromate", 4),
    ]
    for code, lbl, desc, face, x, size, mat, fins in items:
        a = S.oct_angle(face)
        R = Rx(a - PI / 2) @ Matrix.Rotation(PI, 4, 'X')  # +Z local hacia el eje (cara de montaje en el panel)
        R = Rx(a - PI / 2)
        r = S.SVC_APOTHEM - 0.015 - size[2] / 2 - 0.012
        mb = MB(code.replace(".", "_"))
        # caja con base contra el panel: +Z local radial exterior -> invertimos para que la base mire al panel
        R2 = Rx(a + PI / 2)
        _box_unit(mb, mat, size, ring_xyz(r, a, x), R2, fins=fins)
        part(code, lbl, mb.mesh(), g, explode=("radial", 0.9), desc=desc)
    # ruedas de reacción
    rw = group("SVC.AVX.RWA", "Conjunto de 4 ruedas de reacción", g, explode=(-0.6, 0, 0),
               desc="Configuración piramidal para control de actitud de 3 ejes con un fallo tolerado.")
    for i in range(4):
        a = TAU * i / 4 + PI / 4 * 0
        c = ring_xyz(1.45, a, -3.90)
        axis = (Vector((-0.55, 0, 0)) + Vector(ring_xyz(1, a, 0)) * 0.83).normalized()
        R = axis.to_track_quat('Z', 'X').to_matrix().to_4x4()
        mb = MB(f"rwa_{i}")
        mb.cyl("M_AlAnodBlack", 0.17, 0.17, 0.11, 32, center=c, rot=R)
        mb.cyl("M_AlBare", 0.12, 0.12, 0.118, 32, center=c, rot=R)
        mb.cyl("M_AlBare", 0.20, 0.20, 0.012, 32, center=c + axis * -0.06, rot=R)
        mb.cyl("M_GoldPlate", 0.015, 0.015, 0.05, 10, center=c + axis * -0.04 + (R.to_3x3() @ Vector((0.16, 0, 0))), rot=R)
        part(f"SVC.AVX.RWA.W{i+1}", f"Rueda de reacción {i+1}", mb.mesh(), rw, explode=("radial", 0.6),
             desc="Rueda de inercia de 100 N·m·s con motor sin escobillas.")
    # mazos de cables troncales
    mb = MB("svc_harness")
    for face in (2, 6):
        a = S.oct_angle(face)
        for off in (-0.3, 0.3):
            p = [ring_xyz(S.SVC_APOTHEM - 0.06, a + off * 0.25, x) for x in (0.4, -0.5, -1.5, -2.5, -3.6)]
            mb.tube("M_Cable", p, 0.022, 10)
            for q in p[1:-1]:
                mb.box("M_AlBare", 0.05, 0.08, 0.08, center=q, rot=Rx(a))
    part("SVC.AVX.HRN", "Mazos de cables troncales", mb.mesh(), g, explode=(0, 0, 0),
         desc="Mazos de potencia y datos con abrazaderas cada 1 m, enrutados junto a los paneles-radiador.")


def _svc_thermal(svc):
    g = group("SVC.THM", "Control térmico activo (circuito externo)", svc, explode=("radial", 0.0),
              desc="Circuito de amoníaco monofásico de doble lazo: bomba, acumulador, intercambiador con el lazo de agua del HAB y válvulas de mezcla.",
              func="Transportar ~10 kW de calor a los radiadores (hipótesis de dimensionado)")
    a = S.oct_angle(7)
    base = Vector(ring_xyz(1.55, a, -1.20))
    R = Rx(a - PI / 2)
    mb = MB("pump_module")
    mb.box("M_AlBare", 0.80, 0.55, 0.03, center=(0, 0, 0))
    mb.cyl("M_AlChromate", 0.12, 0.12, 0.35, 24, center=(-0.18, 0.05, 0.14), axis='X')
    mb.cyl("M_Steel", 0.15, 0.15, 0.28, 24, center=(0.22, 0.05, 0.17), axis='Z')
    mb.sphere("M_Steel", 0.15, 20, 10, center=(0.22, 0.05, 0.31))
    mb.tube("M_Steel", [(-0.36, 0.05, 0.14), (-0.42, 0.05, 0.14), (-0.42, -0.20, 0.10), (0.30, -0.20, 0.10), (0.30, -0.2, 0.0)], 0.018, 10, round_r=0.05)
    mb.box("M_AlAnodBlack", 0.14, 0.12, 0.10, center=(-0.05, -0.18, 0.08))
    mb.transform(Matrix.Translation(base) @ R @ Matrix.Rotation(PI, 4, 'X'), list(mb.bm.verts))
    part("SVC.THM.PMP", "Módulo de bombeo de amoníaco", mb.mesh(), g, explode=("radial", 0.9),
         desc="Bomba centrífuga redundante, acumulador de fuelle y válvula de control de temperatura.")
    mb = MB("hx_interface")
    c = Vector((0.15, 0, 0))
    mb.box("M_AlChromate", 0.40, 0.90, 0.30, center=(0.25, 0, -1.05))
    for k in range(10):
        mb.box("M_AlBare", 0.42, 0.006, 0.28, center=(0.25, -0.40 + 0.09 * k, -1.05))
    mb.tube("M_Steel", [(0.45, 0.3, -1.05), (0.55, 0.3, -1.05), (0.6, 0.3, -0.7)], 0.016, 10, round_r=0.05)
    mb.tube("M_Steel", [(0.45, -0.3, -1.05), (0.55, -0.3, -1.05), (0.6, -0.3, -0.7)], 0.016, 10, round_r=0.05)
    part("SVC.THM.IHX", "Intercambiador de calor interfaz agua/amoníaco", mb.mesh(), g, explode=(-0.3, 0, -0.6),
         desc="Intercambiador de placas que separa el lazo interno de agua (seguro para la tripulación) del lazo externo de amoníaco.")
    mb = MB("rad_feeds")
    for sgn in (1, -1):
        for dy in (-0.12, 0.12):
            mb.tube("M_Steel", [(0.6, dy, -0.7), (0.3, dy, sgn * 1.2 - (0.3 if sgn > 0 else 0)), (-1.2, dy, sgn * 2.0), (-1.2, dy, sgn * 2.2)], 0.014, 8, round_r=0.2)
    part("SVC.THM.FED", "Líneas de amoníaco hacia los radiadores", mb.mesh(), g, explode=(0, 0, 0),
         desc="Líneas de suministro y retorno hacia las juntas rotativas de los radiadores desplegables.")


def _svc_external(svc):
    g = group("SVC.EXT", "Sensores y equipos exteriores del servicio", svc, explode=("radial", 0.0),
              desc="Rastreadores estelares, sensores solares, terminal óptico, RCS de popa y pasamanos.")
    rc = group("SVC.EXT.RCS", "RCS de popa (4 cuadretes)", g, explode=("radial", 0.0))
    me = rcs_quad_mesh("rcs_quad_aft")
    for i, face in enumerate([1, 3, 5, 7]):
        a = S.oct_angle(face)
        p = part(f"SVC.EXT.RCS.Q{i+1}", f"Cuadrete RCS de popa {i+1}", me, rc, explode=("radial", 1.6),
                 desc="Cuadrete de 5 propulsores bipropelentes.")
        p.matrix_basis = Matrix.Translation(ring_xyz(S.SVC_APOTHEM + 0.045, a, -4.05)) @ Rx(a - PI / 2)
    # rastreadores estelares
    st = group("SVC.EXT.STR", "Rastreadores estelares", g, explode=("radial", 0.0))
    a = S.oct_angle(7)
    for i, (dx, tilt) in enumerate([(-2.75, 0.45), (-3.35, -0.45)]):
        mb = MB(f"star_tracker_{i}")
        mb.box("M_AlAnodBlack", 0.16, 0.16, 0.12, center=(0, 0, 0.06))
        mb.lathe("M_AlAnodBlack", [(0.06, 0.12), (0.085, 0.12), (0.14, 0.38), (0.13, 0.38), (0.08, 0.13), (0.06, 0.13)], 32, axis='Z')
        for k in range(4):
            z = 0.16 + 0.05 * k
            r_ = 0.085 + (0.055) * (z - 0.12) / 0.26
            mb.torus("M_AlAnodBlack", r_ - 0.004, 0.004, 32, 4, center=(0, 0, z), axis='Z')
        mb.cyl("M_Lens", 0.05, 0.05, 0.005, 24, center=(0, 0, 0.125), axis='Z')
        mb.box("M_MLI_Gold", 0.17, 0.17, 0.02, center=(0, 0, 0.11))
        p = part(f"SVC.EXT.STR.ST{i+1}", f"Rastreador estelar {i+1}", mb.mesh(), st, explode=("radial", 0.8),
                 desc="Cámara estelar autónoma con parasol de 4 deflectores; precisión conceptual < 5 arcsec.")
        p.matrix_basis = Matrix.Translation(ring_xyz(S.SVC_APOTHEM + 0.045, a, dx)) @ Rx(a - PI / 2) @ Matrix.Rotation(tilt, 4, 'Y')
    # sensores solares
    ss = MB("sun_sensor")
    ss.box("M_AlAnodBlack", 0.08, 0.08, 0.03, center=(0, 0, 0.015))
    ss.cyl("M_SolarCell", 0.025, 0.025, 0.004, 16, center=(0, 0, 0.032), axis='Z')
    me = ss.mesh()
    for i, face in enumerate([0, 2, 4, 6]):
        a = S.oct_angle(face)
        p = part(f"SVC.EXT.SUN{i+1}", f"Sensor solar grueso {i+1}", me, g, explode=("radial", 0.6),
                 desc="Sensor solar de 4 cuadrantes para adquisición de actitud segura.")
        p.matrix_basis = Matrix.Translation(ring_xyz(S.SVC_APOTHEM + 0.045, a, -4.2)) @ Rx(a - PI / 2)
    # terminal óptico láser
    a = S.oct_angle(3)
    mb = MB("optical_terminal")
    mb.cyl("M_AlBare", 0.16, 0.18, 0.08, 32, center=(0, 0, 0.04), axis='Z')
    mb.cyl("M_AlAnodBlack", 0.12, 0.12, 0.14, 32, center=(0, 0, 0.15), axis='Z')
    mb.box("M_AlAnodBlack", 0.06, 0.30, 0.22, center=(0, 0, 0.30))
    mb.cyl("M_ShieldWhite", 0.10, 0.10, 0.28, 32, center=(0, 0, 0.36), axis='X')
    mb.cyl("M_Lens", 0.085, 0.085, 0.005, 32, center=(0.14, 0, 0.36), axis='X')
    mb.box("M_MLI_Gold", 0.30, 0.26, 0.02, center=(0, 0, 0.09))
    p = part("SVC.EXT.OPT", "Terminal de comunicaciones ópticas", mb.mesh(), g, explode=("radial", 0.9),
             desc="Telescopio de 10 cm en montura de 2 ejes para enlace láser de alta tasa con estaciones terrestres.")
    p.matrix_basis = Matrix.Translation(ring_xyz(S.SVC_APOTHEM + 0.045, a, -3.0)) @ Rx(a - PI / 2)
    hm = handrail_mesh("svc_handrail", 1.6)
    for i, face in enumerate([1, 3, 5, 7]):
        a = S.oct_angle(face)
        p = part(f"SVC.EXT.HR{i+1}", f"Pasamanos EVA de servicio {i+1}", hm, g, explode=("radial", 1.3))
        p.matrix_basis = Matrix.Translation(ring_xyz(S.SVC_APOTHEM + 0.045, a, -0.6 if face != 3 else -1.2)) @ Rx(a)


# ---------------------------------------------------------------------------
# PROPULSIÓN
# ---------------------------------------------------------------------------

def _engine(parent, code, idx, a):
    eg = group(code, f"Motor bipropelente principal {idx}", parent, explode=("radial", 0.9),
               desc="Motor de empuje de clase 400–500 N (MMH/MON-3) refrigerado por radiación. Cuatro unidades permiten tolerar el fallo de una.",
               func="Maniobras impulsivas rápidas (inserción, aborto, correcciones)")
    c = ring_xyz(S.ENGINE_R, a, 0.0)
    y, z = c.y, c.z
    mb = MB(f"{code}_valve")
    mb.box("M_AlAnodBlack", 0.16, 0.20, 0.12, center=(-4.25, y, z))
    for s in (-1, 1):
        mb.cyl("M_Steel", 0.035, 0.035, 0.12, 16, center=(-4.25, y + s * 0.07, z + 0.07), axis='Z')
        mb.cyl("M_GoldPlate", 0.012, 0.012, 0.03, 10, center=(-4.25, y + s * 0.07, z + 0.14), axis='Z')
    part(f"{code}.VLV", "Bloque de válvulas bipropelentes", mb.mesh(), eg, explode=(0.35, 0, 0),
         desc="Válvulas de solenoide dobles en serie para combustible y oxidante.")
    mb = MB(f"{code}_injector")
    lathe_x(mb, "M_Steel", [(0.0, -4.34), (0.09, -4.34), (0.09, -4.44), (0.075, -4.47), (0.0, -4.47)], 32)
    mb.bolts("M_Bolt", bolt_circle((-4.34, y, z), (1, 0, 0), 0.075, 8), 0.007, 0.005)
    p = part(f"{code}.INJ", "Cabeza de inyección", mb.mesh(), eg, explode=(0.2, 0, 0),
             desc="Inyector de impacto de elementos dobletes.")
    p.location = (0, y, z)
    mb = MB(f"{code}_chamber")
    lathe_x(mb, "M_NozzleHot", [(0.0, -4.47), (0.07, -4.47), (0.07, -4.70), (0.045, -4.80), (0.0, -4.80)], 32)
    p = part(f"{code}.CHB", "Cámara de combustión", mb.mesh(), eg, explode=(-0.1, 0, 0),
             desc="Cámara de aleación de platino-iridio/C-103 con recubrimiento de siliciuro.")
    p.location = (0, y, z)
    prof_o, prof_i = [], []
    n = 16
    for k in range(n + 1):
        t = k / n
        x = -4.80 - t * (S.ENGINE_EXIT_X - (-4.80)) * -1
        r = 0.045 + (0.26 - 0.045) * (1 - (1 - t) ** 1.8)
        prof_o.append((r + 0.004, x))
        prof_i.append((r, x))
    mb = MB(f"{code}_nozzle")
    lathe_x(mb, "M_Nozzle", prof_o + list(reversed(prof_i)) + [prof_o[0]], 48)
    lathe_x(mb, "M_NozzleHot", shell_profile(0.049, 0.06, -4.86, -4.80), 32)
    mb.torus("M_Nozzle", 0.266, 0.006, 48, 6, center=(S.ENGINE_EXIT_X, 0, 0), axis='X')
    p = part(f"{code}.NOZ", "Tobera de expansión (C-103)", mb.mesh(), eg, explode=(-0.6, 0, 0),
             desc="Tobera de relación de áreas ~150 en aleación de niobio C-103 con recubrimiento R512E.")
    p.location = (0, y, z)
    mb = MB(f"{code}_mount")
    for k in range(3):
        aa = TAU * k / 3
        p0 = Vector((-4.40, y, z)) + Vector(ring_xyz(0.24, aa, 0))
        p1 = Vector((-4.55, y, z)) + Vector(ring_xyz(0.085, aa, 0))
        mb.tube("M_Titanium", [p0, p1], 0.012, 8)
    mb.torus("M_Titanium", 0.085, 0.012, 24, 6, center=(-4.55, y, z), axis='X')
    part(f"{code}.MNT", "Montante trípode y barrera térmica", mb.mesh(), eg, explode=(0.1, 0, 0),
         desc="Trípode de titanio de baja conductividad que aísla térmicamente el motor de la placa de empuje.")


def _hall_thruster_mesh(name):
    mb = MB(name)
    # eje: empuje hacia -X; construido a lo largo de X local
    lathe_x(mb, "M_HallBody", [(0.0, 0.0), (0.20, 0.0), (0.21, -0.02), (0.21, -0.13), (0.0, -0.13)], 48)
    lathe_x(mb, "M_BoronNitride", [(0.085, -0.13), (0.165, -0.13), (0.165, -0.155), (0.085, -0.155), (0.085, -0.13)], 48)
    lathe_x(mb, "M_HallBody", [(0.0, -0.13), (0.07, -0.13), (0.07, -0.16), (0.0, -0.16)], 32)
    lathe_x(mb, "M_HallBody", [(0.17, -0.13), (0.205, -0.13), (0.205, -0.16), (0.17, -0.16), (0.17, -0.13)], 48)
    for k in range(8):
        a = TAU * k / 8
        mb.cyl("M_Copper", 0.025, 0.025, 0.11, 12, center=ring_xyz(0.185, a, -0.065), axis='X')
    mb.cyl("M_Titanium", 0.025, 0.025, 0.14, 16, center=(-0.12, 0.25, 0.0), axis='X')
    mb.cyl("M_BoronNitride", 0.018, 0.018, 0.02, 12, center=(-0.195, 0.25, 0), axis='X')
    mb.box("M_AlBare", 0.06, 0.08, 0.06, center=(-0.03, 0.24, 0))
    return mb.mesh(smooth=40)


def build_propulsion(root):
    prp = group("PRP", "Bahía de Propulsión", root, explode=(-7.6, 0, 0),
                desc="Placa de empuje, faldón de popa, 4 motores bipropelentes y 2 conjuntos orientables de propulsores Hall.",
                func="Propulsión química de alto empuje + propulsión eléctrica de alto impulso específico")
    st = group("PRP.STR", "Estructura de empuje", prp, explode=(0, 0, 0))
    mb = MB("thrust_plate")
    pts0 = [oct_corner(i, RC - 0.02, S.PRP_X0) for i in range(8)]
    pts1 = [oct_corner(i, RC - 0.02, S.PRP_X0 - 0.05) for i in range(8)]
    mb.poly("M_AlBare", pts1, pts0)
    me = boolean_cut(mb.mesh(), [cutter(0.12, 0.3, ring_xyz(S.ENGINE_R, a, S.PRP_X0 - 0.02), axis='X') for a in (PI / 4, 3 * PI / 4, 5 * PI / 4, 7 * PI / 4)]
                     + [cutter(0.30, 0.3, (S.PRP_X0, 0, 0), axis='X')])
    part("PRP.STR.PLT", "Placa de empuje", me, st, explode=(0.4, 0, 0),
         desc="Placa mecanizada de Al 7075 con aligeramientos y alojamientos de motor.")
    mb = MB("aft_skirt")
    for i in range(8):
        a = S.oct_angle(i)
        b0 = [oct_corner(i - 1, RC - 0.01, S.PRP_X0 - 0.05), oct_corner(i, RC - 0.01, S.PRP_X0 - 0.05)]
        rr = (RC - 0.01) * 0.86
        b1 = [oct_corner(i, rr, S.PRP_X1), oct_corner(i - 1, rr, S.PRP_X1)]
        quad = b0 + b1
        n = Vector(ring_xyz(1, a - HALF, 0)) * 0.012
        mb.poly("M_MLI_Black", quad, [q + n for q in quad])
    part("PRP.STR.SKT", "Faldón de popa con MLI de alta temperatura", mb.mesh(), st, explode=(-0.2, 0, 0),
         desc="Faldón troncopiramidal cubierto con MLI de Kapton negro y capas de níquel para la radiación de las toberas.")
    mb = MB("plume_shield")
    rr = (RC - 0.01) * 0.86
    pts0 = [oct_corner(i, rr, S.PRP_X1) for i in range(8)]
    pts1 = [oct_corner(i, rr, S.PRP_X1 - 0.03) for i in range(8)]
    mb.poly("M_MLI_Black", pts1, pts0)
    me = boolean_cut(mb.mesh(), [cutter(0.25, 0.3, ring_xyz(S.ENGINE_R, a, S.PRP_X1), axis='X') for a in (PI / 4, 3 * PI / 4, 5 * PI / 4, 7 * PI / 4)])
    part("PRP.STR.PSH", "Escudo térmico de popa", me, st, explode=(-0.5, 0, 0),
         desc="Cierre de popa con aislamiento de alta temperatura frente a la radiación de las toberas.")
    eng = group("PRP.ENG", "Motores bipropelentes principales", prp, explode=(0, 0, 0))
    for i, a in enumerate([PI / 4, 3 * PI / 4, 5 * PI / 4, 7 * PI / 4]):
        _engine(eng, f"PRP.ENG.E{i+1}", i + 1, a)
    hall = group("PRP.SEP", "Propulsión eléctrica solar (SEP)", prp, explode=(0, 0, 0),
                 desc="Cuatro propulsores de efecto Hall de clase 6 kW en dos brazos orientables de 2 ejes.",
                 func="Transferencias eficientes de órbita y mantenimiento de órbita (Isp ~ 2000 s, conceptual)")
    me_h = _hall_thruster_mesh("hall_thruster")
    for s, sgn in enumerate((1, -1)):
        side = "babor" if sgn > 0 else "estribor"
        ag = group(f"PRP.SEP.A{s+1}", f"Brazo orientable de propulsores Hall ({side})", hall, explode=(0, sgn * 1.4, 0))
        y0 = sgn * 1.96
        mb = MB(f"hall_gimbal_{s}")
        mb.box("M_AlBare", 0.30, 0.04, 0.30, center=(-4.85, y0, 0))
        mb.cyl("M_AlAnodBlack", 0.10, 0.10, 0.14, 24, center=(-4.85, y0 + sgn * 0.09, 0), axis='Y')
        mb.cyl("M_AlBare", 0.07, 0.07, 0.16, 24, center=(-4.85, y0 + sgn * 0.22, 0), axis='Z')
        part(f"PRP.SEP.A{s+1}.GMB", "Actuador de orientación de 2 ejes", mb.mesh(), ag, explode=(0, sgn * 0.3, 0),
             desc="Mecanismo de orientación (±15°) para alinear el empuje con el centro de masas.")
        mb = MB(f"hall_boom_{s}")
        p0 = Vector((-4.85, y0 + sgn * 0.25, 0))
        p1 = Vector((-5.35, sgn * 2.62, 0))
        mb.tube("M_CFRP", [p0, p1], 0.05, 16)
        mb.box("M_AlBare", 0.06, 0.06, 0.70, center=(-5.38, sgn * 2.62, 0))
        mb.tube("M_Cable", [p0 + Vector((0, 0, 0.07)), p1 + Vector((0, 0, 0.07))], 0.012, 8)
        mb.tube("M_Steel", [p0 + Vector((0, 0, -0.07)), p1 + Vector((0, 0, -0.07))], 0.006, 8)
        part(f"PRP.SEP.A{s+1}.BOM", "Brazo de CFRP y placa portadora", mb.mesh(), ag, explode=(0, sgn * 0.6, 0),
             desc="Brazo tubular con mazo de alta tensión y línea de xenón.")
        for k, zz in enumerate((0.20, -0.20)):
            p = part(f"PRP.SEP.A{s+1}.T{k+1}", f"Propulsor Hall {s*2+k+1}", me_h, ag, loc=(-5.42, sgn * 2.62, zz),
                     explode=(-0.5, sgn * 0.3, zz * 1.5),
                     desc="Propulsor de efecto Hall con apantallamiento magnético, canal de nitruro de boro y cátodo hueco de LaB6.")


# ---------------------------------------------------------------------------
# POTENCIA — alas solares enrollables
# ---------------------------------------------------------------------------

def build_power(root):
    pwr = group("PWR", "Sistema de Potencia Solar", root, explode=(-4.2, 0, 0),
                desc="Dos alas solares enrollables (tipo ROSA) de 4,4 × 16 m con células de triple unión, montadas en mecanismos de orientación SADA.",
                func="Generar ~48 kW al inicio de vida a 1 UA (estimación conceptual)")
    for s, sgn in enumerate((1, -1)):
        side = "babor" if sgn > 0 else "estribor"
        wg = group(f"PWR.W{s+1}", f"Ala solar de {side}", pwr, explode=(0, sgn * 3.2, 0))
        _wing(wg, f"PWR.W{s+1}", sgn)
    return pwr


def _wing(wg, code, sgn):
    xc = S.SADA_X
    y0 = sgn * S.SVC_APOTHEM
    mb = MB(f"{code}_sada")
    mb.cyl("M_AlBare", 0.26, 0.26, 0.03, 40, center=(xc, y0 + sgn * 0.035, 0), axis='Y')
    mb.cyl("M_AlAnodBlack", 0.20, 0.20, 0.22, 40, center=(xc, y0 + sgn * 0.16, 0), axis='Y')
    mb.cyl("M_AlBare", 0.14, 0.14, 0.08, 40, center=(xc, y0 + sgn * 0.31, 0), axis='Y')
    mb.bolts("M_Bolt", bolt_circle((xc, y0 + sgn * 0.05, 0), (0, sgn, 0), 0.23, 12), 0.009, 0.006)
    part(f"{code}.SADA", "Mecanismo de orientación del ala (SADA)", mb.mesh(), wg, explode=(0, sgn * 0.3, 0),
         desc="Actuador de rotación continua con anillos rozantes para transferir potencia; seguimiento solar de 1 eje.")
    mb = MB(f"{code}_yoke")
    ym = y0 + sgn * 0.35
    mb.tube("M_CFRP", [(xc, ym, 0), (xc, sgn * (S.WING_ROOT_Y - 0.25), 0)], 0.07, 16)
    mb.cyl("M_Titanium", 0.09, 0.09, 0.12, 20, center=(xc, sgn * (S.WING_ROOT_Y - 0.28), 0), axis='Y')
    mb.box("M_AlBare", 0.35, 0.10, 0.14, center=(xc, sgn * (S.WING_ROOT_Y - 0.17), 0))
    mb.tube("M_CableOrange", [(xc + 0.06, ym, 0.06), (xc + 0.06, sgn * (S.WING_ROOT_Y - 0.25), 0.06)], 0.015, 8)
    part(f"{code}.YKE", "Mástil y bisagra de despliegue", mb.mesh(), wg, explode=(0, sgn * 0.6, 0),
         desc="Mástil de CFRP con bisagra de despliegue y mazo de potencia de alta tensión.")
    # estructura de raíz
    yr = sgn * S.WING_ROOT_Y
    mb = MB(f"{code}_root")
    mb.box("M_AlBare", S.WING_W + 0.3, 0.12, 0.12, center=(xc, yr - sgn * 0.06, 0))
    mb.cyl("M_AlAnodBlack", 0.10, 0.10, S.WING_W - 0.1, 24, center=(xc, yr - sgn * 0.02, 0.10), axis='X')
    for dx in (-S.WING_W / 2, S.WING_W / 2):
        mb.box("M_AlBare", 0.22, 0.25, 0.22, center=(xc + dx, yr, 0))
    part(f"{code}.ROT", "Estructura de raíz y tambor de manto", mb.mesh(), wg, explode=(0, sgn * 0.9, 0),
         desc="Viga de raíz con los alojamientos de los mástiles y el tambor de recogida del manto.")
    # mástiles enrollables
    bg = group(f"{code}.BMS", "Mástiles enrollables de compuesto", wg, explode=(0, sgn * 1.0, 0))
    for k, dx in enumerate((-S.WING_W / 2, S.WING_W / 2)):
        mb = MB(f"{code}_boom{k}")
        mb.tube("M_CFRP", [(xc + dx, yr, 0), (xc + dx, yr + sgn * S.WING_L, 0)], 0.055, 20)
        mb.box("M_CFRP", 0.008, S.WING_L, 0.03, center=(xc + dx + (0.05 if dx > 0 else -0.05), yr + sgn * S.WING_L / 2, 0))
        part(f"{code}.BMS.B{k+1}", f"Mástil de tubo ranurado {k+1}", mb.mesh(), bg, explode=((0.5 if dx > 0 else -0.5), 0, 0),
             desc="Mástil de tubo ranurado (slit-tube) de CFRP que almacena energía elástica al enrollarse y despliega el ala.")
    # punta
    mb = MB(f"{code}_tip")
    yt = yr + sgn * S.WING_L
    mb.cyl("M_AlBare", 0.13, 0.13, S.WING_W + 0.2, 32, center=(xc, yt, 0), axis='X')
    for dx in (-S.WING_W / 2, S.WING_W / 2):
        mb.cyl("M_AlAnodBlack", 0.16, 0.16, 0.20, 32, center=(xc + dx, yt, 0), axis='X')
    part(f"{code}.TIP", "Mandril de punta", mb.mesh(), wg, explode=(0, sgn * 2.2, 0),
         desc="Mandril sobre el que se enrollan los mástiles y el manto durante el lanzamiento.")
    # manto en segmentos
    mg = group(f"{code}.BLK", "Manto fotovoltaico", wg, explode=(0, 0, 0),
               desc=f"Manto flexible dividido en {S.WING_SEGMENTS} módulos de cadenas de células.")
    segL = S.WING_L / S.WING_SEGMENTS
    wb = S.WING_W - 0.20
    me_seg = None
    for k in range(S.WING_SEGMENTS):
        yc = yr + sgn * (segL * (k + 0.5))
        mb = MB(f"{code}_seg{k}")
        mb.box("M_SolarCell", wb, segL - 0.03, 0.004, center=(0, 0, 0.002))
        mb.box("M_SolarBack", wb, segL - 0.03, 0.002, center=(0, 0, -0.001))
        mb.box("M_Copper", wb, 0.012, 0.0045, center=(0, (segL - 0.03) / 2 - 0.006, 0.0022))
        mb.box("M_SolarBack", 0.02, segL - 0.03, 0.0045, center=(0, 0, 0.0022))
        for dx in (-wb / 2 + 0.01, wb / 2 - 0.01):
            mb.box("M_Kevlar", 0.02, segL - 0.03, 0.005, center=(dx, 0, 0.0))
        part(f"{code}.BLK.S{k+1:02d}", f"Módulo fotovoltaico {k+1:02d}", mb.mesh(smooth=None), mg, loc=(xc, yc, 0),
             explode=(0, sgn * 0.35 * k, 0.18 * ((k % 2) * 2 - 1) * 0),
             desc="Módulo de cadenas de células GaInP/GaAs/Ge (~30 % de eficiencia) sobre Kapton con interconexiones de plata.")
    mb = MB(f"{code}_cables")
    for dx in (-wb / 2, wb / 2):
        mb.tube("M_Steel", [(xc + dx * 0.98, yr, 0.0), (xc + dx * 0.98, yt, 0.0)], 0.003, 6)
    part(f"{code}.TEN", "Cables tensores del manto", mb.mesh(), wg, explode=(0, sgn * 1.2, 0),
         desc="Cables de Vectran que mantienen la tensión del manto.")


# ---------------------------------------------------------------------------
# TÉRMICO — radiadores desplegables
# ---------------------------------------------------------------------------

def build_thermal(root):
    thr = group("THR", "Radiadores Desplegables", root, explode=(-4.2, 0, 0),
                desc="Dos alas de radiador de 3 paneles en el plano XZ, de canto al Sol cuando las alas solares lo siguen (rotación en Y).",
                func="Rechazar al espacio el calor del vehículo con ambas caras (~10 kW, conceptual)")
    for s, sgn in enumerate((1, -1)):
        side = "cenital" if sgn > 0 else "nadiral"
        rg = group(f"THR.R{s+1}", f"Ala de radiador {side}", thr, explode=(0, 0, sgn * 2.6))
        _radiator(rg, f"THR.R{s+1}", sgn)
    return thr


def _radiator(rg, code, sgn):
    x0, x1 = S.RAD_X0, S.RAD_X1
    xm = (x0 + x1) / 2
    L = x0 - x1
    z0 = sgn * S.SVC_APOTHEM
    mb = MB(f"{code}_base")
    mb.box("M_AlBare", L * 0.6, 0.30, 0.04, center=(xm, 0, z0 + sgn * 0.045))
    for dx in (-L * 0.25, L * 0.25):
        mb.box("M_AlBare", 0.16, 0.16, 0.12, center=(xm + dx, 0, z0 + sgn * 0.12))
        mb.cyl("M_AlAnodBlack", 0.06, 0.06, 0.22, 20, center=(xm + dx, 0, sgn * (S.RAD_ROOT_Z - 0.03)), axis='Y')
    mb.cyl("M_Steel", 0.08, 0.08, 0.1, 24, center=(xm, 0, z0 + sgn * 0.12), axis='Z')
    part(f"{code}.BAS", "Base, bisagra raíz y junta rotativa de fluido", mb.mesh(), rg, explode=(0, 0, sgn * 0.3),
         desc="Bisagra de despliegue con amortiguador y junta rotativa de amoníaco.")
    pg = group(f"{code}.PNL", "Paneles radiadores", rg, explode=(0, 0, 0))
    H = S.RAD_PANEL_H
    gap = 0.06
    for k in range(S.RAD_PANELS):
        zc = sgn * (S.RAD_ROOT_Z + gap + k * (H + gap) + H / 2)
        mb = MB(f"{code}_panel{k}")
        mb.box("M_Radiator", L, 0.030, H, center=(0, 0, 0))
        mb.box("M_AlBare", L + 0.02, 0.040, 0.04, center=(0, 0, H / 2))
        mb.box("M_AlBare", L + 0.02, 0.040, 0.04, center=(0, 0, -H / 2))
        mb.box("M_AlBare", 0.04, 0.040, H, center=(L / 2, 0, 0))
        mb.box("M_AlBare", 0.04, 0.040, H, center=(-L / 2, 0, 0))
        # tubos de flujo embebidos (visibles en relieve en ambas caras)
        nt = 16
        for t in range(nt):
            x = -L / 2 + 0.1 + (L - 0.2) * t / (nt - 1)
            for sy in (-1, 1):
                mb.cyl("M_AlBare", 0.006, 0.006, H - 0.08, 6, center=(x, sy * 0.016, 0), axis='Z')
        # colectores
        for sz in (-1, 1):
            mb.cyl("M_Steel", 0.016, 0.016, L - 0.04, 12, center=(0, 0.035, sz * (H / 2 - 0.05)), axis='X')
        part(f"{code}.PNL.P{k+1}", f"Panel radiador {k+1}", mb.mesh(smooth=None), pg, loc=(xm, 0, zc),
             explode=(0, 0, sgn * 0.55 * k + sgn * 0.2),
             desc="Panel sándwich de aluminio con 16 tubos de flujo de amoníaco embebidos y cinta OSR de teflón plateado en ambas caras.")
        if k < S.RAD_PANELS - 1:
            zh = sgn * (S.RAD_ROOT_Z + gap / 2 + (k + 1) * (H + gap) - gap / 2)
            mb = MB(f"{code}_hinge{k}")
            for dx in (-L * 0.35, 0, L * 0.35):
                mb.cyl("M_Steel", 0.025, 0.025, 0.18, 16, center=(xm + dx, 0, zh), axis='X')
                mb.box("M_AlBare", 0.20, 0.05, 0.10, center=(xm + dx, 0, zh))
            mb.tube("M_DuctFlex", [(xm - L * 0.45, 0.05, zh - sgn * 0.12), (xm - L * 0.47, 0.12, zh), (xm - L * 0.45, 0.05, zh + sgn * 0.12)], 0.016, 10, round_r=0.05)
            mb.tube("M_DuctFlex", [(xm + L * 0.45, 0.05, zh - sgn * 0.12), (xm + L * 0.47, 0.12, zh), (xm + L * 0.45, 0.05, zh + sgn * 0.12)], 0.016, 10, round_r=0.05)
            part(f"{code}.HNG{k+1}", f"Bisagras y latiguillos flexibles {k+1}", mb.mesh(), rg, explode=(0, 0.5, sgn * 0.55 * k + sgn * 0.45),
                 desc="Bisagras de muelle con amortiguación y latiguillos flexibles de amoníaco en bucle.")


# ---------------------------------------------------------------------------
# COMUNICACIONES — antena de alta ganancia
# ---------------------------------------------------------------------------

def build_comms(root):
    com = group("COM", "Comunicaciones de Alta Ganancia", root, explode=(-4.2, -1.6, -1.6),
                desc="Antena parabólica de 1,6 m banda X/Ka en mástil orientable de 2 ejes.",
                func="Enlace de alta velocidad con la Red de Espacio Profundo y relés cislunares")
    a = S.oct_angle(5)
    base = Vector(ring_xyz(S.SVC_APOTHEM + 0.045, a, -1.15))
    out = Vector(ring_xyz(1, a, 0))
    mb = MB("hga_base")
    R = out.to_track_quat('Z', 'X').to_matrix().to_4x4()
    mb.cyl("M_AlBare", 0.18, 0.18, 0.04, 32, center=base + out * 0.02, rot=R)
    mb.cyl("M_AlAnodBlack", 0.12, 0.12, 0.18, 32, center=base + out * 0.13, rot=R)
    part("COM.BAS", "Base y actuador de acimut", mb.mesh(), com, explode=(0, 0, 0),
         desc="Actuador de acimut con junta rotativa de RF.")
    tip = base + out * 1.15
    mb = MB("hga_mast")
    mb.tube("M_CFRP", [base + out * 0.22, tip], 0.055, 16)
    mb.tube("M_Cable", [base + out * 0.22 + Vector((0.07, 0, 0)), tip + Vector((0.07, 0, 0))], 0.012, 8)
    part("COM.MST", "Mástil de CFRP", mb.mesh(), com, explode=tuple(out * 0.4),
         desc="Mástil tubular con guía de ondas y mazo de control.")
    mb = MB("hga_gimbal")
    mb.cyl("M_AlAnodBlack", 0.11, 0.11, 0.22, 24, center=tip, axis='X')
    mb.box("M_AlBare", 0.30, 0.10, 0.10, center=tip + out * 0.1)
    part("COM.GMB", "Cardán de elevación", mb.mesh(), com, explode=tuple(out * 0.7),
         desc="Actuador de elevación con codificador absoluto.")
    # plato: apunta hacia -X/abajo-afuera (posición de reposo apuntando a Tierra)
    aim = (Vector((-0.55, 0, 0)) + out).normalized()
    dc = tip + out * 0.20 + aim * 0.15
    Rd = aim.to_track_quat('Z', 'X').to_matrix().to_4x4()
    dg = group("COM.DSH", "Reflector y alimentador", com, explode=tuple(out * 1.1),
               desc="Reflector Cassegrain con subreflector hiperbólico.")
    Rr = 0.80
    f = Rr * Rr / (4 * 0.18)
    prof = []
    n = 16
    for k in range(n + 1):
        r = Rr * k / n
        prof.append((r, r * r / (4 * f)))
    inner = [(r, z - 0.018) for (r, z) in reversed(prof)]
    mb = MB("hga_dish")
    mb.lathe("M_Dish", prof + inner, 64, axis='Z')
    mb.torus("M_AlBare", Rr, 0.012, 64, 6, center=(0, 0, Rr * Rr / (4 * f)), axis='Z')
    for k in range(8):
        aa = TAU * k / 8
        p0 = Vector((0.10 * math.cos(aa), 0.10 * math.sin(aa), -0.03))
        p1 = Vector((0.74 * math.cos(aa), 0.74 * math.sin(aa), 0.74 ** 2 / (4 * f) - 0.035))
        mb.beam("M_CFRP", p0, p1, 0.02, 0.05, up=(0, 0, 1))
    mb.transform(Matrix.Translation(dc) @ Rd, list(mb.bm.verts))
    part("COM.DSH.REF", "Reflector parabólico de Ø1,6 m", mb.mesh(smooth=60), dg, explode=(0, 0, 0),
         desc="Reflector de CFRP con nervios traseros; superficie pintada en blanco térmico.")
    mb = MB("hga_feed")
    mb.lathe("M_AlBare", [(0.0, 0.0), (0.06, 0.0), (0.09, 0.22), (0.07, 0.22), (0.0, 0.05)], 32, axis='Z')
    zs = 0.50
    mb.lathe("M_AlBare", [(0.0, zs + 0.03), (0.13, zs), (0.13, zs - 0.012), (0.0, zs + 0.018)], 32, axis='Z')
    for k in range(3):
        aa = TAU * k / 3
        mb.tube("M_CFRP", [(0.70 * math.cos(aa), 0.70 * math.sin(aa), 0.16), (0.11 * math.cos(aa), 0.11 * math.sin(aa), zs)], 0.008, 8)
    mb.transform(Matrix.Translation(dc) @ Rd, list(mb.bm.verts))
    part("COM.DSH.FED", "Bocina alimentadora y subreflector", mb.mesh(), dg, explode=tuple(aim * 0.6),
         desc="Bocina corrugada de doble banda y subreflector soportado por un trípode de CFRP.")
    return com


# ---------------------------------------------------------------------------
# BRAZO ROBÓTICO
# ---------------------------------------------------------------------------

def build_robot(root):
    rb = group("RBT", "Brazo Robótico de Servicio", root, explode=(0, 0, 3.2),
               desc="Brazo de 7 grados de libertad y ~8 m de alcance, reubicable entre accesorios de agarre. Mostrado en configuración de estiba.",
               func="Captura de cargas libres, servicio de observatorios y soporte a EVA")
    z0 = S.R_S
    x_base = 1.30
    zb = z0 + 0.05
    zt1 = z0 + 0.42
    zt2 = z0 + 0.80
    joints = [
        ("RBT.LEE", "Efector de base (LEE)", (x_base, 0, zb + 0.12), 'Z', 0.17, 0.26, "Efector terminal que fija el brazo a un accesorio de agarre y le suministra potencia y datos."),
        ("RBT.J1", "Articulación de rodillo de hombro", (x_base, 0, zb + 0.35), 'Z', 0.16, 0.20, "Actuador con reductora armónica y freno de seguridad."),
        ("RBT.J2", "Articulación de guiñada de hombro", (x_base, 0, zt1), 'Y', 0.15, 0.30, "Actuador de guiñada."),
        ("RBT.J3", "Articulación de cabeceo de hombro", (x_base + 0.28, 0, zt1), 'Y', 0.15, 0.24, "Actuador de cabeceo."),
        ("RBT.J4", "Articulación de codo", (x_base + 4.10, 0, (zt1 + zt2) / 2), 'Y', 0.16, 0.34, "Actuador de codo de alto par."),
        ("RBT.J5", "Articulación de cabeceo de muñeca", (x_base + 0.62, 0, zt2), 'Y', 0.13, 0.22, "Actuador de muñeca."),
        ("RBT.J6", "Articulación de guiñada de muñeca", (x_base + 0.38, 0, zt2), 'Z', 0.12, 0.20, "Actuador de muñeca."),
        ("RBT.J7", "Articulación de rodillo de muñeca", (x_base + 0.14, 0, zt2), 'X', 0.12, 0.18, "Actuador de muñeca."),
    ]
    jg = group("RBT.JNT", "Articulaciones", rb, explode=(0, 0, 0))
    for code, lbl, c, ax, r, L, desc in joints:
        mb = MB(code.replace(".", "_"))
        mb.cyl("M_ShieldWhite", r, r, L, 32, center=c, axis=ax)
        mb.cyl("M_AlBare", r * 1.05, r * 1.05, 0.03, 32, center=Vector(c) + _axv(ax) * (L / 2 - 0.015), axis=ax)
        mb.cyl("M_AlBare", r * 1.05, r * 1.05, 0.03, 32, center=Vector(c) - _axv(ax) * (L / 2 - 0.015), axis=ax)
        mb.box("M_Graphite", r * 0.8, 0.002 if ax != 'Y' else r * 0.8, r * 0.5, center=Vector(c) + Vector((0, -r if ax != 'Y' else 0, 0)))
        part(code, lbl, mb.mesh(), jg, explode=("auto", 0.5), desc=desc)
    bg = group("RBT.BMS", "Segmentos del brazo", rb, explode=(0, 0, 0))
    mb = MB("arm_boom1")
    p0 = Vector((x_base + 0.42, 0, zt1))
    p1 = Vector((x_base + 3.95, 0, zt1 + 0.05))
    mb.tube("M_CFRP", [p0, p1], 0.095, 24)
    for t in (0.0, 1.0):
        mb.cyl("M_AlBare", 0.11, 0.11, 0.10, 24, center=p0.lerp(p1, t) + (p1 - p0).normalized() * (0.05 if t == 0 else -0.05), axis='X')
    mb.tube("M_Cable", [p0 + Vector((0, 0.1, 0)), p1 + Vector((0, 0.1, 0))], 0.012, 8)
    part("RBT.BMS.B1", "Segmento superior (CFRP)", mb.mesh(), bg, explode=(0, 0, 0.0),
         desc="Tubo de CFRP de Ø0,19 m y 3,5 m con terminales de titanio y mazo integrado.")
    mb = MB("arm_boom2")
    p0 = Vector((x_base + 3.95, 0, zt2 - 0.05))
    p1 = Vector((x_base + 0.75, 0, zt2))
    mb.tube("M_CFRP", [p0, p1], 0.085, 24)
    for t in (0.0, 1.0):
        mb.cyl("M_AlBare", 0.10, 0.10, 0.10, 24, center=p0.lerp(p1, t) + (p1 - p0).normalized() * (0.05 if t == 0 else -0.05), axis='X')
    mb.tube("M_Cable", [p0 + Vector((0, -0.1, 0)), p1 + Vector((0, -0.1, 0))], 0.012, 8)
    part("RBT.BMS.B2", "Segmento inferior (CFRP)", mb.mesh(), bg, explode=(0, 0, 0.6),
         desc="Tubo de CFRP de Ø0,17 m y 3,2 m.")
    mb = MB("arm_ee")
    c = Vector((x_base - 0.05, 0, zt2))
    mb.cyl("M_ShieldWhite", 0.15, 0.15, 0.26, 32, center=c, axis='X')
    mb.cyl("M_AlAnodBlack", 0.13, 0.13, 0.04, 32, center=c + Vector((-0.14, 0, 0)), axis='X')
    for k in range(3):
        aa = TAU * k / 3
        mb.box("M_Steel", 0.06, 0.03, 0.03, center=c + Vector((-0.16, 0.08 * math.cos(aa), 0.08 * math.sin(aa))))
    part("RBT.EE", "Efector terminal de captura", mb.mesh(), rb, explode=(-0.5, 0, 0.3),
         desc="Efector de lazos de cable (snare) con conector de potencia/datos.")
    cg = group("RBT.CAM", "Cámaras y focos del brazo", rb, explode=(0, 0, 0.4))
    cm = camera_mesh("arm_cam")
    for i, (x, zz) in enumerate([(x_base + 3.95, zt2 + 0.22), (x_base + 0.10, zt2 + 0.17)]):
        p = part(f"RBT.CAM.C{i+1}", f"Cámara del brazo {i+1}", cm, cg, explode=(0, 0, 0.3),
                 desc="Cámara en color con zoom y foco integrado.")
        p.matrix_basis = Matrix.Translation((x, 0, zz)) @ Matrix.Rotation(-PI / 2, 4, 'Y')
    mb = MB("arm_restraints")
    for x in (x_base + 1.9, x_base + 3.3):
        mb.box("M_AlBare", 0.20, 0.30, 0.05, center=(x, 0, z0 + 0.03))
        mb.box("M_AlBare", 0.08, 0.06, zt2 - z0 - 0.1, center=(x, 0.16, (zt2 + z0) / 2))
        mb.box("M_AlBare", 0.16, 0.30, 0.04, center=(x, 0.0, zt2 - 0.11))
        mb.box("M_EVAYellow", 0.05, 0.05, 0.05, center=(x, 0.20, zt2 - 0.11))
    part("RBT.RST", "Retenciones de lanzamiento", mb.mesh(), rb, explode=(0, 0.8, -0.3),
         desc="Dos retenciones liberables que sujetan los segmentos del brazo durante el lanzamiento.")
    return rb


def _axv(ax):
    return {'X': Vector((1, 0, 0)), 'Y': Vector((0, 1, 0)), 'Z': Vector((0, 0, 1))}[ax]
