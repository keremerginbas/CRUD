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

## AI Asistan, Canlı ve Raporlar sekmeleri

- **AI Asistan:** Bilgi tabanına (en fazla 40.000 karakter: projeler, fiyatlar, ödeme planları, SSS) dayanarak müşteriye WhatsApp'tan kendisi cevap verir.
  - 7/24 ya da yalnız mesai dışında çalışır.
  - Müşteri art arda yazarsa birkaç saniye bekleyip tek cevap verir. Müşterinin dilinde yazar.
  - Bilmediği konularda, pazarlıkta, randevuda ya da müşteri insan isterse sohbeti temsilciye devreder. Sohbet başına cevap sınırına ulaştığında da devreder.
  - Temsilci Bitrix'ten yazdığı an o sohbette susar (varsayılan 12 saat).
  - Verdiği her cevap Bitrix sohbetine "🤖" notuyla düşer.
  - "Deneyin" kutusunda, müşteriye bir şey gitmeden önce denenebilir.
- **Canlı:** 20 saniyede bir yenilenir. Gösterdikleri:
  - Çevrimiçi personel, aktif ve cevap bekleyen sohbetler.
  - Anlık mesaj akışı (müşteri / temsilci / AI).
  - Bugünkü lead ve anlaşmalar ile kazanılan tutar.
  - Lead kaynakları (Bitrix CRM).
- **Raporlar:** Günlük, haftalık (pazartesi) ve aylık (ayın 1'i) yönetici raporu, seçilen saatte oluşturulur.
  - Rapor bağlantısı seçilen bağlı numaradan yöneticilerin WhatsApp'ına gider, isteğe bağlı olarak Bitrix bildirimi olarak da düşer.
  - Rapor sayfası (`/b24/report/<anahtar>`) tahmin edilemez bir bağlantıdır ve arama motorlarına kapalıdır.
  - İçeriği: mesaj hacmi, ilk cevap süresi, temsilciler, numaralar, sıcak müşteriler, CRM sonuçları ve yapay zekâ yorumu (öne çıkanlar, riskler, öneriler).
  - "Anlık rapor oluştur" ile istendiğinde de hazırlanır.
  - Zamanlanmış gönderim için `PUBLIC_ORIGIN` tanımlı olmalı ya da panel bir kez açılıp ayarlar kaydedilmiş olmalı.

## XRE yönetimi (`/b24/admin`)

Portallar sekmesi firma firma listelenir. Firmaya tıklayınca numaraları açılır. Liste firma, alan adı ya da numarayla aranabilir. Seçilen numaraların lisansı oradan uzatılır.

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
| Gerekli izinler | `imconnector`, `imopenlines`, `crm`, `user_basic` (gerekirse `user`), `im` |
| Lisans sözleşmesi | `https://crm.xresoftware.com.tr/b24/legal/terms` |
| Gizlilik politikası | `https://crm.xresoftware.com.tr/b24/legal/privacy` |
| Destek | `https://crm.xresoftware.com.tr/b24/support` |

## Kendi portalınızda deneme (pazar yerine yüklemeden)

1. Bitrix'te **Uygulamalar → Geliştirici kaynakları → Diğer → Yerel uygulama** yolunu açın ve yeni bir uygulama oluşturun. "Sunucu" seçili olsun.
2. Yukarıdaki iki adresi ve izinleri girin, kaydedin.
3. Bitrix'in verdiği **client_id** ve **client_secret** değerlerini CRM'e girin: **Entegrasyonlar → Bitrix24 pazar yeri uygulaması**.
4. Bitrix'te uygulama ekranındaki **Yeniden yükle** butonuna basın. "XRE WhatsApp kuruldu" yazmalı.
5. **İletişim Merkezi**'nde "XRE WhatsApp" kutucuğu çıkar. Tıklayın, Açık Kanal seçin, QR'ı okutun.

## Pazar yerine yükleme

Uygulama `vendors.bitrix24.com` (geliştirici alanı) üzerinden yayımlanır; `partners.bitrix24.com` iş ortaklığı (kurulum/danışmanlık) programıdır, uygulama yüklemek için gerekmez. Kart metinleri, ikon, ekran görüntüleri ve adım adım kontrol listesi: [market/LISTING.md](market/LISTING.md).

Bitrix24 Market kurallarına göre hazırladıklarım:

- **İngilizce arayüz:** Bitrix'in gönderdiği dil Türkçe değilse panel, kurulum ve ayar sayfaları, hata mesajları, sohbet notları ve raporlar İngilizce. Çeviri hedefi portal dili.
- **Yasal sayfalar:** `/b24/legal/terms` (lisans sözleşmesi), `/b24/legal/privacy` (gizlilik), `/b24/support` (destek). İngilizce varsayılan, `?lang=tr` Türkçe. Unvan ve iletişim bilgileri Entegrasyonlar ekranından gelir.
- **REST kayıtları:** her Bitrix REST çağrısı (belirteçsiz, kısaltılmış) `data/b24-rest/YYYY-MM-DD.log` dosyasına yazılır ve 7 gün saklanır (kural: en az 3 gün).
- **Kaldırma:** WhatsApp oturumları kapanır; belirteçler, sohbet geçmişi, istatistik, rapor ve medya silinir. Numara adları ve ödenmiş lisanslar korunur.
- **Medya:** Bitrix'e aktarılan dosyalar 8 gün sonra sunucudan silinir.
- **Kurulum:** kurulum bitince Bitrix uygulamayı yeniden yükler ve yönetim paneli açılır (boş sayfa kalmaz).

## Güvenlik

- Kurulum belirteci Bitrix'in OAuth sunucusunda (oauth.bitrix.info), uygulamanın gizli anahtarıyla doğrulanır. Portal kimliği ve adresi oradan alınır. Sahte bir "Bitrix" sunucusuyla portal kaydedilemez, kaldırılmış bir portalın kimliği ele geçirilemez. Kurulumu yalnız portal yöneticisi yapabilir.
- Yönetim paneli ve kanal ayar ekranı yalnız portal yöneticisine açılır. Arka uçları 2 saatlik imzalı biletle çalışır.
- Bitrix olayları portalın `application_token` değeriyle doğrulanır. Değer ancak olayın erişim belirteci portalın kendi REST adresinde doğrulanırsa sabitlenir; sahte ilk olay kabul edilmez.
- Gelen medya Bitrix'e 7 gün geçerli, imzalı adreslerle verilir. Sunucudaki kopya 8 gün sonra silinir.
- Rapor bağlantıları tahmin edilemez (144 bit), arama motorlarına kapalı ve 90 gün geçerlidir.
- Müşteri mesajları yapay zekâya güvenilmeyen veri olarak verilir. Model yalnız metin üretir; hiçbir işlem tetiklemez.
- Uygulama kaldırılınca WhatsApp oturumları kapatılır; belirteçler ve müşteri verileri silinir.

## Henüz yapılmadı

- Hedef süreyi aşan sohbetler için yöneticiye Bitrix bildirimi (`im` izni gerekir).
- Kartla ödeme (iyzico / PayTR).
- Telefondan doğrudan yazılan mesajların Bitrix'e kopyalanması.
- AI asistan ve rapor saatleri için portal saat dilimi (şimdilik UTC+3).
