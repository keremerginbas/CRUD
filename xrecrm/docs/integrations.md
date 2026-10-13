# XRE CRM — Canlı entegrasyon kurulumu

## Hazır olan ve henüz bağlanmamış olan

CRM/Kanban arayüzü, kalıcı MySQL veri katmanı, statü kuralları, gelen webhook doğrulaması, giden işlem kuyruğu, Meta/Evolution mesaj API bağlantıları ve Vapi arama bağlantısı uygulanmıştır. Ancak bu projede **canlı Meta, Evolution, Netgsm/PBX ve Vapi kimlik bilgileri henüz yapılandırılmamıştır**. Canlı QR eşleştirmesi, mesaj teslimi ve telefon görüşmesi uçtan uca doğrulanmış değildir. Demo modu sentetik müşterileri tarayıcıda saklar; dış iletişim göndermez.

Mevcut iki arşiv kaynakları `legacy` altında korunur. Eski `.env`, özel medya ve SQL müşteri dökümü yeni projeye veya yeni veritabanına aktarılmamıştır. CRM arşivi sunucu dizinini içermediği için yeni Express/TypeScript sunucusu oluşturulmuştur. Eski Fastify uygulaması ayrıca çalıştırılmaz; Meta mesajlaşma davranışı birleşik sunucuda uyarlanmıştır.

## Oturum ve kalıcı veri

Canlı veri `DATABASE_URL` üzerinden `xre_records` ve `xre_events` tablolarında saklanır. Tablolar eklemeli ve idempotent başlangıç şemasıyla oluşturulur. Üretimde belleğe sessiz geri dönüş yapılmaz. Demo verisi sunucu tarafından seed edilmez.

Manus oturumu `webdev_app_session` cookie ile, HS256 `MANUS_JWT_SECRET`, zorunlu JWT bitiş zamanı ve `MANUS_PROJECT_ID` eşleştirmesiyle doğrulanır. Oturum yoksa 401, sahip dışı erişimde 403 döner. `XRE_OWNER_OPEN_ID` veya `MANUS_OWNER_OPEN_ID` sabit sahip belirler. Bunlar yoksa ilk doğrulanmış uygulama kullanıcısı atomik olarak sahibi olur; **herkese açık dağıtım öncesinde sabit sahip belirlenmelidir**. Danışman `lead.owner` alanı veri sahipliği alanından ayrıdır. Ekip erişim izinleri henüz uygulanmamıştır; canlı CRM sahibiyle sınırlıdır.

OAuth nonce kısa ömürlü cookie ile tarayıcıya bağlanır. HTTPS önizleme oturumlarında `SameSite=None; Secure` kullanılır. Origin, izinli ortam değeri veya sunucuya iletilen origin ile doğrulanır.

## Hat kimliği eşleştirmesi

47 hattın tümü envanterde bulunur: `ai-1`–`ai-8`, `office-1`–`office-16`, `cloud-1`–`cloud-23`. Numarayı envantere kaydetmek, o hattı Vapi veya WhatsApp sağlayıcısına otomatik aktarmak değildir.

`META_LINE_MAP_JSON`, CRM hat kimliğini Meta `phone_number_id` değerine; `VAPI_LINE_MAP_JSON`, CRM hat kimliğini Vapi `phoneNumberId` değerine eşler. Örnek yapı aşağıdadır; değerler örnektir, gerçek sağlayıcı kimlikleriyle değiştirilmelidir.

```json
{"office-2":"META_PHONE_NUMBER_ID_BURAYA"}
```

```json
{"ai-1":"VAPI_PHONE_NUMBER_ID_BURAYA"}
```

Eksik eşleştirmede 503 döner. CRM mantıksal kimliği sağlayıcıya gerçek telefon kimliği gibi gönderilmez ve başka hatla sessizce değiştirilmez.

## WhatsApp bağlantıları

| Bağlantı | Sunucu değişkenleri | Davranış |
| --- | --- | --- |
| Meta Cloud API | `META_ACCESS_TOKEN`, `META_LINE_MAP_JSON`, `META_APP_SECRET`, `META_VERIFY_TOKEN` | Resmî API ile metin mesajı ve webhooklar |
| QR oturumu | `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_WEBHOOK_SECRET` | Sağlayıcıdan gerçek WhatsApp QR ve cihaz oturumu |

`POST /api/connections/:id/qr` mevcut Evolution instance durumunu kontrol eder. Instance yoksa kullanıcı isteği üzerine oluşturur; mevcut oturumu silmez veya yeniden yaratmaz. QR yalnızca sağlayıcıdan dönerse gösterilir. Ayrı, sürekli çalışan Evolution API kurulumu gerekir; CRM tek başına WhatsApp cihaz oturumu işletmez. Bağlantı güncelleme webhooku `open` durumunu `connected` olarak kaydeder.

`POST /api/messages` seçilen CRM müşterisine, açık hat eşleştirmesi veya bağlı Evolution instance üzerinden gerçek gönderim yapar. Başarılı sağlayıcı yanıtı geçmişe kaydedilir. Meta GET doğrulama challenge'ı `/api/webhooks/meta` adresindedir; POST ham gövde `X-Hub-Signature-256` ile doğrulanır. Evolution webhooku `/api/webhooks/evolution` adresinde Bearer veya özel secret header ile korunur. Gelen metin ve medya olayı telefon üzerinden CRM müşterisiyle eşlenir; medya dosyası aktarımı yerine olay/başlık saklanır.

Meta'nın 24 saatlik müşteri iletişim penceresi, onaylı template gereksinimi ve hesap yetkileri sağlayıcının kurallarına tabidir. Bu sürümde toplu template yönetimi, dosya yükleme, ses mesajı gönderme ve eski özel medya göçü uygulanmamıştır.

## Vapi ve Netgsm/FST/SIP

Vapi için `VAPI_API_KEY`, `VAPI_ASSISTANT_ID`, `VAPI_LINE_MAP_JSON`, `VAPI_WEBHOOK_SECRET` gerekir. `POST /api/calls`, seçili müşteri ve AI hat kimliğiyle gerçek `POST /call` isteği yapar. Yapılandırılmış, etkin Vapi otomasyon kuralı da ilgili statüye geçişte kuyruğa girer. Arama sonucu `/api/webhooks/vapi` üzerindeki `end-of-call-report` olayından CRM kaydına bağlanır; transkript ve özet saklanır. Asistanın AI olduğunu bildirmesi ve uygun müşteri iletişim izni sağlanmalıdır.

Netgsm için `NETGSM_SIP_HOST`, `NETGSM_SIP_USERNAME`, `NETGSM_SIP_PASSWORD`, `PBX_GATEWAY_URL`, `PBX_GATEWAY_TOKEN` gerekir. Bu sürüm PBX ağ geçidinin sağlık yanıtını kontrol eder ve hat envanterini yönetir. **SIP trunk, FST cihazları, dahili yönlendirme, RTP ses akışı ve canlı PBX arama/CDR senkronizasyonu mevcut PBX üzerinde ayrıca yapılandırılmalıdır.** Tarayıcıda raw SIP sonlandırıldığı veya gerçek PBX bağlantısının kurulduğu iddia edilmez. Netgsm hatları Vapi'ye SIP/BYO telephony üzerinden sağlayıcı tarafında bağlanmalıdır.

## Statü otomasyonları ve webhooklar

Yeni CRM kaydı ve aşama değişimi etkin kuralları kalıcı kuyruğa alır. İşlemler: danışmana görev, WhatsApp, Vapi araması veya HTTPS webhook. Çalışan uygulama sunucusunda native kuyruk işleyicisi vardır. Çoklu sunucular DB transaction ile olayları sahiplenir; yeniden denemeler gecikmeli ve en fazla 5 denemedir. İletişim gönderimi belirsiz sonuçlanırsa kör tekrar yerine `needs_review` durumuna ayrılır. Kuyruk sunucu çalışırken ilerler; barındırma uykuya geçerse bu süre boyunca işlem yürütülmez.

Giden URL HTTPS olmalı, kullanıcı/parola içermemeli, localhost/özel IP/metadata adresine çözülmemelidir. `OUTBOUND_WEBHOOK_SECRET` imzası `X-XRE-Signature`, `X-XRE-Timestamp` başlıklarıyla gönderilir. Gelen genel endpoint `/api/webhooks/inbound`, `INBOUND_WEBHOOK_SECRET` Bearer doğrulamasıyla `lead.created`, `lead.updated` ve `stage.changed` olaylarını işler. Olay kimliği tekrarları engeller. Sahip henüz belirlenmemişse olay 503 ile reddedilir.

`POST /api/events/:id/retry` yetkili kullanıcı için uygun durumdaki olayları yeniden işler. Webhook yeniden denemesi doğru sağlayıcı işlemine yönlenir. Entegrasyon kuralları yapılandırılmadığında hata kaydedilir; başarı veya bağlı durum uydurulmaz.

## Yerel uygulamalar

`BITRIX_DOMAIN`, `BITRIX_WEBHOOK` mevcut Bitrix bağlantısını tanımlar. `POST /api/bitrix/placement`, Manus oturumu yanında Bitrix kimliğini ve izinli placement bağlamını doğrular. Webhook değeri tam Bitrix REST taban URL'sidir; gizli URL kaynak koduna veya tarayıcıya yazılmaz. Yerel uygulama ekranı ayrıca müşteri bağlamını JSON olarak dışa aktarır. Bitrix uygulama kaydı, placement URL ayarı ve kullanıcı erişimleri Bitrix yönetiminde ayrıca yapılmalıdır; bu projede mevcut portal ayarları değiştirilmemiştir.

## API özeti ve doğrulama

`GET /api/state` → `{leads, rules, messages, events, connections, calls, settings}`. Gelen kutusu `inbound`/`outbound` yönlerini kullanır. Özel uç noktalar sahip oturumu gerektirir. `GET /api/integrations/status` yapılandırma bilgisini döndürür; uzak servise gerçekten bağlanmadan bağlı göstermez. `POST /api/integrations/:provider/test` salt okunur sağlayıcı sorgusu yapar. `/health` uygulama ve DB hazır olma durumunu döndürür.

Testler yalnız test belleği ve sentetik kayıtlarla çalışır. Canlı DB müşteri ekleme/silme, gerçek mesaj, arama veya harici webhook gönderimi doğrulama sırasında yapılmamıştır. Gerçek uçtan uca kabul, sağlayıcı kurulumu sonrasında yetkili kontrollü deneme gerektirir.

## Referanslar

[Meta webhook](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/create-webhook-endpoint/), [Meta başlangıç](https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started), [Evolution mesaj API](https://evolutionapi-evolution-api-90.mintlify.app/api/messages/send-text), [Vapi Create Call](https://docs.vapi.ai/api-reference/calls/create), [Vapi Server Authentication](https://docs.vapi.ai/server-url/server-authentication), [Vapi Server Events](https://docs.vapi.ai/server-url/events).
