<?php
declare(strict_types=1);

function xreJson(array $payload, int $status = 200) {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function xreConfigPath(): ?string {
    $root = isset($_SERVER['DOCUMENT_ROOT']) ? rtrim((string)$_SERVER['DOCUMENT_ROOT'], '/\\') : '';
    $candidates = array_filter([
        dirname(__DIR__, 3) . '/private/bitrix-config.php',
        $root !== '' ? dirname($root) . '/private/bitrix-config.php' : null,
        dirname(__DIR__, 2) . '/private/bitrix-config.php',
    ]);
    foreach ($candidates as $path) if (is_file($path)) return $path;
    return null;
}

function xreLoadConfig(): array {
    $path = xreConfigPath();
    if (!$path) xreJson(['ok'=>false,'error'=>'/private/bitrix-config.php bulunamadı.'], 500);
    $cfg = require $path;
    if (!is_array($cfg) || empty($cfg['webhook_base'])) xreJson(['ok'=>false,'error'=>'webhook_base yapılandırılmamış.'], 500);
    $base = rtrim((string)$cfg['webhook_base'], '/') . '/';
    if (!preg_match('~^https://[^/]+/rest/\\d+/[^/]+/$~i', $base)) xreJson(['ok'=>false,'error'=>'webhook_base biçimi geçersiz.'], 500);
    $cfg['webhook_base'] = $base;
    date_default_timezone_set((string)($cfg['timezone'] ?? 'Europe/Istanbul'));
    return $cfg;
}

function xreCacheDir(): string {
    $dir = sys_get_temp_dir() . '/xre-bitrix-cache';
    if (!is_dir($dir)) @mkdir($dir, 0775, true);
    return $dir;
}
function xreCacheGet(string $key, int $ttl): ?array {
    if ($ttl <= 0) return null;
    $file = xreCacheDir() . '/' . md5($key) . '.json';
    if (!is_file($file) || (time() - (int)@filemtime($file)) > $ttl) return null;
    $raw = @file_get_contents($file);
    if ($raw === false) return null;
    $data = json_decode($raw, true);
    return is_array($data) ? $data : null;
}
function xreCacheSet(string $key, array $data): void {
    $file = xreCacheDir() . '/' . md5($key) . '.json';
    @file_put_contents($file, json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), LOCK_EX);
}

function xreBitrixCall(string $base, string $method, array $params = []): array {
    $ch = curl_init($base . $method . '.json');
    if ($ch === false) throw new RuntimeException('cURL başlatılamadı.');
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => http_build_query($params),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_TIMEOUT => 60,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_HTTPHEADER => ['Accept: application/json','Content-Type: application/x-www-form-urlencoded'],
    ]);
    $raw = curl_exec($ch);
    $errno = curl_errno($ch); $error = curl_error($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    if ($errno !== 0 || $raw === false) throw new RuntimeException('Bitrix bağlantı hatası: '.$error);
    $data = json_decode((string)$raw, true);
    if (!is_array($data)) throw new RuntimeException('Bitrix geçersiz JSON döndürdü. HTTP '.$status);
    if (isset($data['error'])) throw new RuntimeException((string)$data['error'].': '.(string)($data['error_description'] ?? 'Bitrix hatası'));
    return $data;
}

function xrePersonel(): array {
    return [
        '23180'=>'Abdullah Açıkgöz',
        '17984'=>'Ali Karaoğlu',
        '22186'=>'Ali Kemal Çınar',
        '24600'=>'Anıl Emre Özkök',
        '1174'=>'Arda Kağan Ertaş',
        '23562'=>'Burcu Kansu',
        '25392'=>'Dilara Gençağa',
        '23564'=>'Duygu Ayyayla',
        '24080'=>'Ebru Özkanoğlu',
        '25314'=>'Hatice Aldemir',
        '116'=>'Merve Gelleci',
        '25258'=>'Murat Çakıroğlu',
        '25120'=>'Ozan Kabagöz',
        '25316'=>'Özge Kaya',
        '5778'=>'Tuğba Kütük',
        '22182'=>'Zarife Ayoğlu',
        '11690'=>'Zeliha Bilginsoy',
        '26306'=>'Meltem Aygün',
    ];
}

function xreParseDate(?string $value): ?DateTimeImmutable {
    $value = trim((string)$value);
    if ($value==='' || substr($value,0,4)==='0000' || substr($value,0,4)==='9999') return null;
    try { return new DateTimeImmutable($value); } catch (Throwable) { return null; }
}

function xreInputDate(string $key, bool $endExclusive=false): ?DateTimeImmutable {
    $value = trim((string)($_GET[$key] ?? ''));
    if ($value==='') return null;
    $date = DateTimeImmutable::createFromFormat('!Y-m-d', $value);
    if (!$date) throw new InvalidArgumentException($key.' geçersiz tarih.');
    return $endExclusive ? $date->modify('+1 day') : $date;
}

function xreBaseTodoFilter(?string $responsibleId, ?DateTimeImmutable $startDate, ?DateTimeImmutable $endExclusive): array {
    $filter = ['OWNER_TYPE_ID'=>1,'TYPE_ID'=>6,'PROVIDER_ID'=>'CRM_TODO'];
    if ($responsibleId!==null && $responsibleId!=='') $filter['RESPONSIBLE_ID']=$responsibleId;
    if ($startDate) $filter['>=CREATED']=$startDate->format(DATE_ATOM);
    if ($endExclusive) $filter['<CREATED']=$endExclusive->format(DATE_ATOM);
    return $filter;
}

function xreResolveLeadTitles(string $base, array $ids): array {
    $ids = array_values(array_unique(array_filter(array_map('strval',$ids))));
    if (!$ids) return [];
    try {
        $result = xreBitrixCall($base,'crm.lead.list',[
            'order'=>['ID'=>'DESC'],
            'filter'=>['@ID'=>$ids],
            'select'=>['ID','TITLE','NAME','LAST_NAME','COMPANY_TITLE'],
            'start'=>0,
        ]);
        $map=[];
        foreach (($result['result'] ?? []) as $lead) {
            $id=(string)($lead['ID'] ?? ''); if($id==='')continue;
            $name=trim((string)($lead['TITLE'] ?? ''));
            if($name==='') $name=trim((string)($lead['NAME'] ?? '').' '.(string)($lead['LAST_NAME'] ?? ''));
            if($name==='') $name=trim((string)($lead['COMPANY_TITLE'] ?? ''));
            $map[$id]=$name!==''?$name:'Lead #'.$id;
        }
        return $map;
    } catch (Throwable) { return []; }
}

function xreDeadlineGroup(?DateTimeImmutable $deadline, bool $completed, DateTimeImmutable $now): string {
    if($completed)return 'Tamamlandı';
    if(!$deadline)return 'Planlanan Tarihi Boş';
    $today=$now->setTime(0,0);$tomorrow=$today->modify('+1 day');
    $nextWeek=$today->modify('monday next week');$afterNext=$nextWeek->modify('+7 days');
    if($deadline<$today)return 'Geciken';
    if($deadline<$now)return 'Gün İçi Unutulan';
    if($deadline<$tomorrow)return 'Son Tarihi Bugün';
    if($deadline<$nextWeek)return 'Son Tarihi Bu Hafta';
    if($deadline<$afterNext)return 'Gelecek Hafta';
    return 'İki Haftadan Sonra';
}
