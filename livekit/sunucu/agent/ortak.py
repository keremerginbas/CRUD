"""Ortak yardımcılar: ayarlar, asistan/numara tanımları, çağrı kaydı (Redis), şablon değişkenleri."""
from __future__ import annotations

import json
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import redis.asyncio as aioredis
import yaml

AYAR_KLASORU = Path(os.environ.get("AYAR_KLASORU", "/ayar"))
AJAN_ADI = "xre-arama"
GIDEN_TRUNK_ADI = "asterisk-giden"
GELEN_TRUNK_ADI = "asterisk-gelen"
REDIS_URL = os.environ.get("REDIS_URL", "redis://127.0.0.1:6379/0")
TR = ZoneInfo("Europe/Istanbul")


# ---------- kullanım ve maliyet ----------
# Birim fiyatlar: 2026 Kasım'ında herkese açık fiyat listelerinden alınan BAŞLANGIÇ değerleri. Panelde (Maliyet → Birim
# fiyatlar) değiştirilebilir; gerçek tutar her zaman servisin kendi faturasıdır.
VARSAYILAN_FIYATLAR = {
    "llm": {  # ABD doları / 1 milyon token
        "gpt-5.6-terra": {"girdi": 2.0, "onbellek": 0.20, "cikti": 12.0},
        "gpt-5.6-luna": {"girdi": 0.20, "onbellek": 0.02, "cikti": 1.20},
        "gpt-5-mini": {"girdi": 0.25, "onbellek": 0.025, "cikti": 2.0},
        "gpt-4.1-mini": {"girdi": 0.40, "onbellek": 0.10, "cikti": 1.60},
        "gpt-4.1": {"girdi": 2.0, "onbellek": 0.50, "cikti": 8.0},
    },
    "stt": {"nova-3": 0.0077},              # ABD doları / dakika (Deepgram, canlı)
    "tts": {"eleven_flash_v2_5": 0.04},     # ABD doları / 1000 karakter (ElevenLabs)
    "tel": {"giden_tl_dk": 0.0, "gelen_tl_dk": 0.0},   # NetGSM dakika ücreti (TL); paketiniz dakikayı içeriyorsa 0
    "sabit": [],                            # aylık sabit giderler: [{"ad": "...", "tutar": 0, "birim": "TL" | "USD"}]
    "kur": 0.0,                             # 1 USD kaç TL; 0 = Merkez Bankası'ndan otomatik
}
SAGLAYICI = {"llm": "OpenAI", "stt": "Deepgram", "tts": "ElevenLabs", "tel": "NetGSM"}


async def fiyatlari_oku(r: aioredis.Redis) -> dict:
    """Kayıtlı birim fiyatlar; kayıt yoksa ya da eksikse varsayılanlarla tamamlanır."""
    try:
        kayitli = json.loads(await r.get("fiyatlar") or "{}")
    except ValueError:
        kayitli = {}
    out = json.loads(json.dumps(VARSAYILAN_FIYATLAR))
    for k, v in (kayitli if isinstance(kayitli, dict) else {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k].update(v)
        else:
            out[k] = v
    return out


def maliyet_hesapla(kullanim: dict, fiyat: dict) -> dict:
    """kullanim: {"llm|model|girdi": token, "stt|model|sn": saniye, "tts|model|karakter": adet, "tel|giden|sn": saniye, …}
    Döner: {"usd": toplam dolar, "tl": NetGSM dakika ücreti (TL), "kalemler": [...], "fiyatsiz": [fiyatı tanımsız modeller]}"""
    kalemler, fiyatsiz, usd, tl = {}, set(), 0.0, 0.0
    for anahtar, miktar in (kullanim or {}).items():
        try:
            tur, model, olcu = anahtar.split("|", 2)
            miktar = float(miktar)
        except (ValueError, TypeError):
            continue
        if tur == "llm":
            f = (fiyat.get("llm") or {}).get(model)
            k = kalemler.setdefault(("llm", model), {"tur": "llm", "saglayici": "OpenAI", "model": model, "girdi": 0, "onbellek": 0, "cikti": 0, "usd": 0.0, "tl": 0.0})
            k[olcu] = k.get(olcu, 0) + miktar
            if f is None:
                fiyatsiz.add(model)
            else:
                k["usd"] += miktar * float(f.get(olcu) or 0) / 1e6
        elif tur == "stt":
            f = (fiyat.get("stt") or {}).get(model)
            k = kalemler.setdefault(("stt", model), {"tur": "stt", "saglayici": "Deepgram", "model": model, "dakika": 0.0, "usd": 0.0, "tl": 0.0})
            k["dakika"] += miktar / 60
            if f is None:
                fiyatsiz.add(model)
            else:
                k["usd"] += miktar / 60 * float(f)
        elif tur == "tts":
            f = (fiyat.get("tts") or {}).get(model)
            k = kalemler.setdefault(("tts", model), {"tur": "tts", "saglayici": "ElevenLabs", "model": model, "karakter": 0, "usd": 0.0, "tl": 0.0})
            k["karakter"] += miktar
            if f is None:
                fiyatsiz.add(model)
            else:
                k["usd"] += miktar / 1000 * float(f)
        elif tur == "tel":
            k = kalemler.setdefault(("tel", model), {"tur": "tel", "saglayici": "NetGSM", "model": model, "dakika": 0.0, "usd": 0.0, "tl": 0.0})
            k["dakika"] += miktar / 60
            k["tl"] += miktar / 60 * float((fiyat.get("tel") or {}).get(f"{model}_tl_dk") or 0)
    for k in kalemler.values():
        usd += k["usd"]
        tl += k["tl"]
    return {"usd": round(usd, 6), "tl": round(tl, 4), "kalemler": sorted(kalemler.values(), key=lambda x: (["llm", "stt", "tts", "tel"].index(x["tur"]), x["model"])), "fiyatsiz": sorted(fiyatsiz)}


async def kullanim_ekle(r: aioredis.Redis, asistan_id: str, kullanim: dict) -> None:
    """Günlük toplamlara ekler (Türkiye günü). Arama kayıtları 14 günde silinir; bu toplamlar 400 gün kalır,
    böylece aylık maliyet geçmişe dönük görülebilir."""
    gun = datetime.now(TR).strftime("%Y-%m-%d")
    for anahtar in (f"kullanim:{gun}", f"kullanim:{gun}:a:{asistan_id or '-'}"):
        for alan, miktar in kullanim.items():
            if miktar:
                await r.hincrbyfloat(anahtar, alan, float(miktar))
        await r.expire(anahtar, 400 * 86400)


def kayit_imzasi(cid: str) -> str:
    import hashlib
    import hmac
    return hmac.new(os.environ.get("PANEL_GIZLI", "").encode(), f"kayit:{cid}".encode(), hashlib.sha256).hexdigest()[:40]


def kayit_adresi(cid: str) -> str:
    """Ses kaydının dışarıdan (n8n, Bitrix notu) açılabilen imzalı adresi. DIS_ADRES tanımlı değilse boş döner."""
    taban = os.environ.get("DIS_ADRES", "").rstrip("/")
    if not taban or not os.environ.get("PANEL_GIZLI"):
        return ""
    return f"{taban}/kayit/{cid}.wav?imza={kayit_imzasi(cid)}"


GUNLER = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"]
AYLAR = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"]


def tarih_notu(simdi: datetime | None = None) -> str:
    """Asistanın bugünün tarihini, gününü ve saatini bilmesi için metne eklenen bölüm (Türkiye saati).
    Önümüzdeki günler tek tek yazılır; model gün hesabı yapmak zorunda kalmaz, yanlış güne randevu vermez."""
    from datetime import timedelta

    s = simdi or datetime.now(TR)
    yaz = lambda g: f"{g.day} {AYLAR[g.month - 1]} {g.year} {GUNLER[g.weekday()]}"  # noqa: E731
    ad = {0: "Bugün", 1: "Yarın", 2: "Öbür gün"}
    satirlar = [f"{ad.get(i, str(i) + ' gün sonra')}: {yaz(s + timedelta(days=i))} ({(s + timedelta(days=i)).strftime('%Y-%m-%d')})" for i in range(8)]
    return ("\n\nTARİH VE SAAT\n"
            f"Şu an Türkiye saatiyle {yaz(s)}, saat {s.strftime('%H:%M')}.\n"
            + "\n".join(satirlar) + "\n"
            "\"Bugün\", \"yarın\", \"haftaya salı\", \"cumartesi\" gibi ifadeleri bu takvime göre anla. Tarih ya da gün söylerken bu takvimi kullan, "
            "geçmiş bir tarihe randevu verme. Araç çağırırken, aracın açıklaması başka bir biçim istemiyorsa tarihleri YYYY-MM-DD, saatleri SS:DD biçiminde gönder; saat dilimi +03:00.\n")


def simdi_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


# ---------- asistanlar ve numaralar (her çağrıda dosyadan okunur; düzenleyince yeniden başlatmak gerekmez) ----------
def asistanlari_oku() -> list[dict]:
    out = []
    for f in sorted((AYAR_KLASORU / "asistanlar").glob("*.y*ml")):
        d = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
        d.setdefault("id", f.stem)
        d.setdefault("ad", d["id"])
        out.append(d)
    return out


def asistan_bul(anahtar: str | None) -> dict | None:
    if not anahtar:
        return None
    k = str(anahtar).strip().lower()
    for a in asistanlari_oku():
        if k in {str(a.get("id", "")).lower(), str(a.get("vapi_id", "")).lower(), str(a.get("ad", "")).lower()}:
            return a
    return None


def numaralari_oku() -> list[dict]:
    f = AYAR_KLASORU / "numaralar.yaml"
    if not f.exists():
        return []
    return (yaml.safe_load(f.read_text(encoding="utf-8")) or {}).get("numaralar", []) or []


def e164(numara: str | None) -> str:
    """Her yazımı +905XXXXXXXXX biçimine çevirir; çeviremezse rakamları döner."""
    s = re.sub(r"[^\d+]", "", str(numara or ""))
    yabanci = s.startswith("+") or s.startswith("00")
    s = re.sub(r"^(\+|00)", "", s)
    if len(s) == 10 and s[0] in "23458":
        s = "90" + s
    elif len(s) == 11 and s.startswith("0"):
        s = "9" + s
    if re.fullmatch(r"90[2-58]\d{9}", s):
        return "+" + s
    return ("+" + s) if (yabanci and s) else s


def santral_numarasi(numara: str) -> str:
    """NetGSM'in beklediği yazım: 05XXXXXXXXX (yurt dışı: 00...)."""
    n = e164(numara)
    if n.startswith("+90") and len(n) == 13:
        return "0" + n[3:]
    return "00" + n[1:] if n.startswith("+") else n


def numara_bul(anahtar: str | None) -> dict | None:
    liste = numaralari_oku()
    if not anahtar:
        return liste[0] if liste else None
    k = str(anahtar).strip().lower()
    for n in liste:
        if k in {str(n.get("id", "")).lower(), str(n.get("vapi_id", "")).lower()} or e164(k) == e164(n.get("numara")):
            return n
    return None


# ---------- Vapi'deki {{degisken}} şablonları ----------
_SABLON = re.compile(r"\{\{\s*(.*?)\s*\}\}", re.S)
_STRFTIME_GUN = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"]


def sablon_doldur(metin: str | None, degiskenler: dict) -> str:
    """{{ad}}, {{ad | default: "x"}} ve {{"now" | date: "%d.%m.%Y", "Europe/Istanbul"}} desteklenir."""

    def degistir(m: re.Match) -> str:
        ifade = m.group(1)
        parcalar = [p.strip() for p in ifade.split("|")]
        bas = parcalar[0]
        if bas.strip("\"'") == "now" and len(parcalar) > 1 and parcalar[1].startswith("date"):
            arg = re.findall(r"\"([^\"]*)\"|'([^']*)'", parcalar[1])
            bicim = (arg[0][0] or arg[0][1]) if arg else "%d.%m.%Y %H:%M"
            dilim = (arg[1][0] or arg[1][1]) if len(arg) > 1 else "Europe/Istanbul"
            try:
                t = datetime.now(ZoneInfo(dilim))
            except Exception:
                t = datetime.now(TR)
            return t.strftime(bicim.replace("%A", _STRFTIME_GUN[t.weekday()]))
        deger = degiskenler.get(bas)
        if deger is None or str(deger).strip() == "":
            for p in parcalar[1:]:
                if p.startswith("default"):
                    v = re.findall(r"\"((?:[^\"\\]|\\.)*)\"|'((?:[^'\\]|\\.)*)'", p)
                    return (v[0][0] or v[0][1]) if v else ""
            return ""
        return str(deger)

    return _SABLON.sub(degistir, metin or "")


# ---------- çağrı kayıtları (GET /call bunları döner) ----------
def redis_baglan() -> aioredis.Redis:
    return aioredis.from_url(REDIS_URL, decode_responses=True)


async def cagri_yaz(r: aioredis.Redis, cagri: dict) -> None:
    await r.set(f"cagri:{cagri['id']}", json.dumps(cagri, ensure_ascii=False), ex=14 * 86400)
    await r.zadd("cagrilar", {cagri["id"]: time.time() if "_t" not in cagri else cagri["_t"]})


async def cagri_oku(r: aioredis.Redis, cid: str) -> dict | None:
    v = await r.get(f"cagri:{cid}")
    return json.loads(v) if v else None


async def cagri_guncelle(r: aioredis.Redis, cid: str, **alanlar) -> dict | None:
    c = await cagri_oku(r, cid)
    if not c:
        return None
    c.update(alanlar)
    c["updatedAt"] = simdi_iso()
    await r.set(f"cagri:{cid}", json.dumps(c, ensure_ascii=False), ex=14 * 86400)
    return c


def sip_bitis_nedeni(kod: str | int | None, mesaj: str = "") -> str:
    """SIP hata kodunu Vapi'nin endedReason değerlerine çevirir (n8n akışları bunlara göre karar veriyor)."""
    try:
        k = int(kod or 0)
    except ValueError:
        k = 0
    if k in (486, 600, 603):
        return "customer-busy"
    if k in (408, 480, 487):
        return "customer-did-not-answer"
    if k == 404 or k == 484:
        return "call.in-progress.error-sip-outbound-call-failed-to-connect-invalid-number"
    m = mesaj.lower()
    if "timeout" in m or "timed out" in m or "no answer" in m or "cancel" in m:
        return "customer-did-not-answer"
    return f"call.in-progress.error-sip-outbound-call-failed-to-connect{'-sip-' + str(k) if k else ''}"
