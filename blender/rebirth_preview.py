"""Render de comprobación (Cycles, CPU) del interior Rebirth desde cámaras fijas.

Uso: python3 blender/rebirth_preview.py <salida_dir> [cam1,cam2] [muestras] [ancho]
Sólo para iterar el modelado: NO es evidencia del renderizado en tiempo real.
"""
import sys, os, math
import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
args = [a for a in sys.argv[1:] if not a.endswith('.py')]
out = args[0] if args else '/tmp/rb'
which = args[1].split(',') if len(args) > 1 else ['cockpit']
spp = int(args[2]) if len(args) > 2 else 32
W = int(args[3]) if len(args) > 3 else 960
os.makedirs(out, exist_ok=True)

bpy.ops.wm.open_mainfile(filepath=os.path.join(HERE, 'ALCION_HX4_master.blend'))
import alcion.habitat as habitat
habitat.bake_lights()

CAMS = {
    'cockpit': ((6.2, -0.35, 0.75), (9.2, 0.2, -0.05), 74),
    'seat': ((7.50, 0.78, 0.12), (9.3, 0.78, 0.35), 74),
    'cockpit_up': ((7.6, 0.0, 0.2), (9.4, 0.0, 1.5), 80),
    'aft': ((8.3, 0.0, 0.45), (2.0, 0.0, 0.0), 74),
    'lab': ((4.40, 0.30, 0.45), (6.6, -0.6, -0.4), 74),
    'quarters': ((3.65, -0.40, 0.40), (3.65, 1.45, -0.10), 74),
    'galley': ((2.60, 0.25, 0.42), (0.85, -0.55, -0.25), 74),
    'cupola': ((11.05, 0.0, 0.95), (11.35, 0.2, 2.3), 78),
    'node': ((10.4, 0.0, 0.4), (12.0, 0.0, 0.0), 78),
    'ext': ((22, 26, 9), (2.5, 0, 0), 34),
    'extfwd': ((15.5, 5.5, 4.5), (9.4, 0, 0.8), 36),
}
sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.device = 'CPU'
sc.cycles.samples = spp
sc.cycles.use_denoising = True
sc.render.resolution_x = W
sc.render.resolution_y = int(W * 9 / 16)
sc.view_settings.view_transform = 'AgX'
sc.view_settings.look = 'None'
world = bpy.data.worlds.new('w') if not sc.world else sc.world
sc.world = world
world.use_nodes = True
bg = world.node_tree.nodes.get('Background')
bg.inputs[0].default_value = (0.0, 0.0, 0.0, 1)
bg.inputs[1].default_value = 0.0
# Sol (luz exterior a través de las ventanas)
sun = bpy.data.objects.new('SUN', bpy.data.lights.new('SUN', 'SUN'))
sun.data.energy = 4.0
sun.rotation_euler = (math.radians(35), math.radians(-40), 0)
sc.collection.objects.link(sun)
cam = bpy.data.objects.new('CAM', bpy.data.cameras.new('CAM'))
sc.collection.objects.link(cam)
sc.camera = cam
for name in which:
    p, t, fov = CAMS[name]
    cam.location = Vector(p)
    d = Vector(t) - Vector(p)
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    cam.data.angle = math.radians(fov)
    cam.data.clip_start = 0.02
    sc.render.filepath = os.path.join(out, name + '.png')
    bpy.ops.render.render(write_still=True)
    print('RENDER', sc.render.filepath)
