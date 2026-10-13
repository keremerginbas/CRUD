# XRE CRM · Birleşik çalışma alanı

## Dört görünüm, aynı müşteri

**CRM** menüsünde **Kanban · Liste · Etkinlikler · Takvim** sekmeleri bulunur. Sekmeler aynı müşteri kayıtlarını ve huni/sorumlu arama bağlamını kullanır; yeni müşteri kaydı kopyalamaz.

- **Kanban:** aşama kartlarında müşteri adı, sorumlu, kaynak, varsa şehir ve en yakın açık etkinlik görünür. Küçük etkinlik sayısı tamamlanmamış görev ve etkinlikleri sayar; tamamlanan/iptal edilen etkinlikler sayılmaz.
- **Liste:** aynı kayıtları satır görünümünde filtreleyin, ayrıntı açın ve toplu işlemleri kullanın.
- **Etkinlikler:** müşteri en yakın açık tarihli kaydına göre **Geciken, Son tarihi bugün, Bu hafta, Gelecek hafta, İki hafta sonra, Daha sonra** gruplarında görünür. Haftalar Türkiye saatiyle pazartesi başlar. Tarihsiz açık görev varsa sayıya dahil edilir fakat tarih grubuna uydurma tarih verilmez.
- **Takvim:** müşteri bağlantılı etkinlikler ve tarihli görevler ay/gün düzeninde görünür. Gün seçildiğinde kayıt ayrıntısını açabilir, düzenleyebilir ve tamamlayabilirsiniz. İptal edilmiş randevular görünmez.

## Karttan doğrudan iletişim

Kartın altındaki **Ara** düğmesi müşterinin telefon numarasını arama penceresine taşır:

1. **Telefonla ara:** yerel telefon uygulamasını `tel:` ile açar. Bu işlem CRM’ye başarılı çağrı sonucu yazmaz. Bilgisayardan gerçek SIP/PBX görüşmesi için sağlayıcı ağ geçidi kurulumu gerekir.
2. **Yapay zekâ araması:** seçilen hattı ve Vapi asistanını kullanır. Gerçek canlı çağrı ancak kullanıcı başlatınca ve sunucu sağlayıcı ayarları mevcutsa gönderilir. Sonuçlar gerçek sağlayıcı webhooklarından gelir.

**WhatsApp** seçili müşterinin konuşmasını açar; kendiliğinden mesaj göndermez. **Etkinlik** görüşme planlama formunu açar. **Online toplantı** aynı müşteriye bağlı toplantı planını açar.

## Online toplantı ve Google Meet

Mesajlaşmanın üstündeki **Online toplantı** düğmesinde müşteri, başlık, **tarih ve saat**, süre, sorumlu ve açıklama seçilir. Saatler Türkiye saatidir.

- Otomatik Meet bağlantısı için CRM’nin Google OAuth uygulaması ve kullanıcının Google hesabı yetkilendirmesi gereklidir. Bu kurulum tamamlanmadan bağlantı üretilmiş gibi gösterilmez.
- Kurulum yoksa **Mevcut Google Meet bağlantısını ekle** yöntemiyle gerçek `https://meet.google.com/...` bağlantınızı müşteri takvimine kaydedebilirsiniz.
- Davet e-postaları yalnız açıkça seçilen Google davet seçeneğiyle gönderilir. Mevcut bağlantının CRM’ye kaydı Google etkinliği/daveti oluşturmaz.
- Bağlantı hazır olunca **Katıl, Kopyala, WhatsApp taslağı** kullanılabilir. Taslak gönderilmez; sohbet kutusunda kontrol edip ayrıca Gönder'e basın.
- Aynı toplantı isteğinin tekrarları aynı kimliği kullanır. Belirsiz/zaman aşımı durumunda yeni toplantı üretmek yerine mevcut isteğin sonucunu kontrol edin.
- Kaydedilen toplantı takvimde, müşteri etkinliklerinde ve mesajlaşmadaki toplantı kartında görünür. Açık CRM tarayıcısı toplantıdan on dakika önce uygulama içi bildirim gösterir; tarayıcı kapalıyken push gönderilmez.

## Kişisel görünüm

Sağ üstteki **palet** simgesinden **XRE Gece, Aydınlık, Mor Cam, Okyanus, Orman** temalarını; yoğunluğu, yazı boyutunu ve çalışma alanı fonunu seçin. **Uygula** canlı kullanıcının kendi tercihlerini kaydeder. **Vazgeç** kaydedilmiş görünümü geri getirir. Seçimler başka çalışanların ayarlarını değiştirmez; demo tercihleri yalnız bu tarayıcıda saklanır.

## Veri ve erişim sınırları

Mevcut rol izinleri, kendi/tüm ekip kayıt kapsamı ve randevu aşamasına geçerken zorunlu tarih-saat kuralı korunur. Demo modunda Vapi, Google veya WhatsApp’a gerçek arama/mesaj/davet gönderilmez. Görüşme başarı metrikleri yerel arama uygulamasını açmaktan veya toplantı linki oluşturmaktan türetilmez.
