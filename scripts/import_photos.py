#!/usr/bin/env python3
"""
Gerçek fotoğraf ve videoları siteye işler.

src/photos/<anahtar>.(jpg|jpeg|png|webp)  -> dist/assets/img/<anahtar>.webp, -sm.webp, og/<anahtar>.jpg
src/photos/<anahtar>.(mp4|mov|m4v|webm)   -> dist/assets/video/<anahtar>.mp4 + .webm (sessiz, 1280x720)
src/photos/blog/<yazi-slug>.(jpg|...)     -> dist/assets/img/blog/<slug>.webp (yoksa sahne fotoğrafından kırpılır)

Anahtarlar: hafriyat, temel, altyapi, yol, dolgu, makine, insaat, nakliye
Sonuç dist/assets/img/media.json'a yazılır; şablonlar gerçek medyayı çizimlerin yerine kullanır.
Fotoğrafı olmayan yeni sahneler için en yakın mevcut görsel geçici olarak kopyalanır.

Kullanım: python3 scripts/import_photos.py   (ardından npm run build)
"""
import json
import os
import re
import shutil
import subprocess

from PIL import Image, ImageOps

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "src", "photos")
IMG = os.path.join(ROOT, "dist", "assets", "img")
VID = os.path.join(ROOT, "dist", "assets", "video")
KEYS = ["hafriyat", "temel", "altyapi", "yol", "dolgu", "makine", "insaat", "nakliye"]
ALIAS = {"temel": "hafriyat", "altyapi": "hafriyat", "yol": "nakliye", "dolgu": "makine"}
PHOTO_EXT = (".jpg", ".jpeg", ".png", ".webp")
VIDEO_EXT = (".mp4", ".mov", ".m4v", ".webm")


def find(base, exts):
    for e in exts:
        for cand in (base + e, base + e.upper()):
            if os.path.isfile(cand):
                return cand
    return None


def crop(im, ratio, shift=0.5):
    """Oranı koruyarak kırp; shift 0..1 kırpma penceresinin konumu."""
    w, h = im.size
    if w / h > ratio:
        nw = int(h * ratio)
        x = int((w - nw) * shift)
        return im.crop((x, 0, x + nw, h))
    nh = int(w / ratio)
    y = int((h - nh) * shift)
    return im.crop((0, y, w, y + nh))


def save_set(im, out_base, og_path=None):
    im = ImageOps.exif_transpose(im).convert("RGB")
    wide = crop(im, 16 / 9).resize((1280, 720), Image.LANCZOS)
    wide.save(out_base + ".webp", quality=82, method=6)
    wide.resize((640, 360), Image.LANCZOS).save(out_base + "-sm.webp", quality=80, method=6)
    if og_path:
        crop(im, 1200 / 630).resize((1200, 630), Image.LANCZOS).save(og_path, quality=84, optimize=True, progressive=True)
    return wide


def import_video(src, key):
    os.makedirs(VID, exist_ok=True)
    vf = "scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,fps=25"
    mp4 = os.path.join(VID, f"{key}.mp4")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", src, "-t", "20", "-an", "-vf", vf, "-c:v", "libx264",
                    "-crf", "27", "-preset", "slow", "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4], check=True)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", mp4, "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "40",
                    "-row-mt", "1", "-an", os.path.join(VID, f"{key}.webm")], check=True)
    return mp4


def main():
    os.makedirs(os.path.join(IMG, "og"), exist_ok=True)
    os.makedirs(os.path.join(IMG, "blog"), exist_ok=True)
    media = {}
    for key in KEYS:
        m = {}
        photo = find(os.path.join(SRC, key), PHOTO_EXT)
        vid = find(os.path.join(SRC, key), VIDEO_EXT)
        if photo:
            save_set(Image.open(photo), os.path.join(IMG, key), os.path.join(IMG, "og", f"{key}.jpg"))
            m["photo"] = True
            print(f"fotoğraf: {key} <- {os.path.basename(photo)}")
        if vid:
            mp4 = import_video(vid, key)
            m["video"] = True
            if not photo:  # poster yoksa videonun ilk saniyesinden üret
                frame = mp4 + ".png"
                subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", "1", "-i", mp4, "-frames:v", "1", frame], check=True)
                save_set(Image.open(frame), os.path.join(IMG, key), os.path.join(IMG, "og", f"{key}.jpg"))
                os.remove(frame)
            print(f"video: {key} <- {os.path.basename(vid)}")
        if not m and not os.path.isfile(os.path.join(IMG, f"{key}.webp")) and key in ALIAS:
            a = ALIAS[key]  # geçici: en yakın mevcut görsel
            for suf in (".webp", "-sm.webp"):
                shutil.copyfile(os.path.join(IMG, a + suf), os.path.join(IMG, key + suf))
            shutil.copyfile(os.path.join(IMG, "og", a + ".jpg"), os.path.join(IMG, "og", key + ".jpg"))
            print(f"geçici görsel: {key} <- {a}")
        if m:
            media[key] = m

    # blog kapakları
    posts = os.path.join(ROOT, "src", "content", "posts")
    for fname in sorted(os.listdir(posts)):
        if not fname.endswith(".mjs"):
            continue
        slug = fname[:-4]
        own = find(os.path.join(SRC, "blog", slug), PHOTO_EXT)
        scene = (re.search(r"scene\s*:\s*['\"](\w+)['\"]", open(os.path.join(posts, fname), encoding="utf-8").read()) or [None, None])[1]
        base = os.path.join(IMG, "blog", slug)
        if own:
            save_set(Image.open(own), base)
            print(f"kapak: {slug} <- {os.path.basename(own)}")
        elif scene in media and media[scene].get("photo"):
            src = find(os.path.join(SRC, scene), PHOTO_EXT)
            im = ImageOps.exif_transpose(Image.open(src)).convert("RGB")
            h = sum(map(ord, slug))
            # aynı fotoğraftan farklı kadraj: hafif yakınlaştırıp kaydır
            w0, h0 = im.size
            z = 0.82
            cw, ch = int(w0 * z), int(h0 * z)
            x = int((w0 - cw) * ((h % 7) / 6))
            y = int((h0 - ch) * ((h % 5) / 4))
            save_set(im.crop((x, y, x + cw, y + ch)), base)
            print(f"kapak: {slug} <- {scene} kırpımı")

    with open(os.path.join(IMG, "media.json"), "w", encoding="utf-8") as f:
        json.dump(media, f, ensure_ascii=False, indent=2)
    print(f"media.json: {len(media)} gerçek medya")


if __name__ == "__main__":
    main()
