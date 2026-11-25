"""
ALCIÓN HX-4 — densidad interior: etiquetas legibles, señalización, bolsas de carga y
mazos de cables visibles.

Objetivo perceptivo: un interior habitado se reconoce por la información escrita
(etiquetas de inventario en cada taquilla, señalización de seguridad, identificación de
bahías) y por los objetos blandos y los cables que rompen la geometría perfecta. El
atlas de etiquetas lo genera `blender/make_labels.py` (rejilla de 8 × 16 celdas 4:1).
"""
import math
import os
import random
import zlib
import bpy
from mathutils import Matrix, Vector
from .lib import group, part, MB
from . import materials as _mats

TEX = os.path.join(os.path.dirname(os.path.dirname(__file__)), "textures")
COLS, ROWS = 8, 16


def label_mat():
    MATS = _mats.MATS
    if "M_Label" in MATS:
        return MATS["M_Label"]
    m = bpy.data.materials.new("M_Label")
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes.get("Principled BSDF")
    img = bpy.data.images.load(os.path.join(TEX, "labels_atlas.png"))
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    tex.interpolation = 'Smart'
    nt.links.new(tex.outputs["Color"], b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = 0.6
    m["desc"] = "Etiquetas impresas de poliéster laminado (atlas legible)"
    MATS["M_Label"] = m
    return m


def cell_uv(cell):
    c, r = cell % COLS, cell // COLS
    return c / COLS, 1 - (r + 1) / ROWS, (c + 1) / COLS, 1 - r / ROWS


def apply_label_uv(me, cells, flip=False):
    """Asigna a cada cara frontal (+Z local) de material M_Label la celda del atlas que le toca.
    `cells` se consume en orden de las etiquetas (agrupadas por cercanía en X/Y)."""
    if "M_Label" not in [m.name for m in me.materials]:
        return
    mi = [m.name for m in me.materials].index("M_Label")
    uv = me.uv_layers.active.data
    faces = [p for p in me.polygons if p.material_index == mi]
    # agrupar caras por etiqueta (centro de la etiqueta ≈ centro de la cara frontal)
    fronts = [p for p in faces if p.normal.z > 0.9]
    fronts.sort(key=lambda p: (round(p.center.y, 2), p.center.x))
    for k, p in enumerate(fronts):
        u0, v0, u1, v1 = cell_uv(cells[k % len(cells)])
        xs = [me.vertices[i].co.x for i in p.vertices]
        ys = [me.vertices[i].co.y for i in p.vertices]
        x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
        for li in p.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            fx = (co.x - x0) / max(1e-6, x1 - x0)
            fy = (co.y - y0) / max(1e-6, y1 - y0)
            if flip:  # paredes cuyo eje local Y apunta hacia abajo para el observador (estribor, techo)
                fx, fy = 1 - fx, 1 - fy
            uv[li].uv = (u0 + fx * (u1 - u0) * 0.98 + (u1 - u0) * 0.01, v0 + fy * (v1 - v0) * 0.96 + (v1 - v0) * 0.02)
    # caras laterales de la etiqueta: color del borde de la celda
    for p in faces:
        if p.normal.z > 0.9:
            continue
        u0, v0, u1, v1 = cell_uv(cells[0])
        for li in p.loop_indices:
            uv[li].uv = (u0 + 0.002, v0 + 0.002)


def labeled_locker_mesh(w, h, cell, flip=False):
    """Taquilla con etiqueta de inventario legible (celda `cell` del atlas)."""
    label_mat()
    mb = MB(f"locker_{w:.2f}_{h:.2f}_L{cell}{'f' if flip else ''}")
    mb.box("M_InteriorPanel", w - 0.012, h - 0.012, 0.022, center=(0, 0, 0.011))
    mb.box("M_InteriorGrey", w - 0.06, 0.035, 0.012, center=(0, -h / 2 + 0.045, 0.028))  # tirador
    for x in (-w / 2 + 0.03, w / 2 - 0.03):
        mb.cyl("M_Steel", 0.008, 0.008, 0.006, 10, center=(x, h / 2 - 0.03, 0.025), axis='Z')
    lw = min(0.30, w * 0.66)
    ly = (h / 2 - 0.07) * (-1 if flip else 1)   # siempre en la parte superior vista por el tripulante
    mb.box("M_Label", lw, lw / 4, 0.0012, center=(0.0, ly, 0.0226))
    me = mb.mesh(smooth=None, bevel=0.003)
    apply_label_uv(me, [cell], flip)
    return me


def cell_for(code):
    return zlib.crc32(code.encode()) % 96


# ---------------------------------------------------------------------------
# Señalización, placas y objetos de densidad
# ---------------------------------------------------------------------------

def sign_mesh(cell, w=0.30, backing=True, flip=False):
    label_mat()
    mb = MB(f"sign_{cell}_{w:.2f}{'f' if flip else ''}")
    if backing:
        mb.box("M_InteriorGrey", w + 0.012, w / 4 + 0.012, 0.003, center=(0, 0, 0.0015))
    mb.box("M_Label", w, w / 4, 0.0012, center=(0, 0, 0.0036))
    me = mb.mesh(smooth=None)
    apply_label_uv(me, [cell], flip)
    return me


FLIP_WALLS = ("stbd", "ceil")

SIGN = {name: 96 + i for i, name in enumerate([
    "EXTINTOR", "PBA", "AUXILIOS", "SALIDA_NODO", "PROA", "POPA", "NO_PISAR", "CALIENTE",
    "TENSION", "AGUA", "AGUA_GRIS", "O2", "N2", "BAY_A", "BAY_B", "BAY_C",
    "BAY_D", "NODO", "ESCLUSA", "CIERRE", "ANCLAJE", "LIBRE", "CO2", "VENT",
    "ALCION", "T1", "T2", "T3", "T4", "CRIO", "GUANTERA", "ASIDERO"])}


def ctb_mesh(seed, sx, sy, sz):
    """Bolsa de transferencia de carga: caja blanda con costuras, asas y ventana de etiqueta."""
    label_mat()
    rnd = random.Random(seed)
    mb = MB(f"ctb_{seed}")
    mb.box("M_Fabric", sx, sy, sz, center=(0, 0, sz / 2))
    # costuras/ribetes en las aristas superiores
    for y in (-sy / 2, sy / 2):
        mb.box("M_FabricBlue" if seed % 3 == 0 else "M_InteriorDark", sx + 0.004, 0.012, 0.012, center=(0, y, sz))
    for x in (-sx / 2, sx / 2):
        mb.box("M_FabricBlue" if seed % 3 == 0 else "M_InteriorDark", 0.012, sy + 0.004, 0.012, center=(x, 0, sz))
    # asas de cinta
    for x in (-sx * 0.25, sx * 0.25):
        mb.tube("M_InteriorDark", [(x, -0.03, sz), (x, -0.02, sz + 0.035), (x, 0.02, sz + 0.035), (x, 0.03, sz)], 0.008, 6)
    # bolsillo de etiqueta
    mb.box("M_GlassInner", min(0.2, sx * 0.6) + 0.01, min(0.2, sx * 0.6) / 4 + 0.01, 0.001, center=(0, sy / 2 + 0.0006, sz * 0.55), rot=Matrix.Rotation(math.pi / 2, 4, 'X'))
    me = mb.mesh(smooth=30, bevel=0.012)
    return me


def ctb_label_mesh(seed, sx, sz):
    label_mat()
    mb = MB(f"ctb_lbl_{seed}")
    lw = min(0.2, sx * 0.6)
    mb.box("M_Label", lw, lw / 4, 0.001, center=(0, 0, 0))
    me = mb.mesh(smooth=None)
    apply_label_uv(me, [seed % 96])
    return me


def cable_run_mesh(length, seed):
    """Mazo de cables y tubos con abrazaderas cada 0,45 m (dirección +X local)."""
    rnd = random.Random(seed)
    mb = MB(f"cable_run_{seed}_{length:.2f}")
    mats = ["M_Cable", "M_CableOrange", "M_CableWhite", "M_Cable", "M_DuctFlex"]
    n = 5
    for k in range(n):
        y = -0.03 + 0.015 * k
        z = 0.012 + (k % 2) * 0.012
        r = 0.006 if mats[k] != "M_DuctFlex" else 0.011
        pts = []
        steps = max(4, int(length / 0.15))
        for i in range(steps + 1):
            x = -length / 2 + length * i / steps
            sag = 0.004 * math.sin(i * 1.7 + k + seed)  # pequeña irregularidad entre abrazaderas
            pts.append((x, y + sag * 0.5, z + sag))
        mb.tube(mats[k % len(mats)], pts, r, 8)
    nc = max(2, int(length / 0.45))
    for i in range(nc + 1):
        x = -length / 2 + length * i / nc
        mb.box("M_AlBare", 0.018, 0.09, 0.006, center=(x, 0, 0.003))
        mb.tube("M_AlBare", [(x, -0.045, 0.003), (x, -0.045, 0.04), (x, 0.045, 0.04), (x, 0.045, 0.003)], 0.003, 6)
    return mb.mesh(smooth=40)


def build_density(hab):
    from .interior import wall_matrix, XS, A2
    label_mat()
    g = group("HAB.INT.DEN", "Señalización, carga y cableado visible", hab, explode=(0, 0, -7.5),
              desc="Etiquetado legible, señalización de seguridad, bolsas de transferencia de carga sujetas con cintas y mazos de cables en las esquinas del pasillo.",
              func="Habitabilidad, orientación y seguridad")
    rnd = random.Random(2026)
    bayx = {"A": (XS[3] + XS[4]) / 2, "B": (XS[2] + XS[3]) / 2, "C": (XS[1] + XS[2]) / 2, "D": (XS[0] + XS[1]) / 2}
    # --- placas de bahía y señalización (sobre los postes frontales de los bastidores de techo)
    gs = group("HAB.INT.DEN.SGN", "Señalización", g, explode=("axial", 1.0))
    signs = [
        ("A", "ceil", 0.0, 0.0, "BAY_A", 0.42), ("B", "ceil", 0.0, 0.0, "BAY_B", 0.42),
        ("C", "ceil", 0.0, 0.0, "BAY_C", 0.42), ("D", "ceil", 0.0, 0.0, "BAY_D", 0.42),
        ("A", "port", -0.46, 0.92, "EXTINTOR", 0.26), ("D", "stbd", 0.46, 0.92, "EXTINTOR", 0.26),
        ("A", "stbd", -0.46, 0.92, "PBA", 0.26), ("C", "port", 0.46, 0.92, "PBA", 0.26),
        ("C", "stbd", -0.46, 0.92, "AUXILIOS", 0.26), ("A", "port", 0.46, -0.95, "SALIDA_NODO", 0.3),
        ("B", "port", 0.0, -0.95, "PROA", 0.24), ("C", "stbd", 0.0, -0.95, "POPA", 0.24),
        ("D", "port", -0.46, -0.95, "AGUA", 0.24), ("D", "port", -0.46, -0.80, "AGUA_GRIS", 0.24),
        ("B", "stbd", -0.46, 0.92, "TENSION", 0.26), ("D", "deck", 0.46, 0.85, "NO_PISAR", 0.26),
        ("B", "ceil", -0.46, 0.85, "VENT", 0.26), ("C", "ceil", 0.46, -0.85, "CO2", 0.22),
    ]
    for k, (bay, wall, dx, yy, key, w) in enumerate(signs):
        W = wall_matrix(wall, bayx[bay] + dx)
        n = W.to_3x3() @ Vector((0, 0, 1))
        p = part(f"HAB.INT.DEN.SGN.S{k+1:02d}", f"Señal: {key.replace('_', ' ').lower()}", sign_mesh(SIGN[key], w, flip=wall in FLIP_WALLS), gs,
                 explode=tuple(n * 0.2), desc="Señal de poliéster laminado con adhesivo; texto legible.")
        p.matrix_basis = W @ Matrix.Translation((0, yy, 0.052)) @ Matrix.Rotation(rnd.uniform(-0.012, 0.012), 4, 'Z')
        p["inspect"] = True
    # --- bolsas de transferencia de carga (CTB) sujetas en techos y suelos
    gb = group("HAB.INT.DEN.CTB", "Bolsas de transferencia de carga", g, explode=("axial", 1.5))
    k = 0
    for bay, wall, dx, yy in [("A", "ceil", -0.30, -0.55), ("B", "ceil", 0.25, -0.55), ("B", "deck", -0.35, -0.70),
                              ("C", "ceil", -0.25, 0.50), ("C", "deck", 0.30, 0.72), ("D", "ceil", 0.30, -0.55),
                              ("D", "ceil", -0.35, 0.55), ("A", "deck", 0.10, 0.72)]:
        sx, sy, sz = rnd.choice([(0.42, 0.25, 0.24), (0.50, 0.42, 0.25), (0.25, 0.42, 0.24)])
        W = wall_matrix(wall, bayx[bay] + dx)
        n = W.to_3x3() @ Vector((0, 0, 1))
        rot = Matrix.Rotation(rnd.uniform(-0.12, 0.12), 4, 'Z')
        base = W @ Matrix.Translation((0, yy, 0.03)) @ rot
        p = part(f"HAB.INT.DEN.CTB.B{k+1:02d}", "Bolsa de transferencia de carga", ctb_mesh(k, sx, sy, sz), gb,
                 explode=tuple(n * 0.3), desc="Bolsa de Nomex con ribetes, asas de cinta y ventana de etiqueta; sujeta con cintas elásticas.")
        p.matrix_basis = base
        p["inspect"] = True
        lp = part(f"HAB.INT.DEN.CTB.B{k+1:02d}.LBL", "Etiqueta de inventario de la bolsa", ctb_label_mesh(7 + k * 11, sx, sz), gb,
                  explode=tuple(n * 0.3))
        lp.matrix_basis = base @ Matrix.Translation((0, sy / 2 + 0.002, sz * 0.55)) @ Matrix.Rotation(-math.pi / 2, 4, 'X') @ Matrix.Rotation(math.pi, 4, 'Z')
        # cinta elástica de sujeción
        mb = MB(f"ctb_strap_{k}")
        mb.tube("M_InteriorDark", [(-sx / 2 - 0.02, 0, 0.0), (-sx / 2, 0, sz + 0.008), (sx / 2, 0, sz + 0.008), (sx / 2 + 0.02, 0, 0.0)], 0.006, 6)
        sp = part(f"HAB.INT.DEN.CTB.B{k+1:02d}.STR", "Cinta elástica de sujeción", mb.mesh(smooth=40), gb, explode=tuple(n * 0.32))
        sp.matrix_basis = base
        k += 1
    # --- mazos de cables en las cuatro esquinas del pasillo (zona de standoffs)
    gc = group("HAB.INT.DEN.CBL", "Mazos de cables y tubos visibles", g, explode=("radial", 1.0))
    x0, x1 = XS[0] + 0.15, XS[4] - 0.15
    L = x1 - x0
    for j, (sy, sz) in enumerate([(1, 1), (1, -1), (-1, 1), (-1, -1)]):
        # en la esquina, a 45°, mirando al centro del pasillo
        c = Vector(((x0 + x1) / 2, sy * (A2 - 0.02), sz * (A2 - 0.02)))
        ang = math.atan2(-sz, -sy)
        M = Matrix.Translation(c) @ Matrix.Rotation(ang - math.pi / 2, 4, 'X')
        p = part(f"HAB.INT.DEN.CBL.R{j+1}", "Mazo de cables y tubos de la esquina", cable_run_mesh(L, j), gc,
                 explode=(0, sy * 0.3, sz * 0.3), desc="Cables de potencia y datos y tubo flexible de ventilación con abrazaderas cada 0,45 m.")
        p.matrix_basis = M
    return g
