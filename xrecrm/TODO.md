# XRE CRM geliştirme durumu

- [x] realestate-crm.zip ve media.zip kaynakları legacy altında korundu; gizli ayarlar, özel medya ve müşteri dökümü yayımlanmadan Türkçe birleşik CRM ve iletişim merkezi oluşturuldu. CRM arşivinde server dizini bulunmadığı için yeni sunucu katmanı uygulandı.
- [x] Müşteri kaydı, iletişim bilgileri, sorumlu danışman, notlar, geçmiş etkileşim ve güncel statü; CRM ile senkron Kanban. Altı aşama: yeni, iletişim, nitelikli, teklif, kazanıldı ve kaybedildi.
- [x] Statü değişimi ve yeni kayıtta görev, WhatsApp, Vapi veya webhook kuralları; kimlik doğrulamalı gelen/giden webhooklar, olay eşleme, hata günlüğü, kalıcı kuyruk ve sınırlı yeniden deneme altyapısı.
- [x] WhatsApp çoklu hesap kartları, gerçek QR sağlayıcısı istemcisi, bağlantı durumları ve Meta Cloud API metin mesajlaşması CRM ile bağlandı. Sağlayıcıdan QR gelmedikçe kod gösterilmez; kaynak sırları tarayıcıya aktarılmaz.
- [ ] Canlı QR eşleştirmesi ve Meta/Evolution mesaj teslimi: ayrı sürekli çalışan Evolution API ile güvenli provider anahtarları gerekir. Eski medya/şablon/WebSocket katmanı legacy içinde korunur; birleşik canlı medya göçü uygulanmadı.
- [x] Vapi AI arama başlatma/sonuç webhooku; Netgsm/PBX ağ geçidi yapılandırma ve sağlık kontrolü; mantıksal hatların gerçek sağlayıcı kimlikleriyle açık eşleştirilmesi.
- [ ] Netgsm/FST/SIP trunk, cihaz/dahili yönlendirme, RTP ve CDR senkronizasyonu ile Vapi gerçek hat/asistan kurulumu: yetkili canlı sağlayıcı ve PBX yapılandırması gerekir. Canlı arama uçtan uca test edilmedi.
- [x] 8 Yapay Zekâ, 16 OFİX PBX, 23 Bulut PBX: 47 hat ve 13 ICCID eşleşmesi tam olarak saklanır ve gösterilir. Bağlantılar doğrulanmadan bağlı gösterilmez.
- [x] Yerel uygulama müşteri bağlamı JSON aktarımı, Bitrix placement doğrulama endpointi, n8n HTTP olay akışı, demo/canlı veri ayrımı ve kalıcı veritabanı.
- [ ] Bitrix portalında gerçek uygulama/placement kaydı ve sahip kimliği; canlı servis anahtarları güvenli ortam ayarlarından yapılmalı. Portal mevcut ayarları değiştirilmedi.
- [x] Salt okunur bağımsız inceleme; bulunan QR yanıtı, inbound retry ve kaybedildi aşaması kusurları düzeltildi. TypeScript, 23 otomatik test ve üretim derlemesi başarılı. 11 sayfa, sağlık ve API erişim sınırları doğrulandı.

## Bitrix24 benzeri CRM çalışma alanı — devam geliştirmesi

Mevcut WhatsApp/Netgsm/Vapi entegrasyon sınırları korunur; Bitrix24 markası veya tüm ürünün eksiksiz kopyası iddia edilmez. Resmî referanslar: https://www.bitrix24.com/articles/project-board-work-as-crm.php ve https://www.bitrix24.com/tools/tasks_and_projects/features/task-management.php. Ortak CRM bağlamı, ayrı kişi/şirket kayıtları, müşteri zaman çizelgesi ve son tarihli görevlerin satış hunisine bağlanması esas alınır.

- [x] Bitrix24 tarzı daha yoğun CRM çalışma alanı: mavi/turkuaz vurgu, koyu sol gezinme, yatay CRM sekmeleri; mevcut iletişim merkezine erişim korunur.
- [x] Fırsatlar için Kanban/liste görünümleri, çoklu satış hunisi seçimi ve huni ekleme; aşama adları altı kararlı statüye bağlı düzenlenebilir; hızlı kart ekleme ve danışman/kaynak/aktivite filtreleri.
- [x] Ayrı kişi ve şirket kayıtları: oluştur/düzenle, arama ve şirket ilişkisi; fırsatı kişiye ve şirkete ilişkilendir; mükerrer telefon/e-posta kontrolü.
- [x] Sağdan açılan CRM ayrıntı paneli: bilgiler, aşamalar, kişi/şirket, notlar, sorumlu, sonraki etkinlik; zaman çizelgesinde not/mesaj/arama/görev ilişkisi.
- [x] CRM bağlantılı görevler: sorumlu, son tarih, öncelik, kontrol listesi ve yapılacak/devam/bitti durumları; liste/Kanban görünümleri; gecikmiş filtreleri.
- [x] Takvim: aylık görünümde CRM etkinlikleri; görüşme/arama/görev planla ve tamamla; veriler kalıcı ve görev/CRM bağlamıyla bağlı.
- [x] İş akışı/ekip akışı: CRM notları ve ekip gönderileri; beğeni/yorumlar uygulama içinde; ekip dizini yalnız iş kayıtları ve danışman ataması, yeni kullanıcıya erişim vermez.
- [x] Satış analitiği: mevcut kayıtlarla huni/aşama/sorumlu/kaynak kırılımı, açık/kazanılmış/kaybedilmiş değerler ve gecikmiş faaliyetler. Tarihsel analitik veri yoksa uydurulmaz.
- [x] Yeni modüller demo yerel verisi ve kimliği doğrulanmış kalıcı MySQL API arasında ayrılır; eski demo verisi ve canlı müşteri verileri korunur. Salt okunur bağımsız inceleme ve otomatik regresyon testleri.

Bu devam sürümünde 37 otomatik test, TypeScript denetimi ve üretim derlemesi başarılı. 18 sayfa manifesti ve HTTP yanıtları doğrulandı. Bağımsız inceleme bulguları düzeltildi; canlı sağlayıcı bağlantısı ve gerçek ekip erişim yönetimi önceki açık kurulum sınırlarında kalır.

## Yapay zekâ ve n8n bağlantısı

- [x] Paylaşılan OpenAI/n8n anahtarları yalnız güvenli proje ortamına kaydedilsin; tarayıcı, kaynak, Git, log veya demo depolama içinde bulunmasın.
- [x] Her sayfada chatbot erişimi ve seçili müşteri bağlamı; CRM, kişi/şirket, görev, takvim, görüşmeler, statüler ve otomasyonlarla ilgili sorulara veriye dayalı Türkçe cevaplar.
- [x] İstek üzerine günlük/tarih aralığı raporları, deterministik metrikler, AI analiz ve risk/sonraki adım önerileri; rapor indirme ve sohbet geçmişi. Demo/canlı ayrımı, Türkiye saat dilimi, eksik veri ve kayıt sınırları açık olsun.
- [x] CRM işlemlerini yöneten uygulanabilir öneri kartları: müşteri ve statü güncelleme, görev/etkinlik/not oluşturma, kişi/şirket/kural taslağı ve mesaj/arama taslağı. İşlem sonucu doğrulanmadan tamamlandı iddiası olmasın; dış iletişim inceleme üzerinden başlatılsın.
- [x] n8n sunucu URL’si ayarı, güvenli Public API kontrolü, iş akışı/yürütme görüntüleme ve üretim webhook bağlantısı; API key ile webhook doğrulama ayrımı, tekrar koruması ve hatalı/eksik kurulum görünümü.
- [x] Yetkili sahip erişimi, gizli değer maskeleme, dış URL sınırları, demo dış çağrı engeli ve odaklı testler; bağımsız salt okunur inceleme ve sürüm kaydı.

### Kullanıcının seçtiği n8n akışları

- [x] KWD5Yr7uuz2gMlI5, 0PIWrbVUIcWf7AiZ, IDJi8fQoxPxpWU5F, LD8jlJvE1LBmMeE3, gWKseHEZL96T26iC, ImTuxSRxDugg33aI API üzerinden aktif bulundu ve altı benzersiz CRM bağlantısı olarak kaydedildi; LD8jlJvE1LBmMeE3 tekrar kaydı oluşturulmadı.
- [x] Her akışın gerçek webhook/schedule/action sözleşmesi ayrı salt okunur incelemeyle değerlendirildi. Seçili akış kartları, durum, gerçek n8n bağlantısı ve son rapor görüntüleme eklendi.
- [x] Son başarılı yürütmelerin güvenli rapor çıktısını okumak için sahip kapsamlı rapor API’si ve eşitleme eklendi; n8n akışı/credentials etkinleştirilmez veya yeniden çalıştırılmaz. Bitrix çıktıları tarih/kaynak etiketiyle AI bağlamına ayrılır.
- [ ] Eski Bitrix workflowlarına CRM olay adaptörü ve Bitrix kaynak kimlik eşlemesi: mevcut workflowlar yeni CRM UUID/generic olayını doğrudan kabul etmiyor. Özel Bitrix asistan `x-api-key` girişi, callback imzası ve credentials temizliği ayrıca tamamlanmalı. Uyumsuz olay/yanlış rapor üretmemek için kör test POST’u yapılmadı.

## AI/n8n doğrulama sonucu

Her sayfada ortak sohbet, özel AI merkezi, seçili müşteri bilgisi, görev/etkinlik/kişi/şirket/müşteri/statü/not/kural ve iletişim öneri kartları uygulandı. Canlı OpenAI model erişimi ve sentetik CRM verisiyle gerçek sohbet, görev önerisi ve geçmiş kaydı HTTP 200 olarak doğrulandı. Raporlar Türkiye saatiyle ve deterministik sayılarla istek üzerine üretilir; geçmiş veri/sayısal sınırlar gösterilir ve Markdown indirilir. Normal sohbet gereksiz rapor oluşturmaz. Geçmiş öneriler arşiv olarak gösterilir ve yeniden uygulanmaz. Anahtarlar tarayıcı ve kaynaklardan uzak; ham provider payload’ları API state serileştirmesinden kaldırıldı. URL ve erişim testleri, bağımsız inceleme, 67 otomatik test ve üretim derlemesi başarıyla tamamlandı.

Canlı n8n API bağlantısı doğrulandı. Altı workflow son yürütme okumasında beş başarılı yürütme kaydı bulundu; iki akışta etiketli rapor özeti vardı. Bitrix Ekip Raporu için başarılı yürütme bulunmadı. Bu durum eksik veri olarak gösterilir, akışlar yeniden çalıştırılmaz. Workflow olay adaptörü önceki açık kriterde kalır; canlı yanlış test mesajı/arama/e-posta/Telegram gönderilmedi.

## CRM v5 · 13 Ekim kullanıcı isteği

- [x] AI doğrudan bu CRM verilerine göre cevap verir; kaç arama yapıldı/başarılı/gelen arama, müşteriyle görüşün etkinlikleri ve WhatsApp kime ne geldi/ne konuşuldu soruları gerçek kayıt ve veri kapsamıyla yanıtlanır. Sonuç bilinmiyorsa açıkça belirtilir; eski Bitrix raporları yeni CRM faaliyetleriyle karıştırılmaz.
- [x] Her tamamlanmış transkriptli görüşme ve WhatsApp metin sürümü AI tarafından analiz edilir; kişi/müşteri kartına kaynaklı yorum olarak otomatik bırakılır. Eksik ses/transkript için analiz uydurulmaz, aynı veri tekrar yorum üretmez.
- [x] Müşteri kartı Bitrix referansı gibi geniş paneldir: kişi kartı, şirket kartı, kaynak, şehir, randevu tarihi; sağda yorum ve etkinlik bölümü. Müşteriyle görüşün etkinliği açıklama/tarih/saat ile kaydedilir, kaydette aşağı akışa düşer ve tamamlanabilir.
- [x] Randevu seçerken ayrı tarih ve saat zorunludur. Randevu statüsüne Kanban/list/form/AI/webhook ile geçerken tarih ve saat olmadan işlem gerçekleşmez. Randevuya on dakika kalınca uygulama içi bildirim görünür, tekrar bildirim oluşmaz; iptal/tarih değişimi eski bildirimi geçersizleştirir.
- [x] En önemli istek erişim izinleri ekranıdır: sahibi rol ve modül izinlerini düzenleyebilir; kullanıcı ve departmanlar role atanır; kendi/tüm kayıtlar okuma ve yazma API'de korunur, AI de bu kapsamı aşmaz. Yabancı davetsiz ve pasif kullanıcı erişmez. Uygulama sahibi kendi yetkisini kaybedemez. Gerçek erişim değişikliği arayüzden etkisi görülerek yapılır.
- [x] Kullanıcı ekleme/çıkarma (pasifleştirme), çalışan dizini, departman hiyerarşisi ve profil ekranı vardır. Çıkarma CRM tarihçesini silmez. Mevcut Manus kimliğiyle doğrulanan çalışan eşlemesi kullanılır; gerçek çalışanlar izinsiz otomatik etkinleştirilmez.
- [x] Yüklenen mesai-guncelleme(1).zip uygulaması incelenip native CRM oturumuna entegre edilir: başlat/mola/dönüş/bitir/devam et, İhtiyaç/Yemek/Online randevu molaları, net süre, günlük kayıtlar, ekip raporu ve profil mesai durumu. Kalıcı sunucu zamanı/idempotent geçişler kullanılır. Zipte olmayan canlı config.php/SQLite geçmişi ve Telegram/Bitrix dış kurulum tamamlanmış gibi gösterilmez.
- [x] Yeni modüller, API erişim ve randevu akışları test edilir; karmaşık bağlantılar bağımsız salt okunur inceleme ile kontrol edilir. Tamamlanan sürüm kaynak geçmişine kaydedilir.

### Son kurumsal logo yönlendirmesi

- [x] Kullanıcının XRE CRM logosu beyaz arka planı kaldırılarak şeffaf PNG olarak hazırlandı; orijinal değiştirilmedi. Logo sol menü, sekme simgesi ve proje metadata alanında kullanılır.

Bu aşamada gerçek çalışan aktif/pasif rol ataması yapılmadı; erişim düzenleme ekranları ve kimlik eşleştirme süreci hazırlandı. Mesai kayıtları CRM içinde native/kalıcıdır; ZIP dışında kalan SQLite/Bitrix/Telegram göçü açık sınırdır. Telefon ve WhatsApp metrikleri yalnız ulaşan kaynak kayıtlarını sayar; SIP/CDR/transkript/QR sağlayıcı kurulumu önceki açık maddelerde kalır. Kapalı tarayıcıya push bildirimi kurulmadı.

## Kanban önizleme WebSocket düzeltmesi

- [x] Vite HMR ayrı 24678 portu yerine CRM HTTP sunucusundaki /__vite_hmr yoluna bağlandı. HTTPS önizleme tarayıcı origin’i ve 443 portunu kullanır; localhost hedefi veya hata susturma kullanılmaz. Gerçek public WSS bağlantısı connected olarak doğrulandı. Tekrarlanmayı önleyen yerel HTTP/WebSocket regresyon testi, TypeScript ve üretim derlemesi başarılı.

- [x] 13 Ekim son logo isteği: XRE harfleri beyaz, CRM ve bağlantı çizgileri turkuaz, arka plan şeffaf. Yeni dosya adıyla sol menü, yükleme görünümü, sekme simgesi ve proje logosu güncellendi; eski görsel tarayıcı önbelleğine bağlı değildir.

## CRM v6 · Kullanıcının 13 Ekim 12:09 isteği

- [x] CRM Fırsatlar yerine Kanban–Liste–Etkinlikler–Takvim ortak görünüm; müşteri, sorumlu, huni, arama/kaynak filtreleri ve aktif görünüm korunur. Kompakt kartlarda açık etkinlik sayıları; küçük ama açık ve erişilebilir telefon/WhatsApp/etkinlik oluşturma düğmeleri, ilgili müşteriye hazır bağlam.
- [x] Etkinlikler Geciken, Son tarihi bugün, Bu hafta, Gelecek hafta, İki hafta sonra, Daha sonra, Etkinlik yok gruplarıyla; tamamlanmış/iptal edilmiş kayıtlar açık sayıya girmez; ekleme/düzenleme/tamamlama aynı CRM kaydına yansır. Takvimde gerçek etkinlikler Türkiye tarih-saatine göre gösterilir.
- [ ] Mesajlaşma ve CRM’den Google Meet online toplantı planlama: ayrı tarih ve saat zorunlu, süre/katılımcı/sorumlu/not, gerçek Google konferans linki, kopyala/katıl ve WhatsApp paylaşım taslağı, müşteri/takvim ilişkilendirmesi. Eksik OAuth veya pending durumda gerçek link varmış gibi davranılmaz; demo dış çağrı yapmaz. Tekrar tıklama aynı toplantıyı çoğaltmaz.
- [x] Kullanıcıya özel tema/fon/yoğunluk/yazı boyutu; gerçek kullanıcı tercihleri kalıcı ve kullanıcıya özel, demo ayrı. Referanslardaki kompakt çalışma alanı ve üst üste gelen izin metinleri düzeltilir; mobil kullanılabilirlik korunur.
- [ ] Mevcut RBAC, randevu zorunluluğu, AI analiz, mesai, n8n ve güvenli HMR korunur. Yeni görünüm/iletişim/tema/toplantı akışları test ve salt okunur bağımsız incelemeyle doğrulanır; sürüm kaydedilir.

### CRM v6 son durum

Kanban/Liste/Etkinlikler/Takvim, kart Ara/WhatsApp/Etkinlik/Toplantı, tarihsiz görev düzenleme, müşteri zorunluluğu, Türkiye saati, liste hızlı iletişim ve kişisel tema/yoğunluk/yazı boyutu tamamlandı. Bağımsız inceleme bulguları odaklı regresyonlarla düzeltildi. 30 test dosyasında 125 test başarılı; TypeScript başarılı.

Google OAuth ve konferans oluşturma kodu mock sağlayıcıyla test edildi; canlı Google OAuth uygulama kimliği/secret/callback/şifreleme anahtarı ve kullanıcı yetkilendirmesi henüz yok. Bu yüzden otomatik gerçek Meet üretimi canlı doğrulanmadı; mevcut gerçek bağlantı ekleme yolu hazır. Telefon uygulaması `tel:` ile açılır; tarayıcı içinde gerçek SIP konuşması için PBX ağ geçidi kurulumu hâlâ gereklidir. Demo dış servislere iletişim/davet göndermez.

## Vapi özel anahtar bağlantısı · 13 Ekim
- [x] Kullanıcının sağladığı VAPI_API_KEY yalnız sunucu için güvenli platform girişinde saklandı; geliştirme hizmeti yeni anahtarı yükledi. Asistan ve telefon hattı listeleme HTTP 200; gerçek arama başlatılmadı.
- [x] CRM’de gerçek Vapi asistanları ve numara ile doğrulanmış hatlar seçilebilir. Rastgele varsayılan asistan atanmaz; eşleşmeyen veya yinelenen hat çağrı başlatmaz. Kaynak ve tarayıcı yanıtına anahtar, SIP credential veya asistan promptu verilmez.
- [x] API erişimi ve hazır arama/webhook durumu ayrı gösterilir. Mevcut Vapi→n8n webhookları değiştirilmeden kurulum sınırı açık kalır.
- [x] Vapi doğrulama, seçim ve yetki regresyonları provider mocklarıyla test edilir; mevcut CRM testleri ve üretim derlemesi korunur, kaynak sürümü kaydedilir.

### Vapi canlı doğrulama sonucu

API anahtarı yalnız sunucu ortamında; 22 asistan ve 8 gerçek numara envanterle doğrulandı (5 Yapay Zekâ, 3 Bulut PBX). Katalog ve arama ön doğrulaması uygulandı, seçili asistan açıkça doğrulanır; API/arama/webhook durumu ayrıdır. 33 test dosyasında 136 test ve TypeScript başarılı. Gerçek çağrı, uzaktaki hat/asistan/webhook değişikliği yapılmadı. Mevcut Vapi→n8n akışlarının yeni CRM’ye güvenli sonuç aktarımı henüz canlı doğrulanmadı.

## CRM v7 · Bitrix kaynak araştırması ve geliştirme
- [x] Yüklenen erişilebilir legacy CRM, WhatsApp, mesai ve n8n kaynakları altı iş alanında resmî Bitrix24 dokümanlarıyla karşılaştırıldı; dosya envanteri, referanslar ve somut açıklar raporlandı. Kapalı Bitrix24 tüm kaynaklarına erişim iddiası yok.
- [x] İsimli kaydedilmiş CRM görünümleri kullanıcıya özeldir; demo/canlı ve kullanıcı değişiminde karışmaz. Şehir/aşama/tarih/bağlantılı kişi-şirket filtreleri mevcut huni/arama/sorumlu/kaynakla dört görünümde birleşir. Kompakt/standart/detaylı Kanban kart profili ve liste kolon seçimleri kalıcıdır; zorunlu müşteri başlığı ve iletişim kaybolmaz.
- [x] CSV/TSV içe aktarmada dosya çözümleme, alan eşleme, önizleme ve hatalı/mükerrer satır ayrımı bulunur. Canlı önizleme yazma yapmaz. Yalnız yeni kayıt ekleme kullanıcı tarafından başlatılır; mevcut kişi/şirket/müşteri silinmez, merge/replace yapılmaz. Kendi kayıt kapsamı ve rol korunur; çift gönderim koruması ve sonuç özeti vardır. Veri kalite ekranı izinli kayıtların eksik alan ve mükerrer adaylarını açıkça gösterir.
- [x] Otomasyonlar AND/OR koşullarını, hemen veya 10+ dakika gecikmeyi ve Türkiye mesai penceresini destekler. Dry-run müşteri ve kuralı değerlendirir ama görev/mesaj/arama/webhook üretmez. Gecikmeli iş çalışmadan önce güncel kayıt statüsü/koşulları ve aktör yetkisi doğrulanır; eski kural/uyumsuz koşul dış yan etki yapmadan atlanır. Kuyruk ve hata günlüğü çalışma zamanı/karar açıklaması gösterir.
- [x] Huni/aşama zorunlu alan politikası telefon/e-posta/şehir/kaynak/sorumlu/kişi/şirket üzerinden düzenlenebilir; hızlı ekleme, taşıma, form, AI ve webhook sunucu yazma yolları ortak doğrulamayı kullanır. Mevcut randevu ayrı tarih-saat kuralı gevşemez; mevcut veriler topluca değiştirilmez.
- [x] Yeni modüller gerçek uygulama kabuğuna ve izin matrisine bağlanır; otomatik davranış/sunucu testleri, tür kontrolü, üretim derlemesi ve bağımsız salt okunur inceleme ile doğrulanır. Mevcut Vapi, AI, mesai, temalar, iletişim ve HMR korunur; geliştirilen kaynak sürümü kaydedilir.

### V7 doğrulama ve kalan kurulum

42 test dosyasında 162 test geçti; son atomik oluşturma düzenlemesinde ilgili 19 API senaryosu yeniden doğrulandı. TypeScript ve üretim derlemesi başarılı. Bağımsız salt-okunur incelemedeki dört bulgu sahiplik, atomik ekleme, aşama giriş kimliği ve yarım kalan gelen webhook kurtarmasıyla düzeltildi; odaklı regresyonları geçti. 27 sayfa manifesti kaynak ile eşleşti; yeni API uçları yetkisiz oturumda 401 döndü. Google OAuth/hesap yetkilendirmesi, QR/SIP/PBX sağlayıcı kurulumu, Vapi sonuç webhook’u ve n8n üretim yazma sözleşmeleri bu turda tamamlanmış sayılmadı. Gerçek müşteri verileri aktarılmadı/silinmedi; çağrı veya mesaj gönderilmedi.
