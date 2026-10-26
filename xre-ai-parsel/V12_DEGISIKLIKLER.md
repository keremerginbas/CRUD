# XRE AI Parsel V12 — Kırmızı parsel sınırı

## Düzeltilen sorun
V11'de gerçek TKGM GeoJSON poligonu geliyor, ancak `fitBounds` yakınlaşması 17 ile sınırlandırılıyor, alan ince sarı çiziliyor ve üstündeki konum pini küçük parseli örtebiliyordu. 489 m² boyutlu taşınmazda parsel görünmüyormuş gibi algılanıyordu.

## Uygulanan düzeltmeler
- Sağlanan TKGM geometri koordinatları değiştirilmez; hiçbir sentetik sınır çizilmez.
- Vektör poligon kenarı `#e21d35` kırmızı, 5 piksel; alan dolgusu `#ef334c` ve saydamlığı %27.
- Otomatik yakınlaştırma en çok 20. zoom seviyesine yükseltildi. Harita katmanları `maxNativeZoom=19`, `maxZoom=21` ile aşırı yakınlaştırmada döşemeleri ölçekler.
- Parsel sorgusu başarılı olduğunda poligon üzerindeki geçici kırmızı pin gizlenir. Favori pinleri ve kayıtlı konumlar korunur.
- **Parsele Yakınlaş** düğmesiyle yeniden sorgu yapmadan poligona odaklanılır.

## Kurulum ve veri taşıma
Windows'ta `KURULUM_WINDOWS.md` talimatlarını takip edin. V11'deki `.env` ve SQLite kayıtlarınızı saklayın. Yeni sürüm **ayrı** klasöre kurulmalıdır.

## Kaynak doğrulama
TKGM CBS yanıtı resmî tapu veya imar belgesi değildir. Sağlayıcı yanıtında `alan=489` ve `nitelik=Arsa` bulunması, ilanda geçen `konut imarlı` iddiasını tek başına doğrulamaz. İmar için yetkili belediye imar durum belgesine ihtiyaç vardır.
