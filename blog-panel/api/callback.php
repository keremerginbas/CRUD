<?php
declare(strict_types=1);

/**
 * n8n -> panel: üretilen yazıyı teslim eder.
 * Header: X-Blog-Panel-Secret: <ayarlardaki gizli anahtar>
 * Body:   {"job_id":1,"token":"...","status":"success","article":{...}}
 *      ya {"job_id":1,"token":"...","status":"error","error":"..."}
 */
require dirname(__DIR__) . '/app/bootstrap.php';

use BlogPanel\App;
use BlogPanel\CallbackException;
use BlogPanel\JobService;
use BlogPanel\Logger;

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['ok' => false, 'error' => 'POST gerekli'], 405);
}
$secret = App::settings()->get('n8n_secret');
$sent = (string) ($_SERVER['HTTP_X_BLOG_PANEL_SECRET'] ?? '');
if ($secret === '' || !hash_equals($secret, $sent)) {
    Logger::error('callback', 'Geçersiz gizli anahtarla istek: ' . ($_SERVER['REMOTE_ADDR'] ?? '?'));
    json_response(['ok' => false, 'error' => 'Yetkisiz'], 401);
}
$data = json_decode((string) file_get_contents('php://input'), true);
if (!is_array($data)) {
    json_response(['ok' => false, 'error' => 'Geçersiz JSON'], 400);
}

ignore_user_abort(true);
set_time_limit(300);
try {
    $result = JobService::handleCallback($data);
    json_response($result, $result['ok'] ? 200 : 422);
} catch (CallbackException $e) {
    json_response(['ok' => false, 'error' => $e->getMessage()], $e->getCode() ?: 400);
}
