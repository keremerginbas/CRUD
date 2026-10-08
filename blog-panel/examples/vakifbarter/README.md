# vakifbarter.com: klasör başına yazı örneği

Bu sitede her yazının kendi klasörü var: `/blog/{slug}/index.html`, adresi `https://vakifbarter.com/blog/{slug}/`.

- `_sablon-yazi.html` ve `_sablon-kart.html` dosyaları `public_html/blog/` klasörüne yüklenir.
- `_sablon-yazi.html` içindeki `<!-- blog-panel:klasor -->` satırı panele klasör düzenini kullanmasını söyler. Bu satır yayınlanan sayfaya yazılmaz.
- `public_html/blog/index.html` içinde, `<div class="list-grid">` satırının hemen altına `<!-- blog-panel:liste -->` eklenir. Yeni kartlar oraya, en üste eklenir.
- Panelde, domain ayarlarında: **Blog klasörü** `blog`, **Liste sayfası** `blog/index.html`.
- `{{toc}}`, yazıdaki `<h2>` başlıklarından "İçindekiler" listesi üretir.
