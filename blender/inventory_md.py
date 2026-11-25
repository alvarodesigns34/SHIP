"""Genera docs/INVENTARIO.md a partir de docs/inventario.json (salida de build.py)."""
import json, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
data = json.load(open(os.path.join(ROOT, "docs", "inventario.json"), encoding="utf-8"))
stats = json.load(open(os.path.join(ROOT, "docs", "stats.json")))
L = ["# Inventario jerárquico de componentes — ALCIÓN HX-4", "",
     "Generado automáticamente desde el modelo maestro (`blender/build.py` → `docs/inventario.json`). "
     "Cada línea es un nodo real del modelo 3D y de la aplicación web; el código es su identificador único.", "",
     f"- Piezas (mallas individuales): **{stats['parts']}**",
     f"- Grupos de ensamblaje: **{stats['groups']}**",
     f"- Elementos de tornillería modelados (por instancia): **{stats.get('bolts_modelled', 'n/d')}**",
     f"- Triángulos (con instancias): **{stats['triangles']:,}**".replace(",", "."),
     "", "Niveles: 1 módulo · 2 sistema · 3 conjunto · 4+ pieza. Los números entre paréntesis indican las piezas contenidas.", ""]
def walk(n, lvl):
    ind = "  " * max(0, lvl - 1)
    cnt = f" ({n['count'] - 1})" if n.get("children") else ""
    dims = n.get("dims_m")
    dm = f" — {dims[0]:.2f}×{dims[1]:.2f}×{dims[2]:.2f} m".replace(".", ",") if dims and lvl <= 3 else ""
    if lvl == 0:
        L.append(f"## {n['label']}{cnt}\n")
    elif lvl == 1:
        L.append(f"\n### `{n['code']}` {n['label']}{cnt}{dm}\n")
        if n.get("desc"): L.append(f"> {n['desc']}\n")
    else:
        L.append(f"{ind}- `{n['code']}` **{n['label']}**{cnt}{dm}")
    for c in n.get("children", []):
        walk(c, lvl + 1)
walk(data["tree"], 0)
open(os.path.join(ROOT, "docs", "INVENTARIO.md"), "w", encoding="utf-8").write("\n".join(L) + "\n")
print(len(L), "líneas")
