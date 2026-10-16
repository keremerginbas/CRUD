# XRE WhatsApp: Bitrix24 pazar yeri uygulaması (Açık Kanal bağlayıcısı)

Bu uygulama Wazzup / ChatApp benzeri bir üründür. Müşteri XRE CRM'i hiç görmez:

1. Bitrix24'e uygulamayı kurar.
2. **İletişim Merkezi → XRE WhatsApp** kutucuğundan bir Açık Kanal seçer ve QR okutur.
3. WhatsApp mesajları Bitrix'in kendi sohbetine düşer. Temsilci Bitrix'ten cevap verir, cevap WhatsApp'tan gider. Bitrix, Açık Kanal ayarlarına göre lead ve kişi kartlarını kendisi açar.

Her Bitrix portalı (member_id) ayrı bir müşteridir. Her Açık Kanal için ayrı bir WhatsApp oturumu açılır (`b24-…` adlı Evolution oturumu). Bu veriler XRE CRM'in kendi çalışma alanına karışmaz.

## Yönetim paneli (Bitrix sol menüsündeki uygulama)

Bitrix yöneticisi uygulamayı açınca WhatCRM benzeri bir panel görür:

- **Bağlantılar:** "Bağlantı ekle" ile her WhatsApp numarası için Bitrix'te otomatik olarak ayrı bir Açık Kanal açılır ve QR okutulur. Bağlantılar yeniden adlandırılabilir, bağlantısı kesilebilir veya silinebilir.
- **Roller:** Her rolün hangi numaraları göreceği seçilir ("Tüm numaralar" ya da tek tek). Bir rol "varsayılan" yapılabilir; rol atanmamış personel bu rolü alır.
- **Personel:** Bitrix çalışanları listelenir, her birine rol atanır.

**Kim ne görür:** Rol veya personel değişince her Açık Kanal'ın operatör kuyruğu Bitrix'te güncellenir. Kuyrukta sadece rolü o numarayı içeren personel kalır. Sohbetler yalnız bu kişilere düşer; görünürlüğü Bitrix'in kendi Açık Kanal kuralı sağlar. Hiç rol oluşturulmadıysa kuyruklara dokunulmaz.

Yönetici olmayan personel uygulamayı açınca kendi rolünü ve görebildiği numaraları görür.

## WhatCRM'den farkımız (Ayarlar ve Performans sekmeleri)

Bu özellikler için CRM'de **Entegrasyonlar → Yapay zekâ asistanı ve n8n → OpenAI API anahtarı** girilmiş olmalıdır.

- **Otomatik çeviri:** Müşterinin dili algılanır. Türkçe olmayan mesaj temsilciye Türkçe çevirisi ve orijinaliyle gösterilir. Temsilcinin Türkçe cevabı müşterinin dilinde gider. `!` ile başlayan mesaj çevrilmeden gönderilir.
- **Sesli mesajı yazıya dökme:** Gelen sesli mesaj yazıya dökülür (gerekirse çevrilir). Ses dosyası da sohbette kalır.
- **Müşteri nitelendirme:** Üç mesajda bir sohbetten bütçe, bölge, tür, oda sayısı, amaç ve zaman çıkarılır, 0–100 arası bir puan verilir. Sonuç Bitrix'teki lead kartının (yoksa kişi kartının) zaman akışına yazılır. Bütçe lead'in fırsat tutarına işlenir.
- **Ekip performansı:** Temsilci başına ortalama ve en uzun ilk cevap süresi, gönderilen mesaj sayısı, numara başına yeni sohbet ve mesaj hacmi gösterilir. Yanıt bekleyen sohbetler listelenir, hedef süreyi aşanlar işaretlenir. Sıcak müşteriler puana göre sıralanır.

## Lisans ve ödeme

- **Model:** Her WhatsApp numarası ayrı lisans. Numara ilk kez bağlandığında ücretsiz deneme başlar (varsayılan 7 gün).
- **Süre dolunca:** O numaranın mesajları Bitrix'e aktarılmaz ve Bitrix'ten gönderilmez. WhatsApp oturumu açık kalır, lisans uzatılınca kaldığı yerden devam eder. Kartta "Lisans al" butonu çıkar.
- **Müşteri tarafı** (paneldeki **Ödeme** sekmesi):
  - Dönem seçer: 1, 3, 6 veya 12 ay; uzun dönemde indirim uygulanır.
  - Numaraları işaretleyip **Havale ile öde** der. Ekranda IBAN ve referans kodu (ör. `XRE-3F9A1C`) çıkar.
  - Ya da elindeki **lisans kodunu** girer.
  - Fatura bilgilerini (kurumsal veya bireysel) bu sekmeden kaydeder.
- **XRE yönetimi:** `https://crm.xresoftware.com.tr/b24/admin` adresi CRM'e sahip hesabıyla giriş yapılmışken açılır.
  - **Ödemeler:** Havale bildirimleri burada listelenir. **Onayla** deyince lisans kendiliğinden uzar.
  - **Portallar:** Her müşteri ve numarası listelenir. Seçilen numaraların lisansı elle uzatılabilir.
  - **Lisans kodları:** Süre ve numara sayısı belirlenerek tek kullanımlık kod üretilir.
  - **Fiyatlar:** Aylık fiyat, dönem indirimleri, deneme süresi, IBAN ve banka bilgisi buradan ayarlanır.
- **Ücretsiz portallar:** Kendi portalınız için **Entegrasyonlar → Bitrix24 pazar yeri uygulaması → Ücretsiz portallar** alanına alan adını yazın, lisans istenmez.

Kartla ödeme (iyzico / PayTR) bu kayıtların üzerine sonradan eklenecek; mevcut lisanslar değişmez.

## Adresler

| | |
|---|---|
| Kurulum yolu | `https://crm.xresoftware.com.tr/b24/install` |
| Uygulama (işleyici) yolu | `https://crm.xresoftware.com.tr/b24/app` |
| Gerekli izinler | `imconnector`, `imopenlines`, `im`, `crm`, `user`, `placement` |

## Kendi portalınızda deneme (pazar yerine yüklemeden)

1. Bitrix'te **Uygulamalar → Geliştirici kaynakları → Diğer → Yerel uygulama** yolunu açın ve yeni bir uygulama oluşturun. "Sunucu" seçili olsun.
2. Yukarıdaki iki adresi ve izinleri girin, kaydedin.
3. Bitrix'in verdiği **client_id** ve **client_secret** değerlerini CRM'e girin: **Entegrasyonlar → Bitrix24 pazar yeri uygulaması**.
4. Bitrix'te uygulama ekranındaki **Yeniden yükle** butonuna basın. "XRE WhatsApp kuruldu" yazmalı.
5. **İletişim Merkezi**'nde "XRE WhatsApp" kutucuğu çıkar. Tıklayın, Açık Kanal seçin, QR'ı okutun.

## Pazar yerine yükleme

1. vendors.bitrix24.com üzerinden partner (geliştirici) hesabı açılır.
2. Yeni uygulama oluşturulur. Aynı adresler ve izinler girilir.
3. Pazar yerinin verdiği client_id/secret CRM'e girilir. Kendi portalınızda denediğiniz yerel uygulamanın anahtarlarıyla aynı anda kullanılamaz; yayına geçerken pazar yeri anahtarlarına geçilir.
4. Açıklama, ekran görüntüleri ve fiyat girilip Bitrix'e incelemeye gönderilir.

## Güvenlik

- Kurulum belirteci, portalın kendi `user.current` çağrısıyla doğrulanır.
- Kanal ayar ekranını yalnız portal yöneticisi açabilir. Ekranın arka uçları 2 saatlik imzalı biletle çalışır.
- Bitrix olayları portalın `application_token` değeriyle doğrulanır. Değer ilk olayda kaydedilir, sonraki olaylar ona göre doğrulanır.
- Gelen medya Bitrix'e 7 gün geçerli, imzalı adreslerle verilir.
- Uygulama kaldırılınca portalın WhatsApp oturumları kapatılır, belirteçleri silinir.

## Henüz yapılmadı

- Hedef süreyi aşan sohbetler için yöneticiye Bitrix bildirimi (`im` izni gerekir).

- Kartla ödeme (iyzico / PayTR).
- Telefondan doğrudan yazılan mesajların Bitrix'e kopyalanması.
- Pazar yeri açıklama sayfası ve İngilizce arayüz.
