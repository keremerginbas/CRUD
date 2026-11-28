"""Yönetim paneli: asistanları, numaraları, kullanıcıları ve arama kayıtlarını tarayıcıdan yönetmek için.
Sayfa /panel adresinde açılır; /panel/api/... uçları oturum çerezi ister."""
from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import time
import uuid
from pathlib import Path
from xml.sax.saxutils import escape as _xml_kacis

import httpx
import yaml
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import FileResponse, HTMLResponse

import ortak

router = APIRouter()
GIZLI = os.environ.get("PANEL_GIZLI", "").encode() or secrets.token_bytes(32)
OTURUM_SN = 12 * 3600
CEREZ = "xre_oturum"
KULLANICI_DOSYASI = ortak.AYAR_KLASORU / "veri" / "kullanicilar.yaml"
KAYIT_KLASORU = Path(os.environ.get("KAYIT_KLASORU", "/kayit"))
SAYFA = Path(__file__).with_name("panel.html")
ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,60}$")


# ---------- YAML: çok satırlı metinler (prompt) okunaklı yazılsın ----------
class _Dumper(yaml.SafeDumper):
    pass


def _metin(dumper, veri):
    if "\n" in veri:
        return dumper.represent_scalar("tag:yaml.org,2002:str", veri, style="|")
    return dumper.represent_scalar("tag:yaml.org,2002:str", veri)


_Dumper.add_representer(str, _metin)


def yaml_yaz(dosya: Path, veri) -> None:
    dosya.parent.mkdir(parents=True, exist_ok=True)
    metin = yaml.dump(veri, Dumper=_Dumper, allow_unicode=True, sort_keys=False, width=1000)
    with open(dosya, "w", encoding="utf-8") as f:  # yerinde yaz (bağlı dosyalar yeniden adlandırılamaz)
        f.write(metin)


# ---------- kullanıcılar ve oturum ----------
def _sifre_ozeti(sifre: str, tuz: str | None = None) -> str:
    tuz = tuz or secrets.token_hex(16)
    ozet = hashlib.pbkdf2_hmac("sha256", sifre.encode(), bytes.fromhex(tuz), 200_000).hex()
    return f"pbkdf2${tuz}${ozet}"


def _sifre_dogru(sifre: str, kayit: str) -> bool:
    try:
        _, tuz, _ozet = kayit.split("$")
    except ValueError:
        return False
    return hmac.compare_digest(_sifre_ozeti(sifre, tuz), kayit)


def kullanicilari_oku() -> list[dict]:
    if not KULLANICI_DOSYASI.exists():
        return []
    return (yaml.safe_load(KULLANICI_DOSYASI.read_text(encoding="utf-8")) or {}).get("kullanicilar", []) or []


def kullanicilari_yaz(liste: list[dict]) -> None:
    yaml_yaz(KULLANICI_DOSYASI, {"kullanicilar": liste})
    os.chmod(KULLANICI_DOSYASI, 0o600)


def ilk_yonetici() -> str | None:
    """Hiç kullanıcı yoksa 'yonetici' hesabını rastgele şifreyle açar; şifreyi bir kez döner."""
    if kullanicilari_oku():
        return None
    sifre = secrets.token_urlsafe(9)
    kullanicilari_yaz([{"ad": "yonetici", "rol": "yonetici", "sifre": _sifre_ozeti(sifre)}])
    return sifre


def sifre_sifirla(ad: str = "yonetici") -> str:
    """Bir kullanıcıya yeni rastgele şifre verir (yoksa yönetici olarak açar). Sunucuda komut satırından kullanılır:
       docker compose exec api python -c "import panel; print(panel.sifre_sifirla('yonetici'))" """
    sifre = secrets.token_urlsafe(9)
    liste = kullanicilari_oku()
    k = next((u for u in liste if u["ad"] == ad), None)
    if k:
        k["sifre"] = _sifre_ozeti(sifre)
    else:
        liste.append({"ad": ad, "rol": "yonetici", "sifre": _sifre_ozeti(sifre)})
    kullanicilari_yaz(liste)
    return sifre


def _imzala(veri: dict) -> str:
    govde = base64.urlsafe_b64encode(json.dumps(veri, separators=(",", ":")).encode()).decode().rstrip("=")
    imza = hmac.new(GIZLI, govde.encode(), hashlib.sha256).hexdigest()
    return f"{govde}.{imza}"


def _coz(cerez: str | None) -> dict | None:
    try:
        govde, imza = (cerez or "").split(".")
        if not hmac.compare_digest(hmac.new(GIZLI, govde.encode(), hashlib.sha256).hexdigest(), imza):
            return None
        veri = json.loads(base64.urlsafe_b64decode(govde + "=" * (-len(govde) % 4)))
        return veri if veri.get("bitis", 0) > time.time() else None
    except Exception:
        return None


def oturum(request: Request) -> dict:
    v = _coz(request.cookies.get(CEREZ))
    if not v:
        raise HTTPException(401, "Giriş yapmanız gerekiyor")
    k = next((u for u in kullanicilari_oku() if u["ad"] == v["ad"]), None)
    if not k:
        raise HTTPException(401, "Kullanıcı bulunamadı")
    # Çerezle gelen değişiklik istekleri yalnızca panelin kendi sayfasından kabul edilir
    if request.method not in ("GET", "HEAD") and request.headers.get("x-panel") != "1":
        raise HTTPException(403, "Geçersiz istek")
    return {"ad": k["ad"], "rol": k.get("rol", "kullanici")}


def yonetici(k: dict = Depends(oturum)) -> dict:
    if k["rol"] != "yonetici":
        raise HTTPException(403, "Bu işlem için yönetici yetkisi gerekir")
    return k


def _istemci_ip(request: Request) -> str:
    return (request.headers.get("cf-connecting-ip") or request.headers.get("x-forwarded-for", "").split(",")[0].strip()
            or (request.client.host if request.client else "?"))


@router.get("/panel", response_class=HTMLResponse)
async def sayfa():
    return HTMLResponse(SAYFA.read_text(encoding="utf-8"), headers={"Cache-Control": "no-store", "X-Frame-Options": "DENY"})


VARLIKLAR = {"logo_beyaz.png", "logo_lacivert.png", "isaret_beyaz.png", "isaret_lacivert.png", "chart.umd.js"}  # chart.umd.js: Chart.js 4.4.1 (MIT)


@router.get("/panel/varlik/{ad}")
async def varlik(ad: str):
    if ad not in VARLIKLAR:
        raise HTTPException(404, "Bulunamadı")
    return FileResponse(Path(__file__).with_name("varlik") / ad, media_type="text/javascript" if ad.endswith(".js") else "image/png", headers={"Cache-Control": "public, max-age=86400"})


# Giriş ekranının arka plan videosu: yönetici panelden yükler, /ayar/veri altında durur.
VIDEO_TURLERI = {"mp4": "video/mp4", "webm": "video/webm"}
VIDEO_SINIRI = 20 * 1024 * 1024
MP4_OLMAYAN = (b"qt  ", b"heic", b"heix", b"hevc", b"heim", b"heis", b"avif", b"avis", b"mif1", b"msf1", b"M4A ", b"M4B ")


def _giris_videosu() -> Path | None:
    for uz in VIDEO_TURLERI:
        yol = ortak.AYAR_KLASORU / "veri" / f"giris_video.{uz}"
        if yol.is_file():
            return yol
    return None


@router.get("/panel/giris-video")
async def giris_video(request: Request):
    yol = _giris_videosu()
    if not yol:
        raise HTTPException(404, "Video yok")
    # Oturumsuz açık bir uç: aynı adresten dakikada en çok 30 istek (bant genişliğini korur)
    r = ortak.redis_baglan()
    try:
        anahtar = f"video:{_istemci_ip(request)}"
        if await r.incr(anahtar) == 1:
            await r.expire(anahtar, 60)
        elif int(await r.get(anahtar) or 0) > 30:
            raise HTTPException(429, "Çok fazla istek")
    finally:
        await r.aclose()
    return FileResponse(yol, media_type=VIDEO_TURLERI[yol.suffix[1:]],
                        headers={"Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff"})


@router.get("/panel/api/giris-video")
async def giris_video_durum(_k: dict = Depends(yonetici)):
    yol = _giris_videosu()
    return {"var": bool(yol), "boyut": yol.stat().st_size if yol else 0}


@router.post("/panel/api/giris-video")
async def giris_video_yukle(request: Request, _k: dict = Depends(yonetici)):
    klasor = ortak.AYAR_KLASORU / "veri"
    klasor.mkdir(parents=True, exist_ok=True)
    for artik in klasor.glob("giris_video.*.yukleniyor"):   # yarıda kalmış eski yüklemeler
        if time.time() - artik.stat().st_mtime > 600:
            artik.unlink(missing_ok=True)
    gecici = klasor / f"giris_video.{secrets.token_hex(4)}.yukleniyor"
    boyut, bas = 0, b""
    try:
        with gecici.open("wb") as f:
            async for parca in request.stream():
                boyut += len(parca)
                if boyut > VIDEO_SINIRI:
                    raise HTTPException(413, "Video 20 MB'tan büyük olamaz. Daha kısa ya da daha düşük çözünürlüklü bir video yükleyin.")
                if len(bas) < 12:
                    bas += parca[: 12 - len(bas)]
                f.write(parca)
        if bas[4:8] == b"ftyp" and bas[8:12] in MP4_OLMAYAN:
            raise HTTPException(400, "Bu dosya MP4 değil (MOV, HEIC ya da ses dosyası). Videoyu MP4 (H.264) olarak dışa aktarıp yeniden yükleyin.")
        if bas[4:8] == b"ftyp":
            uz = "mp4"
        elif bas[:4] == b"\x1a\x45\xdf\xa3":
            uz = "webm"
        else:
            raise HTTPException(400, "Bu dosya MP4 ya da WebM video değil.")
        for eski in VIDEO_TURLERI:
            (klasor / f"giris_video.{eski}").unlink(missing_ok=True)
        gecici.replace(klasor / f"giris_video.{uz}")
    finally:
        gecici.unlink(missing_ok=True)
    return {"var": True, "boyut": boyut}


@router.delete("/panel/api/giris-video")
async def giris_video_sil(_k: dict = Depends(yonetici)):
    for uz in VIDEO_TURLERI:
        (ortak.AYAR_KLASORU / "veri" / f"giris_video.{uz}").unlink(missing_ok=True)
    return {"var": False}


@router.post("/panel/api/giris")
async def giris(request: Request, response: Response):
    govde = await request.json()
    ad, sifre = str(govde.get("kullanici", "")).strip().lower(), str(govde.get("sifre", ""))
    r = ortak.redis_baglan()
    try:
        anahtar = f"giris:{_istemci_ip(request)}:{ad}"
        deneme = await r.incr(anahtar)
        if deneme == 1:
            await r.expire(anahtar, 900)
        if deneme > 8:
            raise HTTPException(429, "Çok fazla hatalı deneme. 15 dakika sonra tekrar deneyin.")
        k = next((u for u in kullanicilari_oku() if u["ad"] == ad), None)
        if not k or not _sifre_dogru(sifre, k.get("sifre", "")):
            raise HTTPException(401, "Kullanıcı adı ya da şifre hatalı")
        await r.delete(anahtar)
    finally:
        await r.aclose()
    guvenli = request.headers.get("x-forwarded-proto", request.url.scheme) == "https"
    response.set_cookie(CEREZ, _imzala({"ad": ad, "bitis": int(time.time()) + OTURUM_SN}), max_age=OTURUM_SN,
                        httponly=True, samesite="lax", secure=guvenli, path="/")
    return {"ad": ad, "rol": k.get("rol", "kullanici")}


@router.post("/panel/api/cikis")
async def cikis(response: Response):
    response.delete_cookie(CEREZ, path="/")
    return {}


@router.get("/panel/api/ben")
async def ben(k: dict = Depends(oturum)):
    return k


# ---------- kullanıcı yönetimi (yalnız yönetici) ----------
@router.get("/panel/api/kullanicilar")
async def kullanici_listesi(_k: dict = Depends(yonetici)):
    return [{"ad": u["ad"], "rol": u.get("rol", "kullanici")} for u in kullanicilari_oku()]


@router.post("/panel/api/kullanicilar")
async def kullanici_kaydet(request: Request, ben_: dict = Depends(yonetici)):
    g = await request.json()
    ad = str(g.get("ad", "")).strip().lower()
    if not re.fullmatch(r"[a-z0-9._-]{3,40}", ad):
        raise HTTPException(400, "Kullanıcı adı 3-40 karakter olmalı; küçük harf, rakam, nokta, tire")
    rol = "yonetici" if g.get("rol") == "yonetici" else "kullanici"
    sifre = str(g.get("sifre", ""))
    liste = kullanicilari_oku()
    mevcut = next((u for u in liste if u["ad"] == ad), None)
    if not mevcut and len(sifre) < 10:
        raise HTTPException(400, "Şifre en az 10 karakter olmalı")
    if sifre and len(sifre) < 10:
        raise HTTPException(400, "Şifre en az 10 karakter olmalı")
    if mevcut:
        if ad == ben_["ad"] and rol != "yonetici":
            raise HTTPException(400, "Kendi yönetici yetkinizi kaldıramazsınız")
        mevcut["rol"] = rol
        if sifre:
            mevcut["sifre"] = _sifre_ozeti(sifre)
    else:
        liste.append({"ad": ad, "rol": rol, "sifre": _sifre_ozeti(sifre)})
    kullanicilari_yaz(liste)
    return {"ad": ad, "rol": rol}


@router.delete("/panel/api/kullanicilar/{ad}")
async def kullanici_sil(ad: str, ben_: dict = Depends(yonetici)):
    if ad == ben_["ad"]:
        raise HTTPException(400, "Kendi hesabınızı silemezsiniz")
    kullanicilari_yaz([u for u in kullanicilari_oku() if u["ad"] != ad])
    return {}


@router.post("/panel/api/sifrem")
async def sifre_degistir(request: Request, ben_: dict = Depends(oturum)):
    g = await request.json()
    liste = kullanicilari_oku()
    k = next(u for u in liste if u["ad"] == ben_["ad"])
    if not _sifre_dogru(str(g.get("eski", "")), k["sifre"]):
        raise HTTPException(400, "Mevcut şifre hatalı")
    if len(str(g.get("yeni", ""))) < 10:
        raise HTTPException(400, "Yeni şifre en az 10 karakter olmalı")
    k["sifre"] = _sifre_ozeti(str(g["yeni"]))
    kullanicilari_yaz(liste)
    return {}


# ---------- asistanlar ----------
def _asistan_dosyasi(aid: str) -> Path:
    if not ID_RE.fullmatch(aid):
        raise HTTPException(400, "Asistan kimliği yalnızca küçük harf, rakam ve tire içerebilir")
    return ortak.AYAR_KLASORU / "asistanlar" / f"{aid}.yaml"


SAYISAL = {"sicaklik": (0, 2), "ses_hizi": (0.7, 1.2), "ses_kararlilik": (0, 1), "ses_benzerlik": (0, 1),
           "soz_bitti_bekleme_sn": (0, 3), "soz_bitti_azami_sn": (0.5, 10), "sessizlik_esigi_sn": (0.1, 2), "ses_esigi": (0.2, 0.95),
           "soz_kesme_en_az_kelime": (0, 10), "soz_kesme_en_az_sn": (0, 3), "yanlis_kesme_bekleme_sn": (0.3, 10),
           "soz_guven_esigi": (0, 1), "sessizlik_sn": (5, 3600), "azami_sure_sn": (10, 7200), "calma_suresi_sn": (10, 90),
           "alo_bekleme_sn": (0.5, 15), "stt_bekleme_ms": (10, 2000)}


def _asistan_temizle(g: dict, aid: str) -> dict:
    a = {k: v for k, v in g.items() if not str(k).startswith("_")}
    a["id"] = aid
    a["ad"] = str(a.get("ad") or aid).strip()
    for alan, (alt, ust) in SAYISAL.items():
        if a.get(alan) in ("", None):
            a.pop(alan, None)
            continue
        try:
            v = float(a[alan])
        except (TypeError, ValueError):
            raise HTTPException(400, f"{alan} sayı olmalı")
        if not alt <= v <= ust:
            raise HTTPException(400, f"{alan} {alt} ile {ust} arasında olmalı")
        a[alan] = int(v) if alan in ("soz_kesme_en_az_kelime", "sessizlik_sn", "azami_sure_sn", "calma_suresi_sn", "stt_bekleme_ms") else v
    url = str(a.get("sunucu_url") or "").strip()
    if url and not re.match(r"^https?://", url):
        raise HTTPException(400, "Sunucu adresi http:// ya da https:// ile başlamalı")
    a["sunucu_url"] = url
    for t in a.get("araclar") or []:
        if not re.fullmatch(r"[a-zA-Z0-9_-]{1,64}", str(t.get("ad", ""))):
            raise HTTPException(400, "Araç adı yalnızca harf, rakam, alt çizgi ve tire içerebilir")
        if t["ad"] == "end_call":
            raise HTTPException(400, "end_call aracı sistemde hazır gelir; ayrıca eklemeyin")
    if not str(a.get("prompt") or "").strip():
        raise HTTPException(400, "Asistan metni (prompt) boş olamaz")
    return a


@router.get("/panel/api/asistanlar")
async def asistan_listesi(_k: dict = Depends(oturum)):
    return [{"id": a["id"], "ad": a.get("ad"), "model": a.get("model"), "sunucu_url": a.get("sunucu_url", ""),
             "ilk_mesaj_modu": a.get("ilk_mesaj_modu", "asistan")} for a in ortak.asistanlari_oku()]


@router.get("/panel/api/asistanlar/{aid}")
async def asistan_getir(aid: str, _k: dict = Depends(oturum)):
    f = _asistan_dosyasi(aid)
    if not f.exists():
        raise HTTPException(404, "Asistan bulunamadı")
    a = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
    a["id"] = aid
    return a


@router.get("/panel/api/asistanlar-disari")
async def asistanlari_indir(_k: dict = Depends(yonetici)):
    """Bütün asistanları tek zip dosyası olarak verir (toplu düzenleme ve yedek için)."""
    import io
    import zipfile

    tampon = io.BytesIO()
    with zipfile.ZipFile(tampon, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted((ortak.AYAR_KLASORU / "asistanlar").glob("*.yaml")):
            z.write(f, f.name)
    ad = f"asistanlar-{time.strftime('%Y%m%d-%H%M')}.zip"
    return Response(tampon.getvalue(), media_type="application/zip", headers={"Content-Disposition": f'attachment; filename="{ad}"', "Cache-Control": "no-store"})


_GIZLI_ALAN = re.compile(r"auth|token|secret|sifre|şifre|password|parola|api[_-]?key|anahtar", re.I)


def _denetim_maskele(v, anahtar: str = ""):
    """Denetim dosyası dışarı verildiği için: gizli alanların değerleri ve metinlerdeki telefon numaraları gizlenir."""
    if isinstance(v, dict):
        return {k: _denetim_maskele(x, str(k)) for k, x in v.items()}
    if isinstance(v, list):
        return [_denetim_maskele(x, anahtar) for x in v]
    if isinstance(v, str):
        if anahtar and _GIZLI_ALAN.search(anahtar) and v:
            return "***"
        return re.sub(r"(?<!\d)(\+?9?0?5\d{2})[ .-]?\d{3}[ .-]?(\d{2})[ .-]?(\d{2})(?!\d)", lambda m: "05** *** " + m.group(2) + " " + m.group(3), v)
    return v


@router.get("/panel/api/denetim")
async def denetim_dosyasi(gun: int = 7, _k: dict = Depends(yonetici)):
    """Asistan ayarlarını ve son günlerin görüşmelerini (konuşma metni, bitiş nedeni, gecikmeler) tek zipte verir.
    Amaç: takılan/kesilen/yanlış bilgi veren asistanları toplu incelemek. Müşteri numaraları ve gizli alanlar maskelenir."""
    import io
    import zipfile

    gun = max(1, min(int(gun), 30))
    r = ortak.redis_baglan()
    try:
        idler = await r.zrevrangebyscore("cagrilar", "+inf", time.time() - gun * 86400, start=0, num=1500)
        kayitlar = [c for c in await _kayitlari_oku(r, idler) if c]
    finally:
        await r.aclose()
    aramalar = []
    for c in kayitlar:
        aramalar.append(_denetim_maskele({
            "id": c.get("id"), "zaman": c.get("createdAt"), "tur": c.get("type"), "asistan": c.get("asistanAdi") or c.get("assistantId"),
            "bizim_numara": (c.get("phoneNumber") or {}).get("number"), "durum": c.get("status"), "bitis_nedeni": c.get("endedReason"),
            "sure_sn": c.get("durationSeconds"), "gecikme": c.get("gecikme"), "ozet": c.get("ozet") or c.get("summary"),
            "sonuc": c.get("sonuc"), "mesajlar": c.get("mesajlar"), "maliyet_tl": c.get("maliyetTl"),
        }))
    tampon = io.BytesIO()
    with zipfile.ZipFile(tampon, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted((ortak.AYAR_KLASORU / "asistanlar").glob("*.yaml")):
            try:
                veri = yaml.safe_load(f.read_text(encoding="utf-8"))
                z.writestr(f"asistanlar/{f.name}", yaml.safe_dump(_denetim_maskele(veri), allow_unicode=True, sort_keys=False, width=10**6))
            except Exception as e:
                z.writestr(f"asistanlar/{f.name}.HATA.txt", str(e)[:300])
        z.writestr("numaralar.json", json.dumps([{k: n.get(k) for k in ("id", "ad", "numara", "hat", "gelen_asistan")} for n in ortak.numaralari_oku()], ensure_ascii=False, indent=1))
        z.writestr("aramalar.json", json.dumps(aramalar, ensure_ascii=False, indent=1))
    ad = f"denetim-{time.strftime('%Y%m%d-%H%M')}.zip"
    return Response(tampon.getvalue(), media_type="application/zip", headers={"Content-Disposition": f'attachment; filename="{ad}"', "Cache-Control": "no-store"})


@router.post("/panel/api/asistanlar-iceri")
async def asistanlari_yukle(request: Request, _k: dict = Depends(yonetici)):
    """Zip içindeki asistan dosyalarını yükler. Hepsi önce denetlenir; biri bile hatalıysa hiçbiri yazılmaz.
    Üzerine yazılan dosyaların eski hâli veri/yedek altında saklanır. Zipte olmayan asistanlara dokunulmaz."""
    import io
    import zipfile

    ham = await request.body()
    if len(ham) > 5 * 1024 * 1024:
        raise HTTPException(413, "Dosya 5 MB'tan büyük olamaz")
    try:
        z = zipfile.ZipFile(io.BytesIO(ham))
    except zipfile.BadZipFile:
        raise HTTPException(400, "Bu dosya zip değil. Panelden indirdiğiniz asistanlar zip dosyasını yükleyin.")
    hazir: list[tuple[Path, dict]] = []
    for bilgi in z.infolist():
        ad = Path(bilgi.filename).name
        if bilgi.is_dir() or not ad.endswith((".yaml", ".yml")) or ad.startswith("."):
            continue
        if bilgi.file_size > 1024 * 1024 or len(hazir) >= 200:
            raise HTTPException(400, f"{ad}: dosya çok büyük ya da zipte çok fazla dosya var")
        try:
            veri = yaml.safe_load(z.read(bilgi).decode("utf-8"))
        except Exception as e:
            raise HTTPException(400, f"{ad}: dosya okunamadı ({str(e)[:120]})")
        if not isinstance(veri, dict):
            raise HTTPException(400, f"{ad}: içerik asistan dosyası değil")
        aid = str(veri.get("id") or Path(ad).stem).strip().lower()
        try:
            hazir.append((_asistan_dosyasi(aid), _asistan_temizle(veri, aid)))
        except HTTPException as e:
            raise HTTPException(400, f"{ad}: {e.detail}")
    if not hazir:
        raise HTTPException(400, "Zipte asistan dosyası (.yaml) bulunamadı")
    yedek = ortak.AYAR_KLASORU / "veri" / "yedek" / time.strftime("%Y%m%d-%H%M%S")
    yeni = guncel = 0
    for dosya, veri in hazir:
        if dosya.exists():
            yedek.mkdir(parents=True, exist_ok=True)
            (yedek / dosya.name).write_bytes(dosya.read_bytes())
            guncel += 1
        else:
            yeni += 1
        yaml_yaz(dosya, veri)
    return {"guncellenen": guncel, "yeni": yeni, "yedek": yedek.name if guncel else ""}


@router.put("/panel/api/asistanlar/{aid}")
async def asistan_kaydet(aid: str, request: Request, _k: dict = Depends(oturum)):
    f = _asistan_dosyasi(aid)
    yaml_yaz(f, _asistan_temizle(await request.json(), aid))
    return {"id": aid}


@router.post("/panel/api/asistanlar/{aid}/kopyala")
async def asistan_kopyala(aid: str, request: Request, _k: dict = Depends(oturum)):
    kaynak = _asistan_dosyasi(aid)
    if not kaynak.exists():
        raise HTTPException(404, "Asistan bulunamadı")
    g = await request.json()
    yeni = str(g.get("id", "")).strip().lower()
    hedef = _asistan_dosyasi(yeni)
    if hedef.exists():
        raise HTTPException(400, "Bu kimlikte bir asistan zaten var")
    a = yaml.safe_load(kaynak.read_text(encoding="utf-8")) or {}
    a.update({"id": yeni, "ad": g.get("ad") or f"{a.get('ad', aid)} (kopya)"})
    a.pop("vapi_id", None)
    yaml_yaz(hedef, a)
    return {"id": yeni}


@router.delete("/panel/api/asistanlar/{aid}")
async def asistan_sil(aid: str, _k: dict = Depends(yonetici)):
    f = _asistan_dosyasi(aid)
    if any(n.get("gelen_asistan") == aid for n in ortak.numaralari_oku()):
        raise HTTPException(400, "Bu asistan bir numaranın gelen aramalarına bağlı; önce numarayı başka asistana bağlayın")
    if f.exists():
        f.rename(f.with_suffix(".silindi"))  # geri alınabilsin diye silmek yerine adını değiştir
    return {}


# ---------- maliyet ----------
_kur_onbellek: tuple[float, float] = (0.0, 0.0)   # (okunma zamanı, 1 USD kaç TL)


async def _kur(fiyat: dict) -> tuple[float, str]:
    """1 ABD doları kaç TL: panelde elle girildiyse o, yoksa Merkez Bankası'nın günlük döviz satış kuru (6 saat önbellek)."""
    global _kur_onbellek
    elle = float(fiyat.get("kur") or 0)
    if elle > 0:
        return elle, "elle girildi"
    if _kur_onbellek[1] and time.time() - _kur_onbellek[0] < 6 * 3600:
        return _kur_onbellek[1], "Merkez Bankası"
    try:
        import httpx

        async with httpx.AsyncClient(timeout=8) as c:
            xml = (await c.get("https://www.tcmb.gov.tr/kurlar/today.xml")).text
        m = re.search(r'CurrencyCode="USD".*?<ForexSelling>([0-9.]+)</ForexSelling>', xml, re.S)
        if m and float(m.group(1)) > 0:
            _kur_onbellek = (time.time(), float(m.group(1)))
            return _kur_onbellek[1], "Merkez Bankası"
    except Exception:
        pass
    return (_kur_onbellek[1], "Merkez Bankası (eski)") if _kur_onbellek[1] else (0.0, "alınamadı")


def _fiyat_temizle(g: dict) -> dict:
    def sayi(v, ad):
        try:
            x = float(v or 0)
        except (TypeError, ValueError):
            raise HTTPException(400, f"{ad} sayı olmalı")
        if not 0 <= x <= 1e6:
            raise HTTPException(400, f"{ad} sıfır ya da daha büyük olmalı")
        return x

    ad_ok = re.compile(r"^[A-Za-z0-9._:-]{1,60}$")
    out: dict = {"llm": {}, "stt": {}, "tts": {}, "tel": {}, "sabit": [], "kur": sayi(g.get("kur"), "Kur")}
    for model, f in (g.get("llm") or {}).items():
        if ad_ok.match(str(model)) and isinstance(f, dict):
            out["llm"][model] = {k: sayi(f.get(k), f"{model} {k}") for k in ("girdi", "onbellek", "cikti")}
    for tur in ("stt", "tts"):
        for model, f in (g.get(tur) or {}).items():
            if ad_ok.match(str(model)):
                out[tur][model] = sayi(f, model)
    for k in ("giden_tl_dk", "gelen_tl_dk"):
        out["tel"][k] = sayi((g.get("tel") or {}).get(k), "Dakika ücreti")
    for x in (g.get("sabit") or [])[:30]:
        if isinstance(x, dict) and str(x.get("ad") or "").strip():
            out["sabit"].append({"ad": str(x["ad"]).strip()[:60], "tutar": sayi(x.get("tutar"), "Sabit gider"), "birim": "USD" if x.get("birim") == "USD" else "TL"})
    return out


@router.get("/panel/api/fiyatlar")
async def fiyat_getir(_k: dict = Depends(oturum)):
    r = ortak.redis_baglan()
    try:
        return await ortak.fiyatlari_oku(r)
    finally:
        await r.aclose()


@router.put("/panel/api/fiyatlar")
async def fiyat_kaydet(request: Request, _k: dict = Depends(yonetici)):
    veri = _fiyat_temizle(await request.json())
    r = ortak.redis_baglan()
    try:
        await r.set("fiyatlar", json.dumps(veri, ensure_ascii=False))
    finally:
        await r.aclose()
    return veri


@router.get("/panel/api/maliyet")
async def maliyet(bas: str = "", bit: str = "", _k: dict = Depends(oturum)):
    """Seçilen tarih aralığında (Türkiye günü, uçlar dahil) servis servis kullanım ve tahmini tutar."""
    from datetime import date, datetime, timedelta

    bugun = datetime.now(ortak.TR).date()
    try:
        b1 = date.fromisoformat(bas) if bas else bugun.replace(day=1)
        b2 = date.fromisoformat(bit) if bit else bugun
    except ValueError:
        raise HTTPException(400, "Tarih YYYY-AA-GG biçiminde olmalı")
    if b2 < b1 or (b2 - b1).days > 400:
        raise HTTPException(400, "Tarih aralığı geçersiz (en çok 400 gün)")
    gunler = [(b1 + timedelta(days=i)).isoformat() for i in range((b2 - b1).days + 1)]
    r = ortak.redis_baglan()
    try:
        fiyat = await ortak.fiyatlari_oku(r)
        toplam: dict[str, float] = {}
        gunluk, asistan_kul = [], {}
        for g in gunler:
            h = await r.hgetall(f"kullanim:{g}")
            for k, v in h.items():
                toplam[k] = toplam.get(k, 0) + float(v)
            m = ortak.maliyet_hesapla(h, fiyat)
            gunluk.append({"gun": g, "usd": m["usd"], "tl": m["tl"], "arama": int(float(h.get("arama|adet|adet", 0)))})
            async for anahtar in r.scan_iter(f"kullanim:{g}:a:*", count=200):
                aid = anahtar.split(":a:", 1)[1]
                hedef = asistan_kul.setdefault(aid, {})
                for k, v in (await r.hgetall(anahtar)).items():
                    hedef[k] = hedef.get(k, 0) + float(v)
    finally:
        await r.aclose()
    kur, kur_kaynak = await _kur(fiyat)
    genel = ortak.maliyet_hesapla(toplam, fiyat)
    adlar = {a["id"]: a.get("ad") for a in ortak.asistanlari_oku()}
    asistanlar = []
    for aid, k in asistan_kul.items():
        m = ortak.maliyet_hesapla(k, fiyat)
        sn = float(k.get("tel|giden|sn", 0)) + float(k.get("tel|gelen|sn", 0))
        asistanlar.append({"id": aid, "ad": adlar.get(aid) or aid, "arama": int(k.get("arama|adet|adet", 0)), "baglanan": int(k.get("arama|baglanan|adet", 0)),
                           "dakika": round(sn / 60, 1), "usd": m["usd"], "tl": m["tl"]})
    asistanlar.sort(key=lambda x: -(x["usd"] * (kur or 1) + x["tl"]))
    sn = float(toplam.get("tel|giden|sn", 0)) + float(toplam.get("tel|gelen|sn", 0))
    return {"bas": gunler[0], "bit": gunler[-1], "kur": kur, "kurKaynak": kur_kaynak, "usd": genel["usd"], "tl": genel["tl"],
            "kalemler": genel["kalemler"], "fiyatsiz": genel["fiyatsiz"], "gunluk": gunluk, "asistanlar": asistanlar,
            "arama": int(toplam.get("arama|adet|adet", 0)), "baglanan": int(toplam.get("arama|baglanan|adet", 0)), "dakika": round(sn / 60, 1),
            "sabit": fiyat.get("sabit") or [], "fiyat": fiyat}


# ---------- numaralar ----------
@router.get("/panel/api/numaralar")
async def numara_listesi(_k: dict = Depends(oturum)):
    return ortak.numaralari_oku()


@router.put("/panel/api/numaralar")
async def numaralari_kaydet(request: Request, _k: dict = Depends(yonetici)):
    liste = await request.json()
    out, gorulen = [], set()
    for n in liste:
        nid = str(n.get("id", "")).strip().lower()
        if not ID_RE.fullmatch(nid) or nid in gorulen:
            raise HTTPException(400, f"Numara kimliği geçersiz ya da yinelenmiş: {nid}")
        gorulen.add(nid)
        numara = ortak.e164(n.get("numara"))
        if not numara.startswith("+"):
            raise HTTPException(400, f"Numara geçersiz: {n.get('numara')}")
        on_ek = str(n.get("on_ek") or "").strip()
        if on_ek and not on_ek.isdigit():
            raise HTTPException(400, "Ön ek yalnızca rakam olabilir")
        hat = "trunk" if n.get("hat") == "trunk" else "dahili"
        out.append({"id": nid, "ad": str(n.get("ad") or ""), "numara": numara, "on_ek": on_ek, "hat": hat,
                    "vapi_id": str(n.get("vapi_id") or ""), "gelen_asistan": str(n.get("gelen_asistan") or "")})
    yaml_yaz(ortak.AYAR_KLASORU / "numaralar.yaml", {"numaralar": out})
    return out


# ---------- aramalar ----------
LISTE_ALANLARI = ("id", "type", "status", "createdAt", "endedReason", "durationSeconds", "customer", "phoneNumber", "assistantId", "asistanAdi", "ozet", "sonuc")
ULASILDI = {"customer-ended-call", "assistant-ended-call", "silence-timed-out", "exceeded-max-duration", "call.in-progress.error-pipeline"}
TARAMA_SINIRI = 20000   # tek istekte okunacak en çok arama kaydı
SAKLAMA_SN = 14 * 86400


async def _kayitlari_oku(r, idler: list[str]) -> list[dict | None]:
    """Arama kayıtlarını 200'lük gruplar halinde okur (tek tek okumaktan çok daha hızlı)."""
    import asyncio

    out: list[dict | None] = []
    for i in range(0, len(idler), 200):
        for v in await r.mget([f"cagri:{c}" for c in idler[i:i + 200]]):
            try:
                k = json.loads(v) if v else None
            except ValueError:
                k = None
            out.append(k if isinstance(k, dict) else None)
        await asyncio.sleep(0)
    return out


def _sonuc_adi(c: dict) -> str:
    """Görüşme sonucunu bulur. Asistanların şemaları farklıdır: sonuc, arama_sonucu, bir üst başlığın içinde vb.
    Adında "sonuc" geçen ilk metin alanı alınır (anahtarlardaki fazladan boşluklar yok sayılır)."""
    sn = c.get("sonuc")
    if isinstance(sn, str) and sn.strip():
        return sn.strip()[:40]

    def ara(d, derinlik=0):
        if not isinstance(d, dict) or derinlik > 2:
            return None
        duz = {str(k).strip().lower(): v for k, v in d.items()}
        for ad in ("sonuc", "arama_sonucu", "gorusme_sonucu"):
            if isinstance(duz.get(ad), str) and duz[ad].strip():
                return duz[ad].strip()
        for k, v in duz.items():
            if ("sonuc" in k or "sonuç" in k) and isinstance(v, str) and v.strip():
                return v.strip()
        for v in duz.values():
            r = ara(v, derinlik + 1)
            if r:
                return r
        return None

    return (ara(sn) or "belirsiz")[:40]


def _liste_satiri(c: dict) -> dict:
    return {**{k: c.get(k) for k in LISTE_ALANLARI}, "sonucAdi": _sonuc_adi(c) if c.get("sonuc") else ""}


def _ulasildi(c: dict) -> bool:
    return c.get("status") == "ended" and c.get("endedReason") in ULASILDI and (c.get("durationSeconds") or 0) > 0


def _duz(s: str) -> str:
    """Aramada büyük/küçük harf ve Türkçe i/ı farkını yok sayar, boşlukları atar."""
    s = str(s or "").replace("İ", "i").replace("I", "i").lower().replace("ı", "i").replace("i̇", "i")
    return re.sub(r"\s+", "", s)


@router.get("/panel/api/aramalar")
async def arama_listesi(limit: int = 50, atla: int = 0, q: str = "", durum: str = "", _k: dict = Depends(oturum)):
    limit, atla = max(1, min(limit, 200)), max(0, atla)
    r = ortak.redis_baglan()
    try:
        alt = time.time() - SAKLAMA_SN
        if not q.strip() and not durum:
            idler = await r.zrevrangebyscore("cagrilar", "+inf", alt, start=atla, num=limit)
            out = [_liste_satiri(c) for c in await _kayitlari_oku(r, idler) if c]
            return {"toplam": await r.zcount("cagrilar", alt, "+inf"), "aramalar": out, "eslesen": None}
        # Arama / süzgeç: saklanan bütün aramalar taranır, yalnızca ilk 200 değil
        aranan = _duz(q)
        rakam = re.sub(r"\D", "", q).lstrip("0")
        idler = await r.zrevrangebyscore("cagrilar", "+inf", alt, start=0, num=TARAMA_SINIRI)
        out, eslesen = [], 0
        for c in await _kayitlari_oku(r, idler):
            if not c:
                continue
            if durum == "ulasilan" and not _ulasildi(c):
                continue
            if durum == "ulasilamayan" and (c.get("status") != "ended" or _ulasildi(c)):
                continue
            if durum == "randevu" and _sonuc_adi(c) != "randevu":
                continue
            if aranan:
                m = c.get("customer") if isinstance(c.get("customer"), dict) else {}
                metin = _duz(" ".join(str(x or "") for x in (m.get("name"), m.get("number"), c.get("asistanAdi"))))
                if aranan not in metin and not (len(rakam) >= 3 and rakam in re.sub(r"\D", "", str(m.get("number") or ""))):
                    continue
            eslesen += 1
            if eslesen > atla and len(out) < limit:
                out.append(_liste_satiri(c))
        return {"toplam": await r.zcount("cagrilar", alt, "+inf"), "aramalar": out, "eslesen": eslesen}
    finally:
        await r.aclose()


_ozet_onbellek: dict[int, tuple[float, dict]] = {}


@router.get("/panel/api/ozet")
async def ozet(gun: int = 14, _k: dict = Depends(oturum)):
    """Genel bakış için günlük sayılar (Türkiye saatiyle) ve son `gun` günün sonuç dağılımı."""
    from datetime import datetime, timedelta

    gun = max(1, min(gun, 14))
    onceki = _ozet_onbellek.get(gun)
    if onceki and time.time() - onceki[0] < 12:      # 15 sn'lik yenileme ve birden çok sekme aynı hesabı kullanır
        return onceki[1]
    simdi = datetime.now(ortak.TR)
    bas = (simdi - timedelta(days=gun - 1)).replace(hour=0, minute=0, second=0, microsecond=0)
    gunler = {(bas + timedelta(days=i)).strftime("%Y-%m-%d"): {"toplam": 0, "ulasilan": 0, "randevu": 0, "konusma_sn": 0} for i in range(gun)}
    sonuclar: dict[str, int] = {}
    suren, eksik_gun = 0, None
    r = ortak.redis_baglan()
    try:
        idler = await r.zrangebyscore("cagrilar", bas.timestamp(), "+inf", withscores=True)
        if len(idler) > TARAMA_SINIRI:               # çok yoğun dönem: en eski günler eksik sayılır, bunu açıkça bildir
            idler = idler[-TARAMA_SINIRI:]
            eksik_gun = datetime.fromtimestamp(idler[0][1], ortak.TR).strftime("%Y-%m-%d")
        kayitlar = await _kayitlari_oku(r, [cid for cid, _ in idler])
    finally:
        await r.aclose()
    for (_cid, t), c in zip(idler, kayitlar):
        if not c:
            continue
        if c.get("status") != "ended":
            if time.time() - t <= 1800:
                suren += 1
                continue
            c = {**c, "status": "ended", "endedReason": "call.in-progress.error-zaman-asimi", "durationSeconds": 0}   # yarım saattir bitmemiş: takılmış
        g = gunler.get(datetime.fromtimestamp(t, ortak.TR).strftime("%Y-%m-%d"))
        if g is None:
            continue
        g["toplam"] += 1
        if _ulasildi(c):
            g["ulasilan"] += 1
            g["konusma_sn"] += c.get("durationSeconds") or 0
            s_ = _sonuc_adi(c)
            sonuclar[s_] = sonuclar.get(s_, 0) + 1
            if s_ == "randevu":
                g["randevu"] += 1
        else:
            ad = {"customer-did-not-answer": "açmadı", "customer-busy": "meşgul"}.get(c.get("endedReason"), "bağlanamadı")
            sonuclar[ad] = sonuclar.get(ad, 0) + 1
    sonuc = {"gunler": [{"gun": k, **v} for k, v in gunler.items()], "sonuclar": sonuclar, "suren": suren, "eksik_gun": eksik_gun}
    _ozet_onbellek[gun] = (time.time(), sonuc)
    return sonuc


@router.get("/panel/api/aramalar/{cid}")
async def arama_getir(cid: str, _k: dict = Depends(oturum)):
    r = ortak.redis_baglan()
    try:
        c = await ortak.cagri_oku(r, cid)
    finally:
        await r.aclose()
    if not c:
        raise HTTPException(404, "Arama bulunamadı")
    c["kayitVar"] = (KAYIT_KLASORU / f"{cid}.wav").exists()
    return c


@router.get("/kayit/{cid}.wav")
async def kayit_disaridan(cid: str, imza: str = ""):
    """n8n ve Bitrix notlarındaki kayıt bağlantısı: oturum gerekmez, adresin içindeki imza doğrulanır."""
    try:
        uuid.UUID(cid)
    except ValueError:
        raise HTTPException(404, "Bulunamadı")
    if not os.environ.get("PANEL_GIZLI") or not hmac.compare_digest(imza, ortak.kayit_imzasi(cid)):
        raise HTTPException(403, "Bağlantı geçersiz")
    f = KAYIT_KLASORU / f"{cid}.wav"
    if not f.exists():
        raise HTTPException(404, "Bu aramanın ses kaydı yok ya da silinmiş")
    return FileResponse(f, media_type="audio/wav", filename=f"{cid}.wav")


@router.get("/panel/api/aramalar/{cid}/kayit")
async def arama_kaydi(cid: str, _k: dict = Depends(oturum)):
    try:
        uuid.UUID(cid)
    except ValueError:
        raise HTTPException(400, "Geçersiz arama kimliği")
    f = KAYIT_KLASORU / f"{cid}.wav"
    if not f.exists():
        raise HTTPException(404, "Bu aramanın ses kaydı yok")
    return FileResponse(f, media_type="audio/wav", filename=f"{cid}.wav")


# ---------- ses karşılaştırma (yalnız yönetici) ----------
# Aynı cümle birkaç seslendirme sağlayıcısında üretilir; panelde yan yana dinlenir ve ilk sesin kaç ms'de geldiği görülür.
# Anahtarlar sunucudaki .env dosyasında durur (ses_anahtar.sh ekler); panele hiçbir zaman gönderilmez.
# İstek biçimleri sağlayıcıların belgelerine göre yazıldı ama gerçek sunucularda denenmedi; sağlayıcı bir şeyi farklı
# bekliyorsa hata metni panelde ilgili satırda görünür. Her sağlayıcı kendi küçük işlevinde, model/sürüm adları
# aşağıdaki sabitlerde durur.
SES_METIN_SINIRI = 400          # karakter
SES_ZAMAN_ASIMI = 30            # saniye (bağlantı + tüm ses)
SES_BOYUT_SINIRI = 8 * 1024 * 1024
SES_DAKIKA_SINIRI = 40          # kullanıcı başına dakikada en çok deneme
SES_TURU = "audio/mpeg"         # dört sağlayıcıdan da MP3 istenir
SES_KOMUTU = "sudo bash /opt/xre-ai/ses_anahtar.sh"

ELEVEN_URL = "https://api.elevenlabs.io"
ELEVEN_MODEL = "eleven_flash_v2_5"                 # asistanların şu an kullandığı model: karşılaştırmanın ölçüsü
ELEVEN_BICIM = "mp3_44100_128"
ELEVEN_SESLER = [("R0D8QjgVyRju4HRoCrIC", "İrem (şu anki ses)"), ("uvU9jrgGLWNPeNA4NgNT", "Franchise sesi")]

AZURE_URL = "https://{bolge}.tts.speech.microsoft.com"
AZURE_BICIM = "audio-24khz-48kbitrate-mono-mp3"
AZURE_SESLER = [("tr-TR-EmelNeural", "Emel"), ("tr-TR-AhmetNeural", "Ahmet (erkek, kıyas için)"),
                ("tr-TR-Elif:MAI-Voice-2-Flash", "Elif (önizleme, çalışmayabilir)")]

GOOGLE_URL = "https://texttospeech.googleapis.com"
GOOGLE_SESLER = [("tr-TR-Chirp3-HD-Leda", "Leda (Chirp 3 HD)"), ("tr-TR-Chirp3-HD-Kore", "Kore (Chirp 3 HD)"),
                 ("tr-TR-Chirp3-HD-Aoede", "Aoede (Chirp 3 HD)"), ("tr-TR-Chirp3-HD-Zephyr", "Zephyr (Chirp 3 HD)"),
                 ("tr-TR-Wavenet-D", "Wavenet D")]

CARTESIA_URL = "https://api.cartesia.ai"
CARTESIA_SURUM = "2025-04-16"                      # Cartesia-Version başlığı; Cartesia bu sürümü reddederse güncellenmeli
CARTESIA_MODEL = "sonic-3"

# Yaklaşık liste fiyatları: ABD doları / 1 milyon karakter (panelde "yaklaşık" diye gösterilir)
SES_FIYAT = {"elevenlabs": 40.0, "azure": 15.0, "google": 30.0, "google_wavenet": 16.0, "cartesia": 38.0}


class SesHatasi(Exception):
    """Sağlayıcı 200 dışında bir cevap verdi (durum: HTTP kodu) ya da cevabı anlaşılamadı (durum: 0)."""

    def __init__(self, durum: int, metin: str):
        super().__init__(metin)
        self.durum, self.metin = durum, metin


def _cartesia_sesleri() -> list[tuple[str, str]]:
    """CARTESIA_SES_IDLERI: virgülle ayrılmış ad=kimlik çiftleri (ör. Selin=a1b2...,Deniz=c3d4...)."""
    out = []
    for parca in os.environ.get("CARTESIA_SES_IDLERI", "").split(","):
        ad, _, kimlik = parca.partition("=")
        ad, kimlik = ad.strip(), kimlik.strip()
        if ad and re.fullmatch(r"[A-Za-z0-9_-]{8,64}", kimlik):
            out.append((kimlik, ad[:40]))
    return out


def _ses_saglayicilari() -> list[dict]:
    """Sağlayıcıların o anki durumu. 'anahtar' ve 'bolge' yalnızca sunucu içinde kullanılır, panele verilmez."""
    def ortam(ad: str) -> str:
        return os.environ.get(ad, "").strip()

    anahtar_yok = f"Anahtar girilmemiş. Sunucuda şu komutu çalıştırın: {SES_KOMUTU}"
    bolge = ortam("AZURE_SPEECH_REGION").lower()
    azure_tamam = bool(ortam("AZURE_SPEECH_KEY")) and bool(re.fullmatch(r"[a-z0-9]{3,30}", bolge))
    cartesia = _cartesia_sesleri()
    return [
        {"id": "elevenlabs", "ad": "ElevenLabs", "anahtar": ortam("ELEVEN_API_KEY"), "hazir": bool(ortam("ELEVEN_API_KEY")),
         "eksik": "ElevenLabs anahtarı bulunamadı. Kurulumu yeniden çalıştırın: sudo bash kur_ai.sh",
         "fiyat_usd_1m": SES_FIYAT["elevenlabs"], "sesler": [{"id": i, "ad": a} for i, a in ELEVEN_SESLER]},
        {"id": "azure", "ad": "Azure Speech", "anahtar": ortam("AZURE_SPEECH_KEY"), "bolge": bolge, "hazir": azure_tamam,
         "eksik": anahtar_yok if not ortam("AZURE_SPEECH_KEY") else f"Azure bölgesi eksik ya da hatalı. Yeniden girin: {SES_KOMUTU}",
         "fiyat_usd_1m": SES_FIYAT["azure"], "sesler": [{"id": i, "ad": a} for i, a in AZURE_SESLER]},
        {"id": "google", "ad": "Google Cloud", "anahtar": ortam("GOOGLE_TTS_KEY"), "hazir": bool(ortam("GOOGLE_TTS_KEY")),
         "eksik": anahtar_yok, "fiyat_usd_1m": SES_FIYAT["google"],
         "sesler": [{"id": i, "ad": a, **({"fiyat_usd_1m": SES_FIYAT["google_wavenet"]} if "Wavenet" in i else {})} for i, a in GOOGLE_SESLER]},
        {"id": "cartesia", "ad": "Cartesia", "anahtar": ortam("CARTESIA_API_KEY"), "hazir": bool(ortam("CARTESIA_API_KEY")) and bool(cartesia),
         "eksik": anahtar_yok if not ortam("CARTESIA_API_KEY") else f"Ses kimliği eklenmemiş. Şu komutu çalıştırıp Cartesia'yı seçin ve ses kimliklerini girin: {SES_KOMUTU}",
         "fiyat_usd_1m": SES_FIYAT["cartesia"], "sesler": [{"id": i, "ad": a} for i, a in cartesia]},
    ]


async def _ses_iste(url: str, basliklar: dict, *, govde: dict | None = None, icerik: bytes | None = None) -> tuple[bytes, float]:
    """Sağlayıcıya POST atar, cevabı akış olarak okur. (ses baytları, ilk bayta kadar geçen saniye) döner."""
    bas = time.perf_counter()
    ilk, parcalar, boyut = None, [], 0
    async with httpx.AsyncClient(timeout=SES_ZAMAN_ASIMI) as c:
        async with c.stream("POST", url, headers=basliklar, json=govde, content=icerik) as y:
            if y.status_code != 200:
                raise SesHatasi(y.status_code, (await y.aread())[:4000].decode("utf-8", "replace"))
            async for parca in y.aiter_bytes():
                if not parca:
                    continue
                if ilk is None:
                    ilk = time.perf_counter() - bas
                boyut += len(parca)
                if boyut > SES_BOYUT_SINIRI:
                    raise SesHatasi(0, "cevap beklenenden büyük")
                parcalar.append(parca)
    if ilk is None:
        raise SesHatasi(0, "boş cevap döndü")
    return b"".join(parcalar), ilk


async def _ses_elevenlabs(s: dict, ses: str, metin: str) -> tuple[bytes, float]:
    # language_code: asistanlar da Türkçe (tr) ile çalışıyor; aynı ayarla kıyaslansın
    return await _ses_iste(f"{ELEVEN_URL}/v1/text-to-speech/{ses}/stream?output_format={ELEVEN_BICIM}",
                           {"xi-api-key": s["anahtar"]}, govde={"text": metin, "model_id": ELEVEN_MODEL, "language_code": "tr"})


async def _ses_azure(s: dict, ses: str, metin: str) -> tuple[bytes, float]:
    ssml = (f"<speak version='1.0' xml:lang='tr-TR'><voice name='{_xml_kacis(ses, {chr(39): '&apos;'})}'>"
            f"{_xml_kacis(metin)}</voice></speak>")
    return await _ses_iste(f"{AZURE_URL.format(bolge=s['bolge'])}/cognitiveservices/v1",
                           {"Ocp-Apim-Subscription-Key": s["anahtar"], "Content-Type": "application/ssml+xml",
                            "X-Microsoft-OutputFormat": AZURE_BICIM, "User-Agent": "xre-panel"}, icerik=ssml.encode("utf-8"))


async def _ses_google(s: dict, ses: str, metin: str) -> tuple[bytes, float]:
    # Anahtar adres satırında (?key=) değil başlıkta gider: adresler günlüklere yazılabilir, başlıklar yazılmaz.
    ham, _ilk = await _ses_iste(f"{GOOGLE_URL}/v1/text:synthesize", {"X-Goog-Api-Key": s["anahtar"]},
                                govde={"input": {"text": metin}, "voice": {"languageCode": "tr-TR", "name": ses}, "audioConfig": {"audioEncoding": "MP3"}})
    try:
        ses_verisi = base64.b64decode(json.loads(ham)["audioContent"], validate=True)
    except Exception:
        raise SesHatasi(0, "cevapta ses bulunamadı")
    if not ses_verisi:
        raise SesHatasi(0, "cevapta ses bulunamadı")
    # Google sesi akıtmaz, tamamını tek JSON içinde (base64) verir: ilk ses ancak cevabın tamamı gelince çalınabilir.
    # Bu yüzden "ilk ses" süresi olarak toplam süre kullanılır (-1: çağıran toplam süreyi yazar).
    return ses_verisi, -1.0


async def _ses_cartesia(s: dict, ses: str, metin: str) -> tuple[bytes, float]:
    return await _ses_iste(f"{CARTESIA_URL}/tts/bytes", {"X-API-Key": s["anahtar"], "Cartesia-Version": CARTESIA_SURUM},
                           govde={"model_id": CARTESIA_MODEL, "transcript": metin, "voice": {"mode": "id", "id": ses}, "language": "tr",
                                  "output_format": {"container": "mp3", "sample_rate": 44100, "bit_rate": 128000}})


SES_ISLEVLERI = {"elevenlabs": _ses_elevenlabs, "azure": _ses_azure, "google": _ses_google, "cartesia": _ses_cartesia}


def _ses_hata_metni(s: dict, metin: str) -> str:
    """Sağlayıcının hata metni: tek satır, en çok 200 karakter; içinde anahtar geçiyorsa silinir."""
    metin = re.sub(r"\s+", " ", metin or "").strip()
    if len(s["anahtar"]) >= 4:
        metin = metin.replace(s["anahtar"], "***")
    return metin[:200]


@router.get("/panel/api/ses-secenekleri")
async def ses_secenekleri(_k: dict = Depends(yonetici)):
    return [{k: v for k, v in s.items() if k not in ("anahtar", "bolge")} for s in _ses_saglayicilari()]


@router.post("/panel/api/ses-dene")
async def ses_dene(request: Request, k: dict = Depends(yonetici)):
    g = await request.json()
    if not isinstance(g, dict):
        raise HTTPException(400, "Geçersiz istek")
    metin = re.sub(r"[\x00-\x1f\x7f]+", " ", str(g.get("metin", ""))).strip()
    if not metin:
        raise HTTPException(400, "Seslendirilecek metni yazın")
    if len(metin) > SES_METIN_SINIRI:
        raise HTTPException(400, f"Metin en çok {SES_METIN_SINIRI} karakter olabilir")
    s = next((x for x in _ses_saglayicilari() if x["id"] == g.get("saglayici")), None)
    if not s:
        raise HTTPException(400, "Bilinmeyen sağlayıcı")
    if not s["hazir"]:
        raise HTTPException(400, f"{s['ad']}: {s['eksik']}")
    ses = str(g.get("ses", ""))
    if ses not in [x["id"] for x in s["sesler"]]:   # yalnızca listedeki sesler: adrese ve SSML'e dışarıdan metin girmez
        raise HTTPException(400, "Bilinmeyen ses")
    # Her deneme sağlayıcıda ücretlidir: kullanıcı başına dakikada sınırlı
    r = ortak.redis_baglan()
    try:
        anahtar = f"ses-dene:{k['ad']}"
        n = await r.incr(anahtar)
        if n == 1:
            await r.expire(anahtar, 60)
        if n > SES_DAKIKA_SINIRI:
            raise HTTPException(429, "Çok fazla deneme. Bir dakika sonra tekrar deneyin.")
    finally:
        await r.aclose()
    bas = time.perf_counter()
    try:
        veri, ilk = await asyncio.wait_for(SES_ISLEVLERI[s["id"]](s, ses, metin), SES_ZAMAN_ASIMI)
    except SesHatasi as h:
        ek = _ses_hata_metni(s, h.metin)
        raise HTTPException(502, f"{s['ad']} hata verdi (HTTP {h.durum}): {ek}" if h.durum else f"{s['ad']} cevabı anlaşılamadı: {ek}")
    except (asyncio.TimeoutError, httpx.TimeoutException):
        raise HTTPException(502, f"{s['ad']} {SES_ZAMAN_ASIMI} saniye içinde cevap vermedi")
    except httpx.HTTPError as h:   # ayrıntı yazılmaz: hata metninde adres ya da başlık geçebilir
        raise HTTPException(502, f"{s['ad']} sunucusuna bağlanılamadı ({type(h).__name__})")
    toplam = time.perf_counter() - bas
    return Response(veri, media_type=SES_TURU, headers={
        "X-Ilk-Ses-Ms": str(round((toplam if ilk < 0 else ilk) * 1000)), "X-Toplam-Ms": str(round(toplam * 1000)),
        "X-Karakter": str(len(metin)), "Cache-Control": "no-store"})
