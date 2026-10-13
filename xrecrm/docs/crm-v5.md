# XRE CRM v5 · Müşteri çalışma alanı, erişim ve mesai

## Asistan hangi veriye bakar?

Asistan bu CRM’nin yetki kapsamındaki müşteri, kişi, şirket, görev, takvim, telefon ve WhatsApp kayıtlarına bakar. Günlük raporlar Türkiye saatiyle seçilir. Gelen/giden arama, servis tarafından doğrulanmış başarılı/başarısız arama ve sonucu bilinmeyen arama ayrı sayılır. **`ended` yalnız görüşmenin sona erdiğini gösterir, satış başarısı değildir.** Planlanmış «Müşteriyle görüşün» etkinliği ile gerçekleşmiş telefon görüşmesi ayrı metriklerdir.

Eski Bitrix/n8n kaynaklı raporlar kendi kaynağı ve dönemiyle gösterilir; bu CRM’nin faaliyet sayısına eklenmez. Eksik çağrı yönü, başarı değerlendirmesi, CDR, transkript, teslim bilgisi veya sınırlandırılmış kayıt geçmişi açıkça belirtilir. «Kaç gelen arama oldu?» sorusu için sağlayıcının yön alanı CRM’ye ulaşmalıdır; «ne konuşuldu?» sorusu için metin/transkript gerekir.

## Görüşmelerin otomatik analizi

Yeni WhatsApp metinleri ve tamamlanmış transkriptli aramalar kalıcı kuyruğa alınır. AI özeti, müşteri niyeti, sonuç değerlendirmesi, sonraki adım ve veri sınırlamaları CRM fırsatının sağ akışına ve ilişkilendirilmiş kişi kartına kaynak kimliğiyle yorum olarak yazılır. Aynı kaynak/veri sürümü tekrar işlenirse yeni yorum çoğaltılmaz. Eksik transkriptte veya kişi/müşteri bağlantısı olmayan kaynakta konuşma uydurulmaz; ilişkisiz WhatsApp konuşmaları birbirine karıştırılmaz. Ses dosyası tek başına yeterli değildir; bu sürüm keyfi kayıt URL’sinden otomatik ses transkripsiyonu yapmaz.

Karttaki «Görüşmeleri analiz et» işlemi geçmiş kaynakların analizi için kullanılabilir. İşlem gerçek modda AI yetkisi ister; demo dış modele çağrı yapmaz. Bu sürüm geçmiş müşteri kayıtlarını izinsiz topluca harici modele göndermedi.

## Müşteri kartı

Geniş Bitrix tarzı panelde solda müşteri/kişi, şirket, kaynak, şehir, sorumlu ve randevu alanları; sağda yorum, etkinlik, yapılacaklar ve etkileşim akışı bulunur. «Etkinlik» sekmesinde başlık «Müşteriyle görüşün» olarak gelir. Açıklama, ayrı tarih ve ayrı saat seçilip Kaydet’e basılınca etkinlik aşağıdaki akışa düşer; düzenlenebilir ve tamamlanabilir. Kişiler listesindeki satır kişi kartını, kalem düğmesi düzenleme formunu açar.

Randevu aşamasına Kanban/liste/form/AI/webhook ile geçerken tarih ve saat zorunludur. Bir aşama etiketi «Randevu» olarak yeniden adlandırılırken etkilenen müşteri kartları tarihsizse işlem reddedilir. Randevudan çıkış bağlı etkinliği iptal eder ve eski bildirimi durdurur. Tarih değişiminde yeni zaman ayrı hatırlatma kimliği alır.

Randevuya **10 dakika kala uygulama içi bildirim** görünür. Bildirim okundu durumu kullanıcıya özeldir ve tekrar toast üretmez. Tarayıcıda CRM açıkken denetlenir; kapalı tarayıcıya push/SMS/Telegram/e-posta gönderimi bu kapsamda kurulmadı.

## Erişim izinleri ve çalışanlar

- **Erişim izinleri** sayfasında sahip Yönetici/Satış/Gözlemci profillerinin her modül için okuma, yazma, kendi/tüm kayıtlar kapsamını düzenler. Canlı değişiklikte etkiler ve çalışanlar görülerek onaylanır. Sahip rolü kilitlidir.
- **Çalışanlar** sayfasından isim, pozisyon, telefon, departman ve rol ile çalışan eşleştirmesi oluşturulur. Bunun için çalışanın doğrulanmış Manus `openId` kimliği gerekir; e-posta veya görünen ad tek başına giriş vermez. Yeni kayıt pasif başlar. İlgili kimlik kontrol edilip Etkin’e alınmalıdır. Gerçek çalışanlar otomatik etkinleştirilmedi.
- Çalışan henüz CRM’ye alınmamışsa kendi Manus oturumuyla giriş yapıp **Profilim** sayfasındaki gerçek kimliğini sahibine iletir. Kimlik ucu yalnız o oturumun kimliğini döndürür, CRM kayıtlarını açmaz.
- Çıkarma **pasifleştirme** olarak uygulanır. Mevcut oturumun sonraki isteği reddedilir; eski müşteri/mesai tarihçesi silinmez.
- **Şirket yapısı** sayfasında departman ağacı ve sağ çalışan paneli bulunur. Departman eklenebilir/düzenlenebilir, üst departman seçilebilir; döngü reddedilir. Çalışan departmanı listeden atanır. Departman kendi başına erişim sağlamaz; rol izinleri geçerlidir.
- **Profilim** kişisel adı, telefonu ve pozisyonu düzenler. Görünen ad değişikliği kayıt sahipliğini, role atanmış çalışan adını veya kimliği değiştirmez.

İzinler yalnız menü gizleme değildir: her API işlemi ve kayıt deposu doğrulanır; AI ve raporlar da kayıt kapsamından çıkamaz. Otomasyon işçisi, dış iletişimden önce başlatan çalışanın güncel yetkisini tekrar kontrol eder. Mesai kendi kimliğe bağlıdır; tüm ekip raporu ayrıca uygun yetki ister. Kimlik/veri saklama gerçek modda kalıcı MySQL üzerindedir.

## XRE Mesai

Yüklenen `mesai-guncelleme(1).zip` incelendi; PHP işlevleri CRM içinde native React/Node modülüne uyarlandı. Başlat, ihtiyaç/yemek/online randevu molası, dön, bitir, aynı gün yeniden devam et; net çalışma, mola süreleri, günlük geçmiş, ekip raporu ve profil mini sayacı bulunur. Sunucu zamanı, işlem kimliğiyle tekrar koruması, sürüm çatışması ve MySQL kilidi kullanılır. Önceki gün açık kayıt varsa önce bitirilir; geçmiş güne yeni mesai açılamaz.

Demo mesai yalnız tarayıcıda saklanır ve açıkça etiketlidir. Gerçek modda sunucudan onay gelmeden mesai başlamış gösterilmez; çevrimdışı sahte işlem kuyruğu yoktur. ZIP’te olmayan canlı SQLite geçmişi/config.php, PIN hesapları, Bitrix kimlikleri veya Telegram bildirim altyapısı otomatik taşınmadı. Konum açık izin olmadan toplanmaz.

## Kurumsal logo

Kullanıcının XRE CRM logosunun beyaz arka planı kaldırılarak gerçek alpha kanallı şeffaf PNG hazırlandı. Sol gezinmede, sayfa simgesinde ve proje markasında kullanılır. Orijinal dosya değiştirilmedi.

## Canlı kurulum sınırları

OpenAI ve n8n anahtarları sunucu ortamında korunur. Önceki WhatsApp QR sağlayıcısı, Netgsm/FST/SIP-CDR ağ geçidi, gerçek Vapi hat/asistan eşlemesi ve eski Bitrix workflow olay adaptörü için açık kurulum maddeleri devam eder. Kaynak bağlantısı olmadan gerçek çağrı veya mesaj teslimi doğrulanmış gibi gösterilmez. Bu geliştirmede gerçek müşteriye arama, mesaj veya Telegram gönderilmedi; çalışan izinleri canlı veritabanında otomatik değiştirilmedi.
