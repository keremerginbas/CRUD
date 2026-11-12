# Orphion Pharma ve Rome Pharma web siteleri

Yayına alınacak dosyalar `orphion-pharma/` klasöründedir (sunucunun web köküne olduğu gibi yüklenir).

## Sayfaları güncelleme
İki site de Node.js ile derlenir (Node 18+ ve Python 3 gerekir):

    cd tools/web
    npm install          # ilk seferde
    npm run build        # iki site
    npm run build:orphion
    npm run build:rome

Derleme adımları (`tools/web/build.mjs`):
1. `tools/generate.py` HTML sayfalarını Tailwind CSS sınıflarıyla üretir.
2. Tailwind CSS (`tools/web/src/site.css`, `tailwind.config.cjs`) sitenin CSS'ini derler ve küçültür.
3. esbuild, `src/site.js` (menü, formlar, kaydırma animasyonları) ve `src/globe.js`
   (Three.js ile giriş bölümündeki 3D dünya) dosyalarını paketler.
4. Sayfalardaki `?v=` sürüm işaretleri dosya içeriğine göre doldurulur (tarayıcı önbelleği).

İçerikler:
- Sayfa düzenleri, hizmet metinleri: `tools/generate.py`, `tools/site_texts.py`
- Ortak veriler (ofisler, telefonlar, Hakkımızda, Başkanın mesajı, etkinlikler, KVKK): `tools/build_site.py`
- Rome'a özel metinler: `tools/build_rome.py`
- Marka renkleri: `tools/web/src/site.css` içindeki `[data-brand]` blokları; logolar değiştirilmeden kullanılır.
- 3D dünyadaki şehirler: `tools/generate.py` içindeki `CITIES` ve `SOURCES`.

Çıktı statik dosyalardır; sunucuda Node.js gerekmez. Formlar `contact.php` ile çalışır.
Sunucuya yüklerken web kökünü boşaltıp zip içeriğini yükleyin (`.well-known` klasörüne dokunmayın).

## Yayın öncesi yapılacaklar
- `tools/web/src/site.js` → `GA_MEASUREMENT_ID` alanına Google Analytics kimliğini yazın (boşsa Analytics yüklenmez).
- Google Search Console'da alan adını DNS ile doğrulayın ve `sitemap.xml` gönderin.
- `contact.php` sunucuda PHP `mail()` ile çalışır; hosting SMTP istiyorsa `send_mail()` fonksiyonunu uyarlayın.
- İletişim formu ve İnsan Kaynakları (CV ekli) başvuruları `fevziaydin@orphionpharma.com` adresine gider (`contact.php` → `MAIL_TO`).
- CV yükleme için PHP `upload_max_filesize` en az 6M olmalı (`.user.ini` bunu ayarlar; Plesk'te PHP Ayarları'ndan da kontrol edin).
- Partner logoları: `assets/images/partners/` klasörüne koyup `tools/build_site.py` içindeki `PARTNERS` listesine ekleyin.
- YK Başkanı fotoğrafı: `assets/images/` altına koyup `CHAIRMAN["photo"]` alanına yolunu yazın.
- `no-reply@orphionpharma.com` adresinin alan adı SPF kaydında izinli olduğundan emin olun.
- KVKK aydınlatma metnini (`kvkk.html`, `privacy-en.html`) bir hukukçuya kontrol ettirin.

## Rome Pharma
Yayına alınacak dosyalar `rome-pharma/` klasöründedir (romepharma.com web kökü).

    cd tools/web && npm run build:rome

Rome, aynı tasarımı kendi logosu, renkleri ve metinleriyle kullanır. İletişim kısmı
(ofisler, telefonlar) Orphion ile aynıdır; e-posta `fevziaydin@rome-pharma.com`.
