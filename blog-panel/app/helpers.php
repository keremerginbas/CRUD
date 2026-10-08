<?php
declare(strict_types=1);

function e(?string $s): string
{
    return htmlspecialchars((string) $s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function slugify(string $text): string
{
    $map = ['ç' => 'c', 'Ç' => 'c', 'ğ' => 'g', 'Ğ' => 'g', 'ı' => 'i', 'I' => 'i', 'İ' => 'i', 'ö' => 'o', 'Ö' => 'o', 'ş' => 's', 'Ş' => 's', 'ü' => 'u', 'Ü' => 'u'];
    $text = strtr($text, $map);
    if (function_exists('transliterator_transliterate')) {
        $text = (string) transliterator_transliterate('Any-Latin; Latin-ASCII', $text);
    }
    $text = strtolower($text);
    $text = (string) preg_replace('/[^a-z0-9]+/', '-', $text);
    $text = trim($text, '-');
    if (strlen($text) > 80) {
        $text = rtrim(substr($text, 0, 80), '-');
        $text = substr($text, 0, (int) (strrpos($text, '-') ?: 80));
    }
    return $text !== '' ? $text : 'yazi-' . date('YmdHis');
}

function fmt_date(?string $dt): string
{
    return $dt ? date('d.m.Y H:i', strtotime($dt)) : '—';
}

function csrf_token(): string
{
    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf'];
}

function csrf_field(): string
{
    return '<input type="hidden" name="_csrf" value="' . e(csrf_token()) . '">';
}

function csrf_check(): void
{
    $sent = $_POST['_csrf'] ?? $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    if (!is_string($sent) || !hash_equals(csrf_token(), $sent)) {
        http_response_code(419);
        exit('Oturum doğrulaması başarısız (CSRF). Sayfayı yenileyip tekrar deneyin.');
    }
}

function flash(?string $type = null, ?string $msg = null): array
{
    if ($type !== null) {
        $_SESSION['flash'][] = ['type' => $type, 'msg' => $msg];
        return [];
    }
    $all = $_SESSION['flash'] ?? [];
    unset($_SESSION['flash']);
    return $all;
}

function redirect(string $to): never
{
    header('Location: ' . $to);
    exit;
}

function json_response(array $data, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function status_badge(string $status): string
{
    $labels = [
        'queued' => ['Sırada', 'muted'], 'triggered' => ['Üretiliyor', 'info'], 'published' => ['Yayınlandı', 'ok'],
        'failed' => ['Hata', 'err'], 'pending' => ['Bekliyor', 'muted'], 'publishing' => ['Yayınlanıyor', 'info'],
    ];
    [$label, $cls] = $labels[$status] ?? [$status, 'muted'];
    return '<span class="badge badge-' . $cls . '">' . e($label) . '</span>';
}

function seo_badge(int $score): string
{
    $cls = $score >= 80 ? 'ok' : ($score >= 60 ? 'warn' : 'err');
    return '<span class="badge badge-' . $cls . '">' . $score . '</span>';
}

/** Lucide ikonu (satır içi SVG). İkon listesi ui/scripts/icons.mjs ile app/icons.php'ye üretilir. */
function icon(string $name, string $class = ''): string
{
    static $icons = null;
    $icons ??= require __DIR__ . '/icons.php';
    return '<svg class="icon' . ($class !== '' ? ' ' . e($class) : '') . '" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
        . ($icons[$name] ?? '') . '</svg>';
}
