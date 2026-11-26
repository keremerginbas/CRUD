#!/usr/bin/env python3
"""Asistanların modellerini ve seslerini gerçek isteklerle sınar.
Her model için OpenAI'a kısa bir deneme sorusu gönderir, ilk kelimenin kaç saniyede geldiğini ölçer ve
en hızlı çalışan ayarı (düşünme düzeyi, sıcaklık) asistan dosyasına yazar. Çalışmayan modeli bildirir.
Kullanım: asistan_kontrol.py <.env> <asistanlar-klasörü> [--duzelt]   (--duzelt: çalışmayan modeli gpt-4.1-mini yapar)"""
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import yaml

from vapi_asistan_cevir import _Dumper

YEDEK_MODEL = "gpt-4.1-mini"


def env_oku(yol: str) -> dict:
    out = {}
    for s in Path(yol).read_text(encoding="utf-8").splitlines():
        if "=" in s and not s.lstrip().startswith("#"):
            k, v = s.split("=", 1)
            out[k.strip()] = v.strip()
    return out


def dene(anahtar: str, model: str, dusunme: str | None, sicaklik: bool) -> tuple[float | None, str]:
    """İlk kelimenin gelme süresini (sn) döner; olmazsa (None, hata)."""
    govde = {"model": model, "stream": True, "max_completion_tokens": 400,
             "messages": [{"role": "system", "content": "Telefonda konuşan kibar bir satış asistanısın. Tek kısa cümleyle cevap ver."},
                          {"role": "user", "content": "Merhaba, fiyat ne kadar?"}]}
    if dusunme:
        govde["reasoning_effort"] = dusunme
    if sicaklik:
        govde["temperature"] = 0.4
    istek = urllib.request.Request("https://api.openai.com/v1/chat/completions", data=json.dumps(govde).encode(),
                                   headers={"Authorization": f"Bearer {anahtar}", "Content-Type": "application/json"})
    t0 = time.time()
    try:
        with urllib.request.urlopen(istek, timeout=40) as y:
            for satir in y:
                satir = satir.decode("utf-8", "ignore").strip()
                if not satir.startswith("data:") or satir.endswith("[DONE]"):
                    continue
                try:
                    secim = (json.loads(satir[5:]).get("choices") or [{}])[0]
                except ValueError:
                    continue
                if (secim.get("delta") or {}).get("content"):
                    return round(time.time() - t0, 2), ""
        return None, "cevap metni gelmedi"
    except urllib.error.HTTPError as e:
        try:
            mesaj = (json.loads(e.read().decode("utf-8", "ignore")).get("error") or {}).get("message", "")
        except ValueError:
            mesaj = ""
        return None, f"{e.code} {mesaj}"[:160]
    except Exception as e:  # zaman aşımı, bağlantı
        return None, str(e)[:160]


def model_sina(anahtar: str, model: str) -> dict:
    """Seçenekleri dener; çalışanların en hızlısını döner: {"sure", "dusunme", "sicaklik"} ya da {"hata"}."""
    sonuc, hatalar = [], []
    for sicaklik in (True, False):
        for dusunme in (None, "none", "minimal", "low"):
            sure, hata = dene(anahtar, model, dusunme, sicaklik)
            if sure is None:
                hatalar.append(hata)
                if hata.startswith(("401", "403", "404", "429")):   # anahtar/erişim/model yok: başka seçenek denemek anlamsız
                    return {"hata": hata}
                continue
            ikinci, _ = dene(anahtar, model, dusunme, sicaklik)    # ilk istek soğuk olabilir; iyisini al
            sonuc.append({"sure": min(sure, ikinci or sure), "dusunme": dusunme, "sicaklik": sicaklik})
        if any(s["dusunme"] is None for s in sonuc) and sicaklik:   # sıcaklık kabul ediliyorsa sıcaklıksız turu atla
            break
    if not sonuc:
        return {"hata": hatalar[0] if hatalar else "çalışmadı"}
    return min(sonuc, key=lambda s: (s["sure"], not s["sicaklik"]))


def ses_var(anahtar: str, ses_id: str) -> str:
    try:
        istek = urllib.request.Request(f"https://api.elevenlabs.io/v1/voices/{ses_id}", headers={"xi-api-key": anahtar})
        with urllib.request.urlopen(istek, timeout=20) as y:
            return str(json.load(y).get("name") or "var")
    except urllib.error.HTTPError as e:
        return f"YOK ({e.code})"
    except Exception as e:
        return f"sınanamadı ({str(e)[:60]})"


def main() -> int:
    env, klasor, duzelt = env_oku(sys.argv[1]), Path(sys.argv[2]), "--duzelt" in sys.argv
    oa, el = env.get("OPENAI_API_KEY", ""), env.get("ELEVEN_API_KEY", "")
    dosyalar = {f: (yaml.safe_load(f.read_text(encoding="utf-8")) or {}) for f in sorted(klasor.glob("*.y*ml"))}
    modeller = sorted({str(a.get("model") or "gpt-4.1") for a in dosyalar.values()} | {YEDEK_MODEL})
    print(f"{len(dosyalar)} asistan, {len(modeller)} farklı model sınanıyor (bir iki dakika sürebilir)...\n")
    olcum = {}
    print("%-22s %-14s %s" % ("Model", "İlk kelime", "Ayar / durum"))
    for m in modeller:
        r = olcum[m] = model_sina(oa, m)
        if "hata" in r:
            print("%-22s %-14s ✗ %s" % (m, "-", r["hata"]))
        else:
            ayar = ("düşünme: " + r["dusunme"] if r["dusunme"] else "düşünme ayarı yok") + (" · sıcaklık kabul" if r["sicaklik"] else " · sıcaklık kabul etmiyor")
            print("%-22s %-14s ✓ %s%s" % (m, f"{r['sure']} sn", ayar, "   (karşılaştırma için)" if m == YEDEK_MODEL and not any(str(a.get("model")) == m for a in dosyalar.values()) else ""))
    print()
    degisen = sorunlu = 0
    for f, a in dosyalar.items():
        m, eski = str(a.get("model") or "gpt-4.1"), json.dumps(a, sort_keys=True, ensure_ascii=False)
        r = olcum[m]
        if "hata" in r:
            sorunlu += 1
            if duzelt and "hata" not in olcum[YEDEK_MODEL]:
                print(f"  ! {a.get('ad', f.stem)}: {m} çalışmıyor → {YEDEK_MODEL} yapıldı")
                a["model"], m, r = YEDEK_MODEL, YEDEK_MODEL, olcum[YEDEK_MODEL]
            else:
                print(f"  ✗ {a.get('ad', f.stem)}: {m} çalışmıyor ({r['hata']})")
                continue
        a["model_ayari"] = {"model": m, "dusunme": r["dusunme"] or "", "sicaklik": bool(r["sicaklik"])}
        if json.dumps(a, sort_keys=True, ensure_ascii=False) != eski:
            f.write_text(yaml.dump(a, Dumper=_Dumper, allow_unicode=True, sort_keys=False, width=1000), encoding="utf-8")
            degisen += 1
    print(f"\n{degisen} asistanın model ayarı kaydedildi." + (f" {sorunlu} asistanın modeli çalışmıyor; düzeltmek için komutun sonuna --duzelt ekleyin." if sorunlu and not duzelt else ""))
    if el:
        sesler = sorted({str(a.get("ses_id")) for a in dosyalar.values() if a.get("ses_id")} | ({env["ELEVEN_VOICE_ID"]} if env.get("ELEVEN_VOICE_ID") else set()))
        print("\nSesler (ElevenLabs):")
        for s in sesler:
            print(f"  {s}: {ses_var(el, s)}" + ("   ← varsayılan" if s == env.get("ELEVEN_VOICE_ID") else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
