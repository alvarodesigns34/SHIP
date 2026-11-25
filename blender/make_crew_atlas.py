"""
ALCIÓN HX-4 — Project Singularity: High-resolution crew photos, laptop screens,
mission patches, instrument OLEDs, and technical placards atlas (2048x1024).

Grid layout (4 columns x 2 rows = 8 rich panels, each 512x512):
  0: Earthrise from Lunar Orbit photograph (personal crew photo)
  1: Alpine mountain lake & aurora photograph (personal crew photo)
  2: Crew portrait / mission emblem patch — Varro-Lindqvist Expedition IV
  3: Laptop screen — Mission Daily Flight Plan & Scientific Log (Spanish)
  4: Laptop screen — Orbital Mechanics & Experiment Telemetry Dashboard
  5: Glovebox / Lab OLED environmental & pressure telemetry panel
  6: Cryo-Freezer -80.4 °C & Galley Water Dispenser OLED instrument faces
  7: Airlock depressurization schematic & caution checklist placard
"""
import math
import os
import random
from PIL import Image, ImageDraw, ImageFont, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "textures", "crew_atlas.png")
W, H = 2048, 1024
CELL = 512

FD = "/usr/share/fonts/truetype/dejavu/"


def font(sz, bold=False, mono=False):
    name = "DejaVuSansMono-Bold.ttf" if (mono and bold) else (
        "DejaVuSansMono.ttf" if mono else ("DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf")
    )
    p = os.path.join(FD, name)
    return ImageFont.truetype(p, sz) if os.path.exists(p) else ImageFont.load_default()


def draw_photo_earthrise(im):
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, CELL, CELL], fill=(5, 7, 12))
    rnd = random.Random(101)
    for _ in range(260):
        x, y = rnd.randint(18, CELL - 18), rnd.randint(18, CELL - 175)
        b = rnd.randint(90, 230)
        d.point((x, y), fill=(b, b, min(255, b + 15)))
    # Composite real NASA Earth disc with sunlit crescent & soft atmospheric halo
    bmng_p = os.path.join(HERE, "textures", "nasa_hq", "bmng_5400.jpg")
    cx, cy, r = 278, 178, 92
    glow = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([cx - r - 10, cy - r - 10, cx + r + 10, cy + r + 10], fill=(70, 150, 255, 165))
    glow = glow.filter(ImageFilter.GaussianBlur(14))
    im.paste(glow.convert("RGB"), (0, 0), glow.split()[3])
    if os.path.exists(bmng_p):
        earth_src = Image.open(bmng_p).convert("RGB").crop((1600, 350, 3200, 1950)).resize((r * 2, r * 2), Image.LANCZOS)
        # Apply spherical limb shading + crescent terminator
        import numpy as np
        arr = np.asarray(earth_src, dtype=np.float32)
        yy, xx = np.mgrid[-r:r, -r:r].astype(np.float32) / r
        rr2 = xx * xx + yy * yy
        mask = rr2 <= 1.0
        zz = np.sqrt(np.clip(1.0 - rr2, 0.0, 1.0))
        ndl = np.clip(xx * 0.72 + yy * -0.25 + zz * 0.65, 0.0, 1.0)
        rim = np.power(1.0 - zz, 2.5) * np.clip(ndl * 2.2, 0, 1)
        shaded = arr * (ndl[..., None] * 1.15 + 0.02) + np.array([55, 130, 255])[None, None, :] * rim[..., None] * 0.9
        shaded = np.clip(shaded, 0, 255).astype(np.uint8)
        e_img = Image.fromarray(shaded, "RGB")
        m_img = Image.fromarray((mask * 255).astype(np.uint8), "L").filter(ImageFilter.GaussianBlur(1))
        im.paste(e_img, (cx - r, cy - r), m_img)
    # Real NASA Lunar surface foreground
    moon_p = os.path.join(HERE, "textures", "nasa", "moon_lroc_color_2k.jpg")
    if os.path.exists(moon_p):
        m_src = Image.open(moon_p).convert("RGB").crop((200, 300, 1600, 720)).resize((CELL, 135), Image.LANCZOS)
        im.paste(m_src, (0, 325))
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, CELL - 1, CELL - 1], outline=(235, 232, 224), width=18)
    d.rectangle([0, CELL - 62, CELL, CELL], fill=(235, 232, 224))
    d.text((28, CELL - 46), "ÓRBITA LUNAR · EXP. ALCIÓN-04", fill=(32, 36, 44), font=font(20, bold=True))


def draw_photo_landscape(im):
    d = ImageDraw.Draw(im)
    for y in range(320):
        t = y / 320.0
        r = int(12 + 160 * (t ** 2.6))
        g = int(22 + 78 * (t ** 1.8))
        b = int(58 + 72 * (1 - abs(t - 0.35)))
        d.line([(0, y), (CELL, y)], fill=(min(255, r), min(255, g), min(255, b)))
    # Soft blurred photographic aurora curtain
    aur = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    ad = ImageDraw.Draw(aur)
    for x in range(0, CELL, 3):
        yb = int(105 + 32 * math.sin(x * 0.011) + 18 * math.cos(x * 0.023))
        ad.line([(x, yb), (x, yb - 65)], fill=(64, 235, 165, 110), width=4)
        ad.line([(x, yb - 45), (x, yb - 92)], fill=(125, 92, 230, 70), width=4)
    aur = aur.filter(ImageFilter.GaussianBlur(10))
    im.paste(aur.convert("RGB"), (0, 0), aur.split()[3])
    d = ImageDraw.Draw(im)
    d.polygon([(0, 325), (95, 200), (195, 275), (312, 162), (425, 265), (512, 218), (512, 360), (0, 360)], fill=(26, 34, 48))
    d.polygon([(312, 162), (342, 205), (305, 195), (284, 210)], fill=(210, 224, 238))
    for y in range(325, CELL - 60):
        t = (y - 325) / (CELL - 385)
        d.line([(0, y), (CELL, y)], fill=(int(22 + 48 * (1 - t)), int(48 + 44 * (1 - t)), int(82 + 34 * (1 - t))))
    d.rectangle([0, 0, CELL - 1, CELL - 1], outline=(235, 232, 224), width=18)
    d.rectangle([0, CELL - 62, CELL, CELL], fill=(235, 232, 224))
    d.text((28, CELL - 46), "ABISKO · SUECIA  —  HASTA PRONTO", fill=(32, 36, 44), font=font(20, bold=True))


def draw_mission_patch(im):
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, CELL, CELL], fill=(14, 24, 42))
    d.ellipse([24, 24, CELL - 24, CELL - 24], fill=(14, 26, 52), outline=(232, 168, 48), width=14)
    d.ellipse([44, 44, CELL - 44, CELL - 44], outline=(218, 92, 38), width=5)
    d.arc([94, 120, CELL - 94, CELL - 140], 195, 345, fill=(96, 186, 255), width=7)
    d.ellipse([325, 130, 380, 185], fill=(220, 224, 230))
    d.ellipse([125, 238, 212, 325], fill=(38, 108, 196))
    d.polygon([(256, 132), (318, 262), (256, 228), (194, 262)], fill=(238, 96, 44), outline=(245, 240, 232))
    for sx, sy in [(188, 104), (232, 86), (280, 86), (324, 104)]:
        d.ellipse([sx - 6, sy - 6, sx + 6, sy + 6], fill=(255, 238, 175))
    d.text((134, 338), "ALCIÓN HX-4", fill=(244, 242, 236), font=font(34, bold=True))
    d.text((148, 382), "EXPEDICIÓN CISLUNAR", fill=(232, 168, 48), font=font(18, bold=True))


def draw_laptop_plan(im):
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, CELL, CELL], fill=(10, 16, 26))
    d.rectangle([0, 0, CELL, 52], fill=(18, 32, 52))
    d.text((20, 14), "VLA-OS  ·  PLAN DIARIO  ·  DÍA 12", fill=(102, 206, 255), font=font(22, bold=True, mono=True))
    d.line([(0, 52), (CELL, 52)], fill=(45, 95, 145), width=2)
    rows = [
        ("07:30", "REVISIÓN ECLSS / FILTROS CO2", "COMPLETADO", (92, 224, 138)),
        ("09:00", "GUANTERA: MUESTRAS REGOLITO", "EN CURSO", (255, 184, 68)),
        ("11:30", "RIEGO CULTIVO HIDROPÓNICO", "PENDIENTE", (150, 180, 210)),
        ("13:00", "ALMUERZO · REHIDRATACIÓN", "PENDIENTE", (150, 180, 210)),
        ("14:30", "EJERCICIO CEVIS + ARED (60m)", "PENDIENTE", (150, 180, 210)),
        ("16:30", "OBSERVACIÓN CÚPULA / TIERRA", "PENDIENTE", (102, 206, 255)),
        ("19:00", "ENLACE RED ESPACIO PROFUNDO", "PROGRAMADO", (150, 180, 210)),
    ]
    y = 74
    for tm, task, st, col in rows:
        d.rectangle([16, y, CELL - 16, y + 48], fill=(16, 25, 38), outline=(34, 52, 74))
        d.text((26, y + 12), tm, fill=(102, 206, 255), font=font(18, bold=True, mono=True))
        d.text((104, y + 12), task, fill=(224, 232, 240), font=font(15, mono=True))
        d.text((CELL - 122, y + 14), st, fill=col, font=font(13, bold=True, mono=True))
        y += 56
    d.rectangle([16, CELL - 44, CELL - 16, CELL - 12], fill=(20, 38, 56))
    d.text((26, CELL - 37), "CABINA 21,8°C · O2 21,2 kPa · CO2 0,31 kPa · NOMINAL", fill=(92, 224, 138), font=font(13, mono=True))


def draw_laptop_telemetry(im):
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, CELL, CELL], fill=(8, 14, 22))
    d.rectangle([0, 0, CELL, 48], fill=(22, 34, 48))
    d.text((18, 12), "LAB TELEMETRY · ESPECTROMETRÍA", fill=(255, 178, 72), font=font(21, bold=True, mono=True))
    d.rectangle([20, 68, CELL - 20, 265], fill=(12, 20, 30), outline=(42, 68, 92))
    for gx in range(60, CELL - 20, 48):
        d.line([(gx, 68), (gx, 265)], fill=(22, 36, 52))
    for gy in range(98, 265, 40):
        d.line([(20, gy), (CELL - 20, gy)], fill=(22, 36, 52))
    pts = []
    for x in range(24, CELL - 24, 4):
        t = (x - 24) / (CELL - 48)
        v = 0.2 + 0.55 * math.exp(-((t - 0.34) / 0.06) ** 2) + 0.38 * math.exp(-((t - 0.68) / 0.09) ** 2) + 0.1 * math.sin(t * 42)
        pts.append((x, int(255 - min(0.95, v) * 175)))
    d.line(pts, fill=(84, 214, 255), width=3)
    cards = [("CONGELADOR −80°C", "-80.4 °C", (96, 204, 255)), ("GUANTERA HEPA", "-18 Pa OK", (92, 224, 138)),
             ("CULTIVO LED", "16h ON · 68%", (238, 118, 210)), ("BATERÍA BUS-B", "84% · 120.2V", (255, 184, 68))]
    for idx, (k, v, col) in enumerate(cards):
        cx = 20 + (idx % 2) * 244
        cy = 286 + (idx // 2) * 102
        d.rectangle([cx, cy, cx + 228, cy + 88], fill=(15, 24, 36), outline=(40, 62, 84))
        d.text((cx + 14, cy + 12), k, fill=(150, 175, 200), font=font(15, mono=True))
        d.text((cx + 14, cy + 44), v, fill=col, font=font(24, bold=True, mono=True))


def draw_glovebox_oled(im):
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, CELL, CELL], fill=(7, 13, 18))
    d.rectangle([10, 10, CELL - 10, CELL - 10], outline=(62, 168, 210), width=4)
    d.text((28, 28), "GUANTERA CIENTÍFICA · MSG-4", fill=(94, 212, 255), font=font(25, bold=True, mono=True))
    d.text((28, 86), "PRESIÓN DIFERENCIAL: −18,4 Pa", fill=(92, 232, 146), font=font(22, bold=True, mono=True))
    d.text((28, 134), "FILTRACIÓN HEPA:     99,997 %", fill=(220, 236, 245), font=font(21, mono=True))
    d.text((28, 180), "FLUJO LAMINAR:       0,42 m/s", fill=(220, 236, 245), font=font(21, mono=True))
    d.text((28, 226), "HUMEDAD RELATIVA:    44 %", fill=(220, 236, 245), font=font(21, mono=True))
    d.rectangle([28, 290, CELL - 28, 360], fill=(14, 48, 34), outline=(72, 218, 134), width=2)
    d.text((54, 310), "CONTENCIÓN NIVEL 2 · SELLADA", fill=(112, 248, 166), font=font(23, bold=True, mono=True))
    d.text((28, 410), "ILUMINACIÓN INTERNA: 100% 5200K", fill=(255, 198, 92), font=font(20, mono=True))


def draw_cryo_galley_oled(im):
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, CELL, CELL], fill=(10, 12, 16))
    d.rectangle([16, 16, CELL - 16, 240], fill=(12, 22, 34), outline=(72, 152, 220), width=3)
    d.text((34, 34), "CRIO-CONGELADOR STIRLING", fill=(124, 196, 255), font=font(23, bold=True, mono=True))
    d.text((34, 88), "−80,4 °C", fill=(102, 236, 255), font=font(68, bold=True, mono=True))
    d.text((34, 182), "CAJONES 1–4 SELLADOS · COMPRESOR OK", fill=(96, 226, 148), font=font(17, mono=True))
    d.rectangle([16, 268, CELL - 16, CELL - 16], fill=(24, 16, 12), outline=(235, 142, 54), width=3)
    d.text((34, 286), "DISPENSADOR AGUA POTABLE", fill=(255, 186, 86), font=font(23, bold=True, mono=True))
    d.text((34, 342), "CAL: 82 °C   AMB: 21 °C", fill=(242, 236, 224), font=font(26, bold=True, mono=True))
    d.text((34, 400), "DOSIS: 250 mL · PURIFICACIÓN UV OK", fill=(112, 232, 160), font=font(18, mono=True))


def draw_airlock_placard(im):
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, CELL, CELL], fill=(22, 25, 30))
    d.rectangle([12, 12, CELL - 12, 82], fill=(214, 146, 26))
    d.text((26, 32), "ESCLUSA EVA · PROCEDIMIENTO", fill=(18, 20, 24), font=font(23, bold=True))
    steps = [
        "1. VERIFICAR TRAJES EMU Y LÍNEAS",
        "2. CERRAR ESCOTILLA INTERIOR (NODO)",
        "3. COMPROBAR SELLO: 101,3 kPa",
        "4. INICIAR RECUPERACIÓN / VACÍO",
        "5. CONFIRMAR 0,0 kPa ANTES DE ABRIR",
        "6. CONECTAR LÍNEA DE SEGURIDAD",
    ]
    y = 108
    for s in steps:
        d.text((26, y), s, fill=(230, 234, 240), font=font(20, bold=True, mono=True))
        y += 52
    d.rectangle([24, CELL - 78, CELL - 24, CELL - 24], fill=(168, 32, 24))
    d.text((40, CELL - 63), "PELIGRO: DIFERENCIA DE PRESIÓN", fill=(250, 244, 238), font=font(21, bold=True, mono=True))


def main():
    atlas = Image.new("RGB", (W, H), (14, 18, 24))
    painters = [
        draw_photo_earthrise, draw_photo_landscape, draw_mission_patch, draw_laptop_plan,
        draw_laptop_telemetry, draw_glovebox_oled, draw_cryo_galley_oled, draw_airlock_placard,
    ]
    for idx, fn in enumerate(painters):
        tile = Image.new("RGB", (CELL, CELL), (14, 18, 24))
        fn(tile)
        cx, cy = (idx % 4) * CELL, (idx // 4) * CELL
        atlas.paste(tile, (cx, cy))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    atlas.save(OUT, optimize=True)
    print("[crew_atlas]", OUT, os.path.getsize(OUT) // 1024, "KiB")


if __name__ == "__main__":
    main()
