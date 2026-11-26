"""Genera docs/INVENTARIO.md (y con --from-master extrae también inventario.json, inventario.csv y stats.json en solo lectura desde ALCION_HX4_master.blend sin modificarlo)."""
import csv
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


def extract_from_master():
    import bpy
    from mathutils import Vector

    sys.path.insert(0, HERE)
    import alcion.materials as mats

    master = os.path.join(HERE, "ALCION_HX4_master.blend")
    bpy.ops.wm.open_mainfile(filepath=master)
    bpy.context.view_layer.update()

    # Ignorar luces temporales de horneado o cámaras auxiliares al inventariar el vehículo
    rootob = bpy.data.objects["ALCION"]
    ship_objs = [rootob] + list(rootob.children_recursive)
    bb_cache = {}

    def world_bbox(ob):
        if ob.type == "MESH" and ob.data and len(ob.data.vertices):
            mw = ob.matrix_world
            pts = [mw @ Vector(c) for c in ob.bound_box]
            mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
            mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
            return mn, mx
        return None

    def subtree_bbox(ob):
        if ob.name in bb_cache:
            return bb_cache[ob.name]
        bb = world_bbox(ob)
        for ch in ob.children:
            cb = subtree_bbox(ch)
            if cb is None:
                continue
            if bb is None:
                bb = (cb[0].copy(), cb[1].copy())
            else:
                bb = (
                    Vector((min(bb[0].x, cb[0].x), min(bb[0].y, cb[0].y), min(bb[0].z, cb[0].z))),
                    Vector((max(bb[1].x, cb[1].x), max(bb[1].y, cb[1].y), max(bb[1].z, cb[1].z))),
                )
        bb_cache[ob.name] = bb
        return bb

    def calc_depth(ob):
        d = 0
        p = ob.parent
        while p is not None:
            d += 1
            p = p.parent
        return d

    subtree_bbox(rootob)

    mesh_obs = [o for o in ship_objs if o.type == "MESH" and o.data]
    group_obs = [o for o in ship_objs if o.type == "EMPTY"]
    n_parts = len(mesh_obs)
    n_groups = len(group_obs)
    bolts = sum(int(o.data.get("bolts", 0)) for o in mesh_obs)

    tris = 0
    verts = 0
    used_mats = set()
    for o in mesh_obs:
        me = o.data
        me.calc_loop_triangles()
        tris += len(me.loop_triangles)
        verts += len(me.vertices)
        for m in me.materials:
            if m:
                used_mats.add(m.name)

    def node_json(ob):
        bb = subtree_bbox(ob)
        d = {
            "code": ob.name,
            "label": ob.get("label", ob.name),
            "kind": ob.get("kind", "part" if ob.type == "MESH" else "group"),
            "desc": ob.get("desc", ""),
            "func": ob.get("func", ""),
            "depth": int(ob.get("depth", calc_depth(ob))),
        }
        if ob.get("room"):
            d["room"] = ob.get("room")
        if ob.type == "MESH" and ob.data:
            mset = [m.name for m in ob.data.materials if m]
            d["materials"] = [
                {"id": m, "desc": mats.MAT_DESC.get(m, bpy.data.materials[m].get("desc", ""))}
                for m in mset
            ]
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
    docs_dir = os.path.join(ROOT, "docs")
    os.makedirs(docs_dir, exist_ok=True)
    with open(os.path.join(docs_dir, "inventario.json"), "w", encoding="utf-8") as f:
        json.dump(
            {"vehicle": "ALCIÓN HX-4", "parts": n_parts, "groups": n_groups, "triangles": tris, "tree": tree},
            f,
            ensure_ascii=False,
            indent=1,
        )

    rows = []

    def walk_csv(d):
        rows.append((
            d["depth"],
            d["code"],
            d["label"],
            d["kind"],
            ";".join(m["id"] for m in d.get("materials", [])),
            "x".join(str(v) for v in d.get("dims_m", [])),
            d.get("tris", ""),
            d["desc"].replace("\n", " "),
        ))
        for c in d.get("children", []):
            walk_csv(c)

    walk_csv(tree)
    with open(os.path.join(docs_dir, "inventario.csv"), "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["nivel", "codigo", "denominacion", "tipo", "materiales", "dimensiones_m", "triangulos", "descripcion"])
        w.writerows(rows)

    bb_root = bb_cache["ALCION"]
    stats = {
        "bolts_modelled": bolts,
        "materials": len(used_mats),
        "parts": n_parts,
        "groups": n_groups,
        "triangles": tris,
        "vertices": verts,
        "length_m": round(bb_root[1].x - bb_root[0].x, 3),
        "span_m": round(bb_root[1].y - bb_root[0].y, 3),
        "height_m": round(bb_root[1].z - bb_root[0].z, 3),
        "bbox": [[round(v, 3) for v in bb_root[0]], [round(v, 3) for v in bb_root[1]]],
    }
    with open(os.path.join(docs_dir, "stats.json"), "w", encoding="utf-8") as f:
        json.dump(stats, f, indent=1)
    print(f"[inv] extraído en solo lectura desde maestro: piezas={n_parts} grupos={n_groups} triángulos={tris:,} tornillos={bolts}")


def generate_md():
    with open(os.path.join(ROOT, "docs", "inventario.json"), encoding="utf-8") as f:
        data = json.load(f)
    with open(os.path.join(ROOT, "docs", "stats.json"), encoding="utf-8") as f:
        stats = json.load(f)
    L = [
        "# Inventario jerárquico de componentes — ALCIÓN HX-4",
        "",
        "Generado automáticamente desde el modelo maestro (`blender/ALCION_HX4_master.blend` → `docs/inventario.json`). "
        "Cada línea es un nodo real del modelo 3D y de la aplicación web; el código es su identificador único.",
        "",
        f"- Piezas (mallas individuales): **{stats['parts']}**",
        f"- Grupos de ensamblaje: **{stats['groups']}**",
        f"- Elementos de tornillería modelados (por instancia): **{stats.get('bolts_modelled', 'n/d')}**",
        f"- Triángulos (con instancias): **{stats['triangles']:,}**".replace(",", "."),
        "",
        "Niveles: 1 módulo · 2 sistema · 3 conjunto · 4+ pieza. Los números entre paréntesis indican las piezas contenidas.",
        "",
    ]

    def walk(n, lvl):
        ind = "  " * max(0, lvl - 1)
        cnt = f" ({n['count'] - 1})" if n.get("children") else ""
        dims = n.get("dims_m")
        dm = f" — {dims[0]:.2f}×{dims[1]:.2f}×{dims[2]:.2f} m".replace(".", ",") if dims and lvl <= 3 else ""
        if lvl == 0:
            L.append(f"## {n['label']}{cnt}\n")
        elif lvl == 1:
            L.append(f"\n### `{n['code']}` {n['label']}{cnt}{dm}\n")
            if n.get("desc"):
                L.append(f"> {n['desc']}\n")
        else:
            L.append(f"{ind}- `{n['code']}` **{n['label']}**{cnt}{dm}")
        for c in n.get("children", []):
            walk(c, lvl + 1)

    walk(data["tree"], 0)
    with open(os.path.join(ROOT, "docs", "INVENTARIO.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(L) + "\n")
    print("[inv] docs/INVENTARIO.md:", len(L), "líneas")


if __name__ == "__main__":
    if "--from-master" in sys.argv:
        extract_from_master()
    generate_md()
