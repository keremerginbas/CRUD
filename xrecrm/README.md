> **ZIP / Windows / XAMPP teslimi:** Önce `ONCE-BUNU-OKUYUN.md` dosyasını okuyun. Bu Node.js uygulamasıdır; Apache/PHP ile doğrudan açılmaz. Yerel arayüz demo olarak çalışır, canlı kullanıcı girişi mevcut Manus OAuth kurulumuna bağlıdır. Aşağıdaki eski sürüm notları tarihsel olabilir; güncel kapsam `docs/crm-v7.md` içindedir.

# XRE CRM — İletişim & Satış Merkezi

Türkçe birleşik CRM; müşteri yönetimi, Kanban, WhatsApp gelen kutusu, çoklu hesap QR bağlantıları, hat envanteri, statü otomasyonları ve webhook günlüğü.

## Kaynak devamlılığı

Yüklenen emlak CRM uygulamasının React kaynakları ve Drizzle şeması `legacy/crm` içinde korunmuştur. WhatsApp uygulamasının sunucu hizmetleri, rotaları ve arayüz kaynağı `legacy/whatsapp` içindedir. Birleşik arayüz `client/src/workspace` altındadır. React/TypeScript/Vite ve Node sunucu mimarisi devam eder; CRM arşivi `server` dizinini içermediği için sunucu katmanı yeniden oluşturulmuştur. Eski `.env`, SQL müşteri dökümü, tarayıcı günlükleri ve özel medya yeni proje deposuna aktarılmamıştır. Mevcut dış veritabanına herhangi bir yazma, aktarma veya silme yapılmamıştır.

## Çalıştırma

Node 22 ve pnpm 10.15.1 gerekir. `pnpm install --frozen-lockfile`, ardından `pnpm dev` çalıştırılır. Sunucu 3000 portunda React arayüzünü ve API uç noktalarını birlikte sunar. Üretim: `pnpm build`, `pnpm start`. Dockerfile aynı kurulum ve derleme akışını uygular. Doğrulama: `pnpm check` ve `pnpm test`.

## Veri ve güvenlik

Demo, açıkça etiketlenmiş sentetik müşterilerle çalışır ve değişiklikleri yalnızca tarayıcının localStorage alanında saklar. Sağlanan 47 hat ve 13 ICCID eşleşmesi gerçek envanter bilgileridir; bağlı WhatsApp/SIP oturumu olarak gösterilmezler. Demo mesajları, aramalar ve otomasyonlar dış sağlayıcılara gönderilmez.

Canlı CRM, Manus oturumunu ve kalıcı MySQL veritabanını kullanır. Oturum olmadan özel API uç noktaları 401 döner. Sağlayıcı anahtarları yalnızca sunucu ortamında tutulur. Gerçek operasyonlar için ayrı WhatsApp oturum sağlayıcısı, Netgsm/PBX ağ geçidi ve Vapi hesabının yapılandırılması gerekir. Ayrıntılar `docs/integrations.md` içindedir. Bağlantı bilgileri yapılandırılana ve doğrulanana kadar herhangi bir canlı entegrasyonun çalıştığı iddia edilmez.

## Hat grupları

| Grup | Hat sayısı | ICCID eşleşmesi |
| --- | ---: | ---: |
| Yapay Zekâ | 8 | 0 |
| OFİX PBX | 16 | 0 |
| Bulut PBX | 23 | 13 |
| Toplam | 47 | 13 |

## Yapı

`client/src/workspace/components`: modal, avatar, müşteri formu ve ortak bileşenler. `pages`: genel bakış, CRM/Kanban, WhatsApp, otomasyon, hat ve entegrasyon ekranları. `store.tsx`: demo/canlı veri ayrımı ve API erişimi. `server`: kalıcı veri, oturum güvenliği, sağlayıcı bağlantıları, gelen webhooklar ve giden işlem kuyruğu. `tests`: gerçek servis çağrısı yapmadan veri ve kullanıcı akışı kontrolleri. `public/manus-routes.json`: tüm sayfa yolları.

## Bitrix24 benzeri CRM devam sürümü

Çoklu satış hunisi ve renk/başlık düzenleme, fırsat Kanban/liste/toplu atama, ayrı kişi/şirket kayıtları, sağ CRM paneli ve zaman çizelgesi, görev Kanbanı ve kontrol listesi, aylık takvim, ekip dizini/akışı ve anlık satış analitiği eklendi. Ürün XRE markasıyla sürer; Bitrix24’ün tüm ürünü veya lisanslı sürümü değildir. Ekip profili eklemek oturum/izin vermez. Gerçek ekip rol yönetimi, e-posta sağlayıcısı, Gantt ve dosya sürümleme bu sürüm kapsamında değildir.

Eski demo anahtarı ve kayıtlar korunur. Yeni canlı kayıtlar aynı MySQL kayıt tablosunda yetkili sahip kapsamındadır; veri silme veya eski müşteri dökümü seed işlemi yapılmaz. 37 test ve üretim derlemesi başarılıdır. Ayrıntı: `docs/crm-v3.md`.
