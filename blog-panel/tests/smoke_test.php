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

proc_terminate($server);
echo "\nTüm testler başarılı. (geçici klasör: $tmp)\n";
