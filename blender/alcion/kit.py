"""
ALCIÓN HX-4 · REBIRTH — kit de modelado hard-surface y superficies blandas.

Primitivas pensadas para producir siluetas creíbles en tiempo real:
- prismas a partir de perfiles 2D con esquinas redondeadas (fileteado real, no normal maps),
- paneles de revolución con juntas (reveals) y biseles,
- cojines y tapizados con volumen (cajas subdivididas y "infladas"),
- superficies tejidas con pliegues procedurales deterministas.
Todo se acumula en un MB (bmesh multimaterial) del paquete alcion.lib.
"""
import math
import random
import bmesh
from mathutils import Vector, Matrix, noise
from .lib import MB, TAU

PI = math.pi


# ---------------------------------------------------------------- perfiles 2D
def fillet(points, radius, seg=4):
    """Redondea las esquinas de un polígono 2D cerrado. radius: escalar o lista por vértice."""
    n = len(points)
    out = []
    for i in range(n):
        p0, p1, p2 = Vector(points[i - 1]), Vector(points[i]), Vector(points[(i + 1) % n])
        r = radius[i] if isinstance(radius, (list, tuple)) else radius
        d0, d1 = (p0 - p1), (p2 - p1)
        l0, l1 = d0.length, d1.length
        if r <= 1e-6 or l0 < 1e-6 or l1 < 1e-6:
            out.extend([tuple(p1)] * (seg + 1) if r > 1e-6 else [tuple(p1)])
            continue
        d0.normalize(); d1.normalize()
        ang = math.acos(max(-1.0, min(1.0, d0.dot(d1))))
        if ang < 1e-3 or abs(ang - PI) < 1e-3:
            out.extend([tuple(p1)] * (seg + 1))
            continue
        t = min(r / math.tan(ang / 2), l0 * 0.49, l1 * 0.49)
        a, b = p1 + d0 * t, p1 + d1 * t
        # curva de Bézier cuadrática a, p1, b (suficiente y estable)
        for k in range(seg + 1):
            u = k / seg
            q = a * (1 - u) ** 2 + p1 * 2 * u * (1 - u) + b * u * u
            out.append((q.x, q.y))
    return out


def rrect(w, h, r, seg=4, cx=0.0, cy=0.0):
    pts = [(cx - w / 2, cy - h / 2), (cx + w / 2, cy - h / 2), (cx + w / 2, cy + h / 2), (cx - w / 2, cy + h / 2)]
    return fillet(pts, r, seg)


def _orient(poly):
    a = 0.0
    for i in range(len(poly)):
        x0, y0 = poly[i - 1]
        x1, y1 = poly[i]
        a += x0 * y1 - x1 * y0
    return poly if a > 0 else list(reversed(poly))


def prism(mb, mat, poly, d0, d1, axis='X', M=None):
    """Extruye un polígono 2D a lo largo de un eje.
    axis 'X': poly en (y,z), 'Y': poly en (x,z), 'Z': poly en (x,y)."""
    poly = _orient(poly)
    bm = mb.bm

    def P(u, v, d):
        if axis == 'X':
            p = Vector((d, u, v))
        elif axis == 'Y':
            p = Vector((u, d, v))
        else:
            p = Vector((u, v, d))
        return M @ p if M is not None else p
    a = [bm.verts.new(P(u, v, d0)) for u, v in poly]
    b = [bm.verts.new(P(u, v, d1)) for u, v in poly]
    n = len(poly)
    fs = [bm.faces.new(list(reversed(a))), bm.faces.new(b)]
    for i in range(n):
        j = (i + 1) % n
        fs.append(bm.faces.new((a[i], a[j], b[j], b[i])))
    idx = mb.mi(mat)
    for f in fs:
        f.material_index = idx
    return a + b


def loft(mb, mat, sections, closed=True, cap=True):
    """Une secciones 3D (listas de Vector de igual longitud) en una superficie/sólido."""
    bm = mb.bm
    rings = [[bm.verts.new(p) for p in s] for s in sections]
    idx = mb.mi(mat)
    n = len(sections[0])
    for r in range(len(rings) - 1):
        A, B = rings[r], rings[r + 1]
        for i in range(n if closed else n - 1):
            j = (i + 1) % n
            f = bm.faces.new((A[i], A[j], B[j], B[i]))
            f.material_index = idx
    if cap and closed:
        for R, rev in ((rings[0], True), (rings[-1], False)):
            f = bm.faces.new(list(reversed(R)) if rev else R)
            f.material_index = idx
    return [v for R in rings for v in R]


def arc_panel(mb, mat, r_in, r_out, a0, a1, x0, x1, seg=8):
    """Sector cilíndrico macizo alrededor de X (a desde +Y hacia +Z)."""
    pts = []
    for i in range(seg + 1):
        a = a0 + (a1 - a0) * i / seg
        pts.append((r_out * math.cos(a), r_out * math.sin(a)))
    for i in range(seg, -1, -1):
        a = a0 + (a1 - a0) * i / seg
        pts.append((r_in * math.cos(a), r_in * math.sin(a)))
    return prism(mb, mat, pts, x0, x1, 'X')


def cone_frustum_panel(mb, mat, x0, r0, x1, r1, a0, a1, t, seg=8):
    """Panel macizo sobre un tronco de cono alrededor de X."""
    secs = []
    for x, r in ((x0, r0), (x1, r1)):
        s = []
        for i in range(seg + 1):
            a = a0 + (a1 - a0) * i / seg
            s.append(Vector((x, r * math.cos(a), r * math.sin(a))))
        for i in range(seg, -1, -1):
            a = a0 + (a1 - a0) * i / seg
            s.append(Vector((x, (r + t) * math.cos(a), (r + t) * math.sin(a))))
        secs.append(s)
    return loft(mb, mat, secs)


# ---------------------------------------------------------------- superficies blandas
def cushion(mb, mat, sx, sy, sz, center=(0, 0, 0), R=None, puff=0.012, round_=0.04, sub=3, seed=0, wrinkle=0.0):
    """Cojín: caja redondeada subdividida con abombado en las caras grandes y arrugas suaves."""
    bm2 = bmesh.new()
    bmesh.ops.create_cube(bm2, size=1.0)
    bmesh.ops.scale(bm2, vec=(sx, sy, sz), verts=bm2.verts)
    bmesh.ops.bevel(bm2, geom=list(bm2.edges), offset=min(round_, min(sx, sy, sz) * 0.45), offset_type='OFFSET',
                    segments=3, profile=0.55, affect='EDGES', clamp_overlap=True)
    bmesh.ops.subdivide_edges(bm2, edges=list(bm2.edges), cuts=sub, use_grid_fill=True)
    rnd = random.Random(seed)
    off = Vector((rnd.random() * 10, rnd.random() * 10, rnd.random() * 10))
    hx, hy, hz = sx / 2, sy / 2, sz / 2
    for v in bm2.verts:
        p = v.co
        # abombado: desplazamiento máximo en el centro de cada cara
        fx = 1 - min(1.0, (p.y / hy) ** 2) * 0.0
        k = (1 - (p.x / hx) ** 2) * (1 - (p.y / hy) ** 2)
        k = max(0.0, k)
        if abs(p.z) > hz * 0.6:
            p.z += math.copysign(puff * k, p.z)
        if wrinkle > 0:
            nz = noise.noise(p * 9.0 + off)
            p += v.normal * nz * wrinkle
    if R is not None:
        bmesh.ops.transform(bm2, matrix=R, verts=bm2.verts)
    bmesh.ops.translate(bm2, vec=Vector(center), verts=bm2.verts)
    me_tmp = __import__("bpy").data.meshes.new("_cush")
    bm2.to_mesh(me_tmp)
    bm2.free()
    before = set(mb.bm.verts)
    mb.bm.from_mesh(me_tmp)
    __import__("bpy").data.meshes.remove(me_tmp)
    vs = [v for v in mb.bm.verts if v not in before]
    return mb.tag(vs, mat)


def draped_sheet(mb, mat, w, h, cols, rows, M, folds=0.03, seed=1, thickness=0.006, sag=0.0):
    """Lámina de tejido con pliegues verticales y caída (cortinas, sacos de dormir)."""
    bm = mb.bm
    rnd = random.Random(seed)
    ph = [rnd.random() * TAU for _ in range(4)]
    grid = []
    for j in range(rows + 1):
        row = []
        for i in range(cols + 1):
            u, v = i / cols, j / rows
            x = (u - 0.5) * w
            y = (v - 0.5) * h
            z = folds * (math.sin(u * TAU * 3.0 + ph[0]) * 0.6 + math.sin(u * TAU * 7.3 + ph[1] + v * 2) * 0.25) * (0.55 + 0.45 * v)
            z += sag * math.sin(PI * u) * math.sin(PI * v)
            z += 0.004 * noise.noise(Vector((x * 6, y * 6, seed)))
            row.append(M @ Vector((x, y, z)))
        grid.append(row)
    top = [[bm.verts.new(p) for p in r] for r in grid]
    idx = mb.mi(mat)
    nrm = (M.to_3x3() @ Vector((0, 0, 1))).normalized()
    bot = [[bm.verts.new(p - nrm * thickness) for p in r] for r in grid]
    for j in range(rows):
        for i in range(cols):
            f = bm.faces.new((top[j][i], top[j][i + 1], top[j + 1][i + 1], top[j + 1][i])); f.material_index = idx
            f = bm.faces.new((bot[j][i], bot[j + 1][i], bot[j + 1][i + 1], bot[j][i + 1])); f.material_index = idx
    for j in range(rows):
        for i in (0, cols):
            a, b, c, d = top[j][i], top[j + 1][i], bot[j + 1][i], bot[j][i]
            f = bm.faces.new((a, b, c, d) if i == 0 else (a, d, c, b)); f.material_index = idx
    for i in range(cols):
        for j in (0, rows):
            a, b, c, d = top[j][i], top[j][i + 1], bot[j][i + 1], bot[j][i]
            f = bm.faces.new((a, d, c, b) if j == 0 else (a, b, c, d)); f.material_index = idx


def strap(mb, mat, pts, w=0.035, t=0.003, up=(0, 0, 1)):
    """Cinta plana (arnés, sujeción) a lo largo de una polilínea."""
    up = Vector(up)
    secs = []
    for k, p in enumerate(pts):
        p = Vector(p)
        d = (Vector(pts[min(k + 1, len(pts) - 1)]) - Vector(pts[max(k - 1, 0)])).normalized()
        s = d.cross(up)
        if s.length < 1e-4:
            s = d.orthogonal()
        s.normalize()
        n = s.cross(d).normalized()
        secs.append([p - s * w / 2 - n * t / 2, p + s * w / 2 - n * t / 2, p + s * w / 2 + n * t / 2, p - s * w / 2 + n * t / 2])
    return loft(mb, mat, secs)


def place(mb, verts, M):
    bmesh.ops.transform(mb.bm, matrix=M, verts=list(set(verts)))


def rot_to(fwd, up=(0, 0, 1)):
    """Matriz 4x4 que lleva +X local a fwd y +Z local hacia up."""
    f = Vector(fwd).normalized()
    u = Vector(up)
    s = u.cross(f).normalized()
    u = f.cross(s).normalized()
    return Matrix((f, s, u)).transposed().to_4x4()


# ---------------------------------------------------------------- detalles técnicos aeroespaciales
def beveled_frame(mb, mat, w, h, border, depth, M=None):
    """Marco rectangular hueco en el plano YZ local (+X normal, Y anchura, Z altura)."""
    vs = []
    iw = max(0.004, w - 2 * border)
    ih = max(0.004, h - 2 * border)
    # 4 listones perimetrales
    vs += mb.box(mat, depth, w, border, center=(0, 0, h / 2 - border / 2))
    vs += mb.box(mat, depth, w, border, center=(0, 0, -h / 2 + border / 2))
    vs += mb.box(mat, depth, border, ih, center=(0, -w / 2 + border / 2, 0))
    vs += mb.box(mat, depth, border, ih, center=(0, w / 2 - border / 2, 0))
    if M is not None:
        place(mb, vs, M)
    return vs


def louver_grille(mb, mat_frame, mat_slat, w, h, depth=0.012, slats=5, M=None):
    """Rejilla de ventilación ranurada en plano YZ mirando hacia +X."""
    vs = []
    b = min(w, h) * 0.12
    b = max(0.006, min(0.014, b))
    vs += beveled_frame(mb, mat_frame, w, h, b, depth)
    vs += mb.box("R_Black", depth * 0.35, w - 2 * b, h - 2 * b, center=(-depth * 0.25, 0, 0))
    ih = h - 2 * b
    iw = w - 2 * b
    Rslat = Matrix.Rotation(math.radians(28), 4, 'Y')
    for k in range(slats):
        z = -ih / 2 + ih * (k + 0.5) / slats
        vs += mb.box(mat_slat, depth * 0.85, iw - 0.002, 0.003, center=(depth * 0.08, 0, z), rot=Rslat)
    if M is not None:
        place(mb, vs, M)
    return vs


def gauge(mb, center, normal, radius=0.032, up=(0, 0, 1)):
    """Manómetro analógico aeroespacial orientado con esfera hacia `normal`."""
    M = Matrix.Translation(Vector(center)) @ rot_to(normal, up=up)
    vs = []
    vs += mb.cyl("R_Frame", radius, radius, 0.016, 16, center=(0.008, 0, 0), axis='X')
    vs += mb.torus("R_Alu", radius * 0.94, radius * 0.10, 18, 6, center=(0.016, 0, 0), axis='X')
    vs += mb.cyl("R_Dial", radius * 0.86, radius * 0.86, 0.004, 16, center=(0.0155, 0, 0), axis='X')
    # aguja y centro
    vs += mb.box("R_Accent", 0.003, radius * 0.65, radius * 0.09, center=(0.0185, radius * 0.16, radius * 0.16),
                 rot=Matrix.Rotation(math.radians(42), 4, 'X'))
    vs += mb.cyl("R_Black", radius * 0.14, radius * 0.14, 0.005, 10, center=(0.0185, 0, 0), axis='X')
    place(mb, vs, M)
    return vs


def knob(mb, mat_body, mat_cap, center, normal, r=0.012, h=0.014, up=(0, 0, 1)):
    """Selector rotativo con arandela base e indicador."""
    M = Matrix.Translation(Vector(center)) @ rot_to(normal, up=up)
    vs = []
    vs += mb.cyl("R_Alu", r * 1.18, r * 1.18, 0.003, 12, center=(0.0015, 0, 0), axis='X')
    vs += mb.cyl(mat_body, r, r * 0.92, h, 12, center=(0.003 + h / 2, 0, 0), axis='X')
    vs += mb.box(mat_cap, 0.004, r * 0.28, r * 0.95, center=(0.003 + h + 0.001, 0, r * 0.12))
    place(mb, vs, M)
    return vs


def buckle(mb, M, w=0.044, h=0.032, t=0.010):
    """Hebilla de liberación rápida con cuerpo metálico y pulsador bermellón."""
    vs = []
    vs += mb.box("R_Frame", t, w, h, center=(0, 0, 0))
    vs += mb.box("R_Alu", t * 1.15, w * 0.82, h * 0.22, center=(0, 0, h * 0.34))
    vs += mb.box("R_Alu", t * 1.15, w * 0.82, h * 0.22, center=(0, 0, -h * 0.34))
    vs += mb.box("R_Accent", t * 1.25, w * 0.44, h * 0.44, center=(t * 0.12, 0, 0))
    if M is not None:
        place(mb, vs, M)
    return vs


def bolt_ring(mb, mat, center, normal, radius, count, r_head=0.006, h=0.004, phase=0.0):
    """Anillo de tornillos hexagonales ligeros orientados según `normal`."""
    n = Vector(normal).normalized()
    ref = Vector((0, 0, 1)) if abs(n.z) < 0.9 else Vector((1, 0, 0))
    u = n.cross(ref).normalized()
    v = n.cross(u).normalized()
    c = Vector(center)
    R = n.to_track_quat('Z', 'Y').to_matrix().to_4x4()
    vs = []
    for k in range(count):
        a = phase + TAU * k / count
        p = c + (u * math.cos(a) + v * math.sin(a)) * radius + n * (h * 0.5)
        vs += mb.cyl(mat, r_head, r_head, h, 6, center=p, rot=R)
    return vs


def pipe_bundle(mb, mats, pts_list, radii, clamps=4, clamp_mat="R_Alu"):
    """Mazo de tuberías/cables con bridas metálicas distribuidas a lo largo de la trayectoria."""
    vs = []
    for mat, pts, r in zip(mats, pts_list, radii):
        vs += mb.tube(mat, pts, r, seg=8, round_r=0.06)
    if clamps > 0 and pts_list:
        ref_pts = [Vector(p) for p in pts_list[0]]
        if len(ref_pts) >= 2:
            # calcula longitud acumulada
            lens = [0.0]
            for i in range(1, len(ref_pts)):
                lens.append(lens[-1] + (ref_pts[i] - ref_pts[i - 1]).length)
            total = lens[-1]
            if total > 1e-4:
                r_max = max(radii)
                for k in range(clamps):
                    target = total * (k + 0.5) / clamps
                    for i in range(len(ref_pts) - 1):
                        if lens[i] <= target <= lens[i + 1]:
                            u = (target - lens[i]) / max(1e-6, lens[i + 1] - lens[i])
                            c_sum = Vector((0, 0, 0))
                            for pts in pts_list:
                                p_a = Vector(pts[min(i, len(pts) - 1)])
                                p_b = Vector(pts[min(i + 1, len(pts) - 1)])
                                c_sum += p_a.lerp(p_b, u)
                            c_avg = c_sum / len(pts_list)
                            t_dir = (ref_pts[i + 1] - ref_pts[i]).normalized()
                            R = t_dir.to_track_quat('Z', 'Y').to_matrix().to_4x4()
                            span = 0.0
                            for pts in pts_list:
                                p_a = Vector(pts[min(i, len(pts) - 1)])
                                p_b = Vector(pts[min(i + 1, len(pts) - 1)])
                                span = max(span, (p_a.lerp(p_b, u) - c_avg).length)
                            vs += mb.cyl(clamp_mat, span + r_max + 0.005, span + r_max + 0.005, 0.014, 12, center=c_avg, rot=R)
                            break
    return vs


def curtain_sheet(mb, mat, w, h, cols, rows, M, folds=0.03, seed=1, thickness=0.004, pinch_v=0.42, pinch_amt=0.38):
    """Cortina de tejido con pliegues naturales, recogida en la cintura y caída inferior."""
    bm = mb.bm
    rnd = random.Random(seed)
    ph = [rnd.random() * TAU for _ in range(4)]
    grid = []
    for j in range(rows + 1):
        v = j / rows  # 0 abajo, 1 arriba
        # estrechamiento suave en torno a pinch_v (cinta recogedora)
        d_pinch = (v - pinch_v) / 0.22
        gather = 1.0 - pinch_amt * math.exp(-d_pinch * d_pinch)
        # ligera curva hacia el lado anclado (-x) cuando se recoge
        x_shift = -w * 0.14 * pinch_amt * math.exp(-d_pinch * d_pinch)
        row = []
        for i in range(cols + 1):
            u = i / cols
            x = (u - 0.5) * w * gather + x_shift
            y = (v - 0.5) * h
            amp = folds * (0.65 + 0.55 * (1.0 - v)) * (1.0 + 0.35 * math.exp(-d_pinch * d_pinch))
            z = amp * (math.sin(u * TAU * 3.5 + ph[0]) * 0.58 + math.sin(u * TAU * 7.5 + ph[1] + v * 1.4) * 0.28 +
                       math.cos(u * TAU * 2.0 + ph[2] - v * 2.2) * 0.14)
            z += 0.004 * noise.noise(Vector((x * 7, y * 5, seed)))
            row.append(M @ Vector((x, y, z)))
        grid.append(row)
    top = [[bm.verts.new(p) for p in r] for r in grid]
    idx = mb.mi(mat)
    nrm = (M.to_3x3() @ Vector((0, 0, 1))).normalized()
    bot = [[bm.verts.new(p - nrm * thickness) for p in r] for r in grid]
    for j in range(rows):
        for i in range(cols):
            f = bm.faces.new((top[j][i], top[j][i + 1], top[j + 1][i + 1], top[j + 1][i])); f.material_index = idx
            f = bm.faces.new((bot[j][i], bot[j + 1][i], bot[j + 1][i + 1], bot[j][i + 1])); f.material_index = idx
    for j in range(rows):
        for i in (0, cols):
            a, b, c, d = top[j][i], top[j + 1][i], bot[j + 1][i], bot[j][i]
            f = bm.faces.new((a, b, c, d) if i == 0 else (a, d, c, b)); f.material_index = idx
    for i in range(cols):
        for j in (0, rows):
            a, b, c, d = top[j][i], top[j][i + 1], bot[j][i + 1], bot[j][i]
            f = bm.faces.new((a, d, c, b) if j == 0 else (a, b, c, d)); f.material_index = idx
    return [v for r in top for v in r] + [v for r in bot for v in r]

