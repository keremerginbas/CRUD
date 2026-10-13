# XRE CRM · Yapay zekâ ve n8n

## Hazır olanlar

Tüm sayfalarda sağ alttaki **Asistana sor** ve üst menüdeki **Asistan** düğmesi aynı sohbeti açar. **XRE Asistan** menüsü tam çalışma alanına götürür. Müşteri ayrıntısı açıkken seçili müşteri bağlamı aktarılır. Yetkili sahip canlı modda kendi CRM kayıtları için Türkçe sorular sorabilir; kişi/şirket, müşteri, satış aşamaları, görev, takvim, WhatsApp ve arama kayıtları ile otomasyonlar ortak bağlama dahildir. Entegrasyon anahtarları veya ham sağlayıcı yanıtları modele aktarılmaz.

**Dönem raporu** istek üzerine oluşturulur. Türkiye saatine göre başlangıç/bitiş gününü seçin. Sayılar sunucuda deterministik hesaplanır; OpenAI açıklama, riskler ve sonraki adımlar üretir. Yeni müşteriler, mesajlar, aramalar, görevler ve aşama geçişleri kayıtların tarihleriyle sayılır. Mevcut açık/kazanılmış/kaybedilmiş huni görünümü geçmiş dönem satışından ayrıdır. Eksik zaman/direction bilgileri veri sınırlarında belirtilir. Rapor Markdown olarak indirilebilir; eski veri yokken tarihsel sonuç uydurulmaz. Otomatik günlük gönderim bu sürümde kurulmadı, rapor istendiğinde hazırlanır.

Asistan işleri kendiliğinden tamamlamış gibi göstermez. Bir görev, kişi, şirket, müşteri güncellemesi, aşama, takvim, not veya otomasyon için **öneri kartı** üretir. Kartı açın, bilgileri kontrol edin ve **CRM’ye uygula** seçin. Mesaj ve arama taslaklarında hedef müşteri ile gönderen hat görünür; gerçek iletişim ancak karttan çalıştırılır. Etkin aşama kuralları müşteri statüsü değişince çalışabilir. Silme, yetki verme ve kod/SQL çalıştırma asistanın işlem setinde yoktur.

Canlı sohbet sunucuda sahip kapsamına kaydedilir. Geçmiş öneriler yeniden yüklenince arşiv olarak gösterilir ve yeniden uygulanamaz; gerekirse yeni bir öneri isteyin. Bu, eski mesaj/arama taslaklarının yanlışlıkla tekrar gönderilmesini önler. Demo sohbeti yerel örnek verilerle, dış model veya n8n çağrısı yapmadan çalışır.

## n8n

Sunucu kökü **https://xre111.shop** olarak kaydedildi. `/home/workflows` n8n yönetim arayüzüdür, API kökü değildir. Kullanıcı anahtarıyla `GET /api/v1/workflows` erişimi HTTP 200 olarak doğrulandı. Mevcut iş akışları ve credentials değiştirilmedi; herhangi bir akış kendiliğinden başlatılmadı.

**n8n iş akışları** sayfasında URL ayarı, API sağlık testi, güvenli iş akışı/yürütme özetleri ve çift yönlü webhook kurulumu bulunur. API anahtarı `X-N8N-API-KEY` başlığıyla yalnız kayıtlı sunucunun yönetim API’sine gider. n8n webhook kimlik doğrulaması bundan farklıdır; API anahtarı webhook hedefine gönderilmez.

CRM → n8n bağlantısı için hedef iş akışının **Production Webhook URL**’si seçilmelidir. Sunucuda birden fazla aktif webhook bulunduğundan bu sürüm rastgele bir iş akışını seçmez. Hedefi **Üretim webhook hedefi** alanına kaydedin. n8n Webhook düğümünde `Header Auth` için `Authorization: Bearer <CRM webhook tokenı>` ayarlayın. Tokenı CRM’de **Tokenı göster** düğmesinden yetkili oturumda alın. Kural formuyla statü/huni seçip olayları kalıcı kuyruğa bağlayın. **Gerçek olay kuyruğa al** düğmesi seçilen müşteriyi gerçekten gönderir; demo değildir.

n8n → CRM yönünde n8n HTTP Request düğümü CRM’nin `/api/webhooks/n8n` uç noktasına aynı Bearer tokenı ile JSON gönderir. Olay tipleri `lead.created`, `lead.updated`, `stage.changed`; gövde `eventId`, `type`, `lead` içerir. Aynı olay kimliği tekrar geldiğinde kayıtlar tekrar işlenmez. Token API anahtarından farklı, sahip kapsamına bağlı türetilmiş bir değerdir; API anahtarı yenilenince token da değişir. Tokenı URL sorgusuna veya paylaşılan ekran görüntüsüne koymayın.

Geçici hatalar sınırlı yeniden denemeye gider. Zaman aşımı veya kesintide gerçek gönderimin sonucu belirsizse çift iletişim göndermemek için olay **needs_review** olarak tutulur. On dakikadan uzun `processing` olayları da incelemeye alınır; otomatik yeniden gönderilmez.

## Güvenlik ve doğrulama

Anahtarlar güvenli proje ortamında tutulur; frontend paketine, Git’e veya demo depolamasına eklenmez. API'ler yetkili sahip oturumu gerektirir. Webhook'lar bağımsız token doğrular. DNS/özel IP ve HTTPS kontrolleri, redirect yasağı, model girişinde gizli değer filtreleme, kaynak kimliği doğrulaması, işlem alan beyaz listesi, istek boyutu, eşzamanlılık ve kullanım sınırları uygulanır. Sohbette paylaşılmış anahtarların yenilenmesi önerilir.

OpenAI model erişimi ve yalnız sentetik müşteri verili gerçek sohbet/öneri yanıtı doğrulandı; canlı sağlayıcı modeli `gpt-4.1-mini`. Gerçek müşteriye arama veya WhatsApp test gönderimi yapılmadı. Önceki Meta/Evolution/Vapi/Netgsm canlı kurulum gereksinimleri devam eder.

Kaynaklar: [n8n API doğrulaması](https://docs.n8n.io/connect/n8n-api/authentication/), [n8n Webhook](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/), [OpenAI Chat API](https://platform.openai.com/docs/api-reference/chat/create).

## Seçilen iş akışları

Kullanıcı tarafından seçilen yedi linkten altı benzersiz n8n akışı CRM bağlantı ayarına kaydedildi. Hepsi aktif olarak bulundu. `LD8jlJvE1LBmMeE3` tekrar eden bağlantıdır ve iki kez kayıt/gönderim oluşturmaz.

| Akış | CRM’de kullanım | Tetikleyici / uyum |
| --- | --- | --- |
| `KWD5Yr7uuz2gMlI5` | Etkinlik geçmişi ve günlük rapor | Bitrix aktivite callback’i; sayısal aktivite/owner kimliği gerekir |
| `0PIWrbVUIcWf7AiZ` | Call center ve satışçı performansı | Bitrix lead/deal/VoIP olayı; CRM kimlik adaptörü gerekir |
| `IDJi8fQoxPxpWU5F` | Günlük arama raporu | Zamanlanmış akış; webhook yok |
| `LD8jlJvE1LBmMeE3` | Ekip görev/aşama/arama raporu | Zamanlanmış/manuel; webhook yok |
| `gWKseHEZL96T26iC` | Bitrix asistan ve etkinlik denetimi | Özel `action` API ve ayrı webhook anahtarı; genel lead olayı değildir |
| `ImTuxSRxDugg33aI` | GROWTH bugün/dün karşılaştırması | Zamanlanmış akış; webhook yok |

**Raporları eşitle** mevcut başarılı n8n yürütme çıktısını okur. Bu işlem akışı yeniden çalıştırmaz, yeniden e-posta veya Telegram raporu göndermez. Son çıktı bulunamadığında veya n8n yürütme verisi saklanmadığında eksik veri bilgisi gösterilir; sonuç uydurulmaz. Bitrix raporları ayrı kaynak/tarih olarak asistan bağlamına eklenir, yeni CRM müşteri sayılarıyla karıştırılmaz.

Bu akışların mevcut webhookları yeni CRM’nin `lead.created`, `lead.updated`, `stage.changed` JSON gövdesini doğrudan kabul eden genel girişler değildir. Canlı çift yönlü olay adaptörü için Bitrix kaynak kimlik eşlemesi ve özel gövde/token sözleşmesi tamamlanmalıdır. Bu nedenle rastgele test POST’u veya mevcut akış/credential değiştirme yapılmadı. Bazı mevcut akışlarda kod/Telegram URL içinde gömülü kimlik bilgisi ve doğrulanmamış webhook girişleri bulundu; bunların n8n credentials alanına taşınması ve doğrulamayla güçlendirilmesi önerilir. Değerleri raporlanmadı veya frontend’e aktarılmadı.
