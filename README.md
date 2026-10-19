# CMS Hafriyat Nakliyat İnşaat Taahhüt – Kurumsal Web Sitesi

Statik, hızlı ve SEO odaklı kurumsal site. **HTML + Tailwind CSS + saf JavaScript**. Videolar, görseller ve logo
kodla üretilir (telifsiz). `dist/` klasörü doğrudan hostinge yüklenmeye hazırdır.

## Hızlı başlangıç

```bash
npm install
npm run build        # dist/ üretir + SEO doğrulaması yapar
npm run check        # sadece SEO kontrolü (dosya yazmaz)
php -S 127.0.0.1:8080 -t dist   # yerelde önizleme (chatbot/form API dahil)
```

Medya yeniden üretimi (Python 3 + Pillow + ffmpeg; logo için `pip install fonttools cairosvg`):

```bash
python3 scripts/render_media.py      # 5 video + posterler + OG görselleri + blog kapakları
python3 scripts/make_logo.py         # logo SVG/PNG + favicon seti
```

## Site haritası ve link hiyerarşisi

```
/                                  Ana Sayfa (öncelik 1.0)
├── /hakkimizda/                   Hakkımızda (misyon, vizyon, değerler)
├── /hizmetler/                    Hizmetlerimiz (hub)
│   ├── /hizmetler/hafriyat/
│   ├── /hizmetler/is-makineleri/
│   ├── /hizmetler/insaat-taahhut/
│   ├── /hizmetler/temel-kazi-isleri/
│   ├── /hizmetler/altyapi-isleri/
│   ├── /hizmetler/yol-kazi-isleri/
│   ├── /hizmetler/dolgu-isleri/
│   └── /hizmetler/nakliye/
├── /projeler/                     Yaptığımız İşler (videolar + proje galerisi)
├── /blog/                         Blog & Rehberler (6 rehber)
│   └── /haberler/                 Haberler & Duyurular (3 haber)
├── /iletisim/                     İletişim + teklif formu
├── /sss/                          Sıkça Sorulan Sorular
└── /kvkk/                         KVKK Aydınlatma Metni
```

- Header ve footer menüsü: **Ana Sayfa · Hakkımızda · Hizmetlerimiz · Yaptığımız İşler · Blog · İletişim**
- Hub → alt sayfa → hub (breadcrumb) + kardeş sayfalar arası bağlantılar (ilgili hizmetler, ilgili yazılar).
- Blog yazıları bağlam içi linklerle hizmet sayfalarını besler (topic cluster / pillar yapısı).
- Build sırasında **kırık iç link** kontrolü yapılır.

## SEO kontrol listesi (her sayfada, build tarafından doğrulanır)

| Öğe | Durum |
|---|---|
| `<title>` | ≤ 55 karakter, benzersiz (aşılırsa build durur) |
| Meta description | 120–150 karakter, benzersiz |
| URL | Türkçe karakter içermeyen, sonda `/` olan temiz adresler |
| Canonical | Her sayfada mutlak URL |
| Robots meta | `index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1` (+ googlebot, bingbot) |
| X-Robots-Tag | `.htaccess` (Apache/cPanel) ve `_headers` (Netlify/Cloudflare) ile HTTP başlığı olarak |
| Keywords | Her sayfada `<meta name="keywords">` |
| Publisher | `<meta name="publisher">` + schema.org `publisher` |
| Lang | `<html lang="tr">`, `content-language`, `hreflang="tr-TR"` + `x-default` |
| Kelime sayısı | Toplam ~19.000 kelime özgün içerik |
| Yapısal veri | Organization/GeneralContractor, WebSite, WebPage, BreadcrumbList, Service, FAQPage, BlogPosting/NewsArticle, VideoObject, ItemList |
| Open Graph / Twitter | Her sayfa için başlık, açıklama, 1200×630 görsel |
| Sitemap | `sitemap.xml` (görsel uzantılı), `robots.txt`, `feed.xml` (RSS) |
| H1 | Her sayfada tam olarak 1 adet (build kontrol eder) |

> 404 sayfası bilerek `noindex, follow` olarak işaretlidir (hata sayfasının dizine girmemesi için).

## Yapay zeka chatbot (OpenAI)

Anahtar **asla** tarayıcıya gönderilmez; istek sunucudaki `api/chat.php` üzerinden geçer.

1. Hostingde `api/config.sample.php` dosyasını `api/config.php` olarak kopyalayın.
2. `'openai_api_key' => 'sk-...'` satırına anahtarı yazın (veya sunucuda `OPENAI_API_KEY` ortam değişkeni tanımlayın).
3. Anahtar yokken asistan yerel bilgi tabanıyla yanıt verir ve WhatsApp'a yönlendirir.

IP başına hız sınırı, aynı site kontrolü ve uydurma bilgi vermeme talimatı içerir. PHP 8.1+ ve cURL gerekir.

## İletişim formu

`api/contact.php` formu `cmshafriyat01@gmail.com` adresine e-posta olarak gönderir (PHP `mail()`).
Sunucu e-posta gönderemezse form kullanıcıyı otomatik olarak WhatsApp'a yönlendirir.

## Yayına alma (cPanel)

1. `npm run build`
2. `dist/` içindeki **tüm dosyaları** (gizli `.htaccess` dahil) `public_html/` klasörüne yükleyin.
3. SSL'i açın; `.htaccess` http→https ve www→www'suz yönlendirmesini yapar.
4. Google Search Console ve Bing Webmaster Tools'a siteyi ekleyip `sitemap.xml` gönderin.

## Alan adı

`src/site.config.mjs` içindeki `url` değeri şu an **`https://cmsharfiyat.com.tr`** (mesajda verilen adres).
Alan adınız farklıysa (ör. `cmshafriyat.com.tr`) yalnızca bu satırı değiştirip `npm run build` çalıştırın;
canonical, sitemap, OG ve schema adreslerinin hepsi güncellenir.

## İçerik ekleme

- **Blog/haber:** `src/content/posts/<slug>.mjs` (format: `src/content/CONTENT_SPEC.md`). Kapak için `python3 scripts/render_media.py --stills-only --covers`.
- **Gerçek projeler:** `src/content/projects.mjs` listesine ekleyin, fotoğrafları `src/static/assets/img/projeler/` içine koyun.
- **Sosyal medya:** `src/site.config.mjs` → `social` (schema `sameAs` ve footer'a eklenir).

## Backlink ve SEO büyüme planı

1. **Google İşletme Profili** açın/doğrulayın (Toros Mah. Çukurova/Adana adresi, telefon, site linki, sahadan fotoğraflar). Sitedeki adres ve `LocalBusiness` şeması ile birebir aynı yazılmalı.
2. **Yerel rehberler / NAP tutarlılığı:** Yandex Haritalar, Apple Business Connect, Bing Places, sektörel firma rehberleri — her yerde aynı unvan, telefon ve site adresi.
3. **Sektörel backlink:** iş birliği yapılan müteahhit, mimarlık ve hafriyat döküm sahası firmalarının "iş ortaklarımız" sayfalarında yer alma; ticaret/sanayi odası üyelik sayfası.
4. **İçerik takvimi:** ayda 2–4 rehber (ör. "Hafriyat maliyetini etkileyen faktörler", "Yıkım ve hafriyat farkı", "İstinat duvarı nedir"). Her yazı en az 1 hizmet sayfasına bağlam içi link versin.
5. **Video SEO:** sahadan gerçek videolar çekildiğinde YouTube'a yükleyip sayfalara gömün; `VideoObject` şeması hazır.
6. **Sosyal sinyaller:** Instagram/LinkedIn'de proje paylaşımları + siteye link.
7. Search Console'da aylık: tıklama/gösterim, dizine eklenmeyen sayfalar, Core Web Vitals.

## Klasör yapısı

```
src/
  site.config.mjs        genel ayarlar (alan adı, iletişim, menü)
  content/               hizmet ve blog içerikleri (.mjs)
  templates/             layout, bileşenler, sayfa şablonları, ikonlar
  styles/main.css        Tailwind + bileşen stilleri + animasyonlar
  static/                dist'e aynen kopyalanan dosyalar (JS, PHP API)
scripts/
  build.mjs              site üretici + SEO doğrulayıcı
  render_media.py        prosedürel video/görsel üretici
  make_logo.py           logo ve favicon üretici
dist/                    yayına hazır site
```

## Alt klasörde önizleme (ör. keremerginbas.tr/semsi)

```bash
npm run build && npm run build:preview   # dist-preview/ üretir
```

Önizleme sürümü tüm adreslere `/semsi` ön ekini ekler, Google'a kapalıdır (`noindex` + `robots.txt Disallow`)
ve alan adı yönlendirmesi yapmaz. Farklı klasör için `package.json` içindeki `SITE_URL` / `BASE_PATH` değerlerini değiştirin.
