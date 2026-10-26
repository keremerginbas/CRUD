#!/usr/bin/env python3
"""TKGM parselinin Esri uydu goruntusu uzerinde drone tarzi dikey (9:16) videosunu uretir.

Akis:
  1. TKGM parsel sorgu API'sinden (il -> ilce -> mahalle -> ada/parsel) parsel sinirini alir.
  2. Esri World Imagery karolarini indirir; "Map data not yet available" donen karo varsa
     yakinlastirmayi (zoom) bir kademe dusurur ve tekrar dener.
  3. Kamerayi parselin etrafinda egik aciyla dondurur. Egim + gorus acisi ufuk cizgisi
     hic gorunmeyecek sekilde sinirlidir; karenin tamami gercek goruntuyle dolar.
  4. Kareleri ffmpeg ile 1080x1920 H.264 MP4 olarak kodlar.

Kullanim:
  python3 parsel_video.py --il Ankara --ilce Etimesgut --mahalle Erler --ada 49079 --parsel 1
  python3 parsel_video.py --geojson parsel.json      # TKGM'den onceden alinmis sinir
"""
import argparse
import io
import json
import math
import os
import subprocess
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

TKGM = "https://cbsapi.tkgm.gov.tr/megsiswebapi.v3/api"
ESRI = ("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/"
        "MapServer/tile/{z}/{y}/{x}?blankTile=false")
UA = {"User-Agent": "Mozilla/5.0", "Referer": "https://parselsorgu.tkgm.gov.tr/"}
TILE = 256
R_EARTH = 6378137.0


def get(url, timeout=30):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def norm(s):
    tr = str.maketrans("İIıŞşĞğÜüÖöÇç", "iiissgguuoocc")
    return s.translate(tr).lower().strip()


def pick(features, name):
    for f in features:
        p = f.get("properties", f)
        if norm(p.get("text", "")) == norm(name):
            return p["id"]
    names = [f.get("properties", f).get("text") for f in features]
    sys.exit(f"'{name}' bulunamadi. Secenekler: {names}")


def tkgm_parcel(il, ilce, mahalle, ada, parsel):
    il_id = pick(json.loads(get(f"{TKGM}/idariYapi/ilListe"))["features"], il)
    ilce_id = pick(json.loads(get(f"{TKGM}/idariYapi/ilceListe/{il_id}"))["features"], ilce)
    mah_id = pick(json.loads(get(f"{TKGM}/idariYapi/mahalleListe/{ilce_id}"))["features"], mahalle)
    return json.loads(get(f"{TKGM}/parsel/{mah_id}/{ada}/{parsel}"))


def outer_ring(feature):
    g = feature["geometry"]
    ring = g["coordinates"][0] if g["type"] == "Polygon" else g["coordinates"][0][0]
    return [(float(x), float(y)) for x, y in ring]


# --- Web Mercator yardimcilari -------------------------------------------------

def lonlat_to_px(lon, lat, z):
    n = TILE * 2 ** z
    x = (lon + 180.0) / 360.0 * n
    s = math.sin(math.radians(lat))
    y = (0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)) * n
    return x, y


def meters_per_px(lat, z):
    return 2 * math.pi * R_EARTH * math.cos(math.radians(lat)) / (TILE * 2 ** z)


def is_placeholder(img):
    """Esri'nin gri 'Map data not yet available' karosunu tanir."""
    a = np.asarray(img.convert("RGB"), dtype=np.float32)
    sat = a.max(axis=2) - a.min(axis=2)
    gray = (sat < 6) & (a.mean(axis=2) > 150) & (a.mean(axis=2) < 235)
    return gray.mean() > 0.85


def fetch_tile(z, x, y):
    try:
        img = Image.open(io.BytesIO(get(ESRI.format(z=z, x=x, y=y)))).convert("RGB")
    except urllib.error.HTTPError as e:
        if e.code == 404:  # blankTile=false: veri yok
            return None
        raise
    return None if is_placeholder(img) else img


def build_mosaic(lon, lat, radius_m, zmax=19, zmin=14):
    for z in range(zmax, zmin - 1, -1):
        cx, cy = lonlat_to_px(lon, lat, z)
        r = radius_m / meters_per_px(lat, z)
        tx0, ty0 = int((cx - r) // TILE), int((cy - r) // TILE)
        tx1, ty1 = int((cx + r) // TILE), int((cy + r) // TILE)
        coords = [(x, y) for y in range(ty0, ty1 + 1) for x in range(tx0, tx1 + 1)]
        print(f"zoom {z}: {len(coords)} karo indiriliyor...", flush=True)
        with ThreadPoolExecutor(16) as ex:
            tiles = list(ex.map(lambda c: fetch_tile(z, *c), coords))
        missing = sum(t is None for t in tiles)
        if missing:
            print(f"  zoom {z}: {missing} karoda 'Map data not yet available' -> zoom dusuruluyor")
            continue
        W, H = (tx1 - tx0 + 1) * TILE, (ty1 - ty0 + 1) * TILE
        mosaic = Image.new("RGB", (W, H))
        for (x, y), t in zip(coords, tiles):
            mosaic.paste(t, ((x - tx0) * TILE, (y - ty0) * TILE))
        return mosaic, z, (tx0 * TILE, ty0 * TILE)
    sys.exit("Hicbir zoom seviyesinde tam goruntu bulunamadi.")


# --- Perspektif render ---------------------------------------------------------

class Ground:
    """Mozaigi metre cinsinden yer duzlemi olarak ornekler (mip seviyeli, bilinear)."""

    def __init__(self, mosaic, mpp, origin_px):
        self.mpp, self.ox, self.oy = mpp, origin_px[0], origin_px[1]
        self.levels = []
        im = mosaic
        while True:
            self.levels.append(np.asarray(im, dtype=np.uint8))
            if min(im.size) < 64 or len(self.levels) > 7:
                break
            im = im.resize((im.width // 2, im.height // 2), Image.BOX)

    def sample_level(self, lvl, px, py):
        a = self.levels[lvl]
        h, w = a.shape[:2]
        flat = a.reshape(-1, 3)
        s = 2 ** lvl
        x = np.clip(px / s - 0.5, 0, w - 1.001)
        y = np.clip(py / s - 0.5, 0, h - 1.001)
        x0, y0 = x.astype(np.int32), y.astype(np.int32)
        fx, fy = (x - x0)[:, None], (y - y0)[:, None]
        i00 = y0 * w + x0
        c00, c10 = flat.take(i00, axis=0), flat.take(i00 + 1, axis=0)
        c01, c11 = flat.take(i00 + w, axis=0), flat.take(i00 + w + 1, axis=0)
        top = c00 + (c10.astype(np.float32) - c00) * fx
        bot = c01 + (c11.astype(np.float32) - c01) * fx
        return top + (bot - top) * fy

    def lod_groups(self, footprint_m):
        """Piksel basina mip seviyesi; yorunge boyunca sabit oldugu icin bir kez hesaplanir."""
        lod = np.clip(np.log2(np.maximum(footprint_m / self.mpp, 1e-6)), 0, len(self.levels) - 1)
        l0 = np.floor(lod).astype(np.int32)
        groups = []
        for lvl in range(int(l0.min()), int(l0.max()) + 1):
            idx = np.flatnonzero(l0 == lvl)
            if idx.size:
                groups.append((lvl, idx, (lod.ravel()[idx] - lvl)[:, None].astype(np.float32)))
        return groups

    def sample(self, east, north, groups):
        # metre (merkeze gore dogu/kuzey) -> mozaik pikseli
        px = (east / self.mpp + self.cx).ravel()
        py = (-north / self.mpp + self.cy).ravel()
        out = np.empty((px.size, 3), np.float32)
        top = len(self.levels) - 1
        for lvl, idx, t in groups:
            a = self.sample_level(lvl, px[idx], py[idx])
            b = self.sample_level(min(lvl + 1, top), px[idx], py[idx])
            out[idx] = a * (1 - t) + b * t
        return out.reshape(east.shape + (3,))


def camera_rays(w, h, vfov_deg):
    f = (h / 2) / math.tan(math.radians(vfov_deg) / 2)
    u = np.arange(w, dtype=np.float32) - w / 2 + 0.5
    v = np.arange(h, dtype=np.float32) - h / 2 + 0.5
    uu, vv = np.meshgrid(u, v)
    return uu / f, -vv / f, f  # kamera uzayi: x sag, y yukari, z ileri (1)


def basis(yaw, tilt):
    """yaw: kameranin baktigi yon (kuzeyden saat yonu, rad); tilt: nadirden egim (rad)."""
    fwd = np.array([math.sin(yaw) * math.sin(tilt), math.cos(yaw) * math.sin(tilt), -math.cos(tilt)])
    right = np.array([math.cos(yaw), -math.sin(yaw), 0.0])
    up = np.cross(right, fwd)
    return right, up, fwd


def project(pts_enu, cam, right, up, fwd, f, w, h):
    out = []
    for e, n in pts_enu:
        d = np.array([e, n, 0.0]) - cam
        z = d @ fwd
        out.append((w / 2 + (d @ right) / z * f, h / 2 - (d @ up) / z * f))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--il", default="Ankara")
    ap.add_argument("--ilce", default="Etimesgut")
    ap.add_argument("--mahalle", default="Erler")
    ap.add_argument("--ada", default="49079")
    ap.add_argument("--parsel", default="1")
    ap.add_argument("--geojson", help="TKGM parsel GeoJSON dosyasi (API yerine)")
    ap.add_argument("--mosaic", help="test icin: hazir goruntu (merkez=parsel merkezi)")
    ap.add_argument("--mosaic-mpp", type=float, default=0.3)
    ap.add_argument("--out", default="parsel_drone.mp4")
    ap.add_argument("--seconds", type=float, default=16)
    ap.add_argument("--fps", type=int, default=30)
    ap.add_argument("--width", type=int, default=1080)
    ap.add_argument("--height", type=int, default=1920)
    ap.add_argument("--tilt", type=float, default=42, help="nadirden kamera egimi (derece)")
    ap.add_argument("--vfov", type=float, default=50)
    args = ap.parse_args()

    if args.geojson:
        feat = json.load(open(args.geojson))
        if feat.get("type") == "FeatureCollection":
            feat = feat["features"][0]
    else:
        print("TKGM parsel sorgusu...", flush=True)
        feat = tkgm_parcel(args.il, args.ilce, args.mahalle, args.ada, args.parsel)
        with open(os.path.splitext(args.out)[0] + "_tkgm.json", "w") as fh:
            json.dump(feat, fh, ensure_ascii=False)
    ring = outer_ring(feat)
    props = feat.get("properties", {})

    lon0 = sum(p[0] for p in ring[:-1]) / (len(ring) - 1)
    lat0 = sum(p[1] for p in ring[:-1]) / (len(ring) - 1)
    k = math.cos(math.radians(lat0))
    enu = [((lon - lon0) * math.pi / 180 * R_EARTH * k, (lat - lat0) * math.pi / 180 * R_EARTH)
           for lon, lat in ring]
    size = max(max(math.hypot(e, n) for e, n in enu) * 2, 40.0)

    # Kamera geometrisi: parsel kadrajin genisliginin ~%55'ini kaplasin.
    W, H = args.width, args.height
    tilt, vfov = math.radians(args.tilt), math.radians(args.vfov)
    if math.degrees(tilt + vfov / 2) >= 80:
        sys.exit("tilt + vfov/2 80 dereceden kucuk olmali (ufuk gorunmesin).")
    tan_h = math.tan(vfov / 2) * W / H
    slant = size / (0.55 * 2 * tan_h)
    alt = slant * math.cos(tilt)
    ground_off = slant * math.sin(tilt)  # kameranin parsele yatay uzakligi

    rx, ry, f = camera_rays(W, H, math.degrees(vfov))
    # En uzak kose isininin yere carptigi mesafe -> indirilecek alan yaricapi
    r0, u0, fw0 = basis(0.0, tilt)
    far = 0.0
    for sx, sy in [(rx[0, 0], ry[0, 0]), (rx[0, -1], ry[0, -1])]:
        d = sx * r0 + sy * u0 + fw0
        t = alt / -d[2]
        far = max(far, math.hypot(d[0] * t, d[1] * t - ground_off))
    radius = (far + ground_off) * 1.1

    if args.mosaic:
        mosaic = Image.open(args.mosaic).convert("RGB")
        mpp = args.mosaic_mpp
        ground = Ground(mosaic, mpp, (0, 0))
        ground.cx, ground.cy = mosaic.width / 2, mosaic.height / 2
        zoom = None
    else:
        mosaic, zoom, origin = build_mosaic(lon0, lat0, radius)
        mpp = meters_per_px(lat0, zoom)
        ground = Ground(mosaic, mpp, origin)
        cxp, cyp = lonlat_to_px(lon0, lat0, zoom)
        ground.cx, ground.cy = cxp - origin[0], cyp - origin[1]
        print(f"zoom {zoom} kullaniliyor ({mpp:.2f} m/piksel)")

    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 54)
        font_s = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 36)
        font_xs = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 22)
    except OSError:
        font = font_s = font_xs = ImageFont.load_default()
    title = f"{props.get('mahalleAd', args.mahalle)} • Ada {props.get('adaNo', args.ada)} / Parsel {props.get('parselNo', args.parsel)}"
    sub = f"{props.get('ilAd', args.il)} / {props.get('ilceAd', args.ilce)}"
    if props.get("alan"):
        sub += f"  •  {props['alan']} m²"

    ff = subprocess.Popen(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
         "-s", f"{W}x{H}", "-r", str(args.fps), "-i", "-", "-c:v", "libx264",
         "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
         args.out], stdin=subprocess.PIPE)

    # Yaw=0 icin yer koordinatlari bir kez hesaplanir; her karede yalnizca dikey eksen
    # etrafinda dondurulur (kamera sabit irtifa ve egimle dairesel yorungede).
    cam0 = np.array([0.0, -ground_off, alt])
    r0, u0, fw0 = basis(0.0, tilt)
    d = rx[..., None] * r0 + ry[..., None] * u0 + fw0
    tt = alt / -d[..., 2]
    e0 = (cam0[0] + d[..., 0] * tt).astype(np.float32)
    n0 = (cam0[1] + d[..., 1] * tt).astype(np.float32)
    dlen = np.linalg.norm(d, axis=2)
    footprint = tt * dlen / f / np.maximum(-d[..., 2] / dlen, 0.05) ** 0.5
    groups = ground.lod_groups(footprint)
    del d, tt, dlen, footprint

    n = int(args.seconds * args.fps)
    for i in range(n):
        t = i / n
        yaw = 2 * math.pi * t  # kameranin baktigi yon; tam tur
        c, s_ = math.cos(yaw), math.sin(yaw)
        cam = np.array([-s_ * ground_off, -c * ground_off, alt])
        right, up, fwd = basis(yaw, tilt)
        e = e0 * c + n0 * s_
        nn = -e0 * s_ + n0 * c
        frame = Image.fromarray(np.clip(ground.sample(e, nn, groups), 0, 255).astype(np.uint8))

        poly = project(enu, cam, right, up, fwd, f, W, H)
        over = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        dr = ImageDraw.Draw(over)
        dr.polygon(poly, fill=(255, 210, 0, 55))
        glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        ImageDraw.Draw(glow).line(poly, fill=(255, 200, 0, 255), width=18, joint="curve")
        glow = glow.filter(ImageFilter.GaussianBlur(9))
        frame = Image.alpha_composite(frame.convert("RGBA"), glow)
        frame = Image.alpha_composite(frame, over)
        dr = ImageDraw.Draw(frame)
        dr.line(poly, fill=(255, 230, 40, 255), width=6, joint="curve")
        for p in poly[:-1]:
            dr.ellipse([p[0] - 7, p[1] - 7, p[0] + 7, p[1] + 7], fill=(255, 255, 255, 255))

        band = Image.new("RGBA", (W, 260), (0, 0, 0, 0))
        ba = np.zeros((260, W, 4), np.uint8)
        ba[..., 3] = (np.linspace(150, 0, 260)[:, None]).astype(np.uint8)
        band = Image.fromarray(ba)
        frame.alpha_composite(band, (0, 0))
        dr = ImageDraw.Draw(frame)
        dr.text((W / 2, 110), title, font=font, fill="white", anchor="mm", stroke_width=3, stroke_fill="black")
        dr.text((W / 2, 175), sub, font=font_s, fill="white", anchor="mm", stroke_width=2, stroke_fill="black")
        dr.text((W - 20, H - 20), "Sınır: TKGM Parsel Sorgu  •  Görüntü: Esri World Imagery",
                font=font_xs, fill=(255, 255, 255, 220), anchor="rd", stroke_width=2, stroke_fill="black")

        ff.stdin.write(frame.convert("RGB").tobytes())
        if i % 30 == 0:
            print(f"kare {i}/{n}", flush=True)
    ff.stdin.close()
    ff.wait()
    print(f"Tamam: {args.out}")


if __name__ == "__main__":
    main()
