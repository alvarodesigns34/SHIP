"""
ALCIÓN HX-4 — librería procedural base.

Convenciones del modelo maestro (coordenadas Blender):
  +X  proa (dirección del puerto de atraque IDSS)
  +Y  babor
  +Z  cenit ("arriba" de referencia de la cabina)
  Unidades: metros.

Jerarquía: los nodos agrupadores son Empties con transformación identidad,
de modo que el espacio local de cualquier grupo coincide con el espacio del
mundo. Así los vectores de explosión se pueden expresar en ejes globales y se
acumulan de forma natural a lo largo del árbol (nave → módulo → sistema →
conjunto → pieza).
"""
import bpy
import bmesh
import math
from mathutils import Vector, Matrix, Euler

TAU = math.tau

# ---------------------------------------------------------------------------
# Registro de nodos y metadatos
# ---------------------------------------------------------------------------
_COLL = None
STATS = {"bolts": 0}
_ID_COUNTER = {}


def scene_reset():
    global _COLL
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for c in list(bpy.data.collections):
        bpy.data.collections.remove(c)
    _COLL = bpy.data.collections.new("ALCION_HX4")
    bpy.context.scene.collection.children.link(_COLL)
    bpy.context.scene.unit_settings.system = 'METRIC'
    return _COLL


def _link(ob):
    _COLL.objects.link(ob)


def _uid(prefix):
    n = _ID_COUNTER.get(prefix, 0) + 1
    _ID_COUNTER[prefix] = n
    return f"{prefix}-{n:03d}"


def _meta(ob, label, desc, code, explode, mat_desc=None, func=None):
    ob["label"] = label
    ob["desc"] = desc or ""
    ob["code"] = code
    if func:
        ob["func"] = func
    if mat_desc:
        ob["material"] = mat_desc
    if explode is None:
        ob["ex_mode"] = "auto"
    elif isinstance(explode, str):
        ob["ex_mode"] = explode
    elif isinstance(explode, tuple) and len(explode) == 2 and isinstance(explode[0], str):
        ob["ex_mode"] = explode[0]
        ob["ex_dist"] = float(explode[1])
    else:
        ob["ex_mode"] = "vec"
        ob["ex_vec"] = [float(v) for v in explode]


def group(code, label, parent=None, desc="", explode=None, func=None):
    """Crea un nodo agrupador (Empty identidad)."""
    ob = bpy.data.objects.new(code, None)
    ob.empty_display_size = 0.2
    ob.empty_display_type = 'PLAIN_AXES'
    _link(ob)
    if parent is not None:
        ob.parent = parent
    _meta(ob, label, desc, code, explode, func=func)
    ob["kind"] = "group"
    return ob


def part(code, label, me, parent, mat=None, loc=(0, 0, 0), rot=(0, 0, 0),
         desc="", explode=None, mat_desc=None, smooth=30, bevel=None, func=None,
         scale=None):
    """Crea una pieza (objeto malla) con metadatos.

    me: bpy.types.Mesh ya construida (puede compartirse entre piezas).
    rot: Euler XYZ en radianes, o Matrix 3x3/4x4.
    bevel: ancho de bisel (m) aplicado como modificador (se aplica al exportar).
    """
    ob = bpy.data.objects.new(code, me)
    _link(ob)
    ob.parent = parent
    ob.location = Vector(loc)
    if isinstance(rot, Matrix):
        ob.rotation_mode = 'QUATERNION'
        ob.rotation_quaternion = rot.to_quaternion()
    else:
        ob.rotation_euler = Euler(rot, 'XYZ')
    if scale is not None:
        ob.scale = Vector(scale)
    if mat is not None:
        if me.materials and len(me.materials) > 0 and me.users > 1:
            pass
        elif len(me.materials) == 0:
            me.materials.append(mat)
    if bevel:
        m = ob.modifiers.new("Bevel", 'BEVEL')
        m.width = bevel
        m.segments = 2
        m.limit_method = 'ANGLE'
        m.angle_limit = math.radians(40)
        m.harden_normals = True
    _meta(ob, label, desc, code, explode, mat_desc=mat_desc, func=func)
    ob["kind"] = "part"
    return ob


# ---------------------------------------------------------------------------
# Constructores de mallas (bmesh)
# ---------------------------------------------------------------------------

def box_uv(bm):
    """UV de proyección cúbica en metros (1 unidad UV = 1 m)."""
    uv = bm.loops.layers.uv.verify()
    for f in bm.faces:
        n = f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for loop in f.loops:
            co = loop.vert.co
            if ax == 0:
                loop[uv].uv = (co.y, co.z)
            elif ax == 1:
                loop[uv].uv = (co.x, co.z)
            else:
                loop[uv].uv = (co.x, co.y)


def _finish(bm, name, smooth=30, mats=None):
    me = bpy.data.meshes.new(name)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bm.normal_update()
    if not bm.loops.layers.uv:
        box_uv(bm)
    bm.to_mesh(me)
    bm.free()
    if smooth is not None:
        for p in me.polygons:
            p.use_smooth = True
        try:
            me.set_sharp_from_angle(angle=math.radians(smooth))
        except Exception:
            pass
    if mats:
        for m in mats:
            me.materials.append(m)
    return me


def mesh_from_bm(bm, name, smooth=30, mats=None):
    return _finish(bm, name, smooth, mats)


def bm_transform(bm, mat, verts=None):
    bmesh.ops.transform(bm, matrix=mat, verts=verts if verts is not None else bm.verts)


def axis_matrix(axis):
    """Matriz que lleva el eje +Z local al eje indicado ('X','Y','Z','-X',...)."""
    a = axis.upper()
    if a == 'Z':
        return Matrix.Identity(4)
    if a == '-Z':
        return Matrix.Rotation(math.pi, 4, 'X')
    if a == 'X':
        return Matrix.Rotation(math.pi / 2, 4, 'Y')
    if a == '-X':
        return Matrix.Rotation(-math.pi / 2, 4, 'Y')
    if a == 'Y':
        return Matrix.Rotation(-math.pi / 2, 4, 'X')
    if a == '-Y':
        return Matrix.Rotation(math.pi / 2, 4, 'X')
    raise ValueError(axis)


def box(name, sx, sy, sz, smooth=None, mats=None):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bm_transform(bm, Matrix.Diagonal((sx, sy, sz, 1)))
    return _finish(bm, name, smooth, mats)


def bm_box(bm, sx, sy, sz, center=(0, 0, 0), rot=None):
    r = bmesh.ops.create_cube(bm, size=1.0)
    vs = r["verts"]
    M = Matrix.Translation(Vector(center)) @ (rot if rot is not None else Matrix.Identity(4)) @ Matrix.Diagonal((sx, sy, sz, 1))
    bm_transform(bm, M, vs)
    return vs


def bm_cyl(bm, r1, r2, depth, seg=32, center=(0, 0, 0), axis='Z', cap=True, rot=None):
    res = bmesh.ops.create_cone(bm, cap_ends=cap, cap_tris=False, segments=seg,
                                radius1=r1, radius2=r2, depth=depth)
    vs = res["verts"]
    M = Matrix.Translation(Vector(center)) @ (rot if rot is not None else axis_matrix(axis))
    bm_transform(bm, M, vs)
    return vs


def cyl(name, r, depth, seg=32, axis='Z', r2=None, smooth=40, mats=None, cap=True):
    bm = bmesh.new()
    bm_cyl(bm, r, r if r2 is None else r2, depth, seg, axis=axis, cap=cap)
    return _finish(bm, name, smooth, mats)


def bm_sphere(bm, r, seg=24, rings=12, center=(0, 0, 0), scale=(1, 1, 1)):
    res = bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=r)
    vs = res["verts"]
    bm_transform(bm, Matrix.Translation(Vector(center)) @ Matrix.Diagonal((*scale, 1)), vs)
    return vs


def sphere(name, r, seg=32, rings=16, scale=(1, 1, 1), smooth=80, mats=None):
    bm = bmesh.new()
    bm_sphere(bm, r, seg, rings, scale=scale)
    return _finish(bm, name, smooth, mats)


def bm_lathe(bm, profile, seg=48, axis='Z', center=(0, 0, 0), angle=TAU, start=0.0):
    """Revoluciona un perfil [(r, z), ...] alrededor de Z (luego reorienta).
    Devuelve la lista de vértices creados."""
    rings = []
    closed = abs(angle - TAU) < 1e-6
    n = seg if closed else seg + 1
    for i in range(n):
        a = start + angle * i / seg
        ca, sa = math.cos(a), math.sin(a)
        ring = []
        for (r, z) in profile:
            ring.append(bm.verts.new((r * ca, r * sa, z)))
        rings.append(ring)
    m = len(profile)
    for i in range(seg):
        ra = rings[i]
        rb = rings[(i + 1) % n] if closed else rings[i + 1]
        for j in range(m - 1):
            vs = [ra[j], rb[j], rb[j + 1], ra[j + 1]]
            if len({v for v in vs}) >= 3:
                try:
                    bm.faces.new(vs)
                except ValueError:
                    pass
    allv = [v for ring in rings for v in ring]
    M = Matrix.Translation(Vector(center)) @ axis_matrix(axis)
    bm_transform(bm, M, allv)
    return allv


def lathe(name, profile, seg=48, axis='Z', smooth=35, mats=None, angle=TAU, start=0.0):
    bm = bmesh.new()
    bm_lathe(bm, profile, seg, axis, angle=angle, start=start)
    return _finish(bm, name, smooth, mats)


def bm_tube_path(bm, pts, r, seg=10, closed=False):
    """Tubo a lo largo de una polilínea (para tuberías, cables, mangueras)."""
    pts = [Vector(p) for p in pts]
    rings = []
    npts = len(pts)
    prev_n = None
    for i, p in enumerate(pts):
        if i == 0:
            t = (pts[1] - pts[0]).normalized()
        elif i == npts - 1:
            t = (pts[-1] - pts[-2]).normalized()
        else:
            t = ((pts[i + 1] - pts[i]).normalized() + (pts[i] - pts[i - 1]).normalized()).normalized()
        if prev_n is None:
            ref = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0))
            n = t.cross(ref).normalized()
        else:
            n = (prev_n - t * prev_n.dot(t)).normalized()
        b = t.cross(n).normalized()
        prev_n = n
        ring = []
        for k in range(seg):
            a = TAU * k / seg
            ring.append(bm.verts.new(p + (n * math.cos(a) + b * math.sin(a)) * r))
        rings.append(ring)
    for i in range(npts - 1):
        for k in range(seg):
            bm.faces.new([rings[i][k], rings[i][(k + 1) % seg], rings[i + 1][(k + 1) % seg], rings[i + 1][k]])
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])
    return [v for r_ in rings for v in r_]


def smooth_path(pts, radius=0.15, steps=4):
    """Redondea las esquinas de una polilínea (curvas de tubería)."""
    pts = [Vector(p) for p in pts]
    if len(pts) < 3:
        return pts
    out = [pts[0]]
    for i in range(1, len(pts) - 1):
        a, b, c = pts[i - 1], pts[i], pts[i + 1]
        da = (a - b)
        dc = (c - b)
        ra = min(radius, da.length * 0.45)
        rc = min(radius, dc.length * 0.45)
        p0 = b + da.normalized() * ra
        p2 = b + dc.normalized() * rc
        for s in range(steps + 1):
            t = s / steps
            q = (1 - t) ** 2 * p0 + 2 * (1 - t) * t * b + t * t * p2
            out.append(q)
    out.append(pts[-1])
    return out


def tube(name, pts, r, seg=10, smooth=60, mats=None, round_r=None):
    bm = bmesh.new()
    p = smooth_path(pts, round_r) if round_r else pts
    bm_tube_path(bm, p, r, seg)
    return _finish(bm, name, smooth, mats)


def bm_torus(bm, R, r, seg=48, rseg=12, center=(0, 0, 0), axis='Z'):
    vs = []
    rings = []
    for i in range(seg):
        a = TAU * i / seg
        ring = []
        for j in range(rseg):
            b = TAU * j / rseg
            x = (R + r * math.cos(b)) * math.cos(a)
            y = (R + r * math.cos(b)) * math.sin(a)
            z = r * math.sin(b)
            ring.append(bm.verts.new((x, y, z)))
        rings.append(ring)
    for i in range(seg):
        for j in range(rseg):
            bm.faces.new([rings[i][j], rings[(i + 1) % seg][j], rings[(i + 1) % seg][(j + 1) % rseg], rings[i][(j + 1) % rseg]])
    allv = [v for r_ in rings for v in r_]
    bm_transform(bm, Matrix.Translation(Vector(center)) @ axis_matrix(axis), allv)
    return allv


def torus(name, R, r, seg=48, rseg=12, axis='Z', smooth=80, mats=None):
    bm = bmesh.new()
    bm_torus(bm, R, r, seg, rseg, axis=axis)
    return _finish(bm, name, smooth, mats)


def bm_hexbolt(bm, center, normal, size=0.012, height=0.008, washer=True):
    """Cabeza de tornillo hexagonal con arandela, orientada según 'normal'."""
    n = Vector(normal).normalized()
    rot = n.to_track_quat('Z', 'Y').to_matrix().to_4x4()
    T = Matrix.Translation(Vector(center)) @ rot
    vs = []
    if washer:
        vs += bm_cyl(bm, size * 1.45, size * 1.45, height * 0.25, 12, center=(0, 0, height * 0.125), axis='Z')
    vs += bm_cyl(bm, size, size, height, 6, center=(0, 0, height * 0.25 + height * 0.5), axis='Z')
    bm_transform(bm, T, vs)
    return vs


def bolts_mesh(name, positions_normals, size=0.012, height=0.008, washer=True):
    bm = bmesh.new()
    for c, n in positions_normals:
        bm_hexbolt(bm, c, n, size, height, washer)
    return _finish(bm, name, smooth=None)


def bolt_circle(center, axis_vec, radius, count, phase=0.0):
    """Posiciones de un círculo de tornillos en el plano normal a axis_vec."""
    a = Vector(axis_vec).normalized()
    ref = Vector((0, 0, 1)) if abs(a.z) < 0.9 else Vector((1, 0, 0))
    u = a.cross(ref).normalized()
    v = a.cross(u).normalized()
    c = Vector(center)
    out = []
    for i in range(count):
        t = phase + TAU * i / count
        out.append((c + (u * math.cos(t) + v * math.sin(t)) * radius, a))
    return out


def text_mesh(name, body, size=0.3, extrude=0.0015, align='CENTER', font=None):
    cu = bpy.data.curves.new(name + "_crv", 'FONT')
    cu.body = body
    cu.size = size
    cu.extrude = extrude
    cu.align_x = align
    cu.align_y = 'CENTER'
    if font:
        cu.font = font
    tmp = bpy.data.objects.new(name + "_tmp", cu)
    bpy.context.scene.collection.objects.link(tmp)
    dg = bpy.context.evaluated_depsgraph_get()
    ev = tmp.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev)
    me.name = name
    bpy.context.scene.collection.objects.unlink(tmp)
    bpy.data.objects.remove(tmp)
    bpy.data.curves.remove(cu)
    return me


def polygon_panel(name, pts2d, thickness, z0=0.0, smooth=None, mats=None):
    """Prisma extruido a partir de un polígono 2D en el plano XY."""
    bm = bmesh.new()
    vb = [bm.verts.new((x, y, z0)) for x, y in pts2d]
    vt = [bm.verts.new((x, y, z0 + thickness)) for x, y in pts2d]
    bm.faces.new(list(reversed(vb)))
    bm.faces.new(vt)
    n = len(pts2d)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new([vb[i], vb[j], vt[j], vt[i]])
    return _finish(bm, name, smooth, mats)


def curved_panel(name, r_in, r_out, a0, a1, x0, x1, seg=6, axis='X', mats=None, smooth=50):
    """Panel curvo (sector de cilindro) alrededor del eje X entre los ángulos
    a0..a1 (rad, medidos desde +Y hacia +Z) y x0..x1."""
    bm = bmesh.new()
    rows = []
    for i in range(seg + 1):
        a = a0 + (a1 - a0) * i / seg
        ca, sa = math.cos(a), math.sin(a)
        rows.append([bm.verts.new((x, r * ca, r * sa)) for x in (x0, x1) for r in (r_in, r_out)])
    # índice: 0=(x0,rin) 1=(x0,rout) 2=(x1,rin) 3=(x1,rout)
    for i in range(seg):
        A, B = rows[i], rows[i + 1]
        bm.faces.new([A[1], B[1], B[3], A[3]])  # exterior
        bm.faces.new([A[0], A[2], B[2], B[0]])  # interior
        bm.faces.new([A[0], B[0], B[1], A[1]])  # x0
        bm.faces.new([A[2], A[3], B[3], B[2]])  # x1
    A, B = rows[0], rows[-1]
    bm.faces.new([A[0], A[1], A[3], A[2]])
    bm.faces.new([B[0], B[2], B[3], B[1]])
    return _finish(bm, name, smooth, mats)


def ring_xyz(r, a, x):
    """Punto en coordenadas cilíndricas alrededor de X (a desde +Y hacia +Z)."""
    return Vector((x, r * math.cos(a), r * math.sin(a)))


def radial_rot(a):
    """Matriz de rotación que alinea +Z local con la dirección radial (a)
    alrededor del eje X, y +X local con +X global."""
    return Matrix.Rotation(a - math.pi / 2, 4, 'X')


def join_meshes(name, meshes_and_mats, smooth=30):
    """Une varias (Mesh, Matrix) en una sola malla."""
    bm = bmesh.new()
    for me, M in meshes_and_mats:
        tmp = bmesh.new()
        tmp.from_mesh(me)
        bm_transform(tmp, M)
        tmp_me = bpy.data.meshes.new("tmpjoin")
        tmp.to_mesh(tmp_me)
        tmp.free()
        bm.from_mesh(tmp_me)
        bpy.data.meshes.remove(tmp_me)
    return _finish(bm, name, smooth)


# ---------------------------------------------------------------------------
# Constructor multimaterial
# ---------------------------------------------------------------------------
class MB:
    """Acumula geometría en un bmesh asignando índices de material por bloque."""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.mats = []

    def mi(self, matname):
        if matname not in self.mats:
            self.mats.append(matname)
        return self.mats.index(matname)

    def tag(self, verts, matname):
        idx = self.mi(matname)
        for v in verts:
            for f in v.link_faces:
                f.material_index = idx
        return verts

    def box(self, mat, sx, sy, sz, center=(0, 0, 0), rot=None):
        return self.tag(bm_box(self.bm, sx, sy, sz, center, rot), mat)

    def cyl(self, mat, r1, r2, depth, seg=24, center=(0, 0, 0), axis='Z', cap=True, rot=None):
        return self.tag(bm_cyl(self.bm, r1, r2, depth, seg, center, axis, cap, rot), mat)

    def sphere(self, mat, r, seg=24, rings=12, center=(0, 0, 0), scale=(1, 1, 1)):
        return self.tag(bm_sphere(self.bm, r, seg, rings, center, scale), mat)

    def lathe(self, mat, profile, seg=48, axis='Z', center=(0, 0, 0), angle=TAU, start=0.0):
        return self.tag(bm_lathe(self.bm, profile, seg, axis, center, angle, start), mat)

    def torus(self, mat, R, r, seg=48, rseg=12, center=(0, 0, 0), axis='Z'):
        return self.tag(bm_torus(self.bm, R, r, seg, rseg, center, axis), mat)

    def tube(self, mat, pts, r, seg=10, round_r=None):
        p = smooth_path(pts, round_r) if round_r else pts
        return self.tag(bm_tube_path(self.bm, p, r, seg), mat)

    def bolt(self, mat, center, normal, size=0.012, height=0.008, washer=True):
        self.nbolts = getattr(self, "nbolts", 0) + 1
        return self.tag(bm_hexbolt(self.bm, center, normal, size, height, washer), mat)

    def bolts(self, mat, pns, size=0.012, height=0.008, washer=True):
        for c, n in pns:
            self.bolt(mat, c, n, size, height, washer)

    def beam(self, mat, p0, p1, w, h, up=(0, 0, 1)):
        """Viga de sección rectangular entre p0 y p1 (h en dirección 'up')."""
        p0, p1 = Vector(p0), Vector(p1)
        d = p1 - p0
        L = d.length
        if L < 1e-6:
            return []
        t = d.normalized()
        u = Vector(up)
        u = (u - t * u.dot(t))
        if u.length < 1e-6:
            u = t.orthogonal()
        u.normalize()
        s = t.cross(u)
        R = Matrix((t, s, u)).transposed().to_4x4()
        return self.box(mat, L, w, h, center=(p0 + p1) / 2, rot=R)

    def poly(self, mat, pts3d_bottom, pts3d_top):
        """Prisma general a partir de dos polígonos 3D equivalentes."""
        bm = self.bm
        vb = [bm.verts.new(p) for p in pts3d_bottom]
        vt = [bm.verts.new(p) for p in pts3d_top]
        n = len(vb)
        bm.faces.new(list(reversed(vb)))
        bm.faces.new(vt)
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new([vb[i], vb[j], vt[j], vt[i]])
        return self.tag(vb + vt, mat)

    def transform(self, M, verts):
        bm_transform(self.bm, M, verts)

    def mesh(self, smooth=30, bevel=None):
        from .materials import M as _M
        if bevel:
            bmesh.ops.remove_doubles(self.bm, verts=self.bm.verts, dist=1e-6)
            skip = {self.mats.index(m) for m in ("M_Bolt", "M_Steel", "M_GoldPlate", "M_Decal", "M_Accent", "M_Graphite") if m in self.mats}
            edges = [e for e in self.bm.edges if len(e.link_faces) == 2 and e.calc_face_angle(0) > math.radians(40)
                     and not any(f.material_index in skip for f in e.link_faces)]
            if edges:
                bmesh.ops.bevel(self.bm, geom=edges, offset=bevel, offset_type='OFFSET', segments=2, profile=0.5,
                                affect='EDGES', clamp_overlap=True)
            smooth = 35 if smooth is None else smooth
        me = _finish(self.bm, self.name, smooth)
        me["bolts"] = getattr(self, "nbolts", 0)
        for m in self.mats:
            me.materials.append(_M(m))
        return me


def attach(child, parent_obj):
    """Emparenta conservando la transformación de mundo."""
    bpy.context.view_layer.update()
    mw = child.matrix_world.copy()
    child.parent = parent_obj
    child.matrix_parent_inverse = parent_obj.matrix_world.inverted()
    child.matrix_world = mw


def boolean_cut(me, cutters, name=None):
    """Resta (booleana exacta) las mallas 'cutters' de 'me' (mismo espacio)."""
    scn = bpy.context.scene.collection
    ob = bpy.data.objects.new("tmp_bool", me)
    scn.objects.link(ob)
    cos = []
    for c in cutters:
        co = bpy.data.objects.new("tmp_cut", c)
        scn.objects.link(co)
        cos.append(co)
        mod = ob.modifiers.new("B", 'BOOLEAN')
        mod.operation = 'DIFFERENCE'
        mod.solver = 'EXACT'
        mod.object = co
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    new = bpy.data.meshes.new_from_object(ev)
    new.name = name or (me.name + "_cut")
    for co in cos:
        m = co.data
        bpy.data.objects.remove(co)
        bpy.data.meshes.remove(m)
    bpy.data.objects.remove(ob)
    return new
