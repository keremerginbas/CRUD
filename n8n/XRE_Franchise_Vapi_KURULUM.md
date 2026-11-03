# XRE Franchise – Vapi otomasyonu kurulum notları

- `XRE_Franchise_Vapi_Anlasmalar.json`: n8n workflow'u (anahtarlar yer tutucu olarak duruyor)
- `workflow_uret.py`: workflow'u yeniden üretir. Gerçek anahtarlar ortam değişkenlerinden okunur.
  Anahtarlı kopya (`*GIZLI*.json`) repoya yüklenmez.

```bash
BITRIX_WEBHOOK_KODU=... TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=... python3 workflow_uret.py XRE_Franchise_Vapi_Anlasmalar_GIZLI.json gizli
```

## Akış

| Durum | Sonuç | Sorumlu |
|---|---|---|
| Kart **YAPAY ZEKA POTANSİYEL MÜŞTERİLER**'e eklenir | Vapi arar, kart **YAPAY ZEKA ARIYOR**'a geçer | Rüstem Sarıoğlan (27332): anlaşma + kişi |
| Randevu verir (1. veya 2. aramada) | **Randevu Oluşturulan** (`C4:1`). "Randevu Tarihi ve Saati" alanı doldurulur, Rüstem'e yapılacak iş açılır, **Telegram grubuna bildirim** gider, müşteriye **Erccell ile randevu SMS'i** gider | Rüstem |
| İstemiyor | **YAPAY ZEKA OLUMSUZ** | Rüstem |
| 1. aramada ulaşılamadı (açmadı / meşgul / sesli mesaj / sonuç alınamadı) | **YAPAY ZEKA ULAŞILAMAYANLAR**. Ertesi gün 10:30'da tekrar aranır (Pazar ise Pazartesi) | Rüstem |
| 2. aramada da ulaşılamadı | **YAPAY ZEKA OLUMSUZ** | Rüstem |
| Telefon numarası geçersiz | **YAPAY ZEKA OLUMSUZ** + not | Rüstem |

- **Mesai saati:** Mesai dışında (09:30–20:00, Pazar hariç) eklenen kartlar bir sonraki mesai başlangıcında aranır.
- **Tekrar aramalar:** 10:30'da dakikada 3 arama hızıyla yapılır. Bu sınır Vapi'nin eş zamanlı arama limitine takılmamak için konuldu.
- **Gün sonu raporu:** Her gün 20:00'de Telegram grubuna gider. İçeriği:
  - aranan kişi sayısı
  - iletişime geçilen kişi sayısı
  - randevu sayısı
  - olumsuz sayısı
  - ulaşılamayan sayısı
  - toplam konuşma dakikası
  - (ek olarak) ertesi gün tekrar aranacak havuz ve Vapi maliyeti
- **Satış ekibinin kartları:** Satış ekibinin ileri aşamaya taşıdığı kartlar geri çekilmez.
- **Gelen aramalar:** Müşteri geri ararsa kart telefon numarasından bulunur. Gelen aramada net bir sonuç çıkmazsa aşama değişmez.

## n8n'e aldıktan sonra

1. **Vapi - Franchise Aramasını Başlat**, **Vapi - Tekrar Arama (2. deneme)** ve **Vapi - Bugünkü Aramalar** düğümlerinde credential olarak Vapi API anahtarını seçin (Header Auth: `Authorization` = `Bearer <VAPI_PRIVATE_KEY>`).
2. Telegram botu (@xre_rapor_bot) gruba üye olmalı.
   **Erccell - Randevu SMS** düğümünün en üstündeki `SMS_USER` / `SMS_PASSWORD` alanlarına West Point akışındaki Erccell bilgilerini yazın
   (ya da üretirken `ERCCELL_KULLANICI` / `ERCCELL_SIFRE` ortam değişkenlerini verin).
   SMS örneği: "Merhaba Kerem Berk, randevunuz 26.11.2026 saat 11:00 olarak planlanmistir. XRE'li gunler dileriz."
   Tarih/saat netleşmediyse (teyit uyarısı varsa) SMS gönderilmez; sonuç kartın zaman akışına not düşer.
3. Workflow'u **Active** yapın. Saatler workflow ayarlarında Europe/Istanbul olarak tanımlı.
4. Bitrix: **YAPAY ZEKA POTANSİYEL MÜŞTERİLER** sütunundaki "Giden webhook" kuralının adresi:
   `https://<n8n-adresiniz>/webhook/franchise-vapi-deal-trigger`
5. Vapi: Outbound ve Inbound asistanlarının **Server URL** alanı:
   `https://<n8n-adresiniz>/webhook/franchise-vapi-call-result`
   (`end-of-call-report` mesajı açık olmalı.)

## Vapi asistanına eklenecekler (tarih doğruluğu için)

Outbound sistem promptuna:

```
## TARİH BİLGİSİ
Bugün: {{bugun_gun}} {{bugunun_tarihi}}, saat {{su_anki_saat}} (Türkiye saati).
Takvim:
{{takvim}}
Müşteri "yarın", "perşembe", "haftaya salı" gibi bir gün söylerse tarihi SADECE bu takvimden bul.
Randevuyu kapatmadan önce gün, tarih ve saati müşteriye tekrar et:
"Perşembe, 5 Kasım saat 14:00'te görüşmek üzere, doğru mu?"
```

Structured output alanları:

- `arama_sonucu`: şu değerlerden biri: `randevu`, `olumsuz`, `tekrar_ara`, `ulasilamadi`.
- `appointment_date`: yalnızca `randevu` olduğunda doldurulur. Format `YYYY-MM-DD HH:mm`, Türkiye saati (örnek: `2026-11-05 14:00`).
- `dnc_talebi`: müşteri bir daha aranmak istemiyorsa `true`.
