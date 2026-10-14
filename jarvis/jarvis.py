"""JARVIS — Windows için sesli asistan.

Akış:
  1. Arka planda "Hey Jarvis" uyandırma kelimesini (ya da Ctrl+Alt+J kısayolunu) bekler.
     Uyandırma kelimesi bilgisayarda çalışır, internete ses gitmez.
  2. Uyanınca ElevenLabs'in canlı sesli asistanıyla konuşma başlar: sizi dinler, sözünü
     kesebilirsiniz, gerçekçi sesle anında cevap verir. Beyin: Claude.
  3. Zor sorularda "derin_dusun" aracıyla kendi Claude anahtarınızla uzun uzun düşünür.
  4. "Beni dinle" / "toplantıyı dinle" derseniz susar ve kaydeder; "Hey Jarvis" deyince
     kaydı yazıya döker, Claude ile özetler, özeti sesli anlatır ve sorular sorar.
  5. Her konuşmadan kısa bir not çıkarır ve sonraki konuşmalarda hatırlar.
"""
import datetime
import hashlib
import json
import logging
import os
import queue
import random
import sys
import threading
import time
import wave
from pathlib import Path

import numpy as np
import pyaudio
from dotenv import load_dotenv

import anthropic
from elevenlabs.client import ElevenLabs
from elevenlabs.conversational_ai.conversation import (
    ClientTools,
    Conversation,
    ConversationInitiationData,
)
from elevenlabs.conversational_ai.default_audio_interface import DefaultAudioInterface

KLASOR = Path(__file__).resolve().parent
load_dotenv(KLASOR / ".env")

# ---------------- Ayarlar (.env) ----------------
ELEVEN_KEY = os.getenv("ELEVENLABS_API_KEY", "").strip()
CLAUDE_KEY = os.getenv("ANTHROPIC_API_KEY", "").strip()
KULLANICI_ADI = os.getenv("JARVIS_KULLANICI_ADI", "").strip()
# Varsayılan ses: "George" (ElevenLabs hazır sesi, tok ve sakin İngiliz erkek sesi; Türkçe konuşur)
SES_ID = os.getenv("JARVIS_SES_ID", "").strip() or "JBFqnCBsd6RMkjVDRZzb"
SES_MODELI = os.getenv("JARVIS_SES_MODELI", "").strip() or "eleven_v3_conversational"
YEDEK_SES_MODELI = "eleven_flash_v2_5"
SOHBET_MODELI = os.getenv("JARVIS_SOHBET_MODELI", "").strip() or "claude-opus-5-5"
SOHBET_EFOR = os.getenv("JARVIS_SOHBET_EFOR", "").strip() or "low"  # akıcılık için düşük; zor sorular derin_dusun'a gider
DUSUNME_MODELI = "claude-opus-5-5"
KULAKLIK = os.getenv("JARVIS_KULAKLIK", "hayir").strip().lower() in ("evet", "1", "true", "yes")
UYANDIRMA_ESIGI = float(os.getenv("JARVIS_UYANDIRMA_ESIGI", "0.5"))
KISAYOL = os.getenv("JARVIS_KISAYOL", "").strip() or "ctrl+alt+j"
AZAMI_KAYIT_DK = int(os.getenv("JARVIS_AZAMI_KAYIT_DK", "120"))

DURUM_DOSYASI = KLASOR / "durum" / "jarvis.json"
HAFIZA_DOSYASI = KLASOR / "durum" / "hafiza.json"
NOT_KLASORU = KLASOR / "notlar"

ORNEKLEME = 16000
PARCA = 1280  # 80 ms — uyandırma modelinin beklediği parça boyu

logging.basicConfig(level=logging.WARNING, format="%(message)s")
log = logging.getLogger("jarvis")


def yaz(simge, metin):
    print(f"{datetime.datetime.now():%H:%M:%S} {simge} {metin}", flush=True)


# ---------------- Kişilik ----------------
SISTEM_PROMPTU = """Sen JARVIS'sin: {{kullanici_adi}} için çalışan, zeki, sakin, nazik ve hafif esprili kişisel sesli asistan. Iron Man'deki JARVIS gibi düşün: kısa, net, güven veren; gerektiğinde ince bir espri.

Konuşma kuralları:
- Her zaman Türkçe konuş (kullanıcı başka dilde konuşursa o dilde devam et).
- Bu bir SESLİ konuşma: madde işareti, başlık, emoji, tablo, kod bloğu, link kullanma. Doğal, akıcı cümleler kur.
- Kısa tut: çoğu cevap 1-3 cümle. Kullanıcı ayrıntı isterse uzat.
- Sohbeti canlı tut: uygun yerde kısa bir soru sor, kullanıcıyı gerçekten anlamaya çalış. Her cevabın sonunda soru sorma; sadece işe yarayacaksa sor.
- Kullanıcı uzun bir şey anlatırsa önce bir iki cümleyle özetle ("Yani şunu diyorsun…"), sonra eksik ya da belirsiz noktayı sor.
- Bilmediğin şeyi uydurma; emin değilsen söyle.
- Sayıları ve saatleri okunduğu gibi yaz ("on dört otuz", "yüzde yirmi").

Araçların:
- derin_dusun: Plan, strateji, hesap, karşılaştırma, kod, hukuk/finans, çok adımlı ya da ciddi düşünme isteyen her soruda kullan. Kullanmadan önce kısaca "Bir saniye, düşüneyim" gibi bir şey söyle. Gelen cevabı olduğu gibi okuma; konuşma diline çevirip kısaca anlat.
- dinleme_moduna_gec: Kullanıcı "beni dinle", "toplantıyı dinle", "not al", "kaydet", "sonra özetle" gibi bir şey isterse kullan. Önce "Tamam, dinliyorum. Bitince 'Hey Jarvis' de." de, sonra aracı çağır.
- end_call: Kullanıcı vedalaşırsa ("görüşürüz", "teşekkürler, bu kadar", "kapat", "sağ ol Jarvis") kısa bir vedadan sonra kullan.

Şu an: {{simdi}}

Kullanıcı hakkında önceki konuşmalardan hatırladıkların (boşsa henüz yok):
{{hafiza}}

Bu konuşmanın ek bağlamı (boşsa yok):
{{baglam}}"""

ACILIS_CUMLELERI = ["Efendim?", "Buyurun, dinliyorum.", "Sizi dinliyorum.", "Evet, buradayım."]


def ajan_ayarlari(ses_modeli):
    """ElevenLabs'teki asistanın tam ayarı. Değişirse asistan otomatik güncellenir."""
    conversation_config = {
        "agent": {
            "first_message": "Efendim?",
            "language": "tr",
            "dynamic_variables": {"dynamic_variable_placeholders": {
                "kullanici_adi": "kullanıcı", "simdi": "", "hafiza": "", "baglam": ""}},
            "prompt": {
                "prompt": SISTEM_PROMPTU,
                "llm": SOHBET_MODELI,
                "reasoning_effort": SOHBET_EFOR,
                "built_in_tools": {
                    "end_call": {
                        "type": "system", "name": "end_call",
                        "description": "Kullanıcı vedalaştığında ya da konuşmayı bitirmek istediğinde konuşmayı kapatır.",
                        "params": {"system_tool_type": "end_call"},
                    },
                },
                "tools": [
                    {
                        "type": "client", "name": "derin_dusun",
                        "description": "Zor, çok adımlı ya da ciddi düşünme gerektiren bir soruyu güçlü modele düşündürür ve cevabını döndürür.",
                        "expects_response": True, "response_timeout_secs": 120,
                        "force_pre_tool_speech": True,
                        "parameters": {
                            "type": "object",
                            "properties": {"soru": {
                                "type": "string",
                                "description": "Düşünülecek soru; kullanıcının ne istediğini ve konuşmadaki gerekli ayrıntıları eksiksiz içersin."}},
                            "required": ["soru"],
                        },
                    },
                    {
                        "type": "client", "name": "dinleme_moduna_gec",
                        "description": "Kullanıcı uzun süre dinlenmek istediğinde (toplantı, not, anlatım) konuşmayı kapatıp sessizce kaydetmeye başlar.",
                        "expects_response": False,
                        "parameters": {"type": "object", "properties": {"konu": {
                            "type": "string", "description": "Ne dinleneceği, biliniyorsa (ör. 'haftalık satış toplantısı')."}}},
                    },
                ],
            },
        },
        "tts": {"model_id": ses_modeli, "voice_id": SES_ID},
        "turn": {"turn_eagerness": "normal", "silence_end_call_timeout": 45},
    }
    platform_settings = {"overrides": {"conversation_config_override": {"agent": {"first_message": True}}}}
    return conversation_config, platform_settings


# ---------------- Durum / hafıza ----------------
def json_oku(yol, varsayilan):
    try:
        return json.loads(Path(yol).read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError):
        return varsayilan


def json_yaz(yol, veri):
    Path(yol).parent.mkdir(parents=True, exist_ok=True)
    Path(yol).write_text(json.dumps(veri, ensure_ascii=False, indent=2), encoding="utf-8")


def hafiza_metni():
    notlar = json_oku(HAFIZA_DOSYASI, [])
    return "\n".join(f"- ({n['tarih']}) {n['not']}" for n in notlar[-15:])


def hafizaya_ekle(not_metni):
    notlar = json_oku(HAFIZA_DOSYASI, [])
    notlar.append({"tarih": f"{datetime.date.today():%d.%m.%Y}", "not": not_metni})
    json_yaz(HAFIZA_DOSYASI, notlar[-40:])


def simdi_metni():
    gunler = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"]
    aylar = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos",
             "Eylül", "Ekim", "Kasım", "Aralık"]
    s = datetime.datetime.now()
    return f"{s.day} {aylar[s.month - 1]} {s.year}, {gunler[s.weekday()]}, saat {s:%H:%M}"


# ---------------- ElevenLabs asistanı ----------------
eleven = None
claude = None


def ajani_hazirla():
    """Asistanı ilk açılışta oluşturur; ayarlar değiştiyse günceller. Kimliği durum dosyasında tutar."""
    durum = json_oku(DURUM_DOSYASI, {})
    ses_modeli = durum.get("ses_modeli") or SES_MODELI
    if os.getenv("JARVIS_SES_MODELI", "").strip() and ses_modeli != SES_MODELI:
        ses_modeli = SES_MODELI  # kullanıcı .env'de özellikle seçtiyse onu dene
    for model in dict.fromkeys([ses_modeli, YEDEK_SES_MODELI]):
        cc, ps = ajan_ayarlari(model)
        imza = hashlib.sha256(json.dumps([cc, ps], sort_keys=True).encode()).hexdigest()
        try:
            if durum.get("agent_id") and durum.get("imza") == imza:
                return durum["agent_id"]
            if durum.get("agent_id"):
                eleven.conversational_ai.agents.update(
                    durum["agent_id"], conversation_config=cc, platform_settings=ps, name="JARVIS")
                yaz("🔧", "Asistan ayarları güncellendi.")
                agent_id = durum["agent_id"]
            else:
                agent_id = eleven.conversational_ai.agents.create(
                    conversation_config=cc, platform_settings=ps, name="JARVIS", tags=["jarvis"]).agent_id
                yaz("✨", "ElevenLabs'te JARVIS asistanı oluşturuldu.")
            durum.update({"agent_id": agent_id, "imza": imza, "ses_modeli": model})
            json_yaz(DURUM_DOSYASI, durum)
            return agent_id
        except Exception as e:  # ses modeli bu hesapta/dilde desteklenmiyorsa yedeğe geç
            if model == YEDEK_SES_MODELI:
                raise
            yaz("⚠️", f"{model} ses modeli kabul edilmedi ({kisa_hata(e)}); {YEDEK_SES_MODELI} deneniyor.")


def kisa_hata(e):
    govde = getattr(e, "body", None)
    return str(govde or e)[:300]


class JarvisSesArayuzu(DefaultAudioInterface):
    """ElevenLabs'in varsayılan ses arayüzü + iki iyileştirme:
    - Kulaklık yoksa Jarvis konuşurken mikrofona sessizlik gönderilir; hoparlörden çıkan
      kendi sesini kullanıcı sanıp kendi sözünü kesmez. (Kulaklıkla JARVIS_KULAKLIK=evet:
      konuşurken sözünü kesebilirsiniz.)
    - Konuşma kapanırken son cümle (veda) yarıda kesilmeden çalınır."""

    def start(self, input_callback):
        self._son_cikis = 0.0
        super().start(input_callback)

    def _output_thread(self):
        while not self.should_stop.is_set():
            try:
                ses = self.output_queue.get(timeout=0.25)
                self._son_cikis = time.time() + len(ses) / 32000  # 16 kHz, 16 bit
                self.out_stream.write(ses)
            except queue.Empty:
                pass

    def _in_callback(self, in_data, frame_count, time_info, status):
        if self.input_callback:
            if not KULAKLIK and time.time() < self._son_cikis + 0.35:
                in_data = b"\x00" * len(in_data)
            self.input_callback(in_data)
        return (None, self.pyaudio.paContinue)

    def stop(self):
        bitis = time.time() + 6
        while not self.output_queue.empty() and time.time() < bitis:
            time.sleep(0.1)
        super().stop()


# ---------------- Claude ----------------
def claude_stream(**kw):
    """Claude Opus 5.5 çağrısı: akış (zaman aşımına karşı) + reddedilirse sunucu tarafı yedek model."""
    with claude.beta.messages.stream(
        model=DUSUNME_MODELI,
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        **kw,
    ) as akis:
        mesaj = akis.get_final_message()
    if mesaj.stop_reason == "refusal":
        raise RuntimeError("Claude bu isteği yanıtlamayı reddetti.")
    return "".join(b.text for b in mesaj.content if b.type == "text").strip()


def derin_dusun(soru, gecmis):
    son = "\n".join(gecmis[-30:])
    return claude_stream(
        max_tokens=16000,
        thinking={"type": "adaptive"},
        output_config={"effort": "high"},
        system=("Sen bir sesli asistanın arka plandaki düşünme motorusun. Soruyu dikkatle düşün ve en doğru, "
                "uygulanabilir cevabı ver. Cevap sesli okunacak: madde işareti, başlık, tablo, emoji kullanma; "
                "akıcı Türkçe paragraflarla yaz. Gereksiz uzatma; önemli olan doğruluk ve netlik."),
        messages=[{"role": "user", "content":
                   f"Konuşmanın son kısmı:\n{son or '(yok)'}\n\nDüşünülecek soru:\n{soru}\n\n"
                   f"Kullanıcı hakkında bilinenler:\n{hafiza_metni() or '(yok)'}\n\nŞu an: {simdi_metni()}"}],
    )


def konusmadan_not_cikar(gecmis):
    if sum(1 for s in gecmis if s.startswith("Kullanıcı:")) < 2:
        return
    try:
        not_metni = claude_stream(
            max_tokens=2000,
            output_config={"effort": "low"},
            system=("Bir sesli asistanın uzun süreli hafızasını tutuyorsun. Konuşmadan, ileride işe yarayacak "
                    "kalıcı bilgileri (kullanıcının işi, tercihleri, planları, verdiği kararlar, takip edilecek "
                    "konular) ve konuşmanın konusunu tek bir kısa paragrafta (en çok 2 cümle) yaz. Kayda değer "
                    "bir şey yoksa sadece BOŞ yaz."),
            messages=[{"role": "user", "content": "\n".join(gecmis[-60:])}],
        )
        if not_metni and not_metni.upper() != "BOŞ":
            hafizaya_ekle(not_metni)
    except Exception as e:
        log.warning("Hafıza notu çıkarılamadı: %s", kisa_hata(e))


OZET_SEMASI = {
    "type": "object",
    "properties": {
        "sesli_ozet": {"type": "string", "description": "Sesli okunacak özet: 4-7 doğal cümle, liste yok."},
        "sorular": {"type": "array", "items": {"type": "string"},
                    "description": "Eksik, belirsiz ya da karar gerektiren noktalar için 2-3 kısa soru."},
        "notlar": {"type": "string", "description": "Ayrıntılı yazılı notlar (Markdown): ana konular, kararlar, "
                                                     "yapılacaklar (kim/ne/ne zaman), açık konular."},
    },
    "required": ["sesli_ozet", "sorular", "notlar"],
    "additionalProperties": False,
}


def ozetle(yazi, konu):
    metin = claude_stream(
        max_tokens=32000,
        thinking={"type": "adaptive"},
        output_config={"effort": "high", "format": {"type": "json_schema", "schema": OZET_SEMASI}},
        system=("Bir sesli asistan için kayıt özetliyorsun. Kayıt bir toplantı, telefon görüşmesi ya da "
                "kullanıcının kendi anlatımı olabilir. Konuşmacı etiketleri otomatik tahmindir. Konuşulanları "
                "sadakatle özetle, uydurma. Sesli özet doğal Türkçe ile, sanki kullanıcıya anlatıyormuş gibi olsun."),
        messages=[{"role": "user", "content":
                   f"Konu (biliniyorsa): {konu or '-'}\nTarih: {simdi_metni()}\n\nKaydın yazıya dökümü:\n{yazi}"}],
    )
    return json.loads(metin)


# ---------------- Mikrofon: uyandırma kelimesi + kayıt ----------------
class Kulak:
    """Mikrofonu dinler: "Hey Jarvis" ya da kısayol gelince döner. kayit=True ise sesi de biriktirir."""

    def __init__(self):
        from openwakeword.model import Model
        from openwakeword.utils import download_models
        try:
            self.model = Model(wakeword_models=["hey_jarvis"], inference_framework="onnx")
        except Exception:
            yaz("⬇️", "Uyandırma kelimesi modeli indiriliyor (yalnızca ilk sefer)…")
            download_models(["hey_jarvis"])
            self.model = Model(wakeword_models=["hey_jarvis"], inference_framework="onnx")
        self.pa = pyaudio.PyAudio()
        self.kisayol = threading.Event()

    def bekle(self, kayit=False, azami_sn=None):
        """Uyandırma ya da kısayol gelene kadar bekler. Kayıt modunda biriken sesi (bytes) döner."""
        self.model.reset()
        self.kisayol.clear()
        akis = self.pa.open(format=pyaudio.paInt16, channels=1, rate=ORNEKLEME, input=True,
                            frames_per_buffer=PARCA)
        biriken = []
        basla = time.time()
        sessiz_bekle = time.time() + 1.0  # açılıştaki tıkırtı/yankı tetiklemesin
        try:
            while True:
                if self.kisayol.is_set():
                    break
                if azami_sn and time.time() - basla > azami_sn:
                    yaz("⏱️", "Azami kayıt süresi doldu.")
                    break
                veri = akis.read(PARCA, exception_on_overflow=False)
                if kayit:
                    biriken.append(veri)
                puan = max(self.model.predict(np.frombuffer(veri, dtype=np.int16)).values())
                if puan >= UYANDIRMA_ESIGI and time.time() > sessiz_bekle:
                    break
        finally:
            akis.stop_stream()
            akis.close()
        if kayit:  # "Hey Jarvis" sözcüğünü kayıttan çıkar (~1,5 sn)
            biriken = biriken[:-19] if len(biriken) > 19 else biriken
        return b"".join(biriken)


# ---------------- Konuşma ----------------
def sohbet_et(acilis=None, baglam=""):
    """Bir canlı konuşma yürütür. Dönüş: {"dinle": bool, "konu": str}"""
    agent_id = ajani_hazirla()
    gecmis, sonuc = [], {"dinle": False, "konu": ""}
    bitti = threading.Event()
    konusma = None

    araclar = ClientTools()

    def arac_derin_dusun(p):
        soru = (p.get("soru") or "").strip()
        yaz("🧠", f"Derin düşünüyor: {soru[:120]}")
        try:
            cevap = derin_dusun(soru, gecmis)
        except Exception as e:
            return f"Düşünme motoruna ulaşılamadı: {kisa_hata(e)}. Kullanıcıya kısaca söyle."
        gecmis.append(f"(Düşünme sonucu: {cevap})")
        return cevap

    def arac_dinle(p):
        sonuc.update(dinle=True, konu=(p.get("konu") or "").strip())
        # Asistanın "dinliyorum" cümlesi bitsin, sonra konuşmayı kapat
        threading.Timer(4.0, lambda: konusma and konusma.end_session()).start()
        return "Dinleme modu açılıyor."

    araclar.register("derin_dusun", arac_derin_dusun)
    araclar.register("dinleme_moduna_gec", arac_dinle)

    def kullanici_dedi(metin):
        gecmis.append(f"Kullanıcı: {metin}")
        yaz("🗣️", metin)

    def jarvis_dedi(metin):
        gecmis.append(f"Jarvis: {metin}")
        yaz("🤖", metin)

    ayar = ConversationInitiationData(
        dynamic_variables={
            "kullanici_adi": KULLANICI_ADI or "kullanıcı",
            "simdi": simdi_metni(),
            "hafiza": hafiza_metni() or "(henüz yok)",
            "baglam": baglam or "(yok)",
        },
        conversation_config_override={"agent": {"first_message": acilis or random.choice(ACILIS_CUMLELERI)}},
    )
    konusma = Conversation(
        eleven, agent_id, requires_auth=True,
        audio_interface=JarvisSesArayuzu(),
        config=ayar,
        client_tools=araclar,
        callback_user_transcript=kullanici_dedi,
        callback_agent_response=jarvis_dedi,
        callback_end_session=bitti.set,
    )
    yaz("🎙️", "Konuşma açık. (Kapatmak için 'görüşürüz' deyin ya da kısayola basın.)")
    konusma.start_session()
    while not bitti.is_set():
        if konusma._thread is not None and not konusma._thread.is_alive():
            break  # bağlantı kurulamadı ya da koptu
        if KULAK.kisayol.is_set():
            KULAK.kisayol.clear()
            konusma.end_session()
        bitti.wait(0.2)
    try:
        konusma.wait_for_session_end()
    except Exception:
        pass
    yaz("💤", "Konuşma kapandı.")
    threading.Thread(target=konusmadan_not_cikar, args=(list(gecmis),), daemon=True).start()
    return sonuc


def wav_yaz(yol, ses):
    yol.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(yol), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(ORNEKLEME)
        w.writeframes(ses)


def yaziya_dok(yol):
    with open(yol, "rb") as f:
        r = eleven.speech_to_text.convert(file=f, model_id="scribe_v2", language_code="tr", diarize=True)
    # Konuşmacılara göre satırlara böl (konuşmacı bilgisi yoksa düz metin)
    satirlar, kim, parca = [], None, []
    for k in getattr(r, "words", None) or []:
        if getattr(k, "type", "word") == "audio_event":
            continue
        sp = getattr(k, "speaker_id", None)
        if sp != kim and parca:
            satirlar.append(f"{kim or 'Konuşmacı'}: {''.join(parca).strip()}")
            parca = []
        kim = sp
        parca.append(k.text)
    if parca:
        satirlar.append(f"{kim or 'Konuşmacı'}: {''.join(parca).strip()}")
    return "\n".join(satirlar) if len(satirlar) > 1 else (r.text or "").strip()


def dinle_ve_ozetle(konu):
    yaz("🔴", f"Dinliyorum{f' ({konu})' if konu else ''}. Bitince 'Hey Jarvis' deyin ya da {KISAYOL} basın.")
    ses = KULAK.bekle(kayit=True, azami_sn=AZAMI_KAYIT_DK * 60)
    sure_dk = len(ses) / (ORNEKLEME * 2) / 60
    if sure_dk < 0.1:
        return sohbet_et(acilis="Bir şey duyamadım. Tekrar denemek ister misin?")
    damga = f"{datetime.datetime.now():%Y-%m-%d_%H-%M}"
    wav = NOT_KLASORU / f"{damga}.wav"
    wav_yaz(wav, ses)
    yaz("📝", f"{sure_dk:.1f} dk kayıt alındı, yazıya dökülüyor…")
    try:
        yazi = yaziya_dok(wav)
        if not yazi:
            return sohbet_et(acilis="Kayıtta anlaşılır bir konuşma bulamadım. Tekrar dener miyiz?")
        yaz("🧠", "Özetleniyor…")
        oz = ozetle(yazi, konu)
    except Exception as e:
        yaz("❌", f"Özet çıkarılamadı: {kisa_hata(e)}")
        return sohbet_et(acilis="Kaydı aldım ama özetlerken bir sorun çıktı. Ses dosyası notlar klasöründe duruyor.")
    md = NOT_KLASORU / f"{damga}.md"
    md.write_text(f"# {konu or 'Kayıt'} — {simdi_metni()}\n\n## Özet\n\n{oz['sesli_ozet']}\n\n"
                  f"## Notlar\n\n{oz['notlar']}\n\n## Sorular\n\n" + "\n".join(f"- {s}" for s in oz["sorular"])
                  + f"\n\n## Yazı dökümü\n\n{yazi}\n", encoding="utf-8")
    yaz("💾", f"Notlar kaydedildi: {md}")
    hafizaya_ekle(f"Kayıt özeti ({konu or 'kayıt'}): {oz['sesli_ozet'][:400]}")
    acilis = "Dinledim, kısaca özetliyorum. " + oz["sesli_ozet"]
    if oz["sorular"]:
        acilis += " Bir de şunu sormak istiyorum: " + oz["sorular"][0]
    baglam = (f"Kullanıcıyı az önce dinledin ve şu kaydı özetledin. Özet ve notlar:\n{oz['notlar']}\n\n"
              f"Sormak istediğin diğer sorular: {' / '.join(oz['sorular'][1:]) or '-'}\n\n"
              f"Kaydın yazı dökümünün başı:\n{yazi[:6000]}")
    return sohbet_et(acilis=acilis, baglam=baglam)


# ---------------- Ana döngü ----------------
KULAK = None


def kontrol():
    eksik = [ad for ad, d in (("ELEVENLABS_API_KEY", ELEVEN_KEY), ("ANTHROPIC_API_KEY", CLAUDE_KEY)) if not d]
    if eksik:
        print(f"❌ .env dosyasında eksik: {', '.join(eksik)}. .env.ornek dosyasını .env olarak kopyalayıp doldurun.")
        sys.exit(1)


def main():
    global eleven, claude, KULAK
    kontrol()
    eleven = ElevenLabs(api_key=ELEVEN_KEY)
    claude = anthropic.Anthropic(api_key=CLAUDE_KEY)
    try:
        ajani_hazirla()
    except Exception as e:
        print(f"❌ ElevenLabs asistanı hazırlanamadı: {kisa_hata(e)}")
        sys.exit(1)
    KULAK = Kulak()
    try:
        import keyboard
        keyboard.add_hotkey(KISAYOL, KULAK.kisayol.set)
    except Exception as e:
        yaz("⚠️", f"Kısayol ({KISAYOL}) kurulamadı: {e}. Yalnızca 'Hey Jarvis' ile çalışır.")

    print("\n  J.A.R.V.I.S. hazır.\n"
          f"  Uyandırmak için 'Hey Jarvis' deyin ya da {KISAYOL} basın.\n"
          f"  Mod: {'kulaklık (sözünü kesebilirsiniz)' if KULAKLIK else 'hoparlör (Jarvis konuşurken mikrofon susar)'}\n"
          "  Kapatmak için bu pencerede Ctrl+C.\n", flush=True)

    while True:
        KULAK.bekle()
        yaz("⚡", "Uyandı.")
        try:
            sonuc = sohbet_et()
            while sonuc.get("dinle"):
                sonuc = dinle_ve_ozetle(sonuc.get("konu", ""))
        except KeyboardInterrupt:
            raise
        except Exception as e:
            yaz("❌", f"Hata: {kisa_hata(e)} — tekrar uyandırabilirsiniz.")
            time.sleep(1)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nGörüşürüz! 👋")
