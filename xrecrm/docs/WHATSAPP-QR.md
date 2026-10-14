# WhatsApp: kayıtsız numaraya ve şablonsuz yazma (WhatCRM tarzı)

## İki tür hat
| | QR hattı (Evolution API) | Meta hattı (resmî Cloud API) |
| --- | --- | --- |
| Bağlantı | Telefonla QR okutulur (WhatsApp Web gibi) | Meta Business onayı |
| Kayıtsız numaraya ilk mesaj | Serbest metin, şablon gerekmez | Yalnız onaylı şablon |
| Son 24 saatte yazan kişiye | Serbest | Serbest |
| Risk | Resmî değil; toplu/hızlı mesajda numara kısıtlanabilir | Resmî; kurallara uyulduğu sürece güvenli |

XRE CRM her iki türü birlikte kullanır. Mesaj kutusunda gönderen hattı seçersiniz.

## Kurulum (QR hattı)
1. Sunucuda Docker kurulu olmalı. `deploy/evolution` klasöründe `docker-compose.yml` içindeki
   `AUTHENTICATION_API_KEY` değerini uzun rastgele bir anahtarla değiştirin ve `docker compose up -d` çalıştırın.
2. XRE CRM → Entegrasyonlar → Anahtarlar → **WhatsApp QR (Evolution API)**: adres `http://127.0.0.1:8080`, anahtar.
   Genel → İzinli iç ağ adreslerine `127.0.0.1` yazın.
3. Evolution'ın CRM'e mesaj iletebilmesi için Webhook sırrı girin; CRM dışarıdan erişilebilir değilse
   Evolution aynı makinede olduğu sürece `EVOLUTION_WEBHOOK_URL=http://127.0.0.1:3000/api/webhooks/evolution` yeterlidir.
4. WhatsApp → Bağlantılar → hattın yanındaki **QR** ile telefondan okutun (WhatsApp → Bağlı cihazlar → Cihaz bağla).

## Kullanım
- **Yeni sohbet**: numarayı yazın, isterseniz "WhatsApp'ta var mı?" ile kontrol edin, ilk mesajı gönderin.
- Gelen mesajlar varsayılan olarak **müşteri kartı açmaz**; sohbet "Kayıtsız" etiketiyle durur.
  "Müşteri olarak kaydet" ile müşteri açılır ve eski mesajlar karta bağlanır.
  Her yeni numara için otomatik müşteri istenirse: Entegrasyonlar → WhatsApp QR → "Gelen mesajda otomatik müşteri aç" = 1.
- Meta hattında 24 saat penceresi kapalıysa ekranda uyarı çıkar ve **Şablon gönder** açılır
  (Meta → WhatsApp Business Hesap ID girilmiş olmalı).

## Numaranızı korumak için
- Hat başına günlük **yeni kişi sınırı** (varsayılan 40) ve mesajlar arası en az süre (varsayılan 1,5 sn) uygulanır.
- Yeni açılmış numaralarla ilk günlerde az sayıda kişiye yazın; aynı metni toplu göndermeyin.
- Kişilerin sizi engellemesi/şikâyet etmesi en büyük risktir; ilk mesajda kim olduğunuzu açıkça yazın.
- Ticari ileti gönderiminde İYS (İleti Yönetim Sistemi) onayı ve KVKK aydınlatma yükümlülüklerini gözetin.
