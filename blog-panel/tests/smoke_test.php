<?php
declare(strict_types=1);

/**
 * Uçtan uca duman testi (ağ gerektirmez):
 *   php tests/smoke_test.php
 * Geçici SQLite veritabanı + sahte n8n sunucusu + static_local yayın.
 */
$tmp = sys_get_temp_dir() . '/blogpanel-test-' . bin2hex(random_bytes(4));
mkdir($tmp . '/docroot', 0777, true);
putenv("BLOG_PANEL_CONFIG=$tmp/config.php");
$root = dirname(__DIR__);

function check(bool $cond, string $label): void
{
    echo ($cond ? "  ✓ " : "  ✗ ") . $label . "\n";
    if (!$cond) {
        exit(1);
    }
}

// 1) Kurulum
passthru(sprintf('php %s/install.php --driver=sqlite --path=%s --admin=admin --password=%s --base_url=%s',
    escapeshellarg($root), escapeshellarg("$tmp/db.sqlite"), escapeshellarg('cok-gizli-sifre'), escapeshellarg('http://panel.test')), $code);
check($code === 0 && is_file("$tmp/config.php"), 'install.php config ve tabloları oluşturdu');

require $root . '/app/bootstrap.php';

use BlogPanel\App;
use BlogPanel\Database;
use BlogPanel\DomainService;
use BlogPanel\JobService;
use BlogPanel\Publisher\StaticPublisher;
use BlogPanel\Scheduler;

// 2) Sahte n8n sunucusu: gelen isteği dosyaya yazar
file_put_contents("$tmp/n8n.php", '<?php file_put_contents(__DIR__ . "/n8n-last.json", json_encode(["secret" => $_SERVER["HTTP_X_BLOG_PANEL_SECRET"] ?? "", "body" => json_decode(file_get_contents("php://input"), true)])); echo "{\"message\":\"Workflow was started\"}";');
$port = random_int(20000, 40000);
$server = proc_open(['php', '-S', "127.0.0.1:$port", "$tmp/n8n.php"], [1 => ['file', '/dev/null', 'w'], 2 => ['file', '/dev/null', 'w']], $pipes);
usleep(400000);

$s = App::settings();
$s->set('n8n_webhook_url', "http://127.0.0.1:$port/webhook/blog-panel-generate");
check(strlen($s->get('n8n_secret')) === 48, 'n8n gizli anahtarı üretildi ve şifreli saklanıyor');
check(in_array(substr((string) App::db()->value("SELECT value FROM settings WHERE name='n8n_secret'"), 0, 4), ['enc:', 'gcm:'], true), 'gizli anahtar veritabanında şifreli');

// 3) Domain ekle ve aktifleştir
$now = Database::now();
$id = App::db()->insert('domains', [
    'domain' => 'ornek-tekstil.com', 'docroot' => "$tmp/docroot", 'publish_method' => 'static_local', 'niche' => 'Otel tekstili',
    'language' => 'tr', 'post_interval_days' => 3, 'publish_hour' => 10, 'created_at' => $now, 'updated_at' => $now,
]);
DomainService::activate(DomainService::find($id));
$d = DomainService::find($id);
check((int) $d['is_active'] === 1 && strtotime($d['next_post_at']) > time(), 'domain aktif, ilk paylaşım ileri tarihe planlandı: ' . $d['next_post_at']);

// 4) Vakti gelmiş gibi yapıp zamanlayıcıyı çalıştır
App::db()->update('domains', ['next_post_at' => date('Y-m-d H:i:s', time() - 60)], 'id = :id', ['id' => $id]);
$r = Scheduler::run();
check($r['triggered'] === 1, 'zamanlayıcı 1 iş tetikledi');
$sent = json_decode((string) file_get_contents("$tmp/n8n-last.json"), true);
check($sent['secret'] === $s->get('n8n_secret'), 'n8n isteğinde X-Blog-Panel-Secret başlığı doğru');
check($sent['body']['domain']['domain'] === 'ornek-tekstil.com' && $sent['body']['callback_url'] === 'http://panel.test/api/callback.php', 'payload domain ve callback adresini içeriyor');
$r2 = Scheduler::run();
check($r2['triggered'] === 0, 'açık iş varken aynı domain tekrar tetiklenmiyor');

// 5) n8n'in döndüreceği makaleyi simüle et
$para = str_repeat('Otel nevresim takımı seçerken kumaş gramajı, iplik sayısı ve yıkama dayanımı birlikte değerlendirilmelidir. ', 12);
$article = [
    'title' => 'Otel Nevresim Takımı Seçerken Dikkat Edilmesi Gereken 7 Nokta',
    'slug' => 'otel-nevresim-takimi-secimi',
    'meta_title' => 'Otel Nevresim Takımı Seçimi: 7 Kritik Nokta (2026 Rehberi)',
    'meta_description' => 'Otel nevresim takımı seçerken kumaş, iplik sayısı, dayanıklılık ve maliyeti nasıl değerlendirirsiniz? Uzman rehberimizle doğru tercihi hemen yapın.',
    'focus_keyword' => 'otel nevresim takımı',
    'secondary_keywords' => ['otel tekstili', 'pamuklu saten'],
    'excerpt' => 'Doğru otel nevresim takımı misafir memnuniyetini ve çamaşırhane maliyetini doğrudan etkiler.',
    'content_html' => "<p>Doğru otel nevresim takımı, misafir deneyiminin temelidir. $para</p><h2>Kumaş türü</h2><p>$para</p><script>alert(1)</script>"
        . "<h2>İplik sayısı</h2><p onclick=\"x()\">$para</p><h2>Dayanıklılık</h2><p>$para <a href=\"javascript:alert(1)\">kötü</a> <a href=\"https://ornek-tekstil.com/iletisim\">iletişim</a></p>",
    'faq' => [
        ['question' => 'Soru 1?', 'answer' => 'Cevap 1.'], ['question' => 'Soru 2?', 'answer' => 'Cevap 2.'], ['question' => 'Soru 3?', 'answer' => 'Cevap 3.'],
    ],
    'tags' => ['otel tekstili', 'nevresim'],
];
$res = JobService::handleCallback(['job_id' => $sent['body']['job_id'], 'token' => $sent['body']['token'], 'status' => 'success', 'article' => $article]);
check($res['ok'] === true, 'callback işlendi, yazı yayınlandı: ' . ($res['url'] ?? $res['message'] ?? ''));
check($res['url'] === 'https://ornek-tekstil.com/blog/otel-nevresim-takimi-secimi', 'statik yazı URL\'si doğru');
echo "    SEO puanı: {$res['seo_score']}\n";

$html = (string) file_get_contents("$tmp/docroot/blog/otel-nevresim-takimi-secimi.html");
check($html !== '' && str_contains($html, '<link rel="canonical" href="https://ornek-tekstil.com/blog/otel-nevresim-takimi-secimi">'), 'yazı sayfası canonical etiketiyle oluşturuldu');
check(str_contains($html, '"@type":"FAQPage"') && str_contains($html, '"@type":"BlogPosting"'), 'JSON-LD (BlogPosting + FAQPage) mevcut');
check(!str_contains($html, 'alert(1)') && !str_contains($html, 'onclick'), 'zararlı HTML temizlendi');
check(str_contains((string) file_get_contents("$tmp/docroot/blog/sitemap.xml"), '<loc>https://ornek-tekstil.com/blog/otel-nevresim-takimi-secimi</loc>'), 'sitemap.xml güncellendi');
check(str_contains((string) file_get_contents("$tmp/docroot/blog/index.html"), 'Otel Nevresim Takımı Seçerken'), 'blog/index.html güncellendi');
check(is_file("$tmp/docroot/blog/feed.xml") && is_file("$tmp/docroot/blog/.htaccess"), 'feed.xml ve .htaccess yazıldı');

$d = DomainService::find($id);
$expectedDay = date('Y-m-d', strtotime('+3 days'));
check(str_starts_with((string) $d['next_post_at'], $expectedDay), "sonraki paylaşım 3 gün sonraya planlandı ({$d['next_post_at']})");

// 6) Aynı callback tekrar gelirse (n8n retry) ikinci yazı oluşmamalı
try {
    JobService::handleCallback(['job_id' => $sent['body']['job_id'], 'token' => $sent['body']['token'], 'status' => 'success', 'article' => $article]);
    check(false, 'tekrar eden callback reddedildi');
} catch (BlogPanel\CallbackException $e) {
    check($e->getCode() === 409, 'tekrar eden callback 409 ile reddedildi');
}

// 7) Hata akışı: AI hatası -> iş başarısız, kısa süre sonra tekrar denenir
App::db()->update('domains', ['next_post_at' => date('Y-m-d H:i:s', time() - 60)], 'id = :id', ['id' => $id]);
Scheduler::run();
$sent = json_decode((string) file_get_contents("$tmp/n8n-last.json"), true);
$res = JobService::handleCallback(['job_id' => $sent['body']['job_id'], 'token' => $sent['body']['token'], 'status' => 'error', 'error' => 'Claude overloaded']);
$d = DomainService::find($id);
check($res['ok'] === false && (int) $d['fail_count'] === 1 && strtotime($d['next_post_at']) < time() + 3 * 3600, 'AI hatasında iş başarısız sayıldı ve 2 saat içinde tekrar denenecek');
check(in_array('Otel Nevresim Takımı Seçerken Dikkat Edilmesi Gereken 7 Nokta', $sent['body']['recent_titles'], true), 'sonraki istekte önceki başlıklar AI\'ya gönderiliyor (tekrar önleme)');

// 8) Slug tekrarında benzersiz slug
App::db()->update('domains', ['next_post_at' => date('Y-m-d H:i:s', time() - 60)], 'id = :id', ['id' => $id]);
Scheduler::run();
$sent = json_decode((string) file_get_contents("$tmp/n8n-last.json"), true);
$res = JobService::handleCallback(['job_id' => $sent['body']['job_id'], 'token' => $sent['body']['token'], 'status' => 'success', 'article' => $article]);
check(str_ends_with($res['url'], 'otel-nevresim-takimi-secimi-2'), 'aynı slug gelince -2 eklendi');
check(substr_count((string) file_get_contents("$tmp/docroot/blog/sitemap.xml"), '<url>') === 3, 'sitemap 2 yazı + blog ana sayfasını içeriyor');

// 9) Mevcut (panel dışı) blog klasörü korunmalı
mkdir("$tmp/docroot2/blog", 0777, true);
file_put_contents("$tmp/docroot2/blog/index.html", '<html>eski blog</html>');
$id2 = App::db()->insert('domains', [
    'domain' => 'eski-blog.com', 'docroot' => "$tmp/docroot2", 'publish_method' => 'static_local', 'static_dir' => 'blog',
    'language' => 'tr', 'post_interval_days' => 3, 'publish_hour' => 10, 'created_at' => $now, 'updated_at' => $now,
]);
$d2 = DomainService::find($id2);
try {
    BlogPanel\Publisher\PublisherFactory::for($d2)->test($d2);
    check(false, 'mevcut blog klasöründe test reddedildi');
} catch (RuntimeException $e) {
    check(str_contains($e->getMessage(), 'index.html') && !is_file("$tmp/docroot2/blog/.blogpanel-test.txt"), 'mevcut blog klasöründe test hiçbir şey yazmadan uyardı');
}
App::db()->update('domains', ['next_post_at' => date('Y-m-d H:i:s', time() - 60), 'is_active' => 1], 'id = :id', ['id' => $id2]);
App::db()->update('domains', ['is_active' => 0], 'id = :id', ['id' => $id]);
Scheduler::run();
$sent = json_decode((string) file_get_contents("$tmp/n8n-last.json"), true);
$res = JobService::handleCallback(['job_id' => $sent['body']['job_id'], 'token' => $sent['body']['token'], 'status' => 'success', 'article' => $article]);
check($res['ok'] === false && file_get_contents("$tmp/docroot2/blog/index.html") === '<html>eski blog</html>' && count(glob("$tmp/docroot2/blog/*")) === 1, 'yayın da reddedildi, eski blog dosyaları olduğu gibi duruyor');
App::db()->update('domains', ['static_dir' => 'makaleler'], 'id = :id', ['id' => $id2]);
$d2 = DomainService::find($id2);
check(str_contains(BlogPanel\Publisher\PublisherFactory::for($d2)->test($d2), 'makaleler'), 'farklı klasörde (makaleler) yazma testi geçti');
check(str_contains((string) file_get_contents("$tmp/docroot/blog/index.html"), StaticPublisher::MARKER), 'panelin ürettiği dosyalar işaretli (sonraki yayınlarda üzerine yazılabilir)');

// 10) Site şablonu: yazı sitenin kendi tasarımıyla /blog/ altına, kart rehber.html'e
$root3 = "$tmp/docroot3";
mkdir("$root3/blog", 0777, true);
file_put_contents("$root3/blog/llm-bilgi-tabani-rag.html", '<html>mevcut yazı</html>');
file_put_contents("$root3/blog/_sablon-yazi.html", "<!doctype html><html lang=\"tr\"><head><title>{{meta_title}}</title><meta name=\"description\" content=\"{{meta_description}}\"><link rel=\"canonical\" href=\"{{url}}\">{{jsonld}}</head>"
    . "<body><header class=\"site-header\">XRE MENÜ</header><article><h1>{{title}}</h1><time datetime=\"{{date_iso}}\">{{date_long}}</time>{{content}}{{faq}}</article><footer>XRE FOOTER</footer></body></html>");
file_put_contents("$root3/blog/_sablon-kart.html", '<article class="article-card"><a href="{{relative_url}}">{{title}}</a><p>{{excerpt}}</p></article>');
$rehber = "<html><body><div class=\"articles-grid\">\n<!-- blog-panel:liste -->\n<article class=\"article-card\"><a href=\"blog/llm-bilgi-tabani-rag.html\">LLM</a></article></div></body></html>";
file_put_contents("$root3/rehber.html", $rehber);
file_put_contents("$root3/sitemap.xml", "<?xml version=\"1.0\"?>\n<urlset>\n  <url><loc>https://site3.com/</loc></url>\n</urlset>\n");
file_put_contents("$root3/rss.xml", "<?xml version=\"1.0\"?><rss><channel><title>x</title><item><title>eski</title></item></channel></rss>");
BlogPanel\Schema::migrate(App::db());
BlogPanel\Schema::migrate(App::db());
$id3 = App::db()->insert('domains', [
    'domain' => 'site3.com', 'docroot' => $root3, 'publish_method' => 'static_local', 'static_dir' => 'blog', 'list_page' => 'rehber.html',
    'language' => 'tr', 'post_interval_days' => 3, 'publish_hour' => 10, 'created_at' => $now, 'updated_at' => $now,
]);
$d3 = DomainService::find($id3);
check(str_contains(BlogPanel\Publisher\PublisherFactory::for($d3)->test($d3), 'liste sayfası hazır'), 'site şablonu ve liste sayfası testte tanındı');
App::db()->update('domains', ['is_active' => 0], 'id = :id', ['id' => $id2]);
App::db()->update('domains', ['next_post_at' => date('Y-m-d H:i:s', time() - 60), 'is_active' => 1], 'id = :id', ['id' => $id3]);
Scheduler::run();
$sent = json_decode((string) file_get_contents("$tmp/n8n-last.json"), true);
$res = JobService::handleCallback(['job_id' => $sent['body']['job_id'], 'token' => $sent['body']['token'], 'status' => 'success', 'article' => $article]);
check($res['ok'] === true && $res['url'] === 'https://site3.com/blog/otel-nevresim-takimi-secimi.html', 'yazı sitenin /blog/ klasörüne .html olarak yayınlandı');
$page = (string) file_get_contents("$root3/blog/otel-nevresim-takimi-secimi.html");
check(str_contains($page, 'XRE MENÜ') && str_contains($page, 'XRE FOOTER') && str_contains($page, '<h1>Otel Nevresim Takımı Seçerken') && preg_match('~<time datetime="\\d{4}-\\d{2}-\\d{2}T[^"]+">\\d{1,2} \\p{L}+ \\d{4}</time>~u', $page), 'sayfa sitenin şablonuyla (menü/footer) üretildi, Türkçe karakterler sağlam');
check(str_contains($page, '"@type":"BlogPosting"') && str_contains($page, 'href="https://site3.com/blog/otel-nevresim-takimi-secimi.html"') && str_contains($page, StaticPublisher::MARKER) && !str_contains($page, '{{'), 'canonical, JSON-LD ve işaret eklendi; boş yer tutucu kalmadı');
$reh = (string) file_get_contents("$root3/rehber.html");
check(strpos($reh, 'otel-nevresim-takimi-secimi.html') > strpos($reh, '<!-- blog-panel:liste -->') && strpos($reh, 'otel-nevresim') < strpos($reh, 'llm-bilgi-tabani-rag'), 'rehber.html listesine yeni kart en üste eklendi, eski kartlar duruyor');
check(file_get_contents("$root3/blog/llm-bilgi-tabani-rag.html") === '<html>mevcut yazı</html>' && !is_file("$root3/blog/index.html") && !is_file("$root3/blog/.htaccess"), 'sitenin mevcut blog dosyalarına dokunulmadı');
check(substr_count((string) file_get_contents("$root3/sitemap.xml"), 'otel-nevresim-takimi-secimi.html') === 1 && str_contains((string) file_get_contents("$root3/rss.xml"), '<title>Otel Nevresim'), 'sitemap.xml ve rss.xml güncellendi');
file_put_contents("$root3/rehber.html", str_replace('<!-- blog-panel:liste -->', '', $reh));
App::db()->update('domains', ['next_post_at' => date('Y-m-d H:i:s', time() - 60)], 'id = :id', ['id' => $id3]);
Scheduler::run();
$sent = json_decode((string) file_get_contents("$tmp/n8n-last.json"), true);
$before = glob("$root3/blog/*");
$res = JobService::handleCallback(['job_id' => $sent['body']['job_id'], 'token' => $sent['body']['token'], 'status' => 'success', 'article' => ['title' => 'Başka yazı'] + $article]);
check($res['ok'] === false && str_contains($res['message'], 'blog-panel:liste') && glob("$root3/blog/*") === $before, 'liste işareti silinirse yazı yayınlanmadı, hiçbir dosya yazılmadı');

proc_terminate($server);
echo "\nTüm testler başarılı. (geçici klasör: $tmp)\n";
