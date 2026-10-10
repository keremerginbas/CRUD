# XRE Ankaport Hisse — Yapay Zeka Outbound/Inbound Arama Sistemi

EFAS N-TEPE sistemiyle aynı mimari (n8n + Vapi + Bitrix24), ama daha sade: çok günlük
tekrar deneme kuyruğu **yok**. Form dolduğunda yapay zeka **tek sefer** arar:
- Randevu oluşursa → lead **RANDEVU OLUŞTURANLAR** (UC_WK3LVR) statüsüne taşınır, **mevcut sorumlu değişmez**.
- Oluşmazsa → lead **ankaport reklam** (UC_0RQEPM) statüsünde kalır, satışçı kendisi arar (otomatik tekrar arama yok).

## Akış

```
Bitrix: lead "ankaport reklam" statüsüne düşer (form/reklamdan)
        │ (otomasyon kuralı → webhook)
        ▼
   01 · Form  ──► SMS + E-posta (fırsat afişiyle) + Telegram "form doldu" bildirimi
        │
        ▼
   Vapi: outbound arama başlar ──► 02 · Outbound (araç çağrıları + çağrı sonu raporu)
        │
        ├─ randevu oluştu  → Bitrix: RANDEVU OLUŞTURANLAR + görev + Telegram sonuç
        └─ oluşmadı        → Bitrix: değişmez, yorum eklenir + Telegram sonuç

Müşteri numarayı doğrudan ararsa ──► 03 · Inbound (aynı mantık, numaradan lead bulunur/açılır)
```

## Kurulum

### 1) Bitrix

- Bu 2 statü zaten var: **ankaport reklam** (`UC_0RQEPM`) ve **RANDEVU OLUŞTURANLAR** (`UC_WK3LVR`).
- CRM > Otomasyon Kuralları: lead **ankaport reklam** statüsüne düştüğünde **"Webhook'u Çağır"** adımı ekleyin →
  n8n'den alacağınız **01 Form** webhook adresi (aşağıda). Gövdede lead ID'si `data[FIELDS][ID]` olarak gitmeli
  (Bitrix'in standart "Lead statüsü değişti" tetikleyicisi bunu otomatik sağlar).
- Gelen webhook (CRM yetkili) oluşturup adresini `n8n/ayarlar.local.json`'a `BITRIX_WEBHOOK` olarak yazın.

### 2) Vapi

1. İki asistan oluşturun:
   - **ANKAPORT HİSSE - OUTBOUND** — sistem promptu: [`vapi/outbound-sistem-promptu.md`](vapi/outbound-sistem-promptu.md)
   - **ANKAPORT HİSSE - INBOUND** — sistem promptu: [`vapi/inbound-sistem-promptu.md`](vapi/inbound-sistem-promptu.md)
2. Her asistana kendi **randevu_olustur** aracını ekleyin:
   - Outbound: [`vapi/araclar-outbound.json`](vapi/araclar-outbound.json) → Server URL: `https://N8N_ALANINIZ/webhook/ankaport-hisse-outbound`
   - Inbound: [`vapi/araclar-inbound.json`](vapi/araclar-inbound.json) → Server URL: `https://N8N_ALANINIZ/webhook/ankaport-hisse-inbound`
3. **Advanced > Server URL** (asistanın kendisinde): outbound asistanda `…/webhook/ankaport-hisse-outbound`, inbound asistanda `…/webhook/ankaport-hisse-inbound`.
4. **Phone Numbers**'da Ankaport'a özel numarayı tanımlayın. **Inbound Settings > Assistant**'ı **ANKAPORT HİSSE - INBOUND** yapın. Numaranın kendi Server URL alanı **boş** kalsın (asistandaki ayar geçerli olur).
5. Asistan ID'si ve telefon numarası ID'sini not edin — `n8n/ayarlar.local.json`'daki `ARAYAN_NUMARA` ve
   `n8n/build.mjs`'deki `vapiBody.assistantId` / `phoneNumberId` yer tutucularını (`__ASISTAN_ID__`, `__NUMARA_ID__`)
   bunlarla değiştirin (ya da EFAS'taki `vapi-guncelleme` betiği gibi otomatik dolduran küçük bir araç isterseniz haber verin).

### 3) n8n

1. `n8n/ayarlar.js` dosyasındaki yer tutucuları doldurup `n8n/ayarlar.local.json` olarak kaydedin (git'e girmez):
   ```json
   {
     "BITRIX_WEBHOOK": "https://xre.bitrix24.com.tr/rest/.../...../",
     "ARAYAN_NUMARA": "+90...",
     "VARSAYILAN_SORUMLU_ID": "<inbound'da bilinmeyen numara açarsa atanacak Bitrix kullanıcı ID'si>",
     "SMS": { "KULLANICI": "...", "SIFRE": "..." }
   }
   ```
2. `node n8n/build.mjs --ayar n8n/ayarlar.local.json` → `n8n/hazir/*.json` üretir.
3. n8n'de **01 Form**, **02 Outbound**, **03 Inbound** dosyalarını içe aktarın:
   - Vapi credential'ı seçin (HTTP Header Auth, Authorization: Bearer <Vapi API Key>)
   - SMTP credential'ı seçin ("Ankaport SMTP")
   - Telegram credential'ı seçin ("XRE Rapor Botu" — zaten gruba ekli)
4. Her workflow'u **Publish/Active** yapın.
5. 01'in **Form Webhook** node'undaki Production URL'i kopyalayıp Bitrix otomasyon kuralına yapıştırın.
6. 02 ve 03'teki **Vapi Webhook** node'larının Production URL'lerini Vapi'deki asistan/araç Server URL alanlarıyla eşleştiğini kontrol edin.

### Telegram grubu

Rapor grubu: `-4907631457` (zaten `n8n/src/ayarlar.js`'de tanımlı). Bot zaten gruba ekli.

## Mesajlar

- **SMS** (Erccell, form dolar dolmaz gider): "Ankara AnkaPort Saray başvurunuz alınmıştır. Danışmanımız en kısa sürede sizinle iletişime geçecektir. XRE'li günler dilerim."
- **E-posta** (form dolar dolmaz gider, varsa): fırsat afişi ([`eposta/ankaport-firsat.jpg`](eposta/ankaport-firsat.jpg)) ekli, "AnkaPort Saray — Cadde Dükkanlarda Yeni Fırsatlar" konulu.
- **Telegram — form doldu**: "📝 Yeni ANKAPORT Hisse Talebi" + ad/telefon/tarih, "yapay zeka aranıyor" notu.
- **Telegram — arama sonucu**: durum (Randevu Oluşturuldu / Açmadı / İlgilenmiyor / Randevu Alınamadı), sorumlu kişi (Bitrix'ten canlı çekilir), müşteri adı, form tarihi, statü, özet.

## Test

`test/` klasöründe EFAS'takiyle aynı mock Bitrix/Vapi/SMS/Telegram/SMTP altyapısı kullanılarak
19 senaryo (form→SMS/e-posta/Telegram, outbound randevu, outbound açmadı, inbound yeni lead) doğrulandı.
Tam bir e2e koşum script'i isterseniz (EFAS'taki `test/e2e.mjs` gibi kalıcı/otomatik), haber verin, ekleyelim.

## Henüz yapılmayanlar / kararınızı bekleyenler

- Vapi asistan ID'leri ve telefon numarası ID'si (asistanları oluşturduktan sonra `n8n/build.mjs`'ye işlenmeli).
- Gerçek Bitrix webhook ve SMS kimlik bilgileri.
- "Arama saatleri dışında form dolarsa" senaryosu Vapi'nin `schedulePlan.earliestAt` özelliğiyle ertelenecek şekilde kodlandı ama henüz gerçek bir aramada denenmedi.
