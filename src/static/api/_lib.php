<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('X-Robots-Tag: noindex, nofollow');
header('Cache-Control: no-store');

function cfg(): array {
    static $c = null;
    if ($c === null) {
        $f = __DIR__ . '/config.php';
        $c = is_file($f) ? (require $f) : [];
        $c += [
            'openai_api_key' => getenv('OPENAI_API_KEY') ?: '',
            'openai_model' => 'gpt-4o-mini',
            'mail_to' => 'cmshafriyat01@gmail.com',
            'mail_from' => 'noreply@' . preg_replace('/^www\./', '', $_SERVER['HTTP_HOST'] ?? 'localhost'),
            'rate_limit' => 30,
        ];
    }
    return $c;
}

function out(int $code, array $data): never {
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function body(): array {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') out(405, ['ok' => false, 'error' => 'POST gerekli']);
    $raw = file_get_contents('php://input', false, null, 0, 32768) ?: '';
    $j = json_decode($raw, true);
    return is_array($j) ? $j : $_POST;
}

/** Aynı siteden gelmeyen istekleri reddet */
function same_origin(): void {
    $origin = $_SERVER['HTTP_ORIGIN'] ?? $_SERVER['HTTP_REFERER'] ?? '';
    $host = $_SERVER['HTTP_HOST'] ?? '';
    if ($origin !== '' && parse_url($origin, PHP_URL_HOST) !== $host) out(403, ['ok' => false, 'error' => 'izin yok']);
}

/** Basit dosya tabanlı hız sınırı (IP başına, 10 dk pencere) */
function rate_limit(string $bucket, int $max): void {
    $dir = __DIR__ . '/data';
    if (!is_dir($dir)) @mkdir($dir, 0700, true);
    $ip = hash('sha256', ($_SERVER['REMOTE_ADDR'] ?? '0') . $bucket);
    $f = "$dir/rl_$ip.json";
    $now = time();
    $hits = is_file($f) ? (json_decode((string)file_get_contents($f), true) ?: []) : [];
    $hits = array_values(array_filter($hits, fn($t) => $t > $now - 600));
    if (count($hits) >= $max) out(429, ['ok' => false, 'error' => 'Çok fazla istek. Lütfen biraz sonra tekrar deneyin.']);
    $hits[] = $now;
    @file_put_contents($f, json_encode($hits), LOCK_EX);
}
