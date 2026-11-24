# J.A.R.V.I.S. Açılış Ekranı

Bilgisayar her açıldığında tam ekran bir JARVIS arayüzü açılır ve sesli olarak
selam verir, **hava durumunu** ve **bugünün takvimini** özetler:

> "Günaydın patron. İstanbul'da hava şu an 11 derece ve hafif yağmurlu. Gün içinde en yüksek
> 14 derece. Yağış ihtimali yüksek, şemsiyeni almayı unutma. Takviminde bugün 3 etkinlik var.
> Sıradaki, saat 10:30 itibarıyla: Ekip toplantısı. Bugün bolca işimiz var. Hadi kodlamaya başlayalım."

## Ayarlar — `ayarlar.js`
- `HITAP` — sana nasıl hitap etsin ("patron")
- `SEHIR` — hava durumu için şehir
- `TAKVIM_URL` — takviminin iCal (.ics) adresi (aşağıya bak)
- Kapanış cümleleri ve ses tercihi

### Takvim adresini bulma
- **Google Takvim:** calendar.google.com → ⚙ Ayarlar → soldan takvimini seç →
  "Takvimi entegre et" → **iCal biçimindeki gizli adres**
- **Apple / iCloud Takvim (Mac):** Takvim uygulamasında takvime sağ tık → Paylaşım Ayarları →
  **Herkese Açık Takvim** işaretle → linki kopyala (`webcal://...` olabilir, sorun değil)
- **Outlook:** Ayarlar → Takvim → Paylaşılan takvimler → Takvim yayımla → **ICS** linki

Birden fazla takvim: `TAKVIM_URL: "adres1,adres2"`

## Kurulum — macOS
Terminal'i aç (⌘ + Boşluk → "Terminal") ve klasörün olduğu yere göre:

```bash
bash ~/Downloads/jarvis/kur-mac.sh
```

Dosyalar `~/Jarvis` klasörüne kopyalanır ve her girişte açılır. Ayarlar: `open -e ~/Jarvis/ayarlar.js`
Kaldırmak: `bash ~/Jarvis/kaldir-mac.sh`

Tarayıcı sırası: Edge → Chrome → Brave → Safari. En iyi erkek Türkçe ses ("Ahmet") için Mac'e
**Microsoft Edge** kurmanı öneririm; yoksa macOS'un "Yelda" sesi kullanılır.

## Kurulum — Windows
1. `jarvis` klasörünü kalıcı bir yere kopyala (ör. `C:\Jarvis`).
2. `kur.bat` → çift tıkla. Hemen denemek için `baslat.vbs`.
3. Kaldırmak: `kaldir.bat`

## Kullanım
- **ESC**: ekranı kapat · **Boşluk**: tekrar söylet
- Tarayıcı sesi engellerse ekranda **SİSTEMİ BAŞLAT** çıkar; bir tık yeterli.
- Hava durumu Open-Meteo'dan gelir (ücretsiz, anahtar gerekmez). Hava ve sesler internet ister.
