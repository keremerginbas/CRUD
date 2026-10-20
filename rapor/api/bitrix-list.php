<?php
declare(strict_types=1);
require __DIR__.'/bitrix-common.php';
$cfg=xreLoadConfig();$base=$cfg['webhook_base'];
@set_time_limit(180);
try{
    $page=max(1,(int)($_GET['page']??1));$limit=max(10,min(50,(int)($_GET['limit']??50)));
    $scope=strtolower(trim((string)($_GET['scope']??'open')));if(!in_array($scope,['open','completed','all'],true))$scope='open';
    $group=strtolower(trim((string)($_GET['group']??'all')));$responsibleId=trim((string)($_GET['responsible_id']??''));$q=trim((string)($_GET['q']??''));
    $startDate=xreInputDate('start_date');$endExclusive=xreInputDate('end_date',true);
    $filter=xreBaseTodoFilter($responsibleId!==''?$responsibleId:null,$startDate,$endExclusive);
    if($scope==='open')$filter['COMPLETED']='N';elseif($scope==='completed')$filter['COMPLETED']='Y';
    $now=new DateTimeImmutable();$today=$now->setTime(0,0);$tomorrow=$today->modify('+1 day');$nextWeek=$today->modify('monday next week');$afterNext=$nextWeek->modify('+7 days');
    if($group!=='all')$filter['COMPLETED']='N';
    if($group==='overdue')$filter['<DEADLINE']=$today->format(DATE_ATOM);
    elseif($group==='forgotten_today'){$filter['>=DEADLINE']=$today->format(DATE_ATOM);$filter['<DEADLINE']=$now->format(DATE_ATOM);}
    elseif($group==='today'){$filter['>=DEADLINE']=$today->format(DATE_ATOM);$filter['<DEADLINE']=$tomorrow->format(DATE_ATOM);}
    elseif($group==='today_remaining'){$filter['>=DEADLINE']=$now->format(DATE_ATOM);$filter['<DEADLINE']=$tomorrow->format(DATE_ATOM);}
    elseif($group==='this_week'){$filter['>=DEADLINE']=$tomorrow->format(DATE_ATOM);$filter['<DEADLINE']=$nextWeek->format(DATE_ATOM);}
    elseif($group==='next_week'){$filter['>=DEADLINE']=$nextWeek->format(DATE_ATOM);$filter['<DEADLINE']=$afterNext->format(DATE_ATOM);}
    elseif($group==='after_two_weeks')$filter['>=DEADLINE']=$afterNext->format(DATE_ATOM);
    elseif($group==='empty_deadline')$filter['DEADLINE']='';
    if($q!=='')$filter['%SUBJECT']=$q;
    $response=xreBitrixCall($base,'crm.activity.list',[
        'order'=>['ID'=>'DESC'],'filter'=>$filter,
        'select'=>['ID','OWNER_ID','OWNER_TYPE_ID','SUBJECT','CREATED','DEADLINE','COMPLETED','STATUS','RESPONSIBLE_ID','DESCRIPTION'],
        'start'=>($page-1)*$limit,
    ]);
    $raw=$response['result']??[];if(!is_array($raw))$raw=[];
    $leadTitles=xreResolveLeadTitles($base,array_column($raw,'OWNER_ID'));$personel=xrePersonel();$items=[];
    foreach($raw as $row){
        $lead=(string)($row['OWNER_ID']??'');$responsible=(string)($row['RESPONSIBLE_ID']??'');$completed=strtoupper((string)($row['COMPLETED']??'N'))==='Y';
        $deadline=xreParseDate($row['DEADLINE']??null);$created=xreParseDate($row['CREATED']??null);
        $items[]=[
            'id'=>(string)($row['ID']??''),'lead_id'=>$lead,'lead_title'=>$leadTitles[$lead]??('Lead #'.$lead),
            'responsible_id'=>$responsible,'responsible_name'=>$personel[$responsible]??('Kullanıcı #'.$responsible),
            'type'=>'Evrensel Görev (Todo)','subject'=>(string)($row['SUBJECT']??''),'created_at'=>$created ? $created->format(DATE_ATOM) : null,
            'deadline'=>$deadline ? $deadline->format(DATE_ATOM) : null,'completed'=>$completed,'status'=>$completed?'Tamamlandı':'Bekliyor',
            'deadline_group'=>xreDeadlineGroup($deadline,$completed,$now),
            'crm_url'=>$lead!==''?'https://xre.bitrix24.com.tr/crm/lead/details/'.rawurlencode($lead).'/':null,
        ];
    }
    $total=(int)($response['total']??count($items));
    xreJson(['ok'=>true,'source'=>'bitrix-live-todo-v7','generated_at'=>$now->format(DATE_ATOM),
        'pagination'=>['page'=>$page,'limit'=>$limit,'total_rows'=>$total,'pages'=>(int)max(1,ceil($total/$limit)),'has_next'=>$page*$limit<$total],
        'filters'=>['scope'=>$scope,'group'=>$group,'responsible_id'=>$responsibleId?:null,'q'=>$q?:null,'fixed_type'=>'CRM_TODO'],
        'items'=>$items]);
}catch(Throwable $e){xreJson(['ok'=>false,'error'=>$e->getMessage()],502);}