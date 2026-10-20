<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, max-age=0');
header('X-Content-Type-Options: nosniff');

function out(array $data, int $status = 200): never {
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    header('Access-Control-Allow-Methods: POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
    http_response_code(204);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    out(['ok' => false, 'error' => 'Yalnızca POST istekleri desteklenir.'], 405);
}

$configCandidates = [
    dirname(__DIR__, 3) . '/private/openai-config.php',
    dirname(__DIR__, 2) . '/private/openai-config.php',
    dirname(__DIR__) . '/private/openai-config.php',
];

$config = null;
foreach ($configCandidates as $candidate) {
    if (is_file($candidate)) {
        $loaded = require $candidate;
        if (is_array($loaded)) { $config = $loaded; break; }
    }
}

if (!is_array($config)) {
    out(['ok' => false, 'error' => 'OpenAI yapılandırması bulunamadı.'], 500);
}

$apiKey = trim((string)($config['openai_api_key'] ?? $config['openai_admin_key'] ?? ''));
if ($apiKey === '' || str_contains($apiKey, 'REPLACE_') || str_contains($apiKey, 'PASTE_')) {
    out(['ok' => false, 'error' => 'OpenAI API anahtarı sunucuda tanımlı değil.'], 500);
}

$input = json_decode(file_get_contents('php://input') ?: '', true);
if (!is_array($input) || empty($input['messages'])) {
    out(['ok' => false, 'error' => 'Geçersiz istek: messages alanı gerekli.'], 400);
}

$model = (string)($input['model'] ?? 'gpt-4o-mini');
$allowedModels = ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1-nano'];
if (!in_array($model, $allowedModels, true)) {
    $model = 'gpt-4o-mini';
}

$messages = [];
foreach ($input['messages'] as $msg) {
    if (!is_array($msg) || !isset($msg['role'], $msg['content'])) continue;
    $role = in_array($msg['role'], ['system', 'user', 'assistant'], true) ? $msg['role'] : 'user';
    $messages[] = ['role' => $role, 'content' => substr((string)$msg['content'], 0, 8000)];
}
if (!$messages) {
    out(['ok' => false, 'error' => 'Geçerli mesaj bulunamadı.'], 400);
}

$payload = json_encode([
    'model' => $model,
    'messages' => $messages,
    'temperature' => min(1.0, max(0.0, (float)($input['temperature'] ?? 0.3))),
    'max_tokens' => min(1000, max(50, (int)($input['max_tokens'] ?? 500))),
], JSON_UNESCAPED_UNICODE);

$ch = curl_init('https://api.openai.com/v1/chat/completions');
if ($ch === false) out(['ok' => false, 'error' => 'cURL başlatılamadı.'], 500);

curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => $payload,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_CONNECTTIMEOUT => 10,
    CURLOPT_TIMEOUT => 30,
    CURLOPT_SSL_VERIFYPEER => true,
    CURLOPT_HTTPHEADER => [
        'Content-Type: application/json',
        'Authorization: Bearer ' . $apiKey,
    ],
]);

$raw = curl_exec($ch);
$errno = curl_errno($ch);
$error = curl_error($ch);
$status = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
curl_close($ch);

if ($errno !== 0 || $raw === false) {
    out(['ok' => false, 'error' => 'OpenAI bağlantı hatası: ' . $error], 502);
}

$data = json_decode((string)$raw, true);
if (!is_array($data)) {
    out(['ok' => false, 'error' => 'OpenAI geçersiz yanıt döndürdü. HTTP ' . $status], 502);
}

if ($status >= 400) {
    $errMsg = $data['error']['message'] ?? ('HTTP ' . $status);
    out(['ok' => false, 'error' => 'OpenAI API hatası: ' . $errMsg], $status >= 500 ? 502 : 400);
}

out(['ok' => true, 'choices' => $data['choices'] ?? [], 'usage' => $data['usage'] ?? null]);
