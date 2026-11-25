#!/usr/bin/env bash
set -e
cd "$(dirname "$0")/.."
B=blender/ALCION_HX4_master.blend
blender -b $B --python blender/render.py -- --mode final --res 1920x1080 --samples 96 --out renders --views section,hero2,aft34,cupola,engines,hall
blender -b $B --python blender/render.py -- --mode final --res 1920x1080 --samples 96 --out renders --views exploded --explode 1.0
blender -b $B --python blender/render.py -- --mode final --res 1920x1080 --samples 96 --out renders --views exploded_mid --explode 0.5
blender -b $B --python blender/render.py -- --mode final --res 1920x1080 --samples 48 --out renders --views cockpit,interior_cq,interior_aft
