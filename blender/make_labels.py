"""
Genera el atlas de etiquetas interiores (blender/textures/labels_atlas.png y
web/public/textures/labels_atlas.jpg).

Etiquetas de inventario de taquillas, placas de bastidor, avisadores de cabina,
etiquetas CTB y señalización de seguridad con texto legible. Se ejecuta con
Python + Pillow:

    /home/antigravity/.venv-bpy/bin/python blender/make_labels.py

Rejilla: 8 columnas × 20 filas de celdas de 256×64 px (relación 4:1) en 2048×1280.
- Filas 0–11 (0..95):   etiquetas de inventario de taquillas y bolsas.
- Filas 12–15 (96..127): señalización y rótulos de estancia originales.
- Filas 16–19 (128..159): placas técnicas (aviónica, ECLSS, potencia, GNC,
  avisadores, válvulas, CTB y equipos de estancia).
"""
import os
import random
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(ROOT)
OUT_PNG = os.path.join(ROOT, "textures", "labels_atlas.png")
OUT_JPG = os.path.join(REPO, "web", "public", "textures", "labels_atlas.jpg")
CW, CH, COLS, ROWS = 256, 64, 8, 20
F = "/usr/share/fonts/truetype/dejavu/"
bold = lambda s: ImageFont.truetype(F + "DejaVuSans-Bold.ttf", s)
cond = lambda s: ImageFont.truetype(F + "DejaVuSansMono.ttf", s)

CONTENTS = [
    "FILTROS HEPA", "KIT MÉDICO", "COMIDA · DÍA 12", "COMIDA · DÍA 13", "COMIDA · DÍA 14", "BEBIDAS", "ROPA T1", "ROPA T2",
    "ROPA T3", "ROPA T4", "HIGIENE", "TOALLITAS", "CABLES DATOS", "HERRAMIENTAS", "LLAVES DINAM.", "REPUESTOS AVX",
    "TARJETAS E/S", "BATERÍAS ICL", "LINTERNAS", "CINTA KAPTON", "BRIDAS", "VELCRO", "BOLSAS ZIP", "GUANTES NITRILO",
    "MUESTRAS VACÍAS", "PIPETAS", "PLACAS PETRI", "SEMILLAS", "CARTUCHOS CO₂", "LiOH RESERVA", "CARBÓN ACTIVO", "JUNTAS TÓRICAS",
    "ADAPTADORES", "PORTÁTIL 2", "CÁMARA 2", "OBJETIVOS", "TARJETAS SD", "AURICULARES", "LIBROS", "ESTUCHE PERS.",
    "BOLSA BASURA", "ABSORBENTES", "KIT FUGAS", "MANÓMETRO", "MULTÍMETRO", "SOLDADOR", "TORNILLERÍA M4", "TORNILLERÍA M6",
    "LUBRICANTE", "ALCOHOL ISOP.", "PAÑOS", "EXPERIMENTO 07", "EXPERIMENTO 11", "CULTIVO B", "AGUA 4 L", "AGUA 4 L",
    "CEPILLOS", "CALCETINES", "ROPA EJERCICIO", "ARNÉS CICLO", "CINTAS ELÁST.", "KIT DENTAL", "MEDICACIÓN", "DOSÍMETROS",
]

# Teselas 96..127 (filas 12..15)
SIGNS = [
    ("EXTINTOR  PFE", (200, 30, 30), (255, 255, 255)), ("MÁSCARA  PBA", (200, 30, 30), (255, 255, 255)),
    ("PRIMEROS AUXILIOS", (20, 140, 70), (255, 255, 255)), ("SALIDA → NODO", (20, 140, 70), (255, 255, 255)),
    ("▲ PROA", (30, 30, 34), (240, 236, 228)), ("▼ POPA", (30, 30, 34), (240, 236, 228)),
    ("NO PISAR", (240, 200, 30), (20, 20, 20)), ("SUPERFICIE CALIENTE", (240, 200, 30), (20, 20, 20)),
    ("ALTA TENSIÓN 120 V", (240, 200, 30), (20, 20, 20)), ("AGUA POTABLE", (30, 90, 190), (255, 255, 255)),
    ("AGUA GRIS", (90, 90, 96), (255, 255, 255)), ("O₂", (30, 120, 60), (255, 255, 255)),
    ("N₂", (40, 40, 44), (255, 255, 255)), ("BAHÍA A · CABINA", (30, 30, 34), (240, 236, 228)),
    ("BAHÍA B · LABORATORIO", (30, 30, 34), (240, 236, 228)), ("BAHÍA C · HABITÁCULOS", (30, 30, 34), (240, 236, 228)),
    ("BAHÍA D · SERVICIOS", (30, 30, 34), (240, 236, 228)), ("NODO DE PROA", (30, 30, 34), (240, 236, 228)),
    ("ESCLUSA · EVA", (226, 87, 43), (255, 255, 255)), ("CIERRE ANTES DE DESPRES.", (240, 200, 30), (20, 20, 20)),
    ("PUNTO DE ANCLAJE", (226, 87, 43), (255, 255, 255)), ("MANTENER LIBRE", (240, 200, 30), (20, 20, 20)),
    ("CO₂ · SENSOR 2", (40, 40, 44), (255, 255, 255)), ("VENTILACIÓN · NO TAPAR", (240, 200, 30), (20, 20, 20)),
    ("ALCIÓN HX-4", (226, 87, 43), (255, 255, 255)), ("TRIPULANTE 1", (30, 90, 190), (255, 255, 255)),
    ("TRIPULANTE 2", (30, 90, 190), (255, 255, 255)), ("TRIPULANTE 3", (30, 90, 190), (255, 255, 255)),
    ("TRIPULANTE 4", (30, 90, 190), (255, 255, 255)), ("−80 °C · CRIO", (30, 90, 190), (255, 255, 255)),
    ("GUANTERA · SELLADA", (40, 40, 44), (255, 255, 255)), ("ASIDERO", (240, 200, 30), (20, 20, 20)),
]

# Teselas 128..159 (filas 16..19): placas técnicas y etiquetas CTB
TECH_PLATES = [
    # (código superior, título principal, color de banda lateral, fondo, texto)
    ("SYS-AVX-01", "AVIÓNICA · BUS A/B", (48, 128, 210), (26, 28, 32), (238, 236, 230)),
    ("SYS-ECL-02", "ECLSS · SOPORTE VITAL", (40, 165, 95), (26, 28, 32), (238, 236, 230)),
    ("SYS-PWR-03", "POTENCIA · 120 V CC", (235, 185, 35), (26, 28, 32), (238, 236, 230)),
    ("SYS-GNC-04", "GNC · ACTITUD Y NAV.", (48, 128, 210), (26, 28, 32), (238, 236, 230)),
    ("C&W-01", "MASTER WARNING", (210, 35, 30), (140, 22, 20), (255, 245, 240)),
    ("C&W-02", "MASTER CAUTION", (235, 165, 20), (160, 105, 12), (255, 248, 230)),
    ("PNL-A01", "AVISADORES · CAUTELA", (226, 87, 43), (26, 28, 32), (238, 236, 230)),
    ("PNL-A02", "ILUMINACIÓN · CABINA", (210, 205, 195), (26, 28, 32), (238, 236, 230)),
    ("PNL-A03", "SISTEMAS · ECLSS", (40, 165, 95), (26, 28, 32), (238, 236, 230)),
    ("PNL-A04", "PROPULSIÓN · RCS", (226, 87, 43), (26, 28, 32), (238, 236, 230)),
    ("CTB-01 · D", "RACIONES · SEM. 1", (226, 87, 43), (234, 229, 216), (22, 24, 28)),
    ("CTB-02 · D", "HERRAMIENTAS · MANT.", (48, 128, 210), (234, 229, 216), (22, 24, 28)),
    ("CTB-03 · D", "VESTUARIO · TRIP.", (55, 105, 125), (234, 229, 216), (22, 24, 28)),
    ("CTB-04 · D", "BOTIQUÍN · MÉDICO", (30, 150, 80), (234, 229, 216), (22, 24, 28)),
    ("CTB-05 · D", "FILTROS · LiOH / HEPA", (220, 170, 25), (234, 229, 216), (22, 24, 28)),
    ("CTB-06 · B", "CONSUMIBLES CIENCIA", (48, 128, 210), (234, 229, 216), (22, 24, 28)),
    ("CTB-07 · N", "EQUIPO EVA · ANCLAJES", (226, 87, 43), (234, 229, 216), (22, 24, 28)),
    ("CTB-08 · D", "REPUESTOS · AVIÓNICA", (105, 110, 118), (234, 229, 216), (22, 24, 28)),
    ("VALV-N01", "PRESURIZACIÓN · O₂/N₂", (40, 165, 95), (26, 28, 32), (238, 236, 230)),
    ("VALV-N02", "ECUALIZACIÓN · ESCLUSA", (226, 87, 43), (26, 28, 32), (238, 236, 230)),
    ("CUP-N03", "CÚPULA · CONTRAVENT.", (48, 128, 210), (26, 28, 32), (238, 236, 230)),
    ("RWS-N04", "CONTROL ROBÓTICO · RWS", (226, 87, 43), (26, 28, 32), (238, 236, 230)),
    ("LAB-B01", "CULTIVO · HIDROPONÍA", (40, 165, 95), (26, 28, 32), (238, 236, 230)),
    ("LAB-B02", "MICROSCOPÍA · ÓPTICA", (48, 128, 210), (26, 28, 32), (238, 236, 230)),
    ("LAB-B03", "CONGELADOR · −80 °C", (55, 145, 220), (26, 28, 32), (238, 236, 230)),
    ("GAL-D01", "AGUA · FRÍA / CALIENTE", (48, 128, 210), (26, 28, 32), (238, 236, 230)),
    ("GAL-D02", "CALENTADOR · 75 °C", (226, 87, 43), (26, 28, 32), (238, 236, 230)),
    ("EXR-D03", "CICLOERGÓMETRO · CEVIS", (226, 87, 43), (26, 28, 32), (238, 236, 230)),
    ("HAB-C01", "CONSOLA PERSONAL", (48, 128, 210), (26, 28, 32), (238, 236, 230)),
    ("IDSS-N05", "ESCOTILLA · ATRAQUE", (226, 87, 43), (26, 28, 32), (238, 236, 230)),
    ("ETH-28V", "DATOS ETH · 28 V AUX", (235, 185, 35), (26, 28, 32), (238, 236, 230)),
    ("VLA-HX4", "ALCIÓN HX-4 · VLA", (226, 87, 43), (26, 28, 32), (238, 236, 230)),
]


def fit(draw, text, font_fn, max_w, size):
    while size > 9:
        f = font_fn(size)
        if draw.textlength(text, font=f) <= max_w:
            return f
        size -= 1
    return font_fn(9)


def locker_label(img, x, y, text, rnd):
    d = ImageDraw.Draw(img)
    base = tuple(int(v) for v in (236 + rnd.randint(-6, 5), 232 + rnd.randint(-6, 5), 220 + rnd.randint(-8, 4)))
    d.rectangle([x, y, x + CW - 1, y + CH - 1], fill=base)
    d.rectangle([x + 2, y + 2, x + CW - 3, y + CH - 3], outline=(55, 58, 64), width=2)
    # código de inventario y código de barras
    code = f"ALC-{rnd.randint(1000, 9999)}-{rnd.choice('ABCD')}{rnd.randint(1, 6)}"
    d.text((x + 10, y + 6), code, font=cond(12), fill=(48, 50, 56))
    f = fit(d, text, bold, CW - 20, 22)
    d.text((x + 10, y + 24), text, font=f, fill=(20, 22, 26))
    bx = x + CW - 80
    for k in range(34):
        if rnd.random() < 0.6:
            w = rnd.choice([1, 1, 2, 3])
            d.rectangle([bx + k * 2, y + 7, bx + k * 2 + w - 1, y + 18], fill=(22, 24, 28))
    # leve patina técnica
    for _ in range(rnd.randint(0, 5)):
        px, py = x + rnd.randint(3, CW - 4), y + rnd.randint(3, CH - 4)
        d.point((px, py), fill=(170, 165, 155))


def sign(img, x, y, text, bg, fg):
    d = ImageDraw.Draw(img)
    d.rectangle([x, y, x + CW - 1, y + CH - 1], fill=bg)
    d.rectangle([x + 2, y + 2, x + CW - 3, y + CH - 3], outline=tuple(max(0, min(255, int(c * 0.72))) for c in bg), width=2)
    if bg == (240, 200, 30):  # bandas de advertencia laterales
        for k in range(0, 40, 10):
            d.polygon([(x + k, y), (x + k + 5, y), (x + k - 15 + 5, y + CH), (x + k - 15, y + CH)], fill=(20, 20, 20))
    f = fit(d, text, bold, CW - 44, 24)
    tw = d.textlength(text, font=f)
    d.text((x + (CW - tw) / 2 + (8 if bg == (240, 200, 30) else 0), y + (CH - f.size) / 2 - 2), text, font=f, fill=fg)


def tech_plate(img, x, y, code, title, stripe, bg, fg):
    d = ImageDraw.Draw(img)
    d.rectangle([x, y, x + CW - 1, y + CH - 1], fill=bg)
    # borde metálico sutil
    border = (90, 94, 102) if bg[0] < 100 else (64, 66, 72)
    d.rectangle([x + 2, y + 2, x + CW - 3, y + CH - 3], outline=border, width=2)
    # banda lateral de codificación de sistema
    d.rectangle([x + 4, y + 4, x + 16, y + CH - 5], fill=stripe)
    # remaches en las esquinas derechas
    for ry in (y + 9, y + CH - 10):
        d.ellipse([x + CW - 14, ry - 3, x + CW - 8, ry + 3], fill=border)
    # línea superior de código
    sub_col = (165, 170, 178) if bg[0] < 100 else (72, 75, 82)
    d.text((x + 24, y + 7), code, font=cond(12), fill=sub_col)
    d.line([(x + 24, y + 23), (x + CW - 20, y + 23)], fill=border, width=1)
    # título principal
    f = fit(d, title, bold, CW - 46, 21)
    d.text((x + 24, y + 29), title, font=f, fill=fg)


def main():
    rnd = random.Random(7)
    img = Image.new("RGB", (CW * COLS, CH * ROWS), (230, 228, 220))
    for i in range(96):
        c, r = i % COLS, i // COLS
        locker_label(img, c * CW, r * CH, CONTENTS[i % len(CONTENTS)], rnd)
    for i, (t, bg, fg) in enumerate(SIGNS):
        c, r = i % COLS, 12 + i // COLS
        sign(img, c * CW, r * CH, t, bg, fg)
    for i, (code, title, stripe, bg, fg) in enumerate(TECH_PLATES):
        c, r = i % COLS, 16 + i // COLS
        tech_plate(img, c * CW, r * CH, code, title, stripe, bg, fg)
    os.makedirs(os.path.dirname(OUT_PNG), exist_ok=True)
    img.save(OUT_PNG)
    os.makedirs(os.path.dirname(OUT_JPG), exist_ok=True)
    img.save(OUT_JPG, "JPEG", quality=92, subsampling=0)
    print(f"atlas {OUT_PNG} ({os.path.getsize(OUT_PNG)//1024} KiB) + {OUT_JPG} ({os.path.getsize(OUT_JPG)//1024} KiB)")


if __name__ == "__main__":
    main()
