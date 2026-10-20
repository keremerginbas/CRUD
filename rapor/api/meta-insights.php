<?php
declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');

function mout(array $data,int $status=200):never{http_response_code($status);echo json_encode($data,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);exit;}

function mConfigPath():?string{
    $root=isset($_SERVER['DOCUMENT_ROOT'])?rtrim((string)$_SERVER['DOCUMENT_ROOT'],'/\\'):'';
    $cands=array_filter([
        dirname(__DIR__,3).'/private/meta-config.php',
        $root!==''?dirname($root).'/private/meta-config.php':null,
        dirname(__DIR__,2).'/private/meta-config.php',
    ]);
    foreach($cands as $p){if(is_file($p))return $p;}
    return null;
}
function mCfg():array{
    $p=mConfigPath();
    if(!$p)mout(['ok'=>false,'error'=>'/private/meta-config.php bulunamadı.'],500);
    $c=require $p;
    if(!is_array($c)||empty($c['ad_account_id'])||empty($c['access_token'])||$c['access_token']==='BURAYA_TOKEN_YAPISTIR')
        mout(['ok'=>false,'error'=>'meta-config.php içinde ad_account_id ve access_token doldurulmalı.'],500);
    date_default_timezone_set((string)($c['timezone']??'Europe/Istanbul'));
    return $c;
}
function mCacheFile(array $parts):string{$d=sys_get_temp_dir().'/xre-meta-cache-v1';if(!is_dir($d))@mkdir($d,0770,true);return $d.'/'.hash('sha256',json_encode($parts)).'.json';}

function mGet(string $url):array{
    $ch=curl_init($url);
    curl_setopt_array($ch,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_CONNECTTIMEOUT=>10,CURLOPT_TIMEOUT=>60,CURLOPT_SSL_VERIFYPEER=>true,CURLOPT_HTTPHEADER=>['Accept: application/json']]);
    $raw=curl_exec($ch);$err=curl_error($ch);$code=(int)curl_getinfo($ch,CURLINFO_RESPONSE_CODE);curl_close($ch);
    if($raw===false)throw new RuntimeException('Meta bağlantı hatası: '.$err);
    $d=json_decode((string)$raw,true);
    if(!is_array($d))throw new RuntimeException('Meta geçersiz yanıt (HTTP '.$code.')');
    if(isset($d['error']))throw new RuntimeException(($d['error']['message']??'META_ERROR'));
    return $d;
}

$c=mCfg();
@set_time_limit(90);
try{
    $preset=preg_replace('/[^a-z0-9_]/','',(string)($_GET['date_preset']??$c['default_date_preset']??'last_90d'));
    if($preset==='')$preset='last_90d';
    $force=($_GET['force']??'')==='1';

    // --- ÖZEL ARALIK (custom) desteği ---
    $since=''; $until='';
    if($preset==='custom'){
        $since=(string)($_GET['since']??'');
        $until=(string)($_GET['until']??'');
        $ok=fn(string $d):bool=>(bool)preg_match('/^\d{4}-\d{2}-\d{2}$/',$d);
        if(!$ok($since)||!$ok($until)) mout(['ok'=>false,'error'=>'Özel aralık için since ve until (YYYY-MM-DD) zorunlu.'],400);
        if($since>$until){$t=$since;$since=$until;$until=$t;}
        // Meta en fazla 37 ay geriye izin verir; ileri tarihi bugüne çek
        $bugun=(new DateTimeImmutable('today'))->format('Y-m-d');
        if($until>$bugun)$until=$bugun;
    }

    $ttl=max(30,(int)($c['cache_seconds']??300));
    $cache=mCacheFile([$c['ad_account_id'],$preset,$since,$until,$c['api_version']]);
    if(!$force&&is_file($cache)&&time()-filemtime($cache)<$ttl){
        $d=json_decode((string)file_get_contents($cache),true);
        if(is_array($d)){$d['cache']='hit';mout($d);}
    }

    $ver=(string)($c['api_version']??'v25.0');
    $acct=(string)$c['ad_account_id'];
    $leadTypes=is_array($c['lead_action_types']??null)?$c['lead_action_types']:['lead'];
    $fields='campaign_name,spend,impressions,reach,clicks,ctr,frequency,actions';
    $q=['level'=>'campaign','fields'=>$fields,'limit'=>200,'access_token'=>$c['access_token']];
    if($preset==='custom'){
        $q['time_range']=json_encode(['since'=>$since,'until'=>$until]);
    }else{
        $q['date_preset']=$preset;
    }
    $url='https://graph.facebook.com/'.$ver.'/'.rawurlencode($acct).'/insights?'.http_build_query($q);

    $rows=[];$pages=0;$now=(new DateTimeImmutable())->format(DATE_ATOM);
    while($url&&$pages<25){
        $resp=mGet($url);$pages++;
        foreach(($resp['data']??[]) as $row){
            // Lead sayısını öncelik sırasına göre bul
            $actions=[];foreach(($row['actions']??[]) as $a){$actions[(string)($a['action_type']??'')]=(float)($a['value']??0);}
            $lead=0;foreach($leadTypes as $t){if(isset($actions[$t])){$lead=(int)round($actions[$t]);break;}}
            $spend=(float)($row['spend']??0);
            $rows[]=[
                'cekim_tarihi'=>$now,'donem'=>($preset==='custom'?($since.' – '.$until):$preset),
                'kampanya'=>(string)($row['campaign_name']??'—'),
                'harcama_tl'=>round($spend,2),
                'gosterim'=>(int)($row['impressions']??0),
                'erisim'=>(int)($row['reach']??0),
                'tiklama'=>(int)($row['clicks']??0),
                'ctr_yuzde'=>round((float)($row['ctr']??0),2),
                'siklik'=>round((float)($row['frequency']??0),2),
                'sonuc_lead'=>$lead,
                'lead_basi_maliyet_tl'=>$lead>0?round($spend/$lead,2):0,
            ];
        }
        $url=$resp['paging']['next']??'';
    }

    usort($rows,fn($a,$b)=>$b['harcama_tl']<=>$a['harcama_tl']);
    $totSpend=array_sum(array_column($rows,'harcama_tl'));
    $totLead=array_sum(array_column($rows,'sonuc_lead'));
    $payload=[
        'ok'=>true,'source'=>'meta-insights','cache'=>'miss','generated_at'=>$now,
        'date_preset'=>($preset==='custom'?($since.' – '.$until):$preset),
        'since'=>$since?:null,'until'=>$until?:null,
        'ad_account_id'=>$acct,'campaign_count'=>count($rows),
        'totals'=>['harcama_tl'=>round($totSpend,2),'lead'=>$totLead,'ort_lead_maliyet_tl'=>$totLead>0?round($totSpend/$totLead,2):0],
        'campaigns'=>$rows,
    ];
    @file_put_contents($cache,json_encode($payload,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES),LOCK_EX);
    mout($payload);
}catch(Throwable $e){mout(['ok'=>false,'error'=>$e->getMessage(),'hint'=>'meta-config token/izin (ads_read) ve hesap durumunu kontrol edin.'],502);}