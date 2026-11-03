# XRE Franchise – Vapi otomasyonu kurulum notları

Workflow dosyası: `XRE_Franchise_Vapi_Anlasmalar.json`

## Akış

| Durum | Aşama | Sorumlu (anlaşma + kişi) |
|---|---|---|
| Karta **YAPAY ZEKA POTANSİYEL** aşamasında eklenir | Vapi arar ve kartı **YAPAY ZEKA ARIYOR** aşamasına taşır | Rüstem Sarıoğlan (27332) |
| Randevu verir | **YAPAY ZEKA RANDEVU OLUŞTURANLAR** + Rüstem'e randevu saatinde yapılacak iş + zaman akışına not | 27332 |
| İstemiyor / aranmak istemiyor | **YAPAY ZEKA OLUMSUZ** | 27332 |
| Ulaşılamadı / tekrar aranacak / sonuç belirsiz | **YAPAY ZEKA ARIYOR** aşamasında kalır, zaman akışına not | 27332 |
| Telefon numarası geçersiz | **YAPAY ZEKA OLUMSUZ** + not | 27332 |

- Kart mesai saati dışında eklendiyse (09:30–20:00, Pazar hariç) bir sonraki mesai başlangıcında aranır.
- Satış ekibinin ileri aşamaya taşıdığı kartlar Vapi sonucu nedeniyle geri çekilmez.
- Gelen aramalarda (inbound) anlaşma kartı telefon numarasından bulunur.

## İçe aktarmadan önce

1. JSON dosyasında `YOUR_WEBHOOK` ifadesini Bitrix gelen webhook kodunuzla değiştirin (tüm geçtiği yerlerde).
2. Gerekli Bitrix webhook izinleri: `crm`.
3. Aşama kodları: POTANSİYEL `C4:UC_E68BUC`, ARIYOR `C4:UC_5688TP`, RANDEVU `C4:UC_DEJOO8`, OLUMSUZ `C4:UC_B3W6CW`.

## İçe aktardıktan sonra

1. **Vapi - Franchise Aramasını Başlat** düğümünde credential olarak Vapi API anahtarını seçin
   (Header Auth: `Authorization` = `Bearer <VAPI_PRIVATE_KEY>`).
2. (İsteğe bağlı) Anlaşma kartında randevu tarihi için özel alan varsa,
   **Anlaşmayı Bul + Sonucu Belirle** düğümündeki `RANDEVU_UF_ALANI` değerine alan kodunu yazın.
3. Workflow'u **Active** yapın.
4. Bitrix: Satış otomasyonu → **YAPAY ZEKA POTANSİYEL** sütunundaki "Giden webhook" kuralının adresi:
   `https://<n8n-adresiniz>/webhook/franchise-vapi-deal-trigger` (Bitrix anlaşma ID'sini kendisi gönderir)
5. Vapi: Outbound ve Inbound asistanlarının **Server URL** alanı (Advanced → Server):
   `https://<n8n-adresiniz>/webhook/franchise-vapi-call-result`
   Server Messages içinde `end-of-call-report` seçili olmalı.

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
