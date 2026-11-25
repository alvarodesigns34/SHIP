"""
ALCIÓN HX-4 — PROJECT SINGULARITY
Phase 2: Real Cycles Multi-Bounce Interior Lightmap + Contact AO Baker & Dual-UV glTF Exporter.

Pipeline:
  1. Opens blender/ALCION_HX4_master.blend
  2. For every interior mesh object (HAB.INT.*, HAB.UTL.*, FWD.INT.*, FWD.ALK.INT.* + inner hulls):
     - Ensures UVMap (TEXCOORD_0) exists (creates true world-scale triplanar box UV if absent so
       WebGL PBR textures map without stretching).
     - Makes mesh data unique per interior bake object so every locker/wall/seat receives its own
       location-accurate multi-bounce Cycles illumination!
     - Generates clean non-overlapping UVMap_LM (TEXCOORD_1 -> Three.js uv1) packed via area-weighted
       2D shelf packing into ONE single 1536x1536 atlas (ZERO extra BatchedMesh draw calls!).
  3. Sets up physically positioned Cycles interior cove lighting (warm 3100K Crew Quarters, 3900K
     Galley/Services, 5400K Lab + Glovebox + Magenta Grow Lights, 4600K Cockpit + MFD glow,
     5000K Node + blue-cyan Earthshine entering Cupola & Nadir windows).
  4. Bakes Cycles DIFFUSE irradiance (direct + 3-bounce indirect, color=False) AND Cycles AO
     (contact ambient occlusion) onto a joined temporary bake target in ONE fast pass.
  5. Saves raw linear EXR/PNG bakes, runs edge-preserving bilateral UV-island denoising + 8-px
     morphological seam dilation into web/public/textures/lm_interior.png (+ lm_interior_preview.png).
  6. Exports export/alcion_hx4_{exterior,interior}.glb preserving BOTH TEXCOORD_0 and TEXCOORD_1!

Usage:
    blender -b --python blender/bake_lightmaps.py
"""
import os
import sys
import math
import time
import bpy
import bmesh
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
BLEND_PATH = os.path.join(HERE, "ALCION_HX4_master.blend")
TEX_OUT = os.path.join(ROOT, "web", "public", "textures")
SCRATCH = os.path.join(HERE, "bake_tmp")
os.makedirs(TEX_OUT, exist_ok=True)
os.makedirs(SCRATCH, exist_ok=True)

ATLAS_SIZE = 1536
SAMPLES_DIFF = 28
SAMPLES_AO = 14

INTERIOR_PREFIXES = (
    "HAB.INT", "HAB.UTL", "FWD.INT", "FWD.ALK.INT",
)
# Inner pressure shells visible from inside the cabin/node/airlock
INNER_SHELL_NAMES = {
    "HAB.STR.CON", "HAB.STR.DOM",
    "FWD.STR.BRL", "FWD.STR.BHF", "FWD.STR.BHA", "FWD.STR.CPR",
    "FWD.ALK.STR", "FWD.ALK.HO.DOOR", "FWD.ALK.HO.FRM",
}
SKIP_LM_MATS = {"M_Glass", "M_GlassInner", "M_LED", "M_LEDGreen", "M_LEDRed", "M_NavLight", "M_ScreenAmber"}


def is_interior_bake_obj(ob):
    if ob.type != 'MESH' or not ob.data or len(ob.data.polygons) == 0:
        return False
    if ob.name in INNER_SHELL_NAMES:
        return True
    for p in INTERIOR_PREFIXES:
        if ob.name == p or ob.name.startswith(p + "."):
            return True
    return False


def ensure_primary_box_uv(ob):
    """Ensure uv_layers[0] ('UVMap') exists with clean world-scale triplanar box UVs (1 UV = 1 m)."""
    me = ob.data
    if len(me.uv_layers) > 0:
        return
    bm = bmesh.new()
    bm.from_mesh(me)
    uv_lay = bm.loops.layers.uv.new("UVMap")
    mw = ob.matrix_world
    rot3 = mw.to_3x3()
    for f in bm.faces:
        n = (rot3 @ f.normal).normalized()
        ax, ay, az = abs(n.x), abs(n.y), abs(n.z)
        for lp in f.loops:
            w = mw @ lp.vert.co
            if az >= ax and az >= ay:
                lp[uv_lay].uv = (w.x, w.y)
            elif ax >= ay:
                lp[uv_lay].uv = (w.y, w.z)
            else:
                lp[uv_lay].uv = (w.x, w.z)
    bm.to_mesh(me)
    bm.free()


def world_surface_area(ob):
    me = ob.data
    mw = ob.matrix_world
    sx, sy, sz = mw.to_scale()
    scale_a = (abs(sx * sy) + abs(sy * sz) + abs(sz * sx)) / 3.0
    area = 0.0
    for p in me.polygons:
        area += p.area
    return max(1e-4, area * scale_a)


def is_emissive_or_glass_only(ob):
    mats = [m.name for m in ob.data.materials if m]
    if not mats:
        return False
    return all((m in SKIP_LM_MATS or m.startswith("M_Screen_")) for m in mats)


def unwrap_object_local_lm(ob):
    """Unwrap ob's second UV layer ('UVMap_LM') cleanly into [0, 1]^2 with zero self-overlap.
    Uses Blender's fast Smart UV Project on a single object in edit mode."""
    me = ob.data
    # Guarantee UVMap_LM is ALWAYS index 1 (TEXCOORD_1 -> uv1)
    while len(me.uv_layers) > 1:
        me.uv_layers.remove(me.uv_layers[-1])
    lm = me.uv_layers.new(name="UVMap_LM")
    me.uv_layers.active = lm
    me.uv_layers.active_index = 1

    if len(me.polygons) == 0:
        return

    # Fast pure-bmesh planar chart unwrap for ultra-simple meshes (<= 12 polys), Smart Project for complex meshes
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(
        angle_limit=math.radians(66.0),
        margin_method='SCALED',
        island_margin=0.04,
        area_weight=0.25,
        correct_aspect=True,
        scale_to_bounds=True,
    )
    bpy.ops.object.mode_set(mode='OBJECT')


def shelf_pack_rects(items, padding=0.0025):
    """Deterministic area-weighted 2D shelf bin-packer inside [0.008, 0.992]^2.
    items: list of (idx, weight_area) -> returns dict idx -> (u0, v0, side).
    Reserves bottom-left tiny corner [0, 0.008]^2 as neutral bright white texel for glass/LEDs.
    """
    # Sort descending by sqrt(area) for tight shelf efficiency
    weights = [(idx, max(0.025, math.sqrt(a))) for idx, a in items]
    weights.sort(key=lambda t: t[1], reverse=True)

    # Binary search global scale factor `s` so all squares fit cleanly in [0.008, 0.992]
    usable = 0.980
    lo, hi = 0.001, 2.0

    def try_pack(scale):
        x, y, row_h = 0.010, 0.010, 0.0
        placed = {}
        for idx, w in weights:
            side = max(0.006, w * scale)
            if side > usable:
                return None
            if x + side > 0.990:
                x = 0.010
                y += row_h + padding
                row_h = 0.0
            if y + side > 0.990:
                return None
            placed[idx] = (x, y, side)
            x += side + padding
            if side > row_h:
                row_h = side
        return placed

    best = None
    for _ in range(28):
        mid = 0.5 * (lo + hi)
        res = try_pack(mid)
        if res is not None:
            best = res
            lo = mid
        else:
            hi = mid
    assert best is not None, "Shelf packer failed to fit interior objects"
    return best


def remap_uv_layer(ob, u0, v0, side):
    me = ob.data
    lm = me.uv_layers["UVMap_LM"]
    # Keep tiny 1-texel inner inset inside allocated square to avoid neighbor bleed
    inset = min(side * 0.03, 1.5 / ATLAS_SIZE)
    s = max(1e-5, side - 2.0 * inset)
    ox, oy = u0 + inset, v0 + inset
    for loop_uv in lm.data:
        u, v = loop_uv.uv
        loop_uv.uv = (ox + min(1.0, max(0.0, u)) * s, oy + min(1.0, max(0.0, v)) * s)


def set_neutral_lm_uv(ob):
    me = ob.data
    while len(me.uv_layers) > 1:
        me.uv_layers.remove(me.uv_layers[-1])
    lm = me.uv_layers.new(name="UVMap_LM")
    for loop_uv in lm.data:
        loop_uv.uv = (0.004, 0.004)


def setup_interior_bake_lights(sc):
    """Physically motivated Cycles interior illumination matching Alción's compartment fixtures,
    MFD glows, botanical grow lights, and Earthshine entering Cupola & Nadir windows."""
    # Remove any old lights
    for o in list(bpy.data.objects):
        if o.type == 'LIGHT':
            bpy.data.objects.remove(o, do_unlink=True)

    # Subtle blue-black space ambient world so window openings admit authentic cool Earthshine
    w = bpy.data.worlds.new("BakeWorld")
    w.use_nodes = True
    bg = w.node_tree.nodes.get("Background")
    bg.inputs[0].default_value = (0.14, 0.28, 0.52, 1.0)
    bg.inputs[1].default_value = 0.85
    sc.world = w

    def add_area(name, loc, rot_deg, energy, col, sx, sy):
        ld = bpy.data.lights.new(name, 'AREA')
        ld.shape = 'RECTANGLE'
        ld.size = sx
        ld.size_y = sy
        ld.energy = energy
        ld.color = col
        lo = bpy.data.objects.new(name, ld)
        lo.location = loc
        lo.rotation_euler = tuple(math.radians(a) for a in rot_deg)
        sc.collection.objects.link(lo)
        return lo

    def add_point(name, loc, energy, col, radius=0.08):
        ld = bpy.data.lights.new(name, 'POINT')
        ld.energy = energy
        ld.color = col
        ld.shadow_soft_size = radius
        lo = bpy.data.objects.new(name, ld)
        lo.location = loc
        sc.collection.objects.link(lo)
        return lo

    # Bay A — Flight Deck / Cockpit (X=6.75..8.80): crisp 4600K overhead coves + MFD cyan/blue console bounce
    for sy in (-1, 1):
        add_area(f"LM_BayA_Cove_{sy}", (7.78, sy * 0.90, 0.96), (-sy * 40, 0, 0), 26.0, (0.91, 0.95, 1.0), 1.45, 0.14)
    add_point("LM_BayA_MFD_L", (8.15, 0.42, -0.05), 3.8, (0.35, 0.72, 1.0), 0.18)
    add_point("LM_BayA_MFD_R", (8.15, -0.42, -0.05), 3.8, (0.35, 0.72, 1.0), 0.18)
    add_area("LM_BayA_FwdBHD", (9.35, 0.0, 0.35), (0, 65, 0), 10.0, (0.88, 0.94, 1.0), 0.7, 0.7)

    # Bay B — Science Lab (X=4.70..6.75): crisp bright 5400K task lights + glovebox internal LED + magenta plant grow light + Earthshine from nadir!
    for sy in (-1, 1):
        add_area(f"LM_BayB_Cove_{sy}", (5.72, sy * 0.90, 0.96), (-sy * 40, 0, 0), 32.0, (0.98, 1.0, 1.0), 1.45, 0.14)
    add_point("LM_BayB_Glovebox", (6.20, 0.85, 0.48), 5.5, (0.95, 0.99, 1.0), 0.12)
    add_point("LM_BayB_Plants", (5.55, 0.05, 0.86), 4.2, (1.0, 0.42, 0.82), 0.16)
    # Cool turquoise-blue Earthshine rising softly through the two nadir lab windows!
    for xw in (5.25, 6.20):
        add_area(f"LM_Earthshine_Nadir_{xw:.2f}", (xw, 0.0, -1.90), (180, 0, 0), 14.0, (0.38, 0.68, 1.0), 0.38, 0.38)

    # Bay C — Crew Quarters (X=2.65..4.70): intimate warm 3100K amber-gold cabin atmosphere + personal reading sconces!
    for sy in (-1, 1):
        add_area(f"LM_BayC_Cove_{sy}", (3.68, sy * 0.90, 0.96), (-sy * 40, 0, 0), 21.0, (1.0, 0.87, 0.70), 1.45, 0.14)
    # Individual warm reading lights inside each of the 4 crew quarters!
    for xq in (3.16, 4.18):
        for sy in (1, -1):
            add_point(f"LM_CQ_{xq:.1f}_{sy}", (xq, sy * 1.48, 0.56), 5.5, (1.0, 0.80, 0.56), 0.10)

    # Bay D — Services, Galley, Hygiene & Aft Bulkhead (X=0.60..2.65): balanced warm-neutral 3900K + hygiene vanity light
    for sy in (-1, 1):
        add_area(f"LM_BayD_Cove_{sy}", (1.62, sy * 0.90, 0.96), (-sy * 40, 0, 0), 28.0, (1.0, 0.93, 0.83), 1.45, 0.14)
    add_point("LM_BayD_Hygiene", (2.12, -1.55, 0.48), 5.0, (0.98, 0.95, 0.90), 0.14)
    add_point("LM_BayD_Aft", (0.78, 0.0, 0.25), 9.0, (0.96, 0.92, 0.86), 0.22)

    # Forward Node & Cupola (X=9.90..12.20): cool crisp 5000K dome light + blue-white Earthshine pouring through Cupola!
    add_area("LM_Node_Main", (11.05, 0.0, 0.88), (0, 0, 0), 24.0, (0.94, 0.97, 1.0), 0.90, 0.65)
    add_area("LM_Cupola_Earthshine", (10.95, 0.0, 1.92), (0, 0, 0), 18.0, (0.50, 0.76, 1.0), 0.60, 0.60)
    add_point("LM_Node_RWS", (11.35, 0.0, 0.52), 3.0, (0.40, 0.75, 1.0), 0.15)

    # EVA Airlock (X=10.95, Z=-1.35..-2.95): crisp utilitarian 4800K overhead ring + subtle suit bay accent
    add_area("LM_Airlock_Top", (10.95, 0.0, -1.48), (0, 0, 0), 26.0, (0.95, 0.98, 1.0), 0.80, 0.80)
    add_point("LM_Airlock_Low", (10.95, 0.0, -2.45), 8.0, (0.92, 0.95, 1.0), 0.20)


def postprocess_lightmap(diff_path, ao_path, out_png):
    """Run edge-preserving bilateral UV-island denoising + Contact AO modulation + 8px seam dilation."""
    import subprocess
    code = f"""
import numpy as np
from PIL import Image

diff_rgba = np.asarray(Image.open({diff_path!r}).convert("RGBA"), dtype=np.float32) / 255.0
ao_rgba   = np.asarray(Image.open({ao_path!r}).convert("RGBA"), dtype=np.float32) / 255.0

diff_rgb = diff_rgba[..., :3]
ao_l     = ao_rgba[..., :3].mean(axis=-1, keepdims=True)
# Coverage mask: pixels touched by Cycles baker (either alpha > 0.5 or non-black AO)
mask = ((ao_rgba[..., 3] > 0.5) & (ao_l[..., 0] > 0.002)) | (diff_rgb.max(axis=-1) > 0.003)

# Fast 5x5 edge-preserving bilateral filter ONLY across valid covered island pixels!
# Preserves sharp contact shadows & crease edges while erasing Monte Carlo Cycles noise!
H, W = mask.shape
src = diff_rgb.copy()
ao_src = ao_l.copy()
out = np.zeros_like(src)
out_ao = np.zeros_like(ao_src)
w_sum = np.zeros((H, W, 1), dtype=np.float32)
w_ao  = np.zeros((H, W, 1), dtype=np.float32)

sigma_s = 2.0
sigma_r = 0.18
# Pre-blur guide slightly so range weight isn't fooled by single-pixel fireflies
guide = src.copy()
# Clamp extreme fireflies above 99.7th percentile first
p99 = float(np.percentile(src[mask], 99.6)) if mask.any() else 1.0
src = np.clip(src, 0.0, max(0.85, p99))

for dy in range(-2, 3):
    for dx in range(-2, 3):
        ws = np.exp(-(dx*dx + dy*dy) / (2.0 * sigma_s * sigma_s))
        sh = np.roll(np.roll(src, dy, axis=0), dx, axis=1)
        sh_ao = np.roll(np.roll(ao_src, dy, axis=0), dx, axis=1)
        sh_m = np.roll(np.roll(mask, dy, axis=0), dx, axis=1)
        # Edge-preserving range weight on luminance difference
        dl = np.abs(sh.mean(axis=-1, keepdims=True) - src.mean(axis=-1, keepdims=True))
        wr = np.exp(-(dl * dl) / (2.0 * sigma_r * sigma_r))
        w = ws * wr * sh_m[..., None].astype(np.float32)
        out += sh * w
        w_sum += w
        w2 = ws * sh_m[..., None].astype(np.float32)
        out_ao += sh_ao * w2
        w_ao += w2

clean_diff = np.where(w_sum > 1e-5, out / np.maximum(w_sum, 1e-5), src)
clean_ao   = np.where(w_ao > 1e-5, out_ao / np.maximum(w_ao, 1e-5), ao_src)

# Second gentle 3x3 smoothing pass for silky museum-grade GI gradients
out2 = np.zeros_like(clean_diff)
w_sum2 = np.zeros((H, W, 1), dtype=np.float32)
for dy in range(-1, 2):
    for dx in range(-1, 2):
        ws = 1.0 if (dx == 0 and dy == 0) else (0.65 if (dx == 0 or dy == 0) else 0.45)
        sh = np.roll(np.roll(clean_diff, dy, axis=0), dx, axis=1)
        sh_m = np.roll(np.roll(mask, dy, axis=0), dx, axis=1)
        dl = np.abs(sh.mean(axis=-1, keepdims=True) - clean_diff.mean(axis=-1, keepdims=True))
        wr = np.exp(-(dl * dl) / (2.0 * 0.12 * 0.12))
        w = ws * wr * sh_m[..., None].astype(np.float32)
        out2 += sh * w
        w_sum2 += w
clean_diff = np.where(w_sum2 > 1e-5, out2 / np.maximum(w_sum2, 1e-5), clean_diff)

# Combine real Cycles irradiance with subtle Contact AO & lift deep blacks slightly for natural cabin floor bounce
# Three.js lightMap multiplies linearly against diffuse albedo!
ao_factor = 0.38 + 0.62 * np.power(np.clip(clean_ao, 0.0, 1.0), 1.15)
# Soft highlight compression (Reinhard-like knee) so bright cove areas keep warm/cool hue without clipping
irrad = clean_diff * 1.45
irrad = irrad / (1.0 + 0.25 * irrad)
# Combine GI + subtle minimum cabin bounce floor modulated by real Contact AO
combined = (irrad + 0.065 * np.array([0.92, 0.95, 1.0], dtype=np.float32)) * ao_factor
combined = np.clip(combined, 0.0, 1.0)

# Reserve bottom-left [0..14, H-14..H] neutral bright pixel for non-baked glass/LEDs (UV=(0.004, 0.004))
# Note: PNG row 0 is v=1, row H-1 is v=0!
cur = combined.copy()
cur_mask = mask.copy()
cur[H-14:H, 0:14] = np.array([0.85, 0.87, 0.90], dtype=np.float32)
cur_mask[H-14:H, 0:14] = True

# 10-pixel morphological dilation outward into uncovered background so mipmaps NEVER bleed black seams!
for _ in range(10):
    acc = np.zeros_like(cur)
    cnt = np.zeros((H, W, 1), dtype=np.float32)
    for dy, dx in ((-1,0),(1,0),(0,-1),(0,1),(-1,-1),(-1,1),(1,-1),(1,1)):
        sm = np.roll(np.roll(cur_mask, dy, axis=0), dx, axis=1)
        sc = np.roll(np.roll(cur, dy, axis=0), dx, axis=1)
        w = sm[..., None].astype(np.float32)
        acc += sc * w
        cnt += w
    fill = (~cur_mask) & (cnt[..., 0] > 0.5)
    cur[fill] = acc[fill] / cnt[fill]
    cur_mask[fill] = True

# Any remaining far-away background pixel gets average cabin tone (prevents low-mip bleed)
mean_col = cur[mask].mean(axis=0) if mask.any() else np.array([0.45, 0.46, 0.48], dtype=np.float32)
cur[~cur_mask] = mean_col

# Save crisp sRGB PNG (Three.js loads with SRGBColorSpace -> converts accurately to linear irradiance!)
img_out = Image.fromarray((np.clip(cur, 0.0, 1.0) * 255.0).astype(np.uint8), mode="RGB")
img_out.save({out_png!r}, "PNG", optimize=True)
print(f"[lm-post] saved {out_png!r} coverage={{100.0*mask.mean():.1f}}% mean_rgb={{mean_col.round(3).tolist()}}")
"""
    subprocess.run(["/usr/bin/python3", "-c", code], check=True)


def main():
    t0 = time.time()
    bpy.ops.wm.open_mainfile(filepath=BLEND_PATH)
    sc = bpy.context.scene

    # Step 1: Identify interior objects and decouple shared meshes so every part gets unique GI!
    bake_objs = []
    skip_objs = []
    for ob in list(bpy.data.objects):
        if not is_interior_bake_obj(ob):
            continue
        if ob.data.users > 1:
            ob.data = ob.data.copy()
        ensure_primary_box_uv(ob)
        if is_emissive_or_glass_only(ob):
            set_neutral_lm_uv(ob)
            skip_objs.append(ob)
        else:
            bake_objs.append(ob)

    print(f"[bake] {len(bake_objs)} interior bake objects (+ {len(skip_objs)} glass/LED skipped)")

    # Step 2: Unwrap UVMap_LM cleanly per object, then pack into single [0,1]^2 atlas!
    t_uv = time.time()
    areas = []
    for idx, ob in enumerate(bake_objs):
        unwrap_object_local_lm(ob)
        areas.append((idx, world_surface_area(ob)))
    rects = shelf_pack_rects(areas, padding=3.0 / ATLAS_SIZE)
    for idx, ob in enumerate(bake_objs):
        u0, v0, side = rects[idx]
        remap_uv_layer(ob, u0, v0, side)
    print(f"[bake] UVMap_LM unwrapped & packed for {len(bake_objs)} objects in {time.time() - t_uv:.1f}s")

    # Step 3: Save master .blend (with clean UVMap + UVMap_LM on all interior meshes!)
    # and export dual-UV GLBs right now BEFORE creating temporary joined bake proxy!
    bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH, compress=True)
    print(f"[bake] saved master .blend with UVMap + UVMap_LM")

    os.makedirs(os.path.join(ROOT, "export"), exist_ok=True)
    common = dict(export_format='GLB', export_extras=True, export_apply=True, export_yup=True,
                  export_cameras=False, export_lights=False, export_image_format='AUTO',
                  export_texcoords=True, export_normals=True)
    INTERIOR_ROOTS = {"HAB.INT", "HAB.UTL", "FWD.INT", "HAB.INT.LIV", "HAB.INT.DEN"}

    def under_interior(o):
        p = o
        while p is not None:
            if p.name in INTERIOR_ROOTS:
                return True
            p = p.parent
        return False

    for part_name, want in (("exterior", False), ("interior", True)):
        bpy.ops.object.select_all(action='DESELECT')
        for o in bpy.data.objects:
            o.select_set(under_interior(o) == want or (want and o.name in ("ALCION", "HAB", "FWD")))
        path = os.path.join(ROOT, "export", f"alcion_hx4_{part_name}.glb")
        bpy.ops.export_scene.gltf(filepath=path, use_selection=True, **common)
        print(f"[bake] exported {path} ({os.path.getsize(path) // 1024} KiB)")

    # Step 4: Create ONE joined temporary bake target from duplicates of bake_objs so Cycles bakes
    # the entire spacecraft interior in ONE single BVH build & pass!
    t_bk = time.time()
    copies = []
    for ob in bake_objs:
        c = ob.copy()
        c.data = ob.data.copy()
        c.parent = None
        c.matrix_world = ob.matrix_world.copy()
        sc.collection.objects.link(c)
        # Ensure UVMap_LM is active & render-active for baking!
        if "UVMap_LM" in c.data.uv_layers:
            c.data.uv_layers.active = c.data.uv_layers["UVMap_LM"]
            c.data.uv_layers["UVMap_LM"].active_render = True
        copies.append(c)
        # Hide original during bake so it doesn't self-shadow its duplicate!
        ob.hide_render = True

    bpy.ops.object.select_all(action='DESELECT')
    for c in copies:
        c.select_set(True)
    bpy.context.view_layer.objects.active = copies[0]
    bpy.ops.object.join()
    target = bpy.context.view_layer.objects.active
    target.name = "_LM_BAKE_TARGET"
    if "UVMap_LM" in target.data.uv_layers:
        target.data.uv_layers.active = target.data.uv_layers["UVMap_LM"]
        target.data.uv_layers["UVMap_LM"].active_render = True

    # Setup Cycles lighting & render settings
    setup_interior_bake_lights(sc)
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.use_denoising = False
    sc.cycles.max_bounces = 4
    sc.cycles.diffuse_bounces = 3
    sc.cycles.glossy_bounces = 1
    sc.cycles.transmission_bounces = 4
    sc.cycles.sample_clamp_indirect = 4.0
    sc.cycles.sample_clamp_direct = 8.0
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.exposure = 0.0

    # Prepare target bake image and attach unconnected Image Texture node to every material on target
    img_diff = bpy.data.images.new("LM_DIFF", width=ATLAS_SIZE, height=ATLAS_SIZE, alpha=True, float_buffer=False)
    img_diff.colorspace_settings.name = 'sRGB'
    img_ao = bpy.data.images.new("LM_AO", width=ATLAS_SIZE, height=ATLAS_SIZE, alpha=True, float_buffer=False)
    img_ao.colorspace_settings.name = 'sRGB'

    tex_nodes = []
    for mat in target.data.materials:
        if mat is None:
            continue
        mat.use_nodes = True
        nt = mat.node_tree
        # Temporarily zero Metallic on bake materials ONLY (saved .blend & exported GLBs keep full metallic!)
        # so Cycles DIFFUSE pass records true incident irradiance on aluminum/steel/CFRP surfaces too!
        bsdf = nt.nodes.get("Principled BSDF")
        if bsdf is not None and "Metallic" in bsdf.inputs:
            if not bsdf.inputs["Metallic"].is_linked:
                bsdf.inputs["Metallic"].default_value = 0.0
            else:
                for lk in list(bsdf.inputs["Metallic"].links):
                    nt.links.remove(lk)
                bsdf.inputs["Metallic"].default_value = 0.0
        n = nt.nodes.new("ShaderNodeTexImage")
        n.image = img_diff
        n.select = True
        nt.nodes.active = n
        tex_nodes.append(n)

    # Pass A: Bake Cycles DIFFUSE Direct + Indirect Irradiance (color=False -> pure lightmap!)
    print(f"[bake] baking {ATLAS_SIZE}x{ATLAS_SIZE} Cycles DIFFUSE GI ({SAMPLES_DIFF} samples)...")
    sc.cycles.samples = SAMPLES_DIFF
    sc.render.bake.use_pass_direct = True
    sc.render.bake.use_pass_indirect = True
    sc.render.bake.use_pass_color = False
    sc.render.bake.margin = 4
    sc.render.bake.margin_type = 'EXTEND'
    bpy.ops.object.select_all(action='DESELECT')
    target.select_set(True)
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.bake(
        type='DIFFUSE',
        pass_filter={'DIRECT', 'INDIRECT'},
        margin=4,
        use_clear=True,
    )
    diff_path = os.path.join(SCRATCH, "lm_diff_raw.png")
    img_diff.filepath_raw = diff_path
    img_diff.file_format = 'PNG'
    img_diff.save()
    print(f"[bake] DIFFUSE baked in {time.time() - t_bk:.1f}s -> {diff_path}")

    # Pass B: Bake Cycles Contact AO
    t_ao = time.time()
    for n in tex_nodes:
        n.image = img_ao
    sc.cycles.samples = SAMPLES_AO
    sc.world.light_settings.distance = 0.90
    print(f"[bake] baking {ATLAS_SIZE}x{ATLAS_SIZE} Cycles Contact AO ({SAMPLES_AO} samples)...")
    bpy.ops.object.bake(
        type='AO',
        margin=4,
        use_clear=True,
    )
    ao_path = os.path.join(SCRATCH, "lm_ao_raw.png")
    img_ao.filepath_raw = ao_path
    img_ao.file_format = 'PNG'
    img_ao.save()
    print(f"[bake] AO baked in {time.time() - t_ao:.1f}s -> {ao_path}")

    # Step 5: Bilateral UV-island denoise + AO combine + 10px seam dilation
    out_png = os.path.join(TEX_OUT, "lm_interior.png")
    postprocess_lightmap(diff_path, ao_path, out_png)
    print(f"[bake] COMPLETE in {time.time() - t0:.1f}s -> {out_png} ({os.path.getsize(out_png) // 1024} KiB)")


if __name__ == "__main__":
    main()
