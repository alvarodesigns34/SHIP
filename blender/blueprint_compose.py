"""
ALCIÓN HX-4 — composición de planos (Python 3 + Pillow).

  python3 blender/blueprint_compose.py

Convierte las proyecciones ortográficas de blueprints/_raw/ en láminas de
estilo cianotipo con cotas, llamadas a componentes y cajetín. Todas las cotas
se calculan a partir de puntos proyectados del modelo (JSON) y de
blender/alcion/spec.py: no hay cifras dibujadas a mano.
"""
import json
import math
import os
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
RAW = os.path.join(ROOT, "blueprints", "_raw")
OUT = os.path.join(ROOT, "blueprints")
sys.path.insert(0, HERE)
from alcion import spec as S  # noqa: E402

BG = np.array([13, 32, 52], dtype=np.float32)
LINE = np.array([222, 236, 250], dtype=np.float32)
ACC = (240, 120, 70)
INK = (222, 236, 250)
DIM = (150, 190, 225)
FD = "/usr/share/fonts/truetype/dejavu/"
JB = "/usr/share/fonts/truetype/jetbrains-mono/"


def font(size, mono=False, bold=False):
    cands = ([JB + ("JetBrainsMono-Bold.ttf" if bold else "JetBrainsMono-Regular.ttf")] if mono else []) + \
            [FD + ("DejaVuSansMono.ttf" if mono else ("DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"))]
    for c in cands:
        if os.path.exists(c):
            return ImageFont.truetype(c, size)
    return ImageFont.load_default()


def blueprintify(path, gain=2.6):
    im = np.asarray(Image.open(path).convert("L"), dtype=np.float32) / 255.0
    ink = np.clip((1.0 - im) * gain, 0, 1) ** 0.85
    rgb = BG[None, None, :] * (1 - ink[..., None]) + LINE[None, None, :] * ink[..., None]
    img = Image.fromarray(rgb.astype(np.uint8), "RGB")
    # retícula de fondo cada 100 px
    d = ImageDraw.Draw(img, "RGBA")
    W, H = img.size
    for x in range(0, W, 100):
        d.line([(x, 0), (x, H)], fill=(120, 170, 220, 18), width=1)
    for y in range(0, H, 100):
        d.line([(0, y), (W, y)], fill=(120, 170, 220, 18), width=1)
    return img


def meta(name):
    with open(os.path.join(RAW, name + ".json"), encoding="utf-8") as f:
        return json.load(f)


def arrow(d, p, q, col=DIM, w=2, head=14):
    d.line([p, q], fill=col, width=w)
    for a, b in ((p, q), (q, p)):
        ang = math.atan2(b[1] - a[1], b[0] - a[0])
        for s in (-1, 1):
            d.line([b, (b[0] - head * math.cos(ang + s * 0.32), b[1] - head * math.sin(ang + s * 0.32))], fill=col, width=w)


def dim_h(d, x0, x1, y, yref0, yref1, text, f, col=DIM):
    """Cota horizontal entre x0 y x1 a la altura y, con líneas de referencia."""
    for x, yr in ((x0, yref0), (x1, yref1)):
        d.line([(x, yr), (x, y + (12 if y > yr else -12))], fill=col, width=1)
    arrow(d, (x0, y), (x1, y), col)
    tw = d.textlength(text, font=f)
    xm = (x0 + x1) / 2
    d.rectangle([xm - tw / 2 - 10, y - 18, xm + tw / 2 + 10, y + 18], fill=tuple(BG.astype(int)))
    d.text((xm - tw / 2, y - 14), text, font=f, fill=INK)


def dim_v(d, y0, y1, x, xref0, xref1, text, f, col=DIM):
    for yy, xr in ((y0, xref0), (y1, xref1)):
        d.line([(xr, yy), (x + (12 if x > xr else -12), yy)], fill=col, width=1)
    arrow(d, (x, y0), (x, y1), col)
    tw = d.textlength(text, font=f)
    ym = (y0 + y1) / 2
    d.rectangle([x - 18, ym - tw / 2 - 10, x + 18, ym + tw / 2 + 10], fill=tuple(BG.astype(int)))
    tmp = Image.new("RGBA", (int(tw) + 4, 30), (0, 0, 0, 0))
    ImageDraw.Draw(tmp).text((2, 0), text, font=f, fill=INK)
    tmp = tmp.rotate(90, expand=True)
    return tmp, (int(x - tmp.size[0] / 2), int(ym - tmp.size[1] / 2))


def callouts(img, d, labels, f, top_band, bot_band, avoid_x=None):
    """Llamadas a componentes: texto en dos filas por banda, sin solapes."""
    W, H = img.size
    tops = sorted([l for l in labels if l["xy"][1] < H / 2], key=lambda l: l["xy"][0])
    bots = sorted([l for l in labels if l["xy"][1] >= H / 2], key=lambda l: l["xy"][0])
    for group_, band, sgn in ((tops, top_band, -1), (bots, bot_band, 1)):
        rows = [[], []]
        for i, l in enumerate(group_):
            rows[i % 2].append(l)
        for r, row in enumerate(rows):
            xs = []
            last = -1e9
            for l in row:
                tw = d.textlength(l["label"], font=f)
                x = max(l["xy"][0] - tw / 2, last + 40, 50)
                xs.append([x, tw])
                last = x + tw
            right = W - 50
            for k in range(len(xs) - 1, -1, -1):
                if xs[k][0] + xs[k][1] > right:
                    xs[k][0] = right - xs[k][1]
                right = xs[k][0] - 40
            yb = band - sgn * r * 46
            for l, (x, tw) in zip(row, xs):
                px, py = l["xy"]
                tx = x + tw / 2
                ty = yb - sgn * 22
                d.line([(px, py), (px + (tx - px) * 0.0, py + (ty - py) * 0.55), (tx, ty)], fill=ACC, width=2)
                d.ellipse([px - 6, py - 6, px + 6, py + 6], outline=ACC, width=3)
                d.text((x, yb - (36 if sgn < 0 else -6)), l["label"], font=f, fill=INK)


def title_block(img, d, title, sheet, subtitle, scale_ppm=None, out_w=None):
    W, H = img.size
    d.rectangle([24, 24, W - 24, H - 24], outline=(170, 205, 235), width=3)
    d.rectangle([34, 34, W - 34, H - 34], outline=(120, 160, 200), width=1)
    bw, bh = 1180, 190
    x0, y0 = W - 34 - bw, H - 34 - bh
    d.rectangle([x0, y0, W - 34, H - 34], fill=tuple(BG.astype(int)), outline=(170, 205, 235), width=2)
    d.line([(x0, y0 + 70), (W - 34, y0 + 70)], fill=(120, 160, 200), width=1)
    d.line([(x0 + 880, y0), (x0 + 880, H - 34)], fill=(120, 160, 200), width=1)
    d.text((x0 + 20, y0 + 14), f"ALCIÓN HX-4 · {title}", font=font(32, bold=True), fill=INK)
    d.text((x0 + 20, y0 + 86), subtitle, font=font(22), fill=DIM)
    d.text((x0 + 20, y0 + 120), "Varro-Lindqvist Astronautics (ficticia) · Documento de concepto", font=font(22), fill=DIM)
    d.text((x0 + 20, y0 + 152), "Proyección ortográfica del modelo maestro · unidades: metros", font=font(20), fill=DIM)
    d.text((x0 + 900, y0 + 14), "LÁMINA", font=font(18, mono=True), fill=DIM)
    d.text((x0 + 900, y0 + 36), sheet, font=font(30, mono=True, bold=True), fill=ACC)
    d.text((x0 + 900, y0 + 86), "REV  C · SINGULARITY", font=font(18, mono=True), fill=INK)
    d.text((x0 + 900, y0 + 118), "2026-11-25", font=font(20, mono=True), fill=INK)
    d.text((x0 + 900, y0 + 150), "CONCEPTUAL · NO FABRICACIÓN", font=font(14, mono=True), fill=ACC)
    if scale_ppm:
        # escala gráfica (5 m)
        L = 5 * scale_ppm
        n = 5
        sx, sy = 70, H - 80
        for i in range(n):
            d.rectangle([sx + i * L / n, sy, sx + (i + 1) * L / n, sy + 12], fill=INK if i % 2 == 0 else tuple(BG.astype(int)), outline=INK)
        for i in range(n + 1):
            d.text((sx + i * L / n - 6, sy + 18), str(i), font=font(18, mono=True), fill=DIM)
        d.text((sx + L + 16, sy - 4), "m", font=font(20, mono=True), fill=DIM)


def fmt(v):
    return f"{v:.2f}".replace(".", ",")


def sheet_side():
    m = meta("side")
    img = blueprintify(os.path.join(RAW, "side.png"))
    d = ImageDraw.Draw(img)
    P = m["points"]
    f, fs = font(26, mono=True), font(22)
    yb = img.size[1] - 470
    dim_h(d, P["stern"][0], P["bow"][0], yb + 60, P["stern"][1], P["bow"][1], f"{fmt(LEN)} m  longitud total", f)
    # estaciones
    for k, lab in (("xEng", "X −6,35"), ("xSvc1", "X −4,40"), ("x0", "X 0,00"), ("frame0", "X 0,60"), ("frame1", "X 2,65"), ("frame2", "X 4,70"),
                   ("frame3", "X 6,75"), ("frame4", "X 8,80"), ("xNodeA", "X 9,90"), ("xNodeF", "X 12,20")):
        x = P[k][0]
        d.line([(x, P[k][1] + 10), (x, yb - 10)], fill=(110, 150, 190), width=1)
        d.text((x - 34, yb - 6), lab, font=font(17, mono=True), fill=DIM)
    xr = min(img.size[0] - 90, max(P["bow"][0], P["stern"][0]) + 140)
    tmp, pos = dim_v(d, P["radTop"][1], P["radBot"][1], xr, P["radTop"][0], P["radBot"][0], f"{fmt(HZ)} m  radiadores desplegados", f)
    img.paste(tmp, pos, tmp)
    xr2 = P["frame4"][0] + 18
    tmp, pos = dim_v(d, P["habTop"][1], P["habBot"][1], xr2, P["habTop"][0], P["habBot"][0], f"Ø {fmt(2*S.R_S)} m (entre caras)", font(21, mono=True))
    img.paste(tmp, pos, tmp)
    callouts(img, d, m["labels"], fs, 170, img.size[1] - 300)
    title_block(img, d, "VISTA LATERAL (BABOR)", "BP-02", "Alzado desde +Y · estaciones en X (m)", m["ppm"])
    return img


def sheet_generic(name, title, sheetno, sub, dims):
    m = meta(name)
    img = blueprintify(os.path.join(RAW, name + ".png"))
    d = ImageDraw.Draw(img)
    P = m["points"]
    f, fs = font(26, mono=True), font(22)
    for kind, a, b, off, text in dims:
        if kind == "h":
            y = max(P[a][1], P[b][1]) + off
            dim_h(d, P[a][0], P[b][0], y, P[a][1], P[b][1], text, f)
        else:
            x = max(P[a][0], P[b][0]) + off
            tmp, pos = dim_v(d, P[a][1], P[b][1], x, P[a][0], P[b][0], text, f)
            img.paste(tmp, pos, tmp)
    callouts(img, d, m["labels"], fs, 170, img.size[1] - 300)
    title_block(img, d, title, sheetno, sub, m["ppm"])
    return img


def sheet_section_long():
    m = meta("section_long")
    img = blueprintify(os.path.join(RAW, "section_long.png"), gain=3.0)
    d = ImageDraw.Draw(img)
    P = m["points"]
    # Callouts primero para que los rótulos de bahía (con fondo limpio) nunca queden tachados
    callouts(img, d, m["labels"], font(22), 145, img.size[1] - 300)
    # Rótulos de bahía elevados por encima del brazo robótico (cero solapes con RBT!)
    y_bay = P["habTop"][1] - 255
    fb = font(20, mono=True, bold=True)
    for k in ("frame0", "frame1", "frame2", "frame3", "frame4"):
        xf = P[k][0]
        d.line([(xf, y_bay + 6), (xf, P["habTop"][1] - 18)], fill=(110, 150, 190), width=1)
    for k0, k1, t in (("frame3", "frame4", "BAHÍA A · CABINA"), ("frame2", "frame3", "BAHÍA B · LABORATORIO"),
                      ("frame1", "frame2", "BAHÍA C · REFUGIO"), ("frame0", "frame1", "BAHÍA D · SERVICIOS")):
        x0, x1 = P[k0][0], P[k1][0]
        d.line([(x0 + 6, y_bay), (x1 - 6, y_bay)], fill=ACC, width=3)
        tw = d.textlength(t, font=fb)
        xm = (x0 + x1) / 2
        d.rectangle([xm - tw / 2 - 8, y_bay - 36, xm + tw / 2 + 8, y_bay - 6], fill=tuple(BG.astype(int)))
        d.text((xm - tw / 2, y_bay - 32), t, font=fb, fill=ACC)
    d.text((70, 62), "SECCIÓN LONGITUDINAL  Y = 0 (plano de crujía), vista desde babor; alas solares, radiadores y antena omitidos", font=font(24), fill=DIM)
    title_block(img, d, "SECCIÓN LONGITUDINAL", "BP-06", "Corte por el plano de crujía", m["ppm"])
    return img


def sheet_cross():
    W, H = 3200, 2000
    img = Image.new("RGB", (W, H), tuple(BG.astype(int)))
    d = ImageDraw.Draw(img)
    items = [("N", "N-N", 11.05, "Nodo de proa y cúpula"), ("A", "A-A", 7.75, "Bahía A · cabina de vuelo"), ("B", "B-B", 5.72, "Bahía B · laboratorio"),
             ("C", "C-C", 3.67, "Bahía C · habitáculos y refugio"), ("D", "D-D", 1.62, "Bahía D · servicios"), ("S", "S-S", -2.9, "Módulo de servicio · depósitos")]
    cw, ch = 800, 800
    for i, (k, tag, x, t) in enumerate(items):
        sub = blueprintify(os.path.join(RAW, f"xsec_{k}.png"), gain=3.0).resize((cw, ch), Image.LANCZOS)
        gx, gy = 170 + (i % 3) * (cw + 150), 110 + (i // 3) * (ch + 40)
        img.paste(sub, (gx, gy))
        d.rectangle([gx, gy, gx + cw, gy + ch], outline=(120, 160, 200), width=1)
        d.text((gx + 16, gy + 14), f"SECCIÓN {tag}", font=font(28, mono=True, bold=True), fill=ACC)
        d.text((gx + 16, gy + 52), f"X = {fmt(x)} m · {t}", font=font(22), fill=INK)
        if k in "ABCD":
            ppm = 800 / 5.4
            s = S.AISLE * ppm
            cx, cy = gx + cw / 2, gy + ch / 2 - 0.15 * ppm
            d.text((gx + 16, gy + ch - 44), f"Pasillo {fmt(S.AISLE)} × {fmt(S.AISLE)} m · casco Ø {fmt(2*S.R_P)} m", font=font(20, mono=True), fill=DIM)
    d.rectangle([24, 24, W - 24, H - 24], outline=(170, 205, 235), width=3)
    title_block(img, d, "SECCIONES TRANSVERSALES", "BP-07", "Cortes X = cte vistos desde proa hacia popa", None)
    return img


def sheet_layout():
    m = meta("layout")
    img = blueprintify(os.path.join(RAW, "layout.png"), gain=3.0)
    d = ImageDraw.Draw(img)
    P = m["points"]
    for i in range(5):
        x, y = P[f"frame{i}"]
        d.line([(x, 260), (x, img.size[1] - 360)], fill=(110, 150, 190), width=1)
    dim_h(d, P["frame0"][0], P["frame4"][0], img.size[1] - 420, P["frame0"][1], P["frame4"][1], f"{fmt(S.X_HAB_F - S.X_HAB_A)} m  barril presurizado (4 × {fmt(S.BARREL_L)} m)", font(24, mono=True))
    callouts(img, d, m["labels"], font(21), 150, img.size[1] - 300)
    # Rótulos de bahía con pastilla opaca sobre líneas de llamada para legibilidad impecable
    fb = font(21, mono=True, bold=True)
    for k0, k1, t in (("frame3", "frame4", "A · CABINA"), ("frame2", "frame3", "B · LABORATORIO"), ("frame1", "frame2", "C · REFUGIO"), ("frame0", "frame1", "D · SERVICIOS")):
        x0, x1 = P[k0][0], P[k1][0]
        tw = d.textlength(t, font=fb)
        xm = (x0 + x1) / 2
        d.rectangle([xm - tw / 2 - 10, 268, xm + tw / 2 + 10, 302], fill=tuple(BG.astype(int)), outline=(110, 150, 190), width=1)
        d.text((xm - tw / 2, 273), t, font=fb, fill=ACC)
    d.text((70, 70), "DISTRIBUCIÓN INTERIOR · planta cortada a Z = 0 (vista cenital; proa a la derecha)", font=font(24), fill=DIM)
    title_block(img, d, "DISTRIBUCIÓN INTERIOR", "BP-08", "Planta por el eje del pasillo", m["ppm"])
    return img


def box(d, x, y, w, h, title, lines, accent=False):
    d.rectangle([x, y, x + w, y + h], outline=ACC if accent else INK, width=3 if accent else 2, fill=(18, 42, 66))
    d.text((x + 16, y + 12), title, font=font(24, bold=True), fill=ACC if accent else INK)
    for i, l in enumerate(lines):
        d.text((x + 16, y + 50 + i * 30), l, font=font(19, mono=True), fill=DIM)


def link(d, a, b, label=None, col=INK, w=3, dash=False):
    (x0, y0), (x1, y1) = a, b
    pts = [(x0, y0), (x0, (y0 + y1) / 2), (x1, (y0 + y1) / 2), (x1, y1)] if abs(x0 - x1) > 2 and abs(y0 - y1) > 2 else [(x0, y0), (x1, y1)]
    d.line(pts, fill=col, width=w)
    if label:
        mx, my = pts[len(pts) // 2 - 1][0] / 2 + pts[len(pts) // 2][0] / 2, pts[len(pts) // 2 - 1][1] / 2 + pts[len(pts) // 2][1] / 2
        tw = d.textlength(label, font=font(17, mono=True))
        d.rectangle([mx - tw / 2 - 6, my - 13, mx + tw / 2 + 6, my + 13], fill=tuple(BG.astype(int)))
        d.text((mx - tw / 2, my - 11), label, font=font(17, mono=True), fill=col)


def sheet_systems():
    W, H = 3200, 2000
    img = Image.new("RGB", (W, H), tuple(BG.astype(int)))
    d = ImageDraw.Draw(img)
    for x in range(0, W, 100):
        d.line([(x, 0), (x, H)], fill=(25, 48, 72), width=1)
    for y in range(0, H, 100):
        d.line([(0, y), (W, y)], fill=(25, 48, 72), width=1)
    d.text((80, 70), "ARQUITECTURA DE SISTEMAS · flujos de potencia, calor, fluidos y datos entre componentes del modelo (códigos entre corchetes)", font=font(26), fill=DIM)
    B = {}
    def b(key, x, y, w, h, t, lines, acc=False):
        box(d, x, y, w, h, t, lines, acc)
        B[key] = (x, y, w, h)
    b("sa", 120, 180, 520, 170, "Alas solares ×2", ["[PWR.W1/W2] ROSA 4,4×16 m", "≈48 kW BOL, SADA 1 eje"], True)
    b("pcdu", 120, 470, 520, 170, "PCDU · bus 120 V CC", ["[SVC.AVX.PCDU]", "protección y conmutación"])
    b("bat", 120, 760, 520, 140, "Baterías Li-ion ×2", ["[SVC.AVX.BAT1/2]"])
    b("ppu", 760, 470, 500, 170, "PPU SEP ×2", ["[SVC.AVX.PPU1/2]", "300–600 V descarga"])
    b("hall", 760, 760, 500, 170, "Propulsores Hall ×4", ["[PRP.SEP.A1/A2]", "clase 6 kW, Xe"], True)
    b("xe", 760, 1040, 500, 140, "Depósito de xenón", ["[SVC.PRP.XE] COPV 1,75 m³"])
    b("fcc", 1380, 180, 560, 200, "Ordenadores de vuelo ×3", ["[SVC.AVX.FCC1-3] votación", "IMU · rastreadores estelares", "sensores solares · LIDAR"], True)
    b("gnc", 1380, 470, 560, 170, "Actuadores de actitud", ["[SVC.AVX.RWA] 4 ruedas", "[HAB.RCS] [SVC.EXT.RCS] 8×5"])
    b("biprop", 1380, 760, 560, 170, "Bipropelente MMH/MON-3", ["[SVC.PRP.BIP] 4 esferas Ti", "[SVC.PRP.HE] helio · [FCA]"])
    b("eng", 1380, 1040, 560, 140, "Motores principales ×4", ["[PRP.ENG] clase 400–500 N"], True)
    b("com", 2060, 180, 520, 200, "Comunicaciones", ["[COM] HGA 1,6 m X/Ka", "[SVC.EXT.OPT] láser", "[FWD.EXT.LGA] banda S"])
    b("rbt", 2700, 180, 400, 200, "Brazo robótico", ["[RBT] 7 GDL", "[FWD.INT.RWS] estación"])
    b("hab", 2060, 470, 1040, 230, "Cabina presurizada (4 tripulantes)", ["[HAB.INT] 4 bahías · [FWD.INT] nodo", "lazo interno de AGUA (seguro)", "[HAB.UTL] aire · potencia · datos · H₂O"], True)
    b("ecl", 2060, 790, 1040, 260, "Soporte vital regenerativo", ["[HAB.INT.D.SO] OGA electrólisis PEM", "[HAB.INT.D.CL1] CO₂ tamices moleculares", "[HAB.INT.D.DK1] WRS destilación", "[HAB.INT.AFT] O₂/N₂ alta presión"])
    b("ihx", 2060, 1150, 500, 170, "Intercambiador H₂O/NH₃", ["[SVC.THM.IHX]"])
    b("pmp", 2660, 1150, 440, 170, "Bombeo de amoníaco", ["[SVC.THM.PMP]"])
    b("rad", 2060, 1430, 1040, 170, "Radiadores desplegables ×2", ["[THR.R1/R2] 6 paneles · ≈67 m² · ≈10–12 kW"], True)
    b("ww", 1380, 1300, 560, 200, "Refugio antiradiación", ["[HAB.INT.C] muro de agua + HDPE", "objetivo ≥ 20 g/cm² (hipótesis)"])
    b("dock", 120, 1040, 520, 170, "Atraque IDSS", ["[FWD.DCK] paso 0,80 m", "umbilicales potencia/datos"])
    b("mmod", 120, 1300, 1140, 200, "Protección pasiva", ["[HAB.MMOD] Whipple relleno · 64 paneles", "[HAB.MLI] MLI 20 capas · [FWD.MMOD] mantas"])
    cx = lambda k, fx=0.5: B[k][0] + B[k][2] * fx
    cy = lambda k, fy=0.5: B[k][1] + B[k][3] * fy
    top = lambda k, fx=0.5: (cx(k, fx), B[k][1])
    bot = lambda k, fx=0.5: (cx(k, fx), B[k][1] + B[k][3])
    lft = lambda k, fy=0.5: (B[k][0], cy(k, fy))
    rgt = lambda k, fy=0.5: (B[k][0] + B[k][2], cy(k, fy))
    P = (250, 212, 90)
    T = (235, 85, 75)
    F = (120, 200, 255)
    D = (150, 230, 160)
    link(d, bot("sa"), top("pcdu"), "potencia", P)
    link(d, bot("pcdu"), top("bat"), "carga/descarga", P)
    link(d, rgt("pcdu"), lft("ppu"), "120 V", P)
    link(d, bot("ppu"), top("hall"), "AT", P)
    link(d, top("xe"), bot("hall", 0.3), "Xe", F)
    link(d, bot("biprop"), top("eng"), "MMH/MON", F)
    link(d, bot("fcc"), top("gnc"), "mando", D)
    link(d, rgt("fcc"), lft("com"), "telemetría", D)
    link(d, rgt("com"), lft("rbt"), None, D)
    link(d, bot("hab"), top("ecl"), "aire/agua", F)
    link(d, bot("ecl", 0.25), top("ihx"), "H₂O caliente", T)
    link(d, rgt("ihx"), lft("pmp"), "NH₃", T)
    link(d, bot("pmp"), top("rad", 0.8), "NH₃", T)
    link(d, bot("ihx"), top("rad", 0.2), None, T)
    link(d, lft("ww"), rgt("mmod", 0.3), None, INK)
    link(d, rgt("dock"), lft("xe", 0.2), None, D)
    ly = 1700
    for i, (c, t) in enumerate(((P, "Potencia eléctrica"), (T, "Calor (H₂O / NH₃)"), (F, "Fluidos y propulsantes"), (D, "Datos y mando"))):
        d.line([(120 + i * 520, ly), (200 + i * 520, ly)], fill=c, width=5)
        d.text((215 + i * 520, ly - 14), t, font=font(22), fill=INK)
    d.rectangle([24, 24, W - 24, H - 24], outline=(170, 205, 235), width=3)
    title_block(img, d, "ARQUITECTURA DE SISTEMAS", "BP-09", "Diagrama funcional (no a escala)", None)
    return img


def sheet_assembly():
    m = meta("assembly")
    img = blueprintify(os.path.join(RAW, "assembly.png"), gain=2.6)
    d = ImageDraw.Draw(img)
    order = {"PRP": 1, "SVC": 2, "THR": 3, "PWR": 4, "COM": 5, "HAB": 6, "FWD": 7, "RBT": 8}
    alias = {"PWR.W1": ("PWR", "Sistema de Potencia Solar"), "THR.R1": ("THR", "Radiadores Desplegables")}
    for l in m["labels"]:
        if l["code"] in alias:
            k, t = alias[l["code"]]
            l["label"] = f"{order[k]} · {t}"
        elif l["code"] in order:
            l["label"] = f"{order[l['code']]} · {l['label']}"
    callouts(img, d, m["labels"], font(21), 150, img.size[1] - 300)
    d.text((70, 70), "ENSAMBLAJE CONCEPTUAL · explosión al 40 % · numeración = secuencia de integración propuesta (hipótesis)", font=font(24), fill=DIM)
    seq = ["1 Bahía de propulsión sobre utillaje", "2 Módulo de servicio y tanques", "3 Radiadores (plegados)", "4 Alas solares (enrolladas)",
           "5 Antena de alta ganancia", "6 Módulo habitable + interior", "7 Nodo de proa, IDSS y cúpula", "8 Brazo robótico (estiba)"]
    for i, s in enumerate(seq):
        d.text((70, 140 + i * 34), s, font=font(21, mono=True), fill=INK)
    title_block(img, d, "ENSAMBLAJE CONCEPTUAL", "BP-10", "Vista axonométrica, explosión parcial", None)
    return img


def save(img, name):
    p = os.path.join(OUT, name + ".png")
    img = img.resize((2400, int(2400 * img.size[1] / img.size[0])), Image.LANCZOS)
    img.quantize(colors=96, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(p, optimize=True)
    print("[compose]", p, os.path.getsize(p) // 1024, "KiB")


# cotas globales medidas sobre la caja envolvente real del modelo (build.py → stats.json)
_ST = json.load(open(os.path.join(ROOT, "docs", "stats.json")))
SPAN = _ST["span_m"]
HZ = _ST["height_m"]
LEN = _ST["length_m"]
save(sheet_generic("front", "VISTA FRONTAL", "BP-01", "Alzado desde proa (+X)", [("h", "tipS", "tipP", 260, f"{fmt(SPAN)} m  envergadura"), ("v", "radTop", "radBot", 300, f"{fmt(HZ)} m")]), "front")
save(sheet_side(), "side")
save(sheet_generic("top", "VISTA SUPERIOR", "BP-03", "Planta desde +Z (proa arriba)", [("h", "tipS", "tipP", 200, f"{fmt(SPAN)} m  envergadura"), ("v", "bow", "stern", 520, f"{fmt(LEN)} m")]), "top")
save(sheet_generic("bottom", "VISTA INFERIOR", "BP-04", "Planta desde −Z (proa arriba)", [("h", "tipS", "tipP", 200, f"{fmt(SPAN)} m  envergadura"), ("v", "bow", "stern", 520, f"{fmt(LEN)} m")]), "bottom")
save(sheet_generic("rear", "VISTA POSTERIOR", "BP-05", "Alzado desde popa (−X)", [("h", "tipP", "tipS", 260, f"{fmt(SPAN)} m  envergadura")]), "rear")
save(sheet_section_long(), "section_long")
save(sheet_cross(), "section_cross")
save(sheet_layout(), "layout")
save(sheet_systems(), "systems")
save(sheet_assembly(), "assembly")
