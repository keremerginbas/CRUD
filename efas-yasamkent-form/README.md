# EFAS Yaşamkent — Form Otomasyonu

Kullanıcının kendi n8n'inde zaten çalışan "EFAS Yaşamkent" form workflow'u (Bitrix'in
"CRM formları" özelliğiyle toplanan lead'leri `UC_PQDHUK` — "EFAS İÇİN GELEN" —
statüsüne taşıyıp SMS + Telegram bildirimi gönderiyordu). Bu depo kopyası, kullanıcının
pasted'i JSON'a üç şey ekler:

1. **Yapay zeka araması** — lead `UC_PQDHUK`'ya taşınır taşınmaz, **efas-ntepe**
   projesindeki mevcut **EFAS N-TEPE - INBOUND** Vapi asistanı (prompt: "YENİ YAŞAMKENT
   (EFAS EN TEPE) — SELİN — INBOUND") +905337436876 hattından değil, +905337436014/
   +905337435632/+905337436876 arasından (burada: `225a742e-6b26-424a-b9c6-b45e070c870e`,
   +90 533 743 68 76) **outbound** olarak arar. Bu asistanın Server URL'i zaten
   `efas-ntepe`'nin kendi "03 Inbound" workflow'una bağlı olduğu için **ayrı bir sonuç
   işleme webhook'u kurmaya gerek yok** — randevu/olumsuz/bilgi dallanması, Bitrix
   güncellemesi, SMS/WhatsApp/e-posta sayaçları hepsi orada zaten var ve test edilmiş.
2. **E-posta** — SMS'e ek olarak aynı anda otomatik e-posta gönderilir (geçerli e-posta
   varsa).
3. **WhatsApp — eklenmedi.** Kullanıcının hangi entegrasyonu kullandığı netleşmeden
   (Meta WhatsApp Cloud API mi, ekran görüntüsünde görülen ChatApp/Whatcrm Bitrix
   uygulaması mı) güvenle eklenemez.

## Gerekli repo değişikliği — efas-ntepe

`efas-ntepe/n8n/src/lib.js`'teki `efasLeadSec()` fonksiyonu, lead'i **sadece** mevcut
arama kuyruğu statülerinde (YAPAY_ZEKA/ARADI/TEKRAR_ARANACAK/AÇMAYANLAR) veya OLUMSUZ'da
arıyordu — `UC_PQDHUK` (BİLGİ/EFAS İÇİN GELEN) dahil değildi. Bu yüzden telefonla arayan
inbound asistan, Yaşamkent formundan `UC_PQDHUK`'ya düşen lead'i **bulamayıp yeni bir
mükerrer lead açardı**. `efasLeadSec`'e `A.STATU.BILGI` ve `A.STATU.RANDEVU` eklendi —
artık doğru lead'i buluyor. Bu değişiklik `efas-ntepe`'nin kendi test paketiyle (99/99)
doğrulandı; **efas-ntepe/n8n/hazir/\*.json dosyalarının n8n'e yeniden içe aktarılıp
publish edilmesi gerekiyor** ki bu düzeltme canlıya yansısın.

## Doldurulması gereken yer tutucular

- `n8n/efas-yasamkent-form.json` içindeki `Vapi Aramasını Başlat (EFAS Yaşamkent)`
  node'unda **`EFAS_NTEPE_INBOUND_ASSISTANT_ID`** → gerçek Vapi asistan ID'si ile
  değiştirin (Vapi dashboard'da "EFAS N-TEPE - INBOUND" / "Yeni Yaşamkent" asistanının
  ID'si).
- `E-posta Gönder (EFAS Yaşamkent)` node'unun credential'ı **`EFAS_SMTP_CREDENTIAL`** →
  n8n'de gerçek bir SMTP credential'ı oluşturup seçin.
- Erccell SMS kullanıcı adı/şifresi `ERCCELL_KULLANICI_ADI`/`ERCCELL_SIFRE` yer
  tutucusu — n8n'e aktarmadan önce gerçek değerlerle değiştirin, ya da doğrudan
  `n8n/efas-yasamkent-form.local.json` (gerçek değerler dolu, **git'e girmez**) dosyasını
  içe aktarın.
- Telegram bot tokenı `TELEGRAM_BOT_TOKEN` yer tutucusu — aynı şekilde `.local.json`'da
  gerçek değeri var.

## Dosyalar

- `n8n/efas-yasamkent-form.json` — git'e giren, sırları yer tutucuya çevrilmiş şablon.
- `n8n/efas-yasamkent-form.local.json` — gerçek sırlar dolu, **git'e girmez**, doğrudan
  n8n'e içe aktarılabilir (üstteki iki placeholder — assistant ID ve SMTP credential —
  hâlâ sizin doldurmanız gerekiyor, çünkü onlar sır değil, bilmediğim gerçek ID'ler).
