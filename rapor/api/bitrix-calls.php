<?php
declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: private, max-age=60, stale-while-revalidate=300');
header('X-Content-Type-Options: nosniff');
if(($_SERVER['REQUEST_METHOD']??'GET')==='OPTIONS'){http_response_code(204);exit;}

function out(array $data,int $status=200):never{http_response_code($status);echo json_encode($data,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);exit;}
function configPath():?string{
  $root=isset($_SERVER['DOCUMENT_ROOT'])?rtrim((string)$_SERVER['DOCUMENT_ROOT'],'/\\'):'';
  foreach(array_filter([dirname(__DIR__,3).'/private/bitrix-config.php',$root!==''?dirname($root).'/private/bitrix-config.php':null,dirname(__DIR__,2).'/private/bitrix-config.php']) as $p){if(is_file($p))return $p;}
  return null;
}
function cfg():array{
  $p=configPath();if(!$p)out(['ok'=>false,'error'=>'/private/bitrix-config.php bulunamadı.'],500);
  $c=require $p;if(!is_array($c)||empty($c['webhook_base']))out(['ok'=>false,'error'=>'webhook_base yapılandırılmamış.'],500);
  $c['webhook_base']=rtrim((string)$c['webhook_base'],'/').'/';
  date_default_timezone_set((string)($c['timezone']??'Europe/Istanbul'));
  return $c;
}
function callB(string $base,string $method,array $params=[],int $timeout=8):array{
  $ch=curl_init($base.$method.'.json');
  curl_setopt_array($ch,[CURLOPT_POST=>true,CURLOPT_POSTFIELDS=>http_build_query($params),CURLOPT_RETURNTRANSFER=>true,CURLOPT_CONNECTTIMEOUT=>min(4,$timeout),CURLOPT_TIMEOUT=>$timeout,CURLOPT_SSL_VERIFYPEER=>true,CURLOPT_HTTPHEADER=>['Accept: application/json']]);
  $raw=curl_exec($ch);$err=curl_error($ch);$code=(int)curl_getinfo($ch,CURLINFO_RESPONSE_CODE);curl_close($ch);
  if($raw===false)throw new RuntimeException('Bitrix bağlantı hatası: '.$err);
  $d=json_decode((string)$raw,true);if(!is_array($d))throw new RuntimeException('Bitrix geçersiz yanıt döndürdü. HTTP '.$code);
  if(isset($d['error']))throw new RuntimeException(($d['error']??'BITRIX_ERROR').': '.($d['error_description']??''));
  return $d;
}
function batch(string $base,array $cmd,int $timeout=8):array{
  if(!$cmd)return [];
  $r=callB($base,'batch',['halt'=>0,'cmd'=>$cmd],$timeout);
  return is_array($r['result']['result']??null)?$r['result']['result']:[];
}
function isoStart(string $ymd):string{return $ymd.'T00:00:00+03:00';}
function isoEnd(string $ymd):string{return $ymd.'T23:59:59+03:00';}
function cacheFile(array $parts):string{$d=sys_get_temp_dir().'/xre-bitrix-calls-v5';if(!is_dir($d))@mkdir($d,0770,true);return $d.'/'.hash('sha256',json_encode($parts)).'.json';}

$personel=[
  '23180'=>'Abdullah Açıkgöz','17984'=>'Ali Karaoğlu','22186'=>'Ali Kemal Çınar','24600'=>'Anıl Emre Özkök',
  '1174'=>'Arda Kağan Ertaş','23562'=>'Burcu Kansu','25392'=>'Dilara Gençağa','23564'=>'Duygu Ayyayla',
  '24080'=>'Ebru Özkanoğlu','25314'=>'Hatice Aldemir','116'=>'Merve Gelleci','25258'=>'Murat Çakıroğlu',
  '25120'=>'Ozan Kabagöz','25316'=>'Özge Kaya','5778'=>'Tuğba Kütük','22182'=>'Zarife Ayoğlu',
  '11690'=>'Zeliha Bilginsoy','26306'=>'Meltem Aygün'
];
$c=cfg();$base=$c['webhook_base'];
try{
  $today=(new DateTimeImmutable())->format('Y-m-d');
  $start=(string)($_GET['start_date']??(new DateTimeImmutable('-30 days'))->format('Y-m-d'));
  $end=(string)($_GET['end_date']??$today);
  $min=max(0,(int)($_GET['min_duration']??0));$force=($_GET['force']??'')==='1';
  if(!preg_match('/^\d{4}-\d{2}-\d{2}$/',$start)||!preg_match('/^\d{4}-\d{2}-\d{2}$/',$end))out(['ok'=>false,'error'=>'Tarih biçimi YYYY-MM-DD olmalı.'],400);
  $cache=cacheFile([$start,$end,$min]);$ttl=max(60,(int)($c['calls_cache_seconds']??300));
  $stale=null;if(is_file($cache)){$candidate=json_decode((string)file_get_contents($cache),true);if(is_array($candidate))$stale=$candidate;}
  if(!$force&&$stale!==null&&time()-filemtime($cache)<$ttl){header('X-XRE-Cache: HIT');out($stale);}
  $lock=fopen($cache.'.lock','c');
  if(!$lock||!flock($lock,LOCK_EX|LOCK_NB)){
    if($stale!==null){$stale['stale']=true;$stale['refresh_in_progress']=true;header('X-XRE-Cache: STALE-BUSY');out($stale);}
    out(['ok'=>false,'error'=>'Bitrix verisi hazırlanıyor, kısa süre sonra tekrar deneyin.'],503);
  }
  $deadline=microtime(true)+90.0;$callsTruncated=false;$namesTruncated=false;
  $filter=['>=CALL_START_DATE'=>isoStart($start),'<=CALL_START_DATE'=>isoEnd($end)];
  if($min>0)$filter['>=CALL_DURATION']=$min;
  $all=[];$offset=0;$total=0;$maxPages=max(1,(int)($c['max_call_pages']??200));
  for($page=0;$page<$maxPages;$page++){
    $remaining=(int)floor($deadline-microtime(true));if($remaining<1){$callsTruncated=true;break;}
    $r=callB($base,'voximplant.statistic.get',['FILTER'=>$filter,'SORT'=>'CALL_START_DATE','ORDER'=>'DESC','start'=>$offset],min(8,$remaining));
    $rows=is_array($r['result']??null)?$r['result']:[];$total=(int)($r['total']??count($rows));
    foreach($rows as $row)$all[]=$row;
    if(count($rows)<50||count($all)>=$total)break;$offset+=50;
  }
  $entityKeys=[];
  foreach($all as $r){$t=strtoupper((string)($r['CRM_ENTITY_TYPE']??''));$id=(string)($r['CRM_ENTITY_ID']??'');if($id!==''&&in_array($t,['LEAD','CONTACT','COMPANY'],true))$entityKeys[$t.':'.$id]=[$t,$id];}
  $names=[];$chunks=array_chunk($entityKeys,50,true);
  foreach($chunks as $chunk){
    $remaining=(int)floor($deadline-microtime(true));if($remaining<1){$namesTruncated=true;break;}
    $cmd=[];$map=[];$i=0;foreach($chunk as $key=>[$t,$id]){$alias='e'.$i++;$method=$t==='LEAD'?'crm.lead.get':($t==='CONTACT'?'crm.contact.get':'crm.company.get');$cmd[$alias]=$method.'?id='.rawurlencode((string)$id);$map[$alias]=$key;}
    $res=batch($base,$cmd,min(8,$remaining));foreach($map as $alias=>$key){$v=$res[$alias]??null;if(!is_array($v))continue;[$t,$id]=$entityKeys[$key];if($t==='LEAD')$name=trim((string)($v['TITLE']??''));elseif($t==='CONTACT')$name=trim((string)($v['NAME']??'').' '.(string)($v['LAST_NAME']??''));else $name=trim((string)($v['TITLE']??''));if($name!=='')$names[$key]=$name;}}
  // Bilinmeyen kullanıcı ID'lerini Bitrix'ten çöz (öncelikli — isim çözümleme için zaman ayır)
  $unknownUids=[];
  foreach($all as $r){$uid=(string)($r['PORTAL_USER_ID']??'');if($uid!==''&&$uid!=='0'&&!isset($personel[$uid]))$unknownUids[$uid]=true;}
  if($unknownUids){
    $uidChunks=array_chunk(array_keys($unknownUids),50);
    foreach($uidChunks as $chunk){
      $remaining=(int)floor($deadline-microtime(true));if($remaining<3)break;
      $cmd=[];$uidMap=[];
      foreach($chunk as $i=>$uid){$alias='u'.$i;$cmd[$alias]='user.get?ID='.rawurlencode($uid);$uidMap[$alias]=$uid;}
      try{
        $res=batch($base,$cmd,min(10,$remaining));
        foreach($uidMap as $alias=>$uid){
          $v=$res[$alias]??null;
          $row=is_array($v)&&isset($v[0])?$v[0]:(is_array($v)?$v:null);
          if(is_array($row)){$name=trim((string)($row['NAME']??'').' '.(string)($row['LAST_NAME']??''));if($name!=='')$personel[$uid]=$name;}
        }
      }catch(Throwable $e){error_log('Kullanıcı çözümleme hatası: '.$e->getMessage());}
    }
  }

  $items=[];$byUser=[];
  foreach($all as $r){$uid=(string)($r['PORTAL_USER_ID']??'');$type=(int)($r['CALL_TYPE']??0);$failed=(string)($r['CALL_FAILED_CODE']??'');$et=strtoupper((string)($r['CRM_ENTITY_TYPE']??''));$eid=(string)($r['CRM_ENTITY_ID']??'');
    $typeLabel=[1=>'Giden',2=>'Gelen',3=>'Gelen (Yönlendirme)',4=>'Geri Arama',5=>'Bilgilendirme'][$type]??'Bilinmeyen';$result=$failed==='200'?'Başarılı':((string)($r['CALL_FAILED_REASON']??'')?:'Başarısız');
    $crmUrl=null;if($eid!==''){$part=$et==='LEAD'?'lead':($et==='CONTACT'?'contact':($et==='COMPANY'?'company':null));if($part)$crmUrl='https://xre.bitrix24.com.tr/crm/'.$part.'/details/'.rawurlencode($eid).'/';}
    $item=['id'=>(string)($r['ID']??''),'call_id'=>(string)($r['CALL_ID']??''),'employee_id'=>$uid,'employee_name'=>$personel[$uid]??('Kullanıcı #'.$uid),'phone_number'=>(string)($r['PHONE_NUMBER']??''),'call_duration'=>(int)($r['CALL_DURATION']??0),'call_start_date'=>(string)($r['CALL_START_DATE']??''),'call_type'=>(string)$type,'call_type_label'=>$typeLabel,'result_code'=>$failed,'result_label'=>$result,'crm_entity_type'=>$et,'crm_entity_id'=>$eid,'crm_name'=>$names[$et.':'.$eid]??'','crm_activity_id'=>(string)($r['CRM_ACTIVITY_ID']??''),'crm_url'=>$crmUrl];
    $items[]=$item;$byUser[$uid]=($byUser[$uid]??0)+1;
  }
  $payload=['ok'=>true,'source'=>'bitrix-telephony-live','generated_at'=>(new DateTimeImmutable())->format(DATE_ATOM),'filters'=>['start_date'=>$start,'end_date'=>$end,'min_duration'=>$min],'total'=>$total,'returned'=>count($items),'truncated'=>$callsTruncated||count($items)<$total,'budget_exhausted'=>$callsTruncated,'crm_names_incomplete'=>$namesTruncated,'by_user'=>$byUser,'items'=>$items];
  @file_put_contents($cache,json_encode($payload,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES),LOCK_EX);flock($lock,LOCK_UN);fclose($lock);header('X-XRE-Cache: MISS');out($payload);
}catch(Throwable $e){
  if(isset($lock)&&is_resource($lock)){flock($lock,LOCK_UN);fclose($lock);}
  if(isset($stale)&&is_array($stale)){$stale['stale']=true;$stale['refresh_error']='Yenileme başarısız';header('X-XRE-Cache: STALE-ERROR');out($stale);}
  out(['ok'=>false,'error'=>$e->getMessage(),'hint'=>'Webhook izinlerinde CRM ve Telefon/Telephony erişimini kontrol edin.'],502);
}
