# XRE AI Parsel V12 — Windows kurulumu ve doğrudan sorgulama

## V11'den V12'ye veri kaybetmeden geçiş

1. V11'de `BASLAT_API.bat` ve `BASLAT_HARITA.bat` pencerelerini `Ctrl+C` ile kapatın.
2. V12 ZIP'ini **ayrı bir klasöre** çıkartın; V11 klasörünü silmeyin.
3. V11 içindeki `data/xre-parsel.sqlite` dosyasını **yedekleyin** ve V12 içindeki `data/` klasörüne kopyalayın. SQLite WAL kullanılıyorsa, kapalı sunucuda `.sqlite-wal` / `.sqlite-shm` dosyalarını da birlikte taşıyın.
4. V11'de `.env` yapılandırılmışsa yalnızca sunucu duruyorken V12 klasörüne kopyalayın. `.env` veya SQLite dosyalarını kimseyle paylaşmayın.
5. `KURULUM.bat`, sonra `BASLAT_API.bat` ve `BASLAT_HARITA.bat` çalıştırın.
6. Tekrar **Ankara > Elmadağ > Tatlıca > 886 / 9** sorgulayın. Kırmızı sınırı görmelisiniz; `Parsele Yakınlaş` tuşunu kullanabilirsiniz.

## Ne değişti?

- **Ada/parsel sorgusu önce herkese açık TKGM CBS adresine doğrudan GET isteği gönderir.** `TKGM_TOKEN` şart değil. Bu, servisin her kullanıcıdan isteği kabul ettiği anlamına **gelmez**.
- Varsayılan bağlantı `https://cbsapi.tkgm.gov.tr/megsiswebapi.v3/api` ve adres formatı `/parsel/{mahalleId}/{ada}/{parsel}`.
- İl/ilçe/mahalle listesi de aynı servisten istenir. Kaynak: kullanıcı tarafından sağlanan `parselsorgu-main` örnek kodu ve Ağustos 2026 tarihli teknik API referansı.
- **401/403 geldiğinde:** Yazılım erişimi aşmaz, sahte sonuç göstermez; resmî parsel sorgu ekranından işleminizi yapabilirsiniz.
- **404:** Parsel bulunamamış veya API yolu güncelliğini yitirmiş olabilir; resmî portalda teyit edin.
- İstekte otomatik giriş, şifre/çerez yakalama, bot korumasını aşma veya toplu veri kazıma yok.

## Kurulum (tek bilgisayar, iki terminal)

1. V9/V10 açıksa iki terminalde `Ctrl+C` ile kapatın.
2. ZIP'i yeni bir klasöre açın. ZIP içindeki `xre-ai-parsel-v12` klasörünü kullanın.
3. Önceki projenizde **gerçek** `data/xre-parsel.sqlite` dosyası varsa yedeğini alıp V12'deki `data/` içine kopyalayın. `-wal` ve `-shm` varsa kapalı sunucudan birlikte aktarın. ZIP içinde eski kişisel kayıtlar bulunmaz.
4. `KURULUM.bat` dosyasını çalıştırın. Node.js ve Python gerekir.
5. `TEST_TKGM_BAGLANTI.bat` ile TKGM il listesini doğrudan test edin. İl listesi açılsa bile parsel çağrısı ayrıca reddedilebilir.
6. `BASLAT_API.bat` dosyasını açın. İkinci pencerede `BASLAT_HARITA.bat` çalıştırın.
7. `http://localhost:5173` adresinde il–ilçe–mahalle seçin, ada/parsel yazıp **Parseli Sorgula** düğmesine basın.
8. Sunucu kontrolü: `http://127.0.0.1:3001/api/health`.

## `.env` varsayılanları

```dotenv
HOST=127.0.0.1
PORT=3001
TKGM_PARCEL_MODE=public
TKGM_TOKEN=
TKGM_COORDINATE_ENABLED=false
OPENAI_API_KEY=
```

Normal doğrudan sorgu için `TKGM_TOKEN` **boş bırakılır**. `authorized` modu ancak veri sağlayıcının açıkça bu servis için verdiği geçerli erişim bilgileriyle kullanılabilir. e-Devlet şifrenizi, kullanıcı giriş çerezinizi, başka birinin token'ını veya oturum değerlerini buraya yapıştırmayın.

**Eski V10'dan geçiş:** V10 `.env` dosyasını kullanıyorsanız `TKGM_PARCEL_MODE=public` satırını ekleyin veya mevcut boş bir `.env` yerine yeni `.env.example` dosyasını kopyalayın. `TKGM_API_BASE` tanımlıysa v3 sürümüne uygun olduğundan emin olun; tanımlamamak en kolay yoldur.

## Doğrudan API istemi

Arayüzde istek şu şekilde ilerler:

```
React → POST /api/parcels/search → Express → Python
Python → GET https://cbsapi.tkgm.gov.tr/megsiswebapi.v3/api/parsel/{mahalleId}/{ada}/{parsel}
Python → JSON / GeoJSON → Express → Leaflet
```

Başarı durumunda servisin döndürdüğü ada/parsel kimliği kontrol edilir. Geometri ve kaynak bilgisi saklanır. Bu görüntüleme **resmî tapu belgesi / imar durumu yerine geçmez**.

## Sorun giderme

- `401/403` → Servis erişimi kısıtladı. Rastgele token aramak veya korumayı aşmak yerine [resmî Parsel Sorgu](https://parselsorguv2.tkgm.gov.tr/) ile sorgulayın; kalıcı entegrasyon için TKGM ile veri erişimini görüşün.
- `404` → Bilgi yanlış olabilir veya API yolu değişmiş olabilir.
- `502` → Servis yanıtı beklenen formatta değil veya erişilemiyor. API terminalindeki hata mesajını kontrol edin.
- `429` → İstek limiti, hemen tekrar etmeyin.
- `İl listesi alınamadı` → `TEST_TKGM_BAGLANTI.bat` çalıştırıp çıktısını kontrol edin.
- `Kayıtlı konum yok` → Eski SQLite dosyası taşınmamış olabilir.
- `OPENAI_API_KEY yok` → Sadece AI analizini etkiler, parsel sorgusu için OpenAI anahtarı gerekmez.

## Sınırlar ve kaynaklar

- Kullanıcı kaynakları: `parselsorgu-main`, `tkgm-py-master`, `class.tkgm.php-master` ZIP'leri. Sonuncu paket eski `/parselbagligeometri` yolunu kullanıyor; çalıştığı doğrulanmadığından otomatik fallback olarak kullanılmadı.
- Sunucu adresi ve sürüm değişebilir, TKGM'nin kullanım koşullarına tabidir.
- Geliştirme ortamında canlı TKGM uç noktasına bağlantı kurulamadı. Python birim testleri gerçek sunucu verisini kanıtlamaz. Bilgisayarınızda gerçek sorgunun çalışıp çalışmadığı ayrıca doğrulanmalıdır.
- Uygulama yalnızca `127.0.0.1` üzerinde sunulur; harita servisine internet üzerinden istek atar.
