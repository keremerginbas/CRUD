# İlan5 2.6.2 — Veri Çekme, İlan Hareketleri ve Telegram Takibi

Bu paket Chrome / Edge eklentisidir. Kullanmak için Python, Selenium, Playwright veya terminal kurulumu gerekmez.

## Mevcut arşivi koruyarak güncelleme

1. Mevcut panelde **JSON yedeği indir** ile arşivin yedeğini alın.
2. `chrome://extensions` ekranında mevcut İlan5 eklentisinin **Ayrıntılar** bölümündeki yükleme yolunu kontrol edin.
3. Bu ZIP içindeki `ilan5_extension` klasörünün dosyalarını, daha önce yüklediğiniz aynı klasörde güncelleyin. Yeni bir klasörden ikinci eklenti yüklemeyin; mevcut eklentiyi kaldırmayın.
4. `chrome://extensions` ekranında mevcut İlan5 kartının **Yenile** düğmesine basın. Sürümün **2.6.2** olduğunu kontrol edin.
5. Eski panel sekmesini kapatıp eklenti simgesinden paneli yeniden açın. Açık kaynak ilan sekmelerini de yenileyin.
6. Önceki iş kısmi bittiyse **Devam et** ile yeniden kontrol edin. Yeni bir arama başlatmak için eski işi **Durdur** ile kapatabilirsiniz; arşiv kayıtları silinmez.

Veritabanı adı ve arşiv şeması değiştirilmedi. Veriler Chrome profilinize ve eklenti kimliğine bağlıdır. Aynı klasör ve aynı profilden güncelleyin. Boş arşiv görürseniz yeni veri toplamadan önce eski eklenti/profilin açık olduğunu kontrol edin veya JSON yedeğini içe aktarın.

## 2.6.2 otomatik izleme ve mesaj kuyruğu

Arşive yeni eklenen veya daha önce yayın durumu kontrol edilmemiş Sahibinden ve Hepsiemlak ilanları otomatik kontrol sırasına alınır. Bir ilan taraması çalışıyorsa izleme sırası bekler ve tarama sekmesi boşalınca kendiliğinden devam eder. İlanın yayından kaldırıldığı sonucu, aralıkla yapılan iki açık durum kontrolüyle doğrulanmadan Telegram bildirimi gönderilmez. İzleme ayarlarında otomatik takip kapalıysa yeni kayıtlar otomatik kontrol edilmez.

Mesaj kampanyası ilk açılışta daraltılmıştır. Başlıktaki düğmeyle açıp kapatabilirsiniz. Kuyruk kayıtları tek tek silinebilir veya topluca temizlenebilir; bu işlemler ilan arşivini ve mesaj şablonunu silmez. Hazırlanmakta olan kayıt silme sırasında korunur.

## Sayfa geçişi

Sayfa geçişi, mevcut sayfanın ilan detayları tamamlandıktan sonra yapılır. **En fazla ilan: 0**, ilan sınırını kaldırır. Taramada kullanılan çalışma sekmesini elle başka sayfaya geçirmeyin.

Bu sürüm sonuç tablosunun dışındaki toplam sayısını, farklı sayfalama alanlarını ve bağlantıda yazmayan sayfa boyutunu da değerlendirir. Sonraki adres mümkünse sayfadaki bağlantıdan okunur; yeterli sayfalama kanıtı varsa aynı filtrelerle sonraki adres oluşturulur. Yükleme gecikmesi, tekrar eden sonuçlar, erişim doğrulaması ve tamamlanma birbirinden ayrılır. İlerleme panelinde durma nedeni ve sayfa durumu gösterilir.

Sekme okuma sırasında yüklenir veya ilan adresinden uzaklaşırsa o cevabı kaydetmez; aynı ilanı kısa beklemeden sonra otomatik yeniden açıp okur. Site Sahibinden sayfa numarasını `pagingOffset` yerine `page` biçiminde gösterdiğinde adres eşdeğerliği doğrulanır. Birkaç denemede de sayfa kararlı hale gelmezse sıra korunarak tarama duraklatılır.

**Bağlantı hazır**, girilen adresin desteklenen bir kaynak ve doğru bağlantı türü olduğunu belirtir; sitenin erişime açık olduğunun veya oturumunuzun doğrulandığının kanıtı değildir.

## Kurulum

1. ZIP dosyasını kalıcı bir klasöre çıkarın.
2. Chrome'da `chrome://extensions` adresini açın. Edge kullanıyorsanız `edge://extensions`.
3. **Geliştirici modu** seçeneğini açın.
4. **Paketlenmemiş öğe yükle** düğmesine basın.
5. İçinde `manifest.json` bulunan **ilan5_extension** klasörünü seçin.
6. Tarayıcının Eklentiler menüsünden İlan5'i sabitleyin. İlan5 simgesi → **Veri çekme ekranını aç**.

Bu klasörü daha sonra taşımayın. Güncellemede aynı klasörün dosyalarını değiştirip eklentiyi yenileyin. Kaldırıp tekrar kurmadan önce JSON yedeği indirin; arşiv bu tarayıcı profiline aittir.

**2.3.0 güncellemesi:** Arşivdeki ilanlarınızın korunması için eklentiyi kaldırmayın. ZIP içindeki dosyaları daha önce yüklediğiniz aynı `ilan5_extension` klasörünün üzerine çıkarın, sonra `chrome://extensions` ekranında İlan5 kartındaki **Yenile** düğmesine basın. Yeni klasörden ikinci bir eklenti yüklerseniz Chrome bunu farklı eklenti sayabilir ve eski yerel arşiv o ekranda görünmez. Açık Sahibinden/Hepsiemlak ilan sekmelerini ve İlan5 panelini de yenileyin.

**Mesaj kampanyası:** Sol menüde **Mesaj kampanyası** bölümünden kuyruk oluşturabilirsiniz. Eklenti Sahibinden ilanını açar ve mesajı kutuya yazar. Siz Sahibinden’de **Gönder** düğmesine bastıktan sonra panelde **Gönderdim, sıradakine geç** diyerek kaydı gönderildi işaretleyip sıradaki ilanı hazırlatabilirsiniz.

## Mevcut 26 ilanınızı taşıma

**İçe aktar** düğmesinden bilgisayarınızdaki **ankara_arsa_ilanlari.durum.json** dosyasını seçin. Bu dosya, botun tüm özellik alanlarını içerdiği için tercih edilir. Alternatif olarak botun en son oluşturduğu `.xlsx` dosyasını seçebilirsiniz.

Dosya içe aktarma JSON, XLSX ve CSV destekler. Önceki yerel panelin JSON/CSV dışa aktarımları da okunur. Eski programın SQLite veritabanı veya başka bir eklentinin arşivi otomatik taşınmaz; önce o programdan desteklenen formatta dışa aktarın.

Aynı kaynaktaki aynı ilan numarası tek kayıtta tutulur. Tekrar içe aktarma mevcut kaydı günceller. Başka kaynaklardaki aynı numaralar birbirinin üzerine yazılmaz. Çöp kutusuna taşıdığınız kayıt, tekrar taramada kendiliğinden geri gelmez.

## Arsa ve araçlar karışır mı?

Sol menüde **Arsa**, **Araç**, **Konut**, **İşyeri**, **Diğer** ve **İnceleme gerekli** ayrı görünümlerdir. Başlangıç görünümü Arsa'dır.

- **Veri çek → Toplanacak kategori: Arsa:** Arsa olarak doğrulanan ilanlar kaydedilir. Araç gibi farklı kategoride olduğu doğrulanan ilanlar atlanır.
- **İçe aktarma:** Karma dosyanızdaki kayıtlar topluca arşive alınır, ardından kategorilerine ayrılır. Arsa görünümünde araçlar görünmez.
- Kategori kararı ilan bağlantısındaki kategori, sayfanın kategori bilgileri ve özellik alanlarından verilir. Açıklamadaki “arsa ile takas” ifadesi bir aracı arsaya dönüştürmez.
- Kategori bilgileri çelişkili veya yetersizse kayıt **İnceleme gerekli** bölümüne alınır. Ayrıntılardan kaynak ilanı kontrol edip **Kategoriyi doğrula** ile düzeltebilirsiniz.

**Excel indir / CSV**, yalnızca seçili kategori ve ekrandaki filtrelerle eşleşen kayıtları aktarır. Bu aktarım, tablonun bütün sayfalarını içerir. **JSON yedeği indir** ise inceleme, çöp kutusu, ilan hareketleri ve bağlantı takip geçmişi dahil tüm arşivi korur. Excel, takip geçmişini geri yükleme formatı değildir; Excel’den aktarılan bağlantıların yayın durumu yeniden kontrol edilir. Kayıtlı arama zamanlamaları, bot ayarları ve bildirim kuyruğu arşiv yedeğine dahil değildir.

## Bağlantıları nereye gireceğim?

Eklenti simgesi → **Veri çekme ekranını aç**. En üstteki **Bağlantı ekle, ilanları getir** formu her zaman açıktır. Soldaki **Veri çek** düğmesi de sizi bu alana götürür. HTML dosyasını çift tıklayarak açmak yerine eklenti simgesini kullanın.

### Arama sonuçlarından toplama

1. Hepsiemlak veya Sahibinden'de istediğiniz kategori, şehir ve fiyat filtrelerini ayarlayın.
2. Arama sonuçları sayfasının adresini kopyalayın.
3. **Arama sonuçları bağlantısı** sekmesindeki adres alanına yapıştırın ve hedef kategoriyi seçin.
4. Farklı türdeki ilanları birlikte almak için **Toplanacak kategori: Tüm kategoriler** seçin. İlk denemede **En fazla ilan: 2** yazın. Kontrol sonrası **0** seçerek ilan sınırını kaldırın.
5. **“Telefonu Göster” düğmesine bas** seçiliyse, ilan detayındaki görünür satıcı iletişim düğmesine basılır ve açılan telefon bilgisi okunur.
6. **Verileri çekmeye başla** düğmesine basın. Eklenti önce birinci sayfadaki ilan detaylarını bitirir; ardından sonraki sonuç sayfasını açar ve onun ilanlarını işler. Örneğin 5 sayfada 50'şer ilan varsa sıra: sayfa 1 → 50 detay → sayfa 2 → 50 detay → … → sayfa 5 olur. Kaynak bağlantıdaki sayfa boyutu ve filtreler korunur; tekrar eden ilanlar yeniden kuyruğa eklenmez.

**Bu aramayı düzenli takip et** seçeneği varsayılan olarak açıktır. Arama adı ve kontrol aralığını seçebilirsiniz; varsayılan 60 dakika, alt sınır 15 dakikadır. **En fazla ilan** sınırı yalnız başlattığınız deneme turuna uygulanır; zamanlanan sonraki turlar tüm sonuçları tarar. Yalnızca 2 ilanla denemek istiyorsanız düzenli takip seçeneğini kapatın. Sayfa ilerlemesi, o sayfada işlenen ilanlar ve toplam işlenenler formun altındaki durum alanında görünür.

### Elimde tek tek ilan bağlantıları var

**Tek tek ilan bağlantıları** sekmesini seçin. Her satıra bir ilan detay bağlantısı yapıştırın; aynı siteden bağlantıları birlikte ekleyin. Kategoriyi ve telefon seçeneğini seçip **Verileri çekmeye başla** düğmesine basın. Eklenti yinelenen bağlantıları tekilleştirir ve verilen ilanları sırayla açar. Bu mod başka sonuç sayfalarını keşfetmez ve düzenli arama oluşturmaz. Arşivlenen Sahibinden bağlantıları ayrı kaldırılma takibine dahil edilir.

Tarama sırasında tarayıcı açık kalsın; çalışma sekmesinde başka sayfaya geçmeyin. Bekleme ayarı en az 3 saniyedir; tarayıcı zamanlaması, bilgisayarın uyuması veya sayfanın yüklenmesi bunu uzatabilir. Arşiv ekranını kapatmanız, Chrome açıkken taramayı sonlandırmaz.

**Duraklat / Devam et / Durdur** kontrolleri bulunur. Durdurulan bir iş Devam et ile sürdürülebilir. Yeni tarama eski iş kuyruğunun yerini alır; kaydedilmiş arşiv kayıtları korunur. Tarayıcı kapandıktan sonra arşivdeki durumu kontrol edin ve gerekirse Devam et'e basın.

Doğrulama veya giriş ekranı görülürse işlem duraklar. Çalışma sekmesindeki gerekli işlemi kendiniz tamamlayıp **Devam et** seçin. Eklenti doğrulama ekranını otomatik aşmaz. Sonraki sayfa veya toplam kayıt sayısı doğrulanamıyorsa işlem **kısmen tamamlandı** olarak bildirilir.

Tek bir ilan için, desteklenen sitedeki ilan detayını açın ve eklenti simgesindeki **Açık ilanı kaydet** düğmesini kullanın. Arşiv panelindeki aynı işlev, o pencerede en son etkin olan desteklenen ilan detayını kullanır.

## Borsa paneli gibi ilan hareketleri

Veri çekme alanının altında **İlan hareketleri** bulunur: bu aramada yeni görülen, yayından kaldırılan, fiyatı düşen/yükselen ve yeniden yayında görülen ilanlar. Son 24 saat, son 7 gün veya tüm zamanları seçebilir; belirli bir kayıtlı aramayı filtreleyebilirsiniz. Fiyat hareketlerinde eski/yeni fiyat ve yüzde değişimi gösterilir. Özet kartları tekil ilanları, hareket tablosu olayları sayar.

İlk eksiksiz tarama başlangıç listesini oluşturur; bu listedeki ilanlar yeni ilan sayılmaz. Sonraki turlarda ilk kez görülenler **Bu aramada yeni görülen** olarak kaydedilir. Bu, sitedeki yayınlanma tarihi değildir. Sınırlı, hatalı veya eksik ilk tarama başlangıç listesini tamamlamaz. Fiyat yalnız iki geçerli, aynı para birimindeki değer karşılaştırılabiliyorsa değişmiş sayılır.

**İzlenen aramalar** alanından bir aramayı hemen çalıştırabilir, düzenli takibini kapatabilir veya kaldırabilirsiniz. Takibi kapatmak mevcut taramayı durdurmaz; çalışan tur için **Durdur** kullanın. Bir tarama ya da bağlantı kontrolü sürerken diğerleri sırada bekler. Tarayıcı kapalıyken zamanlanmış aramalar çalışmaz.

Arama sonucunda artık görünmeyen ilan otomatik silinmiş sayılmaz. Kaldırılma ve yeniden yayına girme hareketleri, aşağıdaki bağlantı doğrulamasıyla oluşur. Bu panel belirlediğiniz aralıklarla güncellenir; bütün sitenin anlık veri akışı değildir.

## Sahibinden bağlantı takibi ve Telegram

Verdiğiniz bot ve **DÜŞEN İLAN** grubu önceden ayarlandı. Gerçek Telegram API ile botun grupta olduğu ve mesaj gönderebildiği doğrulandı; gruba açıkça test olarak belirtilen tek mesaj gönderildi. Eklentiyi bilgisayarınıza kurduğunuzda kendi ayar durumunu ayrıca doğrular.

1. Eklentiyi yükleyin veya aynı klasörden güncelleyin. Yeni Telegram bağlantı iznini Chrome isterse kabul edin.
2. Sahibinden ilanlarını toplayın veya mevcut JSON/Excel dosyanızı içe aktarın. Takip için ilanın geçerli Sahibinden detay bağlantısı gerekir.
3. **Takip ve Telegram** panelinde **Bağlantıyı doğrula** ile yerel kurulumdaki bot/grup bilgisini kontrol edin. İsterseniz Test mesajı gönder ile bir ek test yapabilirsiniz.
4. **Otomatik takip** varsayılan olarak açıktır. Kayıtlı Sahibinden bağlantıları yaklaşık **6 saatte bir** kontrol edilir. İlk kaldırılma işaretinden sonra en az **15 dakika** beklenerek ikinci kontrol planlanır. Büyük arşivler, ilan toplama işlemi, Chrome zamanlaması veya bilgisayarın uyuması kontrolleri geciktirebilir.
5. **Şimdi kontrol et** ilk turu hemen başlatır. İkinci doğrulama için gereken süreyi kaldırmaz.

İzleme yalnız arşivinizdeki, çöp kutusuna taşınmamış Sahibinden bağlantılarını kapsar. Hepsiemlak kayıtları bu sürümde kaldırılma takibine dahil değildir. Sahibinden'in bütün sitesindeki ilanlar kendiliğinden arşive alınmaz; seçtiğiniz arama sonuçlarını toplamanız gerekir.

**Yayında:** İlan kimliği ve detay sayfası doğrulandı. **Tekrar kontrol bekliyor:** Bir kaldırılma işareti görüldü. **Yayından kaldırılmış:** En az 15 dakika arayla iki açık kaynak bildirimi doğrulandı. **Henüz doğrulanmadı / erişim kontrolü / hata:** Sonuç bilinmiyor; bu sebeplerle silindi bildirimi gönderilmez. Ayarlardan doğrulama süresi değiştirilebilir; alt sınır 10 dakikadır.

Arama listesinden kaybolmak tek başına kaldırılma sayılmaz; ilan kendi bağlantısından kontrol edilir. Genel 404, boş sayfa, zaman aşımı ve doğrulama ekranı tek başına kaldırılma kanıtı değildir. Bildirim “İLAN YAYINDAN KALDIRILDI” başlığı taşır; satıldığını veya neden kaldırıldığını iddia etmez. Kaydedilmiş fiyat, açıklama, özellikler ve telefonlar arşivde kalır.

İlan başına her kaldırılma olayı bir bildirim oluşturur. İlan tekrar yayında görülürse yeni bir takip dönemi başlar. Telegram teslim cevabı alınamazsa durum **Teslimat belirsiz** olur; aynı mesaj otomatik tekrar gönderilmez. Grupta kontrol ettikten sonra paneldeki özel seçenekle yeniden gönderebilirsiniz. Kesin hatalı bildirimler **Hatalı gönderimleri tekrar dene** ile işlenir.

**Chrome açık ve bilgisayar uyanık olmalı.** Bu paket sunucuda çalışan 7/24 bir servis değildir. Tarayıcı kapalıyken kontrol yapamaz; yeniden açıldığında kayıtlı sırayı sürdürür. Doğrulama ekranında durursa çalışma sekmesinde gereken işlemi tamamlayıp takip panelinden Devam'a basın. Yeni ilan toplama ve bağlantı takibi aynı anda sayfalara gitmez; gerekiyorsa takip panelinden Duraklat seçip ilan toplama işini başlatın.

Tokeni daha sonra **Takip ve Telegram** panelinden değiştirebilirsiniz; alanı boş bırakırsanız mevcut token korunur. Token JSON/Excel arşiv yedeklerine yazılmaz. Talebiniz gereği ilk kurulum tokeni `config.private.js` dosyasındadır; ZIP'in bu kopyası size özeldir. Başka kişilere paylaşacağınız kopyadan bu dosyadaki tokeni çıkarın. Mevcut kurulumda token değişikliği için paneli kullanın; panel ayarı başlangıç dosyasından önceliklidir.

## Filtreler ve ayrıntılar

- Başlık, ilan numarası, telefon veya konumda arama.
- Kaynak, il, para birimi, fiyat aralığı ve veri durumu filtresi.
- Fiyat aralığı girerseniz para birimini de seçin; farklı para birimleri birlikte karşılaştırılmaz.
- İlan başlığına basınca açıklama, telefonlar, tüm kaydedilen özellikler ve kategori dayanakları açılır.
- Silme, kaydı çöp kutusuna taşır. Oradan geri alınabilir.

## Bilgi doğruluğu ve sınırlar

Boş alanlar tahmin edilerek doldurulmaz. “Eksik alan var”, alanın okunamadığını veya kaynak ilanda bulunmadığını belirtir. “Temel alanlar tam”, bütün olası özelliklerin mevcut olduğunu ya da satıcının beyanının doğrulandığını ifade etmez. Örneğin ilan sahibi belediye veya ada/parsel belirtmemişse eklenti bunları uydurmaz.

Yanlış ilan numarasına yönlendirme ve kategori çelişkileri kontrol edilir. Telefonlar satıcı bölümünden veya açılan iletişim penceresinden alınır; açıklama, sayfa altbilgisi ve gizli verilerdeki telefonlar satıcı telefonu sayılmaz. Sitede telefon görüntülenmiyorsa kayıt eksik olarak kalır.

**Sahibinden telefon düzeltmesi:** Sağ satıcı kartındaki numara normal metin yerine CSS `::before` / `::after` ile gösterildiğinde de okunur. `#phoneInfoPart`, `.userContactInfo` ve görünür `.pretty-phone-part.show-part` alanları desteklenir; her ilanda değişen rastgele CSS sınıf adlarına bağlı değildir. Numara zaten görünürse telefon düğmesi aranması gerekmez. Aynı kartın gizli veya yıldızlı alternatifi telefon olarak kaydedilmez. Önceki sürümdeki “Görünür telefon düğmesi bulunamadı” notu, düzeltilmiş okuyucuyla başarılı yeniden taramada yenilenir.

Sahibinden'de **Ad Soyad / Satıcı**, sağdaki görünür satıcı kartından telefon düğmesinden bağımsız okunur. CSS ile `::before` / `::after` üzerinden gösterilen isimler de desteklenir. Satıcı adı bulunamazsa eksik alanlar arasında ayrıca belirtilir. Sayfada gizlenmiş veya hiç verilmemiş bir ad-soyad tahmin edilmez. Önceki taramada kaydedilen bir bilgi yeni gözlemde alınamazsa son bilinen değer, yeniden doğrulanamadığını belirten notla korunur.

Hepsiemlak ve Sahibinden sayfa yapıları değişirse seçicilerin güncellenmesi gerekebilir. Bu sürüm, örnek DOM senaryoları, arşiv/aktarım testleri ve Chrome API taklitleri ile kontrol edildi. Gerçek tarayıcıya kurulmuş eklentiyle canlı uçtan uca tarama doğrulanmadı; ilk 2 ilanı kaynak sayfalarla karşılaştırın. Daha önce çalışan Python botunun sonucu, bu eklentinin canlı test sonucu değildir.

Görsellerin yalnızca okunabilen URL'leri saklanır; bütün fotoğraflar indirilen bir galeri olarak arşivlenmez. Excel'in hücre metni sınırını aşan açıklamalar kısaltılır; tam içerik JSON yedeğinde bulunur. Arşiv dosyaları yerel tutulur. Telegram bildirimi için yalnızca ilan başlığı, numarası, kaynak bağlantısı ve doğrulama zamanı ayarlanan gruba gönderilir. Telefon listeleri bildirimde gönderilmez.

## Paket

Manifest V3; görünür bağlantı giriş ekranı; sayfa sayfa tarama ve düzenli aramalar; kalıcı ilan hareketleri; bağlantı takibi ve Telegram bildirim kuyruğu; yerel IndexedDB arşivi; Chrome storage ile iş kuyruğu; yerel paketlenmiş SheetJS 0.20.3. Üçüncü taraf lisans metni `vendor/SHEETJS_LICENSE.txt` içindedir.
