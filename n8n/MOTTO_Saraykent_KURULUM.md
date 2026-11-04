# MOTTO SARAYKENT – Vapi otomasyonu

- `MOTTO_Saraykent_Vapi.json`: n8n workflow (anahtarlar yer tutucu). `motto_uret.py` yeniden üretir:
  `BITRIX_WEBHOOK_KODU=... TELEGRAM_BOT_TOKEN=... python3 motto_uret.py MOTTO_Saraykent_Vapi_GIZLI.json gizli`
- Arayan numara: 0533 743 71 16 (Vapi phoneNumberId `7a0ea572-de5c-4437-9ede-dab72b28d86d`)

| Olay | Bitrix | Sorumlu |
|---|---|---|
| Lead **MOTTO İÇİN GELEN** (`UC_7DXC14`) statüsüne düşer | Aranır, statü değişmez, karta not düşer | değişmez |
| Randevu oluşturur | **RANDEVU OLUŞTURANLAR** (`UC_WK3LVR`), Randevu Tarihi doldurulur, satışçıya yapılacak iş açılır, Telegram -5179169844 | satışçılara sırayla |
| Görüşüldü, randevu yok / ulaşılamadı | sadece not | değişmez |

- Mesai dışında düşen form ertesi 09:30'da aranır. Her müşteri yalnızca 1 kez aranır; hat meşgulse ya da arama başlatılamazsa tekrar denenmez, karta not düşer.
- Aynı lead 24 saat içinde ikinci kez aranmaz. Statüdeki eski 208 kayıt aranmaz (kural yalnızca yeni girişte çalışır).
- Gün sonu raporu her gün 20:00'de Telegram -5110365688'e gider.

## Kurulum
1. **Bitrix:** Müşteri adayları → Otomasyon kuralları → MOTTO İÇİN GELEN → *Giden webhook*: `https://xre111.shop/webhook/motto-form-lead`
2. **Vapi:** MOTTO SARAYKENT - OUTBOUND → Server URL: `https://xre111.shop/webhook/motto-vapi-call-result` (end-of-call-report açık)
3. **n8n:** içe aktar, Vapi düğümlerinde "Vapi Header Auth" seçili olsun, Active yap.
