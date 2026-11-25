"""Genera las texturas de interfaz (pantallas de cabina) del ALCIÓN con PIL.
Contenido 100 % ficticio y original."""
import math, random, os
from PIL import Image, ImageDraw, ImageFont
OUT = os.path.join(os.path.dirname(__file__), "textures")
os.makedirs(OUT, exist_ok=True)
W, H = 1024, 640
BG = (6, 10, 16)
CY = (90, 200, 255); AM = (255, 170, 60); GR = (90, 230, 140); WH = (220, 230, 240); RD = (255, 80, 60); DIM = (40, 60, 80)
def font(s):
    for p in ["/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", "/usr/share/fonts/dejavu/DejaVuSansMono.ttf"]:
        if os.path.exists(p): return ImageFont.truetype(p, s)
    return ImageFont.load_default()
F1, F2, F3 = font(16), font(22), font(34)
def frame(d, title):
    d.rectangle([0, 0, W-1, H-1], outline=DIM, width=3)
    d.rectangle([0, 0, W, 36], fill=(12, 22, 34))
    d.text((14, 8), title, font=F2, fill=CY)
    d.text((W-260, 8), "ALCIÓN HX-4 · MET 012:07:41", font=F1, fill=WH)
    d.rectangle([0, H-30, W, H], fill=(12, 22, 34))
    for i, t in enumerate(["NAV", "PROP", "PWR", "ECLSS", "COMM", "RBT"]):
        d.text((20 + i*165, H-24), t, font=F1, fill=CY if i == 0 else WH)

def pfd():
    im = Image.new("RGB", (W, H), BG); d = ImageDraw.Draw(im); frame(d, "GUIADO · ACTITUD")
    cx, cy, R = 330, 330, 210
    d.ellipse([cx-R, cy-R, cx+R, cy+R], fill=(25, 45, 75))
    d.chord([cx-R, cy-R, cx+R, cy+R], 10, 190, fill=(70, 50, 30))
    for a in range(0, 360, 15):
        r1 = R - (18 if a % 45 == 0 else 8)
        d.line([cx+R*math.cos(math.radians(a)), cy+R*math.sin(math.radians(a)), cx+r1*math.cos(math.radians(a)), cy+r1*math.sin(math.radians(a))], fill=WH, width=2)
    d.line([cx-90, cy, cx-25, cy], fill=AM, width=5); d.line([cx+25, cy, cx+90, cy], fill=AM, width=5); d.ellipse([cx-6, cy-6, cx+6, cy+6], outline=AM, width=3)
    d.ellipse([cx-R, cy-R, cx+R, cy+R], outline=CY, width=3)
    for i, (k, v, c) in enumerate([("ΔV REST", "412.6 m/s", GR), ("ACT ERR", "0.02°", GR), ("RATE", "0.001°/s", GR), ("MODO", "SEP CRUCERO", CY), ("EMPUJE", "0.61 N", WH), ("XE", "68 %", WH), ("MMH/MON", "71 / 72 %", WH)]):
        d.text((600, 70+i*58), k, font=F1, fill=DIM if False else (120, 150, 180)); d.text((760, 64+i*58), v, font=F2, fill=c)
    d.text((40, 560), "TGT: OBSERVATORIO L2-RELAY · RNG 1 284 km", font=F1, fill=AM)
    return im

def eclss():
    im = Image.new("RGB", (W, H), BG); d = ImageDraw.Draw(im); frame(d, "SOPORTE VITAL · ESQUEMA")
    boxes = [("OGA", 80, 110, GR), ("CDRA", 300, 110, GR), ("TCCS", 520, 110, GR), ("WRS", 80, 330, GR), ("UWMS", 300, 330, AM), ("IHX", 520, 330, GR), ("CABINA", 760, 210, CY)]
    for t, x, y, c in boxes:
        d.rectangle([x, y, x+170, y+110], outline=c, width=3); d.text((x+14, y+12), t, font=F2, fill=c)
        d.text((x+14, y+60), "NOMINAL" if c == GR else ("SERVICIO" if c == AM else "101.3 kPa"), font=F1, fill=WH)
    for (x0, y0, x1, y1) in [(250, 165, 300, 165), (470, 165, 520, 165), (690, 165, 760, 250), (250, 385, 300, 385), (470, 385, 520, 385), (690, 385, 760, 300), (165, 220, 165, 330)]:
        d.line([x0, y0, x1, y1], fill=CY, width=3)
    d.text((40, 480), "ppO2 21.3 kPa   ppCO2 0.31 kPa   T 22.4 °C   HR 46 %", font=F2, fill=WH)
    d.text((40, 530), "AGUA REC. 97.8 %   O2 GEN 3.6 kg/d   RESERVA AGUA 1 840 kg", font=F1, fill=GR)
    return im

def traj():
    im = Image.new("RGB", (W, H), BG); d = ImageDraw.Draw(im); frame(d, "TRAYECTORIA · CISLUNAR")
    ex, ey = 260, 340; mx, my = 760, 300
    d.ellipse([ex-40, ey-40, ex+40, ey+40], fill=(30, 90, 170)); d.ellipse([mx-16, my-16, mx+16, my+16], fill=(150, 150, 150))
    pts = []
    for i in range(400):
        t = i/399*math.tau*1.5
        r = 80 + 420*(i/399)
        pts.append((ex + r*math.cos(t*0.35)*1.05, ey + r*0.55*math.sin(t*0.35)))
    d.line(pts, fill=CY, width=2)
    for i in range(0, 360, 6):
        a = math.radians(i); d.point((mx+70*math.cos(a), my+90*math.sin(a)), fill=AM)
    d.ellipse([mx+60, my-14, mx+80, my+6], outline=GR, width=3)
    d.text((40, 560), "NRHO SUR · PERILUNIO 3 120 km · T-ENCUENTRO 41 h 12 min", font=F1, fill=WH)
    return im

def camera():
    random.seed(4)
    im = Image.new("RGB", (W, H), (10, 10, 12)); d = ImageDraw.Draw(im)
    for i in range(H):
        c = int(12 + 10*math.sin(i/37.0)); d.line([0, i, W, i], fill=(c, c, c+2))
    d.ellipse([360, 180, 680, 500], outline=(200, 200, 200), width=6); d.ellipse([470, 290, 570, 390], outline=(230, 230, 230), width=4)
    d.line([W//2, 60, W//2, H-60], fill=GR, width=2); d.line([60, H//2, W-60, H//2], fill=GR, width=2)
    for k in range(1, 6):
        d.line([W//2-12, H//2-k*45, W//2+12, H//2-k*45], fill=GR, width=2)
    d.text((20, 16), "CAM ATRAQUE 1 · IR · 25 fps", font=F1, fill=GR); d.text((20, 44), "RNG 14.6 m  Vc -0.08 m/s", font=F2, fill=AM)
    return im

def panel():
    im = Image.new("RGB", (W, H), (30, 33, 36)); d = ImageDraw.Draw(im)
    for r in range(4):
        d.text((24, 20+r*150), ["BUS A 120V", "BUS B 120V", "RCS ARM", "PIRO SAFE"][r], font=F1, fill=WH)
        for c in range(9):
            x, y = 40 + c*108, 50 + r*150
            d.rectangle([x, y, x+60, y+80], outline=(80, 85, 90), width=3)
            d.rectangle([x+22, y+15, x+38, y+65], fill=(170, 175, 180))
            d.ellipse([x+20, y-14, x+34, y], fill=GR if (r+c) % 3 else AM)
    return im

for name, f in [("ui_pfd", pfd), ("ui_eclss", eclss), ("ui_traj", traj), ("ui_camera", camera), ("ui_switch", panel)]:
    f().save(os.path.join(OUT, name + ".png"))
print("ok")
