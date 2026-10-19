<?php
// Yapay zeka sohbet uç noktası – OpenAI anahtarı istemciye asla gönderilmez.
declare(strict_types=1);
require __DIR__ . '/_lib.php';

same_origin();
$in = body();
$c = cfg();
if ($c['openai_api_key'] === '') out(503, ['ok' => false, 'error' => 'Asistan yapılandırılmadı']);
rate_limit('chat', (int)$c['rate_limit']);

$msgs = [];
foreach (array_slice((array)($in['messages'] ?? []), -10) as $m) {
    $role = ($m['role'] ?? '') === 'assistant' ? 'assistant' : 'user';
    $text = trim(mb_substr((string)($m['content'] ?? ''), 0, 600));
    if ($text !== '') $msgs[] = ['role' => $role, 'content' => $text];
}
if (!$msgs) out(400, ['ok' => false, 'error' => 'Mesaj boş']);

$system = <<<TXT
Sen "CMS Asistan"sın: CMS Hafriyat İnşaat Nakliyat Ltd. Şti.'nin web sitesindeki Türkçe müşteri asistanı.
Firma: hafriyat, iş makineleri operasyonları, inşaat ve taahhüt, nakliye ve ihracat alanlarında hizmet verir.
Değerler: güvenilirlik, kalite, sorumluluk, müşteri memnuniyeti, sürekli gelişim, sürdürülebilirlik. Slogan: "Güvenle Başlar, Değerle Büyür."
İletişim: Telefon/WhatsApp 0533 500 37 79 (https://wa.me/905335003779), e-posta cmshafriyat01@gmail.com, form: /iletisim/
Sayfalar: /hizmetler/hafriyat/, /hizmetler/is-makineleri/, /hizmetler/insaat-taahhut/, /hizmetler/nakliye/, /hizmetler/ihracat/, /hakkimizda/, /projeler/, /blog/, /sss/
Kurallar:
- Kısa, net, samimi ve profesyonel yanıt ver (en fazla 120 kelime). Her zaman Türkçe yaz.
- Fiyat, süre, adres, proje sayısı, makine parkı gibi bilmediğin somut bilgileri UYDURMA; bunlar için keşif/teklif öner ve telefona/WhatsApp'a yönlendir.
- İzin/ruhsat konularında kuralların belediyeye göre değiştiğini belirt.
- Uygun olduğunda ilgili sayfa bağlantısını (yukarıdaki yollar) ver.
- Konu dışı isteklerde kibarca firmanın hizmetlerine yönlendir.
TXT;

$payload = [
    'model' => $c['openai_model'],
    'messages' => array_merge([['role' => 'system', 'content' => $system]], $msgs),
    'temperature' => 0.4,
    'max_tokens' => 400,
];
$ch = curl_init('https://api.openai.com/v1/chat/completions');
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 25,
    CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Authorization: Bearer ' . $c['openai_api_key']],
    CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE),
]);
$res = curl_exec($ch);
$code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);
$j = json_decode((string)$res, true);
$reply = $j['choices'][0]['message']['content'] ?? null;
if ($code !== 200 || !$reply) out(502, ['ok' => false, 'error' => 'Asistan şu an yanıt veremiyor']);
out(200, ['ok' => true, 'reply' => trim($reply)]);
