# XRE WhatsApp: Bitrix24 pazar yeri uygulaması (Açık Kanal bağlayıcısı)

Bu uygulama Wazzup / ChatApp benzeri bir üründür. Müşteri XRE CRM'i hiç görmez:

1. Bitrix24'e uygulamayı kurar.
2. **İletişim Merkezi → XRE WhatsApp** kutucuğundan bir Açık Kanal seçer ve QR okutur.
3. WhatsApp mesajları Bitrix'in kendi sohbetine düşer. Temsilci Bitrix'ten cevap verir, cevap WhatsApp'tan gider. Bitrix, Açık Kanal ayarlarına göre lead ve kişi kartlarını kendisi açar.

Her Bitrix portalı (member_id) ayrı bir müşteridir. Her Açık Kanal için ayrı bir WhatsApp oturumu açılır (`b24-…` adlı Evolution oturumu). Bu veriler XRE CRM'in kendi çalışma alanına karışmaz.

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

- Deneme süresi ve lisans/ödeme kontrolü.
- Telefondan doğrudan yazılan mesajların Bitrix'e kopyalanması.
- Pazar yeri açıklama sayfası ve İngilizce arayüz.
