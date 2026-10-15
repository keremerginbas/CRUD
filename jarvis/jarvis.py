"""JARVIS — Mac ve Windows için sesli asistan.

Akış:
  1. Arka planda "Hey Jarvis" uyandırma kelimesini (ya da Ctrl+Option+J / Ctrl+Alt+J) bekler.
     Uyandırma kelimesi bilgisayarda çalışır, internete ses gitmez.
  2. Uyanınca ElevenLabs'in canlı sesli asistanıyla konuşma başlar: sizi dinler, sözünü
     kesebilirsiniz, gerçekçi sesle cevap verir.
  3. Zor ya da güncel bilgi isteyen sorularda "derin_dusun" ile kendi OpenAI (ya da Claude) anahtarınızla
     (gerekirse internette arayarak) uzun uzun düşünür.
  4. Bilgisayarda iş yapar: uygulama/site açar, ekrana bakar, panodaki metni okur, hatırlatır.
  5. "Beni dinle" / "toplantıyı dinle" derseniz susar ve kaydeder (mikrofon + bilgisayarın
     sesi, yani Teams/Zoom'daki karşı taraf da — Mac'te BlackHole gerekir); "Hey Jarvis" deyince yazıya döker,
     ile özetler, özeti sesli anlatır ve sorular sorar. Notlar "notlar" klasörüne kaydedilir.
  6. Her konuşmadan kısa bir not çıkarır ve sonraki konuşmalarda hatırlar.
"""
import datetime
import hashlib
import json
import logging
import os
import platform
import queue
import random
import re
import socket
import sys
import threading
import time
import wave
from pathlib import Path

import certifi
import numpy as np
import sounddevice as sd
from dotenv import load_dotenv

import anthropic
from elevenlabs.client import ElevenLabs
from elevenlabs.conversational_ai.conversation import (
    AudioInterface,
    ClientTools,
    Conversation,
    ConversationInitiationData,
)

import araclar

KLASOR = Path(__file__).resolve().parent
load_dotenv(KLASOR / ".env")
# Mac'te python.org Python'u sistem sertifikalarını görmez; güvenli bağlantılar (ElevenLabs) için gerekli
os.environ.setdefault("SSL_CERT_FILE", certifi.where())

# ---------------- Ayarlar (.env) ----------------
ELEVEN_KEY = os.getenv("ELEVENLABS_API_KEY", "").strip()
CLAUDE_KEY = os.getenv("ANTHROPIC_API_KEY", "").strip()
OPENAI_KEY = os.getenv("OPENAI_API_KEY", "").strip()
# Düşünme motoru (derin düşünme, ekran, özet, hafıza): openai ya da claude. Boşsa hangi anahtar varsa o.
BEYIN = (os.getenv("JARVIS_BEYIN", "").strip().lower()
         or ("openai" if OPENAI_KEY else "claude"))
# OpenAI modelleri sırayla denenir; hesabınızın erişebildiği ilk model kullanılır.
OPENAI_MODELLERI = [m.strip() for m in (os.getenv("JARVIS_OPENAI_MODELI", "").strip()
                                       or "gpt-6.1-sol,gpt-5.5,gpt-5.4").split(",") if m.strip()]
KULLANICI_ADI = os.getenv("JARVIS_KULLANICI_ADI", "").strip()
# Varsayılan ses: "George" (ElevenLabs hazır sesi, tok ve sakin erkek sesi; Türkçe konuşur)
SES_ID = os.getenv("JARVIS_SES_ID", "").strip() or "JBFqnCBsd6RMkjVDRZzb"
SES_MODELI = os.getenv("JARVIS_SES_MODELI", "").strip() or "eleven_v3_conversational"
YEDEK_SES_MODELI = "eleven_flash_v2_5"
SOHBET_MODELI = os.getenv("JARVIS_SOHBET_MODELI", "").strip() or "claude-opus-5-5"
SOHBET_EFOR = os.getenv("JARVIS_SOHBET_EFOR", "").strip() or "low"  # akıcılık için düşük; zor sorular derin_dusun'a gider
CLAUDE_MODELI = "claude-opus-5-5"
KULAKLIK = os.getenv("JARVIS_KULAKLIK", "hayir").strip().lower() in ("evet", "1", "true", "yes")
# Hoparlörde Jarvis konuşurken mikrofon tamamen kapanır (kendi sesini duymasın). 0'dan büyük bir değer
# verilirse bu seviyeden yüksek ses (yüksek sesle araya girme) yine geçer; hoparlör yankısı güçlüyse 0 kalsın.
SOZ_KESME_ESIGI = int(os.getenv("JARVIS_SOZ_KESME_ESIGI", "0") or 0)
UYANDIRMA_ESIGI = float(os.getenv("JARVIS_UYANDIRMA_ESIGI", "0.6"))
MAC = platform.system() == "Darwin"
WINDOWS = platform.system() == "Windows"
KISAYOL = "Ctrl+Option+J" if MAC else "Ctrl+Alt+J"
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

SES_ETIKETI = re.compile(r"\[[^\]\n]{1,30}\]\s*")
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
claude_istemci = None
aktif_konusma = None  # şu an açık Conversation (yoksa None)


def ajani_unut():
    """Kayıtlı asistan kimliğini siler; bir sonraki konuşmada bu anahtarın hesabında yenisi oluşturulur."""
    durum = json_oku(DURUM_DOSYASI, {})
    durum.pop("agent_id", None)
    durum.pop("imza", None)
    json_yaz(DURUM_DOSYASI, durum)


def ajani_hazirla():
    """Asistanı ilk açılışta oluşturur; ayarlar değiştiyse günceller. Kimliği durum dosyasında tutar.
    ElevenLabs anahtarı değiştiyse (başka hesap/çalışma alanı olabilir) asistan yeniden oluşturulur."""
    durum = json_oku(DURUM_DOSYASI, {})
    anahtar_izi = hashlib.sha256(ELEVEN_KEY.encode()).hexdigest()[:16]
    if durum.get("anahtar") != anahtar_izi:
        durum = {"anahtar": anahtar_izi}
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
            durum.update({"agent_id": agent_id, "imza": imza, "ses_modeli": model, "anahtar": anahtar_izi})
            json_yaz(DURUM_DOSYASI, durum)
            return agent_id
        except Exception as e:  # ses modeli bu hesapta/dilde desteklenmiyorsa yedeğe geç
            if model == YEDEK_SES_MODELI:
                raise
            yaz("⚠️", f"{model} ses modeli kabul edilmedi ({kisa_hata(e)}); {YEDEK_SES_MODELI} deneniyor.")


# ElevenLabs'in yeni uzun anahtarları (sk_ + 64 karakter) bazı hesaplarda "imzalı bağlantı" adresinde
# "API key must be exactly 51 characters" hatası alıyor. O durumda konuşmaya anahtarı bağlantı
# başlığında (xi-api-key) göndererek doğrudan bağlanılır.
import elevenlabs.conversational_ai.conversation as _konusma_modulu  # noqa: E402

_asil_baglan = _konusma_modulu.connect
_dogrudan_baglan = threading.Event()


def _baglan(url, **kw):
    if _dogrudan_baglan.is_set():
        kw["additional_headers"] = {"xi-api-key": ELEVEN_KEY}
    return _asil_baglan(url, **kw)


_konusma_modulu.connect = _baglan


class JarvisKonusma(Conversation):
    def start_session(self):
        if not _dogrudan_baglan.is_set():
            try:
                return super().start_session()
            except Exception as e:
                metin = str(e).lower()
                if "api_key" not in metin and "api key" not in metin and "authentication" not in metin:
                    raise
                yaz("ℹ️", "İmzalı bağlantı anahtarı kabul etmedi; anahtarla doğrudan bağlanılıyor.")
                _dogrudan_baglan.set()
        self.requires_auth = False
        return super().start_session()


class JarvisSesArayuzu(AudioInterface):
    """ElevenLabs konuşması için mikrofon/hoparlör (sounddevice: Mac ve Windows'ta ek kurulum istemez).
    Yankı koruması: hoparlörde Jarvis kendi sesini duyup kendi sözünü sanabilir. Bu yüzden Jarvis
    konuşurken (ve hoparlörün gecikmesi kadar sonra) mikrofona sessizlik gönderilir.
    Kulaklıkla (JARVIS_KULAKLIK=evet) bu koruma kapalıdır; konuşurken sözünü kesebilirsiniz.
    Konuşma kapanırken son cümle (veda) yarıda kesilmeden çalınır."""

    def start(self, input_callback):
        self.input_callback = input_callback
        self.kuyruk = queue.Queue()
        self.dur = threading.Event()
        self._calma_bitis = 0.0  # hoparlöre gönderilen sesin çalınmasının biteceği an
        self.cikis = sd.RawOutputStream(samplerate=ORNEKLEME, channels=1, dtype="int16", blocksize=1000)
        self.giris = sd.RawInputStream(samplerate=ORNEKLEME, channels=1, dtype="int16", blocksize=4000,
                                       callback=self._geldi)
        self.cikis.start()
        self.giris.start()
        # Konuşma bittikten sonra mikrofonun açılması için pay: hoparlör gecikmesi + oda yankısı
        self._pay = 0.6 + float(getattr(self.cikis, "latency", 0) or 0)
        self.calici = threading.Thread(target=self._cal, daemon=True)
        self.calici.start()

    def _cal(self):
        while not self.dur.is_set():
            try:
                ses = self.kuyruk.get(timeout=0.25)
            except queue.Empty:
                continue
            simdi = time.time()
            self._calma_bitis = max(simdi, self._calma_bitis) + len(ses) / 32000  # 16 kHz, 16 bit
            self.cikis.write(ses)

    def _geldi(self, veri, kare, zaman, durum):
        veri = bytes(veri)
        if not KULAKLIK and (not self.kuyruk.empty() or time.time() < self._calma_bitis + self._pay):
            yuksek = False
            if SOZ_KESME_ESIGI > 0:
                rms = float(np.sqrt(np.mean(np.frombuffer(veri, dtype=np.int16).astype(np.float32) ** 2)))
                yuksek = rms > SOZ_KESME_ESIGI
            if not yuksek:
                veri = b"\x00" * len(veri)
        try:
            self.input_callback(veri)
        except Exception:
            pass

    def output(self, audio):
        self.kuyruk.put(audio)

    def interrupt(self):
        if not hasattr(self, "kuyruk"):
            return
        self._calma_bitis = time.time()
        try:
            while True:
                self.kuyruk.get(block=False)
        except queue.Empty:
            pass

    def stop(self):
        if not hasattr(self, "kuyruk"):  # bağlantı ses başlamadan kapandı
            return
        bitis = time.time() + 6
        while not self.kuyruk.empty() and time.time() < bitis:
            time.sleep(0.1)
        self.dur.set()
        self.calici.join(timeout=2)
        for akis in (self.giris, self.cikis):
            try:
                akis.stop()
                akis.close()
            except Exception:
                pass


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
        sd.play(np.frombuffer(ses, dtype=np.int16), ORNEKLEME, blocking=True)
    except Exception as e:
        log.warning("Sesli bildirim çalınamadı: %s", kisa_hata(e))


# ---------------- Düşünme motoru: OpenAI ya da Claude ----------------
# .env'de hangi anahtar varsa o kullanılır (ikisi de varsa JARVIS_BEYIN ile seçilir; varsayılan OpenAI).
openai_istemci = None
_calisan_openai_modeli = None


def dusun(sistem, metin, gorsel=None, efor="high", web=False, sema=None, azami=16000):
    """Tek bir soru-cevap. gorsel: PNG baytları; web: internette arayabilsin; sema: JSON şeması (yapılandırılmış cevap)."""
    if BEYIN == "openai":
        return _openai_dusun(sistem, metin, gorsel, efor, web, sema, azami)
    return _claude_dusun(sistem, metin, gorsel, efor, web, sema, azami)


def _openai_dusun(sistem, metin, gorsel, efor, web, sema, azami):
    """OpenAI Responses API. İlk çalışan model hatırlanır; hesap bir modele erişemiyorsa sıradakine geçer."""
    global _calisan_openai_modeli
    import openai
    icerik = [{"type": "input_text", "text": metin}]
    if gorsel:
        icerik.append({"type": "input_image", "detail": "auto",
                       "image_url": "data:image/png;base64," + araclar.b64(gorsel)})
    kw = dict(instructions=sistem, input=[{"role": "user", "content": icerik}],
              reasoning={"effort": efor}, max_output_tokens=azami)
    if web:
        kw["tools"] = [{"type": "web_search"}]
    if sema:
        kw["text"] = {"format": {"type": "json_schema", "name": "cevap", "schema": sema, "strict": True}}
    modeller = [_calisan_openai_modeli] if _calisan_openai_modeli else OPENAI_MODELLERI
    son_hata = None
    for model in modeller:
        try:
            cevap = openai_istemci.responses.create(model=model, **kw)
        except (openai.NotFoundError, openai.PermissionDeniedError) as e:
            son_hata = e  # bu hesapta bu model yok: sıradakini dene
            continue
        except openai.BadRequestError as e:
            if "model" in str(e).lower() and model != modeller[-1]:
                son_hata = e
                continue
            raise
        _calisan_openai_modeli = model
        return (cevap.output_text or "").strip()
    raise son_hata or RuntimeError("Kullanılabilir OpenAI modeli bulunamadı.")


def _claude_dusun(sistem, metin, gorsel, efor, web, sema, azami):
    """Claude Opus 5.5: akış (uzun cevaplarda zaman aşımı olmasın), reddedilirse sunucu tarafı yedek model,
    internet araması uzun sürerse (pause_turn) kaldığı yerden devam."""
    icerik = [{"type": "text", "text": metin}]
    if gorsel:
        icerik.insert(0, {"type": "image", "source": {"type": "base64", "media_type": "image/png",
                                                       "data": araclar.b64(gorsel)}})
    messages = [{"role": "user", "content": icerik}]
    cikti = {"effort": efor}
    if sema:
        cikti["format"] = {"type": "json_schema", "schema": sema}
    kw = dict(system=sistem, max_tokens=max(azami, 16000), output_config=cikti, thinking={"type": "adaptive"})
    if web:
        kw["tools"] = [{"type": "web_search_20260209", "name": "web_search", "max_uses": 5}]
    for _ in range(5):
        with claude_istemci.beta.messages.stream(
            model=CLAUDE_MODELI,
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
        raise RuntimeError("Model bu isteği yanıtlamayı reddetti.")
    return "".join(b.text for b in mesaj.content if b.type == "text").strip()


def derin_dusun(soru, gecmis):
    son = "\n".join(gecmis[-30:])
    return dusun(
        "Sen bir sesli asistanın arka plandaki düşünme motorusun. Soruyu dikkatle düşün; güncel bilgi "
        "gerekiyorsa internette ara. En doğru, uygulanabilir cevabı ver. Cevap sesli okunacak: madde işareti, "
        "başlık, tablo, emoji, link kullanma; akıcı Türkçe paragraflarla yaz. Gereksiz uzatma.",
        f"Konuşmanın son kısmı:\n{son or '(yok)'}\n\nDüşünülecek soru:\n{soru}\n\n"
        f"Kullanıcı hakkında bilinenler:\n{hafiza_metni() or '(yok)'}\n\nŞu an: {simdi_metni()} (Türkiye)",
        efor="high", web=True,
    )


def ekrani_yorumla(png, soru):
    return dusun(
        "Kullanıcının bilgisayar ekranının görüntüsüne bakıyorsun. Soruyu ekrandakine göre cevapla. Cevap "
        "sesli okunacak: kısa, akıcı Türkçe; liste ve emoji yok.",
        soru, gorsel=png, efor="medium", azami=8000,
    )


def konusmadan_not_cikar(gecmis):
    if sum(1 for s in gecmis if s.startswith("Kullanıcı:")) < 2:
        return
    try:
        not_metni = dusun(
            "Bir sesli asistanın uzun süreli hafızasını tutuyorsun. Konuşmadan, ileride işe yarayacak "
            "kalıcı bilgileri (kullanıcının işi, tercihleri, planları, verdiği kararlar, takip edilecek "
            "konular) ve konuşmanın konusunu tek bir kısa paragrafta (en çok 2 cümle) yaz. Kayda değer "
            "bir şey yoksa sadece BOŞ yaz.",
            "\n".join(gecmis[-60:]), efor="low", azami=4000,
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
    metin = dusun(
        "Bir sesli asistan için kayıt özetliyorsun. Kayıt bir toplantı, telefon/online görüşme ya da "
        "kullanıcının kendi anlatımı olabilir. Konuşmacı etiketleri otomatik tahmindir. Konuşulanları "
        "sadakatle özetle, uydurma. Sesli özet doğal Türkçe ile, sanki kullanıcıya anlatıyormuş gibi olsun; "
        "sayıları yazıyla yaz.",
        f"Konu (biliniyorsa): {konu or '-'}\nTarih: {simdi_metni()}\n\nKaydın yazıya dökümü:\n{yazi}",
        efor="high", sema=OZET_SEMASI, azami=32000,
    )
    return json.loads(metin)


# ---------------- Bilgisayarın sesini kaydetme (Teams/Zoom'daki karşı taraf) ----------------
class BilgisayarSesi:
    """Bilgisayardan çıkan sesi (Teams/Zoom'daki karşı taraf) ayrı bir dosyaya kaydeder.
    - Mac: BlackHole sanal ses sürücüsü gerekir (README'de anlatılıyor); kuruluysa otomatik bulunur.
    - Windows: hoparlöre giden ses (WASAPI loopback). Ses çalmadığı anlarda Windows veri göndermez;
      aradaki boşluk saat ile sessizlikle doldurulur ki mikrofon kaydıyla hizalı kalsın."""

    def __init__(self, yol):
        self.kilit, self.yazilan, self.dur = threading.Lock(), 0, threading.Event()
        self.dosya = None
        if MAC:
            cihaz = next((c for c in sd.query_devices()
                          if "blackhole" in c["name"].lower() and c["max_input_channels"] > 0), None)
            if not cihaz:
                raise RuntimeError("BlackHole kurulu değil")
            self.oran, self.kanal = int(cihaz["default_samplerate"]), min(2, int(cihaz["max_input_channels"]))
            self._dosya_ac(yol)
            self.akis = sd.RawInputStream(device=cihaz["index"], samplerate=self.oran, channels=self.kanal,
                                          dtype="int16", callback=lambda v, n, *_: self._yaz(bytes(v), n))
            self.akis.start()
            self.kapat_fn = lambda: (self.akis.stop(), self.akis.close())
        elif WINDOWS:
            import pyaudiowpatch as pw
            self.pa = pw.PyAudio()
            cihaz = self.pa.get_default_wasapi_loopback()
            self.oran, self.kanal = int(cihaz["defaultSampleRate"]), int(cihaz["maxInputChannels"])
            self._dosya_ac(yol)
            akis = self.pa.open(format=pw.paInt16, channels=self.kanal, rate=self.oran, input=True,
                                input_device_index=cihaz["index"], frames_per_buffer=1024,
                                stream_callback=lambda v, n, *_: (self._yaz(v, n), (None, pw.paContinue))[1])
            self.kapat_fn = lambda: (akis.stop_stream(), akis.close(), self.pa.terminate())
            threading.Thread(target=self._bosluk_doldur, daemon=True).start()
        else:
            raise RuntimeError("bu işletim sisteminde desteklenmiyor")

    def _dosya_ac(self, yol):
        self.dosya = wave.open(str(yol), "wb")
        self.dosya.setnchannels(self.kanal)
        self.dosya.setsampwidth(2)
        self.dosya.setframerate(self.oran)
        self.basla = time.time()

    def _yaz(self, veri, n):
        with self.kilit:
            if not self.dur.is_set():
                self.dosya.writeframes(veri)
                self.yazilan += n

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
            self.kapat_fn()
        finally:
            with self.kilit:
                self.dosya.close()
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
        self.kisayol = threading.Event()
        self.sakin_kadar = 0.0  # konuşma bitince kısa süre uyanmasın (hoparlör yankısı tetiklemesin)

    def bekle(self, kayit_yolu=None, azami_sn=None):
        self.model.reset()
        self.kisayol.clear()
        akis = sd.RawInputStream(samplerate=ORNEKLEME, channels=1, dtype="int16", blocksize=PARCA)
        akis.start()
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
                veri = bytes(akis.read(PARCA)[0])
                if dosya:
                    dosya.writeframes(veri)
                puan = max(self.model.predict(np.frombuffer(veri, dtype=np.int16)).values())
                # Yanlış uyanmayı azaltmak için arka arkaya iki parçada eşiği geçmeli
                ust_uste = ust_uste + 1 if puan >= UYANDIRMA_ESIGI else 0
                if ust_uste >= 2 and time.time() > sakin:
                    break
        finally:
            akis.stop()
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
        metin = SES_ETIKETI.sub("", metin).strip()  # [warm], [calm] gibi ses tonu etiketleri okunmaz, gösterilmez
        if not metin:
            return
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
    konusma = JarvisKonusma(
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


BILINEN_HATALAR = [
    ("document_not_found", "Kayıtlı JARVIS asistanı bu ElevenLabs hesabında yok; yenisi oluşturulacak. "
                           "Tekrar 'Hey Jarvis' deyin."),
    ("payment_issue", "ElevenLabs hesabınızda ödeme sorunu var. elevenlabs.io → sol alt profil → "
                      "Subscription / Billing bölümünden kartınızı ya da bekleyen faturayı düzeltin."),
    ("quota", "ElevenLabs kredi ya da dakika hakkınız bitmiş. elevenlabs.io → Subscription bölümüne bakın."),
    ("limit", "ElevenLabs kullanım sınırına ulaşıldı. elevenlabs.io → Subscription bölümüne bakın."),
    ("1008", "ElevenLabs bağlantıyı reddetti; API anahtarının ElevenAgents iznini kontrol edin."),
    ("401", "ElevenLabs anahtarı geçersiz; .env'deki ELEVENLABS_API_KEY'i kontrol edin."),
]


def hata_yakala(args):
    """Arka plandaki bağlantı hatalarını anlaşılır Türkçe mesaja çevirir."""
    metin = f"{args.exc_type.__name__}: {args.exc_value}"
    if "document_not_found" in metin:
        ajani_unut()
    for anahtar, aciklama in BILINEN_HATALAR:
        if anahtar in metin.lower():
            yaz("❌", aciklama)
            return
    yaz("❌", f"Bağlantı hatası: {metin[:300]}")


def kisayol_kur(tetikle):
    """Ctrl+Option+J (Mac) / Ctrl+Alt+J (Windows). Tuş kodu ile yakalanır: Mac'te Option harfi
    değiştirdiği (J → ∆) için harf karşılaştırması çalışmaz.
    Mac'te Terminal'e Ayarlar → Gizlilik ve Güvenlik → Giriş İzleme izni gerekir."""
    try:
        from pynput import keyboard as kb
    except Exception as e:
        yaz("⚠️", f"Kısayol kurulamadı ({e}). Yalnızca 'Hey Jarvis' ile çalışır.")
        return
    j_kodu = 38 if MAC else 0x4A
    basili = set()
    ctrl = {kb.Key.ctrl, kb.Key.ctrl_l, kb.Key.ctrl_r}
    alt = {kb.Key.alt, kb.Key.alt_l, kb.Key.alt_r, getattr(kb.Key, "alt_gr", kb.Key.alt)}

    def bas(tus):
        if tus in ctrl:
            basili.add("ctrl")
        elif tus in alt:
            basili.add("alt")
        elif getattr(tus, "vk", None) == j_kodu and {"ctrl", "alt"} <= basili:
            tetikle()

    def birak(tus):
        if tus in ctrl:
            basili.discard("ctrl")
        elif tus in alt:
            basili.discard("alt")

    try:
        kb.Listener(on_press=bas, on_release=birak, daemon=True).start()
    except Exception as e:
        yaz("⚠️", f"Kısayol kurulamadı ({e}). Yalnızca 'Hey Jarvis' ile çalışır.")


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
    eksik = []
    if not ELEVEN_KEY:
        eksik.append("ELEVENLABS_API_KEY")
    if BEYIN == "openai" and not OPENAI_KEY:
        eksik.append("OPENAI_API_KEY")
    elif BEYIN == "claude" and not CLAUDE_KEY:
        eksik.append("OPENAI_API_KEY (ya da ANTHROPIC_API_KEY)")
    if eksik:
        print(f"❌ .env dosyasında eksik: {', '.join(eksik)}. .env.ornek dosyasını .env olarak kopyalayıp doldurun.")
        sys.exit(1)


def main():
    global eleven, claude_istemci, openai_istemci, KULAK
    threading.excepthook = hata_yakala
    # Windows konsolu emoji/Türkçe karakter basamazsa programın çökmesin
    for akis in (sys.stdout, sys.stderr):
        try:
            akis.reconfigure(errors="replace")
        except Exception:
            pass
    kontrol()
    global KILIT
    KILIT = tek_kopya()  # açık kaldıkça başka kopya açılamaz
    eleven = ElevenLabs(api_key=ELEVEN_KEY)
    if BEYIN == "openai":
        import openai
        openai_istemci = openai.OpenAI(api_key=OPENAI_KEY, timeout=180)
    else:
        claude_istemci = anthropic.Anthropic(api_key=CLAUDE_KEY)
    araclar.ekrani_yorumla = ekrani_yorumla
    araclar.hafiza_notlari = hafiza_notlari
    araclar.sesli_bildir = sesli_bildir
    araclar.hafizaya_ekle = hafizaya_ekle
    try:
        ajani_hazirla()
    except Exception as e:
        print(f"❌ ElevenLabs asistanı hazırlanamadı: {kisa_hata(e)}")
        sys.exit(1)
    KULAK = Kulak()
    kisayol_kur(KULAK.kisayol.set)

    print("\n  J.A.R.V.I.S. hazır.\n"
          f"  Uyandırmak için 'Hey Jarvis' deyin ya da {KISAYOL} basın.\n"
          f"  Mod: {'kulaklık' if KULAKLIK else 'hoparlör (Jarvis konuşurken mikrofon kapalı; cümlesini bitirmesini bekleyin)'}\n"
          "  Kapatmak için bu pencerede Ctrl+C.\n", flush=True)
    if MAC:
        print("  İlk açılışta Mac mikrofon izni ister: İzin Ver deyin. Kısayol için Terminal'e\n"
              "  Ayarlar → Gizlilik ve Güvenlik → Giriş İzleme izni verin.\n", flush=True)

    while True:
        KULAK.bekle()
        yaz("⚡", "Uyandı.")
        try:
            try:
                sonuc = sohbet_et()
            except Exception as e:
                if "document_not_found" not in str(e):
                    raise
                yaz("🔧", "Kayıtlı asistan bu ElevenLabs hesabında bulunamadı; yenisi oluşturuluyor…")
                ajani_unut()
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
