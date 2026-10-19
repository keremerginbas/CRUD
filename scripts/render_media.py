#!/usr/bin/env python3
"""
CMS Hafriyat - prosedürel video ve görsel üretici.

Telifsiz, tamamen kodla çizilen inşaat sahneleri üretir:
  hafriyat  : ekskavatör çukur kazıp kamyona döküyor
  insaat    : kule vinç beton kovasını kat döşemesine taşıyor
  nakliye   : yüklü damperli kamyon yolda ilerliyor (paralaks)
  ihracat   : liman vinci konteyneri gemiye yüklüyor / boşaltıyor
  makine    : lastikli yükleyici (loder) malzeme alıyor

Çıktılar (dist/assets/...):
  video/<sahne>.mp4   1280x720, 8 sn, kusursuz döngü (H.264)
  video/<sahne>.webm  aynı video (VP9, daha küçük)
  img/<sahne>.webp    poster / kart görseli
  img/og/<sahne>.jpg  1200x630 Open Graph görseli
  img/blog/<slug>.webp  blog kapakları (src/content/posts içinden okunur)

Kullanım: python3 scripts/render_media.py [sahne ...] [--stills-only]
"""
import math
import os
import re
import subprocess
import sys
from multiprocessing import Pool

from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "dist", "assets")
W, H = 1280, 720
SS = 2  # süper örnekleme (kenar yumuşatma)
FPS = 24
SECONDS = 8
FRAMES = FPS * SECONDS
GROUND = 560

YELLOW = (245, 180, 0)
YELLOW_D = (196, 140, 0)
STEEL = (55, 60, 70)
STEEL_L = (110, 118, 130)
GLASS = (150, 200, 225)
TIRE = (28, 30, 34)
DIRT = (120, 78, 45)
DIRT_D = (84, 54, 32)


# ---------------------------------------------------------------- yardımcılar
def lerp(a, b, t):
    return a + (b - a) * t


def smooth(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def mix(c1, c2, t):
    return tuple(int(lerp(a, b, t)) for a, b in zip(c1, c2))


def keyframes(p, keys):
    """keys: [(faz, deger_tuple)], faz 0..1 artan, son anahtar 1.0 = ilk ile aynı."""
    for i in range(len(keys) - 1):
        p0, v0 = keys[i]
        p1, v1 = keys[i + 1]
        if p0 <= p <= p1:
            t = smooth((p - p0) / (p1 - p0)) if p1 > p0 else 0
            return tuple(lerp(a, b, t) for a, b in zip(v0, v1))
    return keys[-1][1]


def rnd(seed):
    """Deterministik sözde rastgele [0,1)."""
    x = math.sin(seed * 12.9898 + 78.233) * 43758.5453
    return x - math.floor(x)


class Canvas:
    def __init__(self, bg):
        self.img = bg.copy()
        self.d = ImageDraw.Draw(self.img)
        self.fx = Image.new("RGBA", self.img.size, (0, 0, 0, 0))
        self.fd = ImageDraw.Draw(self.fx)

    @staticmethod
    def s(v):
        return v * SS

    def pts(self, pts):
        return [(x * SS, y * SS) for x, y in pts]

    def poly(self, pts, fill, outline=None, width=0):
        self.d.polygon(self.pts(pts), fill=fill, outline=outline, width=width * SS if width else 0)

    def rect(self, x0, y0, x1, y1, fill, r=0):
        if r:
            self.d.rounded_rectangle([x0 * SS, y0 * SS, x1 * SS, y1 * SS], r * SS, fill=fill)
        else:
            self.d.rectangle([x0 * SS, y0 * SS, x1 * SS, y1 * SS], fill=fill)

    def circle(self, x, y, r, fill, outline=None, width=0):
        self.d.ellipse([(x - r) * SS, (y - r) * SS, (x + r) * SS, (y + r) * SS], fill=fill,
                       outline=outline, width=int(width * SS))

    def line(self, pts, fill, width):
        self.d.line(self.pts(pts), fill=fill, width=int(width * SS), joint="curve")

    def glow(self, x, y, r, color, alpha, soft=True):
        if not soft or r < 40:
            self.fd.ellipse([(x - r) * SS, (y - r) * SS, (x + r) * SS, (y + r) * SS], fill=color + (alpha,))
            return
        # yumuşak radyal parlama: iç içe, kenara doğru saydamlaşan halkalar
        n = 14
        layer = Image.new("RGBA", self.fx.size, (0, 0, 0, 0))
        ld = ImageDraw.Draw(layer)
        for i in range(n, 0, -1):
            rr = r * i / n
            a = int(alpha * (1 - (i - 1) / n) ** 1.6)
            ld.ellipse([(x - rr) * SS, (y - rr) * SS, (x + rr) * SS, (y + rr) * SS], fill=color + (a,))
        self.fx.alpha_composite(layer)

    def puff(self, x, y, r, color, alpha):
        self.glow(x, y, r, color, alpha, soft=False)

    def finish(self, blur_fx=6):
        fx = self.fx.filter(ImageFilter.GaussianBlur(blur_fx * SS)) if blur_fx else self.fx
        base = self.img.convert("RGBA")
        base.alpha_composite(fx)
        return base.convert("RGB").resize((W, H), Image.LANCZOS)


def sky(top, mid, bottom, horizon=GROUND):
    """Dikey gökyüzü + zemin gradyanı."""
    w, h = W * SS, H * SS
    arr = Image.new("RGB", (1, h))
    px = arr.load()
    for y in range(h):
        t = y / (horizon * SS)
        if t < 0.6:
            c = mix(top, mid, t / 0.6)
        else:
            c = mix(mid, bottom, min(1, (t - 0.6) / 0.4))
        px[0, y] = c
    return arr.resize((w, h))


def hills(c, color, base, amp, freq, phase, offset=0.0):
    pts = [(0, H)]
    for x in range(0, W + 21, 20):
        xx = x + offset
        y = base - amp * (0.6 * math.sin(xx * freq + phase) + 0.4 * math.sin(xx * freq * 2.3 + phase * 1.7))
        pts.append((x, y))
    pts.append((W, H))
    c.poly(pts, color)


def skyline(c, color, base, seed, offset=0.0, period=W):
    x = -((offset % period))
    i = 0
    while x < W + 10:
        k = int((x + offset) // 1) if False else i
        bw = 30 + rnd(seed + k) * 50
        bh = 30 + rnd(seed + k * 3.1) * 110
        c.rect(x, base - bh, x + bw - 4, base, color)
        if rnd(seed + k * 7.7) > 0.6:
            c.rect(x + bw / 2 - 2, base - bh - 18, x + bw / 2 + 1, base - bh, color)
        x += bw
        i = (i + 1) % 23
    return


def clouds(c, p, color, alpha, y0=120, n=5, seed=3):
    for i in range(n):
        speed = 1 if i % 2 else 2
        x = ((rnd(seed + i) * W) + p * W * speed) % (W + 400) - 200
        y = y0 + rnd(seed + i * 5) * 120
        for j in range(5):
            c.glow(x + j * 38 - 76, y + math.sin(j) * 8, 46 - abs(j - 2) * 8, color, alpha)


def sun(c, x, y, r, color):
    for k, a in ((3.2, 28), (2.2, 45), (1.5, 70)):
        c.glow(x, y, r * k, color, a)
    c.circle(x, y, r, mix(color, (255, 255, 255), 0.45))


def wheel(c, x, y, r, angle, rim=STEEL_L):
    c.circle(x, y, r, TIRE)
    c.circle(x, y, r * 0.55, rim)
    c.circle(x, y, r * 0.18, STEEL)
    for k in range(5):
        a = angle + k * 2 * math.pi / 5
        c.line([(x + math.cos(a) * r * 0.2, y + math.sin(a) * r * 0.2),
                (x + math.cos(a) * r * 0.5, y + math.sin(a) * r * 0.5)], STEEL, 3)


def rot(pts, cx, cy, a):
    ca, sa = math.cos(a), math.sin(a)
    return [(cx + (x - cx) * ca - (y - cy) * sa, cy + (x - cx) * sa + (y - cy) * ca) for x, y in pts]


def ik(px, py, l1, l2, tx, ty):
    """İki uzuvlu ters kinematik; dirsek yukarıda çözüm."""
    dx, dy = tx - px, ty - py
    d = min(math.hypot(dx, dy), l1 + l2 - 1)
    a = math.atan2(dy, dx)
    cos_b = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)
    b = math.acos(max(-1, min(1, cos_b)))
    a1 = a + b  # dirsek yukarı (ekran koordinatında)
    jx, jy = px + l1 * math.cos(a1), py + l1 * math.sin(a1)
    return (jx, jy), a1


def beam(c, x0, y0, x1, y1, w0, w1, fill):
    a = math.atan2(y1 - y0, x1 - x0)
    nx, ny = -math.sin(a), math.cos(a)
    c.poly([(x0 + nx * w0, y0 + ny * w0), (x1 + nx * w1, y1 + ny * w1),
            (x1 - nx * w1, y1 - ny * w1), (x0 - nx * w0, y0 - ny * w0)], fill)


def truss(c, x0, y0, x1, y1, h, color, n, width=3):
    """Kafes kiriş (vinç bomu / kule)."""
    c.line([(x0, y0), (x1, y1)], color, width + 1)
    c.line([(x0, y0 - h), (x1, y1 - h)], color, width + 1)
    for i in range(n + 1):
        t0, t1 = i / n, min(1, (i + 0.5) / n)
        xa, ya = lerp(x0, x1, t0), lerp(y0, y1, t0)
        xb, yb = lerp(x0, x1, t1), lerp(y0, y1, t1)
        c.line([(xa, ya), (xb, yb - h)], color, width)
        if i < n:
            xc, yc = lerp(x0, x1, (i + 1) / n), lerp(y0, y1, (i + 1) / n)
            c.line([(xb, yb - h), (xc, yc)], color, width)


def dump_truck(c, x, y, wheel_a, load=1.0, face=1, bounce=0.0, body=YELLOW):
    """Damperli kamyon; x = arka teker merkezi referansı, y = zemin."""
    y = y - bounce
    f = face

    def X(v):
        return x + v * f

    # şasi
    c.poly([(X(-20), y - 40), (X(250), y - 40), (X(250), y - 55), (X(-20), y - 55)], STEEL)
    # kasa
    c.poly([(X(-30), y - 55), (X(170), y - 55), (X(185), y - 135), (X(-40), y - 135)], body)
    c.poly([(X(-40), y - 135), (X(185), y - 135), (X(183), y - 125), (X(-38), y - 125)], YELLOW_D)
    for k in range(4):
        xx = lerp(-25, 165, (k + 0.5) / 4)
        c.line([(X(xx), y - 58), (X(xx + 3), y - 128)], YELLOW_D, 3)
    if load > 0:
        hh = 30 * load
        c.poly([(X(-36), y - 133), (X(10), y - 133 - hh), (X(70), y - 133 - hh * 1.25),
                (X(130), y - 133 - hh), (X(182), y - 133)], DIRT)
        c.poly([(X(30), y - 133 - hh * 0.9), (X(70), y - 133 - hh * 1.25), (X(110), y - 133 - hh * 0.95)], DIRT_D)
    # kabin
    c.poly([(X(190), y - 55), (X(290), y - 55), (X(290), y - 105), (X(270), y - 150), (X(195), y - 150)], body)
    c.poly([(X(205), y - 140), (X(262), y - 140), (X(278), y - 108), (X(205), y - 108)], GLASS)
    c.line([(X(240), y - 140), (X(240), y - 108)], body, 3)
    c.rect(min(X(282), X(292)), y - 75, max(X(282), X(292)), y - 62, (255, 230, 150))  # far
    c.rect(min(X(180), X(188)), y - 175, max(X(180), X(188)), y - 140, STEEL)  # egzoz
    for wx in (20, 80, 240):
        wheel(c, X(wx), y - 22, 24, wheel_a * f)


def excavator(c, p, base_x, ground, target, bucket_a, carrying):
    # paletler
    c.rect(base_x - 130, ground - 48, base_x + 130, ground - 4, TIRE, r=22)
    for i in range(6):
        c.circle(base_x - 105 + i * 42, ground - 26, 11, STEEL)
    c.rect(base_x - 120, ground - 48, base_x + 120, ground - 42, STEEL)
    # üst yapı
    c.rect(base_x - 95, ground - 125, base_x + 115, ground - 50, YELLOW, r=6)
    c.rect(base_x + 60, ground - 135, base_x + 125, ground - 70, STEEL)  # karşı ağırlık
    c.rect(base_x - 95, ground - 200, base_x - 20, ground - 110, YELLOW, r=8)  # kabin
    c.poly([(base_x - 85, ground - 190), (base_x - 30, ground - 190), (base_x - 30, ground - 135),
            (base_x - 85, ground - 125)], GLASS)
    c.rect(base_x + 20, ground - 165, base_x + 30, ground - 125, STEEL)
    # kol (IK)
    px, py = base_x - 30, ground - 120
    l1, l2 = 250, 190
    (jx, jy), _ = ik(px, py, l1, l2, *target)
    tx, ty = target
    beam(c, px, py, jx, jy, 22, 16, YELLOW)
    beam(c, jx, jy, tx, ty, 14, 10, YELLOW_D)
    # hidrolik silindirler
    c.line([(lerp(px, jx, 0.15) + 10, py + 25), (lerp(px, jx, 0.6), lerp(py, jy, 0.6) + 14)], STEEL_L, 7)
    c.line([(lerp(px, jx, 0.8), lerp(py, jy, 0.8) - 14), (lerp(jx, tx, 0.35), lerp(jy, ty, 0.35) - 12)], STEEL_L, 6)
    c.circle(jx, jy, 10, STEEL)
    c.circle(px, py, 12, STEEL)
    # kova
    stick_a = math.atan2(ty - jy, tx - jx)
    a = stick_a + bucket_a
    pts = [(0, -12), (60, -14), (75, 30), (55, 50), (10, 40)]
    pts = [(tx + x * math.cos(a) - y * math.sin(a), ty + x * math.sin(a) + y * math.cos(a)) for x, y in pts]
    c.poly(pts, YELLOW_D)
    for k in range(3):
        tt = (k + 0.5) / 3
        bx, by = lerp(pts[2][0], pts[3][0], tt), lerp(pts[2][1], pts[3][1], tt)
        c.circle(bx, by, 4, STEEL)
    if carrying > 0.05:
        cx_, cy_ = sum(x for x, _ in pts) / 5, sum(y for _, y in pts) / 5
        c.circle(cx_, cy_ - 8, 26 * carrying, DIRT)
    c.circle(tx, ty, 8, STEEL)
    return pts


# ---------------------------------------------------------------- sahneler
_BG = {}


def bg(key, top, mid, bottom):
    if key not in _BG:
        _BG[key] = sky(top, mid, bottom)
    return _BG[key]


def scene_hafriyat(p, theme):
    pal = THEMES[theme]
    c = Canvas(bg("hafriyat" + theme, pal["top"], pal["mid"], pal["hor"]))
    sun(c, 1010, 250, 46, pal["sun"])
    clouds(c, p, pal["cloud"], 40)
    skyline(c, mix(pal["far"], pal["mid"], 0.35), 470, 11)
    hills(c, pal["far"], 500, 30, 0.006, 1.0)
    hills(c, pal["near"], 540, 18, 0.009, 2.4)
    c.rect(0, GROUND, W, H, pal["ground"])
    c.rect(0, GROUND, W, GROUND + 8, mix(pal["ground"], (0, 0, 0), 0.2))
    # çukur
    c.poly([(470, GROUND), (680, GROUND), (650, 650), (510, 655)], DIRT_D)
    c.poly([(510, 655), (650, 650), (640, 665), (520, 668)], mix(DIRT_D, (0, 0, 0), 0.3))
    # yığın
    c.poly([(1000, GROUND), (1080, 495), (1150, 480), (1240, GROUND)], DIRT)
    keys = [
        (0.00, (520, 470, -0.5, 0.0)),
        (0.16, (545, 625, -0.2, 0.0)),
        (0.32, (630, 610, 1.6, 1.0)),
        (0.48, (560, 420, 1.7, 1.0)),
        (0.64, (400, 360, 1.7, 1.0)),
        (0.74, (395, 380, -0.9, 0.0)),
        (0.88, (470, 430, -0.6, 0.0)),
        (1.00, (520, 470, -0.5, 0.0)),
    ]
    tx, ty, ba, carry = keyframes(p, keys)
    dumped = smooth((p - 0.64) / 0.12)
    load = 0.55 + 0.45 * (dumped if p > 0.64 else 0) if p < 0.97 else 0.55
    dump_truck(c, 260, GROUND, 0, load=load, face=1)
    excavator(c, p, 880, GROUND, (tx, ty), ba, carry)
    # dökülen toprak
    if 0.66 < p < 0.86:
        for i in range(26):
            q = (p - 0.66) / 0.2
            t = (q * 1.6 + rnd(i) * 0.8) % 1
            x = 395 + (rnd(i + 9) - 0.5) * 70
            y = 400 + t * 50
            c.circle(x, y, 4 + rnd(i + 3) * 5, DIRT)
        c.puff(380, 430, 70, (190, 150, 110), int(90 * math.sin(math.pi * (p - 0.66) / 0.2)))
    # kazı tozu
    if 0.12 < p < 0.4:
        a = math.sin(math.pi * (p - 0.12) / 0.28)
        for i in range(5):
            c.puff(560 + i * 30, 600 - i * 10 - a * 30, 40 + i * 6, (200, 165, 120), int(70 * a))
    # sahne pusu
    c.glow(640, GROUND, 520, pal["haze"], 18)
    return c.finish()


def scene_insaat(p, theme):
    pal = THEMES[theme]
    c = Canvas(bg("insaat" + theme, pal["top"], pal["mid"], pal["hor"]))
    sun(c, 200, 300, 36, pal["sun"])
    clouds(c, p, pal["cloud"], 32, seed=8)
    skyline(c, mix(pal["far"], pal["mid"], 0.4), 500, 31)
    hills(c, pal["far"], 520, 14, 0.007, 0.4)
    c.rect(0, GROUND, W, H, pal["ground"])
    # yapı (betonarme karkas)
    bx0, bx1, floors, fh = 120, 520, 6, 62
    concrete = (170, 172, 176)
    for f in range(floors):
        y = GROUND - (f + 1) * fh
        c.rect(bx0 - 10, y, bx1 + 10, y + 12, concrete)
        for k in range(6):
            x = lerp(bx0, bx1 - 22, k / 5)
            c.rect(x, y + 12, x + 22, y + fh, mix(concrete, (0, 0, 0), 0.15))
        if f < floors - 1:
            for k in range(5):
                x = lerp(bx0 + 30, bx1 - 50, k / 4)
                lit = rnd(f * 10 + k) > 0.55
                c.rect(x, y + 20, x + 40, y + fh - 6, (255, 205, 120) if lit and pal["night"] else (70, 80, 95))
    top = GROUND - floors * fh
    for k in range(10):  # filizler
        x = lerp(bx0, bx1, k / 9)
        c.line([(x, top), (x, top - 30)], (150, 90, 60), 3)
    # iskele
    for k in range(floors * 2):
        y = GROUND - k * fh / 2
        c.line([(bx1 + 14, y), (bx1 + 44, y)], STEEL_L, 2)
    c.line([(bx1 + 14, GROUND), (bx1 + 14, top)], STEEL_L, 3)
    c.line([(bx1 + 44, GROUND), (bx1 + 44, top)], STEEL_L, 3)
    # beton mikseri
    mx = 720
    c.rect(mx, GROUND - 60, mx + 230, GROUND - 40, STEEL)
    drum_a = p * 2 * math.pi * 3
    c.poly([(mx + 10, GROUND - 60), (mx + 40, GROUND - 120), (mx + 150, GROUND - 130), (mx + 165, GROUND - 60)], (225, 228, 232))
    for k in range(3):
        o = ((drum_a * 12 + k * 50) % 150)
        c.line([(mx + 15 + o, GROUND - 62), (mx + 35 + o, GROUND - 125)], (190, 70, 40), 5)
    c.poly([(mx + 175, GROUND - 60), (mx + 230, GROUND - 60), (mx + 230, GROUND - 105), (mx + 185, GROUND - 120)], YELLOW)
    c.rect(mx + 195, GROUND - 110, mx + 222, GROUND - 82, GLASS)
    for wx in (40, 110, 200):
        wheel(c, mx + wx, GROUND - 20, 20, 0)
    # kule vinç
    cx, jib_y = 640, 130
    c.rect(cx - 30, GROUND - 10, cx + 30, GROUND, STEEL)
    truss(c, cx - 14, GROUND - 10, cx - 14, jib_y + 20, 0, YELLOW, 1, 4)
    truss(c, cx + 14, GROUND - 10, cx + 14, jib_y + 20, 0, YELLOW, 1, 4)
    n = 14
    for i in range(n):
        y0 = lerp(GROUND - 10, jib_y + 20, i / n)
        y1 = lerp(GROUND - 10, jib_y + 20, (i + 1) / n)
        c.line([(cx - 14, y0), (cx + 14, y1)], YELLOW_D, 2)
        c.line([(cx - 14, y1), (cx + 14, y1)], YELLOW_D, 2)
    c.rect(cx - 22, jib_y + 10, cx + 22, jib_y + 45, YELLOW)
    c.rect(cx - 18, jib_y + 18, cx + 2, jib_y + 38, GLASS)
    c.poly([(cx - 4, jib_y - 70), (cx + 4, jib_y - 70), (cx + 10, jib_y + 10), (cx - 10, jib_y + 10)], YELLOW_D)
    truss(c, cx, jib_y + 10, 140, jib_y + 10, 20, YELLOW, 18)
    truss(c, cx, jib_y + 10, 860, jib_y + 10, 16, YELLOW, 6)
    c.line([(cx, jib_y - 70), (240, jib_y - 10)], STEEL_L, 2)
    c.line([(cx, jib_y - 70), (850, jib_y - 6)], STEEL_L, 2)
    c.rect(800, jib_y - 20, 860, jib_y + 30, (120, 125, 130))  # karşı ağırlık
    blink = (int(p * FRAMES / 12) % 2) == 0
    if blink:
        c.glow(cx, jib_y - 74, 14, (255, 40, 40), 220)
    c.circle(cx, jib_y - 74, 4, (255, 60, 60) if blink else (120, 20, 20))
    # araba + kanca + kova
    keys = [
        (0.00, (780, 380, 0.0)),  # miksere yakın, kova aşağıda
        (0.10, (780, 410, 0.0)),
        (0.22, (780, 410, 1.0)),  # dolum
        (0.38, (780, 180, 1.0)),
        (0.60, (330, 180, 1.0)),
        (0.70, (330, 230, 1.0)),
        (0.80, (330, 230, 0.0)),  # döküm
        (0.90, (560, 190, 0.0)),
        (1.00, (780, 380, 0.0)),
    ]
    tx, hy, fill = keyframes(p, keys)
    sway = math.sin(p * 2 * math.pi * 4) * 3
    c.rect(tx - 16, jib_y + 10, tx + 16, jib_y + 22, STEEL)
    c.line([(tx - 4, jib_y + 22), (tx - 4 + sway, hy)], (40, 40, 45), 2)
    c.line([(tx + 4, jib_y + 22), (tx + 4 + sway, hy)], (40, 40, 45), 2)
    kx = tx + sway
    c.rect(kx - 8, hy, kx + 8, hy + 14, YELLOW_D)
    c.line([(kx, hy + 14), (kx - 30, hy + 40)], STEEL, 2)
    c.line([(kx, hy + 14), (kx + 30, hy + 40)], STEEL, 2)
    c.poly([(kx - 34, hy + 40), (kx + 34, hy + 40), (kx + 20, hy + 100), (kx - 20, hy + 100)], (95, 100, 108))
    if fill > 0.05:
        c.poly([(kx - 30, hy + 44), (kx + 30, hy + 44), (kx + 30 - 4 * fill, hy + 44 + 20 * fill), (kx - 30 + 4 * fill, hy + 44 + 20 * fill)], (150, 150, 150))
    if 0.7 < p < 0.82:
        a = math.sin(math.pi * (p - 0.7) / 0.12)
        for i in range(10):
            yy = hy + 100 + ((p * 900 + i * 13) % 50)
            c.circle(kx + (rnd(i) - 0.5) * 10, yy, 4, (160, 160, 160))
        c.puff(kx, top - 10, 50, (220, 220, 220), int(60 * a))
    if pal["night"]:
        c.glow(320, top, 260, (255, 200, 120), 30)
    return c.finish()


def scene_nakliye(p, theme):
    pal = THEMES[theme]
    c = Canvas(bg("nakliye" + theme, pal["top"], pal["mid"], pal["hor"]))
    sun(c, 1050, 210, 40, pal["sun"])
    clouds(c, p, pal["cloud"], 45, y0=90, n=6, seed=21)
    # paralaks: her katmanın kayması döngüde periyodunun tam katı
    hills(c, pal["far"], 470, 40, 2 * math.pi / W, 0.3, offset=p * W)
    hills(c, pal["near"], 520, 26, 2 * math.pi * 2 / W, 1.2, offset=p * W * 2)
    c.rect(0, 540, W, H, pal["ground"])
    c.rect(0, 585, W, 690, (52, 55, 62))  # yol
    c.rect(0, 585, W, 591, (200, 200, 200))
    c.rect(0, 684, W, 690, (200, 200, 200))
    off = (p * 8 * 160) % 160
    for k in range(-1, 10):
        x = k * 160 - off
        c.rect(x, 634, x + 80, 640, (240, 220, 120))
    # yol kenarı direkleri
    off2 = (p * 4 * 320) % 320
    for k in range(-1, 6):
        x = k * 320 - off2
        c.rect(x, 470, x + 6, 585, (90, 90, 95))
        c.rect(x - 4, 470, x + 26, 476, (90, 90, 95))
        c.circle(x + 30, 480, 6, (255, 240, 200) if pal["night"] else (200, 200, 190))
    # ağaçlar
    off3 = (p * 2 * 640) % 640
    for k in range(-1, 4):
        x = k * 640 - off3 + 200
        c.rect(x, 500, x + 10, 545, (70, 50, 35))
        c.circle(x + 5, 490, 32, mix(pal["near"], (40, 110, 60), 0.6))
    bounce = abs(math.sin(p * 2 * math.pi * 6)) * 2
    wheel_a = -p * 2 * math.pi * 10
    dump_truck(c, 440, 660, wheel_a, load=1.0, face=1, bounce=bounce)
    for i in range(4):
        q = (p * 6 + i / 4) % 1
        c.puff(450 + 0 - q * 200, 470 - q * 60, 14 + q * 30, (150, 150, 150), int(90 * (1 - q)))
    for i in range(6):
        q = (p * 10 + i / 6) % 1
        c.puff(400 - q * 220, 655 - q * 10, 10 + q * 18, (180, 160, 130), int(60 * (1 - q)))
    if pal["night"]:
        c.glow(780, 600, 120, (255, 240, 180), 60)
    return c.finish()


def container(c, x, y, w, h, color):
    c.rect(x, y, x + w, y + h, color)
    for k in range(1, int(w // 10)):
        c.line([(x + k * 10, y + 3), (x + k * 10, y + h - 3)], mix(color, (0, 0, 0), 0.25), 2)
    c.rect(x, y, x + w, y + 3, mix(color, (255, 255, 255), 0.25))


def scene_ihracat(p, theme):
    pal = THEMES[theme]
    c = Canvas(bg("ihracat" + theme, pal["top"], pal["mid"], pal["hor"]))
    sun(c, 940, 330, 52, pal["sun"])
    clouds(c, p, pal["cloud"], 35, y0=80, seed=44)
    skyline(c, mix(pal["far"], pal["mid"], 0.45), 470, 57)
    # deniz
    sea = (28, 72, 110) if not pal["night"] else (16, 34, 58)
    c.rect(0, 470, W, H, sea)
    for k in range(14):
        y = 480 + k * 18
        ph = p * 2 * math.pi + k
        pts = [(x, y + math.sin(x * 0.03 + ph) * 2) for x in range(0, W + 1, 32)]
        c.line(pts, mix(sea, (255, 255, 255), 0.12), 2)
    c.glow(940, 520, 120, pal["sun"], 40)
    # gemi
    hull = (150, 35, 35)
    c.poly([(40, 470), (640, 470), (610, 560), (80, 560)], hull)
    c.rect(40, 455, 640, 472, (30, 40, 55))
    c.rect(560, 330, 630, 455, (235, 235, 235))
    c.rect(570, 345, 620, 360, GLASS)
    c.rect(590, 300, 604, 330, STEEL)
    colors = [(30, 110, 170), (200, 80, 40), (60, 140, 80), (220, 170, 40), (150, 50, 60), (90, 90, 160)]
    for col in range(9):
        for row in range(3 if col != 5 else 2):
            container(c, 70 + col * 54, 455 - (row + 1) * 30, 52, 28, colors[(col * 3 + row) % 6])
    # rıhtım
    c.rect(660, 470, W, H, (95, 98, 104))
    c.rect(660, 470, W, 480, (130, 133, 140))
    # STS liman vinci
    gx = 760
    crane_c = (210, 60, 40)
    c.rect(gx, 140, gx + 18, 600, crane_c)
    c.rect(gx + 200, 140, gx + 218, 600, crane_c)
    c.line([(gx + 9, 600), (gx + 209, 140)], crane_c, 6)
    c.rect(gx - 10, 130, gx + 228, 150, crane_c)
    c.rect(260, 150, gx + 400, 168, crane_c)  # bom
    c.line([(gx + 109, 60), (290, 152)], STEEL_L, 3)
    c.line([(gx + 109, 60), (gx + 380, 152)], STEEL_L, 3)
    c.rect(gx + 100, 60, gx + 118, 140, crane_c)
    # tır
    tx0 = 900
    c.rect(tx0, 560, tx0 + 230, 572, STEEL)
    c.poly([(tx0 + 235, 520), (tx0 + 300, 520), (tx0 + 310, 572), (tx0 + 235, 572)], (240, 240, 240))
    c.rect(tx0 + 250, 528, tx0 + 290, 548, GLASS)
    for wx in (30, 70, 180, 280):
        wheel(c, tx0 + wx, 584, 13, 0)
    # konteyner döngüsü: tırdan gemiye (0-0.5), gemiden tıra (0.5-1)
    hold_x, hold_y = 70 + 5 * 54 + 26, 455 - 3 * 30  # boş yuvanın üstü
    truck_x, truck_y = tx0 + 110, 560 - 28
    keys = [
        (0.00, (truck_x, truck_y)),
        (0.08, (truck_x, truck_y)),
        (0.20, (truck_x, 220)),
        (0.34, (hold_x, 220)),
        (0.44, (hold_x, hold_y)),
        (0.56, (hold_x, hold_y)),
        (0.68, (hold_x, 220)),
        (0.82, (truck_x, 220)),
        (0.92, (truck_x, truck_y)),
        (1.00, (truck_x, truck_y)),
    ]
    kx, ky = keyframes(p, keys)
    c.rect(kx - 22, 166, kx + 22, 180, STEEL)
    c.line([(kx - 10, 180), (kx - 10, ky - 10)], (30, 30, 30), 2)
    c.line([(kx + 10, 180), (kx + 10, ky - 10)], (30, 30, 30), 2)
    c.rect(kx - 64, ky - 12, kx + 64, ky - 2, YELLOW)
    container(c, kx - 60, ky - 2, 120, 30, (30, 110, 170))
    if pal["night"]:
        for lx in (gx + 9, gx + 209):
            c.glow(lx, 150, 70, (255, 230, 170), 70)
    return c.finish()


def loader(c, x, y, lift, wheel_a):
    # lastikli yükleyici, sola bakıyor
    c.poly([(x - 20, y - 70), (x + 150, y - 70), (x + 160, y - 120), (x + 60, y - 125), (x - 10, y - 110)], YELLOW)
    c.rect(x + 40, y - 205, x + 125, y - 115, YELLOW, r=8)
    c.rect(x + 52, y - 195, x + 112, y - 130, GLASS)
    c.rect(x + 140, y - 150, x + 148, y - 120, STEEL)
    c.rect(x - 10, y - 75, x + 160, y - 55, STEEL)
    # kol
    pivot = (x + 30, y - 110)
    a = math.radians(lerp(25, -25, lift))
    end = (pivot[0] - math.cos(a) * 140, pivot[1] + math.sin(a) * 140)
    beam(c, pivot[0], pivot[1], end[0], end[1], 12, 9, YELLOW_D)
    c.line([(x + 50, y - 80), (lerp(pivot[0], end[0], 0.6), lerp(pivot[1], end[1], 0.6))], STEEL_L, 7)
    bt = math.radians(lerp(0, -35, lift))
    bk = [(0, -30), (-60, -10), (-70, 30), (5, 40)]
    bk = rot([(end[0] + bx, end[1] + by) for bx, by in bk], end[0], end[1], bt)
    c.poly(bk, YELLOW_D)
    c.circle(end[0], end[1], 7, STEEL)
    for wx in (10, 120):
        wheel(c, x + wx, y - 36, 36, wheel_a)
    return bk


def scene_makine(p, theme):
    pal = THEMES[theme]
    c = Canvas(bg("makine" + theme, pal["top"], pal["mid"], pal["hor"]))
    sun(c, 300, 200, 34, pal["sun"])
    clouds(c, p, pal["cloud"], 38, seed=61)
    # taş ocağı basamakları
    hills(c, pal["far"], 430, 30, 0.004, 3.0)
    rock = (150, 118, 90)
    for i, (y, x0) in enumerate(((330, 600), (380, 520), (430, 440), (480, 380))):
        c.poly([(x0, y), (W, y - 20), (W, GROUND), (x0 - 80, GROUND)], mix(rock, (0, 0, 0), 0.08 * i))
    c.rect(0, GROUND, W, H, pal["ground"])
    # malzeme yığını
    c.poly([(40, GROUND), (150, 450), (260, 430), (380, GROUND)], DIRT)
    c.poly([(150, 450), (260, 430), (230, 470)], DIRT_D)
    # arka planda dozer
    dx = 860 + math.sin(p * 2 * math.pi) * 120
    c.rect(dx, 470, dx + 110, 500, TIRE, r=12)
    c.rect(dx + 15, 435, dx + 95, 472, YELLOW)
    c.rect(dx + 50, 405, dx + 90, 440, YELLOW)
    c.rect(dx + 56, 411, dx + 84, 430, GLASS)
    c.rect(dx - 22, 440, dx - 10, 500, YELLOW_D)
    # yükleyici döngüsü: ileri (yığına) -> kepçe kalk -> geri
    keys = [
        (0.00, (640, 0.0)),
        (0.25, (420, 0.0)),
        (0.35, (420, 0.25)),
        (0.60, (640, 0.85)),
        (0.80, (640, 0.85)),
        (1.00, (640, 0.0)),
    ]
    lx, lift = keyframes(p, keys)
    wheel_a = (lx - 640) / 36
    bk = loader(c, lx, GROUND + 6, lift, wheel_a)
    if 0.3 < p < 0.85:
        cx_ = sum(x for x, _ in bk) / 4
        cy_ = sum(y for _, y in bk) / 4
        c.circle(cx_, cy_ - 12, 26, DIRT)
    if 0.2 < p < 0.4:
        a = math.sin(math.pi * (p - 0.2) / 0.2)
        c.puff(380, 520, 70, (200, 170, 130), int(90 * a))
    c.glow(640, GROUND, 520, pal["haze"], 18)
    return c.finish()


THEMES = {
    "dusk": dict(top=(22, 30, 54), mid=(196, 96, 52), hor=(250, 180, 90), sun=(255, 170, 60),
                 cloud=(255, 190, 150), far=(70, 50, 70), near=(52, 40, 50), ground=(96, 72, 52),
                 haze=(255, 180, 110), night=True),
    "day": dict(top=(40, 110, 190), mid=(130, 185, 230), hor=(225, 235, 240), sun=(255, 236, 170),
                cloud=(255, 255, 255), far=(110, 140, 160), near=(90, 130, 100), ground=(150, 120, 85),
                haze=(255, 245, 220), night=False),
    "dawn": dict(top=(40, 60, 110), mid=(220, 150, 140), hor=(250, 215, 170), sun=(255, 210, 140),
                 cloud=(255, 220, 210), far=(100, 90, 120), near=(80, 80, 95), ground=(120, 98, 75),
                 haze=(255, 220, 190), night=False),
}

SCENES = {
    "hafriyat": (scene_hafriyat, "dusk"),
    "insaat": (scene_insaat, "dusk"),
    "nakliye": (scene_nakliye, "day"),
    "makine": (scene_makine, "day"),
}


def _frame(args):
    name, i, theme = args
    fn = SCENES[name][0]
    return fn(i / FRAMES, theme).tobytes()


def render_video(name):
    theme = SCENES[name][1]
    os.makedirs(os.path.join(OUT, "video"), exist_ok=True)
    mp4 = os.path.join(OUT, "video", f"{name}.mp4")
    ff = subprocess.Popen([
        "ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}",
        "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-preset", "slow", "-crf", "26", "-pix_fmt", "yuv420p",
        "-movflags", "+faststart", "-an", mp4], stdin=subprocess.PIPE)
    with Pool() as pool:
        for buf in pool.imap(_frame, [(name, i, theme) for i in range(FRAMES)], chunksize=4):
            ff.stdin.write(buf)
    ff.stdin.close()
    ff.wait()
    webm = os.path.join(OUT, "video", f"{name}.webm")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", mp4, "-c:v", "libvpx-vp9", "-b:v", "0",
                    "-crf", "38", "-row-mt", "1", "-an", webm], check=True)
    print(f"video: {name} -> {os.path.getsize(mp4)//1024} KB mp4, {os.path.getsize(webm)//1024} KB webm")


def render_stills(name):
    fn, theme = SCENES[name]
    os.makedirs(os.path.join(OUT, "img", "og"), exist_ok=True)
    im = fn(0.30, theme)
    im.save(os.path.join(OUT, "img", f"{name}.webp"), quality=80, method=6)
    im.resize((640, 360), Image.LANCZOS).save(os.path.join(OUT, "img", f"{name}-sm.webp"), quality=78, method=6)
    og = im.resize((1200, 675), Image.LANCZOS).crop((0, 22, 1200, 652))
    og.save(os.path.join(OUT, "img", "og", f"{name}.jpg"), quality=82, optimize=True, progressive=True)


def render_blog_covers():
    posts_dir = os.path.join(ROOT, "src", "content", "posts")
    if not os.path.isdir(posts_dir):
        return
    os.makedirs(os.path.join(OUT, "img", "blog"), exist_ok=True)
    themes = ["day", "dusk", "dawn"]
    for i, fname in enumerate(sorted(os.listdir(posts_dir))):
        if not fname.endswith(".mjs"):
            continue
        slug = fname[:-4]
        src = open(os.path.join(posts_dir, fname), encoding="utf-8").read()
        m = re.search(r"scene\s*:\s*['\"](\w+)['\"]", src)
        scene = m.group(1) if m and m.group(1) in SCENES else "hafriyat"
        h = sum(ord(ch) for ch in slug)
        im = SCENES[scene][0]((h % 97) / 97, themes[h % 3])
        im.save(os.path.join(OUT, "img", "blog", f"{slug}.webp"), quality=78, method=6)
        im.resize((640, 360), Image.LANCZOS).save(os.path.join(OUT, "img", "blog", f"{slug}-sm.webp"), quality=76, method=6)
        print("kapak:", slug, scene)


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    names = args or list(SCENES)
    for n in names:
        render_stills(n)
    if "--covers" in sys.argv or not args:
        render_blog_covers()
    if "--stills-only" not in sys.argv:
        for n in names:
            render_video(n)
