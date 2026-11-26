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
@router.get("/panel/api/aramalar")
async def arama_listesi(limit: int = 50, atla: int = 0, _k: dict = Depends(oturum)):
    r = ortak.redis_baglan()
    try:
        idler = await r.zrevrange("cagrilar", atla, atla + max(1, min(limit, 200)) - 1)
        out = []
        for cid in idler:
            c = await ortak.cagri_oku(r, cid)
            if c:
                out.append({k: c.get(k) for k in ("id", "type", "status", "createdAt", "endedReason", "durationSeconds", "customer",
                                                  "phoneNumber", "assistantId", "asistanAdi", "ozet", "sonuc")})
        return {"toplam": await r.zcard("cagrilar"), "aramalar": out}
    finally:
        await r.aclose()


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
