#!/usr/bin/env python3
"""
ALCIÓN HX-4 — PROJECT SINGULARITY
Posproceso de reducción de ruido Monte Carlo preservando bordes (NumPy puro)
para renders Cycles generados en builds de Blender sin OpenImageDenoise.

Combina:
  1. Supresión selectiva de fireflies (mediana 3x3 solo en píxeles que exceden la
     mediana local en > umbral, preservando texto y reflejos especulares reales).
  2. Dos pasadas de filtro bilateral preservando bordes (ventana 5x5 con sigma espacial
     y sigma fotométrica calibrada para alisar superficies difusas sin emborronar aristas).
"""
import os
import sys
import numpy as np
from PIL import Image


def despike_fireflies(arr, thresh=0.14):
    """Elimina píxeles firefly aislados respecto a la mediana 3x3 en luminancia."""
    H, W, _ = arr.shape
    pad = np.pad(arr, ((1, 1), (1, 1), (0, 0)), mode="edge")
    stack = np.stack(
        [pad[dy:dy + H, dx:dx + W] for dy in range(3) for dx in range(3)],
        axis=0,
    )
    med = np.median(stack, axis=0)
    lum = arr[..., 0] * 0.299 + arr[..., 1] * 0.587 + arr[..., 2] * 0.114
    med_lum = med[..., 0] * 0.299 + med[..., 1] * 0.587 + med[..., 2] * 0.114
    spike = np.abs(lum - med_lum) > thresh
    out = arr.copy()
    out[spike] = med[spike]
    return out


def bilateral(arr, radius=2, sigma_s=1.8, sigma_r=0.10):
    """Filtro bilateral vectorizado en NumPy (preserva aristas y tipografía)."""
    H, W, _ = arr.shape
    pad = np.pad(arr, ((radius, radius), (radius, radius), (0, 0)), mode="edge")
    acc = np.zeros_like(arr)
    wsum = np.zeros((H, W, 1), dtype=np.float32)
    inv_2s2 = 1.0 / (2.0 * sigma_s * sigma_s)
    inv_2r2 = 1.0 / (2.0 * sigma_r * sigma_r)
    for dy in range(-radius, radius + 1):
        for dx in range(-radius, radius + 1):
            ws = np.exp(-(dx * dx + dy * dy) * inv_2s2)
            nb = pad[radius + dy:radius + dy + H, radius + dx:radius + dx + W]
            diff = nb - arr
            dist2 = (diff[..., 0] ** 2 + diff[..., 1] ** 2 + diff[..., 2] ** 2) / 3.0
            wr = np.exp(-dist2 * inv_2r2)
            w = (ws * wr)[..., None]
            acc += nb * w
            wsum += w
    return acc / np.maximum(wsum, 1e-6)


def clean_render(path, strong=False):
    im = Image.open(path).convert("RGB")
    arr = np.asarray(im, dtype=np.float32) / 255.0
    arr = despike_fireflies(arr, thresh=0.10 if strong else 0.14)
    if strong:
        arr = bilateral(arr, radius=3, sigma_s=2.2, sigma_r=0.14)
        arr = bilateral(arr, radius=2, sigma_s=1.5, sigma_r=0.09)
    else:
        arr = bilateral(arr, radius=2, sigma_s=1.6, sigma_r=0.095)
        arr = bilateral(arr, radius=2, sigma_s=1.2, sigma_r=0.065)
    out = np.clip(arr * 255.0 + 0.5, 0, 255).astype(np.uint8)
    Image.fromarray(out, "RGB").save(path, optimize=True)
    print("[denoise]", path, os.path.getsize(path) // 1024, "KiB")


if __name__ == "__main__":
    targets = sys.argv[1:]
    for t in targets:
        strong = any(k in os.path.basename(t) for k in ("cockpit", "interior_"))
        clean_render(t, strong=strong)
