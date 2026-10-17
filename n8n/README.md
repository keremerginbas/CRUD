# XRE Project Bilgi Formu → SMS + Telegram + Bitrix Yorum (n8n)

Müşteri https://form.xre.com.tr/xre-project-bilgi-formu/ formunu doldurup lead
**PROJELER SMS GELEN** (`UC_BVSKUN`) statüsüne düştüğünde:

1. Müşteriye Erccell üzerinden SMS gider:
   > Merhaba {Ad Soyad}, XRE Project başvurunuz alınmıştır. Proje satış temsilcimiz sizinle en kısa sürede iletişime geçecektir. XRE'li günler dileriz. https://xre.com.tr/
2. Telegram grubuna (`-5156472580`, @xre_rapor_bot) bildirim düşer:
   ```
   🔔 Yeni Form Başvurusu

   👨‍💼 Atanan: Murat Er
   📋 Doldurulan form: XRE Project Bilgi Formu
   🏢 İlgilendiği proje: ...
   👤 Ad Soyad: erhan yüksel
   📞 Telefon: +905464763956
   ✉️ E-posta: m.arhan3563@gmail.com
   📝 Cevap: yatırım amaçlı bilgi almak istiyorum
   🕒 Tarih: 16.10.2026 09:36:17
   📨 SMS: Gönderildi ✅
   🔗 Bitrix'te aç (#221052)
   ```
3. Lead kartının sağ tarafına (timeline) yorum eklenir: `✅ SMS GÖNDERİLDİ` (tarih, numara, mesaj)
   ya da hata olursa `❌ SMS GÖNDERİLEMEDİ` + sebep.

Aynı lead için SMS/bildirim yalnızca bir kez gönderilir.

## Akış

```
Bitrix Webhook → Ayarlar ve Lead ID
→ Bitrix Verilerini Getir (batch: lead, bağlı kişi, sorumlu, CRM form kaydı, lead alanları)
→ Başvuruyu Hazırla (statü + tekrar kontrolü) → Mesajları Hazırla → SMS Gönder (Erccell) → SMS Sonucu
→ Telegram Gruba Gönder → Bitrix Yorum Ekle (crm.timeline.comment.add)
```

## Kurulum

1. **Import:** n8n → Workflows → Import from file → `xre-project-bilgi-formu.json`.
2. **Ayarlar:** `Ayarlar ve Lead ID` düğümündeki `AYARLAR` bloğunu doldurun:
   - `BITRIX_WEBHOOK_URL` – Bitrix24 gelen webhook adresi (izinler: `crm`, `user`).
   - `TELEGRAM_BOT_TOKEN`, `ERCCELL_USERNAME`, `ERCCELL_PASSWORD`.
   - `PROJE_ALANI` – genelde boş kalabilir: ad, telefon, e-posta ve
     "İlgilendiğiniz Proje" doğrudan CRM form kaydından okunur. Form kaydı
     bulunamazsa bu lead alanı, o da boşsa etiketinde "proje" geçen alan denenir.
   - Şifre değiştiğinde yalnızca bu blok güncellenir.
3. **Telegram:** @xre_rapor_bot'u gruba üye olarak ekleyin. `chat not found`
   hatası gelirse `TELEGRAM_CHAT_ID` değerini `-1005156472580` yapın.
4. **Bitrix tetikleyici (önerilen):** CRM → Lead'ler → Otomasyon kuralları →
   **PROJELER SMS GELEN** sütununa *Webhook* (Giden webhook) kuralı ekleyin:
   ```
   https://<n8n-adresiniz>/webhook/xre-project-bilgi-formu?lead_id={{ID}}
   ```
   Alternatif: Giden webhook ile `ONCRMLEADADD` + `ONCRMLEADUPDATE` olayları
   (bu durumda `BITRIX_APP_TOKEN` ayarlanabilir). Statü filtresi ve tekrar
   kontrolü her iki yöntemde de çalışır.
5. Workflow'u **Active** yapın.

## Notlar

- Veri önceliği: CRM form kaydı → lead → bağlı kişi kartı. Tekrarlayan müşteri
  adaylarında Bitrix ad/telefonu lead'e değil kişi kartına yazdığı için bu gerekli.
- `Başvuruyu Hazırla` çıktısındaki `form_alanlari` formdan okunan alanları gösterir.
- Aynı lead tekrar işlenmez; test için her seferinde formu yeniden doldurun.
- Erccell yanıtı `RESULT=1` + `MSG_ID` ise gönderildi, diğer kodlar (örn. `11`) hata
  kabul edilir; sonuç Bitrix yorumunda `RESULT=..., MSG_ID=...` olarak görünür.

- SMS numara formatı `905XXXXXXXXX`. Erccell `5XXXXXXXXX` bekliyorsa
  `SMS_ULKE_KODU: false` yapın.
- Geçerli cep numarası yoksa SMS denenmez; Telegram'da ❌, Bitrix'te sebep yazılır.
- Tekrar kontrolü n8n workflow static data'sında tutulur (yalnızca aktif
  workflow'da kalıcıdır; manuel test çalıştırmalarında kaydedilmez).
