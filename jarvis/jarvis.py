"""JARVIS — Windows için sesli asistan.

Akış:
  1. Arka planda "Hey Jarvis" uyandırma kelimesini (ya da Ctrl+Alt+J kısayolunu) bekler.
     Uyandırma kelimesi bilgisayarda çalışır, internete ses gitmez.
  2. Uyanınca ElevenLabs'in canlı sesli asistanıyla konuşma başlar: sizi dinler, sözünü
     kesebilirsiniz, gerçekçi sesle cevap verir. Beyin: Claude.
  3. Zor ya da güncel bilgi isteyen sorularda "derin_dusun" ile kendi Claude anahtarınızla
     (gerekirse internette arayarak) uzun uzun düşünür.
  4. Bilgisayarda iş yapar: uygulama/site açar, ekrana bakar, panodaki metni okur, hatırlatır.
  5. "Beni dinle" / "toplantıyı dinle" derseniz susar ve kaydeder (mikrofon + bilgisayarın
     sesi, yani Teams/Zoom'daki karşı taraf da); "Hey Jarvis" deyince yazıya döker, Claude
     ile özetler, özeti sesli anlatır ve sorular sorar. Notlar "notlar" klasörüne kaydedilir.
  6. Her konuşmadan kısa bir not çıkarır ve sonraki konuşmalarda hatırlar.
"""
import datetime
import hashlib
import json
import logging
import os
import queue
import random
import socket
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

import araclar

KLASOR = Path(__file__).resolve().parent
load_dotenv(KLASOR / ".env")

# ---------------- Ayarlar (.env) ----------------
ELEVEN_KEY = os.getenv("ELEVENLABS_API_KEY", "").strip()
CLAUDE_KEY = os.getenv("ANTHROPIC_API_KEY", "").strip()
KULLANICI_ADI = os.getenv("JARVIS_KULLANICI_ADI", "").strip()
# Varsayılan ses: "George" (ElevenLabs hazır sesi, tok ve sakin erkek sesi; Türkçe konuşur)
SES_ID = os.getenv("JARVIS_SES_ID", "").strip() or "JBFqnCBsd6RMkjVDRZzb"
SES_MODELI = os.getenv("JARVIS_SES_MODELI", "").strip() or "eleven_v3_conversational"
YEDEK_SES_MODELI = "eleven_flash_v2_5"
SOHBET_MODELI = os.getenv("JARVIS_SOHBET_MODELI", "").strip() or "claude-opus-5-5"
SOHBET_EFOR = os.getenv("JARVIS_SOHBET_EFOR", "").strip() or "low"  # akıcılık için düşük; zor sorular derin_dusun'a gider
DUSUNME_MODELI = "claude-opus-5-5"
KULAKLIK = os.getenv("JARVIS_KULAKLIK", "hayir").strip().lower() in ("evet", "1", "true", "yes")
SOZ_KESME_ESIGI = int(os.getenv("JARVIS_SOZ_KESME_ESIGI", "2500"))
UYANDIRMA_ESIGI = float(os.getenv("JARVIS_UYANDIRMA_ESIGI", "0.6"))
KISAYOL = os.getenv("JARVIS_KISAYOL", "").strip() or "ctrl+alt+j"
AZAMI_KAYIT_DK = int(os.getenv("JARVIS_AZAMI_KAYIT_DK", "120"))
BILGISAYAR_SESI = os.getenv("JARVIS_BILGISAYAR_SESINI_KAYDET", "evet").strip().lower() in ("evet", "1", "true", "yes")

DURUM_DOSYASI = KLASOR / "durum" / "jarvis.json"
HAFIZA_DOSYASI = KLASOR / "hafiza.md"  # Not Defteri ile açıp düzeltebilirsiniz
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
- Sayıları, tarihleri, saatleri, para birimlerini ve kısaltmaları yazıyla yaz ki doğru okunsun: "bin iki yüz elli lira", "on dört Ekim", "saat on dört otuz", "yüzde yirmi".
- Kısa tut: çoğu cevap 1-3 cümle. Kullanıcı ayrıntı isterse uzat.
- Sohbeti canlı tut: uygun yerde kısa bir soru sor, kullanıcıyı gerçekten anlamaya çalış. Her cevabın sonunda soru sorma; sadece işe yarayacaksa sor.
- Kullanıcı uzun bir şey anlatırsa önce bir iki cümleyle özetle ("Yani şunu diyorsun…"), sonra eksik ya da belirsiz noktayı sor.
- Bilmediğin şeyi uydurma; emin değilsen söyle ya da derin_dusun ile araştır.

Araçların:
- derin_dusun: Plan, strateji, hesap, karşılaştırma, kod, hukuk/finans, çok adımlı sorular ve GÜNCEL bilgi (haber, fiyat, kur, hava, sonuçlar) gerektiren her soruda kullan; gerekirse internette arar. Kullanmadan önce kısaca "Bir saniye, bakayım" gibi bir şey söyle. Gelen cevabı olduğu gibi okuma; konuşma diline çevirip kısaca anlat.
- uygulama_ac, web_ac: Bilgisayarda uygulama ya da site açmak için.
- ekrana_bak: Kullanıcı ekrandaki bir şeyi sorarsa ("ekrana bak", "bu hata ne diyor").
- panoyu_oku: Kullanıcı "kopyaladığım metni…" derse.
- hatirlat: "Yirmi dakika sonra hatırlat" gibi isteklerde.
- hafizada_ara: Geçmiş konuşmalar ya da kaydedilmiş toplantılar sorulursa.
- hafizaya_kaydet: Kullanıcı "bunu hatırla", "unutma", "not et" derse ya da kendisi hakkında kalıcı bir bilgi verirse (ör. "eşimin doğum günü 3 Mart").
- dinleme_moduna_gec: Kullanıcı "beni dinle", "toplantıyı dinle", "not al", "kaydet", "sonra özetle" gibi bir şey isterse. Önce "Tamam, dinliyorum. Bitince 'Hey Jarvis' de." de, sonra aracı çağır.
- end_call: Kullanıcı vedalaşırsa ("görüşürüz", "teşekkürler, bu kadar", "kapat", "sağ ol Jarvis") kısa bir vedadan sonra kullan.

Şu an: {{simdi}}

Kullanıcı hakkında önceki konuşmalardan hatırladıkların (boşsa henüz yok):
{{hafiza}}

Bu konuşmanın ek bağlamı (boşsa yok):
{{baglam}}"""

ACILIS_CUMLELERI = ["Efendim?", "Buyurun, dinliyorum.", "Sizi dinliyorum.", "Evet, buradayım."]


def ajan_ayarlari(ses_modeli):
    """ElevenLabs'teki asistanın tam ayarı. Değişirse asistan otomatik güncellenir."""
    tts = {"model_id": ses_modeli, "voice_id": SES_ID}
    if ses_modeli == "eleven_v3_conversational":
        tts["expressive_mode"] = True  # gülme, iç çekme gibi doğal tonlamalar
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
                        "description": "Zor, çok adımlı, ciddi düşünme ya da güncel bilgi (internet araması) gerektiren "
                                       "bir soruyu güçlü modele düşündürür ve cevabını döndürür.",
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
                ] + [tanim for tanim, _ in araclar.ARACLAR],
            },
        },
        "tts": tts,
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


HAFIZA_BASLIGI = ("# JARVIS'in hafızası\n\n"
                  "Her satır bir not. Yanlış olanı silebilir, düzeltebilir ya da kendiniz ekleyebilirsiniz.\n\n")


def hafiza_notlari():
    try:
        satirlar = HAFIZA_DOSYASI.read_text(encoding="utf-8").splitlines()
    except FileNotFoundError:
        return []
    notlar = []
    for s in satirlar:
        if s.startswith("- "):
            tarih, _, metin = s[2:].partition(") ")
            if tarih.startswith("(") and metin:
                notlar.append({"tarih": tarih[1:], "not": metin.strip()})
            else:
                notlar.append({"tarih": "", "not": s[2:].strip()})
    return notlar


def hafiza_metni():
    return "\n".join(f"- ({n['tarih']}) {n['not']}" for n in hafiza_notlari()[-25:])


_hafiza_kilidi = threading.Lock()


def hafizaya_ekle(not_metni):
    satir = " ".join((not_metni or "").split())
    if not satir:
        return
    with _hafiza_kilidi:
        if not HAFIZA_DOSYASI.exists():
            HAFIZA_DOSYASI.write_text(HAFIZA_BASLIGI, encoding="utf-8")
        with open(HAFIZA_DOSYASI, "a", encoding="utf-8") as f:
            f.write(f"- ({datetime.date.today():%d.%m.%Y}) {satir}\n")


def simdi_metni():
    gunler = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"]
    aylar = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos",
             "Eylül", "Ekim", "Kasım", "Aralık"]
    s = datetime.datetime.now()
    return f"{s.day} {aylar[s.month - 1]} {s.year}, {gunler[s.weekday()]}, saat {s:%H:%M}"


def kisa_hata(e):
    govde = getattr(e, "body", None)
    return str(govde or e)[:300]


# ---------------- ElevenLabs asistanı ----------------
eleven = None
claude = None
aktif_konusma = None  # şu an açık Conversation (yoksa None)


def ajani_hazirla():
    """Asistanı ilk açılışta oluşturur; ayarlar değiştiyse günceller. Kimliği durum dosyasında tutar."""
    durum = json_oku(DURUM_DOSYASI, {})
    ses_modeli = SES_MODELI if os.getenv("JARVIS_SES_MODELI", "").strip() else (durum.get("ses_modeli") or SES_MODELI)
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


class JarvisSesArayuzu(DefaultAudioInterface):
    """ElevenLabs'in varsayılan ses arayüzü + yankı koruması:
    Hoparlörde Jarvis kendi sesini duyup kendi sözünü kesebilir (Windows'ta Python'da yankı
    giderme yok). Jarvis konuşurken mikrofon sesi, yalnızca hoparlör yankısından belirgin
    şekilde yüksekse (siz araya girdiğinizde) gönderilir; değilse sessizlik gider.
    Kulaklıkla (JARVIS_KULAKLIK=evet) bu koruma kapalıdır.
    Ayrıca konuşma kapanırken son cümle (veda) yarıda kesilmeden çalınır."""

    def start(self, input_callback):
        self._son_cikis = 0.0
        self._eko = 300.0  # Jarvis konuşurken mikrofona gelen yankının tahmini seviyesi (RMS)
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
            if not KULAKLIK and time.time() < self._son_cikis + 0.3:
                rms = float(np.sqrt(np.mean(np.frombuffer(in_data, dtype=np.int16).astype(np.float32) ** 2)))
                if rms > max(SOZ_KESME_ESIGI, 3.0 * self._eko):
                    pass  # yüksek ses: kullanıcı araya giriyor, olduğu gibi gönder
                else:
                    self._eko = 0.9 * self._eko + 0.1 * rms
                    in_data = b"\x00" * len(in_data)
            self.input_callback(in_data)
        return (None, self.pyaudio.paContinue)

    def stop(self):
        bitis = time.time() + 6
        while not self.output_queue.empty() and time.time() < bitis:
            time.sleep(0.1)
        super().stop()


def sesli_bildir(metin):
    """Konuşma dışında (ör. hatırlatıcı) Jarvis'in sesiyle kısa bir şey söyler."""
    if aktif_konusma is not None:
        try:
            aktif_konusma.send_contextual_update(f"Şimdi kullanıcıya şunu hatırlat: {metin}")
        except Exception:
            pass
        return
    try:
        ses = b"".join(eleven.text_to_speech.convert(
            SES_ID, text=metin, model_id="eleven_flash_v2_5", language_code="tr", output_format="pcm_16000"))
        pa = pyaudio.PyAudio()
        cikis = pa.open(format=pyaudio.paInt16, channels=1, rate=ORNEKLEME, output=True)
        cikis.write(ses)
        cikis.close()
        pa.terminate()
    except Exception as e:
        log.warning("Sesli bildirim çalınamadı: %s", kisa_hata(e))


# ---------------- Claude ----------------
def claude_cagir(messages, **kw):
    """Claude Opus 5.5: akış (uzun cevaplarda zaman aşımı olmasın), reddedilirse sunucu tarafı
    yedek model, internet araması uzun sürerse (pause_turn) kaldığı yerden devam."""
    messages = list(messages)
    for _ in range(5):
        with claude.beta.messages.stream(
            model=DUSUNME_MODELI,
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            messages=messages,
            **kw,
        ) as akis:
            mesaj = akis.get_final_message()
        if mesaj.stop_reason == "pause_turn":
            messages.append({"role": "assistant", "content": mesaj.content})
            continue
        break
    if mesaj.stop_reason == "refusal":
        raise RuntimeError("Claude bu isteği yanıtlamayı reddetti.")
    return "".join(b.text for b in mesaj.content if b.type == "text").strip()


def derin_dusun(soru, gecmis):
    son = "\n".join(gecmis[-30:])
    return claude_cagir(
        [{"role": "user", "content":
          f"Konuşmanın son kısmı:\n{son or '(yok)'}\n\nDüşünülecek soru:\n{soru}\n\n"
          f"Kullanıcı hakkında bilinenler:\n{hafiza_metni() or '(yok)'}\n\nŞu an: {simdi_metni()} (Türkiye)"}],
        max_tokens=16000,
        thinking={"type": "adaptive"},
        output_config={"effort": "high"},
        tools=[{"type": "web_search_20260209", "name": "web_search", "max_uses": 5}],
        system=("Sen bir sesli asistanın arka plandaki düşünme motorusun. Soruyu dikkatle düşün; güncel bilgi "
                "gerekiyorsa internette ara. En doğru, uygulanabilir cevabı ver. Cevap sesli okunacak: madde işareti, "
                "başlık, tablo, emoji, link kullanma; akıcı Türkçe paragraflarla yaz. Gereksiz uzatma."),
    )


def claude_gorsel(png, soru):
    return claude_cagir(
        [{"role": "user", "content": [
            {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": araclar.b64(png)}},
            {"type": "text", "text": soru}]}],
        max_tokens=8000,
        output_config={"effort": "medium"},
        system=("Kullanıcının bilgisayar ekranının görüntüsüne bakıyorsun. Soruyu ekrandakine göre cevapla. Cevap "
                "sesli okunacak: kısa, akıcı Türkçe; liste ve emoji yok."),
    )


def konusmadan_not_cikar(gecmis):
    if sum(1 for s in gecmis if s.startswith("Kullanıcı:")) < 2:
        return
    try:
        not_metni = claude_cagir(
            [{"role": "user", "content": "\n".join(gecmis[-60:])}],
            max_tokens=2000,
            output_config={"effort": "low"},
            system=("Bir sesli asistanın uzun süreli hafızasını tutuyorsun. Konuşmadan, ileride işe yarayacak "
                    "kalıcı bilgileri (kullanıcının işi, tercihleri, planları, verdiği kararlar, takip edilecek "
                    "konular) ve konuşmanın konusunu tek bir kısa paragrafta (en çok 2 cümle) yaz. Kayda değer "
                    "bir şey yoksa sadece BOŞ yaz."),
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
    metin = claude_cagir(
        [{"role": "user", "content":
          f"Konu (biliniyorsa): {konu or '-'}\nTarih: {simdi_metni()}\n\nKaydın yazıya dökümü:\n{yazi}"}],
        max_tokens=32000,
        thinking={"type": "adaptive"},
        output_config={"effort": "high", "format": {"type": "json_schema", "schema": OZET_SEMASI}},
        system=("Bir sesli asistan için kayıt özetliyorsun. Kayıt bir toplantı, telefon/online görüşme ya da "
                "kullanıcının kendi anlatımı olabilir. Konuşmacı etiketleri otomatik tahmindir. Konuşulanları "
                "sadakatle özetle, uydurma. Sesli özet doğal Türkçe ile, sanki kullanıcıya anlatıyormuş gibi olsun; "
                "sayıları yazıyla yaz."),
    )
    return json.loads(metin)


# ---------------- Bilgisayarın sesini kaydetme (Teams/Zoom'daki karşı taraf) ----------------
class BilgisayarSesi:
    """Windows'ta hoparlöre giden sesi (WASAPI loopback) ayrı bir dosyaya kaydeder.
    Ses çalmadığı anlarda Windows veri göndermez; aradaki boşluk saat ile sessizlikle doldurulur
    ki mikrofon kaydıyla zaman olarak hizalı kalsın."""

    def __init__(self, yol):
        import pyaudiowpatch as pw
        self.pw, self.yol = pw, yol
        self.pa = pw.PyAudio()
        cihaz = self.pa.get_default_wasapi_loopback()
        self.oran, self.kanal = int(cihaz["defaultSampleRate"]), int(cihaz["maxInputChannels"])
        self.dosya = wave.open(str(yol), "wb")
        self.dosya.setnchannels(self.kanal)
        self.dosya.setsampwidth(2)
        self.dosya.setframerate(self.oran)
        self.kilit, self.yazilan, self.dur = threading.Lock(), 0, threading.Event()
        self.basla = time.time()
        self.akis = self.pa.open(format=pw.paInt16, channels=self.kanal, rate=self.oran, input=True,
                                 input_device_index=cihaz["index"], frames_per_buffer=1024,
                                 stream_callback=self._geldi)
        threading.Thread(target=self._bosluk_doldur, daemon=True).start()

    def _geldi(self, veri, n, *_):
        with self.kilit:
            if not self.dur.is_set():
                self.dosya.writeframes(veri)
                self.yazilan += n
        return (None, self.pw.paContinue)

    def _bosluk_doldur(self):
        while not self.dur.wait(0.2):
            with self.kilit:
                eksik = int((time.time() - self.basla) * self.oran) - self.yazilan
                if eksik > self.oran // 4:  # 250 ms'den fazla veri gelmediyse sessizlik ekle
                    self.dosya.writeframes(b"\x00" * eksik * self.kanal * 2)
                    self.yazilan += eksik

    def kapat(self):
        self.dur.set()
        try:
            self.akis.stop_stream()
            self.akis.close()
        finally:
            with self.kilit:
                self.dosya.close()
            self.pa.terminate()
        return self.oran, self.kanal


def sesleri_birlestir(mik_yol, pc_yol, pc_oran, pc_kanal, cikis_yol):
    """Mikrofon (16 kHz mono) + bilgisayar sesini 16 kHz mono tek dosyada birleştirir (10 sn'lik parçalarla)."""
    with wave.open(str(mik_yol), "rb") as m, wave.open(str(pc_yol), "rb") as p, wave.open(str(cikis_yol), "wb") as c:
        c.setnchannels(1)
        c.setsampwidth(2)
        c.setframerate(ORNEKLEME)
        while True:
            mik = np.frombuffer(m.readframes(ORNEKLEME * 10), dtype=np.int16).astype(np.float32)
            ham = np.frombuffer(p.readframes(pc_oran * 10), dtype=np.int16).astype(np.float32)
            if not len(mik) and not len(ham):
                break
            pc = ham.reshape(-1, pc_kanal).mean(axis=1) if len(ham) else ham
            if len(pc):
                hedef = int(round(len(pc) * ORNEKLEME / pc_oran))
                pc = np.interp(np.linspace(0, len(pc) - 1, hedef), np.arange(len(pc)), pc)
            n = max(len(mik), len(pc))
            karisim = np.zeros(n, dtype=np.float32)
            karisim[:len(mik)] += mik
            karisim[:len(pc)] += pc
            c.writeframes(np.clip(karisim, -32768, 32767).astype(np.int16).tobytes())


# ---------------- Mikrofon: uyandırma kelimesi + kayıt ----------------
class Kulak:
    """Mikrofonu dinler: "Hey Jarvis" ya da kısayol gelince döner. kayit_yolu verilirse sesi dosyaya yazar."""

    def __init__(self):
        from openwakeword.model import Model
        from openwakeword.utils import download_models
        ayar = dict(wakeword_models=["hey_jarvis"], inference_framework="onnx", vad_threshold=0.5)
        try:
            self.model = Model(**ayar)
        except Exception:
            yaz("⬇️", "Uyandırma kelimesi modeli indiriliyor (yalnızca ilk sefer)…")
            download_models(["hey_jarvis"])
            self.model = Model(**ayar)
        self.pa = pyaudio.PyAudio()
        self.kisayol = threading.Event()
        self.sakin_kadar = 0.0  # konuşma bitince kısa süre uyanmasın (hoparlör yankısı tetiklemesin)

    def bekle(self, kayit_yolu=None, azami_sn=None):
        self.model.reset()
        self.kisayol.clear()
        akis = self.pa.open(format=pyaudio.paInt16, channels=1, rate=ORNEKLEME, input=True,
                            frames_per_buffer=PARCA)
        dosya = None
        if kayit_yolu:
            dosya = wave.open(str(kayit_yolu), "wb")
            dosya.setnchannels(1)
            dosya.setsampwidth(2)
            dosya.setframerate(ORNEKLEME)
        basla, ust_uste, sebep = time.time(), 0, "kelime"
        sakin = max(self.sakin_kadar, time.time() + 1.0)
        try:
            while True:
                if self.kisayol.is_set():
                    sebep = "kisayol"
                    break
                if azami_sn and time.time() - basla > azami_sn:
                    yaz("⏱️", "Azami kayıt süresi doldu.")
                    sebep = "sure"
                    break
                veri = akis.read(PARCA, exception_on_overflow=False)
                if dosya:
                    dosya.writeframes(veri)
                puan = max(self.model.predict(np.frombuffer(veri, dtype=np.int16)).values())
                # Yanlış uyanmayı azaltmak için arka arkaya iki parçada eşiği geçmeli
                ust_uste = ust_uste + 1 if puan >= UYANDIRMA_ESIGI else 0
                if ust_uste >= 2 and time.time() > sakin:
                    break
        finally:
            akis.stop_stream()
            akis.close()
            if dosya:
                dosya.close()
        return sebep


# ---------------- Konuşma ----------------
def sohbet_et(acilis=None, baglam=""):
    """Bir canlı konuşma yürütür. Dönüş: {"dinle": bool, "konu": str}"""
    global aktif_konusma
    agent_id = ajani_hazirla()
    gecmis, sonuc = [], {"dinle": False, "konu": ""}
    bitti = threading.Event()
    konusma = None

    araclar_ = ClientTools()

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

    def sarmala(ad, fn):
        def calistir(p):
            yaz("🛠️", f"{ad} {({k: v for k, v in p.items() if k != 'tool_call_id'})}")
            try:
                return fn(p)
            except Exception as e:
                return f"{ad} çalışmadı: {kisa_hata(e)}"
        return calistir

    araclar_.register("derin_dusun", arac_derin_dusun)
    araclar_.register("dinleme_moduna_gec", arac_dinle)
    for tanim, fn in araclar.ARACLAR:
        araclar_.register(tanim["name"], sarmala(tanim["name"], fn))

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
        client_tools=araclar_,
        callback_user_transcript=kullanici_dedi,
        callback_agent_response=jarvis_dedi,
        callback_end_session=bitti.set,
    )
    yaz("🎙️", f"Konuşma açık. (Kapatmak için 'görüşürüz' deyin ya da {KISAYOL} basın.)")
    konusma.start_session()
    aktif_konusma = konusma
    try:
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
    finally:
        aktif_konusma = None
        KULAK.sakin_kadar = time.time() + 2.5
    yaz("💤", "Konuşma kapandı.")
    threading.Thread(target=konusmadan_not_cikar, args=(list(gecmis),), daemon=True).start()
    return sonuc


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
    NOT_KLASORU.mkdir(parents=True, exist_ok=True)
    damga = f"{datetime.datetime.now():%Y-%m-%d_%H-%M}"
    mik_yol, pc_yol, kayit = NOT_KLASORU / f"{damga}_mikrofon.wav", NOT_KLASORU / f"{damga}_bilgisayar.wav", None
    pc = None
    if BILGISAYAR_SESI:
        try:
            pc = BilgisayarSesi(pc_yol)
        except Exception as e:
            yaz("⚠️", f"Bilgisayarın sesi kaydedilemiyor ({kisa_hata(e)}); yalnızca mikrofon kaydediliyor.")
    yaz("🔴", f"Dinliyorum{f' ({konu})' if konu else ''}. Bitince 'Hey Jarvis' deyin ya da {KISAYOL} basın.")
    try:
        KULAK.bekle(kayit_yolu=mik_yol, azami_sn=AZAMI_KAYIT_DK * 60)
    finally:
        pc_bilgi = pc.kapat() if pc else None
    if pc_bilgi:
        kayit = NOT_KLASORU / f"{damga}.wav"
        sesleri_birlestir(mik_yol, pc_yol, *pc_bilgi, kayit)
        mik_yol.unlink(missing_ok=True)
        pc_yol.unlink(missing_ok=True)
    else:
        kayit = mik_yol.rename(NOT_KLASORU / f"{damga}.wav")
    with wave.open(str(kayit), "rb") as w:
        sure_dk = w.getnframes() / ORNEKLEME / 60
    if sure_dk < 0.1:
        return sohbet_et(acilis="Bir şey duyamadım. Tekrar denemek ister misin?")
    yaz("📝", f"{sure_dk:.1f} dk kayıt alındı, yazıya dökülüyor…")
    try:
        yazi = yaziya_dok(kayit)
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
    hafizaya_ekle(f"Kayıt özeti ({konu or 'kayıt'}, notlar/{md.name}): {oz['sesli_ozet'][:400]}")
    acilis = "Dinledim, kısaca özetliyorum. " + oz["sesli_ozet"]
    if oz["sorular"]:
        acilis += " Bir de şunu sormak istiyorum: " + oz["sorular"][0]
    baglam = (f"Kullanıcıyı az önce dinledin ve şu kaydı özetledin. Özet ve notlar:\n{oz['notlar']}\n\n"
              f"Sormak istediğin diğer sorular: {' / '.join(oz['sorular'][1:]) or '-'}\n\n"
              f"Kaydın yazı dökümünün başı:\n{yazi[:6000]}")
    return sohbet_et(acilis=acilis, baglam=baglam)


# ---------------- Ana döngü ----------------
KULAK = None
KILIT = None


def tek_kopya():
    """Jarvis iki kez açılmasın (mikrofon ve kısayol çakışır)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.bind(("127.0.0.1", 47391))
    except OSError:
        print("Jarvis zaten açık.")
        sys.exit(0)
    return s


def kontrol():
    eksik = [ad for ad, d in (("ELEVENLABS_API_KEY", ELEVEN_KEY), ("ANTHROPIC_API_KEY", CLAUDE_KEY)) if not d]
    if eksik:
        print(f"❌ .env dosyasında eksik: {', '.join(eksik)}. .env.ornek dosyasını .env olarak kopyalayıp doldurun.")
        sys.exit(1)


def main():
    global eleven, claude, KULAK
    kontrol()
    global KILIT
    KILIT = tek_kopya()  # açık kaldıkça başka kopya açılamaz
    eleven = ElevenLabs(api_key=ELEVEN_KEY)
    claude = anthropic.Anthropic(api_key=CLAUDE_KEY)
    araclar.claude_gorsel = claude_gorsel
    araclar.hafiza_notlari = hafiza_notlari
    araclar.sesli_bildir = sesli_bildir
    araclar.hafizaya_ekle = hafizaya_ekle
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
          f"  Mod: {'kulaklık' if KULAKLIK else 'hoparlör (araya girmek için biraz yüksek sesle konuşun)'}\n"
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
