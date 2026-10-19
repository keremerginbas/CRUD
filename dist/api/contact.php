<?php
// İletişim / teklif formu – e-posta gönderir.
declare(strict_types=1);
require __DIR__ . '/_lib.php';

same_origin();
$in = body();
if (!empty($in['website'])) out(200, ['ok' => true]); // bal küpü (bot)
rate_limit('contact', 5);

$clean = fn($k, $n = 200) => trim(str_replace(["\r", "\n"], ' ', mb_substr((string)($in[$k] ?? ''), 0, $n)));
$name = $clean('name', 100);
$phone = $clean('phone', 30);
$email = filter_var($clean('email', 150), FILTER_VALIDATE_EMAIL) ?: '';
$service = $clean('service', 60);
$message = trim(mb_substr((string)($in['message'] ?? ''), 0, 3000));
if ($name === '' || $phone === '' || $message === '' || empty($in['kvkk'])) out(422, ['ok' => false, 'error' => 'Zorunlu alanları doldurun']);

$c = cfg();
$subject = '=?UTF-8?B?' . base64_encode("Web Sitesi Teklif Talebi - $name") . '?=';
$text = "Ad Soyad: $name\nTelefon: $phone\nE-posta: $email\nHizmet: $service\n\nMesaj:\n$message\n\nIP: " . ($_SERVER['REMOTE_ADDR'] ?? '-') . "\nTarih: " . date('d.m.Y H:i');
$headers = "From: CMS Hafriyat Web <{$c['mail_from']}>\r\nContent-Type: text/plain; charset=UTF-8\r\n" . ($email ? "Reply-To: $email\r\n" : '');
$sent = @mail($c['mail_to'], $subject, $text, $headers);
out($sent ? 200 : 500, ['ok' => $sent, 'error' => $sent ? null : 'E-posta gönderilemedi']);
