"""
ALCIÓN HX-4 · REBIRTH — banda panorámica de ventanas de la cabina de vuelo.

La cabina (bahía A) ocupaba un cilindro ciego: se pilotaba mirando un mamparo.
Rebirth abre 9 ventanas trapezoidales en las facetas superiores del cono
adaptador HAB→nodo (facetas 0…8: de babor horizontal a estribor horizontal
pasando por el cenit). Los cortes atraviesan las tres capas (casco presurizado,
MLI y escudo MMOD) mediante cuñas radiales, de modo que el hueco es coherente
desde dentro y desde fuera.
"""
import math
import bmesh
from mathutils import Vector
from .lib import MB, mesh_from_bm, part, group
from . import spec as S

PI = math.pi
WIN_FACETS = list(range(0, 9))          # 0 = babor (+Y), 4 = cenit (+Z), 8 = estribor (−Y)
WIN_X0, WIN_X1 = 8.94, 9.78             # extensión axial de cada ventana
WIN_HALF = math.radians(8.4)            # semiapertura angular (montante de ~0,22 m entre ventanas)


def facet_angle(i):
    return 2 * PI * i / S.N_FACETS


def cone_r(x, r0=S.R_P, r1=S.R_CONE_F):
    """Radio de la superficie exterior del casco cónico en X."""
    t = (x - S.X_HAB_F) / (S.X_CONE_F - S.X_HAB_F)
    return r0 + (r1 - r0) * min(1.0, max(0.0, t))


def _p(x, r, a):
    return Vector((x, r * math.cos(a), r * math.sin(a)))


def wedge(i, r_in, r_out, x0=WIN_X0, x1=WIN_X1, half=WIN_HALF, grow=0.0):
    """Cuña radial (malla convexa cerrada) que define el hueco de la ventana i."""
    a = facet_angle(i)
    bm = bmesh.new()
    for x in (x0 - grow, x1 + grow):
        for r in (r_in, r_out):
            for s in (-1, 1):
                bm.verts.new(_p(x, r, a + s * (half + grow / max(r, 0.5))))
    bmesh.ops.convex_hull(bm, input=bm.verts)
    return mesh_from_bm(bm, f"cw_wedge_{i}", smooth=None)


def cutters(r_in=1.15, r_out=2.75, grow=0.0):
    return [wedge(i, r_in, r_out, grow=grow) for i in WIN_FACETS]


def surface_patch(mb, mat, i, rfun, t, nx=6, na=6, x0=WIN_X0, x1=WIN_X1, half=WIN_HALF):
    """Parche sólido que sigue una superficie de revolución r(x) dentro de la cuña i."""
    a = facet_angle(i)
    bm = mb.bm
    grid_o, grid_i = [], []
    for ix in range(nx + 1):
        x = x0 + (x1 - x0) * ix / nx
        ro, ri = [], []
        for ia in range(na + 1):
            ang = a - half + 2 * half * ia / na
            r = rfun(x)
            ro.append(bm.verts.new(_p(x, r + t, ang)))
            ri.append(bm.verts.new(_p(x, r, ang)))
        grid_o.append(ro)
        grid_i.append(ri)
    faces = []
    for ix in range(nx):
        for ia in range(na):
            faces.append(bm.faces.new((grid_o[ix][ia], grid_o[ix + 1][ia], grid_o[ix + 1][ia + 1], grid_o[ix][ia + 1])))
            faces.append(bm.faces.new((grid_i[ix][ia], grid_i[ix][ia + 1], grid_i[ix + 1][ia + 1], grid_i[ix + 1][ia])))
    # bordes
    def edge(seq_o, seq_i):
        for k in range(len(seq_o) - 1):
            faces.append(bm.faces.new((seq_o[k], seq_i[k], seq_i[k + 1], seq_o[k + 1])))
    edge([grid_o[0][k] for k in range(na + 1)], [grid_i[0][k] for k in range(na + 1)])
    edge([grid_o[nx][k] for k in range(na + 1)][::-1], [grid_i[nx][k] for k in range(na + 1)][::-1])
    edge([grid_o[k][0] for k in range(nx + 1)][::-1], [grid_i[k][0] for k in range(nx + 1)][::-1])
    edge([grid_o[k][na] for k in range(nx + 1)], [grid_i[k][na] for k in range(nx + 1)])
    idx = mb.mi(mat)
    for f in faces:
        f.material_index = idx


def well(mb, mat, i, r_in_fun, r_out_fun, x0=WIN_X0, x1=WIN_X1, half=WIN_HALF, n=6):
    """Paredes del pozo de ventana (reveal) entre dos superficies de revolución."""
    a = facet_angle(i)
    bm = mb.bm
    idx = mb.mi(mat)
    # contorno del hueco recorrido en sentido fijo: borde x0, lado +, borde x1, lado −
    ring = []
    for ia in range(n + 1):
        ring.append((x0, a - half + 2 * half * ia / n))
    for ix in range(1, n + 1):
        ring.append((x0 + (x1 - x0) * ix / n, a + half))
    for ia in range(1, n + 1):
        ring.append((x1, a + half - 2 * half * ia / n))
    for ix in range(1, n):
        ring.append((x1 - (x1 - x0) * ix / n, a - half))
    vi = [bm.verts.new(_p(x, r_in_fun(x), ang)) for x, ang in ring]
    vo = [bm.verts.new(_p(x, r_out_fun(x), ang)) for x, ang in ring]
    m = len(ring)
    for k in range(m):
        f = bm.faces.new((vi[k], vi[(k + 1) % m], vo[(k + 1) % m], vo[k]))
        f.material_index = idx


def build_exterior_windows(hab):
    """Vidrios exteriores, marcos y pozos de las ventanas de cabina (lado casco)."""
    g = group("HAB.EXT.CWN", "Ventanas panorámicas de cabina", hab, explode=(0.9, 0, 0.5),
              desc="Nueve ventanas trapezoidales en el cono adaptador: panel exterior antiescombros, dos paneles de presión de sílice fundida y marco mecanizado.",
              func="Visión directa para pilotaje, aproximación y observación desde la cabina de vuelo")
    for i in WIN_FACETS:
        mb = MB(f"cw_glass_{i}")
        surface_patch(mb, "M_Glass", i, lambda x: cone_r(x) - 0.02, 0.022)
        part(f"HAB.EXT.CWN.G{i+1}", f"Vidrio de ventana de cabina {i+1}", mb.mesh(smooth=80), g, explode=("auto", 0.3),
             desc="Conjunto de paneles de sílice fundida con recubrimiento antirreflejo y bajo emisivo.")
        mb = MB(f"cw_frame_{i}")
        # pozo entre la piel del escudo MMOD y el casco presurizado (aluminio anodizado grafito)
        well(mb, "M_AlAnodBlack", i, lambda x: cone_r(x) - 0.035, lambda x: cone_r(x, S.R_S, S.R_CONE_F + 0.13) + 0.004)
        # marco exterior saliente
        surface_patch(mb, "M_AlAnodBlack", i, lambda x: cone_r(x, S.R_S, S.R_CONE_F + 0.13) - 0.004, 0.018,
                      nx=1, na=1, x0=WIN_X0 - 0.035, x1=WIN_X0, half=WIN_HALF + 0.03)
        surface_patch(mb, "M_AlAnodBlack", i, lambda x: cone_r(x, S.R_S, S.R_CONE_F + 0.13) - 0.004, 0.018,
                      nx=1, na=1, x0=WIN_X1, x1=WIN_X1 + 0.035, half=WIN_HALF + 0.03)
        for s in (-1, 1):
            a0 = facet_angle(i) + s * (WIN_HALF + 0.015)
            bm = mb.bm
            idx = mb.mi("M_AlAnodBlack")
            vs = []
            for x in (WIN_X0 - 0.035, WIN_X1 + 0.035):
                r = cone_r(x, S.R_S, S.R_CONE_F + 0.13)
                for rr in (r - 0.004, r + 0.014):
                    for da in (-0.015, 0.015):
                        vs.append(bm.verts.new(_p(x, rr, a0 + da / max(r, 0.5) * 1.0)))
            res = bmesh.ops.convex_hull(bm, input=vs)
            for f in [e for e in res["geom"] if isinstance(e, bmesh.types.BMFace)]:
                f.material_index = idx
        part(f"HAB.EXT.CWN.F{i+1}", f"Marco de ventana de cabina {i+1}", mb.mesh(smooth=None), g, explode=("auto", 0.3),
             desc="Marco de aluminio 7075 anodizado grafito con junta de silicona y pozo atravesando el escudo MMOD.")
