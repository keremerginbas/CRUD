# Vapi hesabı ve CRM bağlantısı

13 Ekim 2026’da kullanıcının sağladığı özel Vapi anahtarı güvenli proje kartıyla kaydedildi; yalnız sunucu ortamında kullanılır. `GET /assistant` ve `GET /phone-number` sorguları HTTP 200 döndü. Hesapta sekiz telefon kaydı var; anahtar doğrulamasında hiçbir gerçek arama başlatılmadı ve uzaktaki asistanlar/numaralar değiştirilmedi.

CRM envanterindeki numaralar gerçek Vapi `phoneNumberId` kayıtlarıyla telefon numarası birebir eşleşerek bağlanır. Birden çok asistan olduğu için varsayılan asistan rastgele seçilmez; arama panelinden kullanılacak asistan açıkça seçilir. Bir hattın Vapi’deki gelen arama asistanı, giden aramanın varsayılanı olarak kabul edilmez.

Mevcut asistanların webhook adresleri n8n sunucusuna yöneliyor. Mevcut otomasyonları bozmamak için adresler değiştirilmez. Arama/transkript sonuçlarının yeni CRM’ye ulaşması için n8n → CRM güvenli olay aktarımı veya ayrıca onaylanmış Vapi webhook kurulumu gereklidir. API anahtarı, webhook doğrulama sırrının yerine kullanılmaz.

Kaynaklar:
- [Vapi telefon numarası listeleme API’si](https://docs.vapi.ai/api-reference/phone-numbers/list): private key ile sunucu Bearer doğrulaması, `number`, `assistantId`, `credentialId`, `provider` alanları; liste için limit en çok 1000.
- [Vapi asistan ve arama başlangıcı](https://docs.vapi.ai/assistants/quickstart): gelen asistan numaraya bağlanabilir; giden aramada hedef numara, kullanılacak telefon hattı ve asistan seçilir.

Canlı sağlayıcıda asistan/hat metadata erişimi doğrulanmıştır. SIP ses kalitesi, müşteriyle gerçek arama ve transkriptin CRM’ye varışı test edilmiş gibi gösterilmez.

## CRM’de kullanım

Canlı katalog tekrar doğrulamasında **22 asistan ve 8 eşleşen Vapi hattı** bulundu. Hatların beşi Yapay Zekâ, üçü Bulut PBX envanterindedir. Vapi kayıtlarından hiçbiri envanter dışında kalmadı. Diğer CRM hatlarının bu hesapta Vapi karşılığı yoktur; onlar için arama hazır olduğu gösterilmez.

**Kanban → müşteri kartı → Ara → Yapay zekâ araması** yolunda veya **Aramalar → Yeni AI araması** penceresinde doğrulanmış telefon hattını ve kullanılacak asistanı adıyla seçin. Başlat'a basmadan gerçek arama yapılmaz. Bağlantı doğrulaması müşteri araması, ses kalitesi veya başarı sonucu yaratmaz.

**Entegrasyonlar → Vapi AI → Yapılandır** paneli hesap erişimini, asistan sayısını, eşleşmiş numaraları ve webhook ihtiyacını gösterir. API anahtarı tarayıcı formunda istenmez/gösterilmez. Varsayılan asistan atanmadığı için giden asistanı her aramada açıkça seçebilirsiniz.
