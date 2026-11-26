"""Yönetim paneli: asistanları, numaraları, kullanıcıları ve arama kayıtlarını tarayıcıdan yönetmek için.
Sayfa /panel adresinde açılır; /panel/api/... uçları oturum çerezi ister."""
from __future__ import annotations

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
    sn = c.get("sonuc")
    if isinstance(sn, str) and sn.strip():
        return sn.strip()[:40]
    return str((sn.get("sonuc") if isinstance(sn, dict) else None) or "belirsiz")


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
            out = [{k: c.get(k) for k in LISTE_ALANLARI} for c in await _kayitlari_oku(r, idler) if c]
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
                out.append({k: c.get(k) for k in LISTE_ALANLARI})
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
