<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, max-age=0');

function jsonOut(array $payload, int $status = 200): never {
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function configPath(): ?string {
    $documentRoot = isset($_SERVER['DOCUMENT_ROOT']) ? rtrim((string)$_SERVER['DOCUMENT_ROOT'], '/\\') : '';
    $candidates = array_filter([
        // Plesk yapısı: /var/www/vhosts/domain/private/bitrix-config.php
        dirname(__DIR__, 3) . '/private/bitrix-config.php',
        $documentRoot !== '' ? dirname($documentRoot) . '/private/bitrix-config.php' : null,
        // Alternatif yerleşimler için geri uyumluluk
        dirname(__DIR__, 2) . '/private/bitrix-config.php',
        dirname(__DIR__) . '/../private/bitrix-config.php',
        dirname(__DIR__) . '/private/bitrix-config.php',
    ]);
    foreach ($candidates as $path) {
        if (is_file($path)) return $path;
    }
    return null;
}

$cfgPath = configPath();
if (!$cfgPath) {
    jsonOut([
        'ok' => false,
        'error' => 'Bitrix sunucu yapılandırması bulunamadı.',
        'hint' => 'bitrix-config.example.php dosyasını Plesk private klasörüne bitrix-config.php adıyla ekleyin.',
    ], 500);
}

$cfg = require $cfgPath;
if (!is_array($cfg) || empty($cfg['webhook_base'])) {
    jsonOut(['ok' => false, 'error' => 'webhook_base yapılandırılmamış.'], 500);
}

$base = rtrim((string)$cfg['webhook_base'], '/') . '/';
if (!preg_match('~^https://[^/]+/rest/\d+/[^/]+/$~i', $base)) {
    jsonOut(['ok' => false, 'error' => 'webhook_base biçimi geçersiz.'], 500);
}

date_default_timezone_set((string)($cfg['timezone'] ?? 'Europe/Istanbul'));

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$allowed = $cfg['allowed_origins'] ?? [];
if ($origin !== '' && in_array($origin, $allowed, true)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
}
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    header('Access-Control-Allow-Methods: GET, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
    http_response_code(204);
    exit;
}

function bitrixCall(string $base, string $method, array $params = []): array {
    $url = $base . $method . '.json';
    $ch = curl_init($url);
    if ($ch === false) throw new RuntimeException('cURL başlatılamadı.');
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => http_build_query($params),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 12,
        CURLOPT_TIMEOUT => 45,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS => 3,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_HTTPHEADER => ['Accept: application/json'],
    ]);
    $raw = curl_exec($ch);
    $errno = curl_errno($ch);
    $error = curl_error($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);

    if ($errno !== 0 || $raw === false) {
        throw new RuntimeException('Bitrix bağlantı hatası: ' . $error);
    }
    $data = json_decode($raw, true);
    if (!is_array($data)) {
        throw new RuntimeException('Bitrix geçersiz JSON döndürdü. HTTP ' . $status);
    }
    if (isset($data['error'])) {
        throw new RuntimeException(($data['error'] ?? 'BITRIX_ERROR') . ': ' . ($data['error_description'] ?? 'Bilinmeyen Bitrix hatası'));
    }
    return $data;
}

function batchCall(string $base, array $commands): array {
    if (!$commands) return [];
    $out = [];
    foreach (array_chunk($commands, 50, true) as $chunk) {
        $data = bitrixCall($base, 'batch', ['halt' => 0, 'cmd' => $chunk]);
        $result = $data['result']['result'] ?? [];
        $errors = $data['result']['result_error'] ?? [];
        foreach ($chunk as $key => $_) {
            $out[$key] = $result[$key] ?? null;
            if (isset($errors[$key])) $out[$key] = null;
        }
    }
    return $out;
}

function parseBitrixDate(?string $value): ?DateTimeImmutable {
    $value = trim((string)$value);
    if ($value === '' || str_starts_with($value, '0000') || str_starts_with($value, '9999')) return null;
    try { return new DateTimeImmutable($value); } catch (Throwable) { return null; }
}

function deadlineGroup(?DateTimeImmutable $deadline, bool $completed, DateTimeImmutable $now): string {
    if ($completed) return 'Tamamlandı';
    if (!$deadline) return 'Planlanan Tarihi Boş';

    $todayStart = $now->setTime(0, 0, 0);
    $todayEnd = $todayStart->modify('+1 day');
    $weekStart = $todayStart->modify('monday this week');
    $weekEnd = $weekStart->modify('+7 days');
    $nextWeekEnd = $weekEnd->modify('+7 days');

    if ($deadline < $now) {
        return $deadline >= $todayStart ? 'Gün İçi Unutulan' : 'Geciken';
    }
    if ($deadline < $todayEnd) return 'Son Tarihi Bugün';
    if ($deadline < $weekEnd) return 'Son Tarihi Bu Hafta';
    if ($deadline < $nextWeekEnd) return 'Gelecek Hafta';
    return 'İki Haftadan Sonra';
}

function activityType(array $a): string {
    $provider = strtoupper((string)($a['PROVIDER_ID'] ?? ''));
    $providerType = strtoupper((string)($a['PROVIDER_TYPE_ID'] ?? ''));
    $typeId = (int)($a['TYPE_ID'] ?? 0);
    if (str_contains($provider, 'WHATSAPP') || str_contains($providerType, 'WHATSAPP')) return 'WhatsApp Mesajı';
    if ($typeId === 2 || str_contains($provider, 'CALL')) return 'Arama';
    if ($typeId === 4 || str_contains($provider, 'EMAIL')) return 'E-Posta';
    if ($typeId === 3 || str_contains($provider, 'MEETING')) return 'Toplantı / Yüz Yüze';
    return 'Evrensel Görev (Todo)';
}

function cacheFile(array $cfg, string $key): string {
    $dir = sys_get_temp_dir() . '/xre-bitrix-live';
    if (!is_dir($dir)) @mkdir($dir, 0770, true);
    return $dir . '/' . hash('sha256', $key) . '.json';
}

$action = strtolower((string)($_GET['action'] ?? 'activities'));

try {
    if ($action === 'status') {
        $profile = bitrixCall($base, 'profile');
        jsonOut([
            'ok' => true,
            'configured' => true,
            'php_curl' => function_exists('curl_init'),
            'bitrix_user' => $profile['result'] ?? null,
            'time' => (new DateTimeImmutable())->format(DATE_ATOM),
        ]);
    }

    $scope = strtolower((string)($_GET['scope'] ?? 'open'));
    if (!in_array($scope, ['open', 'all', 'completed'], true)) $scope = 'open';
    $responsibleId = trim((string)($_GET['responsible_id'] ?? ''));
    $force = ($_GET['force'] ?? '') === '1';
    $requestedPages = isset($_GET['max_pages']) ? (int)$_GET['max_pages'] : (int)($cfg['max_activity_pages'] ?? 50);
    $maxPages = max(1, min($requestedPages, 200));
    $resolveNames = ($_GET['resolve_names'] ?? '1') !== '0';

    $cacheKey = json_encode([$scope, $responsibleId, $maxPages], JSON_UNESCAPED_SLASHES);
    $cache = cacheFile($cfg, (string)$cacheKey);
    $cacheSeconds = max(0, (int)($cfg['cache_seconds'] ?? 120));
    if (!$force && $cacheSeconds > 0 && is_file($cache) && (time() - filemtime($cache)) < $cacheSeconds) {
        $cached = file_get_contents($cache);
        if ($cached !== false) {
            header('X-XRE-Cache: HIT');
            echo $cached;
            exit;
        }
    }

    $filter = ['OWNER_TYPE_ID' => 1]; // Lead etkinlikleri
    if ($scope === 'open') $filter['COMPLETED'] = 'N';
    if ($scope === 'completed') $filter['COMPLETED'] = 'Y';
    if ($responsibleId !== '') $filter['RESPONSIBLE_ID'] = $responsibleId;

    $select = [
        'ID','OWNER_ID','OWNER_TYPE_ID','TYPE_ID','PROVIDER_ID','PROVIDER_TYPE_ID',
        'SUBJECT','DESCRIPTION','CREATED','START_TIME','END_TIME','DEADLINE',
        'COMPLETED','STATUS','RESPONSIBLE_ID','DIRECTION','AUTHOR_ID','EDITOR_ID'
    ];

    $activities = [];
    $start = 0;
    $truncated = false;
    for ($page = 0; $page < $maxPages; $page++) {
        $res = bitrixCall($base, 'crm.activity.list', [
            'order' => ['ID' => 'DESC'],
            'filter' => $filter,
            'select' => $select,
            'start' => $start,
        ]);
        $rows = $res['result'] ?? [];
        if (!is_array($rows)) $rows = [];
        foreach ($rows as $row) if (is_array($row)) $activities[] = $row;
        if (!isset($res['next'])) break;
        $start = (int)$res['next'];
        if ($page === $maxPages - 1) $truncated = true;
    }

    $userIds = [];
    $leadIds = [];
    foreach ($activities as $a) {
        if (!empty($a['RESPONSIBLE_ID'])) $userIds[(string)$a['RESPONSIBLE_ID']] = true;
        if (!empty($a['OWNER_ID'])) $leadIds[(string)$a['OWNER_ID']] = true;
    }

    $users = [];
    $leads = [];
    if ($resolveNames) {
        $userCommands = [];
        foreach (array_keys($userIds) as $id) $userCommands['u' . $id] = 'user.get?ID=' . rawurlencode((string)$id);
        $userResults = batchCall($base, $userCommands);
        foreach ($userResults as $key => $value) {
            $id = substr((string)$key, 1);
            $row = is_array($value) && isset($value[0]) ? $value[0] : null;
            if (is_array($row)) {
                $name = trim((string)($row['NAME'] ?? '') . ' ' . (string)($row['LAST_NAME'] ?? ''));
                $users[$id] = $name !== '' ? $name : ('Kullanıcı #' . $id);
            }
        }

        $maxLeadLookups = max(0, min((int)($cfg['max_lead_lookups'] ?? 500), 2000));
        $leadIds = array_slice(array_keys($leadIds), 0, $maxLeadLookups);
        $leadCommands = [];
        foreach ($leadIds as $id) $leadCommands['l' . $id] = 'crm.lead.get?id=' . rawurlencode((string)$id);
        $leadResults = batchCall($base, $leadCommands);
        foreach ($leadResults as $key => $value) {
            $id = substr((string)$key, 1);
            if (is_array($value)) $leads[$id] = (string)($value['TITLE'] ?? ('Lead #' . $id));
        }
    }

    $now = new DateTimeImmutable();
    $items = [];
    $counts = [
        'total' => 0, 'completed' => 0, 'waiting' => 0, 'overdue' => 0,
        'today' => 0, 'this_week' => 0, 'next_week' => 0,
        'after_two_weeks' => 0, 'empty_deadline' => 0, 'forgotten_today' => 0,
    ];

    foreach ($activities as $a) {
        $completed = strtoupper((string)($a['COMPLETED'] ?? 'N')) === 'Y';
        $deadline = parseBitrixDate($a['DEADLINE'] ?? null);
        $created = parseBitrixDate($a['CREATED'] ?? null);
        $group = deadlineGroup($deadline, $completed, $now);
        $leadId = (string)($a['OWNER_ID'] ?? '');
        $responsible = (string)($a['RESPONSIBLE_ID'] ?? '');

        $counts['total']++;
        if ($completed) $counts['completed']++; else $counts['waiting']++;
        if ($group === 'Geciken') $counts['overdue']++;
        elseif ($group === 'Gün İçi Unutulan') { $counts['forgotten_today']++; $counts['today']++; }
        elseif ($group === 'Son Tarihi Bugün') $counts['today']++;
        elseif ($group === 'Son Tarihi Bu Hafta') $counts['this_week']++;
        elseif ($group === 'Gelecek Hafta') $counts['next_week']++;
        elseif ($group === 'İki Haftadan Sonra') $counts['after_two_weeks']++;
        elseif ($group === 'Planlanan Tarihi Boş') $counts['empty_deadline']++;

        $items[] = [
            'id' => (string)($a['ID'] ?? ''),
            'lead_id' => $leadId,
            'lead_title' => $leads[$leadId] ?? ('Lead #' . $leadId),
            'responsible_id' => $responsible,
            'responsible_name' => $users[$responsible] ?? ('Kullanıcı #' . $responsible),
            'type' => activityType($a),
            'type_id' => (string)($a['TYPE_ID'] ?? ''),
            'provider_id' => (string)($a['PROVIDER_ID'] ?? ''),
            'subject' => (string)($a['SUBJECT'] ?? ''),
            'description' => (string)($a['DESCRIPTION'] ?? ''),
            'created_at' => $created?->format(DATE_ATOM),
            'deadline' => $deadline?->format(DATE_ATOM),
            'completed' => $completed,
            'status' => $completed ? 'Tamamlandı' : 'Bekliyor',
            'deadline_group' => $group,
            'crm_url' => $leadId !== '' ? 'https://xre.bitrix24.com.tr/crm/lead/details/' . rawurlencode((string)$leadId) . '/' : null,
        ];
    }

    $payload = [
        'ok' => true,
        'source' => 'bitrix-live',
        'scope' => $scope,
        'generated_at' => $now->format(DATE_ATOM),
        'truncated' => $truncated,
        'counts' => $counts,
        'items' => $items,
        'meta' => [
            'activity_count' => count($activities),
            'lead_names_resolved' => count($leads),
            'user_names_resolved' => count($users),
            'max_pages' => $maxPages,
            'resolve_names' => $resolveNames,
        ],
    ];

    $encoded = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($encoded === false) throw new RuntimeException('JSON oluşturulamadı.');
    @file_put_contents($cache, $encoded, LOCK_EX);
    header('X-XRE-Cache: MISS');
    echo $encoded;
} catch (Throwable $e) {
    jsonOut([
        'ok' => false,
        'error' => $e->getMessage(),
        'time' => (new DateTimeImmutable())->format(DATE_ATOM),
    ], 502);
}