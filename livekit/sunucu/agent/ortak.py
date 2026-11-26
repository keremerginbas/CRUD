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
