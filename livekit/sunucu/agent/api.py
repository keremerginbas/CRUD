"""n8n'in konuştuğu HTTP API. Vapi ile aynı adresleri taklit eder:
   POST /call  ·  GET /call  ·  GET /call/{id}  ·  GET /assistant  ·  GET /phone-number
n8n'de yalnızca adres (https://api.vapi.ai → http://SUNUCU:8080) ve anahtar değişir."""
from __future__ import annotations

import hmac
import json
import os
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from livekit import api

import ortak
import panel

LK_URL = os.environ.get("LIVEKIT_URL", "http://127.0.0.1:7880")
API_ANAHTARI = os.environ["API_ANAHTARI"]
ASTERISK_ADRES = os.environ.get("ASTERISK_ADRES", "127.0.0.1:5070")
r = ortak.redis_baglan()


def lk() -> api.LiveKitAPI:
    return api.LiveKitAPI(LK_URL)  # anahtarlar LIVEKIT_API_KEY / LIVEKIT_API_SECRET ortam değişkenlerinden


async def trunklari_hazirla() -> None:
    """LiveKit ↔ Asterisk köprüsünü bir kez tanımlar (zaten varsa dokunmaz)."""
    async with lk() as l:
        giden = await l.sip.list_sip_outbound_trunk(api.ListSIPOutboundTrunkRequest())
        if not any(t.name == ortak.GIDEN_TRUNK_ADI for t in giden.items):
            await l.sip.create_sip_outbound_trunk(api.CreateSIPOutboundTrunkRequest(trunk=api.SIPOutboundTrunkInfo(
                name=ortak.GIDEN_TRUNK_ADI, address=ASTERISK_ADRES, transport=api.SIPTransport.SIP_TRANSPORT_UDP, numbers=["xre-ai"])))
        gelen = await l.sip.list_sip_inbound_trunk(api.ListSIPInboundTrunkRequest())
        g = next((t for t in gelen.items if t.name == ortak.GELEN_TRUNK_ADI), None)
        if not g:
            g = await l.sip.create_sip_inbound_trunk(api.CreateSIPInboundTrunkRequest(trunk=api.SIPInboundTrunkInfo(
                name=ortak.GELEN_TRUNK_ADI, allowed_addresses=os.environ.get("ASTERISK_IPLERI", "127.0.0.1").split(","))))
        kurallar = await l.sip.list_sip_dispatch_rule(api.ListSIPDispatchRuleRequest())
        if not any(k.name == "gelen-aramalar" for k in kurallar.items):
            await l.sip.create_sip_dispatch_rule(api.CreateSIPDispatchRuleRequest(
                name="gelen-aramalar", trunk_ids=[g.sip_trunk_id],
                rule=api.SIPDispatchRule(dispatch_rule_individual=api.SIPDispatchRuleIndividual(room_prefix="gelen-")),
                room_config=api.RoomConfiguration(agents=[api.RoomAgentDispatch(agent_name=ortak.AJAN_ADI)])))


@asynccontextmanager
async def yasam(_app: FastAPI):
    for i in range(30):
        try:
            await trunklari_hazirla()
            break
        except Exception as e:  # livekit henüz açılmamış olabilir
            print(f"LiveKit bekleniyor ({i + 1}/30): {e}", flush=True)
            time.sleep(2)
    sifre = panel.ilk_yonetici()
    if sifre:
        print(f"PANEL İLK GİRİŞ → kullanıcı: yonetici  şifre: {sifre}  (girişten sonra değiştirin)", flush=True)
    yield


app = FastAPI(title="XRE Arama API", lifespan=yasam, docs_url=None, redoc_url=None, openapi_url=None)
app.include_router(panel.router)


# EK_API_ANAHTARLARI: virgülle ayrılmış ek anahtarlar. n8n'deki mevcut "Vapi" kimlik bilgisi değiştirilmeden
# çalışsın diye eski Vapi anahtarı buraya yazılabilir (n8n_baglan.sh).
ANAHTARLAR = [API_ANAHTARI] + [k.strip() for k in os.environ.get("EK_API_ANAHTARLARI", "").split(",") if len(k.strip()) >= 16]


def yetki(authorization: str = Header(default="")) -> None:
    gelen = authorization.removeprefix("Bearer ").strip()
    if not any(hmac.compare_digest(gelen.encode(), k.encode()) for k in ANAHTARLAR):
        raise HTTPException(401, "Geçersiz API anahtarı")


def disari(c: dict) -> dict:
    return {k: v for k, v in c.items() if not k.startswith("_")}


@app.get("/saglik")
async def saglik():
    return {"durum": "ok"}


@app.post("/panel/api/dene", status_code=201)
async def panelden_dene(govde: dict, _k: dict = Depends(panel.oturum)):
    """Panelin "Dene" düğmesi: seçilen asistanı verilen numaraya aratır."""
    return await arama_baslat({"assistantId": govde.get("asistan"), "phoneNumberId": govde.get("hat") or "",
                               "customer": {"number": govde.get("numara"), "name": govde.get("ad") or ""},
                               "assistantOverrides": {"variableValues": govde.get("degiskenler") or {}}})


@app.post("/call", dependencies=[Depends(yetki)], status_code=201)
async def arama_baslat(govde: dict):
    asistan = ortak.asistan_bul(govde.get("assistantId") or (govde.get("assistant") or {}).get("name"))
    if not asistan:
        raise HTTPException(400, f"Asistan bulunamadı: {govde.get('assistantId')}")
    musteri = govde.get("customer") or {}
    numara = ortak.e164(musteri.get("number"))
    if not numara.startswith("+") or len(numara) < 10:
        raise HTTPException(400, f"Geçersiz müşteri numarası: {musteri.get('number')}")
    hat = ortak.numara_bul(govde.get("phoneNumberId"))
    if not hat:
        raise HTTPException(400, f"Arayan numara tanımlı değil: {govde.get('phoneNumberId')}")
    ov = govde.get("assistantOverrides") or {}
    if ov.get("firstMessage"):
        asistan = {**asistan, "ilk_mesaj": ov["firstMessage"]}
    if isinstance(ov.get("firstMessageInterruptionsEnabled"), bool):
        asistan = {**asistan, "ilk_mesaj_kesilebilir": ov["firstMessageInterruptionsEnabled"]}
    if (ov.get("voice") or {}).get("voiceId"):  # Vapi'deki gibi: tek arama için ses değiştirme
        asistan = {**asistan, "ses_id": ov["voice"]["voiceId"]}
    if (ov.get("model") or {}).get("model"):
        asistan = {**asistan, "model": ov["model"]["model"]}
    cid = str(uuid.uuid4())
    cagri = {
        "id": cid, "type": "outboundPhoneCall", "status": "queued", "createdAt": ortak.simdi_iso(),
        "assistantId": govde.get("assistantId"), "phoneNumberId": govde.get("phoneNumberId") or hat.get("vapi_id") or hat.get("id"),
        "customer": {"number": numara, **({"name": musteri["name"]} if musteri.get("name") else {})},
        "phoneNumber": {"number": ortak.e164(hat.get("numara"))},
        "metadata": govde.get("metadata") or {}, "name": govde.get("name"), "asistanAdi": asistan.get("ad"),
    }
    await ortak.cagri_yaz(r, cagri)
    meta = {**cagri, "asistan": asistan, "variableValues": ov.get("variableValues") or {},
            "aranacak": f"{hat.get('on_ek') or ''}{ortak.santral_numarasi(numara)}",
            "hat": hat.get("hat") or "dahili",
            # NetSantral numaraları başında 0 olmadan gösteriyor (5337437116); trunk'ta arayan numara bu biçimde gönderilir
            "arayan": str(hat.get("arayan") or ortak.santral_numarasi(hat.get("numara")).lstrip("0"))}
    try:
        async with lk() as l:
            await l.agent_dispatch.create_dispatch(api.CreateAgentDispatchRequest(
                agent_name=ortak.AJAN_ADI, room=f"cagri-{cid}", metadata=json.dumps(meta, ensure_ascii=False)))
    except Exception as e:
        await ortak.cagri_guncelle(r, cid, status="ended", endedReason="call.start.error-livekit", endedAt=ortak.simdi_iso())
        raise HTTPException(502, f"Arama başlatılamadı: {e}")
    return disari(cagri)


def _zaman(deger: str | None, ad: str) -> float | None:
    if not deger:
        return None
    try:
        return datetime.fromisoformat(deger.replace("Z", "+00:00")).timestamp()
    except ValueError:
        raise HTTPException(400, f"{ad} ISO tarih olmalı")


@app.get("/call", dependencies=[Depends(yetki)])
async def aramalar(createdAtGt: str | None = None, createdAtGe: str | None = None, createdAtLt: str | None = None, createdAtLe: str | None = None,
                   assistantId: str | None = None, phoneNumberId: str | None = None, limit: int = 100):
    """Vapi'nin GET /call süzgeçleri: oluşturulma zamanı aralığı, asistan, numara. En yeni önce."""
    alt = _zaman(createdAtGt, "createdAtGt") or _zaman(createdAtGe, "createdAtGe") or 0.0
    ust = _zaman(createdAtLt, "createdAtLt") or _zaman(createdAtLe, "createdAtLe")
    asistan = ortak.asistan_bul(assistantId) if assistantId else None
    asistan_idleri = {assistantId, (asistan or {}).get("id"), (asistan or {}).get("vapi_id")} - {None, ""}
    limit = max(1, min(limit, 1000))
    idler = await r.zrevrangebyscore("cagrilar", ust if ust is not None else "+inf", alt, start=0, num=5000, withscores=True)
    out = []
    for i in range(0, len(idler), 200):
        parca = idler[i:i + 200]
        for (cid, puan), ham in zip(parca, await r.mget([f"cagri:{c}" for c, _ in parca])):
            try:
                c = json.loads(ham) if ham else None
            except ValueError:
                c = None
            if not isinstance(c, dict):
                continue
            if asistan_idleri and c.get("assistantId") not in asistan_idleri:
                continue
            if phoneNumberId and c.get("phoneNumberId") != phoneNumberId:
                continue
            # 30 dakikadan eski "bitmemiş" kayıt hattı sonsuza dek meşgul göstermesin
            if c.get("status") != "ended" and time.time() - puan > 1800:
                c["status"], c["endedReason"] = "ended", "call.in-progress.error-zaman-asimi"
            out.append(disari(c))
            if len(out) >= limit:
                return out
    return out


@app.get("/call/{cid}", dependencies=[Depends(yetki)])
async def arama(cid: str):
    c = await ortak.cagri_oku(r, cid)
    if not c:
        raise HTTPException(404, "Çağrı bulunamadı")
    return disari(c)


@app.get("/assistant", dependencies=[Depends(yetki)])
async def asistanlar():
    return [{"id": a.get("vapi_id") or a["id"], "name": a.get("ad")} for a in ortak.asistanlari_oku()]


@app.get("/phone-number", dependencies=[Depends(yetki)])
async def numaralar():
    return [{"id": n.get("vapi_id") or n.get("id"), "number": ortak.e164(n.get("numara")), "name": n.get("ad", "")} for n in ortak.numaralari_oku()]
