#!/usr/bin/env bash
# Renders restantes de la regeneración Ultimate Fidelity (Cycles CPU)
set -e
cd "$(dirname "$0")/.."
S=${1:-48}
B=blender/ALCION_HX4_master.blend
blender -b $B --python blender/render.py -- --mode final --res 1920x1080 --samples $S --out renders --views aft34,cupola,engines,hall,interior_aft
blender -b $B --python blender/render.py -- --mode final --res 1920x1080 --samples $S --out renders --views exploded --explode 1.0
blender -b $B --python blender/render.py -- --mode final --res 1920x1080 --samples $S --out renders --views exploded_mid --explode 0.5
