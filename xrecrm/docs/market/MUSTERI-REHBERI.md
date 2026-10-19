# WhatsApp by XRE: müşterinin yolculuğu

Bu belge, bir firmanın uygulamayı bulmasından ödeme yapmasına kadar neler olduğunu anlatır. Aynı akış videoda da var: `WhatsApp-by-XRE-tr.mp4` (Türkçe) ve `WhatsApp-by-XRE-en.mp4` (İngilizce).

## 1. Kurulum (müşteri, 1 dakika)

1. Bitrix24'e **yönetici** hesabıyla girer. Uygulamayı yalnız portal yöneticisi kurabilir.
2. Sol menüden **Market** (Uygulamalar) bölümünü açar.
3. Arama kutusuna **WhatsApp by XRE** yazar ve uygulamayı açar.
4. **Yükle**'ye basar, izinleri ve lisans sözleşmesini onaylar.
5. Sol menüde **WhatsApp by XRE** belirir.

Arka planda olanlar:
- Bitrix uygulamaya bir kurulum anahtarı gönderir. Sunucu bu anahtarı Bitrix'e sorarak doğrular.
- Açık Kanal konnektörü ve CRM kartlarındaki "WhatsApp by XRE" sekmesi otomatik eklenir.
- Size "Yeni kurulum: firma.bitrix24.com" bildirimi gider (`B24_ADMIN_WEBHOOK` tanımlıysa).
- Firma, `/b24/admin` → **Portallar** listesine düşer.

## 2. İlk numara (müşteri, 2 dakika)

1. Uygulamada **Bağlantılar → Numara ekle**'ye basar ve bir ad yazar (ör. "Satış").
2. Bitrix'te bu numara için bir Açık Kanal açılır ve ekranda QR kodu çıkar.
3. Telefonda WhatsApp → **Ayarlar → Bağlı cihazlar → Cihaz bağla** ile QR'ı okutur.
4. Kart yeşile döner. **7 günlük ücretsiz deneme bu anda başlar.** Denemede tüm Pro+ özellikleri açıktır.

## 3. Ekibi ayarlama (müşteri, 5 dakika)

1. **Roller:** "Satış", "Destek" gibi roller oluşturur ve her rolün hangi numaraları göreceğini seçer.
2. **Personel:** Her çalışana bir rol verir. Çalışanlar, numaralarının Açık Kanal sırasına otomatik eklenir.
3. **Ayarlar:** Çeviri, sesli mesajı yazıya dökme ve AI değerlendirmeyi açar ya da kapatır.
4. İsteğe bağlı olarak **AI Asistan**, **Raporlar** ve **Kampanyalar** ayarlanır.

Bundan sonra WhatsApp mesajları Bitrix24 Açık Kanallarına ve CRM'e düşer. Ekip cevabı Bitrix'ten verir, cevap müşteriye WhatsApp'tan gider.

## 4. Deneme biterken

- Panelin üstünde sürekli "Ücretsiz deneme: X gün kaldı → Paket seç" bandı görünür.
- Bitişe 2 gün kala portal yöneticilerine Bitrix bildirimi gider.
- Deneme biterse o numaranın mesajları durur ve panelde kırmızı "Lisansı uzat" bandı çıkar. WhatsApp oturumu açık kalır; ödeme yapılınca mesajlar kaldığı yerden devam eder.

## 5. Ödeme

1. Müşteri **Ödeme** sekmesinde paketi (Basic $15 / Pro $25 / Pro+ $35, numara başına aylık), dönemi (1, 3, 6 veya 12 ay) ve numaraları seçer.
2. **Havale ile öde**'ye basar. Ekranda tutar, IBAN, SWIFT ve bir referans kodu (ör. `XRE-4F2A1C`) görünür.
3. Size "Havale bildirimi: firma · Pro · 2 numara · 12 ay · 390 USD · XRE-4F2A1C" bildirimi gider.
4. Para hesabınıza geçince `/b24/admin` → **Ödemeler** → **Onayla**'ya basarsınız. Lisans hemen açılır ve paketin özellikleri etkinleşir.

Başka bir yolla tahsilat yaptıysanız `/b24/admin` → **Lisans kodları**'ndan kod üretip müşteriye verin. Müşteri kodu Ödeme sekmesinde **Lisans kodu kullan** ile girer.

## 6. Yenileme ve sonrası

- Lisans bitişine 7 gün kala ve süre dolunca yöneticilere Bitrix bildirimi gider.
- `/b24/admin` → **Genel bakış** ekranında şunları izlersiniz: aylık yinelenen gelir, bu ayki tahsilat, bekleyen havaleler, denemeden ücretliye geçiş oranı ve süresi dolacak lisanslar.
- Müşteri uygulamayı kaldırırsa size "Uygulama kaldırıldı" bildirimi gider. Firmanın sohbet ve medya verileri silinir; ödenmiş lisans kaydı korunur.

## Destek

- E-posta: kaanince0408@gmail.com
- Telefon / WhatsApp: +90 505 035 29 40
- Yardım sayfası: https://crm.xresoftware.com.tr/b24/support
