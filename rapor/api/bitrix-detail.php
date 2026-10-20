<?php
declare(strict_types=1);
require __DIR__.'/bitrix-common.php';
$cfg=xreLoadConfig();$base=$cfg['webhook_base'];
try{
    $id=trim((string)($_GET['id']??''));if($id===''||!ctype_digit($id))xreJson(['ok'=>false,'error'=>'Geçerli etkinlik ID gerekli.'],400);
    $response=xreBitrixCall($base,'crm.activity.get',['id'=>$id]);$row=$response['result']??null;
    if(!is_array($row))xreJson(['ok'=>false,'error'=>'Todo bulunamadı.'],404);
    if((int)($row['TYPE_ID']??0)!==6||strtoupper((string)($row['PROVIDER_ID']??''))!=='CRM_TODO')xreJson(['ok'=>false,'error'=>'Bu kayıt Evrensel Görev (Todo) değil.'],400);
    $lead=(string)($row['OWNER_ID']??'');$responsible=(string)($row['RESPONSIBLE_ID']??'');$personel=xrePersonel();
    $titles=xreResolveLeadTitles($base,[$lead]);$completed=strtoupper((string)($row['COMPLETED']??'N'))==='Y';$now=new DateTimeImmutable();
    $deadline=xreParseDate($row['DEADLINE']??null);$created=xreParseDate($row['CREATED']??null);
    $description=trim(strip_tags(html_entity_decode((string)($row['DESCRIPTION']??''),ENT_QUOTES|ENT_HTML5,'UTF-8')));
    xreJson(['ok'=>true,'source'=>'bitrix-live-todo-v7','item'=>[
        'id'=>$id,'lead_id'=>$lead,'lead_title'=>$titles[$lead]??('Lead #'.$lead),
        'responsible_id'=>$responsible,'responsible_name'=>$personel[$responsible]??('Kullanıcı #'.$responsible),
        'type'=>'Evrensel Görev (Todo)','subject'=>(string)($row['SUBJECT']??''),'description_text'=>$description,
        'created_at'=>$created ? $created->format(DATE_ATOM) : null,'deadline'=>$deadline ? $deadline->format(DATE_ATOM) : null,'completed'=>$completed,
        'status'=>$completed?'Tamamlandı':'Bekliyor','deadline_group'=>xreDeadlineGroup($deadline,$completed,$now),
        'crm_url'=>$lead!==''?'https://xre.bitrix24.com.tr/crm/lead/details/'.rawurlencode($lead).'/':null,
    ]]);
}catch(Throwable $e){xreJson(['ok'=>false,'error'=>$e->getMessage()],502);}
