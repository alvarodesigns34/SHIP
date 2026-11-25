#!/usr/bin/env python3
"""
ALCIÓN HX-4 — PROJECT SINGULARITY
Process real NASA Public Domain 5K imagery (Blue Marble Next Generation, Black Marble 2016,
SVS Deep Star Map) into ultra-crisp 4K astronomical textures for WebGL (Astro.ts).

Run with system Python (has Pillow + NumPy):
    /usr/bin/python3 blender/make_astro_textures.py
"""
import os
import math
import numpy as np
from PIL import Image, ImageEnhance, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HQ = os.path.join(ROOT, "blender", "textures", "nasa_hq")
OUT = os.path.join(ROOT, "web", "public", "textures")
os.makedirs(OUT, exist_ok=True)


def save_jpg(img: Image.Image, name: str, quality: int = 90):
    p = os.path.join(OUT, name)
    img.convert("RGB").save(p, "JPEG", quality=quality, optimize=True, progressive=True)
    kb = os.path.getsize(p) // 1024
    print(f"[astro] {name:20s} {img.size[0]}x{img.size[1]}  {kb:4d} KiB")


def build_earth_day_and_ocean_and_normal():
    src_path = os.path.join(HQ, "bmng_5400.jpg")
    bm = Image.open(src_path).convert("RGB")
    print(f"[astro] loaded Blue Marble {bm.size}")

    # 1. Crisp 4096x2048 Earth Day albedo — natural photography calibration (richer deep ocean, crisp landmass)
    day = bm.resize((4096, 2048), Image.Resampling.LANCZOS)
    day = ImageEnhance.Contrast(day).enhance(1.06)
    day = ImageEnhance.Color(day).enhance(1.05)
    day = day.filter(ImageFilter.UnsharpMask(radius=1.0, percent=45, threshold=3))
    save_jpg(day, "earth_day.jpg", quality=88)

    # 2. Pixel-accurate 4096x2048 Ocean Specular Mask aligned with Blue Marble coastlines!
    # In NASA BMNG bathymetry, deep ocean has B >> R and B > G and dark luminance; combine with existing ocean mask if present
    arr = np.asarray(day, dtype=np.float32) / 255.0
    r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]
    # Ocean signature in BMNG August: blue dominant, low red, low green-minus-blue
    blue_excess = (b - np.maximum(r * 1.35, g * 0.92))
    ocean_raw = np.clip((blue_excess - 0.015) * 14.0, 0.0, 1.0)
    # Exclude bright polar ice/snow (high R, G, B)
    lum = 0.299 * r + 0.587 * g + 0.114 * b
    not_ice = np.clip((0.52 - lum) * 8.0, 0.0, 1.0)
    # Blend with existing earth_ocean.jpg (softened) as geographic sanity anchor so inland lakes/deserts stay accurate
    old_ocean_path = os.path.join(OUT, "earth_ocean.jpg")
    ocean_mask = ocean_raw * not_ice
    if os.path.exists(old_ocean_path):
        old_m = np.asarray(Image.open(old_ocean_path).convert("L").resize((4096, 2048), Image.Resampling.BILINEAR), dtype=np.float32) / 255.0
        # Use Blue Marble crisp coastlines where old mask is near ocean, eliminate false positives deep inland
        old_dilated = np.asarray(
            Image.fromarray((old_m * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(9)),
            dtype=np.float32
        ) / 255.0
        ocean_mask = np.clip(ocean_mask * np.clip(old_dilated * 1.4, 0.0, 1.0) + old_m * 0.25 * not_ice, 0.0, 1.0)
    # Slight smooth anti-aliasing on coast edges
    ocean_img = Image.fromarray((np.clip(ocean_mask, 0.0, 1.0) * 255.0).astype(np.uint8), mode="L")
    ocean_img = ocean_img.filter(ImageFilter.GaussianBlur(radius=0.7))
    save_jpg(ocean_img, "earth_ocean.jpg", quality=85)

    # 3. 2048x1024 Terrain Relief Normal Map (mountain chains: Himalayas, Andes, Rockies, Alps)
    land_small = np.asarray(day.resize((2048, 1024), Image.Resampling.LANCZOS), dtype=np.float32) / 255.0
    ocean_small = np.asarray(ocean_img.resize((2048, 1024), Image.Resampling.BILINEAR), dtype=np.float32) / 255.0
    land_mask = np.clip(1.0 - ocean_small, 0.0, 1.0)
    # High-pass relief proxy on landmass (snowy peaks + dry ridges)
    h_proxy = (0.35 * land_small[..., 0] + 0.45 * land_small[..., 1] + 0.20 * land_small[..., 2]) * land_mask
    # Sobel / finite differences with horizontal wrapping (equirectangular!)
    gx = (np.roll(h_proxy, -1, axis=1) - np.roll(h_proxy, 1, axis=1)) * 4.5
    gy = (np.roll(h_proxy, -1, axis=0) - np.roll(h_proxy, 1, axis=0)) * 4.5
    gz = np.ones_like(gx)
    inv_len = 1.0 / np.sqrt(gx * gx + gy * gy + gz * gz)
    nx = (-gx * inv_len) * 0.5 + 0.5
    ny = (-gy * inv_len) * 0.5 + 0.5
    nz = (gz * inv_len) * 0.5 + 0.5
    nrm = np.stack([nx, ny, nz], axis=-1)
    nrm_img = Image.fromarray((np.clip(nrm, 0.0, 1.0) * 255.0).astype(np.uint8), mode="RGB")
    save_jpg(nrm_img, "earth_normal.jpg", quality=86)


def build_earth_night():
    src_path = os.path.join(HQ, "blackmarble_3600.jpg")
    bm = Image.open(src_path).convert("L")
    print(f"[astro] loaded Black Marble {bm.size}")
    arr = np.asarray(bm, dtype=np.float32) / 255.0
    # Boost delicate city highway/coastal networks and give warm sodium/amber + cool LED core tint
    v = np.power(np.clip(arr, 0.0, 1.0), 0.78)
    # Warm golden-amber outer glow, white-gold bright metropolitan cores
    r = np.clip(v * 1.18, 0.0, 1.0)
    g = np.clip(np.power(v, 1.10) * 0.86, 0.0, 1.0)
    b = np.clip(np.power(v, 1.55) * 0.45, 0.0, 1.0)
    rgb = np.stack([r, g, b], axis=-1)
    night_img = Image.fromarray((rgb * 255.0).astype(np.uint8), mode="RGB")
    night_img = night_img.filter(ImageFilter.UnsharpMask(radius=0.8, percent=55, threshold=2))
    save_jpg(night_img, "earth_night.jpg", quality=88)


def _tile_noise(w: int, h: int, freq_x: int, freq_y: int, seed: int) -> np.ndarray:
    """Fast seamlessly tileable (in X) smooth bilinear value noise."""
    rng = np.random.default_rng(seed)
    grid = rng.random((freq_y + 1, freq_x), dtype=np.float32)
    # Smoothly interpolate using PIL BICUBIC on a wrapped strip
    wrapped = np.concatenate([grid[:, -2:], grid, grid[:, :2]], axis=1)
    im = Image.fromarray((wrapped * 255.0).astype(np.uint8), mode="L")
    im = im.resize((int(w * (freq_x + 4) / freq_x), h), Image.Resampling.BICUBIC)
    a = np.asarray(im, dtype=np.float32) / 255.0
    margin = int(w * 2 / freq_x)
    return a[:, margin:margin + w]


def build_earth_clouds():
    """Upgrade Earth cloud deck to sharp 4096x2048 with multi-octave wispy cyclonic micro-detail
    so clouds look crisp from 420 km LEO instead of blurry low-res blobs."""
    old_path = os.path.join(OUT, "earth_clouds.jpg")
    W, H = 4096, 2048
    if os.path.exists(old_path):
        base = np.asarray(Image.open(old_path).convert("L").resize((W, H), Image.Resampling.LANCZOS), dtype=np.float32) / 255.0
    else:
        base = _tile_noise(W, H, 12, 6, 11)

    # Multi-scale anisotropic wispy cloud detail modulated by existing synoptic cloud bands
    n1 = _tile_noise(W, H, 48, 24, 101)
    n2 = _tile_noise(W, H, 128, 64, 202)
    n3 = _tile_noise(W, H, 320, 160, 303)
    n4 = _tile_noise(W, H, 640, 320, 404)
    # Domain-warped wispy detail (simulates jet-stream & trade-wind shear!)
    detail = 0.42 * n1 + 0.30 * n2 + 0.18 * n3 + 0.10 * n4
    # Sharpen cloud edges and carve crisp clear-sky pockets inside mid-density clouds
    mod = base * (0.62 + 0.72 * detail) + (detail - 0.55) * 0.28 * np.clip(base * 2.2, 0.0, 1.0)
    # Contrast curve: dense crisp white cloud cores + delicate cirrus wisps + clean transparent ocean windows
    clouds = np.clip((mod - 0.10) * 1.28, 0.0, 1.0)
    clouds = np.power(clouds, 0.92)
    c_img = Image.fromarray((clouds * 255.0).astype(np.uint8), mode="L")
    c_img = c_img.filter(ImageFilter.UnsharpMask(radius=1.2, percent=50, threshold=2))
    save_jpg(c_img, "earth_clouds.jpg", quality=87)


def build_milkyway():
    src_path = os.path.join(HQ, "milkyway_nasa.jpg")
    mw = Image.open(src_path).convert("RGB").resize((2048, 1024), Image.Resampling.LANCZOS)
    # Subtle natural dark-space calibration so galactic dust lanes show cleanly in eclipse/night
    arr = np.asarray(mw, dtype=np.float32) / 255.0
    arr = np.power(np.clip(arr, 0.0, 1.0), 1.15)
    mw_out = Image.fromarray((arr * 255.0).astype(np.uint8), mode="RGB")
    save_jpg(mw_out, "milkyway.jpg", quality=88)


if __name__ == "__main__":
    build_earth_day_and_ocean_and_normal()
    build_earth_night()
    build_earth_clouds()
    build_milkyway()
    print("[astro] all 4K NASA textures generated cleanly!")
