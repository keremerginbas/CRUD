# Finest Yaşamkent — Vapi Outbound/Inbound

Kullanıcının kendi oluşturduğu, elle yazılmış n8n workflow'u (başka bir yerden dışa aktarılmış,
bu depoya o haliyle eklendi — `efas-ntepe`/`ankaport-hisse`/`xre-franchise`'daki `build.mjs`
şablonlama sistemini kullanmıyor).

- **Tetik:** Bitrix lead `UC_5M177N` statüsüne düşünce form webhook'u çalışır.
- **Outbound:** Vapi `/call` ile arar — `phoneNumberId`: `1c6cea8b-f4fa-4301-a46b-24fa4443006e`
  (+905337436014).
- **Sonuç:** `finest-vapi-call-result` webhook'u çağrı sonu raporunu alır, Bitrix'i günceller,
  Telegram'a bildirir.

## Dosyalar

- `n8n/finest-yasamkent-vapi.json` — git'e giren şablon. Erccell SMS kullanıcı adı/şifresi
  **ERCCELL_KULLANICI_ADI** / **ERCCELL_SIFRE** yer tutucusu — n8n'e aktarmadan önce
  `SMS Gönder (Erccell) - Finest Yaşamkent` node'unun body'sindeki bu iki değeri gerçek
  Erccell bilgilerinizle değiştirin.
- `n8n/finest-yasamkent-vapi.local.json` — gerçek Erccell şifresi dolu, **git'e girmez**
  (`.gitignore`). Doğrudan n8n'e içe aktarmak için kullanılabilir.

## Doldurulması gereken yer tutucu

- `FINEST_VAPI_OUTBOUND_ASSISTANT_ID` içermiyor, zaten `0f5e140e-dfc3-4a8a-bf9d-33dbdbb98d27`
  olarak dolu — sadece `phoneNumberId`'nin doğru olduğunu teyit edin.
