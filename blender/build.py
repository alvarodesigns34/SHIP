"""
ALCIÓN HX-4 — construcción del modelo maestro.

Uso:
  blender -b --python blender/build.py -- [--no-export]

Genera:
  blender/ALCION_HX4_master.blend   modelo maestro de máxima fidelidad
  export/alcion_hx4.glb             exportación glTF binaria (sin comprimir)
  docs/inventario.json / .csv       inventario jerárquico de componentes
"""
import bpy
import sys
import os
import json
import math
import time
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import importlib
import alcion.lib as lib
import alcion.materials as mats
import alcion.spec as S
import alcion.exterior as ext
import alcion.systems as sysm
import alcion.interior as inter
for m in (lib, mats, S, ext, sysm, inter):
    importlib.reload(m)

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
DO_EXPORT = "--no-export" not in argv

t0 = time.time()
lib.scene_reset()
mats.build_all()

root = lib.group("ALCION", "ALCIÓN HX-4", None, explode=("none", 0),
                 desc="Vehículo tripulado cislunar de ciencia y servicio para 4 tripulantes. Diseño conceptual original de Varro-Lindqvist Astronautics (empresa ficticia).",
                 func="Salidas de hasta 45 días desde una estación en órbita lunar para servicio de observatorios, recogida de muestras y ciencia en órbita")
fwd = ext.build_forward(root)
inter.build_node_interior(fwd)
hab = lib.group("HAB", "Módulo Habitable Presurizado", root, explode=(0, 0, 0),
                desc="Módulo presurizado principal de Ø4,20 m y 8,2 m de barril cilíndrico; volumen presurizado total del vehículo ≈ 150 m³.",
                func="Alojar a la tripulación, la cabina de vuelo, el laboratorio y el soporte vital")
ext.build_hab_exterior(hab)
inter.build_interior(hab)
sysm.build_service(root)
sysm.build_propulsion(root)
sysm.build_power(root)
sysm.build_thermal(root)
sysm.build_comms(root)
sysm.build_robot(root)
print(f"[build] geometría creada en {time.time()-t0:.1f}s")

# ---------------------------------------------------------------------------
# Poda de grupos vacíos
# ---------------------------------------------------------------------------
changed = True
while changed:
    changed = False
    for ob in list(bpy.data.objects):
        if ob.type == 'EMPTY' and len(ob.children) == 0 and ob.name != "ALCION":
            bpy.data.objects.remove(ob)
            changed = True

bpy.context.view_layer.update()

# ---------------------------------------------------------------------------
# Cajas envolventes y vectores de explosión
# ---------------------------------------------------------------------------
BB = {}


def world_bbox(ob):
    if ob.type == 'MESH' and ob.data and len(ob.data.vertices):
        mw = ob.matrix_world
        pts = [mw @ Vector(c) for c in ob.bound_box]
        mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
        mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
        return mn, mx
    return None


def subtree_bbox(ob):
    if ob.name in BB:
        return BB[ob.name]
    bb = world_bbox(ob)
    for ch in ob.children:
        cb = subtree_bbox(ch)
        if cb is None:
            continue
        if bb is None:
            bb = (cb[0].copy(), cb[1].copy())
        else:
            bb = (Vector((min(bb[0].x, cb[0].x), min(bb[0].y, cb[0].y), min(bb[0].z, cb[0].z))),
                  Vector((max(bb[1].x, cb[1].x), max(bb[1].y, cb[1].y), max(bb[1].z, cb[1].z))))
    BB[ob.name] = bb
    return bb


def center(ob):
    bb = subtree_bbox(ob)
    return (bb[0] + bb[1]) / 2 if bb else ob.matrix_world.translation.copy()


def size(ob):
    bb = subtree_bbox(ob)
    return (bb[1] - bb[0]).length if bb else 0.0


def depth(ob):
    d = 0
    p = ob.parent
    while p is not None:
        d += 1
        p = p.parent
    return d


rootob = bpy.data.objects["ALCION"]
subtree_bbox(rootob)
for ob in bpy.data.objects:
    if ob.parent is None or "ex_mode" not in ob:
        ob["ex"] = [0.0, 0.0, 0.0]
        ob["depth"] = depth(ob)
        continue
    mode = ob["ex_mode"]
    c = center(ob)
    pc = center(ob.parent)
    dist = ob.get("ex_dist", None)
    if dist is None:
        dist = max(0.25, min(1.5, 0.25 + 0.35 * size(ob)))
    v = Vector((0, 0, 0))
    if mode == "vec":
        v = Vector(ob["ex_vec"])
    elif mode == "none":
        v = Vector((0, 0, 0))
    else:
        d = c - pc
        if mode == "radial":
            d.x = 0.0
        elif mode == "axial":
            d.y = d.z = 0.0
        if d.length < 1e-3:
            d = Vector((0, 0, 1)) if mode != "axial" else Vector((1, 0, 0))
            if dist == 0:
                d = Vector((0, 0, 0))
        v = d.normalized() * dist if d.length > 0 else d
    ob["ex"] = [round(v.x, 4), round(v.y, 4), round(v.z, 4)]
    ob["depth"] = depth(ob)
for ob in bpy.data.objects:
    if "ex_follow" in ob and ob["ex_follow"] in bpy.data.objects:
        ob["ex"] = list(bpy.data.objects[ob["ex_follow"]]["ex"])

# limpiar propiedades internas
for ob in bpy.data.objects:
    for k in ("ex_mode", "ex_dist", "ex_vec", "ex_follow", "_panels"):
        if k in ob:
            del ob[k]
    if ob.type == 'MESH':
        ms = [m.name for m in ob.data.materials if m]
        ob["mats"] = ",".join(ms)

# ---------------------------------------------------------------------------
# Estadísticas e inventario
# ---------------------------------------------------------------------------
n_parts = sum(1 for o in bpy.data.objects if o.type == 'MESH')
n_groups = sum(1 for o in bpy.data.objects if o.type == 'EMPTY')
tris = 0
verts = 0
for me in bpy.data.meshes:
    users = me.users
    me.calc_loop_triangles()
    tris += len(me.loop_triangles) * max(1, users)
    verts += len(me.vertices) * max(1, users)
print(f"[build] piezas={n_parts} grupos={n_groups} triángulos≈{tris:,} vértices≈{verts:,}")


def node_json(ob):
    bb = subtree_bbox(ob)
    d = {
        "code": ob.name,
        "label": ob.get("label", ob.name),
        "kind": ob.get("kind", "group"),
        "desc": ob.get("desc", ""),
        "func": ob.get("func", ""),
        "depth": ob["depth"],
    }
    if ob.type == 'MESH':
        mset = [m.name for m in ob.data.materials if m]
        d["materials"] = [{"id": m, "desc": mats.MAT_DESC.get(m, bpy.data.materials[m].get("desc", ""))} for m in mset]
        ob.data.calc_loop_triangles()
        d["tris"] = len(ob.data.loop_triangles)
    if bb:
        d["dims_m"] = [round(v, 3) for v in (bb[1] - bb[0])]
        d["center_m"] = [round(v, 3) for v in (bb[0] + bb[1]) / 2]
    ch = sorted(ob.children, key=lambda o: o.name)
    if ch:
        d["children"] = [node_json(c) for c in ch]
    d["count"] = 1 + sum(c.get("count", 1) for c in d.get("children", []))
    return d


tree = node_json(rootob)
os.makedirs(os.path.join(ROOT, "docs"), exist_ok=True)
with open(os.path.join(ROOT, "docs", "inventario.json"), "w", encoding="utf-8") as f:
    json.dump({"vehicle": "ALCIÓN HX-4", "parts": n_parts, "groups": n_groups, "triangles": tris, "tree": tree}, f, ensure_ascii=False, indent=1)

rows = []


def walk(d, path):
    rows.append((d["depth"], d["code"], d["label"], d["kind"], ";".join(m["id"] for m in d.get("materials", [])),
                 "x".join(str(v) for v in d.get("dims_m", [])), d.get("tris", ""), d["desc"].replace("\n", " ")))
    for c in d.get("children", []):
        walk(c, path + [d["code"]])


walk(tree, [])
import csv
with open(os.path.join(ROOT, "docs", "inventario.csv"), "w", encoding="utf-8", newline="") as f:
    w = csv.writer(f)
    w.writerow(["nivel", "codigo", "denominacion", "tipo", "materiales", "dimensiones_m", "triangulos", "descripcion"])
    w.writerows(rows)

stats = {"parts": n_parts, "groups": n_groups, "triangles": tris, "vertices": verts,
         "length_m": round(S.LENGTH_OVERALL, 2), "span_m": round(S.SPAN_OVERALL, 2),
         "bbox": [[round(v, 3) for v in BB["ALCION"][0]], [round(v, 3) for v in BB["ALCION"][1]]]}
with open(os.path.join(ROOT, "docs", "stats.json"), "w") as f:
    json.dump(stats, f, indent=1)
print("[build] stats", stats)

# ---------------------------------------------------------------------------
# Guardado y exportación
# ---------------------------------------------------------------------------
blend_path = os.path.join(HERE, "ALCION_HX4_master.blend")
bpy.ops.wm.save_as_mainfile(filepath=blend_path, compress=True)
print("[build] guardado", blend_path)

if DO_EXPORT:
    os.makedirs(os.path.join(ROOT, "export"), exist_ok=True)
    common = dict(export_format='GLB', export_extras=True, export_apply=True, export_yup=True,
                  export_cameras=False, export_lights=False, export_image_format='AUTO',
                  export_texcoords=True, export_normals=True)
    glb = os.path.join(ROOT, "export", "alcion_hx4.glb")
    bpy.ops.export_scene.gltf(filepath=glb, **common)
    print("[build] exportado", glb, os.path.getsize(glb) // 1024, "KiB")
    # división para carga progresiva: exterior (inmediato) + interior (diferido)
    INTERIOR_ROOTS = {"HAB.INT", "HAB.UTL", "FWD.INT"}

    def under_interior(o):
        p = o
        while p is not None:
            if p.name in INTERIOR_ROOTS:
                return True
            p = p.parent
        return False

    for part_name, want in (("exterior", False), ("interior", True)):
        for o in bpy.data.objects:
            o.select_set(under_interior(o) == want or (want and o.name in ("ALCION", "HAB", "FWD")))
        path = os.path.join(ROOT, "export", f"alcion_hx4_{part_name}.glb")
        bpy.ops.export_scene.gltf(filepath=path, use_selection=True, **common)
        print("[build] exportado", path, os.path.getsize(path) // 1024, "KiB")
print(f"[build] total {time.time()-t0:.1f}s")
