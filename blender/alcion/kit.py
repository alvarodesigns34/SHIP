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
    n0 = len(mb.bm.verts)
    mb.bm.from_mesh(me_tmp)
    __import__("bpy").data.meshes.remove(me_tmp)
    mb.bm.verts.ensure_lookup_table()
    vs = mb.bm.verts[n0:]
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
    bmesh.ops.transform(mb.bm, matrix=M, verts=list(verts))


def rot_to(fwd, up=(0, 0, 1)):
    """Matriz 4x4 que lleva +X local a fwd y +Z local hacia up."""
    f = Vector(fwd).normalized()
    u = Vector(up)
    s = u.cross(f).normalized()
    u = f.cross(s).normalized()
    return Matrix((f, s, u)).transposed().to_4x4()
