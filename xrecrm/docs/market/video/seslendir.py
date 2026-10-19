#!/usr/bin/env python3
"""WhatsApp by XRE tanıtım videosunu seslendirir ve yayınlar.

VPS'te çalıştırın:
    cd /opt/xre && git pull && python3 xrecrm/docs/market/video/seslendir.py

Ne yapar:
  1. narration.json'daki her kare için OpenAI ile ses üretir (gpt-4o-mini-tts).
  2. Kareyi konuşma süresine göre uzatır, geçişlerle videoyu ve sesi birleştirir.
  3. Videoyu uygulamaya kopyalar: https://<alan-adı>/b24/video/tr.mp4 ve en.mp4

OpenAI anahtarı sırasıyla OPENAI_API_KEY / XRE_OPENAI_API_KEY ortam
değişkeninden, çalışan CRM konteynerinden ya da sorularak alınır; hiçbir yere
yazılmaz. ffmpeg kurulu değilse Docker imajı kullanılır.

Seçenekler: --lang tr (yalnız Türkçe), --no-publish, TTS_MOCK=1 (ses yerine bip; deneme için)
"""
import argparse
import getpass
import json
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
MARKET = os.path.dirname(HERE)
FFMPEG_IMAGE = "jrottenberg/ffmpeg:6.1-ubuntu"
FADE = 0.6


def sh(cmd, **kw):
    return subprocess.run(cmd, check=True, text=True, capture_output=True, **kw).stdout.strip()


def find_container():
    if not shutil.which("docker"):
        return ""
    try:
        names = sh(["docker", "ps", "--format", "{{.Names}}"]).splitlines()
    except Exception:
        return ""
    for n in names:
        if n.endswith("-crm") or n.endswith("-crm-1") or n == "xrecrm-crm":
            return n
    return ""


def api_key(container):
    for k in ("OPENAI_API_KEY", "XRE_OPENAI_API_KEY"):
        if os.environ.get(k, "").strip():
            return os.environ[k].strip()
    if container:
        try:
            v = sh(["docker", "exec", container, "printenv", "XRE_OPENAI_API_KEY"])
            if v:
                return v
        except Exception:
            pass
    for _ in range(3):
        k = getpass.getpass("OpenAI API anahtarı (sk- ile başlar, ekranda görünmez): ").strip()
        if k.startswith("sk-") and " " not in k:
            return k
        print("  Bu bir OpenAI anahtarına benzemiyor (sk- ile başlamalı). Yalnız anahtarı yapıştırın.")
    sys.exit("Geçerli anahtar girilmedi.")


class FF:
    """Yerel ffmpeg ya da Docker imajı; tüm dosyalar çalışma klasöründe."""

    def __init__(self, work):
        self.work = work
        self.local = bool(shutil.which("ffmpeg") and shutil.which("ffprobe"))
        if not self.local and not shutil.which("docker"):
            sys.exit("ffmpeg ya da Docker gerekli.")

    def _run(self, tool, args):
        if self.local:
            return sh([tool, *args], cwd=self.work)
        return sh(["docker", "run", "--rm", "-v", f"{self.work}:/w", "-w", "/w", "--entrypoint", tool, FFMPEG_IMAGE, *args])

    def ffmpeg(self, args):
        return self._run("ffmpeg", ["-y", "-loglevel", "error", *args])

    def duration(self, name):
        return float(self._run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", name]))


def tts(key, text, voice, instructions, out_path):
    def call(model, with_instructions):
        body = {"model": model, "voice": voice, "input": text, "response_format": "mp3"}
        if with_instructions:
            body["instructions"] = instructions
        req = urllib.request.Request(
            "https://api.openai.com/v1/audio/speech",
            data=json.dumps(body).encode(),
            headers={"authorization": f"Bearer {key}", "content-type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=120) as r, open(out_path, "wb") as f:
            f.write(r.read())

    try:
        call(os.environ.get("TTS_MODEL", "gpt-4o-mini-tts"), True)
    except urllib.error.HTTPError as e:
        if e.code in (400, 404):
            call("tts-1-hd", False)
        else:
            raise SystemExit(f"OpenAI ses hatası: HTTP {e.code} {e.read()[:300]!r}")


def build(lang, cfg, key, ff, work, out):
    slides = cfg["slides"]
    durs, audio = [], []
    for i, s in enumerate(slides):
        src = os.path.join(MARKET, s["image"])
        ext = os.path.splitext(src)[1]
        shutil.copy(src, os.path.join(work, f"img{i}{ext}"))
        s["_img"] = f"img{i}{ext}"
        a = f"a{i}.mp3"
        if os.environ.get("TTS_MOCK"):
            ff.ffmpeg(["-f", "lavfi", "-i", f"sine=frequency=440:duration={max(1.5, len(s['text']) / 15):.2f}", a])
        else:
            print(f"  [{lang}] {i + 1}/{len(slides)} seslendiriliyor…", flush=True)
            tts(key, s["text"], cfg.get("voice", "nova"), cfg.get("instructions", ""), os.path.join(work, a))
        ad = ff.duration(a)
        audio.append((a, ad))
        durs.append(max(float(s.get("min", 5)), ad + 1.3))

    args, vf, af = [], [], []
    for i, s in enumerate(slides):
        args += ["-loop", "1", "-t", f"{durs[i]:.3f}", "-i", s["_img"]]
    for a, _ in audio:
        args += ["-i", a]
    n = len(slides)
    prev, offset, starts = "v0", 0.0, []
    for i in range(n):
        vf.append(f"[{i}:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p,setsar=1[v{i}]")
        if i == 0:
            starts.append(0.0)
            offset = durs[0] - FADE
        else:
            vf.append(f"[{prev}][v{i}]xfade=transition=fade:duration={FADE}:offset={offset:.3f}[x{i}]")
            starts.append(offset)
            prev = f"x{i}"
            offset += durs[i] - FADE
    total = offset + FADE
    for i in range(n):
        delay = int((starts[i] + (0.4 if i == 0 else FADE + 0.15)) * 1000)
        af.append(f"[{n + i}:a]aresample=48000,adelay={delay}|{delay}[a{i}]")
    af.append("".join(f"[a{i}]" for i in range(n)) + f"amix=inputs={n}:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11,apad[aout]")
    graph = ";".join(vf + af)
    ff.ffmpeg([*args, "-filter_complex", graph, "-map", f"[{prev}]", "-map", "[aout]", "-t", f"{total:.3f}",
               "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
               "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-movflags", "+faststart", out])
    return total


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--lang", default="tr,en")
    p.add_argument("--no-publish", action="store_true")
    a = p.parse_args()
    cfg = json.load(open(os.path.join(HERE, "narration.json"), encoding="utf-8"))
    container = find_container()
    key = "" if os.environ.get("TTS_MOCK") else api_key(container)
    if not os.environ.get("TTS_MOCK") and not key:
        sys.exit("OpenAI anahtarı gerekli.")
    out_dir = os.path.join(HERE, "out")
    os.makedirs(out_dir, exist_ok=True)
    for lang in [x.strip() for x in a.lang.split(",") if x.strip()]:
        with tempfile.TemporaryDirectory(prefix=f"xre-video-{lang}-") as work:
            os.chmod(work, 0o777)
            ff = FF(work)
            name = f"WhatsApp-by-XRE-{lang}.mp4"
            total = build(lang, cfg[lang], key, ff, work, name)
            dest = os.path.join(out_dir, name)
            shutil.copy(os.path.join(work, name), dest)
        print(f"✔ {lang}: {dest} ({total:.0f} sn)")
        if container and not a.no_publish:
            sh(["docker", "exec", "-u", "0", container, "mkdir", "-p", "/app/data/b24-video"])
            sh(["docker", "cp", dest, f"{container}:/app/data/b24-video/{lang}.mp4"])
            sh(["docker", "exec", "-u", "0", container, "chmod", "a+r", f"/app/data/b24-video/{lang}.mp4"])
            print(f"  yayında: https://<alan-adınız>/b24/video/{lang}.mp4")


if __name__ == "__main__":
    main()
