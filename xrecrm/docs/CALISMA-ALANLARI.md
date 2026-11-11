# Çalışma alanları ve ücretsiz kayıt

XRE CRM tek kurulumda birden çok firmaya hizmet verir. Her firma kendi çalışma alanında, kendi adresiyle çalışır:

| | Adres | Veri |
|---|---|---|
| XRE (kurulumu yapan ilk hesap) | `crm.xresoftware.com.tr` | Eskisi gibi; hiçbir şey değişmez |
| Kayıt olan firma (ör. "ahmet") | `crm.xresoftware.com.tr/ahmet` | Yalnız o firmaya ait; başka firma göremez |

## Nasıl çalışır

- **Kayıt:** Giriş ekranındaki "Firmanız için ücretsiz deneyin" bağlantısı (`/kayit`). Firma adı, adres kısa adı, ad soyad, e-posta ve şifre istenir. Kayıt biter bitmez firma kendi alanına girer.
- **Deneme süresi:** 5 gün (`XRE_TRIAL_DAYS` ile değişir). Süre dolunca alan kilitlenir, veriler silinmez. Firma ekranda WhatsApp ve e-posta ile size ulaşma düğmelerini görür.
- **Ekip:** Firma sahibi Çalışanlar ekranından kendi çalışanlarını ekler. Çalışanlar da aynı adresten (`/ahmet`) girer.
- **Yönetim:** XRE sahibi hesabının menüsünde **Firmalar** ekranı çıkar. Buradan kayıt olan firmaları görür, denemeyi 7 gün uzatır, alanı etkinleştirir (süresiz) veya askıya alırsınız.

## Yeni firmalarda açık ve kapalı olanlar

Açık: Genel bakış, Akış, CRM (kanban, liste, etkinlikler, takvim), Kişiler, Şirketler, Görevler, Ekip ve Çalışanlar, Şirket yapısı, Mesai, Erişim izinleri, Denetim günlüğü, CRM analitiği, Veri kalitesi, Otomasyonlar (görev oluşturma), Excel'den içe aktarma.

Kapalı (şimdilik): WhatsApp, Aramalar ve hat yönetimi, n8n, Webhooklar, Entegrasyon ayarları, XRE Asistan, Yedekler, Bitrix24'ten geçiş. Bu modüller XRE'nin kendi WhatsApp sunucusunu, santralini ve anahtarlarını kullanır; başka firmaya açılmaları için firma başına ayrı bağlantı gerekir (2. adım).

## Açma ve kapama

Özellik varsayılan olarak **kapalıdır**; kod canlıya kurulsa bile mevcut kullanım değişmez. Açmak için sunucudaki `.env` dosyasına ekleyin ve `kurulum.sh` çalıştırın:

```
XRE_SIGNUP=1
XRE_TRIAL_DAYS=5
```

Kapatmak için `XRE_SIGNUP=1` satırını silip yeniden `kurulum.sh` çalıştırın. Kapatınca yeni kayıt alınmaz; kayıtlı firmalar çalışmaya devam eder.

## E-posta doğrulaması

Sunucuda e-posta gönderimi (SMTP) ayarlıysa kayıt iki adımdır: firma formu doldurur, e-postasına gelen 6 haneli kodu girer, alan ancak o zaman açılır. Kod 30 dakika geçerlidir, 5 hatalı denemede iptal olur.

`.env` dosyasına ekleyin (değerlerde boşluk olmamalı) ve `kurulum.sh` ile `deneme-kur.sh` betiklerini yeniden çalıştırın:

```
SMTP_HOST=smtp.saglayiciniz.com
SMTP_PORT=465
SMTP_USER=xre.software@xre.com.tr
SMTP_PASS=e-posta-sifreniz
SMTP_FROM=xre.software@xre.com.tr
```

- `SMTP_PORT`: 465 (SSL) veya 587 (STARTTLS). Değerler e-posta sağlayıcınızın "giden sunucu" ayarlarıdır; Outlook ya da telefon kurulumunda kullandıklarınızla aynıdır.
- SMTP ayarı yoksa kayıt doğrulamasız çalışır; Firmalar ekranı bunu yazar.
- Gönderim hatası olursa: `docker logs xrecrm-crm 2>&1 | grep Doğrulama`

## Önce deneme kurulumunda deneyin

Canlıda açmadan önce ayrı bir adreste deneyebilirsiniz. Deneme kurulumunun verisi ayrıdır; canlı CRM'e ve WhatsApp'a dokunmaz.

1. DNS'e `test.crm.xresoftware.com.tr` için sunucu IP'sine bir A kaydı ekleyin.
2. Sunucuda:
   ```
   cd /opt/xre && git pull && sudo bash xrecrm/deploy/vps/deneme-kur.sh
   ```
3. `https://test.crm.xresoftware.com.tr` adresini açıp yönetici hesabını **hemen** oluşturun (ilk hesap sistem sahibi olur).
4. Gizli pencerede `/kayit` adresinden bir firma kaydedin ve deneyin.

Kaldırmak için: `sudo bash xrecrm/deploy/vps/deneme-kur.sh --kaldir`
