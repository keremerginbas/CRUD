<?php
/**
 * Rome Pharma - iletişim formu işleyicisi
 *
 * index / contact sayfalarındaki iletişim formu ve İnsan Kaynakları
 * başvuru formu (form=hr, CV eki ile) buraya POST eder.
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
const MAIL_TO      = 'fevziaydin@rome-pharma.com';
const MAIL_FROM    = 'no-reply@romepharma.com'; // alan adınıza ait olmalı (SPF)
const MIN_SECONDS  = 3;    // formu bundan hızlı gönderen bot sayılır
const RATE_LIMIT   = 5;    // aynı IP için saatlik en fazla gönderim
const RATE_DIR     = __DIR__ . '/.form-rate';
const CV_MAX_BYTES = 5 * 1024 * 1024;
const CV_TYPES     = [ // uzantı => izin verilen MIME türleri
    'pdf'  => ['application/pdf'],
    'doc'  => ['application/msword', 'application/vnd.ms-office', 'application/octet-stream'],
    'docx' => ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/zip', 'application/octet-stream'],
];

// ------------------------------------------------------------------

$lang = (($_POST['lang'] ?? '') === 'en') ? 'en' : 'tr';
$wantsJson = stripos($_SERVER['HTTP_ACCEPT'] ?? '', 'application/json') !== false;
$isHr = ($_POST['form'] ?? '') === 'hr';

$messages = [
    'tr' => [
        'method'  => 'Geçersiz istek.',
        'invalid' => 'Lütfen adınızı, geçerli bir e-posta adresini ve mesajınızı girin.',
        'consent' => 'Devam etmek için KVKK Aydınlatma Metni onay kutusunu işaretleyin.',
        'rate'    => 'Çok fazla deneme yapıldı. Lütfen daha sonra tekrar deneyin.',
        'fail'    => 'Mesaj gönderilemedi. Lütfen fevziaydin@rome-pharma.com adresine e-posta gönderin.',
        'ok'      => 'Teşekkürler! Mesajınız bize ulaştı.',
        'subject' => 'Web sitesi iletişim formu',
        'hr_invalid' => 'Lütfen adınızı, geçerli bir e-posta adresini ve telefonunuzu girin.',
        'cv_missing' => 'Lütfen özgeçmişinizi (PDF, DOC veya DOCX) yükleyin.',
        'cv_size'    => 'Özgeçmiş dosyası en fazla 5 MB olabilir.',
        'cv_type'    => 'Özgeçmiş yalnızca PDF, DOC veya DOCX formatında olabilir.',
        'hr_ok'      => 'Teşekkürler! Başvurunuz bize ulaştı.',
        'hr_subject' => 'İş başvurusu (web sitesi)',
    ],
    'en' => [
        'method'  => 'Invalid request.',
        'invalid' => 'Please enter your name, a valid email address and your message.',
        'consent' => 'Please tick the privacy notice consent box to continue.',
        'rate'    => 'Too many attempts. Please try again later.',
        'fail'    => 'Your message could not be sent. Please email fevziaydin@rome-pharma.com.',
        'ok'      => 'Thank you! Your message has been received.',
        'subject' => 'Website contact form',
        'hr_invalid' => 'Please enter your name, a valid email address and your phone number.',
        'cv_missing' => 'Please upload your CV (PDF, DOC or DOCX).',
        'cv_size'    => 'The CV file can be at most 5 MB.',
        'cv_type'    => 'The CV must be a PDF, DOC or DOCX file.',
        'hr_ok'      => 'Thank you! Your application has been received.',
        'hr_subject' => 'Job application (website)',
    ],
][$lang];

function respond(bool $ok, string $message, string $lang, bool $wantsJson, int $status = 200): void
{
    global $isHr;
    if ($wantsJson) {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['ok' => $ok, 'message' => $message], JSON_UNESCAPED_UNICODE);
    } else {
        if ($isHr) {
            $page = ($lang === 'en' ? 'human-resources-en.html' : 'insan-kaynaklari.html');
            $anchor = '#application-form';
        } else {
            $page = ($lang === 'en' ? 'contact-en.html' : 'contact.html');
            $anchor = '#contact-form';
        }
        header('Location: ' . $page . '?sent=' . ($ok ? '1' : '0') . $anchor, true, 303);
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

/**
 * @param array{name:string,path:string,type:string}|null $attachment
 */
function send_mail(string $to, string $subject, string $body, string $replyTo, string $replyName, ?array $attachment = null): bool
{
    $encodedSubject = '=?UTF-8?B?' . base64_encode($subject) . '?=';
    $encodedName = '=?UTF-8?B?' . base64_encode($replyName) . '?=';
    $headers = [
        'MIME-Version: 1.0',
        'From: Rome Pharma Web <' . MAIL_FROM . '>',
        'Reply-To: ' . $encodedName . ' <' . $replyTo . '>',
        'X-Mailer: PHP/' . PHP_VERSION,
    ];

    if ($attachment === null) {
        $headers[] = 'Content-Type: text/plain; charset=UTF-8';
        $headers[] = 'Content-Transfer-Encoding: 8bit';
        $payload = $body;
    } else {
        $boundary = 'b_' . bin2hex(random_bytes(12));
        $headers[] = 'Content-Type: multipart/mixed; boundary="' . $boundary . '"';
        $fileName = '=?UTF-8?B?' . base64_encode($attachment['name']) . '?=';
        $payload = "--$boundary\r\n"
            . "Content-Type: text/plain; charset=UTF-8\r\n"
            . "Content-Transfer-Encoding: 8bit\r\n\r\n"
            . $body . "\r\n"
            . "--$boundary\r\n"
            . 'Content-Type: ' . $attachment['type'] . '; name="' . $fileName . "\"\r\n"
            . "Content-Transfer-Encoding: base64\r\n"
            . 'Content-Disposition: attachment; filename="' . $fileName . "\"\r\n\r\n"
            . chunk_split(base64_encode((string) file_get_contents($attachment['path'])))
            . "--$boundary--\r\n";
    }
    return mail($to, $encodedSubject, $payload, implode("\r\n", $headers), '-f' . MAIL_FROM);
}

/**
 * Yüklenen CV'yi doğrular. Hata mesajı anahtarını veya ek bilgisini döndürür.
 * @return array{name:string,path:string,type:string}|string
 */
function validated_cv(string $name)
{
    $file = $_FILES['cv'] ?? null;
    if (!is_array($file) || ($file['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) {
        return 'cv_missing';
    }
    if (in_array($file['error'], [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true) || $file['size'] > CV_MAX_BYTES) {
        return 'cv_size';
    }
    if ($file['error'] !== UPLOAD_ERR_OK || !is_uploaded_file($file['tmp_name'])) {
        return 'cv_missing';
    }
    $ext = strtolower(pathinfo((string) $file['name'], PATHINFO_EXTENSION));
    if (!isset(CV_TYPES[$ext])) {
        return 'cv_type';
    }
    $mime = function_exists('finfo_open')
        ? (string) finfo_file(finfo_open(FILEINFO_MIME_TYPE), $file['tmp_name'])
        : 'application/octet-stream';
    if (!in_array($mime, CV_TYPES[$ext], true)) {
        return 'cv_type';
    }
    // Dosya adını sadeleştir: "CV - Ad Soyad.pdf"
    $safeName = trim(preg_replace('/[^\p{L}\p{N} ._-]+/u', '', $name) ?? '') ?: 'basvuru';
    return ['name' => 'CV - ' . $safeName . '.' . $ext, 'path' => $file['tmp_name'], 'type' => CV_TYPES[$ext][0]];
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
$position = clean_line((string) ($_POST['position'] ?? ''), 150);
$message = mb_substr(trim((string) ($_POST['message'] ?? '')), 0, 5000);
$consent = ($_POST['kvkk_consent'] ?? '') === '1';

if ($isHr) {
    if (mb_strlen($name) < 2 || !filter_var($email, FILTER_VALIDATE_EMAIL) || mb_strlen($phone) < 7) {
        respond(false, $messages['hr_invalid'], $lang, $wantsJson, 422);
    }
} elseif (mb_strlen($name) < 2 || !filter_var($email, FILTER_VALIDATE_EMAIL) || mb_strlen($message) < 5) {
    respond(false, $messages['invalid'], $lang, $wantsJson, 422);
}
if (!$consent) {
    respond(false, $messages['consent'], $lang, $wantsJson, 422);
}

$ip = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
if (rate_limited($ip)) {
    respond(false, $messages['rate'], $lang, $wantsJson, 429);
}

$attachment = null;
if ($isHr) {
    $cv = validated_cv($name);
    if (is_string($cv)) {
        respond(false, $messages[$cv], $lang, $wantsJson, 422);
    }
    $attachment = $cv;

    $body = implode("\n", [
        'İŞ BAŞVURUSU',
        'Ad Soyad : ' . $name,
        'E-posta  : ' . $email,
        'Telefon  : ' . $phone,
        'Pozisyon : ' . ($position !== '' ? $position : '-'),
        'Dil      : ' . strtoupper($lang),
        'KVKK onayı: Evet (' . date('Y-m-d H:i:s') . ')',
        '',
        'Ön yazı:',
        $message !== '' ? $message : '-',
        '',
        'Özgeçmiş ektedir.',
    ]);
    $sent = send_mail(MAIL_TO, $messages['hr_subject'] . ' - ' . $name, $body, $email, $name, $attachment);
    respond($sent, $sent ? $messages['hr_ok'] : $messages['fail'], $lang, $wantsJson, $sent ? 200 : 500);
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
