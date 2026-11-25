"""
Genera el atlas de etiquetas interiores (blender/textures/labels_atlas.png).

Etiquetas de inventario de taquillas, placas de bastidor y señalización de seguridad con
texto legible. Se ejecuta con el Python del sistema (necesita Pillow):

    python3 blender/make_labels.py

Rejilla: 8 columnas × 16 filas de celdas de 256×64 px (relación 4:1) en 2048×1024.
Las filas 0–11 son etiquetas de taquilla (96); las 12–15 son placas y señales (32).
"""
import os
import random
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "textures", "labels_atlas.png")
CW, CH, COLS, ROWS = 256, 64, 8, 16
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


def fit(draw, text, font_fn, max_w, size):
    while size > 9:
        f = font_fn(size)
        if draw.textlength(text, font=f) <= max_w:
            return f
        size -= 1
    return font_fn(9)


def locker_label(img, x, y, text, rnd):
    d = ImageDraw.Draw(img)
    base = tuple(int(v) for v in (236 + rnd.randint(-8, 6), 233 + rnd.randint(-8, 6), 222 + rnd.randint(-10, 4)))
    d.rectangle([x, y, x + CW - 1, y + CH - 1], fill=base)
    d.rectangle([x + 1, y + 1, x + CW - 2, y + CH - 2], outline=(60, 60, 64), width=2)
    # código de inventario y código de barras
    code = f"ALC-{rnd.randint(1000, 9999)}-{rnd.choice('ABCD')}{rnd.randint(1, 6)}"
    d.text((x + 8, y + 6), code, font=cond(12), fill=(40, 40, 46))
    f = fit(d, text, bold, CW - 16, 22)
    d.text((x + 8, y + 22), text, font=f, fill=(20, 20, 24))
    bx = x + CW - 78
    for k in range(34):
        if rnd.random() < 0.6:
            w = rnd.choice([1, 1, 2, 3])
            d.rectangle([bx + k * 2, y + 7, bx + k * 2 + w - 1, y + 18], fill=(20, 20, 24))
    # desgaste leve: esquinas y manchas
    for _ in range(rnd.randint(0, 6)):
        px, py = x + rnd.randint(2, CW - 3), y + rnd.randint(2, CH - 3)
        d.point((px, py), fill=(170, 165, 155))


def sign(img, x, y, text, bg, fg):
    d = ImageDraw.Draw(img)
    d.rectangle([x, y, x + CW - 1, y + CH - 1], fill=bg)
    if bg == (240, 200, 30):  # bandas de advertencia laterales
        for k in range(0, 40, 10):
            d.polygon([(x + k, y), (x + k + 5, y), (x + k - 15 + 5, y + CH), (x + k - 15, y + CH)], fill=(20, 20, 20))
    f = fit(d, text, bold, CW - 40, 26)
    tw = d.textlength(text, font=f)
    d.text((x + (CW - tw) / 2 + (8 if bg == (240, 200, 30) else 0), y + (CH - f.size) / 2 - 2), text, font=f, fill=fg)


def main():
    rnd = random.Random(7)
    img = Image.new("RGB", (CW * COLS, CH * ROWS), (230, 228, 220))
    for i in range(96):
        c, r = i % COLS, i // COLS
        locker_label(img, c * CW, r * CH, CONTENTS[i % len(CONTENTS)], rnd)
    for i, (t, bg, fg) in enumerate(SIGNS):
        c, r = i % COLS, 12 + i // COLS
        sign(img, c * CW, r * CH, t, bg, fg)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    img.save(OUT)
    print("atlas", OUT)


if __name__ == "__main__":
    main()
