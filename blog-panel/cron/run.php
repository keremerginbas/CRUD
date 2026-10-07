<?php
declare(strict_types=1);

// cPanel cron (15 dakikada bir):  */15 * * * * /usr/local/bin/php /home/KULLANICI/blog-panel/cron/run.php
if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit;
}
require dirname(__DIR__) . '/app/bootstrap.php';

$lock = fopen(sys_get_temp_dir() . '/blog-panel-' . md5(APP_ROOT) . '.lock', 'c');
if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) {
    echo "Başka bir çalıştırma devam ediyor.\n";
    exit(0);
}

try {
    $r = BlogPanel\Scheduler::run();
    echo date('Y-m-d H:i:s') . " tetiklenen={$r['triggered']} hata={$r['failed']} zamanasimi={$r['expired']}\n";
    foreach ($r['messages'] as $m) {
        echo "  - $m\n";
    }
} catch (Throwable $e) {
    BlogPanel\Logger::error('cron', $e->getMessage());
    fwrite(STDERR, 'Hata: ' . $e->getMessage() . "\n");
    exit(1);
} finally {
    flock($lock, LOCK_UN);
}
