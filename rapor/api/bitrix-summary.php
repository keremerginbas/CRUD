<?php
declare(strict_types=1);
require __DIR__.'/bitrix-common.php';

$cfg=xreLoadConfig();$base=$cfg['webhook_base'];
@set_time_limit(180);
try{
    $responsibleId=trim((string)($_GET['responsible_id']??''));
    $startDate=xreInputDate('start_date');
    $endExclusive=xreInputDate('end_date',true);
    $force=($_GET['force']??'')==='1';
    $ttl=(int)($cfg['cache_seconds']??120);
    $cacheKey='summary|'.$responsibleId.'|'.(string)($_GET['start_date']??'').'|'.(string)($_GET['end_date']??'');
    if(!$force){$cached=xreCacheGet($cacheKey,$ttl);if($cached){$cached['cache']='hit';xreJson($cached);}}
    $filter=xreBaseTodoFilter($responsibleId!==''?$responsibleId:null,$startDate,$endExclusive);
    $now=new DateTimeImmutable();$today=$now->setTime(0,0);$tomorrow=$today->modify('+1 day');
    $nextWeek=$today->modify('monday next week');$afterNext=$nextWeek->modify('+7 days');
    $sets=[];foreach(['overdue','today','forgotten_today','today_remaining','this_week','next_week','after_two_weeks','empty_deadline'] as $k)$sets[$k]=[];

    // --- Satır sayıları: taramadan, tek sayım çağrısıyla (Bitrix "total" döndürür) ---
    $countRows=function(array $f) use ($base): int {
        $r=xreBitrixCall($base,'crm.activity.list',['filter'=>$f,'select'=>['ID'],'start'=>0]);
        return (int)($r['total']??0);
    };
    $totalRows=$countRows($filter);
    $completedRows=$countRows($filter+['COMPLETED'=>'Y']);
    $waitingRows=max(0,$totalRows-$completedRows);
    $rows=['total_rows'=>$totalRows,'waiting_rows'=>$waitingRows,'completed_rows'=>$completedRows];

    // --- Deadline grupları: yalnızca AÇIK Todo'ları tara (küçük, tam ve hızlı) ---
    $openFilter=$filter;$openFilter['COMPLETED']='N';
    $lastId=null;$pages=0;$maxPages=max(20,(int)($cfg['max_summary_pages']??600));$truncated=false;
    do{
        $pageFilter=$openFilter;
        if($lastId!==null)$pageFilter['<ID']=$lastId; // ID DESC olduğu için sonraki sayfa daha küçük ID'ler
        $response=xreBitrixCall($base,'crm.activity.list',[
            'order'=>['ID'=>'DESC'],'filter'=>$pageFilter,
            'select'=>['ID','OWNER_ID','OWNER_TYPE_ID','DEADLINE'],
            'start'=>-1, // Bitrix'te pahalı toplam-sayımını kapatır -> çok daha hızlı
        ]);
        $items=$response['result']??[];if(!is_array($items))$items=[];
        if(!$items)break;
        foreach($items as $item){
            if((int)($item['OWNER_TYPE_ID']??0)!==1)continue;
            $lead=(string)($item['OWNER_ID']??'');if($lead==='')continue;
            $deadline=xreParseDate($item['DEADLINE']??null);
            if(!$deadline){$sets['empty_deadline'][$lead]=true;continue;}
            if($deadline<$today){$sets['overdue'][$lead]=true;continue;}
            if($deadline<$tomorrow){
                $sets['today'][$lead]=true;
                if($deadline<$now)$sets['forgotten_today'][$lead]=true;else $sets['today_remaining'][$lead]=true;
                continue;
            }
            if($deadline<$nextWeek){$sets['this_week'][$lead]=true;continue;}
            if($deadline<$afterNext){$sets['next_week'][$lead]=true;continue;}
            $sets['after_two_weeks'][$lead]=true;
        }
        $lastId=(int)($items[count($items)-1]['ID']??0); // DESC sıralıda son eleman en küçük ID
        $pages++;
        if(count($items)<50)break;            // son sayfa
        if($lastId<=0)break;
        if($pages>=$maxPages){$truncated=true;break;}
    }while(true);
    $counts=$rows;foreach($sets as $key=>$set)$counts[$key]=count($set);
    $personel=xrePersonel();
    $payload=[
        'ok'=>true,'source'=>'bitrix-live-todo-v7','cache'=>'miss','generated_at'=>$now->format(DATE_ATOM),
        'responsible_id'=>$responsibleId!==''?$responsibleId:null,
        'responsible_name'=>$responsibleId!==''?($personel[$responsibleId]??'Kullanıcı #'.$responsibleId):null,
        'count_mode'=>'todo_rows_and_unique_leads','truncated'=>$truncated,'pages_scanned'=>$pages,
        'date_filter'=>['field'=>'CREATED','start_date'=>$startDate ? $startDate->format('Y-m-d') : null,'end_date'=>$endExclusive ? $endExclusive->modify('-1 day')->format('Y-m-d') : null],
        'activity_filter'=>['OWNER_TYPE_ID'=>1,'TYPE_ID'=>6,'PROVIDER_ID'=>'CRM_TODO'],
        'counts'=>$counts,
        'definitions'=>[
            'total_rows'=>'Todo etkinlik satırı sayısı','completed_rows'=>'Tamamlanan Todo satırı','waiting_rows'=>'Açık Todo satırı',
            'overdue'=>'Bugünden önce deadlineı bulunan açık Todo kayıtlarındaki benzersiz lead',
            'today'=>'Bugün deadlineı bulunan açık Todo kayıtlarındaki benzersiz lead',
            'forgotten_today'=>'Bugün saati geçmiş açık Todo kayıtlarındaki benzersiz lead',
        ],
    ];
    if($ttl>0)xreCacheSet($cacheKey,$payload);
    xreJson($payload);
}catch(Throwable $e){xreJson(['ok'=>false,'error'=>$e->getMessage()],502);}