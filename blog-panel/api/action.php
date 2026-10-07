<?php
declare(strict_types=1);
require dirname(__DIR__) . '/app/bootstrap.php';

use BlogPanel\App;
use BlogPanel\Auth;
use BlogPanel\DomainService;
use BlogPanel\JobService;
use BlogPanel\N8nClient;
use BlogPanel\Publisher\PublisherFactory;
use BlogPanel\Scheduler;
use BlogPanel\WhmClient;

Auth::require();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['ok' => false, 'error' => 'POST gerekli'], 405);
}
csrf_check();
session_write_close(); // uzun süren işlemler diğer sekmeleri kilitlemesin
set_time_limit(180);

$action = (string) ($_POST['action'] ?? '');
$id = (int) ($_POST['id'] ?? 0);
$domain = $id ? DomainService::find($id) : null;
if ($id && !$domain) {
    json_response(['ok' => false, 'error' => 'Domain bulunamadı'], 404);
}

try {
    switch ($action) {
        case 'trigger':
            $job = JobService::trigger($domain, 'manual');
            json_response(['ok' => true, 'message' => "İş #{$job['id']} başlatıldı. Yazı birkaç dakika içinde yayınlanacak.", 'reload' => true]);

        case 'toggle':
            if (!empty($_POST['value'])) {
                DomainService::activate($domain);
                $fresh = DomainService::find($id);
                json_response(['ok' => true, 'message' => "{$domain['domain']} aktif. İlk paylaşım: " . fmt_date($fresh['next_post_at'])]);
            }
            DomainService::deactivate($domain);
            json_response(['ok' => true, 'message' => "{$domain['domain']} pasif."]);

        case 'sync_whm':
            $r = DomainService::syncFromWhm();
            json_response(['ok' => true, 'message' => "WHM: {$r['total']} domain bulundu, {$r['added']} yeni eklendi (pasif).", 'reload' => true]);

        case 'test_whm':
            $version = WhmClient::fromSettings()->version();
            json_response(['ok' => true, 'message' => "WHM bağlantısı başarılı (sürüm $version)."]);

        case 'test_n8n':
            N8nClient::fromSettings()->ping();
            json_response(['ok' => true, 'message' => 'n8n webhook isteği kabul etti.']);

        case 'test_publisher':
            json_response(['ok' => true, 'message' => PublisherFactory::for($domain)->test($domain)]);

        case 'run_scheduler':
            $r = Scheduler::run();
            json_response(['ok' => true, 'message' => "Zamanlayıcı: {$r['triggered']} tetiklendi, {$r['failed']} hata, {$r['expired']} zaman aşımı.", 'reload' => true]);

        case 'reveal_secret':
            json_response(['ok' => true, 'message' => 'Gizli anahtar: ' . App::settings()->get('n8n_secret')]);

        default:
            json_response(['ok' => false, 'error' => 'Bilinmeyen işlem'], 400);
    }
} catch (Throwable $e) {
    json_response(['ok' => false, 'error' => $e->getMessage()], 422);
}
