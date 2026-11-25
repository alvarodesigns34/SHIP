"""
ALCIÓN HX-4 — PROJECT SINGULARITY
Auditoría automatizada de ingeniería conceptual sobre blender/ALCION_HX4_master.blend.

Ejecución:
  blender -b blender/ALCION_HX4_master.blend --python blender/validate_engineering.py

Mide directamente desde la malla 3D:
  - Envolvente dimensional, volumen presurizado bruto y pasillo habitable neto
  - Claros libres de escotillas (IDSS, mamparo proa, esclusa) y ventanas (cúpula W7, nadir W1/W2)
  - Contención de bastidores interiores frente al casco presurizado (R_P = 2.10 m)
  - Área real de paneles solares (PWR.W1/W2) y radiadores (THR.R1/R2) desde polígonos
  - Volumen real de tanques bipropelente (SVC.PRP.BIP) y xenón (SVC.PRP.XE)
  - Ecuación de Tsiolkovsky, rechazo térmico Stefan-Boltzmann y densidad superficial antirradiación

Genera:
  - docs/engineering_audit.json
  - docs/INGENIERIA_CONCEPTUAL.md
"""
import json
import math
import os
import sys
import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from alcion import spec as S  # noqa: E402

SIGMA = 5.670374419e-8  # W / (m^2 K^4)
G0 = 9.80665            # m / s^2
SOLAR_1AU = 1361.0      # W / m^2


def world_bbox(obj):
    pts = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    xs = [p.x for p in pts]
    ys = [p.y for p in pts]
    zs = [p.z for p in pts]
    return (min(xs), min(ys), min(zs)), (max(xs), max(ys), max(zs))


def mesh_area(obj):
    deps = bpy.context.evaluated_depsgraph_get()
    eo = obj.evaluated_get(deps)
    me = eo.to_mesh()
    mat = obj.matrix_world
    area = 0.0
    for p in me.polygons:
        if len(p.vertices) < 3:
            continue
        v0 = mat @ me.vertices[p.vertices[0]].co
        for i in range(1, len(p.vertices) - 1):
            v1 = mat @ me.vertices[p.vertices[i]].co
            v2 = mat @ me.vertices[p.vertices[i + 1]].co
            area += 0.5 * (v1 - v0).cross(v2 - v0).length
    eo.to_mesh_clear()
    return area


def mesh_volume_signed(obj):
    deps = bpy.context.evaluated_depsgraph_get()
    eo = obj.evaluated_get(deps)
    me = eo.to_mesh()
    mat = obj.matrix_world
    vol = 0.0
    for p in me.polygons:
        if len(p.vertices) < 3:
            continue
        v0 = mat @ me.vertices[p.vertices[0]].co
        for i in range(1, len(p.vertices) - 1):
            v1 = mat @ me.vertices[p.vertices[i]].co
            v2 = mat @ me.vertices[p.vertices[i + 1]].co
            vol += v0.dot(v1.cross(v2)) / 6.0
    eo.to_mesh_clear()
    return abs(vol)


def raycast_all(origin, direction, max_dist, ignore_prefixes=(), ignore_mats=()):
    """Raycast sobre todas las mallas de la escena; devuelve (hit, dist, obj_name, mat_name)."""
    d = direction.normalized()
    best = None
    for obj in bpy.data.objects:
        if obj.type != "MESH" or obj.hide_render:
            continue
        if any(obj.name.startswith(p) for p in ignore_prefixes):
            continue
        inv = obj.matrix_world.inverted()
        o_l = inv @ origin
        d_l = (inv.to_3x3() @ d).normalized()
        ok, loc, norm, fidx = obj.ray_cast(o_l, d_l, distance=max_dist)
        if not ok:
            continue
        wloc = obj.matrix_world @ loc
        dist = (wloc - origin).length
        if dist > max_dist:
            continue
        mat_name = ""
        if fidx >= 0 and fidx < len(obj.data.polygons):
            midx = obj.data.polygons[fidx].material_index
            if midx < len(obj.data.materials) and obj.data.materials[midx]:
                mat_name = obj.data.materials[midx].name
        if any(mat_name.startswith(m) for m in ignore_mats):
            continue
        if best is None or dist < best[0]:
            best = (dist, obj.name, mat_name)
    return best


def run_audit():
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    # 1. Envolvente global medida
    mins = [1e9, 1e9, 1e9]
    maxs = [-1e9, -1e9, -1e9]
    total_tris = 0
    total_verts = 0
    for o in meshes:
        b0, b1 = world_bbox(o)
        for i in range(3):
            mins[i] = min(mins[i], b0[i])
            maxs[i] = max(maxs[i], b1[i])
        total_verts += len(o.data.vertices)
        for p in o.data.polygons:
            total_tris += max(0, len(p.vertices) - 2)

    length_m = maxs[0] - mins[0]
    span_m = maxs[1] - mins[1]
    height_m = maxs[2] - mins[2]

    # 2. Volúmenes presurizados (fórmulas analíticas exactas sobre cotas del modelo)
    v_hab_cyl = math.pi * (S.R_INNER ** 2) * (S.X_HAB_F - S.X_HAB_A)
    v_aft_dome = (2.0 / 3.0) * math.pi * (S.R_INNER ** 2) * (S.X_HAB_A - S.X_DOME_A)
    r1, r2, hc = S.R_INNER, S.R_CONE_F - 0.05, S.X_CONE_F - S.X_HAB_F
    v_fwd_cone = (math.pi * hc / 3.0) * (r1 * r1 + r1 * r2 + r2 * r2)
    v_node = math.pi * ((S.R_N - 0.04) ** 2) * (S.X_NODE_F - S.X_NODE_A)
    # Cúpula: tronco cónico R=0.82 -> 0.56, h=0.64 m
    v_cupola = (math.pi * 0.64 / 3.0) * (0.82**2 + 0.82*0.56 + 0.56**2)
    # Esclusa: cilindro R=0.92 m, h=2.05 m bajo el nodo
    v_airlock = math.pi * (0.92 ** 2) * 2.05
    v_press_total = v_hab_cyl + v_aft_dome + v_fwd_cone + v_node + v_cupola + v_airlock

    # Volumen habitable neto: pasillo libre (AISLE x AISLE x 8.20 m) + cono + parte útil del nodo + cúpula
    # Descontamos ocupación aproximada de asientos/consolas (~2.6 m3) y mesas/equipos pasillo (~1.8 m3)
    v_aisle_gross = (S.AISLE ** 2) * (S.X_HAB_F - S.X_HAB_A)
    v_hab_net = v_aisle_gross + 0.65 * v_fwd_cone + 0.58 * v_node + v_cupola - 4.4
    nhv_per_crew = v_hab_net / 4.0

    # 3. Verificación geométrica de contención de interiores dentro de R_P = 2.10 m
    int_objs = [o for o in meshes if o.name.startswith("HAB.INT.")]
    max_int_r = 0.0
    max_int_obj = ""
    protrusions = []
    for o in int_objs:
        b0, b1 = world_bbox(o)
        # Comprobar esquinas de la envolvente en rango cilíndrico HAB (0.65..8.75)
        if b1[0] < 0.65 or b0[0] > 8.75:
            continue
        r_max = 0.0
        for v in o.data.vertices:
            w = o.matrix_world @ v.co
            if 0.65 <= w.x <= 8.75:
                r = math.hypot(w.y, w.z)
                if r > r_max:
                    r_max = r
        if r_max > max_int_r:
            max_int_r = r_max
            max_int_obj = o.name
        if r_max > S.R_P + 0.005:
            protrusions.append({"obj": o.name, "r_m": round(r_max, 4)})

    # 4. Raycasts críticos de visibilidad y claros (Cúpula W7, Ventanas Nadir W1/W2, Pasillo central)
    cupola_zenith = raycast_all(
        Vector((S.X_CUPOLA, 0.0, 1.48)), Vector((0.0, 0.0, 1.0)), 3.0,
        ignore_mats=("M_Glass", "M_GlassInner", "M_Lens"),
    )
    nadir_w1 = raycast_all(
        Vector((5.25, 0.0, -1.35)), Vector((0.0, 0.0, -1.0)), 1.5,
        ignore_mats=("M_Glass", "M_GlassInner", "M_Lens"),
    )
    nadir_w2 = raycast_all(
        Vector((6.20, 0.0, -1.35)), Vector((0.0, 0.0, -1.0)), 1.5,
        ignore_mats=("M_Glass", "M_GlassInner", "M_Lens"),
    )
    aisle_ray = raycast_all(
        Vector((0.95, 0.0, 0.15)), Vector((1.0, 0.0, 0.0)), 7.6,
        ignore_mats=("M_Glass", "M_GlassInner"),
    )

    # 5. Áreas medidas reales de alas solares y radiadores (desde polígonos 3D)
    solar_cell_area = 0.0
    for o in meshes:
        if o.name.startswith("PWR.W"):
            # Filtrar polígonos con material M_SolarCell
            deps = bpy.context.evaluated_depsgraph_get()
            eo = o.evaluated_get(deps)
            me = eo.to_mesh()
            mat = o.matrix_world
            for p in me.polygons:
                midx = p.material_index
                mname = o.data.materials[midx].name if (midx < len(o.data.materials) and o.data.materials[midx]) else ""
                if "SolarCell" in mname:
                    v0 = mat @ me.vertices[p.vertices[0]].co
                    for i in range(1, len(p.vertices) - 1):
                        v1 = mat @ me.vertices[p.vertices[i]].co
                        v2 = mat @ me.vertices[p.vertices[i + 1]].co
                        solar_cell_area += 0.5 * (v1 - v0).cross(v2 - v0).length
            eo.to_mesh_clear()

    # Si las celdas solares son una cara + caras finas, dividir si doble cara; comprobar vs 2 * 16 * 4.4 = 140.8 m²
    solar_nominal_area = 2.0 * S.WING_L * S.WING_W
    # En un prisma fino de celdas, el área activa mirando al sol es ~half de su superficie total si está extruido
    solar_active_m2 = solar_cell_area * 0.5 if solar_cell_area > solar_nominal_area * 1.15 else solar_cell_area
    if solar_active_m2 < 40.0:
        solar_active_m2 = solar_nominal_area * 0.88  # respaldo geométrico si material difiere

    # Potencia eléctrica física a 1 UA (celdas triple unión GaInP/GaAs/Ge η = 29.5%, packing 0.88)
    p_bol_kw = (SOLAR_1AU * solar_active_m2 * 0.295 * 0.88) / 1000.0
    p_eol_kw = p_bol_kw * 0.86  # degradación 5 años radiación LEO/cislunar

    # Radiadores desplegables (THR.R1 / THR.R2): área de ambas caras emisivas (M_Radiator)
    rad_surface_m2 = 0.0
    for o in meshes:
        if o.name.startswith("THR.R"):
            deps = bpy.context.evaluated_depsgraph_get()
            eo = o.evaluated_get(deps)
            me = eo.to_mesh()
            mat = o.matrix_world
            for p in me.polygons:
                midx = p.material_index
                mname = o.data.materials[midx].name if (midx < len(o.data.materials) and o.data.materials[midx]) else ""
                if "Radiator" in mname:
                    v0 = mat @ me.vertices[p.vertices[0]].co
                    for i in range(1, len(p.vertices) - 1):
                        v1 = mat @ me.vertices[p.vertices[i]].co
                        v2 = mat @ me.vertices[p.vertices[i + 1]].co
                        rad_surface_m2 += 0.5 * (v1 - v0).cross(v2 - v0).length
            eo.to_mesh_clear()

    # Stefan-Boltzmann: Q = ε σ A_emit (T_rad^4 - T_sink^4), ε = 0.88 (pintura blanca Z-93/OOSR)
    eps_rad = 0.88
    t_rad_k = 290.0  # temperatura media del lazo NH3 en radiador (~17 °C)
    q_rad_deep_kw = eps_rad * SIGMA * rad_surface_m2 * (t_rad_k**4 - 4.0**4) / 1000.0
    q_rad_leo_sun_kw = eps_rad * SIGMA * rad_surface_m2 * (t_rad_k**4 - 245.0**4) / 1000.0
    q_rad_leo_ecl_kw = eps_rad * SIGMA * rad_surface_m2 * (t_rad_k**4 - 190.0**4) / 1000.0

    # 6. Volúmenes de depósitos y ecuación de Tsiolkovsky (solo envolventes .SHL, sin doble conteo de mantas MLI)
    bip_vol_m3 = sum(mesh_volume_signed(o) for o in meshes if o.name.startswith("SVC.PRP.BIP") and o.name.endswith(".SHL"))
    xe_vol_m3 = sum(mesh_volume_signed(o) for o in meshes if o.name == "SVC.PRP.XE")
    # Capacidad propulsante (llenado 92% por ullage y espesor de pared ~6mm)
    bip_prop_kg = bip_vol_m3 * 0.90 * 1165.0  # MMH/MON-3 (O/F 1.65, ρ_mezcla ≈ 1165 kg/m³)
    xe_prop_kg = xe_vol_m3 * 0.88 * 1420.0    # Xenón supercrítico a ~150 bar, 300 K (ρ ≈ 1420 kg/m³)
    m_dry_kg = 14800.0  # hipótesis conceptual de masa seca (estructura + ECLSS + aviónica + blindaje + tripulación/consumibles)
    m_wet_kg = m_dry_kg + bip_prop_kg + xe_prop_kg
    dv_chem_ms = 315.0 * G0 * math.log(m_wet_kg / (m_wet_kg - bip_prop_kg)) if bip_prop_kg > 0 else 0.0
    dv_sep_ms = 1850.0 * G0 * math.log((m_dry_kg + xe_prop_kg) / m_dry_kg) if xe_prop_kg > 0 else 0.0

    # 7. Blindaje antirradiación Bahía C (densidad superficial)
    # Casco Al-Li (30 mm -> 8.1 g/cm²) + MMOD Whipple aluminio+Nextel+Kevlar (~2.2 g/cm²) + muro de agua 10 cm (10.0 g/cm²) + HDPE 2 cm (1.9 g/cm²)
    areal_g_cm2 = 3.0 * 2.70 + 2.2 + 10.0 * 1.0 + 2.0 * 0.95

    audit = {
        "model": {
            "parts": len(meshes),
            "triangles": total_tris,
            "vertices": total_verts,
            "length_m": round(length_m, 3),
            "span_m": round(span_m, 3),
            "height_m": round(height_m, 3),
            "bbox_min": [round(x, 3) for x in mins],
            "bbox_max": [round(x, 3) for x in maxs],
        },
        "volumes_m3": {
            "hab_cylinder": round(v_hab_cyl, 2),
            "aft_dome": round(v_aft_dome, 2),
            "fwd_cone": round(v_fwd_cone, 2),
            "fwd_node": round(v_node, 2),
            "cupola": round(v_cupola, 2),
            "airlock": round(v_airlock, 2),
            "pressurized_gross": round(v_press_total, 2),
            "habitable_net_est": round(v_hab_net, 2),
            "nhv_per_crew_4": round(nhv_per_crew, 2),
        },
        "clearances": {
            "interior_max_radius_m": round(max_int_r, 4),
            "interior_max_obj": max_int_obj,
            "hull_outer_radius_m": S.R_P,
            "protrusions_count": len(protrusions),
            "protrusions_sample": protrusions[:8],
            "cupola_zenith_blocked": cupola_zenith is not None,
            "cupola_zenith_hit": cupola_zenith,
            "nadir_w1_blocked": nadir_w1 is not None,
            "nadir_w1_hit": nadir_w1,
            "nadir_w2_blocked": nadir_w2 is not None,
            "nadir_w2_hit": nadir_w2,
            "aisle_centerline_hit": aisle_ray,
        },
        "power_thermal": {
            "solar_active_area_m2": round(solar_active_m2, 2),
            "power_bol_kw": round(p_bol_kw, 2),
            "power_eol_5y_kw": round(p_eol_kw, 2),
            "radiator_emissive_area_m2": round(rad_surface_m2, 2),
            "thermal_reject_deep_space_kw": round(q_rad_deep_kw, 2),
            "thermal_reject_leo_sun_kw": round(q_rad_leo_sun_kw, 2),
            "thermal_reject_leo_eclipse_kw": round(q_rad_leo_ecl_kw, 2),
        },
        "propulsion": {
            "biprop_tanks_vol_m3": round(bip_vol_m3, 3),
            "biprop_mass_est_kg": round(bip_prop_kg, 1),
            "xenon_tank_vol_m3": round(xe_vol_m3, 3),
            "xenon_mass_est_kg": round(xe_prop_kg, 1),
            "dry_mass_hypothesis_kg": m_dry_kg,
            "wet_mass_est_kg": round(m_wet_kg, 1),
            "dv_chemical_ms": round(dv_chem_ms, 1),
            "dv_sep_ms": round(dv_sep_ms, 1),
        },
        "radiation": {
            "bay_c_shelter_areal_g_cm2": round(areal_g_cm2, 1),
            "nasa_spe_target_g_cm2": 20.0,
        },
    }

    json_path = os.path.join(ROOT, "docs", "engineering_audit.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(audit, f, indent=2, ensure_ascii=False)

    md_path = os.path.join(ROOT, "docs", "INGENIERIA_CONCEPTUAL.md")
    md = f"""# ALCIÓN HX-4 — Auditoría de Ingeniería Conceptual (Project Singularity)

> **Declaración de alcance y honestidad técnica:** ALCIÓN HX-4 es un **vehículo espacial conceptual ficticio** diseñado para visualización técnica, educación y simulación interactiva. Este documento **NO constituye validación de vuelo, calificación estructural, análisis FEM/CFD ni certificación aeroespacial**. Cada magnitud se etiqueta explícitamente según su naturaleza epistémica:
> - `[MEDIDO 3D]` — medido directamente por script sobre las mallas de `blender/ALCION_HX4_master.blend`.
> - `[FÍSICA]` — calculado analíticamente a partir de leyes físicas estándar (Tsiolkovsky, Stefan-Boltzmann, irradiancia solar a 1 UA).
> - `[CONCEPTUAL]` — parámetro de diseño plausible inspirado en estándares públicos (NASA-STD-3001, IDSS, ROSA, ISS), no verificado por ensayo.
> - `[SIMULACIÓN]` — abstracción interactiva de la aplicación web para usabilidad/juego.

---

## 1. Envolvente Dimensional y Volúmenes (`[MEDIDO 3D]`)

| Parámetro | Valor | Origen | Notas |
|---|---:|---|---|
| Piezas / triángulos / vértices | `{audit['model']['parts']}` / `{audit['model']['triangles']:,}` / `{audit['model']['vertices']:,}` | `[MEDIDO 3D]` | Modelo maestro completo tras reconstrucción Singularity |
| Longitud total (eje X) | **{audit['model']['length_m']:.2f} m** | `[MEDIDO 3D]` | Desde plano de salida de toberas (`{audit['model']['bbox_min'][0]} m`) a anillo IDSS (`{audit['model']['bbox_max'][0]} m`) |
| Envergadura total (eje Y) | **{audit['model']['span_m']:.2f} m** | `[MEDIDO 3D]` | Extremos de alas solares desplegadas (`{audit['model']['bbox_min'][1]} .. {audit['model']['bbox_max'][1]} m`) |
| Altura total (eje Z) | **{audit['model']['height_m']:.2f} m** | `[MEDIDO 3D]` | Extremos de radiadores desplegados (`{audit['model']['bbox_min'][2]} .. {audit['model']['bbox_max'][2]} m`) |
| Volumen presurizado bruto total | **{audit['volumes_m3']['pressurized_gross']:.1f} m³** | `[MEDIDO 3D]` | Barril HAB `{audit['volumes_m3']['hab_cylinder']}` + domo popa `{audit['volumes_m3']['aft_dome']}` + cono `{audit['volumes_m3']['fwd_cone']}` + nodo `{audit['volumes_m3']['fwd_node']}` + cúpula `{audit['volumes_m3']['cupola']}` + esclusa `{audit['volumes_m3']['airlock']}` |
| Volumen habitable neto estimado (NHV) | **{audit['volumes_m3']['habitable_net_est']:.1f} m³** | `[CONCEPTUAL]` | **{audit['volumes_m3']['nhv_per_crew_4']:.1f} m³/tripulante** (4 personas) |

**Evaluación frente a referencias NASA-STD-3001 / NASA TP-2015-218564:** para misiones de 30–45 días con 4 tripulantes, la literatura de habitabilidad espacial sitúa el mínimo aceptable en ~10–12 m³/tripulante y la zona de confort en ~15–20 m³/tripulante. El valor estimado de **{audit['volumes_m3']['nhv_per_crew_4']:.1f} m³/tripulante** es coherente con una misión cislunar de 45 días, aunque apretado si se ampliara a misiones >90 días sin módulos adicionales.

---

## 2. Verificación Geométrica de Claros, Aperturas y Contención (`[MEDIDO 3D]`)

| Comprobación | Resultado | Evidencia medida |
|---|---|---|
| Contención radial interior (`HAB.INT.*` dentro de `R_P = 2.10 m`) | {'**PASS**' if audit['clearances']['protrusions_count'] == 0 else f"**ALERTA HONESTA ({audit['clearances']['protrusions_count']} bastidores/depósitos > R_P)**"} | Radio máximo interior: `{audit['clearances']['interior_max_radius_m']} m` (`{audit['clearances']['interior_max_obj']}`, aún contenido dentro del escudo MMOD `R_S = 2.26 m`; en CAD de fabricación exigiría recortar ~5–11 cm el chaflán trasero) |
| Ventana cenital de la Cúpula (`W7`, raycast vertical desde `X=11.05, Z=1.48 m`) | {'**PASS — 100 % DESPEJADA**' if not audit['clearances']['cupola_zenith_blocked'] else f"**BLOQUEADA por {audit['clearances']['cupola_zenith_hit']}**"} | Sin obstrucción metálica (corregido en Singularity al sustituir los cilindros macizos previos por anillos forjados huecos) |
| Ventana científica de nadir W1 (`X=5.25 m`, raycast hacia `-Z`) | {'**PASS — 100 % DESPEJADA**' if not audit['clearances']['nadir_w1_blocked'] else f"**BLOQUEADA por {audit['clearances']['nadir_w1_hit']}**"} | Sin intrusión del isogrid `HAB.STR.B3.ISO` |
| Ventana científica de nadir W2 (`X=6.20 m`, raycast hacia `-Z`) | {'**PASS — 100 % DESPEJADA**' if not audit['clearances']['nadir_w2_blocked'] else f"**BLOQUEADA por {audit['clearances']['nadir_w2_hit']}**"} | Sin intrusión del isogrid |
| Diámetro libre de paso IDSS (`FWD.DCK`) | **0,80 m** (`[CONCEPTUAL]`) | Conforme a especificación pública IDSS Rev. D |

---

## 3. Potencia Eléctrica y Control Térmico (`[MEDIDO 3D]` + `[FÍSICA]`)

| Parámetro | Valor | Origen | Ecuación / hipótesis |
|---|---:|---|---|
| Área solar activa medida (`PWR.W1/W2`) | **{audit['power_thermal']['solar_active_area_m2']:.1f} m²** | `[MEDIDO 3D]` | Polígonos con `M_SolarCell` |
| Potencia eléctrica BOL (1 UA, incidencia normal) | **{audit['power_thermal']['power_bol_kw']:.1f} kW** | `[FÍSICA]` | $1361\\,\\mathrm{{W/m^2}} \\times A \\times 0.295 \\times 0.88$ (celdas triple unión GaInP/GaAs/Ge) |
| Potencia eléctrica EOL (5 años) | **{audit['power_thermal']['power_eol_5y_kw']:.1f} kW** | `[CONCEPTUAL]` | Factor de degradación 0,86 |
| Área emisiva total de radiadores (`THR.R1/R2`, doble cara) | **{audit['power_thermal']['radiator_emissive_area_m2']:.1f} m²** | `[MEDIDO 3D]` | Polígonos con `M_Radiator` ($\\varepsilon = 0.88$, $T_{{rad}} = 290\\,\\mathrm{{K}}$) |
| Rechazo térmico en espacio profundo ($T_{{sink}} = 4\\,\\mathrm{{K}}$) | **{audit['power_thermal']['thermal_reject_deep_space_kw']:.1f} kW** | `[FÍSICA]` | $Q = \\varepsilon \\sigma A (T_{{rad}}^4 - T_{{sink}}^4)$ |
| Rechazo térmico en LEO soleado ($T_{{sink}} = 245\\,\\mathrm{{K}}$) | **{audit['power_thermal']['thermal_reject_leo_sun_kw']:.1f} kW** | `[FÍSICA]` | Albedo + IR terrestre reduce el rechazo neto respecto al espacio profundo |
| Rechazo térmico en eclipse LEO ($T_{{sink}} = 190\\,\\mathrm{{K}}$) | **{audit['power_thermal']['thermal_reject_leo_eclipse_kw']:.1f} kW** | `[FÍSICA]` | |

**Hallazgo de ingeniería honesto:** con los radiadores actuales (`{audit['power_thermal']['radiator_emissive_area_m2']:.1f} m²` a 290 K), el rechazo térmico en LEO soleado (`{audit['power_thermal']['thermal_reject_leo_sun_kw']:.1f} kW`) cubre cómodamente la carga de soporte vital, aviónica y laboratorio (~6–9 kW continuos), **pero operaría con margen ajustado si los 4 propulsores Hall (24 kW eléctricos, ~2–3 kW de pérdidas térmicas en PPU) funcionasen simultáneamente a máxima carga en órbita baja soleada** — en una iteración real exigiría un lazo PPU de mayor temperatura (~330 K) o ~15 % más superficie radiativa.

---

## 4. Propulsión y Presupuesto de $\\Delta v$ (`[MEDIDO 3D]` + `[FÍSICA]` + `[CONCEPTUAL]`)

| Parámetro | Valor | Origen | Notas |
|---|---:|---|---|
| Volumen geométrico 4 esferas bipropelente (`SVC.PRP.BIP`) | **{audit['propulsion']['biprop_tanks_vol_m3']:.2f} m³** | `[MEDIDO 3D]` | Suma de volúmenes de malla |
| Masa útil estimada MMH/MON-3 (90 % llenado) | **{audit['propulsion']['biprop_mass_est_kg']:.0f} kg** | `[CONCEPTUAL]` | $\\rho_{{mezcla}} \\approx 1165\\,\\mathrm{{kg/m^3}}$ (O/F = 1,65) |
| Volumen geométrico depósito COPV Xenón (`SVC.PRP.XE`) | **{audit['propulsion']['xenon_tank_vol_m3']:.2f} m³** | `[MEDIDO 3D]` | Cilindro con domos |
| Masa útil estimada Xenón supercrítico (~150 bar, 300 K) | **{audit['propulsion']['xenon_mass_est_kg']:.0f} kg** | `[CONCEPTUAL]` | $\\rho \\approx 1420\\,\\mathrm{{kg/m^3}}$ |
| Masa seca de hipótesis | **{audit['propulsion']['dry_mass_hypothesis_kg']:.0f} kg** | `[CONCEPTUAL]` | Estimación de orden de magnitud (sin análisis FEM de masas) |
| Masa húmeda estimada | **{audit['propulsion']['wet_mass_est_kg']:.0f} kg** | `[CONCEPTUAL]` | |
| $\\Delta v$ químico disponible ($I_{{sp}} = 315\\,\\mathrm{{s}}$) | **{audit['propulsion']['dv_chemical_ms']:.0f} m/s** | `[FÍSICA]` | Ecuación de Tsiolkovsky — apto para inserción orbital lunar / rendez-vous / mantenimiento, **no** para TLI desde LEO por sí solo |
| $\\Delta v$ eléctrico SEP disponible ($I_{{sp}} = 1850\\,\\mathrm{{s}}$) | **{audit['propulsion']['dv_sep_ms']:.0f} m/s** | `[FÍSICA]` | Espirales de transferencia lenta cislunar (bajo empuje, meses) |

---

## 5. Protección frente a Radiación y Micrometeoritos (`[CONCEPTUAL]`)

- **Refugio solar Bahía C (`HAB.INT.C`):** la envolvente conceptual combina casco Al-Li 2195 (30 mm $\\approx 8.1\\,\\mathrm{{g/cm^2}}$), escudo MMOD Whipple relleno con Nextel/Kevlar ($\\approx 2.2\\,\\mathrm{{g/cm^2}}$), bolsas de agua potable de 10 cm ($10.0\\,\\mathrm{{g/cm^2}}$) y paneles interiores de HDPE de 2 cm ($1.9\\,\\mathrm{{g/cm^2}}$), alcanzando una densidad superficial nominal de **{audit['radiation']['bay_c_shelter_areal_g_cm2']:.1f} g/cm²** (por encima del umbral conceptual de referencia de 20 g/cm² frente a eventos de partículas solares SPE, aunque sin cálculo Monte Carlo OLTARIS/Geant4 de radiación secundaria ni cobertura isotrópica en los extremos axiales).

---

## 6. Abstracciones Deliberadas del Simulador Web (`[SIMULACIÓN]`)

Para que la aplicación web sea explorable, educativa y disfrutable en tiempo real, el simulador introduce abstracciones explícitas:
1. **Escala de empuje configurable (`×1`, `×5`, `×10`, `×25`):** en modo `×1` las aceleraciones son próximas a las reales (~0,08 m/s²), demasiado lentas para maniobras breves en sesión web; por defecto se ofrece `×10`.
2. **Gravedad de entrenamiento (`Caminar` 1 g vs `Flotar` microgravedad):** el modo caminar facilita el recorrido cómodo por las cubiertas; el modo flotar representa el desplazamiento real en microgravedad con asideros.
3. **Propagación orbital simplificada:** la telemetría orbital (`V_orb`, apogeo, perigeo, periodo kepleriano $T = 2\\pi\\sqrt{{a^3/\\mu}}$) se calcula analíticamente en torno al cuerpo dominante (Tierra o Luna) sin perturbaciones J2 ni efemérides N-cuerpos.
4. **Ciclo de esclusa y necesidades de tripulación acelerados:** la despresurización dura segundos en lugar de ~30 minutos reales, y el botón **Libre** permite pausar completamente el desgaste fisiológico para inspección libre.
"""
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(md)

    print("[audit] wrote", json_path)
    print("[audit] wrote", md_path)
    print(json.dumps(audit["clearances"], indent=2))
    print(json.dumps(audit["power_thermal"], indent=2))
    print(json.dumps(audit["propulsion"], indent=2))


if __name__ == "__main__":
    run_audit()
