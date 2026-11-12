# Orphion Pharma ve Rome Pharma web siteleri

Yayına alınacak dosyalar `orphion-pharma/` klasöründedir (sunucunun web köküne olduğu gibi yüklenir).

## Sayfaları güncelleme
İki site de `tools/build_v3.py` ile üretilir (şablonsuz v3 tasarım):

    python3 tools/build_v3.py            # iki site
    python3 tools/build_v3.py orphion    # yalnızca Orphion
    python3 tools/build_v3.py rome       # yalnızca Rome

- Tasarım: `tools/v3/site.css`, `tools/v3/site.js`, yazı tipleri `tools/v3/fonts/`.
- Sayfa düzenleri, hizmet metinleri, misyon/vizyon ve ana sayfa metinleri: `tools/build_v3.py`.
- Ortak içerik verileri (ofisler, telefonlar, Hakkımızda, Başkanın mesajı, etkinlikler, KVKK metni):
  `tools/build_site.py`; Rome'a özel metinler: `tools/build_rome.py`.
- Renkler `build_v3.py` içindeki `TOKENS` sözlüğündedir; logolar değiştirilmeden kullanılır.
- Her çalıştırmada `assets/` klasörü baştan kurulur; eski şablon dosyaları silinir.

Sunucuya yüklerken eski şablon dosyalarını (assets/css/main.css, bootstrap, eski görseller)
silin; en temizi web kökünü boşaltıp zip içeriğini yüklemektir (`.well-known` klasörüne dokunmayın).

## Yayın öncesi yapılacaklar
- `tools/v3/site.js` → `GA_MEASUREMENT_ID` alanına Google Analytics kimliğini yazın (boşsa Analytics yüklenmez).
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

    python3 tools/build_v3.py rome

Rome, aynı tasarımı kendi logosu, renkleri ve metinleriyle kullanır. İletişim kısmı
(ofisler, telefonlar) Orphion ile aynıdır; e-posta `fevziaydin@rome-pharma.com`.
