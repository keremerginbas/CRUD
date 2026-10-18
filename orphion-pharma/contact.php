<?php
/**
 * Orphion Pharma - iletişim formu işleyicisi
 *
 * index / contact sayfalarındaki form buraya POST eder.
 * JavaScript açıksa JSON döner, kapalıysa ilgili iletişim sayfasına
 * ?sent=1 / ?sent=0 ile geri yönlendirir.
 *
 * Sunucuda PHP mail() çalışmalıdır. Hosting SMTP zorunlu tutuyorsa
 * send_mail() fonksiyonunu PHPMailer vb. ile değiştirin.
 */

declare(strict_types=1);

// ------------------------------------------------------------------
// Ayarlar
// ------------------------------------------------------------------
const MAIL_TO      = 'info@orphionpharma.com';
const MAIL_FROM    = 'no-reply@orphionpharma.com'; // alan adınıza ait olmalı (SPF)
const MIN_SECONDS  = 3;    // formu bundan hızlı gönderen bot sayılır
const RATE_LIMIT   = 5;    // aynı IP için saatlik en fazla gönderim
const RATE_DIR     = __DIR__ . '/.form-rate';

// ------------------------------------------------------------------

$lang = (($_POST['lang'] ?? '') === 'en') ? 'en' : 'tr';
$wantsJson = stripos($_SERVER['HTTP_ACCEPT'] ?? '', 'application/json') !== false;

$messages = [
    'tr' => [
        'method'  => 'Geçersiz istek.',
        'invalid' => 'Lütfen adınızı, geçerli bir e-posta adresini ve mesajınızı girin.',
        'consent' => 'Devam etmek için KVKK Aydınlatma Metni onay kutusunu işaretleyin.',
        'rate'    => 'Çok fazla deneme yapıldı. Lütfen daha sonra tekrar deneyin.',
        'fail'    => 'Mesaj gönderilemedi. Lütfen info@orphionpharma.com adresine e-posta gönderin.',
        'ok'      => 'Teşekkürler! Mesajınız bize ulaştı.',
        'subject' => 'Web sitesi iletişim formu',
    ],
    'en' => [
        'method'  => 'Invalid request.',
        'invalid' => 'Please enter your name, a valid email address and your message.',
        'consent' => 'Please tick the privacy notice consent box to continue.',
        'rate'    => 'Too many attempts. Please try again later.',
        'fail'    => 'Your message could not be sent. Please email info@orphionpharma.com.',
        'ok'      => 'Thank you! Your message has been received.',
        'subject' => 'Website contact form',
    ],
][$lang];

function respond(bool $ok, string $message, string $lang, bool $wantsJson, int $status = 200): void
{
    if ($wantsJson) {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['ok' => $ok, 'message' => $message], JSON_UNESCAPED_UNICODE);
    } else {
        $page = $lang === 'en' ? 'contact-en.html' : 'contact.html';
        header('Location: ' . $page . '?sent=' . ($ok ? '1' : '0') . '#contact-form', true, 303);
    }
    exit;
}

function clean_line(string $value, int $max): string
{
    // Başlık enjeksiyonunu önlemek için satır sonlarını ve kontrol karakterlerini sil.
    $value = preg_replace('/[\r\n\t\x00-\x1F\x7F]+/u', ' ', $value) ?? '';
    return mb_substr(trim($value), 0, $max);
}

function rate_limited(string $ip): bool
{
    if (!is_dir(RATE_DIR) && !@mkdir(RATE_DIR, 0700, true)) {
        return false;
    }
    $file = RATE_DIR . '/' . hash('sha256', $ip) . '.json';
    $now = time();
    $hits = [];
    if (is_file($file)) {
        $hits = json_decode((string) file_get_contents($file), true) ?: [];
    }
    $hits = array_values(array_filter($hits, fn($t) => is_int($t) && $t > $now - 3600));
    if (count($hits) >= RATE_LIMIT) {
        return true;
    }
    $hits[] = $now;
    @file_put_contents($file, json_encode($hits), LOCK_EX);
    return false;
}

function send_mail(string $to, string $subject, string $body, string $replyTo, string $replyName): bool
{
    $encodedSubject = '=?UTF-8?B?' . base64_encode($subject) . '?=';
    $encodedName = '=?UTF-8?B?' . base64_encode($replyName) . '?=';
    $headers = [
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: 8bit',
        'From: Orphion Pharma Web <' . MAIL_FROM . '>',
        'Reply-To: ' . $encodedName . ' <' . $replyTo . '>',
        'X-Mailer: PHP/' . PHP_VERSION,
    ];
    return mail($to, $encodedSubject, $body, implode("\r\n", $headers), '-f' . MAIL_FROM);
}

// ------------------------------------------------------------------
// İşlem
// ------------------------------------------------------------------

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    header('Allow: POST');
    respond(false, $messages['method'], $lang, $wantsJson, 405);
}

// Bal küpü: insanlar bu alanı görmez; doluysa bot. Bota başarı gibi görün.
if (!empty($_POST['website'])) {
    respond(true, $messages['ok'], $lang, $wantsJson);
}
$ts = (int) ($_POST['ts'] ?? 0);
if ($ts > 0 && (time() - $ts) < MIN_SECONDS) {
    respond(true, $messages['ok'], $lang, $wantsJson);
}

$name    = clean_line((string) ($_POST['name'] ?? ''), 100);
$email   = clean_line((string) ($_POST['email'] ?? ''), 200);
$phone   = clean_line((string) ($_POST['phone'] ?? ''), 40);
$company = clean_line((string) ($_POST['company'] ?? ''), 150);
$message = mb_substr(trim((string) ($_POST['message'] ?? '')), 0, 5000);
$consent = ($_POST['kvkk_consent'] ?? '') === '1';

if (mb_strlen($name) < 2 || !filter_var($email, FILTER_VALIDATE_EMAIL) || mb_strlen($message) < 5) {
    respond(false, $messages['invalid'], $lang, $wantsJson, 422);
}
if (!$consent) {
    respond(false, $messages['consent'], $lang, $wantsJson, 422);
}

$ip = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
if (rate_limited($ip)) {
    respond(false, $messages['rate'], $lang, $wantsJson, 429);
}

$body = implode("\n", [
    'Ad Soyad : ' . $name,
    'E-posta  : ' . $email,
    'Telefon  : ' . ($phone !== '' ? $phone : '-'),
    'Firma    : ' . ($company !== '' ? $company : '-'),
    'Dil      : ' . strtoupper($lang),
    'KVKK onayı: Evet (' . date('Y-m-d H:i:s') . ')',
    '',
    'Mesaj:',
    $message,
]);

$sent = send_mail(MAIL_TO, $messages['subject'] . ' - ' . $name, $body, $email, $name);

respond($sent, $sent ? $messages['ok'] : $messages['fail'], $lang, $wantsJson, $sent ? 200 : 500);
