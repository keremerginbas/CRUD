"""XRE sesli asistan (LiveKit Agents). Giden ve gelen telefon görüşmelerini yürütür,
bitince n8n'e Vapi ile aynı biçimde "end-of-call-report" gönderir."""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
import uuid

import httpx
from google.protobuf.duration_pb2 import Duration
from livekit import api, rtc
from livekit.agents import Agent, AgentSession, JobContext, WorkerOptions, cli, function_tool, room_io
from livekit.agents.beta.tools import EndCallTool
from livekit.agents.voice.events import CloseEvent, CloseReason
from livekit.plugins import deepgram, elevenlabs, openai, silero

import ortak

log = logging.getLogger("xre-ajan")
KURU_MOD = os.environ.get("KURU_MOD") == "1"  # yalnızca hat/altyapı testi: yapay zekâ çalışmaz
MUSTERI = "musteri"

KAPATMA_NOTU = """

# GÖRÜŞMEYİ KAPATMA (teknik kural)
Görüşmeyi bitireceğin zaman kapanış/vedalaşma cümleni SÖYLEMEDEN doğrudan end_call aracını çağır.
Araç senden kapanış cümleni söylemeni isteyecek; o cümleyi yalnızca bir kez söyle. Araç adını müşteriye söyleme."""


class Gorusme:
    def __init__(self, ctx: JobContext, meta: dict):
        self.ctx = ctx
        self.meta = meta
        self.r = ortak.redis_baglan()
        self.id = meta.get("id") or str(uuid.uuid4())
        self.tur = meta.get("type") or "inboundPhoneCall"
        self.asistan: dict = meta.get("asistan") or {}
        self.degiskenler: dict = dict(meta.get("variableValues") or {})
        self.musteri_no = meta.get("customer", {}).get("number", "")
        self.hat_no = meta.get("phoneNumber", {}).get("number", "")
        self.baslangic: float | None = None
        self.bitis_nedeni = ""
        self.asistan_kapatti = False
        self.session: AgentSession | None = None
        self.rapor_gitti = False

    # ---------- Vapi biçimli "call" nesnesi ----------
    def call_nesnesi(self) -> dict:
        return {
            "id": self.id,
            "type": self.tur,
            "assistantId": self.asistan.get("vapi_id") or self.asistan.get("id"),
            "phoneNumberId": self.meta.get("phoneNumberId"),
            "customer": {"number": self.musteri_no, **({"name": self.meta["customer"]["name"]} if self.meta.get("customer", {}).get("name") else {})},
            "phoneNumber": {"number": self.hat_no},
            "assistantOverrides": {"variableValues": self.degiskenler},
            "metadata": self.meta.get("metadata") or {},
        }

    async def durum(self, status: str, **ek) -> None:
        try:
            await ortak.cagri_guncelle(self.r, self.id, status=status, **ek)
        except Exception as e:  # kayıt tutulamadı diye görüşme durmasın
            log.warning("çağrı durumu yazılamadı: %s", e)

    # ---------- araçlar ----------
    def araclari_kur(self) -> list:
        araclar: list = []
        for t in self.asistan.get("araclar") or []:
            araclar.append(self._webhook_araci(t))

        async def kapatildi(_ev) -> None:
            self.asistan_kapatti = True

        araclar.append(
            EndCallTool(
                extra_description="Görüşme bittiğinde, müşteri vedalaştığında ya da prompt görüşmeyi kapatmanı söylediğinde çağır.",
                end_instructions="Prompttaki kapanış/vedalaşma cümleni şimdi tek seferde söyle. Başka hiçbir şey ekleme, soru sorma.",
                delete_room=True,
                on_tool_called=kapatildi,
            )
        )
        return araclar

    def _webhook_araci(self, t: dict):
        ad = t["ad"]
        url = t.get("url") or self.asistan.get("sunucu_url") or ""
        sema = {"name": ad, "description": t.get("aciklama", ""), "parameters": t.get("parametreler") or {"type": "object", "properties": {}}}

        async def calistir(raw_arguments: dict) -> str:
            cagri_id = "call_" + uuid.uuid4().hex[:20]
            if not url:
                log.info("araç %s (URL yok, deneme): %s", ad, raw_arguments)
                return t.get("deneme_yaniti") or "Kaydedildi."
            govde = {"message": {
                "type": "tool-calls",
                "toolCallList": [{"id": cagri_id, "type": "function", "function": {"name": ad, "arguments": raw_arguments}}],
                "call": self.call_nesnesi(), "customer": {"number": self.musteri_no}, "phoneNumber": {"number": self.hat_no},
            }}
            try:
                async with httpx.AsyncClient(timeout=20) as c:
                    y = await c.post(url, json=govde)
                    y.raise_for_status()
                    sonuc = (y.json().get("results") or [{}])[0].get("result")
                    return sonuc if isinstance(sonuc, str) else json.dumps(sonuc, ensure_ascii=False)
            except Exception as e:
                log.error("araç %s başarısız: %s", ad, e)
                return "Sisteme kayıt sırasında teknik bir sorun oldu. Müşteriye talebini not aldığını ve danışmanın arayacağını söyle."

        return function_tool(calistir, raw_schema=sema)

    # ---------- giden arama ----------
    async def musteriyi_ara(self) -> bool:
        trunklar = await self.ctx.api.sip.list_sip_outbound_trunk(api.ListSIPOutboundTrunkRequest())
        trunk = next((t for t in trunklar.items if t.name == ortak.GIDEN_TRUNK_ADI), None)
        if not trunk:
            self.bitis_nedeni = "call.in-progress.error-sip-outbound-trunk-yok"
            return False
        await self.durum("ringing")
        try:
            await self.ctx.api.sip.create_sip_participant(
                api.CreateSIPParticipantRequest(
                    room_name=self.ctx.room.name,
                    sip_trunk_id=trunk.sip_trunk_id,
                    sip_call_to=self.meta["aranacak"],
                    participant_identity=MUSTERI,
                    participant_name=self.meta.get("customer", {}).get("name") or "Müşteri",
                    wait_until_answered=True,
                    ringing_timeout=Duration(seconds=int(self.asistan.get("calma_suresi_sn", 40))),
                ),
                timeout=70,
            )
            return True
        except api.TwirpError as e:
            kod = e.metadata.get("sip_status_code") or e.metadata.get("sip_status")
            self.bitis_nedeni = ortak.sip_bitis_nedeni(kod, e.message)
            log.info("arama bağlanmadı: sip=%s %s → %s", kod, e.message, self.bitis_nedeni)
            return False
        except Exception as e:
            self.bitis_nedeni = "call.in-progress.error-sip-outbound-call-failed-to-connect"
            log.error("arama hatası: %s", e)
            return False

    # ---------- ana akış ----------
    async def calistir(self) -> None:
        ctx = self.ctx
        ctx.add_shutdown_callback(self.rapor_gonder)
        await ctx.connect()

        if self.tur == "outboundPhoneCall":
            if not await self.musteriyi_ara():
                await self.durum("ended", endedReason=self.bitis_nedeni, endedAt=ortak.simdi_iso())
                ctx.shutdown(reason=self.bitis_nedeni)
                return
        katilimci = await ctx.wait_for_participant(identity=MUSTERI if self.tur == "outboundPhoneCall" else None)

        if self.tur != "outboundPhoneCall":  # gelen arama: kim aradı, hangi numarayı aradı
            oz = katilimci.attributes
            self.musteri_no = ortak.e164(oz.get("sip.phoneNumber", ""))
            self.hat_no = ortak.e164(oz.get("sip.trunkPhoneNumber", ""))
            n = ortak.numara_bul(self.hat_no) or {}
            self.meta["phoneNumberId"] = n.get("vapi_id") or n.get("id")
            self.asistan = ortak.asistan_bul(n.get("gelen_asistan") or os.environ.get("VARSAYILAN_GELEN_ASISTAN")) or {}
            self.degiskenler.setdefault("customer_phone", self.musteri_no)
            await ortak.cagri_yaz(self.r, {**self.call_nesnesi(), "status": "in-progress", "createdAt": ortak.simdi_iso()})
            if not self.asistan:
                log.error("gelen arama için asistan tanımlı değil: %s", self.hat_no)
                self.bitis_nedeni = "assistant-not-found"
                await ctx.delete_room()
                return

        self.baslangic = time.time()
        await self.durum("in-progress", startedAt=ortak.simdi_iso())
        azami = int(self.asistan.get("azami_sure_sn", 420))

        if KURU_MOD:
            await asyncio.sleep(float(os.environ.get("KURU_MOD_SN", "5")))
            self.bitis_nedeni = "assistant-ended-call"
            await ctx.delete_room()
            return

        a = self.asistan
        d = self.degiskenler
        session = AgentSession(
            stt=deepgram.STT(model=a.get("stt_model", "nova-3"), language=a.get("dil", "tr"), endpointing_ms=int(a.get("stt_bekleme_ms", 150))),
            llm=openai.LLM(model=a.get("model", "gpt-4.1"), temperature=float(a.get("sicaklik", 0.4))),
            tts=elevenlabs.TTS(
                voice_id=a.get("ses_id") or os.environ.get("ELEVEN_VOICE_ID", ""),
                model=a.get("ses_modeli", "eleven_flash_v2_5"),
                language=a.get("dil", "tr"),
                voice_settings=elevenlabs.VoiceSettings(
                    stability=float(a.get("ses_kararlilik", 0.5)), similarity_boost=float(a.get("ses_benzerlik", 0.75)), speed=float(a.get("ses_hizi", 1.0))
                ),
            ),
            vad=silero.VAD.load(),
            min_endpointing_delay=float(a.get("soz_bitti_bekleme_sn", 0.5)),
            max_endpointing_delay=float(a.get("soz_bitti_azami_sn", 3.0)),
            user_away_timeout=float(a.get("sessizlik_sn", 20)),
        )
        self.session = session

        @session.on("close")
        def kapandi(ev: CloseEvent) -> None:
            if self.bitis_nedeni:
                return
            if self.asistan_kapatti:
                self.bitis_nedeni = "assistant-ended-call"
            elif ev.reason == CloseReason.PARTICIPANT_DISCONNECTED:
                self.bitis_nedeni = "customer-ended-call"
            elif ev.reason == CloseReason.ERROR:
                self.bitis_nedeni = "call.in-progress.error-pipeline"
            else:
                self.bitis_nedeni = "assistant-ended-call"
            ctx.shutdown(reason=self.bitis_nedeni)

        @session.on("user_state_changed")
        def sessizlik(ev) -> None:
            if ev.new_state == "away" and not self.bitis_nedeni:
                self.bitis_nedeni = "silence-timed-out"
                asyncio.create_task(ctx.delete_room())

        async def sure_siniri() -> None:
            await asyncio.sleep(azami)
            if not self.bitis_nedeni:
                self.bitis_nedeni = "exceeded-max-duration"
                await ctx.delete_room()

        sinir = asyncio.create_task(sure_siniri())
        ctx.add_shutdown_callback(lambda: _iptal(sinir))

        ajan = Agent(instructions=ortak.sablon_doldur(a.get("prompt", ""), d) + KAPATMA_NOTU, tools=self.araclari_kur())
        await session.start(
            ajan, room=ctx.room,
            room_options=room_io.RoomOptions(participant_identity=katilimci.identity, close_on_disconnect=True),
        )
        ilk = ortak.sablon_doldur(a.get("ilk_mesaj", ""), d).strip()
        if ilk and a.get("ilk_mesaj_modu", "asistan") == "asistan":
            await session.say(ilk, allow_interruptions=bool(a.get("ilk_mesaj_kesilebilir", False)))

    # ---------- çağrı sonu raporu ----------
    def _mesajlar(self) -> list[dict]:
        out = []
        if not self.session:
            return out
        for it in self.session.history.items:
            if getattr(it, "type", "") != "message" or it.role not in ("user", "assistant"):
                continue
            metin = (it.text_content or "").strip()
            if metin:
                out.append({"role": "user" if it.role == "user" else "bot", "message": metin})
        return out

    async def _analiz(self, transkript: str) -> dict:
        an = self.asistan.get("analiz") or {}
        if not transkript or KURU_MOD:
            return {"summary": "", "structuredData": {}}
        sema = an.get("yapilandirilmis") or {}
        istek = (
            "Aşağıda bir satış asistanı (AI) ile müşteri (User) arasındaki telefon görüşmesinin dökümü var.\n"
            f"{an.get('ozet_talimati', 'Görüşmeyi Türkçe iki-dört cümleyle özetle.')}\n"
            "Yalnızca şu biçimde JSON döndür: {\"summary\": \"...\", \"structuredData\": {...}}\n"
            f"structuredData şu JSON şemasına uymalı (şema boşsa boş nesne döndür):\n{json.dumps(sema, ensure_ascii=False)}\n"
            f"{an.get('talimat', '')}\n\nDÖKÜM:\n{transkript}"
        )
        try:
            import openai as oa

            y = await oa.AsyncOpenAI().chat.completions.create(
                model=an.get("model", "gpt-4.1-mini"), temperature=0, response_format={"type": "json_object"},
                messages=[{"role": "user", "content": istek}],
            )
            v = json.loads(y.choices[0].message.content or "{}")
            return {"summary": str(v.get("summary", "")), "structuredData": v.get("structuredData") or {}}
        except Exception as e:
            log.error("analiz başarısız: %s", e)
            return {"summary": "", "structuredData": {}}

    async def rapor_gonder(self, *_a) -> None:
        if self.rapor_gitti:
            return
        self.rapor_gitti = True
        bitis = time.time()
        sure = round(bitis - self.baslangic, 1) if self.baslangic else 0
        mesajlar = self._mesajlar()
        transkript = "\n".join(f"{'User' if m['role'] == 'user' else 'AI'}: {m['message']}" for m in mesajlar)
        neden = self.bitis_nedeni or "customer-ended-call"
        analiz = await self._analiz(transkript)
        iso = lambda t: (time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(t)) + "Z") if t else None  # noqa: E731
        call = {**self.call_nesnesi(), "status": "ended", "endedReason": neden, "startedAt": iso(self.baslangic), "endedAt": iso(bitis)}
        rapor = {"message": {
            "type": "end-of-call-report", "endedReason": neden, "call": call,
            "customer": call["customer"], "phoneNumber": call["phoneNumber"],
            "artifact": {"messages": mesajlar, "transcript": transkript},
            "transcript": transkript, "summary": analiz["summary"], "analysis": analiz,
            "startedAt": call["startedAt"], "endedAt": call["endedAt"], "durationSeconds": sure, "cost": 0,
        }}
        await self.durum("ended", endedReason=neden, endedAt=ortak.simdi_iso(), durationSeconds=sure)
        url = self.asistan.get("sunucu_url")
        log.info("görüşme bitti id=%s neden=%s süre=%ss rapor=%s", self.id, neden, sure, url or "(URL yok)")
        if not url:
            log.info("RAPOR: %s", json.dumps(rapor, ensure_ascii=False)[:4000])
        else:
            for deneme in range(3):
                try:
                    async with httpx.AsyncClient(timeout=30) as c:
                        (await c.post(url, json=rapor)).raise_for_status()
                    break
                except Exception as e:
                    log.error("rapor gönderilemedi (%s. deneme): %s", deneme + 1, e)
                    await asyncio.sleep(3)
        await self.r.aclose()


async def _iptal(gorev: asyncio.Task) -> None:
    gorev.cancel()


async def entrypoint(ctx: JobContext) -> None:
    try:
        meta = json.loads(ctx.job.metadata or "{}")
    except json.JSONDecodeError:
        meta = {}
    await Gorusme(ctx, meta).calistir()


if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint, agent_name=ortak.AJAN_ADI, port=8081))
