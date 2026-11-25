"""
ALCIÓN HX-4 — PROJECT SINGULARITY
Build rigged anatomical first-person hands, cuffed Varro-Lindqvist flight-suit sleeves,
sculpted pressurized EVA space-gloves, and detailed 3D held props from MIT-licensed
WebXR anatomical 25-joint rigged hands (blender/assets/webxr_hands/{left,right}.glb).

Output:
    web/public/models/hands_fp.glb

Coordinate convention in exported glTF (Three.js Y-up space):
  Each hand root (`Hand_L`, `Hand_R`) places:
    - Wrist joint centered at (0, 0, 0)
    - Fingers extending forward along -Z
    - Back of hand facing +Y, Palm facing -Y
    - Thumb on inward side (+X for Left, -X for Right)
    - Forearm sleeve extending back along +Z (0.0 -> +0.42 m)
  Inside each Hand root:
    - `Armature_L` / `Armature_R` (25 real anatomical bones)
    - `SkinHand_L` / `SkinHand_R` (continuous smooth anatomical skinned mesh)
    - `EVAGlove_L` / `EVAGlove_R` (sculpted inflated pressurized glove skinned to SAME skeleton)
    - `Sleeve_L` / `Sleeve_R` (cuffed navy flight-suit forearm + Varro-Lindqvist mission stripe)
    - `EVAGauntlet_L` / `EVAGauntlet_R` (white pressurized EVA gauntlet + anodized wrist disconnect ring)
    - `Props_L` / `Props_R` -> `prop_pouch`, `prop_tray`, `prop_board`, `prop_wipe`

Usage:
    blender -b --python blender/build_hands.py
"""
import os
import math
import bpy
import bmesh
from mathutils import Vector, Matrix, Euler

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ASSETS = os.path.join(HERE, "assets", "webxr_hands")
TEX_CREW = os.path.join(HERE, "textures", "crew_atlas.png")
OUT_GLB = os.path.join(ROOT, "web", "public", "models", "hands_fp.glb")
os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)


def make_pbr_mat(name, color, rough=0.5, metal=0.0, coat=0.0, sheen=0.0, emit=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if "Coat Weight" in bsdf.inputs:
        bsdf.inputs["Coat Weight"].default_value = coat
    if "Sheen Weight" in bsdf.inputs:
        bsdf.inputs["Sheen Weight"].default_value = sheen
    if emit is not None:
        bsdf.inputs["Emission Color"].default_value = (*emit, 1.0)
        bsdf.inputs["Emission Strength"].default_value = 1.6
    return m


def make_tablet_screen_mat():
    m = bpy.data.materials.new("M_FP_TabletScreen")
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    bsdf.inputs["Roughness"].default_value = 0.08
    bsdf.inputs["Metallic"].default_value = 0.0
    if os.path.exists(TEX_CREW):
        img = bpy.data.images.load(TEX_CREW)
        img.pack()
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = img
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Emission Color"])
        bsdf.inputs["Emission Strength"].default_value = 1.4
    else:
        bsdf.inputs["Base Color"].default_value = (0.1, 0.25, 0.35, 1.0)
        bsdf.inputs["Emission Color"].default_value = (0.15, 0.55, 0.75, 1.0)
        bsdf.inputs["Emission Strength"].default_value = 1.2
    return m


def _bm_pillow(bm, sx, sy, sz, nx=8, ny=8, nz=4, puff=0.008, roundness=0.6, center=(0, 0, 0), rot=None):
    """Puffed rounded rectangular pillow (for realistic foil drink pouch & meal packets)."""
    res = bmesh.ops.create_cube(bm, size=1.0)
    verts = res["verts"]
    bmesh.ops.subdivide_edges(bm, edges=list({e for v in verts for e in v.link_edges}),
                              cuts=max(nx, ny, nz) - 1, use_grid_fill=True)
    # collect all newly created verts by bounding cube
    all_v = [v for v in bm.verts if max(abs(v.co.x), abs(v.co.y), abs(v.co.z)) <= 0.501]
    R = rot if rot is not None else Matrix.Identity(4)
    c = Vector(center)
    for v in all_v:
        ux, uy, uz = v.co.x * 2.0, v.co.y * 2.0, v.co.z * 2.0
        # Superellipsoid rounding + central pillow inflation
        sx_ = math.copysign(abs(ux) ** (1.0 - 0.22 * roundness), ux)
        sy_ = math.copysign(abs(uy) ** (1.0 - 0.22 * roundness), uy)
        sz_ = math.copysign(abs(uz) ** (1.0 - 0.22 * roundness), uz)
        bulge = max(0.0, (1.0 - ux * ux * 0.85) * (1.0 - uy * uy * 0.85))
        p = Vector((
            sx_ * sx * 0.5,
            sy_ * sy * 0.5,
            sz_ * sz * 0.5 + math.copysign(bulge * puff, uz if abs(uz) > 1e-4 else 1.0)
        ))
        v.co = c + (R.to_3x3() @ p)


def _new_mesh_obj(name, bm, mat, parent=None):
    me = bpy.data.meshes.new(name)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    if mat:
        me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    if parent:
        ob.parent = parent
    return ob


def build_sleeve(name, is_eva, parent, mats):
    """Build cuffed forearm sleeve extending along +Y in Blender (= -Z? Wait: let's match Hand local space!).
    In Blender space, after rotating the WebXR hand so:
      - fingers point along +Y in Blender -> exports as -Z in Three.js!
      - back of hand faces +Z in Blender -> exports as +Y in Three.js!
      - wrist extends along -Y in Blender -> exports as +Z in Three.js!
    """
    ob_root = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(ob_root)
    ob_root.parent = parent

    # 1. Forearm main fabric tube along -Y in Blender (y = -0.02 .. -0.42)
    bm = bmesh.new()
    segs = 28
    rings = 14
    r_wrist = 0.044 if is_eva else 0.036
    r_elbow = 0.068 if is_eva else 0.056
    prev = None
    for ri in range(rings):
        t = ri / (rings - 1)
        y = -0.012 - t * 0.40
        # Slight anatomical flare + subtle fabric folds
        r = r_wrist + (r_elbow - r_wrist) * (t ** 0.85)
        if is_eva:
            r += 0.0028 * math.sin(t * math.pi * 12.0)  # pressurized thermal ribs
        else:
            r += 0.0014 * math.sin(t * math.pi * 7.0 + 0.6)
        ring_v = []
        for s in range(segs):
            a = 2.0 * math.pi * s / segs
            # Slightly oval forearm cross-section (wider in X, shallower in Z)
            rx = r * 1.10
            rz = r * 0.88
            ring_v.append(bm.verts.new((rx * math.cos(a), y, rz * math.sin(a))))
        if prev is not None:
            for s in range(segs):
                s2 = (s + 1) % segs
                bm.faces.new((prev[s], prev[s2], ring_v[s2], ring_v[s]))
        prev = ring_v
    _new_mesh_obj(f"{name}_Tube", bm, mats["eva_gauntlet"] if is_eva else mats["sleeve"], ob_root)

    # 2. Wrist cuff (knitted dark cuff + Varro-Lindqvist vermilion accent stripe, OR anodized EVA disconnect ring)
    bm_c = bmesh.new()
    if is_eva:
        # Anodized titanium disconnect bearing ring + locking latch collar
        for ri, (y, rx, rz) in enumerate([
            (0.006, 0.046, 0.038), (0.004, 0.051, 0.043), (-0.018, 0.052, 0.044),
            (-0.022, 0.047, 0.039), (-0.030, 0.049, 0.041), (-0.036, 0.046, 0.038)
        ]):
            rv = [bm_c.verts.new((rx * math.cos(2 * math.pi * s / 32), y, rz * math.sin(2 * math.pi * s / 32))) for s in range(32)]
            if ri > 0:
                for s in range(32):
                    s2 = (s + 1) % 32
                    bm_c.faces.new((prev_c[s], prev_c[s2], rv[s2], rv[s]))
            prev_c = rv
        _new_mesh_obj(f"{name}_Ring", bm_c, mats["metal_ring"], ob_root)
    else:
        # Ribbed knitted dark cuff at wrist
        for ri in range(6):
            t = ri / 5.0
            y = 0.008 - t * 0.046
            rr = 0.0355 + 0.002 * math.sin(t * math.pi)
            rv = [bm_c.verts.new((rr * 1.10 * math.cos(2 * math.pi * s / 28), y, rr * 0.86 * math.sin(2 * math.pi * s / 28))) for s in range(28)]
            if ri > 0:
                for s in range(28):
                    s2 = (s + 1) % 28
                    bm_c.faces.new((prev_c[s], prev_c[s2], rv[s2], rv[s]))
            prev_c = rv
        _new_mesh_obj(f"{name}_Cuff", bm_c, mats["cuff"], ob_root)

        # Varro-Lindqvist vermilion accent band around sleeve just above cuff
        bm_s = bmesh.new()
        for ri, y in enumerate((-0.058, -0.072)):
            rr = 0.0405
            rv = [bm_s.verts.new((rr * 1.11 * math.cos(2 * math.pi * s / 28), y, rr * 0.89 * math.sin(2 * math.pi * s / 28))) for s in range(28)]
            if ri > 0:
                for s in range(28):
                    s2 = (s + 1) % 28
                    bm_s.faces.new((prev_s[s], prev_s[s2], rv[s2], rv[s]))
            prev_s = rv
        _new_mesh_obj(f"{name}_Stripe", bm_s, mats["accent"], ob_root)
    return ob_root


def build_props(side_sign, parent, mats):
    """Build sculpted 3D held props positioned in palm space (Blender coords: +Y forward, +Z up, -Z palm).
    side_sign: -1 for Left, +1 for Right.
    """
    pg = bpy.data.objects.new(f"Props_{'L' if side_sign < 0 else 'R'}", None)
    bpy.context.collection.objects.link(pg)
    pg.parent = parent

    # 1. prop_pouch: Puffed pleated silver-foil space drink pouch + blue valve + curved drinking straw!
    pouch_g = bpy.data.objects.new("prop_pouch", None)
    bpy.context.collection.objects.link(pouch_g)
    pouch_g.parent = pg
    pouch_g.location = (0.0, 0.082, -0.022)
    # Puffed foil body
    bm = bmesh.new()
    _bm_pillow(bm, 0.082, 0.024, 0.122, nx=8, ny=4, nz=10, puff=0.011, roundness=0.58)
    _new_mesh_obj("pouch_body", bm, mats["foil"], pouch_g)
    # Heat-sealed perimeter flange + vermilion Varro-Lindqvist beverage band
    bm_f = bmesh.new()
    bmesh.ops.create_cube(bm_f, size=1.0, matrix=Matrix.Diagonal((0.088, 0.003, 0.128, 1.0)))
    _new_mesh_obj("pouch_seam", bm_f, mats["foil_dark"], pouch_g)
    bm_b = bmesh.new()
    bmesh.ops.create_cube(bm_b, size=1.0, matrix=Matrix.Translation((0, 0, 0.026)) @ Matrix.Diagonal((0.078, 0.032, 0.018, 1.0)))
    _new_mesh_obj("pouch_band", bm_b, mats["accent"], pouch_g)
    # Blue septum lock clip + curved silicone drinking straw + bite valve
    bm_v = bmesh.new()
    bmesh.ops.create_cone(bm_v, cap_ends=True, segments=16, radius1=0.009, radius2=0.008, depth=0.022,
                          matrix=Matrix.Translation((0, 0, 0.070)))
    _new_mesh_obj("pouch_valve", bm_v, mats["blue_clip"], pouch_g)
    bm_st = bmesh.new()
    pts = [Vector((0, 0, 0.078)), Vector((0, -0.004, 0.105)), Vector((0, -0.014, 0.128)), Vector((0, -0.026, 0.142))]
    prev = None
    for i, p in enumerate(pts):
        d = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        q = d.to_track_quat('Z', 'X').to_matrix()
        r_s = 0.0038 if i < len(pts) - 1 else 0.0048
        rv = [bm_st.verts.new(p + q @ Vector((r_s * math.cos(2 * math.pi * k / 12), r_s * math.sin(2 * math.pi * k / 12), 0))) for k in range(12)]
        if prev:
            for k in range(12):
                k2 = (k + 1) % 12
                bm_st.faces.new((prev[k], prev[k2], rv[k2], rv[k]))
        prev = rv
    _new_mesh_obj("pouch_straw", bm_st, mats["straw"], pouch_g)

    # 2. prop_tray: Brushed aluminum meal tray + 3 puffed thermostabilized meal packets + astronaut spoon
    tray_g = bpy.data.objects.new("prop_tray", None)
    bpy.context.collection.objects.link(tray_g)
    tray_g.parent = pg
    tray_g.location = (-0.095 * side_sign, 0.095, -0.015)
    bm_t = bmesh.new()
    bmesh.ops.create_cube(bm_t, size=1.0, matrix=Matrix.Diagonal((0.26, 0.18, 0.010, 1.0)))
    bmesh.ops.bevel(bm_t, geom=list(bm_t.edges), offset=0.003, segments=2, affect='EDGES')
    _new_mesh_obj("tray_base", bm_t, mats["metal_ring"], tray_g)
    # 3 distinct puffed meal packets secured under blue bungee strap
    for k, (px, mkey) in enumerate([(-0.078, "food_1"), (0.0, "food_2"), (0.078, "food_3")]):
        bm_p = bmesh.new()
        _bm_pillow(bm_p, 0.068, 0.115, 0.022, nx=5, ny=6, nz=3, puff=0.006, roundness=0.55, center=(px, 0.0, 0.018))
        _new_mesh_obj(f"tray_pack_{k}", bm_p, mats[mkey], tray_g)
    # Stainless long-handled astronaut spoon
    bm_sp = bmesh.new()
    bmesh.ops.create_cube(bm_sp, size=1.0, matrix=Matrix.Translation((0.0, -0.068, 0.014)) @ Matrix.Diagonal((0.16, 0.008, 0.003, 1.0)))
    bmesh.ops.create_uvsphere(bm_sp, u_segments=12, v_segments=8, radius=0.016,
                              matrix=Matrix.Translation((0.088, -0.068, 0.014)) @ Matrix.Diagonal((1.4, 0.75, 0.25, 1.0)))
    _new_mesh_obj("tray_spoon", bm_sp, mats["foil"], tray_g)

    # 3. prop_board: Sleek anodized aerospace flight tablet with illuminated UI display (crew_atlas tile 3)
    board_g = bpy.data.objects.new("prop_board", None)
    bpy.context.collection.objects.link(board_g)
    board_g.parent = pg
    board_g.location = (-0.045 * side_sign, 0.115, 0.028)
    board_g.rotation_euler = Euler((math.radians(-42), 0.0, 0.0), 'XYZ')
    bm_tb = bmesh.new()
    bmesh.ops.create_cube(bm_tb, size=1.0, matrix=Matrix.Diagonal((0.205, 0.275, 0.011, 1.0)))
    bmesh.ops.bevel(bm_tb, geom=list(bm_tb.edges), offset=0.003, segments=2, affect='EDGES')
    _new_mesh_obj("tablet_chassis", bm_tb, mats["tablet_body"], board_g)
    # Illuminated UI glass quad mapped to tile 3 (top-right of 4x2 crew_atlas: u=0.75..1.0, v=0.5..1.0)
    bm_sc = bmesh.new()
    uv = bm_sc.loops.layers.uv.new("UVMap")
    hw, hh = 0.091, 0.125
    vs = [bm_sc.verts.new(p) for p in ((-hw, -hh, 0.0062), (hw, -hh, 0.0062), (hw, hh, 0.0062), (-hw, hh, 0.0062))]
    f = bm_sc.faces.new(vs)
    for loop, uv_p in zip(f.loops, ((0.752, 0.504), (0.998, 0.504), (0.998, 0.996), (0.752, 0.996))):
        loop[uv].uv = uv_p
    _new_mesh_obj("tablet_screen", bm_sc, mats["tablet_screen"], board_g)

    # 4. prop_wipe: Soft folded wrinkled white microfiber hygiene cloth
    wipe_g = bpy.data.objects.new("prop_wipe", None)
    bpy.context.collection.objects.link(wipe_g)
    wipe_g.parent = pg
    wipe_g.location = (0.0, 0.075, -0.022)
    bm_w = bmesh.new()
    _bm_pillow(bm_w, 0.095, 0.095, 0.012, nx=7, ny=7, nz=3, puff=0.005, roundness=0.5)
    _new_mesh_obj("wipe_cloth", bm_w, mats["wipe"], wipe_g)

    return pg


def build_hand_side(side: str, mats):
    """Import MIT WebXR anatomical rigged hand, orient cleanly into canonical wrist-origin frame,
    add smooth subdivision, clone + inflate pressurized EVA glove on the SAME 25-joint armature,
    attach sleeve + EVA gauntlet + held props."""
    tag = "L" if side == "left" else "R"
    side_sign = -1 if side == "left" else 1
    glb_path = os.path.join(ASSETS, f"{side}.glb")

    before_objs = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=glb_path)
    added = [o for o in bpy.data.objects if o not in before_objs]

    # Remove helper Icosphere if present
    arm = None
    mesh_ob = None
    for o in list(added):
        if o.type == 'ARMATURE':
            arm = o
        elif o.type == 'MESH' and 'handMesh' in o.name:
            mesh_ob = o
        elif o.name.startswith("Icosphere"):
            bpy.data.objects.remove(o, do_unlink=True)

    assert arm is not None and mesh_ob is not None, f"Failed to import {side} WebXR hand"

    # Compute exact canonical transform so in Blender:
    #   wrist = (0, 0, 0)
    #   fingers point along +Y  (which glTF exports as -Z in Three.js!)
    #   back of hand faces +Z   (which glTF exports as +Y in Three.js!)
    #   thumb points inward: +X for Left, -X for Right (unchanged in glTF X!)
    # Wait: let's verify current WebXR orientation in Blender:
    #   Right hand: fingers = -Z, back of hand = +X, thumb = +Y (and -X)
    #   Left hand:  fingers = -Z, back of hand = -X, thumb = +Y (and +X)
    # Check rotation matrix M_rot:
    #   For Right hand (back=+X -> +Z, fingers=-Z -> +Y, thumb=+Y -> -X):
    #     e_x_new (right/pinky) = -Y_old
    #     e_y_new (forward/fingers) = -Z_old
    #     e_z_new (up/back) = +X_old
    #     det([0,-1,0; 0,0,-1; 1,0,0]) = +1 (proper right-handed rotation!)
    #   For Left hand (back=-X -> +Z, fingers=-Z -> +Y, thumb=+Y -> +X):
    #     e_x_new (right/thumb) = +Y_old
    #     e_y_new (forward/fingers) = -Z_old
    #     e_z_new (up/back) = -X_old
    #     det([0,1,0; 0,0,-1; -1,0,0]) = +1 (proper right-handed rotation!)
    if side == "right":
        R_canon = Matrix((
            (0.0, -1.0,  0.0, 0.0),
            (0.0,  0.0, -1.0, 0.0),
            (1.0,  0.0,  0.0, 0.0),
            (0.0,  0.0,  0.0, 1.0),
        ))
    else:
        R_canon = Matrix((
            ( 0.0,  1.0,  0.0, 0.0),
            ( 0.0,  0.0, -1.0, 0.0),
            (-1.0,  0.0,  0.0, 0.0),
            ( 0.0,  0.0,  0.0, 1.0),
        ))

    wrist_old = arm.data.bones["wrist"].head_local.copy()
    T_canon = R_canon @ Matrix.Translation(-wrist_old)

    # Create canonical Hand_L / Hand_R parent container at origin
    root = bpy.data.objects.new(f"Hand_{tag}", None)
    bpy.context.collection.objects.link(root)

    arm.name = f"Armature_{tag}"
    arm.parent = root
    # Place canonical transform on an intermediate rig carrier so skinned bone local axes stay intact!
    rig_holder = bpy.data.objects.new(f"RigHolder_{tag}", None)
    bpy.context.collection.objects.link(rig_holder)
    rig_holder.parent = root
    rig_holder.matrix_basis = T_canon
    arm.parent = rig_holder

    # Rename & assign realistic human skin material to anatomical mesh
    mesh_ob.name = f"SkinHand_{tag}"
    mesh_ob.data.name = f"SkinHand_{tag}_Mesh"
    mesh_ob.data.materials.clear()
    mesh_ob.data.materials.append(mats["skin"])
    for p in mesh_ob.data.polygons:
        p.use_smooth = True

    # Build sculpted pressurized EVA Space-Glove skinned to the EXACT SAME 25-joint armature!
    glove_mesh = mesh_ob.data.copy()
    glove_mesh.name = f"EVAGlove_{tag}_Mesh"
    # Inflate slightly along vertex normals (pressurized thermal bladder + knuckle ribs)
    bm = bmesh.new()
    bm.from_mesh(glove_mesh)
    bm.normal_update()
    for v in bm.verts:
        # Extra slight thickness over palm & knuckles, clean taper at cuff
        inflate = 0.0052
        # Add subtle horizontal knuckle mobility pleats along finger axis (old -Z)
        rib = 0.0011 * math.sin(v.co.z * 260.0)
        v.co += v.normal * (inflate + rib)
    bm.to_mesh(glove_mesh)
    bm.free()
    glove_mesh.materials.clear()
    glove_mesh.materials.append(mats["eva_glove"])
    glove_mesh.materials.append(mats["eva_grip"])
    # Assign dark silicone RTV grip material to palm-facing faces (normal pointing inward: -X for R, +X for L)
    palm_nx = -1.0 if side == "right" else 1.0
    for p in glove_mesh.polygons:
        p.use_smooth = True
        if p.normal.x * palm_nx > 0.35 and p.center.z < 0.03:
            p.material_index = 1
        else:
            p.material_index = 0

    glove_ob = bpy.data.objects.new(f"EVAGlove_{tag}", glove_mesh)
    bpy.context.collection.objects.link(glove_ob)
    glove_ob.parent = arm
    # Copy vertex groups & Armature modifier so EVA glove deforms identically with all 25 bones!
    for vg in mesh_ob.vertex_groups:
        nvg = glove_ob.vertex_groups.new(name=vg.name)
        for v in mesh_ob.data.vertices:
            for g in v.groups:
                if g.group == vg.index:
                    nvg.add([v.index], g.weight, 'REPLACE')
    mod = glove_ob.modifiers.new(name="Armature", type='ARMATURE')
    mod.object = arm

    # Attach sleeves & props directly to canonical Hand root (already aligned at wrist=(0,0,0)!)
    build_sleeve(f"Sleeve_{tag}", False, root, mats)
    build_sleeve(f"EVAGauntlet_{tag}", True, root, mats)
    build_props(side_sign, root, mats)

    # Verify wrist-relative bounds in canonical space
    bpy.context.view_layer.update()
    mw = mesh_ob.matrix_world
    pts = [mw @ v.co for v in mesh_ob.data.vertices]
    print(f"[hands] {tag} canonical Blender bounds: "
          f"X:[{min(p.x for p in pts):.3f},{max(p.x for p in pts):.3f}] "
          f"Y(fwd):[{min(p.y for p in pts):.3f},{max(p.y for p in pts):.3f}] "
          f"Z(up):[{min(p.z for p in pts):.3f},{max(p.z for p in pts):.3f}] "
          f"bones={len(arm.data.bones)} verts={len(mesh_ob.data.vertices)}")
    return root


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mats = {
        "skin": make_pbr_mat("M_FP_Skin", (0.58, 0.36, 0.25), rough=0.52, metal=0.0, sheen=0.18),
        "sleeve": make_pbr_mat("M_FP_Sleeve", (0.065, 0.095, 0.155), rough=0.82, metal=0.0, sheen=0.45),
        "cuff": make_pbr_mat("M_FP_Cuff", (0.032, 0.045, 0.072), rough=0.88, metal=0.0, sheen=0.35),
        "accent": make_pbr_mat("M_FP_Accent", (0.68, 0.16, 0.05), rough=0.48, metal=0.0, sheen=0.2),
        "eva_glove": make_pbr_mat("M_FP_EVAGlove", (0.82, 0.80, 0.76), rough=0.68, metal=0.0, sheen=0.30),
        "eva_grip": make_pbr_mat("M_FP_EVAGrip", (0.14, 0.15, 0.17), rough=0.78, metal=0.0),
        "eva_gauntlet": make_pbr_mat("M_FP_EVAGauntlet", (0.76, 0.74, 0.70), rough=0.72, metal=0.0, sheen=0.35),
        "metal_ring": make_pbr_mat("M_FP_MetalRing", (0.62, 0.65, 0.70), rough=0.28, metal=0.88),
        "foil": make_pbr_mat("M_FP_Foil", (0.76, 0.79, 0.83), rough=0.26, metal=0.86),
        "foil_dark": make_pbr_mat("M_FP_FoilSeam", (0.52, 0.55, 0.60), rough=0.38, metal=0.82),
        "blue_clip": make_pbr_mat("M_FP_ClipBlue", (0.08, 0.28, 0.72), rough=0.42, metal=0.0),
        "straw": make_pbr_mat("M_FP_Straw", (0.86, 0.89, 0.92), rough=0.22, metal=0.0, coat=0.4),
        "food_1": make_pbr_mat("M_FP_Food1", (0.45, 0.24, 0.09), rough=0.55, metal=0.15),
        "food_2": make_pbr_mat("M_FP_Food2", (0.66, 0.58, 0.42), rough=0.58, metal=0.12),
        "food_3": make_pbr_mat("M_FP_Food3", (0.24, 0.36, 0.14), rough=0.55, metal=0.15),
        "tablet_body": make_pbr_mat("M_FP_TabletBody", (0.09, 0.10, 0.12), rough=0.38, metal=0.65),
        "tablet_screen": make_tablet_screen_mat(),
        "wipe": make_pbr_mat("M_FP_Wipe", (0.88, 0.88, 0.86), rough=0.92, metal=0.0, sheen=0.5),
    }

    build_hand_side("left", mats)
    build_hand_side("right", mats)

    bpy.ops.export_scene.gltf(
        filepath=OUT_GLB,
        export_format='GLB',
        export_yup=True,
        export_apply=False,
        export_skins=True,
        export_all_influences=False,
        export_materials='EXPORT',
        export_texcoords=True,
        export_normals=True,
        export_animations=False,
    )
    kb = os.path.getsize(OUT_GLB) // 1024
    print(f"[hands] exported {OUT_GLB} ({kb} KiB)")


if __name__ == "__main__":
    main()
