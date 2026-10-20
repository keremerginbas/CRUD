<?php
declare(strict_types=1);

/**
 * XRE Operasyon Paneli — Bitrix Randevu Sayacı (v2)
 * ------------------------------------------------------------------
 * Temsilciler randevuyu Lead statüsünü "Randevu Oluşturulanlar" /
 * "Ofis Randevusu" gibi bir statüye çekerek kaydediyor. Bu yüzden
 * sayım ANLIK statüye değil, STATÜ GEÇİŞ GEÇMİŞİNE bakar
 * (crm.stagehistory.list). Böylece randevu alıp sonra "Satış" veya
 * "Kayıp" statüsüne taşınan lead'ler de sayılır.
 *
 * Kullanım:
 *   ?action=discover                -> statü ID'leri + randevu tarih alanı adayları
 *   ?from=2026-07-31&to=2026-08-06  -> sayım + temsilci kırılımı
 *   &rows=1                         -> kayıt listesi
 *   &basis=gerceklesme              -> randevu TARİHİNE göre say
 *   &responsible_id=116 &force=1
 */

require_once __DIR__ . '/bitrix-common.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, max-age=0');

$cfg  = xreLoadConfig();
$base = (string)$cfg['webhook_base'];

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin !== '' && in_array($origin, (array)($cfg['allowed_origins'] ?? []), true)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
}
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    header('Access-Control-Allow-Methods: GET, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
    http_response_code(204);
    exit;
}

// ---- Ayarlar -----------------------------------------------------
$STATUS_REGEX  = (string)($cfg['randevu_status_regex'] ?? '~randevu~iu');
$LEAD_STATUSES = array_values(array_filter(array_map('strval', (array)($cfg['randevu_lead_statuses'] ?? []))));
$DEAL_STAGES   = array_values(array_filter(array_map('strval', (array)($cfg['randevu_deal_stages']   ?? []))));
$DATE_FIELD    = trim((string)($cfg['randevu_tarih_alani'] ?? ''));   // ör. UF_CRM_1712345678
$MAX_PAGES     = max(1, (int)($cfg['randevu_max_pages'] ?? 80));
$TTL           = max(0, (int)($cfg['randevu_cache_seconds'] ?? 180));
$PERSONEL      = xrePersonel();

function xrePagedList(string $base, string $method, array $params, int $maxPages): array {
    $out = []; $start = 0;
    for ($p = 0; $p < $maxPages; $p++) {
        $params['start'] = $start;
        $res = xreBitrixCall($base, $method, $params);
        $chunk = $res['result'] ?? [];
        if (isset($chunk['items']) && is_array($chunk['items'])) $chunk = $chunk['items'];
        if (!is_array($chunk) || !$chunk) break;
        foreach ($chunk as $row) $out[] = $row;
        if (!isset($res['next'])) break;
        $start = (int)$res['next'];
    }
    return $out;
}

/** Adı regex'e uyan lead statülerini / deal aşamalarını bulur. */
function xreRandevuStatuleri(string $base, string $regex): array {
    $rows = xreBitrixCall($base, 'crm.status.list', [
        'order'  => ['SORT' => 'ASC'],
    ])['result'] ?? [];
    $out = ['lead' => [], 'deal' => [], 'hepsi' => []];
    foreach ($rows as $s) {
        $id  = (string)($s['STATUS_ID'] ?? '');
        $ad  = (string)($s['NAME'] ?? '');
        $ent = (string)($s['ENTITY_ID'] ?? '');
        if ($ent !== 'STATUS' && $ent !== 'DEAL_STAGE') continue;
        if ($id === '') continue;
        $out['hepsi'][] = ['entity' => $ent, 'ID' => $id, 'AD' => $ad, 'randevu_mu' => (bool)preg_match($regex, $ad)];
        if (!preg_match($regex, $ad)) continue;
        if ($ent === 'STATUS') $out['lead'][$id] = $ad; else $out['deal'][$id] = $ad;
    }
    return $out;
}

/** Lead detaylarını (sorumlu, başlık, randevu tarihi) toplu çeker. */
function xreLeadDetay(string $base, array $ids, string $dateField): array {
    $ids = array_values(array_unique(array_filter(array_map('strval', $ids))));
    if (!$ids) return [];
    $select = ['ID', 'TITLE', 'NAME', 'LAST_NAME', 'ASSIGNED_BY_ID', 'STATUS_ID', 'DATE_CREATE'];
    if ($dateField !== '') $select[] = $dateField;
    $map = [];
    foreach (array_chunk($ids, 50) as $chunk) {
        $res = xreBitrixCall($base, 'crm.lead.list', [
            'order'  => ['ID' => 'DESC'],
            'filter' => ['@ID' => $chunk],
            'select' => $select,
            'start'  => 0,
        ])['result'] ?? [];
        foreach ($res as $l) {
            $id = (string)($l['ID'] ?? ''); if ($id === '') continue;
            $ad = trim((string)($l['TITLE'] ?? ''));
            if ($ad === '') $ad = trim((string)($l['NAME'] ?? '') . ' ' . (string)($l['LAST_NAME'] ?? ''));
            if ($ad === '') $ad = 'Lead #' . $id;
            $map[$id] = [
                'ad'             => $ad,
                'temsilci_id'    => (string)($l['ASSIGNED_BY_ID'] ?? ''),
                'guncel_statu'   => (string)($l['STATUS_ID'] ?? ''),
                'randevu_tarihi' => $dateField !== '' ? (string)($l[$dateField] ?? '') : '',
            ];
        }
    }
    return $map;
}

/** Deal detaylarını (sorumlu ve başlık) toplu çeker. */
function xreDealDetay(string $base, array $ids): array {
    $ids = array_values(array_unique(array_filter(array_map('strval', $ids))));
    if (!$ids) return [];
    $map = [];
    foreach (array_chunk($ids, 50) as $chunk) {
        $res = xreBitrixCall($base, 'crm.deal.list', [
            'order'  => ['ID' => 'DESC'],
            'filter' => ['@ID' => $chunk],
            'select' => ['ID', 'TITLE', 'ASSIGNED_BY_ID', 'STAGE_ID'],
            'start'  => 0,
        ])['result'] ?? [];
        foreach ($res as $d) {
            $id = (string)($d['ID'] ?? '');
            if ($id === '') continue;
            $map[$id] = [
                'ad'           => trim((string)($d['TITLE'] ?? '')) ?: ('Deal #' . $id),
                'temsilci_id'  => (string)($d['ASSIGNED_BY_ID'] ?? ''),
                'guncel_statu' => (string)($d['STAGE_ID'] ?? ''),
            ];
        }
    }
    return $map;
}

try {
    // ================= KEŞİF =====================================
    if (strtolower((string)($_GET['action'] ?? '')) === 'discover') {
        $st = xreRandevuStatuleri($base, $STATUS_REGEX);

        $fields = xreBitrixCall($base, 'crm.lead.fields')['result'] ?? [];
        $tarihAdaylari = [];
        foreach ($fields as $key => $f) {
            $baslik = (string)($f['formLabel'] ?? ($f['title'] ?? ''));
            $tip    = (string)($f['type'] ?? '');
            if (($tip === 'datetime' || $tip === 'date')
                && (preg_match('~randevu|toplant|görüşme~iu', $baslik) || preg_match('~randevu~i', (string)$key))) {
                $tarihAdaylari[] = ['alan' => (string)$key, 'baslik' => $baslik, 'tip' => $tip];
            }
        }

        xreJson([
            'ok' => true,
            'aciklama' => 'randevu_mu=true olan lead statulerini randevu_lead_statuses e, dogru tarih alanini randevu_tarih_alani na yazin.',
            'otomatik_bulunan_lead_statuleri' => $st['lead'],
            'otomatik_bulunan_deal_asamalari' => $st['deal'],
            'randevu_tarih_alani_adaylari'    => $tarihAdaylari,
            'tum_statuler' => $st['hepsi'],
        ]);
    }

    // ================= SAYIM =====================================
    $from = xreInputDate('from');
    $to   = xreInputDate('to', true);
    if (!$from) $from = (new DateTimeImmutable('today'))->modify('-6 days');
    if (!$to)   $to   = (new DateTimeImmutable('today'))->modify('+1 day');

    $basis = strtolower((string)($_GET['basis'] ?? 'olusturma'));
    if (!in_array($basis, ['olusturma', 'gerceklesme'], true)) $basis = 'olusturma';

    $responsibleId = trim((string)($_GET['responsible_id'] ?? ''));
    $withRows = ($_GET['rows'] ?? '') === '1';
    $force    = ($_GET['force'] ?? '') === '1';

    $cacheKey = 'randevu2|' . $from->format('Y-m-d') . '|' . $to->format('Y-m-d') . '|' . $basis . '|' . $responsibleId . '|' . ($withRows ? 'r' : '');
    if (!$force && ($hit = xreCacheGet($cacheKey, $TTL)) !== null) {
        header('X-XRE-Cache: HIT');
        xreJson($hit);
    }

    $otomatik = false;
    $statuAdlari = [];
    if (!$LEAD_STATUSES && !$DEAL_STAGES) {
        $st = xreRandevuStatuleri($base, $STATUS_REGEX);
        $LEAD_STATUSES = array_keys($st['lead']);
        $DEAL_STAGES   = array_keys($st['deal']);
        $statuAdlari   = $st['lead'] + $st['deal'];
        $otomatik = true;
    }
    if (!$LEAD_STATUSES && !$DEAL_STAGES) {
        xreJson([
            'ok' => false,
            'error' => 'Adında "randevu" geçen statü bulunamadı.',
            'cozum' => 'action=discover ile statü listesini görüp randevu_lead_statuses ayarını elle doldurun.',
        ], 422);
    }

    $rows = [];
    $seen = [];
    $crmHost = rtrim((string)preg_replace('~/rest/.*$~', '', $base), '/');

    /* ---- Lead statü geçişleri (asıl kaynak) ------------------- */
    if ($LEAD_STATUSES) {
        $hist = xrePagedList($base, 'crm.stagehistory.list', [
            'entityTypeId' => 1,
            'order'  => ['ID' => 'DESC'],
            'filter' => [
                '>=CREATED_TIME' => $from->format(DATE_ATOM),
                '<CREATED_TIME'  => $to->format(DATE_ATOM),
            ],
            'select' => ['ID', 'OWNER_ID', 'CREATED_TIME', 'STATUS_ID', 'STAGE_ID'],
        ], $MAX_PAGES);

        $detay = xreLeadDetay($base, array_map(function ($h) { return (string)($h['OWNER_ID'] ?? ''); }, $hist), $DATE_FIELD);

        foreach ($hist as $h) {
            $lid = (string)($h['OWNER_ID'] ?? '');
            $historyStatus = (string)($h['STATUS_ID'] ?? ($h['STAGE_ID'] ?? ''));
            if ($historyStatus === '' || !in_array($historyStatus, $LEAD_STATUSES, true)) continue;
            if ($lid === '' || isset($seen['lead' . $lid])) continue;
            $d = $detay[$lid] ?? ['ad' => 'Lead #' . $lid, 'temsilci_id' => '', 'guncel_statu' => '', 'randevu_tarihi' => ''];
            if ($responsibleId !== '' && $d['temsilci_id'] !== $responsibleId) continue;
            $seen['lead' . $lid] = true;

            $rows[] = [
                'kaynak'          => 'Lead statü geçişi',
                'lead_id'         => $lid,
                'musteri'         => $d['ad'],
                'temsilci_id'     => $d['temsilci_id'],
                'temsilci'        => $PERSONEL[$d['temsilci_id']] ?? ('Kullanıcı #' . $d['temsilci_id']),
                'statu_id'        => $historyStatus,
                'statu_adi'       => $statuAdlari[$historyStatus] ?? '',
                'randevu_verildi' => (string)($h['CREATED_TIME'] ?? ''),
                'randevu_tarihi'  => $d['randevu_tarihi'],
                'guncel_statu'    => $d['guncel_statu'],
                'kart_url'        => $crmHost . '/crm/lead/details/' . $lid . '/',
            ];
        }
    }

    /* ---- Deal aşama geçişleri (varsa) ------------------------- */
    if ($DEAL_STAGES) {
        $hist = xrePagedList($base, 'crm.stagehistory.list', [
            'entityTypeId' => 2,
            'order'  => ['ID' => 'DESC'],
            'filter' => [
                '>=CREATED_TIME' => $from->format(DATE_ATOM),
                '<CREATED_TIME'  => $to->format(DATE_ATOM),
            ],
            'select' => ['ID', 'OWNER_ID', 'CREATED_TIME', 'STAGE_ID', 'STATUS_ID'],
        ], $MAX_PAGES);

        $dealDetay = xreDealDetay($base, array_map(function ($h) { return (string)($h['OWNER_ID'] ?? ''); }, $hist));

        foreach ($hist as $h) {
            $did = (string)($h['OWNER_ID'] ?? '');
            $historyStage = (string)($h['STAGE_ID'] ?? ($h['STATUS_ID'] ?? ''));
            if ($historyStage === '' || !in_array($historyStage, $DEAL_STAGES, true)) continue;
            if ($did === '' || isset($seen['deal' . $did])) continue;
            $d = $dealDetay[$did] ?? ['ad' => 'Deal #' . $did, 'temsilci_id' => '', 'guncel_statu' => ''];
            if ($responsibleId !== '' && $d['temsilci_id'] !== $responsibleId) continue;
            $seen['deal' . $did] = true;
            $rows[] = [
                'kaynak'          => 'Deal aşama geçişi',
                'lead_id'         => $did,
                'musteri'         => $d['ad'],
                'temsilci_id'     => $d['temsilci_id'],
                'temsilci'        => $PERSONEL[$d['temsilci_id']] ?? ('Kullanıcı #' . $d['temsilci_id']),
                'statu_id'        => $historyStage,
                'statu_adi'       => $statuAdlari[$historyStage] ?? '',
                'randevu_verildi' => (string)($h['CREATED_TIME'] ?? ''),
                'randevu_tarihi'  => '',
                'guncel_statu'    => $d['guncel_statu'],
                'kart_url'        => $crmHost . '/crm/deal/details/' . $did . '/',
            ];
        }
    }

    /* ---- "gerçekleşme" bazı ----------------------------------- */
    if ($basis === 'gerceklesme') {
        if ($DATE_FIELD === '') {
            xreJson([
                'ok' => false,
                'error' => 'basis=gerceklesme için randevu_tarih_alani ayarlanmalı.',
                'cozum' => 'action=discover çıktısındaki randevu_tarih_alani_adaylari listesinden doğru alanı config e yazın.',
            ], 422);
        }
        $rows = array_values(array_filter($rows, function ($r) use ($from, $to) {
            $d = xreParseDate($r['randevu_tarihi']);
            return $d && $d >= $from && $d < $to;
        }));
    }

    /* ---- Kırılımlar ------------------------------------------- */
    $byRep = []; $byDay = []; $byStatu = [];
    foreach ($rows as $r) {
        $rid = $r['temsilci_id'];
        if (!isset($byRep[$rid])) $byRep[$rid] = ['temsilci_id' => $rid, 'ad' => $r['temsilci'], 'randevu' => 0];
        $byRep[$rid]['randevu']++;

        $ref = $basis === 'gerceklesme' ? $r['randevu_tarihi'] : $r['randevu_verildi'];
        $d = xreParseDate($ref);
        if ($d) { $k = $d->format('Y-m-d'); $byDay[$k] = ($byDay[$k] ?? 0) + 1; }

        $sk = $r['statu_adi'] !== '' ? $r['statu_adi'] : $r['statu_id'];
        $byStatu[$sk] = ($byStatu[$sk] ?? 0) + 1;
    }
    usort($byRep, function ($a, $b) { return $b['randevu'] <=> $a['randevu']; });
    ksort($byDay);

    $tarihsiz = 0;
    if ($DATE_FIELD !== '') {
        foreach ($rows as $r) if (trim((string)$r['randevu_tarihi']) === '') $tarihsiz++;
    }

    $payload = [
        'ok' => true,
        'donem' => ['from' => $from->format('Y-m-d'), 'to' => $to->modify('-1 day')->format('Y-m-d')],
        'baz' => $basis === 'gerceklesme' ? 'Randevu tarihi döneme düşenler' : 'Randevu statüsüne çekilenler',
        'toplam_randevu' => count($rows),
        'temsilci_bazinda' => array_values($byRep),
        'gun_bazinda' => $byDay,
        'statu_bazinda' => $byStatu,
        'kullanilan_statuler' => ['lead' => $LEAD_STATUSES, 'deal' => $DEAL_STAGES, 'otomatik_tespit' => $otomatik],
        'randevu_tarihi_bos_kayit' => $DATE_FIELD !== '' ? $tarihsiz : null,
        'uretim' => (new DateTimeImmutable())->format(DATE_ATOM),
    ];
    if ($withRows) $payload['kayitlar'] = $rows;

    xreCacheSet($cacheKey, $payload);
    header('X-XRE-Cache: MISS');
    xreJson($payload);

} catch (Throwable $e) {
    xreJson(['ok' => false, 'error' => $e->getMessage()], 500);
}
