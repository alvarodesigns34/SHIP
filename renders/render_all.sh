#!/usr/bin/env bash
# Renders finales del ALCIÓN HX-4 (Cycles CPU). Uso: bash renders/render_all.sh [muestras]
set -e
cd "$(dirname "$0")/.."
S=${1:-96}
B=blender/ALCION_HX4_master.blend
blender -b $B --python blender/render.py -- --mode final --res 1920x1080 --samples $S --out renders --views hero,front34,dock,cockpit,interior_lab,interior_cq,section,hero2,aft34,cupola,engines,hall,interior_aft
blender -b $B --python blender/render.py -- --mode final --res 1920x1080 --samples $S --out renders --views exploded --explode 1.0
blender -b $B --python blender/render.py -- --mode final --res 1920x1080 --samples $S --out renders --views exploded_mid --explode 0.5
