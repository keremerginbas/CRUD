# İlan5 2.8.0 — Doğrulama notları

19 Ekim 2026 (2.8.0): `npm install && npm test` ile 17 test dosyasının tamamı geçti. Yeni `tests/features-2-8.test.cjs` şunları denetler: günlük limit ve ertesi gün devam, küçültülmüş pencere ve sekmeye geri dönüş, art arda eksik alan uyarısı, m² fiyatı/fırsat ve çok ilanlı satıcı hesabı, takip notunun yeni taramada korunması, liste birleştirme/kaldırma, fiyat düşüşü/yeni ilan Telegram kuyruğu (sahte ağ), tokenin depoya taşınması, Excel/CSV yeni sütunları. Panel, Chromium'da örnek verilerle uçtan uca tıklanarak denendi: fırsat/çok ilanlı satıcı filtreleri, not kaydetme, liste yeniden adlandırma ve birleştirme, ayarların kaydı, otomatik yedek indirmesi, CSV sütunları ve 1360/768/390 px genişliklerde yatay taşma olmaması. Testlerdeki sabit klasör yolu kaldırıldı; `command-contract` testi 2.6.2'deki “izleme taramayı engellemez” davranışına göre güncellendi. Canlı Sahibinden üzerinde gerçek Chrome profiliyle tarama yapılmadı.


26 Eylül 2026: Yeni arşivlenen ve önceki sürümde kayıtlı olup henüz kontrol edilmemiş Sahibinden/Hepsiemlak ilanları otomatik izleme kuyruğuna alınır; çalışan ilan taramasıyla çakışmaz, tarama sekmesi tamamlanınca bekleyen izleme anında sürer. Mesaj kampanyası daraltılmış başlar, tekli silme ve toplu temizleme arşiv/şablon verisini etkilemez; hazırlanmakta olan kayıt korunur. Testler: 17 izleme motoru senaryosu, 9 veritabanı + Telegram entegrasyonu, 21 sayfalama, 11 arka plan senaryosu ve komut sözleşmesi.

26 Eylül 2026: Okuma sırasında çalışma sekmesi değişti uyarısı için ek sentetik regresyon kontrolleri eklendi. Geç gelen eski cevap arşive yazılmıyor; doğru ilan adresi otomatik yeniden açılıyor. Tarayıcı yüklenmeyi sürdürdüyse yeniden okumak üzere bekleniyor. Sahibinden `pagingOffset` ile `page` gösterimini aynı sonuç sayfası olarak tanıma kontrol edildi.

26 Eylül 2026: Kullanıcının son ZIP'inden çıkarılan eklenti sürümü üzerinde çevrimdışı sentetik testler çalıştırıldı. Bu testler Sahibinden/Hepsiemlak'a giriş yapmaz ve ilan sitelerine istek göndermez.

- İlan ayrıştırma: 49 senaryo. Toplam sayısının sonuç tablosu dışında olması, `pageNaviButtons`, bağlantısız Sonraki düğmesi, sayfa boyutunun URL'de yazmaması, filtreleri koruma, son sayfa ve belirsiz sayfa durumları dahil.
- Tarama motoru: 19 sayfa sıralama/devam senaryosu ile 11 arka plan testi. Beş sayfa × 50 ilan, iş kuyruğu sürdürme, servis işçisi yeniden başlatma, geciken SPA sayfasını tekrar okuma ve sayfa geçişi hatalarını denetler.
- Gerçek çıkarım ve IndexedDB entegrasyonu: sentetik arama sayfalarından 5 sayfa × 10 ilan kaydedilir; tekrar eden ilanlar ikinci kez yazılmaz.
- Arşiv paneli: 13 arşiv arayüzü kontrolü. Veri çekme ve ilan hareketi ekranı: 26 sentetik panel kontrolü.
- Diğer eklenti birim/entegrasyon kontrolleri: 104 testten 103'ü geçti, önceden var olan gerçek Chromium eklentisi testi bu ortamda çalıştırılamadığı için atlandı.

Bu doğrulamalar canlı sitelerdeki oturumunuzu ve sayfa şablonlarını garanti etmez. Tarayıcıdaki son görsel kontrol bu çalışma ortamında işletim sistemi soket izni nedeniyle başlatılamadı. İlk denemede sayfa numarasını ve ilan numaralarını kaynak sayfayla karşılaştırın; panel bir sayfayı doğrulayamazsa işi "tamamlandı" olarak göstermemelidir.

25 Eylül 2026 tarihinde üretim dosyalarıyla çevrimdışı kontroller yapıldı.

2.2.2 düzeltmesi: Kullanıcının inspect görüntülerinde telefonun `#phoneInfoPart.userContactInfo` içindeki görünür `.pretty-phone-part.show-part` alanında, CSS `content: attr(data-content)` ile gösterildiği görüldü. Önceki sürümde telefon okuyucusu yalnız normal metni okuyordu. Görünen CSS telefonları için okuma eklendi; gizli tam numara, yıldızlı alternatif ve açıklama/altbilgi numaralarının dışlanması örnek DOM ile kontrol edildi. Test verileri gerçek ekran görüntüsündeki telefon yerine örnek numaralar kullanır. Bu kontrol, kullanıcının canlı oturumunda yapılmış bir tarama değildir.

Bu düzeltmede 41 çıkarım senaryosu geçti. Üç ayrı telefon entegrasyon testi, CSS numarasının gerçek veri modeli → IndexedDB → Excel → içe aktarma boyunca korunduğunu; başarılı yeniden taramanın eski telefon eksikliğini giderdiğini ve yalnız arşivden korunan eski numaranın hâlâ yeniden doğrulanmamış olarak işaretlendiğini doğruladı.

2.2.1 düzeltmesi: Sahibinden satıcı adı için telefon düğmesinden bağımsız okuma, CSS ile gösterilen isimler, satıcı kartının kendi kök elemanındaki isim ve telefon penceresine geçerken ismin korunması senaryoları eklendi. Tek ilandan yeniden kaydederken eski satıcı bilgisinin boş değerle silinmemesi ve eksik alan etiketinin yeni ad gözleminde düzelmesi ayrıca kontrol edildi. Bu senaryolar kullanıcıdaki canlı sayfanın birebir doğrulaması değildir.

## Yeni veri çekme akışı

- Bağlantı formunun ilk açılışta görünür kalması, liste/tekil bağlantı modları, çok satırlı bağlantı gönderimi ve düzenli arama komutları kontrol edildi.
- Gerçek arşiv JavaScript'i ile Manifest V3 arka planı arasındaki komut akışı test edildi. Tekrarlanan bağlantıların tekilleşmesi, izleme sürerken çakışan taramanın engellenmesi ve harici sayfaların kontrol komutu gönderememesi doğrulandı.
- Sayfa motorunda 5 sayfa × 50 ilan = 250 detay senaryosu geçti: mevcut sayfanın detayları bitmeden sonraki liste açılmıyor. Ayrıca gerçek veri modeli ve IndexedDB ile 5 sayfalık ayrı entegrasyon denemesi yapıldı.
- `pagingSize=50` ve arama filtrelerinin korunması; tekrarlanan sonuç sayfalarında döngünün durması; sayfa ortasında duraklatma/devam; eski iş kuyruğunun korunması kontrol edildi.
- Toplam sayfa bilinmiyorsa tahminî bir toplam gösterilmiyor. Sonraki bağlantı doğrulanamayan sonuçlar eksik olarak raporlanıyor.
- Düzenli aramalarda ilk eksiksiz başlangıç turu, sonraki yeni görülenler, geçerli fiyat değişimleri, kısmi tarama, yeniden başlatma ve zamanlama kontrol edildi. Deneme turu ilan sınırını koruyor; sonraki düzenli tur sınırsız başlıyor.
- İlanın arama sonucundan kaybolması, kaldırılma olayı oluşturmuyor. Kaldırılma ve yeniden yayına girme olayları bağlantı izleme sonucuna dayanıyor.
- Hareket kartlarında tekil ilan sayımı, olay tablosunda bütün hareketler, dönem/arama filtreleri ve JSON yedeğine olayların eklenmesi kontrol edildi.

## Korunan işlevler

- Hepsiemlak / Sahibinden örnek sayfalarında kategori, ayrıntı alanları, görünür satıcı telefonu, sayfalama ve yanlış ilana yönlendirme senaryoları.
- Arsa/araç ayrımı, çelişkili kategorilerin incelemeye alınması, manuel düzeltme, birleştirme, çöp kutusu ve farklı para birimleri.
- Paketlenmiş SheetJS ile JSON/Excel/CSV içe ve dışa aktarma, filtreli aktarım, Türkçe sayılar ve hücre formüllerinin etkisizleştirilmesi.
- Zaman aralıklı iki kaldırılma doğrulaması, geçici hata, tekrar yayına girme, kalıcı takip sırası ve mükerrer bildirim önleme.
- Telegram hedef doğrulaması, tokenin yanıtlardan çıkarılması, kalıcı gönderim rezervasyonu, hız sınırı ve teslimi belirsiz mesajların otomatik tekrarlanmaması.
- Üretim JavaScript sözdizimi, manifest ve HTML dosya bağlantıları.

Arşiv, takip ve yeni bağlantı/hareket ekranları toplam 60 çevrimdışı arayüz kontrolünden geçti. Testler sahte Chrome API'leri, örnek DOM ve yerel IndexedDB kullanır; paket test verisi veya örnek ilan içermez.

## Canlı doğrulamanın kapsamı

Önceki 2.1 sürümünde gerçek Telegram API ile verilen botun DÜŞEN İLAN grubunda bulunduğu doğrulandı ve açıkça test olarak etiketlenmiş tek mesaj gönderildi. Bu güncelleme sırasında gerçek Telegram mesajı gönderilmedi; testlerde ağ çağrıları taklit edildi.

Bu kontroller canlı ilan sitelerinin şu anki görünümünü doğrulamaz. Eklenti gerçek Chrome profiline kurulup canlı sitelerde uçtan uca çalıştırılmadı; görsel tarayıcı önizlemesi ortamın URL erişim politikası nedeniyle tamamlanamadı. İlk denemede düzenli takibi kapatıp ilan sınırını 2 seçin; telefon, fiyat, kategori ve ayrıntıları kaynakla karşılaştırın. Sitenin sayfa yapısı değişirse seçiciler güncellenmelidir.
