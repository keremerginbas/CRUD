# Vapi asistanları — EFAS N-TEPE

İki asistan gerekiyor: **EFAS N-TEPE - OUTBOUND** ve **EFAS N-TEPE - INBOUND**.
En kolay yol, çalışan Türkçe ses ayarlarını (Soniox STT, GPT-5 Mini, Leah) korumak için mevcut bir asistanı kopyalamak.

## 1. Outbound asistanı
1. Dashboard > Assistants > **TOPRAKTAN CITY - OUTBOUND** > `⋮` > **Duplicate** → adı `EFAS N-TEPE - OUTBOUND` yapın.
2. **System prompt:** [`outbound-sistem-promptu.md`](outbound-sistem-promptu.md) dosyasının tamamını yapıştırın.
3. **First message:** `Merhabalar, ben XRE Beştepe'den Selin.` yazın. Arama başına gerçek açılış cümlesini n8n gönderir (isimliyse "… Ahmet Yılmaz ile mi görüşüyorum?", isimsizse doğrudan 3.150.000 TL'lik 1+1 teklifi).
4. **Tools:** Tools sayfasında [`araclar-outbound.json`](araclar-outbound.json) içindeki 3 fonksiyonu oluşturun (`randevu_olustur`, `geri_arama_planla`, `olumsuz_kaydet`). Her birinin Server URL'i: `https://N8N_ALANINIZ/webhook/efas-ntepe-outbound`. Sonra asistanın Tools sekmesinde bu 3 aracı ve **End Call** aracını seçin. Kopyaladığınız asistandan gelen Topraktan araçlarını kaldırın.
5. **Advanced > Server URL:** `https://N8N_ALANINIZ/webhook/efas-ntepe-outbound`
   **Server Messages:** sadece `end-of-call-report` seçili kalsın. Diğer mesaj tipleri n8n'i gereksiz yere tetikler.
6. **Analysis:** [`analiz-outbound.json`](analiz-outbound.json) dosyasındaki özet istemi (Summary prompt), yapılandırılmış veri şeması (Structured Data schema) ve istemi girin. Özet Türkçe olur ve sonuç (`sonuc`) n8n'e bu yolla gelir.
   Structured Outputs kullanıyorsanız aynı alan adlarıyla (`sonuc`, `olumsuz_nedeni`, …) tek bir obje çıktısı tanımlayın; n8n iki biçimi de okur.
7. Önerilen ayarlar: Max duration 600 sn, Silence timeout 20–30 sn, Voicemail detection açık.
8. Asistanın adı tam olarak **`EFAS N-TEPE - OUTBOUND`** olsun. n8n asistanı bu adla bulur, ID girmeniz gerekmez. Farklı bir ad verirseniz AYARLAR > `VAPI_OUTBOUND_ASISTAN` alanına o adı ya da ID'yi yazın.

## 2. Inbound asistanı
Outbound ile aynı adımlar, şu farklarla:
- Kaynak olarak **TOPRAKTAN CITY - INBOUND**'u kopyalayın, adı tam olarak `EFAS N-TEPE - INBOUND` olsun.
- Prompt: [`inbound-sistem-promptu.md`](inbound-sistem-promptu.md)
- First message: `Merhabalar, XRE Beştepe, EFAS N-Tepe Yaşamkent'e hoş geldiniz. Ben Selin, size nasıl yardımcı olabilirim?`
- Tools: [`araclar-inbound.json`](araclar-inbound.json) (yalnızca `randevu_olustur` ve End Call), URL `…/webhook/efas-ntepe-inbound`
- Server URL: `https://N8N_ALANINIZ/webhook/efas-ntepe-inbound`
- Analysis: [`analiz-inbound.json`](analiz-inbound.json)

## 3. Telefon numaraları
Phone Numbers'da **+90 533 743 68 76**, **+90 533 743 70 88** ve **+90 850 346 59 93** numaralarını açın. Inbound Settings > Assistant alanında **EFAS N-TEPE - INBOUND**'u seçin. Numaranın kendi Server URL alanı boş kalsın.

> ⚠️ Bu 3 numara şu an **TOPRAKTAN CITY** asistanına bağlı. Değiştirdiğiniz anda bu numaraları geri arayan Topraktan müşterileri EFAS asistanına düşer. Numaralar iki projede birlikte kullanılacaksa, arayanı Bitrix'teki projesine göre doğru asistana yönlendiren bir `assistant-request` router'ı eklenebilir.

Outbound aramalar asistanı arama başına seçer (`assistantId`). Bu yüzden numaranın inbound ayarı outbound'u etkilemez.

## 4. WhatsApp şablonları (Meta Business Manager)
WhatsApp'ta işletmenin başlattığı mesajlar yalnızca **onaylı şablonla** gönderilebilir. Dil `Turkish (tr)`, `{{1}}` = ad, `{{2}}` = randevu tarihi.

| Şablon adı | Kategori | Metin |
|---|---|---|
| `efas_randevu_teyit` | Utility | Merhaba {{1}}, EFAS N-Tepe Yaşamkent ziyaret randevunuz {{2}} olarak oluşturuldu. Danışmanımız randevu öncesi konum bilgisi için sizi arayacak. Bilgi: 444 24 53 — XRE Beştepe |
| `efas_tanitim` | Marketing | Merhaba {{1}}, Ankara Yaşamkent'te şehrin en tepesinde EFAS N-Tepe! 3.150.000 TL'den başlayan fiyatlarla 1+1 daire sahibi olabilirsiniz, kredi kartına taksit imkânı var. Sizi aradık, ulaşamadık. Bilgi ve randevu için bu mesaja yanıt verin ya da 444 24 53'ü arayın. |
| `efas_bilgi` | Marketing | Merhaba {{1}}, görüşmemiz için teşekkürler. EFAS N-Tepe Yaşamkent'te 1+1 daireler 3.150.000 TL'den, 2+1 seçenekler 4.750.000 TL'den başlıyor. 24 ay vadeli ödeme ve kredi kartına taksit imkânı var. Size özel ödeme planı için bu mesaja yanıt verin. XRE Beştepe 444 24 53 |

Fiyatlar şablonun içinde sabit yazılı. Fiyat listesi değişince şablonu güncelleyip yeniden onaya göndermeniz gerekir.
