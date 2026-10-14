"""JARVIS'in bilgisayarda yapabildiği işler (ElevenLabs asistanına "client tool" olarak verilir).

Her araç: ARACLAR listesinde ElevenLabs tanımı + aynı adlı Python fonksiyonu.
Fonksiyon bir sözlük (asistanın gönderdiği parametreler) alır, asistana okunacak kısa bir metin döner.
"""
import base64
import datetime
import io
import os
import re
import subprocess
import threading
import unicodedata
import urllib.parse
import webbrowser
from pathlib import Path

KLASOR = Path(__file__).resolve().parent
NOT_KLASORU = KLASOR / "notlar"

# Ana program bunları doldurur (Claude çağrısı, hafıza, sesli bildirim)
claude_gorsel = None      # fn(png_bytes, soru) -> str
hafiza_notlari = None     # fn() -> list[{"tarih","not"}]
sesli_bildir = None       # fn(metin) — konuşma dışındayken Jarvis'in sesiyle söyler
hafizaya_ekle = None      # fn(metin) — kalıcı hafızaya bir satır ekler


def _sade(s):
    """Türkçe karakterleri ve büyük/küçük harfi eşitler (arama için)."""
    s = (s or "").lower().translate(str.maketrans("ıİşŞğĞüÜöÖçÇ", "iissgguuoocc"))
    s = unicodedata.normalize("NFKD", s)
    return re.sub(r"[^a-z0-9 ]+", " ", "".join(c for c in s if not unicodedata.combining(c))).strip()


# ---------------- Uygulama açma ----------------
BILINENLER = {
    "chrome": "chrome", "google chrome": "chrome", "tarayici": "chrome", "internet": "chrome",
    "edge": "msedge", "not defteri": "notepad", "notepad": "notepad", "hesap makinesi": "calc",
    "hesap makinasi": "calc", "dosya gezgini": "explorer", "dosyalar": "explorer", "explorer": "explorer",
    "paint": "mspaint", "ayarlar": "ms-settings:", "gorev yoneticisi": "taskmgr",
    "excel": "excel", "word": "winword", "powerpoint": "powerpnt", "outlook": "outlook",
    "teams": "ms-teams:", "spotify": "spotify:", "whatsapp": "whatsapp:",
    "bitrix": "https://xre.bitrix24.com.tr", "mesai": "https://xrex.com.tr/mesai/",
    "youtube": "https://www.youtube.com", "gmail": "https://mail.google.com",
}


def _kisayollar():
    yerler = [Path(os.environ.get("ProgramData", r"C:\ProgramData")) / r"Microsoft\Windows\Start Menu\Programs",
              Path(os.environ.get("APPDATA", "")) / r"Microsoft\Windows\Start Menu\Programs",
              Path.home() / "Desktop"]
    for yer in yerler:
        if yer.is_dir():
            yield from yer.rglob("*.lnk")
            yield from yer.rglob("*.url")


def uygulama_ac(p):
    ad = (p.get("ad") or "").strip()
    if not ad:
        return "Hangi uygulamayı açayım?"
    sade = _sade(ad)
    hedef = BILINENLER.get(sade)
    if not hedef:  # Başlat menüsü ve masaüstü kısayollarında ara
        adaylar = [k for k in _kisayollar() if sade in _sade(k.stem) and "uninstall" not in k.stem.lower()]
        adaylar.sort(key=lambda k: len(k.stem))
        if adaylar:
            os.startfile(str(adaylar[0]))
            return f"{adaylar[0].stem} açıldı."
        hedef = ad
    try:
        if hedef.startswith("http"):
            webbrowser.open(hedef)
        else:
            os.startfile(hedef)
        return f"{ad} açıldı."
    except OSError:
        try:
            subprocess.Popen(["cmd", "/c", "start", "", hedef], shell=False)
            return f"{ad} açılıyor."
        except OSError:
            return f"{ad} adında bir uygulama bulamadım."


# ---------------- Web ----------------
def web_ac(p):
    adres = (p.get("adres") or "").strip()
    arama = (p.get("arama") or "").strip()
    if adres:
        if not re.match(r"^https?://", adres):
            adres = "https://" + adres
        webbrowser.open(adres)
        return "Açtım."
    if arama:
        webbrowser.open("https://www.google.com/search?q=" + urllib.parse.quote(arama))
        return f"'{arama}' için arama sonuçlarını açtım."
    return "Neyi açayım?"


# ---------------- Ekran ve pano ----------------
def ekrana_bak(p):
    soru = (p.get("soru") or "Ekranda ne var? Kısaca anlat.").strip()
    from PIL import ImageGrab
    goruntu = ImageGrab.grab(all_screens=True)
    goruntu.thumbnail((1920, 1920))
    tampon = io.BytesIO()
    goruntu.save(tampon, format="PNG")
    return claude_gorsel(tampon.getvalue(), soru)


def panoyu_oku(p):
    import tkinter
    kok = tkinter.Tk()
    kok.withdraw()
    try:
        metin = kok.clipboard_get()
    except tkinter.TclError:
        metin = ""
    finally:
        kok.destroy()
    if not metin.strip():
        return "Panoda metin yok."
    return "Panodaki metin:\n" + metin[:8000]


# ---------------- Hatırlatıcı ----------------
_hatirlaticilar = []


def hatirlat(p):
    try:
        dk = float(p.get("dakika_sonra") or 0)
    except (TypeError, ValueError):
        dk = 0
    mesaj = (p.get("mesaj") or "").strip() or "Hatırlatma zamanı."
    if dk <= 0:
        return "Kaç dakika sonra hatırlatayım?"
    zaman = datetime.datetime.now() + datetime.timedelta(minutes=dk)

    def cal():
        print(f"\n⏰ HATIRLATMA: {mesaj}\n", flush=True)
        if sesli_bildir:
            sesli_bildir(f"Hatırlatma: {mesaj}")

    t = threading.Timer(dk * 60, cal)
    t.daemon = True
    t.start()
    _hatirlaticilar.append(t)
    return f"Tamam, saat {zaman:%H:%M}'de hatırlatacağım. (Jarvis kapanırsa hatırlatma iptal olur.)"


# ---------------- Hafıza ve notlarda arama ----------------
def hafizada_ara(p):
    sorgu = _sade(p.get("sorgu") or "")
    kelimeler = [k for k in sorgu.split() if len(k) > 2]
    if not kelimeler:
        return "Ne arayayım?"
    bulunan = []
    for n in (hafiza_notlari() if hafiza_notlari else []):
        if any(k in _sade(n["not"]) for k in kelimeler):
            bulunan.append(f"({n['tarih']}) {n['not']}")
    if NOT_KLASORU.is_dir():
        for md in sorted(NOT_KLASORU.glob("*.md"), reverse=True)[:60]:
            metin = md.read_text(encoding="utf-8", errors="ignore")
            if all(k in _sade(metin) for k in kelimeler):
                ozet = metin.split("## Notlar")[0].strip()
                bulunan.append(f"[{md.stem}] {ozet[:1200]}")
    if not bulunan:
        return "Hafızamda ve notlarda bununla ilgili bir şey bulamadım."
    return "Bulduklarım:\n" + "\n\n".join(bulunan[:6])


def hafizaya_kaydet(p):
    bilgi = (p.get("bilgi") or "").strip()
    if not bilgi:
        return "Neyi hatırlayayım?"
    hafizaya_ekle(bilgi)
    return "Hafızama kaydettim."


# ---------------- ElevenLabs tanımları ----------------
def _arac(ad, aciklama, ozellikler=None, zorunlu=None, cevap=True, sure=20):
    tanim = {"type": "client", "name": ad, "description": aciklama, "expects_response": cevap,
             "response_timeout_secs": sure,
             "parameters": {"type": "object", "properties": ozellikler or {}}}
    if zorunlu:
        tanim["parameters"]["required"] = zorunlu
    return tanim


def _s(aciklama):
    return {"type": "string", "description": aciklama}


ARACLAR = [
    (_arac("uygulama_ac", "Bilgisayarda bir uygulamayı ya da bilinen bir siteyi açar (Chrome, Excel, Word, "
                          "Outlook, Teams, Spotify, WhatsApp, hesap makinesi, Bitrix, mesai uygulaması…).",
           {"ad": _s("Uygulamanın adı, ör. 'excel', 'spotify'")}, ["ad"]), uygulama_ac),
    (_arac("web_ac", "Tarayıcıda bir adres açar ya da Google'da arama sonuçlarını açar. Kullanıcı bir şeyi "
                     "'aç', 'göster' derse kullan. Soruyu cevaplamak için değil (onun için derin_dusun web'de arar).",
           {"adres": _s("Açılacak adres (varsa)"), "arama": _s("Google'da aranacak metin (varsa)")}), web_ac),
    (_arac("ekrana_bak", "Bilgisayar ekranının görüntüsünü alıp inceler ve soruyu cevaplar. Kullanıcı 'ekrana "
                         "bak', 'bu ne', 'şu hatayı oku', 'bu tabloyu yorumla' gibi bir şey derse kullan.",
           {"soru": _s("Ekranla ilgili soru")}, sure=90), ekrana_bak),
    (_arac("panoyu_oku", "Kullanıcının kopyaladığı (panodaki) metni okur. 'Kopyaladığım metni özetle/düzelt/"
                         "çevir' gibi isteklerde kullan."), panoyu_oku),
    (_arac("hatirlat", "Belirtilen dakika sonra kullanıcıya sesli hatırlatma yapar.",
           {"dakika_sonra": {"type": "number", "description": "Kaç dakika sonra"},
            "mesaj": _s("Hatırlatılacak şey")}, ["dakika_sonra", "mesaj"]), hatirlat),
    (_arac("hafizada_ara", "Önceki konuşmalardan hatırlananlarda ve kaydedilmiş toplantı notlarında arar. "
                           "Kullanıcı 'geçen sefer ne konuşmuştuk', 'şu toplantıda ne karar verdik' derse kullan.",
           {"sorgu": _s("Aranacak konu, kişi ya da kelimeler")}, ["sorgu"]), hafizada_ara),
    (_arac("hafizaya_kaydet", "Kullanıcının hatırlanmasını istediği ya da kendisi hakkında verdiği kalıcı bir "
                              "bilgiyi hafızaya kaydeder.",
           {"bilgi": _s("Kaydedilecek bilgi, tek ve açık bir cümle (ör. 'Kerem'in eşinin doğum günü 3 Mart')")},
           ["bilgi"]), hafizaya_kaydet),
]


def b64(veri):
    return base64.standard_b64encode(veri).decode()
