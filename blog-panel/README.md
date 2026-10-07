# Blog Panel — WHM domainleri için otomatik AI + SEO blog paylaşımı

WHM sunucunuzdaki her domain için **N günde bir (varsayılan 3)** otomatik blog yazısı üretip yayınlayan panel.
Panel PHP/HTML/CSS/JS ile yazıldı; içerik üretimi **n8n** workflow'unda **Claude** ile yapılır.

```
 ┌──────────── Blog Panel (PHP) ────────────┐        ┌──────────────── n8n ────────────────┐
 │ cron/run.php (15 dk'da bir)              │        │ 1. Webhook (Header Auth)            │
 │  └─ vakti gelen domain? ──► iş oluştur ──┼──POST──►│ 2. Siteyi getir + metni çıkar       │
 │                                          │        │ 3. Claude: konu & anahtar kelime    │
 │ api/callback.php  ◄──────────────────────┼──POST───│ 4. Claude: SEO uyumlu makale (JSON) │
 │  ├─ HTML temizleme + SEO puanı           │        │ 5. Sonucu panele gönder             │
 │  ├─ Yayın: WordPress REST / statik HTML  │        └─────────────────────────────────────┘
 │  └─ sonraki paylaşım = +3 gün            │
 └──────────────────────────────────────────┘
```

## Özellikler

- **WHM senkronizasyonu:** `get_domain_info` ile tüm ana/addon/subdomainler (docroot ve cPanel kullanıcısıyla) panele gelir. Yeni domainler pasif eklenir, siz seçip aktifleştirirsiniz.
- **Zamanlama:** Her domain için sıklık (gün) ve yayın saati. Aktifleştirilen domainler aralığa yayılır; 100 domaini aynı anda değil, 3 güne dağıtarak paylaşır. Cron başına iş sınırı vardır.
- **AI analizi (n8n):** Sitenin ana sayfası okunur, sektör / hedef kitle / hedef kelimeler / önceki başlıklar dikkate alınarak tekrar etmeyen, uzun kuyruklu bir konu seçilir; ardından bu plana göre makale yazılır. Çıktı JSON şemasıyla zorunlu kılınır.
- **SEO:** meta başlık/açıklama, slug, odak + ikincil kelimeler, H2/H3 yapısı, iç linkler (önceki yazılardan), SSS. Panel yayından önce 12 maddelik SEO kontrolü yapar ve puanlar; minimum puanın altındaki yazı yayınlanmaz.
- **Yayın yöntemleri:**
  - **Statik HTML (WHM):** WordPress olmayan siteler için `/blog/yazi-slug` sayfası, `blog/index.html`, `sitemap.xml`, `feed.xml` (RSS) üretir; canonical, Open Graph ve JSON-LD (BlogPosting, FAQPage, BreadcrumbList) içerir. Dosyalar WHM API üzerinden ilgili cPanel kullanıcısı adına yazılır.
  - **WordPress:** REST API + Uygulama Şifresi. Kategori, etiket, taslak/yayın; Yoast / Rank Math alanları.
  - **Statik HTML (yerel):** Panel aynı sunucuda ve docroot'a yazma izni varsa doğrudan dosya yazar.
- **Dayanıklılık:** Hata olursa 2 saat sonra tekrar dener; üst üste 3 hatada normal takvime döner. n8n yanıt vermezse 45 dk sonra iş zaman aşımına düşer. Aynı sonucun iki kez gelmesi (n8n retry) çift yazı oluşturmaz.
- **Güvenlik:** Oturum + CSRF, bcrypt şifre, WHM token / WP şifresi / n8n anahtarı veritabanında şifreli (libsodium), n8n ↔ panel arası paylaşılan gizli anahtar + iş başına tek kullanımlık token, AI HTML'i beyaz liste ile temizlenir.

## Gereksinimler

- PHP 8.1+ (`pdo_mysql` veya `pdo_sqlite`, `curl`, `sodium`, `mbstring`, `dom`) — cPanel'de MultiPHP ile seçilebilir
- MySQL/MariaDB (önerilir) veya SQLite
- WHM root (veya yeterli yetkili reseller) API token
- n8n (self-hosted veya n8n Cloud) ve bir Anthropic API anahtarı

## Kurulum

### 1. Paneli yükleyin
Örneğin `panel.alanadiniz.com` subdomain'i açıp `blog-panel` klasörünün içeriğini o subdomain'in docroot'una yükleyin. **SSL'in aktif olduğundan emin olun** (AutoSSL).

cPanel > MySQL Databases'tan bir veritabanı ve kullanıcı oluşturun.

### 2. Kurulum sihirbazı
`https://panel.alanadiniz.com/install.php` adresini açın, veritabanı ve yönetici bilgilerini girin. Kurulum bitince **`install.php` dosyasını silin.**

> Apache'de `app/`, `storage/`, `config.php` erişimi `.htaccess` ile kapatılmıştır. Nginx kullanıyorsanız bu yollar için `deny all` kuralı ekleyin.

### 3. WHM API token
WHM > Development > **Manage API Tokens** > Generate Token. Güvenlik için token'a yalnızca n8n/panel sunucusunun IP'sini izinli girin.
Panelde **Ayarlar > WHM bağlantısı** bölümüne `https://sunucu.alanadiniz.com:2087`, kullanıcı (`root`) ve token'ı girip **Test et**'e basın.

### 4. n8n workflow
1. n8n'de **Credentials** oluşturun (ikisi de *Header Auth* tipinde):
   - `Blog Panel Secret` → Name: `X-Blog-Panel-Secret`, Value: paneldeki gizli anahtar (Ayarlar > n8n > *Göster*)
   - `Anthropic API Key` → Name: `x-api-key`, Value: Anthropic API anahtarınız
2. **Import from File** ile `n8n/blog-generator-workflow.json` dosyasını içe aktarın.
3. *Panel Webhook*, *Claude: Konu Analizi*, *Claude: Makale Yaz* ve *Panele Gönder* düğümlerinde credential'ları seçin (içe aktarmada kimlikler eşleşmeyebilir).
4. Workflow'u **Active** yapın ve Webhook düğümündeki **Production URL**'yi kopyalayın.
5. Panel > Ayarlar > n8n: Webhook adresini yapıştırın, **n8n bağlantısını test et**.

> Varsayılan model `claude-opus-5-5` (effort: `medium`). Ret durumunda istek otomatik olarak uygun bir modele yönlendirilir (`fallbacks: "default"`). Maliyeti düşürmek isterseniz iki Claude düğümündeki Code adımlarında `model` değerini `claude-sonnet-5-5` yapabilirsiniz.

> **OpenAI ile kullanmak isterseniz:** `n8n/blog-generator-workflow-openai.json` dosyasını içe aktarın. Claude düğümleri yerine n8n'in hazır **OpenAI** credential'ını kullanır (Authentication: OpenAI). Model adı *Konu İsteği Oluştur* düğümünün en üstündeki `MODEL` satırından değiştirilir. Webhook yolu `blog-panel-generate-openai` olduğu için iki workflow aynı anda aktif olabilir; panelde hangisinin Production URL'sini girerseniz o kullanılır.

### 5. Cron
cPanel > **Cron Jobs**:
```
*/15 * * * * /usr/local/bin/php /home/KULLANICI/public_html/panel/cron/run.php >/dev/null 2>&1
```
(Tam yol Ayarlar sayfasında gösterilir.)

### 6. Domainleri ayarlayın
1. **Domainler > WHM'den senkronize et**
2. Her domain için **Düzenle**: sektör, hedef kitle, hedef anahtar kelimeler, ton, yayın yöntemi.
3. **Yayın bağlantısını test et** ile yazma/WordPress erişimini doğrulayın.
4. Anahtarı açın (aktif). İlk yazıyı hemen görmek için **Şimdi paylaş**.

#### WordPress siteleri
- WP Admin > Kullanıcılar > Profil > **Uygulama Şifreleri** ile şifre oluşturun (Editör veya Yönetici rolü).
- Yoast/Rank Math meta alanlarının dolması için `wordpress/blog-panel-seo-meta.php` dosyasını sitenin `wp-content/mu-plugins/` klasörüne yükleyin.

#### Statik siteler
- Yazılar `https://domain.com/blog/...` altında yayınlanır. Sitenizin menüsüne `/blog/` linki ekleyin.
- Google Search Console'a `https://domain.com/blog/sitemap.xml` adresini ekleyin (veya `robots.txt`'ye `Sitemap:` satırı).
- Sitenizin görünümüyle uyum için domain ayarlarındaki **Ek &lt;head&gt; kodu** alanına sitenizin CSS dosyasını ekleyebilirsiniz.

## Test

Ağ gerektirmeyen uçtan uca test (SQLite + sahte n8n + yerel statik yayın):
```
php tests/smoke_test.php
```

## Dosya yapısı

```
index.php, domains.php, domain_edit.php, posts.php, post_view.php, jobs.php, settings.php   Panel sayfaları
api/action.php        Panel içi AJAX işlemleri (tetikle, test, senkronize)
api/callback.php      n8n → panel sonuç teslimi
cron/run.php          Zamanlayıcı
app/src/              Servisler (WhmClient, JobService, Scheduler, SeoAnalyzer, Publisher/*)
app/templates/        Statik blog sayfa şablonları
n8n/                  İçe aktarılacak n8n workflow'u
wordpress/            WordPress SEO meta mu-plugin
```

## Notlar

- Yapay zekâ içerikleri otomatik yayınlanır. İlk haftalarda yazıları **Yazılar** sayfasından gözden geçirmeniz, gerekirse WordPress'te `Taslak` durumunu kullanmanız önerilir.
- Zamanlama, n8n tetikleme, callback, SEO kontrolü ve yerel statik yayın otomatik testle doğrulanmıştır. WordPress REST ve WHM (`get_domain_info`, `Fileman` API) entegrasyonları resmi API'lere göre yazılmıştır ancak canlı sunucuda denenmemiştir; canlıya almadan önce **Ayarlar > WHM test** ve her domain için **Yayın bağlantısını test et** butonlarını kullanın.
