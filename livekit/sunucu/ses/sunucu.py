"""Kendi sunucumuzda ses üretimi: açık kaynak VoxCPM2 modeli (openbmb/VoxCPM2, Apache-2.0) ekran kartında çalışır.

Bu sürüm DENEME içindir: paneldeki "Ses karşılaştır" sayfası buradan ses alır; canlı aramalara bağlı değildir.
  GET  /saglik  model hazır mı, ekran kartı belleği ne durumda
  POST /ses     {"metin": "...", "ses": "nefes" | "varsayilan"} → ses üretildikçe akar (WAV, 16 bit, tek kanal)
  GET  /son     son üretimin ölçümleri (ilk ses, toplam süre, ses süresi, hız)

Ses biçimi: 44 baytlık WAV başlığı + ham PCM. Uzunluk baştan bilinmediği için başlıktaki iki boy alanı
0xFFFFFFFF yazılır ("uzunluk bilinmiyor"). Tamamı indirildikten sonra tarayıcıda çalınacaksa çağıran taraf
bu iki alanı gerçek boyla düzeltmelidir (panel bunu yapar); 4. ve 40. baytlardaki 4'er baytlık alanlar.
Cevap, ilk ses parçası hazır olunca başlar: çağıranın "ilk bayt" süresi = ilk sesin süresidir.

Aynı anda tek üretim yapılır: 8 GB'lık kartta model bir kopya sığar. İkinci istek sırada bekler.

Sesler:
  nefes       Nefes 0.5 projesinin yapay kadın sesi (alicangunduz/nefes-0.5, voice/nefes.wav, Apache-2.0,
              © 2026 Ali Can Gündüz; gerçek bir kişiye ait değildir). Model bu kısa kaydı örnek alır.
  varsayilan  Örnek ses verilmez; model kendi seçtiği sesle okur (her üretimde değişebilir).

Ortam değişkenleri (hepsi isteğe bağlı):
  SES_YARIM_HASSASIYET=1  1: modelin kendi ayarı (bfloat16, yaklaşık 8 GB kart belleği). 0: float32; iki katı
                          bellek ister, 8 GB'lık karta sığmaz, yalnızca daha büyük kartta denemek içindir.
  SES_DERLE=1             1: torch.compile ile hızlandırma (ilk açılış birkaç dakika uzar, biraz daha bellek).
                          Bellek yetmezse 0 yapın. Derleme başarısız olursa kendiliğinden derlemesiz açılır.
  SES_AZ_RAM=1            1: model yüklenirken sistem belleğini (RAM) az kullanan yol. Sorun çıkarırsa
                          kendiliğinden olağan yola döner; 0 ile baştan kapatılabilir.
  SES_BELLEK_BOSALT=1     Her üretimden sonra kullanılmayan kart belleğini geri verir.
  SES_CFG=2.0, SES_ADIM=10  Modelin üretim ayarları (cfg_value, inference_timesteps).
  SES_AZAMI_SN=60         Tek üretimde en çok bu kadar saniyelik ses (model takılırsa sonsuza gitmesin).
  SES_BEKLEME_SN=60       Meşgulken sırada en çok bekleme; dolunca 503 döner.
  SES_HIZ=24000           Çıkış örnekleme hızı. Modelin hızı (48000) buna tam bölünüyorsa indirgenir.
  SES_NEFES_METIN         Nefes kaydında söylenen cümle biliniyorsa yazılır: model kaydı devam ettirerek
                          daha benzer konuşur (VoxCPM2 "ultimate cloning"). Boşsa yalnızca örnek ses verilir.
  SES_NEFES_YOL           Kapsayıcı içindeki bir WAV dosyasının yolu verilirse örnek ses olarak o kullanılır
                          (indirme yapılmaz).
  SES_SAHTE=1             Model yerine sinüs dalgası üreten sahte üretici (ekran kartsız deneme için).
"""
from __future__ import annotations

import asyncio
import json
import logging
import math
import mmap
import os
import re
import struct
import sys
import threading
import time
from contextlib import asynccontextmanager, contextmanager
from pathlib import Path

import numpy as np
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse

gunluk = logging.getLogger("ses")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


def _acik(ad: str, varsayilan: str = "1") -> bool:
    return os.environ.get(ad, varsayilan).strip().lower() not in ("0", "", "hayir", "hayır", "false", "no")


def _sayi(ad: str, varsayilan: float) -> float:
    try:
        return float(os.environ.get(ad, "").strip() or varsayilan)
    except ValueError:
        return varsayilan


MODEL = os.environ.get("SES_MODEL", "openbmb/VoxCPM2").strip()
NEFES_DEPO = os.environ.get("SES_NEFES_DEPO", "alicangunduz/nefes-0.5").strip()
NEFES_DOSYA = "voice/nefes.wav"
NEFES_METIN = os.environ.get("SES_NEFES_METIN", "").strip()
NEFES_YOL = os.environ.get("SES_NEFES_YOL", "").strip()
VERI = Path(os.environ.get("SES_VERI", "/veri"))
SAHTE = _acik("SES_SAHTE", "0")
YARIM = _acik("SES_YARIM_HASSASIYET")
DERLE = _acik("SES_DERLE")
AZ_RAM = _acik("SES_AZ_RAM")
BELLEK_BOSALT = _acik("SES_BELLEK_BOSALT")
CFG = _sayi("SES_CFG", 2.0)
ADIM = max(1, int(_sayi("SES_ADIM", 10)))
AZAMI_SN = _sayi("SES_AZAMI_SN", 60)
BEKLEME_SN = _sayi("SES_BEKLEME_SN", 60)
ILK_SES_SN = _sayi("SES_ILK_SES_SN", 120)      # ilk ses parçası bu sürede gelmezse üretim bırakılır
HEDEF_HIZ = int(_sayi("SES_HIZ", 24000))
METIN_SINIRI = 400
SESLER = ("nefes", "varsayilan")
OLAGAN_YOL_RAM_MB = int(_sayi("SES_OLAGAN_YOL_RAM_MB", 14000))


# ---------- Ses işleme ----------
class Indirgeyici:
    """Örnekleme hızını tam katına indirir (48000 → 24000), parça parça. Önce alçak geçiren süzgeç, sonra
    her k'nci örnek alınır; süzgecin kuyruğu parçalar arasında taşındığı için parça sınırında çıtırtı olmaz.
    Kaynak hız hedefe tam bölünmüyorsa dokunmaz: ses kaynağın hızında çıkar (başlığa o hız yazılır)."""

    def __init__(self, kaynak: int, hedef: int, uzunluk: int = 63):
        self.k = kaynak // hedef if hedef > 0 and kaynak % hedef == 0 else 1
        self.hiz = kaynak // self.k
        self.faz = 0
        if self.k > 1:
            n = np.arange(uzunluk) - (uzunluk - 1) / 2
            kesim = 0.46 / self.k                                  # kaynak hızına göre; yeni hızın yarısının biraz altı
            h = 2 * kesim * np.sinc(2 * kesim * n) * np.hamming(uzunluk)
            self.h = (h / h.sum()).astype(np.float32)
            self.kalan = np.zeros(uzunluk - 1, dtype=np.float32)

    def isle(self, x: np.ndarray) -> np.ndarray:
        x = np.asarray(x, dtype=np.float32).reshape(-1)
        if self.k == 1 or not len(x):
            return x
        y = np.concatenate([self.kalan, x])
        cikti = np.convolve(y, self.h, mode="valid")[self.faz::self.k]
        self.faz = (self.faz - len(x)) % self.k
        self.kalan = y[-len(self.kalan):]
        return cikti


def pcm16(x: np.ndarray) -> bytes:
    return (np.clip(np.nan_to_num(x), -1.0, 1.0) * 32767.0).astype("<i2").tobytes()


def wav_basligi(hiz: int, veri_boyu: int | None = None) -> bytes:
    """16 bit, tek kanal WAV başlığı. veri_boyu verilmezse boy alanları 'bilinmiyor' (0xFFFFFFFF) yazılır."""
    riff, veri = (0xFFFFFFFF, 0xFFFFFFFF) if veri_boyu is None else (36 + veri_boyu, veri_boyu)
    return struct.pack("<4sI4s4sIHHIIHH4sI", b"RIFF", riff, b"WAVE", b"fmt ", 16, 1, 1, hiz, hiz * 2, 2, 16, b"data", veri)


def metni_hazirla(metin: str) -> str:
    """Yalnızca boşluklar sadeleştirilir (satır sonu ve sekme dahil). Sayılar vb. olduğu gibi modele gider."""
    return re.sub(r"\s+", " ", metin).strip()


# ---------- Üreticiler ----------
class SahteUretici:
    """Deneme için: model yerine sinüs dalgası. Gerçek üreticiyle aynı yolu izler (48 kHz, 160 ms'lik parçalar).
    Süre metnin uzunluğuna bağlıdır; metinde __hata__ geçerse ilk parçadan önce, __yarida__ geçerse ikinci
    parçadan sonra hata verir."""

    hiz = 48000
    cihaz = "sahte"
    derleme = False
    az_ram = False

    def __init__(self):
        time.sleep(_sayi("SES_SAHTE_YUKLEME_SN", 0))
        if _acik("SES_SAHTE_YUKLEME_HATASI", "0"):
            raise RuntimeError("sahte yükleme hatası")
        self.gecikme = _sayi("SES_SAHTE_GECIKME_MS", 40) / 1000
        self.sesler = set(SESLER)

    def uret(self, metin: str, ses: str):
        parca, adet = 7680, max(2, math.ceil(len(metin) * 0.06 / 0.16))
        for i in range(adet):
            time.sleep(self.gecikme)
            if "__hata__" in metin or ("__yarida__" in metin and i == 2):
                raise RuntimeError("sahte üretim hatası")
            t = (np.arange(parca) + i * parca) / self.hiz
            yield (0.3 * np.sin(2 * np.pi * (440 if ses == "nefes" else 330) * t)).astype(np.float32)


@contextmanager
def _az_ram_yukleme(cihaz: str, yuklenen: set):
    """VoxCPM2'nin olağan yüklemesi modeli önce sistem belleğinde float32 olarak kurar (yaklaşık 9 GB), sonra
    küçültüp karta taşır. 8 GB RAM'li makinede bu sığmaz. Burada, kitaplığın kendi yükleme işlevi çalışırken:
      1) büyük katmanların rastgele başlangıç değerleri yazılmaz (nasılsa dosyadaki ağırlıklarla değişecek);
         yazılmayan bellek sayfaları işletim sisteminde yer tutmaz,
      2) model küçültülürken aynı adımda karta taşınır (sistem belleğinde ikinci kopya oluşmaz),
      3) ağırlık dosyası belleğe kopyalanmaz, diskten eşlenerek (mmap) okunur.
    Kitaplığın sonucu değişmez; yalnızca ara kopyalar ortadan kalkar. Dosyada bulunmayan bir ağırlık çıkarsa
    (yuklenen kümesiyle sonradan denetlenir) çağıran olağan yola döner."""
    import torch
    import voxcpm.model.voxcpm2 as v2

    asil_init, asil_to, asil_oku = v2.VoxCPM2Model.__init__, v2.VoxCPM2Model.to, v2.load_file
    asil_dogrusal, asil_gomme = torch.nn.Linear.reset_parameters, torch.nn.Embedding.reset_parameters
    kurulumda = threading.local()

    def init(self, *a, **k):
        kurulumda.acik = True
        try:
            asil_init(self, *a, **k)
        finally:
            kurulumda.acik = False

    def atla(asil):
        def reset(self):
            if not getattr(kurulumda, "acik", False):
                asil(self)
        return reset

    def to(self, *a, **k):
        if len(a) == 1 and not k and isinstance(a[0], torch.dtype) and str(cihaz).startswith("cuda"):
            return asil_to(self, cihaz, a[0])
        return asil_to(self, *a, **k)

    def oku(yol, device="cpu"):
        sozluk = _safetensors_esle(yol) if device == "cpu" else asil_oku(yol, device=device)
        yuklenen.update(sozluk)
        return sozluk

    v2.VoxCPM2Model.__init__, v2.VoxCPM2Model.to, v2.load_file = init, to, oku
    torch.nn.Linear.reset_parameters, torch.nn.Embedding.reset_parameters = atla(asil_dogrusal), atla(asil_gomme)
    try:
        yield
    finally:
        v2.VoxCPM2Model.__init__, v2.VoxCPM2Model.to, v2.load_file = asil_init, asil_to, asil_oku
        torch.nn.Linear.reset_parameters, torch.nn.Embedding.reset_parameters = asil_dogrusal, asil_gomme


def _safetensors_esle(yol: str) -> dict:
    """safetensors dosyasını belleğe kopyalamadan açar: tensörler dosyanın eşlenmiş (mmap) sayfalarını gösterir.
    Biçim: 8 bayt başlık boyu, JSON başlık ({ad: {dtype, shape, data_offsets}}), ardından ham veri."""
    import torch

    turler = {"BF16": torch.bfloat16, "F16": torch.float16, "F32": torch.float32, "F64": torch.float64, "I64": torch.int64,
              "I32": torch.int32, "I16": torch.int16, "I8": torch.int8, "U8": torch.uint8, "BOOL": torch.bool}
    with open(yol, "rb") as f:
        n = struct.unpack("<Q", f.read(8))[0]
        baslik = json.loads(f.read(n))
        esleme = mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_COPY)    # yazılırsa kopyalanır; dosya değişmez
    sozluk = {}
    for ad, b in baslik.items():
        if ad == "__metadata__":
            continue
        bas, bit = b["data_offsets"]
        adet = math.prod(b["shape"])
        if adet == 0:
            sozluk[ad] = torch.empty(b["shape"], dtype=turler[b["dtype"]])
            continue
        sozluk[ad] = torch.frombuffer(esleme, dtype=turler[b["dtype"]], count=adet, offset=8 + n + bas).reshape(b["shape"])
        assert sozluk[ad].element_size() * adet == bit - bas, f"{ad}: boy tutmuyor"
    return sozluk


class VoxUretici:
    """VoxCPM2. Kullanılan arayüz (voxcpm 2.0.3 kaynağından doğrulandı):
      VoxCPM.from_pretrained(hf_model_id, load_denoiser=False, optimize=..., device=...)
      model.generate_streaming(text=..., reference_wav_path=..., cfg_value=..., inference_timesteps=...)
        → her adımda tek boyutlu float32 numpy dizisi (yaklaşık 160 ms), hızı model.tts_model.sample_rate (48000)
    Yarım hassasiyet kitaplıkta bir parametre değildir: modelin config.json dosyasındaki "dtype" alanından okunur
    (yayımlanan değer bfloat16). Başka bir değer istenirse o alanı değiştirilmiş bir kopya klasör kullanılır."""

    def __init__(self):
        import torch
        from huggingface_hub import hf_hub_download, snapshot_download

        self.torch = torch
        if not torch.cuda.is_available() and not _acik("SES_CPU_IZIN", "0"):
            raise RuntimeError("Ekran kartı görünmüyor (CUDA yok). nvidia-container-toolkit kurulu mu?")
        self.cihaz = "cuda" if torch.cuda.is_available() else "cpu"
        durum_yaz(asama="Model indiriliyor (ilk açılışta yaklaşık 5 GB)")
        yol = MODEL if os.path.isdir(MODEL) else self._indir(lambda: snapshot_download(repo_id=MODEL))
        yol = self._tur_ayarla(Path(yol))
        durum_yaz(asama="Ses örneği indiriliyor")
        self.sesler = {"varsayilan"}
        self.nefes = None
        try:
            if NEFES_YOL:
                if not os.path.isfile(NEFES_YOL):
                    raise FileNotFoundError(NEFES_YOL)
                self.nefes = NEFES_YOL
            else:
                self.nefes = self._indir(lambda: hf_hub_download(NEFES_DEPO, NEFES_DOSYA), deneme=2)
                for ek in ("NOTICE", "LICENSE"):      # atıf ve lisans metni ses kaydının yanında dursun
                    try:
                        hf_hub_download(NEFES_DEPO, ek)
                    except Exception:
                        pass
            self.sesler.add("nefes")
        except Exception as h:
            gunluk.warning("Nefes ses örneği indirilemedi, yalnızca modelin kendi sesi kullanılabilir: %s", h)
        durum_yaz(asama="Model ekran kartına yükleniyor" + (" ve derleniyor (birkaç dakika)" if DERLE else ""))
        self.derleme, self.az_ram = DERLE and self.cihaz == "cuda", False
        self.model = self._yukle(str(yol))
        self.hiz = int(self.model.tts_model.sample_rate)
        # Isınma: her ses için kısa bir üretim. İlk çağrıdaki tek seferlik hazırlıklar (örnek sesin okunması,
        # derleme) panelde ölçülen ilk denemeye yansımasın.
        durum_yaz(asama="Isınıyor (kısa deneme üretimi)")
        for ad in sorted(self.sesler):
            try:
                bas, uretec = time.time(), self.uret("Merhaba, hoş geldiniz.", ad)
                try:
                    for i, _ in enumerate(uretec):
                        if i >= 30:
                            break
                finally:
                    uretec.close()
                gunluk.info("Isınma (%s): %.1f sn", ad, time.time() - bas)
            except Exception as h:
                gunluk.warning("Isınma üretimi (%s) olmadı: %s", ad, str(h)[:300])
        self.bosalt()

    @staticmethod
    def _indir(islev, deneme: int = 4):
        for i in range(deneme):
            try:
                return islev()
            except Exception as h:
                if i == deneme - 1:
                    raise
                gunluk.warning("İndirme başarısız (%s), 20 sn sonra yeniden denenecek", str(h)[:200])
                time.sleep(20)

    @staticmethod
    def _tur_ayarla(yol: Path) -> Path:
        """SES_YARIM_HASSASIYET modelin config.json'undaki dtype ile uyuşmuyorsa, o alanı değiştirilmiş bir kopya
        klasör hazırlar (büyük dosyalar kopyalanmaz, bağ verilir)."""
        ayar = json.loads((yol / "config.json").read_text(encoding="utf-8"))
        yarim_mi = str(ayar.get("dtype", "")).lower() in ("bfloat16", "bf16", "float16", "fp16")
        if yarim_mi == YARIM:
            return yol
        hedef = VERI / ("model-" + ("bfloat16" if YARIM else "float32"))
        hedef.mkdir(parents=True, exist_ok=True)
        for d in yol.iterdir():
            b = hedef / d.name
            if d.name != "config.json":
                if b.is_symlink() or b.exists():
                    b.unlink()              # model sürümü değişmiş olabilir: bağlar her açılışta yenilenir
                b.symlink_to(d.resolve())
        ayar["dtype"] = "bfloat16" if YARIM else "float32"
        (hedef / "config.json").write_text(json.dumps(ayar), encoding="utf-8")
        gunluk.warning("Model hassasiyeti %s olarak değiştirildi (SES_YARIM_HASSASIYET)", ayar["dtype"])
        return hedef

    def _yukle(self, yol: str):
        from voxcpm import VoxCPM

        def kur(derle: bool):
            # load_denoiser=False: gürültü giderici (ayrı model, ayrı bellek) yüklenmez; örnek ses zaten temiz
            return VoxCPM.from_pretrained(yol, load_denoiser=False, optimize=derle, device=self.cihaz)

        def bosalt():
            import gc
            gc.collect()
            if self.cihaz == "cuda":
                self.torch.cuda.empty_cache()

        if AZ_RAM:
            yuklenen: set = set()
            try:
                with _az_ram_yukleme(self.cihaz, yuklenen):
                    model = kur(self.derleme)
                self._eksikleri_baslat(model.tts_model, yuklenen)
                self.az_ram = True
                return model
            except Exception as h:
                gunluk.warning("Az RAM'li yükleme olmadı (%s); olağan yolla yeniden deneniyor", str(h)[:300])
                model = None
                bosalt()
        # Olağan yol modeli önce sistem belleğinde kurar: ölçülen zirve yaklaşık 10,5 GB (+ağırlık dosyası 4,6 GB).
        # Bellek buna yetmiyorsa denemek kapsayıcının bellek sınırına takılıp öldürülmesi demektir; açıkça söylenir.
        ram = _ram_mb()
        if AZ_RAM and ram is not None and ram < OLAGAN_YOL_RAM_MB:
            raise RuntimeError(f"Az RAM'li yükleme başarısız oldu; olağan yükleme en az {OLAGAN_YOL_RAM_MB // 1000} GB sistem belleği ister, burada {ram} MB var")
        try:
            return kur(self.derleme)
        except Exception as h:
            if not self.derleme:
                raise
            gunluk.warning("Derlemeli açılış olmadı (%s); derlemesiz deneniyor", str(h)[:300])
            self.derleme = False
            bosalt()
            return kur(False)

    def _eksikleri_baslat(self, m, yuklenen: set):
        """Az RAM yolunda başlangıç değeri yazılmayan katmanlardan ağırlık dosyasında bulunmayan olursa (olağan
        yolda bunlar rastgele başlangıç değeriyle kalırdı) aynı başlangıç işlemi şimdi yapılır: sonuç olağan yolla
        aynı olur. Bir katmanın değerlerinin yalnızca bir kısmı eksikse karışmaz, hata verir (olağan yola dönülür)."""
        nn = self.torch.nn
        adlar = {ad for ad, _ in m.named_parameters() if not ad.startswith("audio_vae.")}
        eksik = {ad for ad in adlar if ad.replace("._orig_mod", "") not in yuklenen}
        for modul_adi in sorted({ad.rpartition(".")[0] for ad in eksik}):
            modul = m.get_submodule(modul_adi)
            if not isinstance(modul, (nn.Linear, nn.Embedding)):
                continue        # bu katmanların başlangıç değeri atlanmadı; olağan yoldaki gibi duruyor
            kendi = {f"{modul_adi}.{ad}" for ad, _ in modul.named_parameters(recurse=False)}
            if not kendi <= eksik:
                raise RuntimeError(f"{modul_adi} katmanının değerleri ağırlık dosyasında kısmen eksik")
            with self.torch.no_grad():
                modul.reset_parameters()
            gunluk.warning("Ağırlık dosyasında olmayan katman başlangıç değeriyle bırakıldı: %s", modul_adi)

    def uret(self, metin: str, ses: str):
        ek = {}
        if ses == "nefes":
            ek["reference_wav_path"] = self.nefes
            if NEFES_METIN:
                ek.update(prompt_wav_path=self.nefes, prompt_text=NEFES_METIN)
        yield from self.model.generate_streaming(text=metin, cfg_value=CFG, inference_timesteps=ADIM, **ek)

    def bosalt(self):
        if BELLEK_BOSALT and self.cihaz == "cuda":
            self.torch.cuda.empty_cache()


def _ram_mb() -> int | None:
    """Bu sürecin kullanabileceği sistem belleği (MB): kapsayıcı sınırı ile makinedeki boş belleğin küçüğü."""
    degerler = []
    try:
        ham = Path("/sys/fs/cgroup/memory.max").read_text().strip()
        if ham.isdigit():
            degerler.append(int(ham) // 2**20)
    except OSError:
        pass
    try:
        for satir in Path("/proc/meminfo").read_text().splitlines():
            if satir.startswith("MemAvailable:"):
                degerler.append(int(satir.split()[1]) // 1024)
    except OSError:
        pass
    return min(degerler) if degerler else None


# ---------- Durum ----------
DURUM = {"hazir": False, "durum": "yukleniyor", "asama": "Başlıyor", "hata": None, "yukleme_sn": None}
URETICI = None
SON: dict = {}
_sayac = 0
_baslangic = time.time()


def durum_yaz(**k):
    DURUM.update(k)
    if "asama" in k:
        gunluk.info("%s", k["asama"])


def _yukleyici():
    global URETICI
    bas = time.time()
    try:
        URETICI = SahteUretici() if SAHTE else VoxUretici()
        durum_yaz(hazir=True, durum="hazir", asama="Hazır", yukleme_sn=round(time.time() - bas, 1))
        gunluk.info("Model hazır: %.1f sn, cihaz %s, derleme %s, az RAM yolu %s", time.time() - bas, URETICI.cihaz, URETICI.derleme, URETICI.az_ram)
    except BaseException as h:      # bellek yetmezliği dahil: süreç ayakta kalsın, /saglik hatayı söylesin
        gunluk.exception("Model yüklenemedi")
        durum_yaz(durum="hata", asama="Yüklenemedi", hata=f"{type(h).__name__}: {str(h)[:300]}", yukleme_sn=round(time.time() - bas, 1))


def _vram() -> tuple[int | None, int | None]:
    """(kullanılan, toplam) MB; kartın tamamı için (başka süreçler dahil). torch henüz yüklenmediyse None."""
    torch = sys.modules.get("torch")
    try:
        if torch is not None and torch.cuda.is_available():
            bos, toplam = torch.cuda.mem_get_info()
            return round((toplam - bos) / 2**20), round(toplam / 2**20)
    except Exception:
        pass
    return None, None


def _indirilen_mb() -> int | None:
    try:
        kok = Path(os.environ.get("HF_HOME", VERI / "hf"))
        return round(sum(d.stat().st_size for d in kok.rglob("*") if d.is_file() and not d.is_symlink()) / 2**20)
    except Exception:
        return None


@asynccontextmanager
async def omur(_app):
    _app.state.kilit = asyncio.Lock()
    threading.Thread(target=_yukleyici, name="yukleyici", daemon=True).start()
    yield


app = FastAPI(title="XRE ses sunucusu", lifespan=omur, docs_url=None, redoc_url=None, openapi_url=None)


def hata(kod: int, metin: str) -> JSONResponse:
    return JSONResponse({"detail": metin}, status_code=kod, headers={"Cache-Control": "no-store"})


@app.get("/saglik")
async def saglik():
    kullanilan, toplam = _vram()
    v = {"hazir": DURUM["hazir"], "durum": DURUM["durum"], "asama": DURUM["asama"], "model": "sahte" if SAHTE else MODEL,
         "cihaz": getattr(URETICI, "cihaz", None), "vram_mb_kullanilan": kullanilan, "vram_mb_toplam": toplam,
         "yukleme_sn": DURUM["yukleme_sn"] if DURUM["yukleme_sn"] is not None else round(time.time() - _baslangic, 1),
         "mesgul": app.state.kilit.locked(), "sesler": sorted(getattr(URETICI, "sesler", [])),
         "yarim_hassasiyet": YARIM, "derleme": getattr(URETICI, "derleme", None), "az_ram": getattr(URETICI, "az_ram", None)}
    if DURUM["durum"] == "yukleniyor" and not SAHTE:
        v["indirilen_mb"] = await asyncio.to_thread(_indirilen_mb)
    if DURUM["hata"]:
        v["hata"] = DURUM["hata"]
    return v


@app.get("/son")
async def son():
    return SON or {"istek_no": 0}


def _uretim(no: int, metin: str, ses: str, kuyruk: asyncio.Queue, dongu, iptal: threading.Event, bekleme: float):
    """Ayrı iş parçacığında çalışır (model çağrısı bekletir). Parçaları kuyruğa koyar: ("ses", bayt, ilk_ms) |
    ("hata", metin) | ("bitti",). Ölçümler üretim başından itibarendir; sırada bekleme ayrıca yazılır."""
    global SON
    koy = lambda *o: dongu.call_soon_threadsafe(kuyruk.put_nowait, o)   # noqa: E731
    bas, ilk, ornek, sorun, kesildi, ind = time.perf_counter(), None, 0, None, False, None
    torch = sys.modules.get("torch") if getattr(URETICI, "cihaz", "") == "cuda" else None
    try:
        if torch:
            torch.cuda.reset_peak_memory_stats()
        ind = Indirgeyici(URETICI.hiz, HEDEF_HIZ)
        uretec = URETICI.uret(metin, ses)
        try:
            for parca in uretec:
                if iptal.is_set():
                    kesildi = True
                    break
                veri = pcm16(ind.isle(parca))
                if not veri:
                    continue
                if ilk is None:
                    ilk = time.perf_counter() - bas
                    koy("ses", wav_basligi(ind.hiz) + veri, round(ilk * 1000))
                else:
                    koy("ses", veri)
                ornek += len(veri) // 2
                if ornek / ind.hiz >= AZAMI_SN:
                    gunluk.warning("#%d en uzun süreye (%s sn) ulaştı, kesildi", no, AZAMI_SN)
                    kesildi = True
                    break
        finally:
            uretec.close()
        if ilk is None and not kesildi:
            sorun = "Model ses üretmedi"
    except BaseException as h:
        gunluk.exception("#%d üretim hatası", no)
        bellek = "out of memory" in str(h).lower()
        sorun = "Ekran kartı belleği yetmedi" if bellek else f"Ses üretilemedi ({type(h).__name__})"
    finally:
        toplam = time.perf_counter() - bas
        sure = ornek / ind.hiz if ind else 0.0
        SON = {"istek_no": no, "ilk_ses_ms": None if ilk is None else round(ilk * 1000), "toplam_ms": round(toplam * 1000),
               "ses_suresi_sn": round(sure, 3), "rtf": round(toplam / sure, 3) if sure > 0 else None, "karakter": len(metin),
               "ses": ses, "ornekleme_hizi": ind.hiz if ind else None, "bekleme_ms": round(bekleme * 1000),
               "tamamlandi": sorun is None and not kesildi, "zaman": int(time.time())}
        if sorun:
            SON["hata"] = sorun
        if torch:
            try:
                SON["vram_zirve_mb"] = round(torch.cuda.max_memory_allocated() / 2**20)
            except Exception:
                pass
        try:
            getattr(URETICI, "bosalt", lambda: None)()
        except Exception:
            pass
        gunluk.info("#%d ses=%s karakter=%d ilk_ses=%s ms toplam=%d ms ses=%.2f sn rtf=%s bekleme=%d ms%s", no, ses, len(metin),
                    SON["ilk_ses_ms"], SON["toplam_ms"], sure, SON["rtf"], SON["bekleme_ms"], f" HATA: {sorun}" if sorun else "")
        koy("hata", sorun) if sorun else koy("bitti")
        dongu.call_soon_threadsafe(app.state.kilit.release)     # kart ancak şimdi boş: sıradaki başlayabilir


@app.post("/ses")
async def ses(request: Request):
    global _sayac
    try:
        g = await request.json()
    except Exception:
        return hata(400, "Geçersiz istek: JSON bekleniyor")
    if not isinstance(g, dict) or not isinstance(g.get("metin"), str):
        return hata(400, "Geçersiz istek: metin alanı gerekli")
    metin = metni_hazirla(g["metin"])
    if not metin:
        return hata(400, "Seslendirilecek metni yazın")
    if len(metin) > METIN_SINIRI:
        return hata(400, f"Metin en çok {METIN_SINIRI} karakter olabilir")
    secim = g.get("ses") or "nefes"
    if secim not in SESLER:
        return hata(400, "Bilinmeyen ses (nefes ya da varsayilan)")
    if not DURUM["hazir"]:
        return hata(503, "Model yüklenemedi: " + (DURUM["hata"] or "") if DURUM["durum"] == "hata" else "Model yükleniyor, biraz sonra tekrar deneyin")
    if secim not in URETICI.sesler:
        return hata(503, "Nefes ses örneği indirilemedi; şimdilik yalnızca modelin kendi sesi kullanılabilir")
    kilit: asyncio.Lock = app.state.kilit
    t0 = time.perf_counter()
    try:
        await asyncio.wait_for(kilit.acquire(), BEKLEME_SN)
    except asyncio.TimeoutError:
        return hata(503, f"Ses sunucusu meşgul: {BEKLEME_SN:g} saniye sırada beklendi. Biraz sonra tekrar deneyin")
    _sayac += 1
    no, kuyruk, iptal = _sayac, asyncio.Queue(), threading.Event()
    try:
        threading.Thread(target=_uretim, name=f"uretim-{no}", daemon=True,
                         args=(no, metin, secim, kuyruk, asyncio.get_running_loop(), iptal, time.perf_counter() - t0)).start()
    except BaseException:
        kilit.release()
        raise
    # İlk parça beklenir: hata bu aşamada çıkarsa düzgün bir hata cevabı verilebilir (akış başladıktan sonra verilemez)
    try:
        ilk = await asyncio.wait_for(kuyruk.get(), ILK_SES_SN)
    except asyncio.TimeoutError:
        iptal.set()
        return hata(504, f"Model {ILK_SES_SN:g} saniyede ses üretmeye başlamadı")
    except BaseException:           # istemci vazgeçti
        iptal.set()
        raise
    if ilk[0] != "ses":
        return hata(500, ilk[1] if ilk[0] == "hata" else "Model ses üretmedi")

    async def akis():
        try:
            yield ilk[1]
            while True:
                o = await kuyruk.get()
                if o[0] != "ses":
                    break               # bitti ya da yarıda hata: akış kapanır, ayrıntı /son içinde
                yield o[1]
        finally:
            iptal.set()                 # istemci yarıda bıraktıysa üretim de dursun

    return StreamingResponse(akis(), media_type="audio/wav", headers={
        "X-Istek-No": str(no), "X-Ilk-Ses-Ms": str(ilk[2]), "X-Ornekleme-Hizi": str(Indirgeyici(URETICI.hiz, HEDEF_HIZ).hiz),
        "X-Karakter": str(len(metin)), "Cache-Control": "no-store"})
