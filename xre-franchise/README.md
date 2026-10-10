# XRE Franchise — Kurucu 100

140.000 emlakçı adayına ulaşan outbound yapay zeka arama sistemi. AI **sadece niteler**
(satış yapmaz): XRE bilgisi, ofis durumu, bölge, ilgi, kısa görüşme isteği. İlgi gösteren
her adaya **tek tek** (toplu değil) WhatsApp'tan tanıtım videosu gönderilir, sonra insan
**franchise asistanı** arayıp sunum görüşmesi planlar.

## Akış

```
Bitrix: "Aranacak" statüsündeki adaylar (140K'lık havuzdan)
        │
        ▼
   01 · Arama Kuyruğu (her 3 dk, çalışma saatleri içinde)
        │  boşta hat bulur, adayı kilitler, Vapi aramasını başlatır
        ▼
   Vapi: XRE FRANCHISE - OUTBOUND asistanı arar (araç yok, sonuç çağrı sonu analizinden okunur)
        │
        ▼
   02 · Outbound ──► Bitrix güncellenir:
        ├─ DNC / yanlış kişi / olumsuz        → AI Görüştü (bir daha aranmaz)
        ├─ ulaşılamadı (deneme kaldıysa)      → Aranacak'ta kalır, tekrar planlanır
        ├─ ulaşılamadı (tükendi)              → AI Görüştü
        ├─ geri aranacak                      → Aranacak'ta kalır, belirtilen zamana planlanır
        └─ ilgileniyor / randevu              → İlgileniyor
                │ (link_istegi=true ise)
                ▼
           WhatsApp: tanıtım videosu gönderilir ──► Video Gönderildi → Asistan Arayacak
                                                      + insan franchise asistanına 60 dk'lık görev

   05 · Günlük Rapor ──► Telegram'a 9 statülük huni (funnel) raporu
```

İnsan taraftan sonrası (Sunum Yapıldı → Erdal Bey Onayı → Sözleşme → Franchise Açılış) Bitrix'te elle taşınır.

## Kurulum

### 1) Bitrix

9 statüyü Bitrix'te **lead** statüsü olarak oluşturun (Ayarlar > CRM > Lead Statüleri) ve her birinin kodunu
(`UC_xxxxxxxx`) not edin:

| Statü | Anlamı |
|---|---|
| Aranacak | kuyruk burası — 140K'lık havuzdaki adaylar buraya düşer |
| AI Görüştü | AI konuştu ama ilgilenmedi / ulaşılamadı (tükendi) / DNC |
| İlgileniyor | randevu veya sıcak/çok sıcak ilgi |
| Video Gönderildi | WhatsApp'tan tanıtım videosu gönderildi (ara adım, hemen Asistan Arayacak'a geçer) |
| Asistan Arayacak | insan franchise asistanına devredildi |
| Sunum Yapıldı | insan elle taşır |
| Erdal Bey Onayı | insan elle taşır |
| Sözleşme | insan elle taşır |
| Franchise Açılış | insan elle taşır |

4 lead alanı ve statü kontrolü **00 Kurulum ve Kontrol** workflow'u elle çalıştırıldığında otomatik yapılır/doğrulanır.

Gelen webhook (CRM yetkili) oluşturup adresini `n8n/ayarlar.local.json`'a `BITRIX_WEBHOOK` olarak yazın.

140K'lık listenin Bitrix'e aktarımı (import) bu sistemin kapsamı dışında — CSV/Excel içe
aktarma ile adayları `STATU.ARANACAK` statüsünde oluşturmanız yeterli.

### 2) Vapi

1. **XRE FRANCHISE - OUTBOUND** asistanını oluşturun (ya da zaten varsa kullanın) — sistem promptu:
   [`vapi/outbound-sistem-promptu.md`](vapi/outbound-sistem-promptu.md). Bu asistanda araç/tool **yok**;
   sonuç çağrı sonu analizinden (`analysis.structuredData`) okunur.
2. **Advanced > Server URL**: `…/webhook/xre-franchise-outbound`.
3. **Phone Numbers**'da kampanyaya ayrılan hat(lar)ı tanımlayın. 140K hacim için birden fazla hat önerilir —
   her biri `ARAYAN_NUMARALAR` dizisine eklenir, `TUR_BASINA_MAX_ARAMA` ile eşzamanlı arama sayısı ayarlanır.
4. Asistan adını `VAPI_OUTBOUND_ASISTAN`'da, numara(ları) `ARAYAN_NUMARALAR`'da tanımlayın.

### 3) WhatsApp (Meta Cloud API)

1. Meta Business'ta onaylı bir şablon oluşturun (örn. `xre_franchise_tanitim`, `{{1}}` = isim) — 45-60 sn'lik
   tanıtım videosunu şablonun header'ına (video) ekleyin.
2. `n8n/ayarlar.local.json`'da `WHATSAPP.AKTIF: true`, `WHATSAPP.TELEFON_NUMARASI_ID` ve şablon adını doldurun.
3. "WhatsApp API" credential'ını (Header Auth, Authorization: Bearer <Meta erişim tokenı>) n8n'de oluşturun.

### 4) n8n

1. `n8n/ayarlar.js`'deki yer tutucuları doldurup `n8n/ayarlar.local.json` olarak kaydedin (git'e girmez):
   ```json
   {
     "BITRIX_WEBHOOK": "https://xre.bitrix24.com.tr/rest/.../....../",
     "ARAYAN_NUMARALAR": ["+90..."],
     "STATU": { "ARANACAK": "UC_...", "AI_GORUSTU": "UC_...", "...": "..." },
     "FRANCHISE_ASISTAN_SORUMLU_ID": "<insan franchise asistanının Bitrix kullanıcı ID'si>",
     "WHATSAPP": { "AKTIF": true, "TELEFON_NUMARASI_ID": "..." },
     "TELEGRAM": { "CHAT_ID": "-100..." }
   }
   ```
2. `node n8n/build.mjs --ayar n8n/ayarlar.local.json` → `n8n/hazir/*.json` üretir.
3. n8n'de 4 dosyayı içe aktarın: **00 Kurulum ve Kontrol**, **01 Arama Kuyruğu**, **02 Outbound**, **05 Günlük Rapor**.
   - "Vapi API" credential'ını (Header Auth, Authorization: Bearer <Vapi API Key>) seçin
   - "WhatsApp API" credential'ını seçin
   - "XRE Rapor Botu" (Telegram) credential'ını seçin
4. **00 Kurulum ve Kontrol**'ü bir kez elle çalıştırın, son node'daki raporu kontrol edin (4 alan + 9 statü +
   numaralar + asistan hepsi ✅ olmalı).
5. **01**, **02**, **05**'i Publish/Active yapın.
6. 02'deki **Vapi Webhook** node'unun Production URL'ini Vapi'deki asistanın Server URL alanıyla eşleştiğini
   kontrol edin.

## Test

`test/mock-server.mjs` (sahte Bitrix/Vapi/WhatsApp/Telegram, port 8787) ve paylaşılan n8n test ortamıyla
`node n8n/build.mjs --test test/ayarlar.test.json` ile üretilen workflow'lar smoke test edildi:
kurulum/kontrol raporu, dış arama başlatma (doğru değişkenlerle), ilgilenen adaya WhatsApp video + insan
devri, DNC (bir daha aranmaz), hat hatası (deneme hakkı yakılmadan tekrar planlama), arama başlatılamadı
(tekrar planlama) — hepsi beklenen Bitrix durumuna geçti.
