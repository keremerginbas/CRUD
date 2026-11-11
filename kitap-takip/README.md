# Kitap Takip

*Özgür'ün Salıncağı* (ISBN 9786259756189) kitabının satıldığı sitelerdeki stok, fiyat ve satış
işaretlerini düzenli olarak kaydeden bir Chrome / Edge eklentisi.

Eklenti sayfaları sizin tarayıcınızda, arka plan sekmesinde açar, bilgiyi okur ve sekmeyi kapatır.
Bir site doğrulama (CAPTCHA) isterse sekme açık kalır; doğrulamayı siz tamamlarsınız ve
"Yeniden tara"ya basarsınız. Veriler yalnızca tarayıcınızda saklanır, hiçbir yere gönderilmez.

## Kurulum

1. Bu depoyu bilgisayarınıza indirin (GitHub'da **Code > Download ZIP**) ve klasöre çıkarın.
2. Chrome'da `chrome://extensions` (Edge'de `edge://extensions`) adresini açın.
3. Sağ üstten **Geliştirici modu**nu açın.
4. **Paketlenmemiş öğe yükle**ye basıp `kitap-takip` klasörünü seçin.
5. Açılan panelde **Şimdi tara**ya basın. Panele daha sonra araç çubuğundaki eklenti simgesinden ulaşırsınız.

Otomatik tarama, tarayıcı açıkken seçtiğiniz aralıkta (varsayılan 12 saat) çalışır.
Önceki sürümü kurduysanız `chrome://extensions` sayfasında eklentinin **yenile** düğmesine basın.

## Satışı nasıl anlarız

Hiçbir site "şu kadar sattı" raporu vermez, ama bazıları işe yarar sayıları açıkça ya da sayfanın
içine gömülü olarak yayımlar. Eklenti bunları güvenilirlik sırasıyla toplar:

| İşaret | Nerede | Ne söyler |
| --- | --- | --- |
| Satın alma sayacı | Kitapyurdu ("Bu üründen N adet satın alınmıştır") | O sitede satılan adet. İki tarama arasındaki artış, o dönemin satışıdır. |
| Gerçek stok adedi | İmge Kitabevi ve aynı altyapıyı kullanan mağazalar (sayfaya gömülü stok alanı); "son 3 ürün" gibi uyarılar | Mağazanın elindeki kopya sayısı. Azalma çoğunlukla satıştır, artış yeni sevkiyattır. |
| Sepet sınırı | Hepsiburada ve Amazon (isteğe bağlı ölçüm, aşağıda) | Satıcının stoku ya da sipariş başına sınırı. Sayı düşerse satıcının stoku azalmıştır. |
| Satıcılar | Hepsiburada ve Amazon | Kitabı öne çıkan satıcı, diğer satıcılar ve fiyatları. Öne çıkan satıcının değişmesi, öncekinin stokunun bittiğini gösterebilir. |
| Tükenme ve yenilenme | Bütün mağazalar | Mağaza ya da dağıtımcı elindekini bitirmiş ve yenisini almış. Her döngü bir partinin eridiğini gösterir. |
| Satış sıralaması | Amazon | Numaranın belirgin biçimde küçülmesi, arada en az bir satış olduğunu gösterir. |
| Yorum, puan, okur sayıları | Hepsiburada, Amazon, 1000Kitap | Okura ulaşan kopyaların alt sınırı; alıcıların küçük bir bölümü yorum yazar. |
| Baskı sayısı | Künye bilgisi veren mağazalar | "2. baskı" görünmesi, ilk baskının dağıtıldığını gösterir. |

Panelin **Satış işaretleri** bölümü bu sayıları son 30 gün için site site özetler.

Bazı mağazalar kitabı kendi deposunda tutmaz; sipariş gelince dağıtımcıdan getirtir. Panel bunları
**Siparişle temin** olarak gösterir. Bu mağazalardaki "stokta" yazısı mağazanın değil,
dağıtımcının durumunu yansıtır. Nobel Kitap'taki `100` ve BKM'deki `999999` değerleri yer
tutucudur; eklenti bunları tanır ve "Adet gizli" olarak gösterir.

### Kesin rakamlar

Dışarıdan toplanan işaretler tahmindir. Kesin sayıların iki kaynağı vardır; ikisi de yazarın hakkıdır:

- **Bandrol kaydı:** Basılan her kitaba Kültür ve Turizm Bakanlığı'ndan bandrol alınır. Eser
  sahipleri, kitapları için alınan bandrolleri (baskı sayısı ve bandrol adedi) e-Devlet üzerinden
  sorgulayabilir. Bu, kaç adet basıldığını ve yeni baskı yapılıp yapılmadığını gösterir.
- **Yayınevinin satış hesabı:** Türk Borçlar Kanunu'nun yayım sözleşmesine ilişkin 497. maddesi
  satış hesaplarını düzenler. Telif ödemeniz satışa bağlıysa satış hesabını yazılı olarak isteyin;
  sözleşmenizdeki ilgili maddeye de bakın.

## Sepet sınırıyla stok ölçümü

Hepsiburada ve Amazon stok adedini göstermez; satıcının elindeki adet, bir siparişe en çok kaç adet
eklenebildiğinden anlaşılır.

- **Amazon:** Sepete dokunulmaz. Ürün sayfasındaki adet seçici en çok 30'a kadar gider; daha az
  seçenek varsa satıcının stoku (ya da sipariş sınırı) o kadardır ve panel bunu "adet seçici"
  kaynağıyla gösterir.
- **Hepsiburada:** İsteğe bağlı ölçüm. Kitabı sepete ekler, adedi "Ürünü Arttır" düğmesiyle sitenin
  izin verdiği yere kadar yükseltir, ulaştığı sayıyı kaydeder ve kitabı sepetten çıkarır. Varsayılan
  olarak kapalıdır; günde en fazla bir kez çalışır.

Açmak için panelde **Sepet sınırıyla stok ölçümü** bölümünde **Günde bir kez ölç** kutusunu
işaretleyin; ilk denemeyi **Şimdi ölç** ile yapıp izleyin.

Ölçümün uyduğu kurallar:

- Yalnızca "Sepete ekle", adet artır/azalt ve "Sepetten Çıkar" düğmelerine basılır. Satın alma,
  ödeme, üyelik ya da "Ürünleri sil" düğmelerine hiçbir koşulda basılmaz.
- Adet kutusuna hiçbir şey yazılmaz. İlk sürüm kutuya 999 yazıyordu ve gerçek sepette kitabı geri
  çıkaramadı; ölçüm artık yalnızca düğmelerle, birer birer ve en fazla 30'a kadar ilerler.
- İlk artıştan sonra, daha ileri gitmeden önce adedin geri azaltılabildiği denenir. Azaltılamıyorsa
  ölçüm durur; sepette en fazla 2 adet kalır.
- Yalnızca ölçümün kendi eklediği satıra dokunulur. Kitap zaten sepetinizdeyse ya da eklenen satır
  kesin olarak ayırt edilemiyorsa hiçbir şeye dokunulmaz.
- Onay pencerelerinde yalnızca ürünü sepetten çıkarmayı soran pencere onaylanır.
- Kitap sepetten çıkarılamazsa sepet sekmesi açık kalır; panelde ve Telegram'da uyarı görürsünüz.
- Bulunan sayı satıcının stoku ya da sipariş başına sınırı olabilir; sınıra ulaşılamazsa panel
  "en az N adet" yazar. Ölçüm, satıcının istatistiğinde sepete ekleme olarak görünür. Sitelerin
  kullanım koşulları otomatik sepet işlemlerine izin vermeyebilir; açıp açmamak sizin kararınızdır.

Ölçüm, Hepsiburada sepetinin gerçek sayfa yapısına (satır, adet kutusu, "Sepetten Çıkar" ve
"Ürünü Arttır" düğmeleri) göre yazıldı ve bu yapının kopyası üzerinde sınandı. Gerçek sitede henüz
baştan sona çalıştırılmadı: adet 1'den büyükken sol düğmenin ve çıkarma onayının nasıl göründüğü
bilinmiyor; ölçüm bu ikisinde düğmelerin adına değil konumuna ve pencerenin metnine bakar. Bir
ölçüm yapılamazsa **Sepet sayfasını incele**ye (hiçbir düğmeye basmaz) ve ardından **Tanı dosyası
indir**e basıp dosyayı paylaşın; dosyaya sepetinizdeki diğer ürünlerin adları da girer.

## Telegram bildirimleri

1. Telegram'da botunuzu açıp **Başlat**'a basın.
2. Panelin **Telegram bildirimleri** bölümüne BotFather'ın verdiği token'ı yapıştırıp **Bağlan**'a basın.
3. **Deneme mesajı gönder** ile sınayın.

Her taramadan sonra, değişiklik varsa tek mesaj gelir: satın alma sayacındaki artış, stoktan düşen
ya da stoka giren adet, tükenme ve yeniden stok, satış sıralamasındaki yükseliş, yeni yorum, yeni
baskı, fiyat ve satıcı sayısı değişikliği. Bir site doğrulama isterse bunu da günde bir kez haber
verir. Mesajlar tarama anında gelir; tarayıcı kapalıyken tarama yapılmaz.

Token yalnızca bu tarayıcıda saklanır; depoya, CSV'ye ya da tanı dosyasına yazılmaz.
**Bağlantıyı kaldır** token'ı siler.

Başka birinin kitabı sepetine eklediği dışarıdan görülemez; bu bilgi yalnızca sitenin kendi
sisteminde durur. Satış, yukarıdaki işaretlerden anlaşılır.

## Yeni sayfa ekleme

Panelin altındaki forma ürün sayfasının adresini yapıştırın. Ürün sayfasını bilmiyorsanız sitenin
ISBN ile arama adresini de yapıştırabilirsiniz; eklenti arama sonucundan kitabın kendi sayfasını
bulur ve sonraki taramalarda doğrudan orayı okur. Kitapyurdu bu yolla hazır eklidir.

## Okuyucunun bir siteye göre ayarlanması

Hepsiburada, Amazon, Kitapyurdu, Dost Kitabevi ve 1000Kitap geliştirme ortamından açılamadığı
için bu sitelerin okuyucusu yalnızca örnek sayfalarla denendi. İlk taramadan sonra bu satırlarda
eksik ya da yanlış bilgi görürseniz **Tanı dosyası indir**e basıp dosyayı paylaşın. Dosyada her
sitenin son taramasından yalnızca ürünle ilgili sayfa parçaları (ürün alanının yazısı, stokla
ilgili alanlar, düğme adları) bulunur; göndermeden önce açıp bakabilirsiniz.

## Geliştirme

```bash
npm install
npx playwright install chromium
npm test
```

`test/extension.test.js` eklentiyi gerçek tarayıcıya yükler ve mağazaların, sahte iki pazaryerinin
(`test/helpers/fake-shops.js`) ve Telegram'ın yerine yerel bir sunucu koyar; geçici sertifika üretmek
için `openssl` komutuna ihtiyaç duyar.

- `extractor.js`: açık sayfadan veriyi okur; arama sayfasından ürün sayfasını bulur.
- `background.js`: zamanlama ve tarama.
- `lib.js`: değişiklik, geçmiş ve satış işareti hesapları.
- `telegram.js`: bildirim metni ve Telegram çağrıları.
- `cartprobe.js`: sepet sınırı ölçümünün sayfa tarafı (düğmeleri bulma, adedi yükseltme, silme).
- `dashboard.*`: takip ekranı.
- `targets.js`: varsayılan kitap ve sayfalar.
