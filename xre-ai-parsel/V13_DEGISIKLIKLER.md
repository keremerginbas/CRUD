# XRE AI Parsel V13 — TKGM tarzı panel ve idari sınırlar

## Yeni
- **İdari sınır çizimi (TKGM Parsel Sorgu gibi):** İl, ilçe veya mahalle seçildikçe en alt seçili birimin sınırı haritada kırmızı çizgiyle gösterilir ve harita oraya yakınlaşır. Sınırlar TKGM `idariYapi` listelerinin kendi GeoJSON geometrisidir; uydurma sınır çizilmez. Servis geometri döndürmezse panelde not düşülür.
  - API: `GET /api/regions/boundary/:level/:parentId/:id` (`level`: `province` | `district` | `neighborhood`, il için `parentId=0`). Liste uç noktaları artık yalnızca `id`, `name`, `hasBoundary` döndürür; poligonlar aynı önbellekten tek tek verilir.
- **Aranabilir seçiciler:** İl/ilçe/mahalle alanlarına yazarak filtreleme (Türkçe karakter duyarlı), adım göstergesi, temizle düğmesi, klavye ile gezinme (Base UI Combobox).
- **Sol panel düzeni:** İdari Sorgu · Analiz · Kayıtlar sekmeleri; harita tam genişlik, araç çubuğu harita üzerinde. Seçili bölge yolu (Ankara › Elmadağ › Tatlıca) ve parsel sonuç kartı.
- **Kayıtlar tablosu:** Arama ve sıralama (TanStack Table v8), favori/sil.
- **İmleç koordinatı + zoom göstergesi** harita sol altında.
- **Koyu tema** sistem ayarına göre otomatik.
- **XRE Real Estate logosu** header ve sekme simgesinde; arka planı şeffaf SVG (`public/logo-mark.svg`).

## Düzeltmeler
- Uydu görünümünde yüksek zoomda görülen **“Map data not yet available”** döşemeleri: Esri World Imagery kırsal alanlarda 18. seviyeden sonra gerçek görüntü vermiyor. Döşemeler artık 18'de alınıp 21'e kadar büyütülüyor.
- Uydu görünümüne isteğe bağlı yer adı/sınır etiket katmanı eklendi.
- Büyük zoom sıçramasında parsel poligonunun yarım çizilmesi ve zoom göstergesinin güncellenmemesi giderildi.

## Teknoloji
Tailwind CSS v4 (`@tailwindcss/vite`), shadcn/ui tarzı bileşenler (`src/components/ui`, `class-variance-authority` + `tailwind-merge`), Base UI (Combobox, Tabs), Motion (sonuç kartı geçişleri; “hareketi azalt” ayarına uyar), Lucide, TanStack Table.

## Kurulum
V12 ile aynı: `KURULUM.bat` → `BASLAT_API.bat` + `BASLAT_HARITA.bat`. Yeni npm paketleri `npm install` ile gelir. `.env` ve `data/*.sqlite` V12'den kopyalanabilir.

## Bilinen sınırlar
- Uydu görüntüsü Esri'nindir; TKGM'nin kullandığı HGM Atlas görüntüsünden farklı tarihte olabilir, bu yüzden binalar/yollar parsel çizgisine göre birkaç metre kaymış veya eksik görünebilir. Parsel koordinatları TKGM'den geldiği gibidir.
- TKGM sınır geometrisinin her il/ilçe/mahalle için dönmesi TKGM servisine bağlıdır.
