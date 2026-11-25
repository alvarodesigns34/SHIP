#!/usr/bin/env python3
"""
ALCIÓN HX-4 — PROJECT SINGULARITY
Sincronización y verificación byte-a-byte (SHA-256) entre la documentación maestra
(`docs/`, `blueprints/`) y los recursos publicados por la web (`web/public/`).

Uso:
  python3 scripts/sync_all.py           # sincroniza y verifica SHA-256
  python3 scripts/sync_all.py --check   # solo verifica, sale con código 1 si hay desfase
"""
import hashlib
import os
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHECK_ONLY = "--check" in sys.argv

PAIRS = [
    ("docs/inventario.json", "web/public/data/inventario.json"),
    ("docs/inventario.csv", "web/public/data/inventario.csv"),
]

BP_DIR = os.path.join(ROOT, "blueprints")
for fn in sorted(os.listdir(BP_DIR)):
    if fn.endswith(".png"):
        PAIRS.append((f"blueprints/{fn}", f"web/public/blueprints/{fn}"))


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


mismatches = 0
for src_rel, dst_rel in PAIRS:
    src = os.path.join(ROOT, src_rel)
    dst = os.path.join(ROOT, dst_rel)
    if not os.path.exists(src):
        print(f"[ERR] falta origen: {src_rel}")
        mismatches += 1
        continue
    if not CHECK_ONLY:
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy2(src, dst)
    if not os.path.exists(dst):
        print(f"[FAIL] falta destino: {dst_rel}")
        mismatches += 1
        continue
    hs, hd = sha256(src), sha256(dst)
    if hs != hd:
        print(f"[FAIL] SHA-256 distinto: {src_rel} ({hs[:12]}) != {dst_rel} ({hd[:12]})")
        mismatches += 1
    else:
        print(f"[OK] {dst_rel} ({hs[:12]}, {os.path.getsize(dst) // 1024} KiB)")

if mismatches:
    print(f"\nFALLO DE SINCRONIZACIÓN: {mismatches} desfase(s)")
    sys.exit(1)

print(f"\nSINCRONIZACIÓN VERIFICADA: {len(PAIRS)} archivos idénticos byte a byte.")
