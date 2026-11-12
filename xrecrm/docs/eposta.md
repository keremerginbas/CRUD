# E-posta entegrasyonu

Her kullanıcı **kendi posta kutusunu** bağlar; müşteri kartından e-posta gönderir, müşterinin
yanıtı aynı kartın "İletişim ve yorum geçmişi" bölümüne düşer.

## Posta kutusunu bağlama

**Profilim → E-posta** kartını açın, sağlayıcıyı seçin, adresinizi ve şifreyi yazıp
**Bağlantıyı test et ve kaydet**'e basın. Sistem gönderim (SMTP) ve gelen kutusu (IMAP) girişini
gerçekten dener; ikisi de başarılıysa kaydeder, değilse nedenini söyler ve hiçbir şey saklamaz.

### Gmail

Gmail normal şifreyle giriş kabul etmez; **uygulama şifresi** gerekir.

1. Google Hesabı → **Güvenlik** → **2 Adımlı Doğrulama**'yı açın.
2. <https://myaccount.google.com/apppasswords> adresini açın.
3. Uygulama adına `XRE CRM` yazıp **Oluştur**'a basın.
4. Çıkan 16 haneli şifreyi CRM'deki şifre alanına yapıştırın (boşluklar sorun olmaz).

Sunucu ayarları hazırdır: `smtp.gmail.com:465`, `imap.gmail.com:993`.
Google Workspace hesaplarında yönetici IMAP'i veya uygulama şifrelerini kapatmış olabilir.

### Outlook / Microsoft 365

Sunucu ayarları hazırdır: `smtp.office365.com:587` (STARTTLS), `outlook.office365.com:993`.

> **Dikkat:** Microsoft, Outlook.com/Hotmail ve birçok Microsoft 365 hesabında şifreyle
> (uygulama şifresi dahil) IMAP/SMTP girişini kapatmıştır; bu hesaplar yalnız "Microsoft ile
> oturum aç" (OAuth) yöntemini kabul eder ve bu sürümde **desteklenmez**. Kurumsal hesaplarda
> Microsoft 365 yöneticisi kullanıcı için **IMAP** ve **Kimliği doğrulanmış SMTP (SMTP AUTH)**
> iznini açarsa ve 2 adımlı doğrulama için bir uygulama şifresi
> (<https://mysignins.microsoft.com/security-info>) oluşturulursa bağlantı çalışır.
> Giriş reddedilirse CRM bunu açıkça bildirir.

### Diğer sağlayıcılar

**Diğer**'i seçip SMTP ve IMAP sunucu adını, portu ve (adresten farklıysa) kullanıcı adını girin.
Yalnız posta portları kabul edilir: SMTP 465 / 587 / 25, IMAP 993 / 143. Sunucu adı yerine IP
adresi ve yerel/özel ağ adresleri kabul edilmez. 587, 25 ve 143'te şifreli bağlantı (STARTTLS)
zorunludur.

## Kullanım

- Müşteri kartında **E-posta gönder** (veya yazma kutusundaki **E-posta** sekmesi): konu ve metni
  yazıp gönderin. Alıcı her zaman müşterinin kayıtlı e-posta adresidir (yoksa bağlı kişinin adresi).
- Geçmişteki bir e-postada **Yanıtla**: yanıt, aynı yazışma zincirine bağlanır.
- **Profilim → E-posta → Şimdi eşitle** ile beklemeden gelen kutusuna bakılır.

## Ne eşitlenir, ne eşitlenmez

| Eşitlenir | Eşitlenmez |
| --- | --- |
| CRM'den gönderdiğiniz e-postalar | Posta programından (Gmail/Outlook arayüzü) gönderdikleriniz |
| Gelen kutusuna (INBOX), **göndereni bir müşteri veya kişi kaydındaki adresle aynı olan** iletiler | Diğer tüm yazışmalarınız (gövdeleri sunucuya indirilmez) |
| Konu, tarih, düz metin, ek **adları** | Ek dosyaları, resimler, HTML biçimlendirme |
| | Gelen kutusu dışındaki klasörler (Spam, arşiv, etiketler) |

- Gelen kutusu yaklaşık **2 dakikada bir** okunur; iletiler "okundu" yapılmaz, kutuda hiçbir şey
  değiştirilmez veya silinmez.
- İlk bağlantıda son **7 günün** iletilerine bakılır.
- Aynı ileti (Message-ID) bir müşteri kartına yalnız bir kez yazılır.
- Karttaki yazışmaları, o müşteriyi görme yetkisi olan ekip üyeleri görür. Posta kutusu bağlantısı
  ve şifresi yalnız sahibine aittir; başka kullanıcı sizin kutunuzdan gönderemez.
- Bağlantı kaldırılınca şifre silinir; kartlardaki yazışma geçmişi kalır.

## Sınırlar

- Yalnız düz metin gönderilir; ek gönderimi yoktur. Konu en fazla 300, metin 50.000 karakter.
- Saklanan ileti metni 100.000 karakterle sınırlıdır (uzun iletiler kısaltılır).
- Gönderim: kullanıcı başına dakikada 10, günde 200 ileti (sağlayıcınızın kendi sınırı ayrıca geçerlidir).
- Bir eşitlemede en fazla 500 yeni ileti başlığına bakılır; kalanı sonraki turda alınır.
- Giriş hatasında yeniden deneme aralığı kademeli uzar (en çok 1 saat); hata Profilim'de görünür.

## Sunucu yöneticisi için

- Sunucudan dışarıya **465, 587 ve 993** (gerekirse 25, 143) portları açık olmalıdır. Bazı VPS
  sağlayıcıları 25/465/587'yi varsayılan kapalı tutar; destekten açtırmanız gerekebilir.
- Şifreler `XRE_SETTINGS_KEY` (yoksa `XRE_SESSION_SECRET`) ile AES-256-GCM şifreli saklanır.
  Bu anahtar değişirse kullanıcıların posta kutusunu yeniden bağlaması gerekir.
- İsteğe bağlı ayarlar: `XRE_EMAIL_POLL=0` (yoklamayı kapatır), `XRE_EMAIL_POLL_SECONDS`,
  `XRE_EMAIL_SEND_PER_MINUTE`, `XRE_EMAIL_SEND_PER_DAY`.
- Yoklama tek sunucu sürecinde çalışır; birden fazla süreç çalıştırıyorsanız yalnız birinde açık bırakın.
- Sistem e-postaları (kayıt doğrulama kodu vb.) bu özellikten bağımsızdır; `SMTP_*` ayarlarını kullanmaya devam eder.
