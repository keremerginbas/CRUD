# İlan5 — Windows kurulum planı

Bu rehber İlan5'i Mac'ten Windows bilgisayara taşımak ve Windows'ta sorunsuz çalıştırmak içindir. Toplam süre yaklaşık 15 dakikadır.

## A. Mac'te (taşımadan önce)

1. Mac'te İlan5 panelini açın. Varsa çalışan taramayı **Durdur** ile kapatın.
2. Sol alttaki **JSON yedeği indir** düğmesine basın. İnen `ilan5_..._yedek.json` dosyası şunları içerir: ilanlar, listeler, notlar ve takip durumları, fiyat hareketleri, kayıtlı aramalar, güvenli tarama ayarları, Telegram bildirim ayarları, bağlantı takibi ayarları, mesaj şablonları.
3. Bu yedek dosyasını ve bu ZIP'i USB bellek, e-posta veya Google Drive ile Windows bilgisayara aktarın.

Telegram bot tokeni güvenlik için yedeğe yazılmaz. Bu ZIP'teki `config.private.js` dosyası tokeninizi içerir ve Windows'ta ilk açılışta otomatik yüklenir. **Bu ZIP'i başkasıyla paylaşmayın.**

## B. Windows'ta klasörü hazırlama

1. ZIP'e sağ tıklayın → **Tümünü ayıkla**.
2. Hedef olarak **`C:\Ilan5`** yazın ve ayıklayın. Sonuçta `C:\Ilan5\ilan5_extension\manifest.json` dosyası bulunmalıdır.
3. Klasörü şu yerlere **koymayın**:
   - **İndirilenler** klasörüne: temizlik yaparken silinebilir.
   - **Masaüstü** veya **Belgeler** klasörüne: Windows'ta bunlar çoğu zaman OneDrive ile eşitlenir. OneDrive dosyaları buluta taşıyıp yerel kopyayı silebilir; Chrome eklentiyi bulamaz hale gelir.

## C. Ayrı Chrome profili (önerilir)

Taramanın kendi Sahibinden hesabınızla hiç karışmaması için:

1. Chrome'da sağ üstteki profil simgesi → **Ekle** → **Hesap olmadan devam et**. Adını **İlan5 Tarama** koyun.
2. Bu profilde Sahibinden'e **giriş yapmayın**. Mesaj göndermeyi kendi profilinizden elle yaparsınız.
3. Chrome bu profil için masaüstüne kısayol oluşturmayı önerirse kabul edin; aşağıda başlangıca ekleyeceğiz.

Edge kullanmak isterseniz aynı adımlar `edge://extensions` adresiyle geçerlidir.

## D. Eklentiyi yükleme

1. **İlan5 Tarama** profilinde adres çubuğuna `chrome://extensions` yazın.
2. Sağ üstten **Geliştirici modu**nu açın.
3. **Paketlenmemiş öğe yükle** → `C:\Ilan5\ilan5_extension` klasörünü seçin.
4. Eklentiler (yapboz) simgesi → İlan5'in yanındaki raptiye ile araç çubuğuna sabitleyin.
5. İlan5 simgesi → **Veri çekme ekranını aç**. Sol altta **Sürüm 3.0.0** yazmalıdır.

Chrome açılışta “Geliştirici modu uzantılarını devre dışı bırakın” uyarısı gösterebilir. **Kapat** (×) deyin; **Devre dışı bırak**'a basmayın.

## E. Mac'teki arşivi içe aktarma

1. Panelde **İçe aktar** → Mac'ten getirdiğiniz `..._yedek.json` dosyasını seçin.
2. “Kayıtlı aramalar ve ayarlar da aktarılsın mı?” sorusuna **Tamam** deyin.
3. Kayıtlı aramalar **takibi kapalı** gelir. Her şeyi kontrol ettikten sonra **İzlenen aramalar** bölümünde her aramada **Takibi aç**'a basın.
4. **Takip ve Telegram** → **Bağlantıyı doğrula** ile Telegram'ın çalıştığını kontrol edin. Doğrulama başarılıysa isterseniz `C:\Ilan5\ilan5_extension\config.private.js` dosyasını silebilirsiniz; token eklentinin içine kaydedilmiştir.

## F. Windows'un taramayı kesmemesi için

İlan5 bir sunucu değildir; Chrome açık ve bilgisayar uyanıkken çalışır.

1. **Uyku:** Ayarlar → Sistem → **Güç ve pil** (veya Güç ve uyku) → “Fişe takılıyken uyku moduna geç” → **Hiçbir zaman**. Ekranın kapanması sorun değildir, bilgisayarın uyuması sorundur.
2. **Chrome'u başlangıçta açma:** `Win + R` → `shell:startup` yazıp Enter. Açılan klasöre **İlan5 Tarama** profilinin Chrome kısayolunu kopyalayın. Windows Update sonrası yeniden başlatmada Chrome kendiliğinden açılır ve kayıtlı aramalar sürer.
3. **Chrome'u kapatmayın:** Pencereyi küçültebilirsiniz. Tamamen kapatırsanız zamanlanmış taramalar ve sabah özeti, Chrome tekrar açılana kadar bekler.
4. **Tarama penceresi:** “Taramayı ayrı, küçültülmüş pencerede yap” açıksa görev çubuğunda ikinci bir Chrome penceresi görünür. **Bu pencereyi kapatmayın**; küçük kalabilir. Windows bazen küçültülmüş pencerelerde sayfa yüklemeyi yavaşlatır. Taramada çok sayıda “sayfa yüklenmedi” veya eksik alan uyarısı görürseniz bu seçeneği kapatın; tarama ana pencerede arka sekmede devam eder.

## G. Yedekler

**Haftalık otomatik yedek** açıksa, panel açıldığında son yedekten 7 gün geçtiyse yedek **İndirilenler** klasörüne iner. Bu dosyaları ara sıra OneDrive veya Google Drive'a kopyalamanız yeterli; bilgisayar arızalanırsa arşiviniz kaybolmaz.

## H. İlk deneme

1. Veri çekme formunda **En fazla ilan: 2**, **Bu aramayı düzenli takip et: kapalı** ile bir arama deneyin.
2. Gelen iki ilanın fiyat, telefon ve satıcı bilgisini Sahibinden'deki ilanla karşılaştırın.
3. Telefon boş geliyorsa ilan numarayı yalnız üye girişiyle gösteriyor olabilir. Bu, girişsiz tarama profilinin bilinen sınırıdır.
4. Sonra **En fazla ilan: 0** ile asıl taramayı başlatın.

## Sık karşılaşılan durumlar

| Durum | Çözüm |
|---|---|
| Panelde eski sürüm yazıyor | Klasörü iç içe çıkarmış olabilirsiniz. `chrome://extensions` → İlan5 → **Ayrıntılar** bölümündeki yolu kontrol edin; yol `manifest.json` dosyasının bulunduğu klasörü göstermelidir. |
| Arşiv boş görünüyor | Farklı Chrome profilinde olabilirsiniz. Arşiv eklentinin kurulduğu profile aittir. JSON yedeğini o profilde içe aktarın. |
| “Manifest dosyası eksik” hatası | Yanlış klasörü seçtiniz. İçinde `manifest.json` olan `ilan5_extension` klasörünü seçin. |
| Telegram mesajı gelmiyor | **Bağlantıyı doğrula**'ya basın. Hata devam ederse tokeni **Bot tokeni** alanına yeniden girin. |
| Doğrulama ekranı çıktı | Tarama durur. Görev çubuğundaki tarama penceresini açıp işlemi tamamlayın, panelde **Devam et** deyin. |

## Güncelleme (ileride)

Yeni ZIP geldiğinde: önce **JSON yedeği indir**. ZIP'i ayıklayın, **içindeki dosyaları** seçip `C:\Ilan5\ilan5_extension` klasörüne yapıştırın ve **Hedefteki dosyaları değiştir** deyin. Sonra `chrome://extensions` → İlan5 → **Yenile**. Eklentiyi kaldırmayın; kaldırırsanız Chrome arşivi siler.
