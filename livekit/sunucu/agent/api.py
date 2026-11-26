"""n8n'in konuştuğu HTTP API. Vapi ile aynı adresleri taklit eder:
   POST /call  ·  GET /call  ·  GET /call/{id}  ·  GET /assistant  ·  GET /phone-number
n8n'de yalnızca adres (https://api.vapi.ai → http://SUNUCU:8080) ve anahtar değişir."""
from __future__ import annotations

import json
import os
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from livekit import api

import ortak

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
    yield


app = FastAPI(title="XRE Arama API", lifespan=yasam)


def yetki(authorization: str = Header(default="")) -> None:
    if authorization.removeprefix("Bearer ").strip() != API_ANAHTARI:
        raise HTTPException(401, "Geçersiz API anahtarı")


def disari(c: dict) -> dict:
    return {k: v for k, v in c.items() if not k.startswith("_")}


@app.get("/saglik")
async def saglik():
    return {"durum": "ok"}


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
        "metadata": govde.get("metadata") or {}, "name": govde.get("name"),
    }
    await ortak.cagri_yaz(r, cagri)
    meta = {**cagri, "asistan": asistan, "variableValues": ov.get("variableValues") or {},
            "aranacak": f"{hat.get('on_ek') or ''}{ortak.santral_numarasi(numara)}"}
    try:
        async with lk() as l:
            await l.agent_dispatch.create_dispatch(api.CreateAgentDispatchRequest(
                agent_name=ortak.AJAN_ADI, room=f"cagri-{cid}", metadata=json.dumps(meta, ensure_ascii=False)))
    except Exception as e:
        await ortak.cagri_guncelle(r, cid, status="ended", endedReason="call.start.error-livekit", endedAt=ortak.simdi_iso())
        raise HTTPException(502, f"Arama başlatılamadı: {e}")
    return disari(cagri)


@app.get("/call", dependencies=[Depends(yetki)])
async def aramalar(createdAtGt: str | None = Query(default=None), limit: int = 100):
    alt = 0.0
    if createdAtGt:
        try:
            alt = datetime.fromisoformat(createdAtGt.replace("Z", "+00:00")).timestamp()
        except ValueError:
            raise HTTPException(400, "createdAtGt ISO tarih olmalı")
    idler = await r.zrevrangebyscore("cagrilar", "+inf", alt, start=0, num=max(1, min(limit, 1000)))
    out = []
    for cid in idler:
        c = await ortak.cagri_oku(r, cid)
        if not c:
            continue
        # 30 dakikadan eski "bitmemiş" kayıt hattı sonsuza dek meşgul göstermesin
        if c.get("status") != "ended" and time.time() - (await r.zscore("cagrilar", cid) or 0) > 1800:
            c["status"], c["endedReason"] = "ended", "call.in-progress.error-zaman-asimi"
        out.append(disari(c))
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
