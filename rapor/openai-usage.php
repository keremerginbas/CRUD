<?php
declare(strict_types=1);

/*
 * XRE OpenAI Usage Proxy
 * - Admin API anahtarını tarayıcıya göndermez.
 * - Organization Costs ve Usage API verilerini toplar.
 * - PHP 7.4+ / cURL gerektirir.
 */

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');

function respond(int $status, array $payload): void {
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    respond(405, ['ok' => false, 'error' => 'Yalnızca GET istekleri desteklenir.']);
}

$configCandidates = [
    dirname(__DIR__, 2) . '/private/openai-config.php',
    __DIR__ . '/openai-config.php',
];

$config = null;
$configPath = null;
foreach ($configCandidates as $candidate) {
    if (is_file($candidate)) {
        $loaded = require $candidate;
        if (is_array($loaded)) {
            $config = $loaded;
            $configPath = $candidate;
            break;
        }
    }
}

if (!is_array($config)) {
    respond(500, [
        'ok' => false,
        'error' => 'OpenAI sunucu yapılandırması bulunamadı.',
        'hint' => 'openai-config.example.php dosyasını Plesk private klasörüne openai-config.php adıyla ekleyin.',
    ]);
}

$timezone = (string)($config['timezone'] ?? 'Europe/Istanbul');
try {
    $tz = new DateTimeZone($timezone);
} catch (Throwable $e) {
    $tz = new DateTimeZone('Europe/Istanbul');
    $timezone = 'Europe/Istanbul';
}
date_default_timezone_set($timezone);

$allowedOrigins = $config['allowed_origins'] ?? [];
$origin = (string)($_SERVER['HTTP_ORIGIN'] ?? '');
if ($origin !== '' && is_array($allowedOrigins) && count($allowedOrigins) > 0) {
    $normalized = rtrim($origin, '/');
    $allowed = array_map(static function ($v) {
        return rtrim((string)$v, '/');
    }, $allowedOrigins);
    if (!in_array($normalized, $allowed, true)) {
        respond(403, ['ok' => false, 'error' => 'Bu origin için erişim izni yok.']);
    }
}

$adminKey = trim((string)($config['openai_admin_key'] ?? ''));
$configured = $adminKey !== '' && strpos($adminKey, 'REPLACE_') === false && strpos($adminKey, 'PASTE_') === false;

if (($_GET['action'] ?? '') === 'status') {
    respond(200, [
        'ok' => true,
        'configured' => $configured,
        'config_location' => $configPath ? basename(dirname($configPath)) . '/' . basename($configPath) : null,
        'php_curl' => function_exists('curl_init'),
    ]);
}

if (!$configured) {
    respond(500, [
        'ok' => false,
        'error' => 'OpenAI Admin API anahtarı sunucuda tanımlı değil.',
        'hint' => 'private/openai-config.php içindeki openai_admin_key alanına yeni Admin Key ekleyin.',
    ]);
}

if (!function_exists('curl_init')) {
    respond(500, [
        'ok' => false,
        'error' => 'Sunucuda PHP cURL eklentisi etkin değil.',
        'hint' => 'Plesk PHP Extensions bölümünden curl eklentisini etkinleştirin.',
    ]);
}

function parseYmd(string $value, DateTimeZone $tz): ?DateTimeImmutable {
    $dt = DateTimeImmutable::createFromFormat('!Y-m-d', $value, $tz);
    $errors = DateTimeImmutable::getLastErrors();
    if ($dt === false) {
        return null;
    }
    if (is_array($errors) && (($errors['warning_count'] ?? 0) > 0 || ($errors['error_count'] ?? 0) > 0)) {
        return null;
    }
    return $dt;
}

$today = new DateTimeImmutable('today', $tz);
$defaultStart = $today->modify('first day of this month');
$startDate = parseYmd((string)($_GET['start'] ?? ''), $tz) ?? $defaultStart;
$endInclusive = parseYmd((string)($_GET['end'] ?? ''), $tz) ?? $today;

if ($startDate > $endInclusive) {
    respond(422, ['ok' => false, 'error' => 'Başlangıç tarihi bitiş tarihinden sonra olamaz.']);
}

$maxRangeDays = max(1, min(730, (int)($config['max_range_days'] ?? 366)));
$days = (int)$startDate->diff($endInclusive)->format('%a') + 1;
if ($days > $maxRangeDays) {
    respond(422, [
        'ok' => false,
        'error' => 'Tarih aralığı çok uzun.',
        'hint' => 'En fazla ' . $maxRangeDays . ' günlük aralık seçebilirsiniz.',
    ]);
}

$endExclusive = $endInclusive->modify('+1 day');
$startTs = $startDate->getTimestamp();
$endTs = $endExclusive->getTimestamp();

function buildQuery(array $params): string {
    $parts = [];
    foreach ($params as $key => $value) {
        if ($value === null || $value === '') {
            continue;
        }
        if (is_array($value)) {
            foreach ($value as $item) {
                $parts[] = rawurlencode((string)$key) . '[]=' . rawurlencode((string)$item);
            }
        } else {
            $parts[] = rawurlencode((string)$key) . '=' . rawurlencode((string)$value);
        }
    }
    return implode('&', $parts);
}

function openAIGet(string $path, array $params, string $adminKey): array {
    $url = 'https://api.openai.com' . $path;
    $query = buildQuery($params);
    if ($query !== '') {
        $url .= '?' . $query;
    }

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_CONNECTTIMEOUT => 15,
        CURLOPT_TIMEOUT => 60,
        CURLOPT_HTTPHEADER => [
            'Authorization: Bearer ' . $adminKey,
            'Accept: application/json',
            'Content-Type: application/json',
            'User-Agent: XRE-OpenAI-Usage/1.0',
        ],
    ]);

    $body = curl_exec($ch);
    $curlError = curl_error($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($body === false) {
        throw new RuntimeException('OpenAI bağlantı hatası: ' . $curlError);
    }

    $decoded = json_decode($body, true);
    if ($status < 200 || $status >= 300) {
        $message = '';
        if (is_array($decoded)) {
            $message = (string)($decoded['error']['message'] ?? $decoded['error'] ?? '');
        }
        if ($message === '') {
            $message = trim(strip_tags(substr($body, 0, 500)));
        }
        throw new RuntimeException('OpenAI API HTTP ' . $status . ': ' . $message);
    }

    if (!is_array($decoded)) {
        throw new RuntimeException('OpenAI API geçersiz JSON döndürdü.');
    }

    return $decoded;
}

function fetchAllPages(string $path, array $params, string $adminKey, int $maxPages = 100): array {
    $allBuckets = [];
    $page = null;

    for ($i = 0; $i < $maxPages; $i++) {
        $request = $params;
        if ($page !== null && $page !== '') {
            $request['page'] = $page;
        }

        $response = openAIGet($path, $request, $adminKey);
        foreach (($response['data'] ?? []) as $bucket) {
            if (is_array($bucket)) {
                $allBuckets[] = $bucket;
            }
        }

        $hasMore = (bool)($response['has_more'] ?? false);
        $page = $response['next_page'] ?? null;
        if (!$hasMore || !$page) {
            break;
        }
    }

    return $allBuckets;
}

function sumCostBuckets(array $buckets): float {
    $total = 0.0;
    foreach ($buckets as $bucket) {
        foreach (($bucket['results'] ?? []) as $result) {
            $currency = strtolower((string)($result['amount']['currency'] ?? 'usd'));
            if ($currency === 'usd') {
                $total += (float)($result['amount']['value'] ?? 0);
            }
        }
    }
    return $total;
}

function dateKeyFromTimestamp($timestamp, DateTimeZone $tz): string {
    return (new DateTimeImmutable('@' . (int)$timestamp))->setTimezone($tz)->format('Y-m-d');
}

function emptyDailyRow(string $date): array {
    return [
        'date' => $date,
        'cost_usd' => 0.0,
        'input_tokens' => 0,
        'output_tokens' => 0,
        'cached_tokens' => 0,
        'audio_tokens' => 0,
        'total_tokens' => 0,
        'requests' => 0,
        'images' => 0,
        'image_requests' => 0,
    ];
}

function addUsage(array &$target, array $result): void {
    $input = (int)($result['input_tokens'] ?? 0);
    $output = (int)($result['output_tokens'] ?? 0);
    $cached = (int)($result['input_cached_tokens'] ?? 0);
    $inputAudio = (int)($result['input_audio_tokens'] ?? 0);
    $outputAudio = (int)($result['output_audio_tokens'] ?? 0);
    $requests = (int)($result['num_model_requests'] ?? 0);

    $target['input_tokens'] = (int)($target['input_tokens'] ?? 0) + $input;
    $target['output_tokens'] = (int)($target['output_tokens'] ?? 0) + $output;
    $target['cached_tokens'] = (int)($target['cached_tokens'] ?? 0) + $cached;
    $target['audio_tokens'] = (int)($target['audio_tokens'] ?? 0) + $inputAudio + $outputAudio;
    $target['total_tokens'] = (int)($target['total_tokens'] ?? 0) + $input + $output + $inputAudio + $outputAudio;
    $target['requests'] = (int)($target['requests'] ?? 0) + $requests;
}

function fetchProjects(string $adminKey): array {
    $map = [];
    $after = null;

    for ($i = 0; $i < 20; $i++) {
        $params = ['limit' => 100];
        if ($after) {
            $params['after'] = $after;
        }
        $response = openAIGet('/v1/organization/projects', $params, $adminKey);
        $data = $response['data'] ?? [];
        foreach ($data as $project) {
            $id = (string)($project['id'] ?? '');
            if ($id !== '') {
                $map[$id] = (string)($project['name'] ?? $id);
            }
        }
        if (!(bool)($response['has_more'] ?? false) || count($data) === 0) {
            break;
        }
        $last = end($data);
        $after = is_array($last) ? (string)($last['id'] ?? '') : '';
        if ($after === '') {
            break;
        }
    }
    return $map;
}

$cacheSeconds = max(0, min(3600, (int)($config['cache_seconds'] ?? 300)));
$forceRefresh = (string)($_GET['refresh'] ?? '') === '1';
$cacheKey = hash('sha256', $startDate->format('Y-m-d') . '|' . $endInclusive->format('Y-m-d'));
$cacheFile = rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'xre_openai_usage_' . $cacheKey . '.json';

if (!$forceRefresh && $cacheSeconds > 0 && is_file($cacheFile) && (time() - filemtime($cacheFile)) < $cacheSeconds) {
    $cached = json_decode((string)file_get_contents($cacheFile), true);
    if (is_array($cached)) {
        $cached['cached'] = true;
        respond(200, $cached);
    }
}

try {
    $costParams = [
        'start_time' => $startTs,
        'end_time' => $endTs,
        'bucket_width' => '1d',
        'limit' => min(180, max(1, $days)),
        'group_by' => ['line_item', 'project_id'],
    ];
    $usageParams = [
        'start_time' => $startTs,
        'end_time' => $endTs,
        'bucket_width' => '1d',
        'limit' => min(31, max(1, $days)),
        'group_by' => ['model', 'project_id', 'api_key_id'],
    ];
    $imageParams = [
        'start_time' => $startTs,
        'end_time' => $endTs,
        'bucket_width' => '1d',
        'limit' => min(31, max(1, $days)),
        'group_by' => ['model', 'project_id', 'api_key_id'],
    ];

    $costBuckets = fetchAllPages('/v1/organization/costs', $costParams, $adminKey);
    $usageBuckets = fetchAllPages('/v1/organization/usage/completions', $usageParams, $adminKey);
    $imageBuckets = fetchAllPages('/v1/organization/usage/images', $imageParams, $adminKey);

    $monthStart = $today->modify('first day of this month');
    $monthEndExclusive = $today->modify('+1 day');
    $monthDaysElapsed = (int)$monthStart->diff($today)->format('%a') + 1;
    $monthCostParams = [
        'start_time' => $monthStart->getTimestamp(),
        'end_time' => $monthEndExclusive->getTimestamp(),
        'bucket_width' => '1d',
        'limit' => min(180, max(1, $monthDaysElapsed)),
    ];
    $monthCostBuckets = fetchAllPages('/v1/organization/costs', $monthCostParams, $adminKey);

    $projectNames = [];
    try {
        $projectNames = fetchProjects($adminKey);
    } catch (Throwable $e) {
        // Proje adları ikincil bilgidir; erişilemezse ID gösterilir.
        $projectNames = [];
    }

    $daily = [];
    for ($cursor = $startDate; $cursor <= $endInclusive; $cursor = $cursor->modify('+1 day')) {
        $key = $cursor->format('Y-m-d');
        $daily[$key] = emptyDailyRow($key);
    }

    $spendCategories = [];
    $projectAgg = [];
    foreach ($costBuckets as $bucket) {
        $date = dateKeyFromTimestamp($bucket['start_time'] ?? 0, $tz);
        foreach (($bucket['results'] ?? []) as $result) {
            $currency = strtolower((string)($result['amount']['currency'] ?? 'usd'));
            if ($currency !== 'usd') {
                continue;
            }
            $value = (float)($result['amount']['value'] ?? 0);
            if (isset($daily[$date])) {
                $daily[$date]['cost_usd'] += $value;
            }

            $lineItem = trim((string)($result['line_item'] ?? ''));
            if ($lineItem === '') {
                $lineItem = 'Diğer';
            }
            $spendCategories[$lineItem] = ($spendCategories[$lineItem] ?? 0.0) + $value;

            $projectId = trim((string)($result['project_id'] ?? ''));
            if ($projectId === '') {
                $projectId = 'unattributed';
            }
            if (!isset($projectAgg[$projectId])) {
                $projectAgg[$projectId] = [
                    'project_id' => $projectId,
                    'project_name' => $projectNames[$projectId] ?? ($projectId === 'unattributed' ? 'Atanmamış / Organizasyon' : $projectId),
                    'cost_usd' => 0.0,
                    'input_tokens' => 0,
                    'output_tokens' => 0,
                    'cached_tokens' => 0,
                    'audio_tokens' => 0,
                    'total_tokens' => 0,
                    'requests' => 0,
                ];
            }
            $projectAgg[$projectId]['cost_usd'] += $value;
        }
    }

    $modelAgg = [];
    $apiKeyAgg = [];
    $summaryUsage = [
        'input_tokens' => 0,
        'output_tokens' => 0,
        'cached_tokens' => 0,
        'audio_tokens' => 0,
        'total_tokens' => 0,
        'requests' => 0,
    ];

    foreach ($usageBuckets as $bucket) {
        $date = dateKeyFromTimestamp($bucket['start_time'] ?? 0, $tz);
        foreach (($bucket['results'] ?? []) as $result) {
            if (isset($daily[$date])) {
                addUsage($daily[$date], $result);
            }
            addUsage($summaryUsage, $result);

            $model = trim((string)($result['model'] ?? ''));
            if ($model === '') {
                $model = 'Belirtilmemiş';
            }
            if (!isset($modelAgg[$model])) {
                $modelAgg[$model] = [
                    'model' => $model,
                    'input_tokens' => 0,
                    'output_tokens' => 0,
                    'cached_tokens' => 0,
                    'audio_tokens' => 0,
                    'total_tokens' => 0,
                    'requests' => 0,
                ];
            }
            addUsage($modelAgg[$model], $result);

            $apiKeyId = trim((string)($result['api_key_id'] ?? ''));
            if ($apiKeyId === '') {
                $apiKeyId = 'unattributed';
            }
            if (!isset($apiKeyAgg[$apiKeyId])) {
                $apiKeyAgg[$apiKeyId] = [
                    'api_key_id' => $apiKeyId,
                    'input_tokens' => 0,
                    'output_tokens' => 0,
                    'cached_tokens' => 0,
                    'audio_tokens' => 0,
                    'total_tokens' => 0,
                    'requests' => 0,
                ];
            }
            addUsage($apiKeyAgg[$apiKeyId], $result);

            $projectId = trim((string)($result['project_id'] ?? ''));
            if ($projectId === '') {
                $projectId = 'unattributed';
            }
            if (!isset($projectAgg[$projectId])) {
                $projectAgg[$projectId] = [
                    'project_id' => $projectId,
                    'project_name' => $projectNames[$projectId] ?? ($projectId === 'unattributed' ? 'Atanmamış / Organizasyon' : $projectId),
                    'cost_usd' => 0.0,
                    'input_tokens' => 0,
                    'output_tokens' => 0,
                    'cached_tokens' => 0,
                    'audio_tokens' => 0,
                    'total_tokens' => 0,
                    'requests' => 0,
                ];
            }
            addUsage($projectAgg[$projectId], $result);
        }
    }

    $imageCount = 0;
    $imageRequests = 0;
    foreach ($imageBuckets as $bucket) {
        $date = dateKeyFromTimestamp($bucket['start_time'] ?? 0, $tz);
        foreach (($bucket['results'] ?? []) as $result) {
            $images = (int)($result['images'] ?? 0);
            $requests = (int)($result['num_model_requests'] ?? 0);
            $imageCount += $images;
            $imageRequests += $requests;
            if (isset($daily[$date])) {
                $daily[$date]['images'] += $images;
                $daily[$date]['image_requests'] += $requests;
            }
        }
    }

    $monthCost = sumCostBuckets($monthCostBuckets);
    $todayKey = $today->format('Y-m-d');
    $todayCost = 0.0;
    foreach ($monthCostBuckets as $bucket) {
        if (dateKeyFromTimestamp($bucket['start_time'] ?? 0, $tz) === $todayKey) {
            foreach (($bucket['results'] ?? []) as $result) {
                if (strtolower((string)($result['amount']['currency'] ?? 'usd')) === 'usd') {
                    $todayCost += (float)($result['amount']['value'] ?? 0);
                }
            }
        }
    }

    $periodCost = sumCostBuckets($costBuckets);
    $daysInMonth = (int)$today->format('t');
    $projectedMonthCost = $monthDaysElapsed > 0 ? ($monthCost / $monthDaysElapsed) * $daysInMonth : 0.0;
    $monthlyBudget = max(0.0, (float)($config['monthly_budget_usd'] ?? 0));
    $budgetPercent = $monthlyBudget > 0 ? ($monthCost / $monthlyBudget) * 100 : 0.0;
    $avgCostPerRequest = $summaryUsage['requests'] > 0 ? $periodCost / $summaryUsage['requests'] : 0.0;

    $modelRows = array_values($modelAgg);
    usort($modelRows, static function (array $a, array $b): int {
        return ($b['total_tokens'] ?? 0) <=> ($a['total_tokens'] ?? 0);
    });

    $categoryRows = [];
    foreach ($spendCategories as $lineItem => $value) {
        $categoryRows[] = ['line_item' => $lineItem, 'cost_usd' => round($value, 8)];
    }
    usort($categoryRows, static function (array $a, array $b): int {
        return ($b['cost_usd'] <=> $a['cost_usd']);
    });

    $projectRows = array_values($projectAgg);
    usort($projectRows, static function (array $a, array $b): int {
        if (($b['cost_usd'] ?? 0) == ($a['cost_usd'] ?? 0)) {
            return ($b['total_tokens'] ?? 0) <=> ($a['total_tokens'] ?? 0);
        }
        return ($b['cost_usd'] <=> $a['cost_usd']);
    });

    $apiKeyRows = array_values($apiKeyAgg);
    usort($apiKeyRows, static function (array $a, array $b): int {
        return ($b['total_tokens'] ?? 0) <=> ($a['total_tokens'] ?? 0);
    });

    $payload = [
        'ok' => true,
        'cached' => false,
        'generated_at' => (new DateTimeImmutable('now', $tz))->format(DateTimeInterface::ATOM),
        'cache_seconds' => $cacheSeconds,
        'range' => [
            'start' => $startDate->format('Y-m-d'),
            'end' => $endInclusive->format('Y-m-d'),
            'days' => $days,
            'timezone' => $timezone,
        ],
        'summary' => [
            'period_cost_usd' => round($periodCost, 8),
            'month_cost_usd' => round($monthCost, 8),
            'today_cost_usd' => round($todayCost, 8),
            'projected_month_cost_usd' => round($projectedMonthCost, 8),
            'input_tokens' => $summaryUsage['input_tokens'],
            'output_tokens' => $summaryUsage['output_tokens'],
            'cached_tokens' => $summaryUsage['cached_tokens'],
            'audio_tokens' => $summaryUsage['audio_tokens'],
            'total_tokens' => $summaryUsage['total_tokens'],
            'requests' => $summaryUsage['requests'],
            'avg_cost_per_request' => round($avgCostPerRequest, 10),
            'images' => $imageCount,
            'image_requests' => $imageRequests,
        ],
        'budget' => [
            'monthly_usd' => round($monthlyBudget, 2),
            'used_usd' => round($monthCost, 8),
            'remaining_usd' => round(max(0.0, $monthlyBudget - $monthCost), 8),
            'percent' => round($budgetPercent, 4),
        ],
        'daily' => array_values($daily),
        'models' => $modelRows,
        'spend_categories' => $categoryRows,
        'projects' => $projectRows,
        'api_keys' => $apiKeyRows,
    ];

    if ($cacheSeconds > 0) {
        @file_put_contents($cacheFile, json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), LOCK_EX);
    }

    respond(200, $payload);
} catch (Throwable $e) {
    respond(502, [
        'ok' => false,
        'error' => $e->getMessage(),
        'hint' => 'Admin key geçerli mi, Organization Owner yetkisine sahip mi ve sunucuda dış HTTPS bağlantısı açık mı kontrol edin.',
    ]);
}