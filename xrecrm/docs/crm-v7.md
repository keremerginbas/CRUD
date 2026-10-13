# XRE CRM v7 — Bitrix24 çalışma akışlarından geliştirmeler

## Bu sürümde kullanabileceğiniz yenilikler

### Kişisel çalışma alanı
CRM’nin Kanban, Liste, Etkinlikler ve Takvim sekmeleri aynı müşteri filtresini kullanır. **Kişisel görünümler** bölümünde filtrelerinize ad verip kaydedin; daha sonra seçim kutusundan yeniden açın. Kayıtlı görünümü kaldırmak yalnızca kişisel filtre tercihini kaldırır; müşteri verilerini silmez ve geri alınabilir.

**Gelişmiş filtre** ile şehir, aşama, oluşturulma tarih aralığı, tutar aralığı, bağlı kişi ve bağlı şirket üzerinden daraltabilirsiniz. Tarih sınırları Türkiye saatine göredir. Serbest portföy başlığı bir şirket bağlantısı sayılmaz. **Düzen** bölümünde sıkı, standart veya detaylı Kanban kartı ile liste sütunlarını seçin. Müşteri başlığı ve iletişim sütunu gizlenmez. Canlı tercihler doğrulanmış kullanıcı hesabında; demo tercihleri ayrı tarayıcı anahtarında saklanır.

### Veri kalitesi ve CSV aktarımı
Sol menüde **Veri kalitesi** ekranı görünür kayıtlarınızın eksik telefon/e-posta alanlarını ve mükerrer adaylarını gösterir. Bu ekran otomatik birleştirme veya silme yapmaz. Kişiler, Şirketler veya CRM sayfasından **CSV içe aktar** ile dosya seçin, sütun eşlemesini kontrol edin, önizleme oluşturun ve yalnızca yeni kayıtları ekleyin. Şirket bağlantıları için önce şirketleri, sonra kişileri aktarın.

CSV/TSV desteği; virgül, noktalı virgül ve sekme ayracı, UTF-8 BOM, tırnaklı/çok satırlı alanları kapsar. Dosya en fazla **1 MB / 1.000 veri satırı / 32 sütun** olabilir; sunucu istek gövdesi de sınırlıdır. Excel dosyasını UTF-8 CSV olarak kaydedin. Otomatik alan eşlemesini açılır kutularla düzeltebilirsiniz. Hatalı veya mükerrer satırlar açıklamayla ayrılır; sonuçta eklenen, önceden eklenmiş, atlanan ve hatalı satır sayıları gösterilir.

Aktarım **yalnız ekleme** yapar: mevcut kayıt üzerine yazma, replace, merge veya silme yoktur. Müşteriler Yeni aşamada oluşturulur; dosyadaki satış aşaması/huni/sorumlu alanları bu sürümde aktarılmaz. Bağlı kişi ve şirket kimlikleri yalnız görünür mevcut kayıtlarla ilişkilendirilir. Yetkisiz mükerrer kaydın adı/kimliği gösterilmez. İşlem kimliği ve atomik ekleme çift gönderim ile yarış durumlarına karşı koruma sağlar. Geliştirme sırasında gerçek müşteri aktarımı yapılmadı.

### Koşullu ve planlı robotlar
Otomasyonlar ekranında müşteri aşamasına bağlı kurala **tüm koşullar (AND)** veya **herhangi bir koşul (OR)** ekleyin. Şehir, kaynak, sorumlu, tutar, telefon/e-posta varlığı ve etiketler üzerinden değerlendirme yapılabilir. İşlem hemen ya da **10–10.080 dakika** sonra planlanabilir. Türkiye mesai penceresi seçilirse hafta içi 09.00–18.00 dışında işlem sonraki çalışma saatine ertelenir; resmi tatil takvimi bu sürümde dahil değildir.

**Kuralı müşteriyle test et** yalnız önizlemedir: müşterinin tetikleme aşamasına girdiği varsayımıyla koşul ve planlanan zamanı gösterir, gerçek aşamayı değiştirmez; mesaj/arama/görev/webhook oluşturmaz. Pasif kurallar pasif olarak belirtilir.

Canlı kuyruk, çalışmadan önce güncel müşteri aşamasını, aşamaya giriş kimliğini, kuralın sürümünü/koşulunu ve aktörün güncel yetkisini yeniden kontrol eder. Müşteri aşamadan çıkıp yeniden girmişse önceki girişin planı iptal edilir. Kural değiştirilmiş/pasifleştirilmiş ya da koşul artık sağlanmıyorsa dış iletişim yapılmadan atlanır. **Webhook günlüğü** planlanan zamanı ve karar açıklamasını gösterir. Demo gecikmeli kurallar plan olarak gösterilir; arka planda gerçek iletişim yapılmaz.

### Aşamaya göre zorunlu alanlar
CRM’de huni ayarını açın. Her aşama için telefon, e-posta, şehir, kaynak, sorumlu, bağlı kişi ve bağlı şirket alanlarından hangilerinin zorunlu olduğunu seçin. Müşteri formu eksik alanları gösterir; hızlı ekleme, taşıma, form, AI ve webhook yazma yolları sunucuda aynı kurala tabidir. İçe aktarma da alan politikasını aşamaz. Randevu için ayrı tarih ve saat zorunluluğu korunur. Mevcut veriler topluca değiştirilmez; politika sonraki yazma işlemlerinde uygulanır.

## Korunan ve güçlendirilen sınırlar
Rol ve kayıt kapsamı hem API hem depoda korunur. Kendi kapsamındaki kişi/şirket sorumlusu başka kullanıcıya devredilemez. Yarım kalan gelen webhook kayıtları on dakikalık süre dolduğunda tekrar kuyruğa alınır; belirsiz dış gönderimler insan incelemesinde kalır. HMR/WebSocket düzeltmesi, beyaz XRE logosu, temalar, mesai, AI ve Vapi seçimleri korunmuştur.

## Canlı entegrasyonların kalan kurulumu
Bu sürüm Google hesabı/OAuth kurulumunu, SIP/PBX cihaz ayarlarını veya WhatsApp QR sağlayıcı kurulumunu tamamlamış saymaz. Vapi’nin doğru çağrı sonucu ve transkripti CRM’ye dönmesi için sonuç webhook’u da yapılandırılmış olmalıdır. n8n’de seçili raporların okunması ile CRM olaylarının akışa yazılması farklıdır; üretim webhook sözleşmeleri ve kimlik doğrulaması ayrıca tamamlanmalıdır. Sağlayıcı anahtarları yalnız sunucuda tutulur.

Bitrix24’ün bütün kapalı kaynak koduna erişim veya tüm ürününün birebir kopyası iddiası yoktur. Bu sürüm, yüklenen kaynaklar ve resmî belgelerden seçilmiş dört somut operasyonel geliştirmeyi uygular. Ürün kataloğu/teklif yönetimi, kapsamlı proje rol modeli, paylaşılabilir ekip görünümleri, XLSX okuma, veri birleştirme ve tatil takvimi bu tur uygulanmamıştır.
