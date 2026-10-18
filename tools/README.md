# Orphion Pharma web sitesi

Yayına alınacak dosyalar `orphion-pharma/` klasöründedir (sunucunun web köküne olduğu gibi yüklenir).

## Sayfaları güncelleme
HTML dosyaları `tools/build_site.py` ile üretilir. Metin, telefon, adres vb. değişiklikleri
bu dosyada yapıp şunu çalıştırın:

    python3 tools/build_site.py

## Yayın öncesi yapılacaklar
- `orphion-pharma/assets/js/main.js` → `GA_MEASUREMENT_ID` alanına Google Analytics kimliğini yazın (boşsa Analytics yüklenmez).
- Google Search Console'da alan adını DNS ile doğrulayın ve `sitemap.xml` gönderin.
- `contact.php` sunucuda PHP `mail()` ile çalışır; hosting SMTP istiyorsa `send_mail()` fonksiyonunu uyarlayın.
- İletişim formu ve İnsan Kaynakları (CV ekli) başvuruları `fevziaydin@orphionpharma.com` adresine gider (`contact.php` → `MAIL_TO`).
- CV yükleme için PHP `upload_max_filesize` en az 6M olmalı (`.user.ini` bunu ayarlar; Plesk'te PHP Ayarları'ndan da kontrol edin).
- Partner logoları: `assets/images/partners/` klasörüne koyup `tools/build_site.py` içindeki `PARTNERS` listesine ekleyin.
- YK Başkanı fotoğrafı: `assets/images/` altına koyup `CHAIRMAN["photo"]` alanına yolunu yazın.
- `no-reply@orphionpharma.com` adresinin alan adı SPF kaydında izinli olduğundan emin olun.
- KVKK aydınlatma metnini (`kvkk.html`, `privacy-en.html`) bir hukukçuya kontrol ettirin.
