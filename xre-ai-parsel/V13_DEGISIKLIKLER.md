# XRE AI Parsel V13 — TKGM tarzı panel ve idari sınırlar

## Yeni
- **İdari sınır çizimi (TKGM Parsel Sorgu gibi):** İl, ilçe veya mahalle seçildikçe en alt seçili birimin sınırı haritada kırmızı çizgiyle gösterilir ve harita oraya yakınlaşır. Sınırlar TKGM `idariYapi` listelerinin kendi GeoJSON geometrisidir; uydurma sınır çizilmez. Servis geometri döndürmezse panelde not düşülür.
  - API: `GET /api/regions/boundary/:level/:parentId/:id` (`level`: `province` | `district` | `neighborhood`, il için `parentId=0`). Liste uç noktaları artık yalnızca `id`, `name`, `hasBoundary` döndürür; poligonlar aynı önbellekten tek tek verilir.
- **Aranabilir seçiciler:** İl/ilçe/mahalle alanlarına yazarak filtreleme (Türkçe karakter duyarlı), adım göstergesi, temizle düğmesi, klavye ile gezinme (Base UI Combobox).
- **Sol panel düzeni:** İdari Sorgu · Analiz · Kayıtlar sekmeleri; harita tam genişlik, araç çubuğu harita üzerinde. Seçili bölge yolu (Ankara › Elmadağ › Tatlıca) ve parsel sonuç kartı.
- **Kayıtlar tablosu:** Arama ve sıralama (TanStack Table v8), favori/sil.
- **İmleç koordinatı + zoom göstergesi** harita sol altında.
- **Koyu tema** sistem ayarına göre otomatik.
- **AI raporu** ham Markdown yerine ikonlu bölüm kartları ve etiket/değer satırlarıyla gösteriliyor.
- **Harita pinleri** logo biçiminde damla ikonlar: seçili nokta kırmızı, kayıtlı mavi, favori altın yıldızlı; not baloncuğu yenilendi.
- **XRE Software logosu** header ve sekme simgesinde; arka planı şeffaf SVG (`public/logo-mark.svg`).

## Kayıttan parsel sınırı
- Soldaki **Kayıtlar** listesinden veya haritadaki pinden bir kayıt seçildiğinde o noktanın **parseli kırmızı sınırla** çizilir.
- Kayıt sırasında nokta, daha önce sorgulanmış (yerel arşivdeki) bir parselin içindeyse kayda otomatik bağlanır. Eski kayıtlarda da nokta arşivdeki bir parselin içindeyse sınır bulunur; değilse o parselin ada/parselini bir kez sorgulamanız yeterlidir.

## AI analizi: emsal + resmî kaynak
- **Emsal ilanlar:** İlan5 eklentisinin panelinden *Yedek (JSON)* veya *CSV* alın, Analiz sekmesindeki **İlan5 dosyası yükle** ile içe aktarın. Sahibinden/Emlakjet/Hepsiemlak arsa ilanları parselin il/ilçe/mahallesiyle eşleştirilir. **Satıcı adı, telefon ve açıklama saklanmaz.**
- **Rakamlar kodda hesaplanır:** m² fiyatı medyanı, %25–%75 aralığı, uç değer ayıklama (1,5×IQR), benzer büyüklük süzgeci (1/3x–3x) ve parsel alanına göre istenen fiyat aralığı. Mahallede 5'ten az emsal varsa ilçe kullanılır, ilçede de 5'ten azsa **değer verilmez**. AI bu sayıları yeniden hesaplamaz, yalnızca yorumlar ve emsallere [E1] biçiminde atıf yapar.
- **Aynı ada/parsel ilanı:** İlanda "Ada/Parsel No" bu parselle eşleşiyorsa ayrıca gösterilir.
- **Web araştırması (OpenAI web_search):** AI ilgili belediyenin e-imar/imar durumu ve arsa m² birim değeri, e-Plan, DSİ kamulaştırma, ÇŞB yapı yaklaşık birim maliyetleri ve ilan sitelerini tarar; her bulgu kaynak linkiyle listelenir, bulunamayan konu "bulunamadı" yazılır. `.env` içinde `AI_WEB_SEARCH=false` ile kapatılır. Model desteklemezse analiz yerel verilerle sürer ve bu belirtilir.
- **Resmî kaynak kontrolü:** TKGM Parsel Sorgu, e-Devlet tapu, e-Plan, belediye e-imar ve emsal/rayiç değer, DSİ, ÇŞB birim maliyet bağlantıları parsel bilgisiyle hazırlanır. Adresi belediyeye/yıla göre değişen kaynaklar arama bağlantısıdır.
- Sınır: Bu kurumların çoğunun açık API'si yoktur ve bazıları giriş ister; uygulama bu sitelere otomatik giriş yapmaz, veri kazımaz. İmar ve değer için resmî belge gerekir.

## TKGM Alım Satım Yoğunluğu (Parsel Sorgu > Analiz)
- Analiz sekmesindeki **Alım Satım Yoğunluğu** kartı, seçili ilçe ve yıl için TKGM'nin kendi analiz servisinden veriyi çeker: `GET https://cbsapi.tkgm.gov.tr/megsiswebapi.v3.1/api/analiz?AnalizTip=1&Yil=<yıl>&IlceId=<ilçe>` (adres, kullanıcının tarayıcı ağ kaydından alındı; token gönderilmez, tarayıcı başlığı taklit edilmez).
- Haritada TKGM'deki gibi **Yoğunluk** (ısı, mavi→kırmızı lejant) veya **Küme** (rozette toplam işlem adedi) olarak gösterilir; **Gizle** ile kapatılır.
- Servis reddederse TKGM Network → Response metni **yapıştırılarak** aynı biçimde kaydedilir.
- Aynı parsel için gelen birden çok satır toplanır; bozuk satırlar atlanır ve sayısı bildirilir. Veri SQLite'ta yıl/ilçe bazında saklanır, yeniden yüklenince değiştirilir.
- AI analizine kodda hesaplanmış **işlem adetleri** eklenir: parselin 500 m / 1 km / 3 km çevresindeki işlemler, ilçe toplamı ve medyanı; parsel geometrisi arşivdeyse parselin kendi işlem sayısı. Bunlar fiyat değil, piyasa hareketliliği göstergesidir.

## Sunucuya kurulum (cPanel)
- **Şifreli giriş:** `.env` içinde `APP_PASSWORD` tanımlıysa uygulama giriş ekranıyla açılır (HMAC imzalı, HttpOnly oturum çerezi, 7 gün; 5 hatalı denemede 15 dk bekleme; başka siteden gelen yazma istekleri reddedilir). İnternete açık çalışırken (Passenger veya yerel olmayan HOST) şifre yoksa sunucu **başlamaz**.
- **Alt dizin:** `BASE_PATH=/parsel-sorgu` ile `https://alanadi/parsel-sorgu/` altında çalışır; arayüz göreli adreslerle derlenir.
- **Günlük AI sınırı:** `AI_DAILY_LIMIT` (varsayılan 50).
- **Dağıtım paketi:** `npm run deploy` → `deploy/parsel-sorgu-app` (derlenmiş arayüz + sunucu + Python köprüsü, yalnızca 4 çalışma zamanı paketi). Başlangıç dosyası `app.cjs`. Adımlar: `KURULUM_CPANEL.md`.
- MySQL kullanılırsa tablolar `db/schema.sql`'den otomatik oluşturulur. Python köprüsü artık yalnızca `requests` ister.

## Düzeltmeler
- Uydu görünümünde yüksek zoomda görülen **“Map data not yet available”** döşemeleri: Esri World Imagery kırsal alanlarda 18. seviyeden sonra gerçek görüntü vermiyor. Döşemeler artık 18'de alınıp 21'e kadar büyütülüyor.
- Uydu görünümüne isteğe bağlı yer adı/sınır etiket katmanı eklendi.
- Büyük zoom sıçramasında parsel poligonunun yarım çizilmesi ve zoom göstergesinin güncellenmemesi giderildi.

## Teknoloji
Tailwind CSS v4 (`@tailwindcss/vite`), shadcn/ui tarzı bileşenler (`src/components/ui`, `class-variance-authority` + `tailwind-merge`), Base UI (Combobox, Tabs), Motion (sonuç kartı geçişleri; “hareketi azalt” ayarına uyar), Lucide, TanStack Table.

## Kurulum
- **Önerilen:** `BASLAT.bat` → tek pencere, `http://localhost:3001` (arayüz derlenip API'den verilir; eski Vite penceresi veya port karışıklığı olmaz).
V12 ile aynı: `KURULUM.bat` → `BASLAT_API.bat` + `BASLAT_HARITA.bat`. Yeni npm paketleri `npm install` ile gelir. `.env` ve `data/*.sqlite` V12'den kopyalanabilir.

## Bilinen sınırlar
- Uydu görüntüsü Esri'nindir; TKGM'nin kullandığı HGM Atlas görüntüsünden farklı tarihte olabilir, bu yüzden binalar/yollar parsel çizgisine göre birkaç metre kaymış veya eksik görünebilir. Parsel koordinatları TKGM'den geldiği gibidir.
- TKGM sınır geometrisinin her il/ilçe/mahalle için dönmesi TKGM servisine bağlıdır.
