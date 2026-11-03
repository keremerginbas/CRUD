# XRE Franchise – Vapi otomasyonu kurulum notları

- `XRE_Franchise_Vapi_Anlasmalar.json`: n8n workflow'u (anahtarlar yer tutucu olarak duruyor)
- `workflow_uret.py`: workflow'u yeniden üretir. Gerçek anahtarlar ortam değişkenlerinden okunur.
  Anahtarlı kopya (`*GIZLI*.json`) repoya yüklenmez.

```bash
BITRIX_WEBHOOK_KODU=... TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=... python3 workflow_uret.py XRE_Franchise_Vapi_Anlasmalar_GIZLI.json gizli
```

## Akış

**Arama kuyruğu:** Her 3 dakikada bir çalışır. 3 Vapi numarasının her biri bir müşteri arar, yani 3 dakikada en fazla 3 arama yapılır.
Numaralar: 0533 743 60 24, 0533 743 68 03, 0533 743 60 04.
Kuyruk mesai saatlerinde (09:30–20:00, Pazar hariç) çalışır. Sırası şöyledir:
1. Ertesi gün 10:30'dan itibaren tekrar aranacak ulaşılamayanlar.
2. **YAPAY ZEKA POTANSİYEL MÜŞTERİLER** aşamasındaki kartlar, eskiden yeniye.

| Durum | Sonuç | Sorumlu |
|---|---|---|
| Kart kuyruktan alınıp aranır | **YAPAY ZEKA ARIYOR** | Rüstem Sarıoğlan (27332): anlaşma + kişi |
| Randevu verir (1. veya 2. aramada) | **Randevu Oluşturulan** (`C4:1`). "Randevu Tarihi ve Saati" alanı doldurulur, Rüstem'e yapılacak iş açılır, Telegram bildirimi gider, randevu SMS'i gider | Rüstem |
| İstemiyor | **YAPAY ZEKA OLUMSUZ** | Rüstem |
| 1. aramada ulaşılamadı | **YAPAY ZEKA ULAŞILAMAYANLAR**. "Sizi aradık, ulaşamadık" SMS'i gider (arayan numara ile). Ertesi gün 10:30'dan itibaren tekrar aranır | Rüstem |
| 2. aramada da ulaşılamadı | **YAPAY ZEKA OLUMSUZ**. "Tekrar aradık" SMS'i gider | Rüstem |
| Telefon numarası geçersiz | **YAPAY ZEKA OLUMSUZ** + not | Rüstem |

- **Arama başlatılamazsa:** Kart kuyruğa geri alınır. 3 başarısız denemeden sonra otomatik deneme durur ve karta not düşer.
- **Gün sonu raporu:** Her gün 20:00'de Telegram'a gider. Numara bazında giden arama sayısı da raporda yer alır.

## Kurulum

### Bitrix

**Hiçbir otomasyon kuralı gerekmez.** Workflow, Potansiyel aşamasındaki kartları 3 dakikada bir kendisi kontrol eder.
YAPAY ZEKA POTANSİYEL MÜŞTERİLER sütunundaki eski "Giden webhook" kuralını **silin**.

### Vapi

- **Outbound** ve **Inbound** asistanların her birinde **Server URL** = `https://xre111.shop/webhook/franchise-vapi-call-result`.
  Server Messages içinde `end-of-call-report` açık olmalı.
- **3 telefon numarasının her birinde:** Inbound Settings → Assistant = **XRE FRANCHISE - INBOUND**.
  Numaraların kendi **Server URL alanı BOŞ kalmalı.** Doluysa Vapi gelen aramada asistanı o adrese sorar ve gelen aramalar çalışmaz.

### n8n

1. Dosyayı içe aktarın.
2. **Vapi - Aramayı Başlat** ve **Vapi - Bugünkü Aramalar** düğümlerinde Vapi API anahtarını credential olarak seçin.
3. Telegram botunu (@xre_rapor_bot) gruba ekleyin.
4. Workflow'u **Active** yapın. Saatler Europe/Istanbul olarak tanımlı.

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
