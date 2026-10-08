# xrebarter.com: Node.js (Express) sitesi örneği

Site `public_html` içinde değil; Express uygulaması `/home/xrebarter/xre-barter/public` klasörünü sunuyor (`express.static`). Yazılar `/blog/{slug}.html` olarak yayınlanır.

- `_sablon-yazi.html` ve `_sablon-kart.html` dosyaları `/home/xrebarter/xre-barter/public/blog/` klasörüne yüklenir.
- `public/blog/index.html` içinde `<section><div class="container grid3">` satırının hemen altına `<!-- blog-panel:liste -->` eklenir.
- Panelde, domain ayarlarında: **Docroot** `/home/xrebarter/xre-barter/public`, **Blog klasörü** `blog`, **Liste sayfası** `blog/index.html`.
- Express dosyaları her istekte diskten okur; yeni yazı için uygulamayı yeniden başlatmak gerekmez.
