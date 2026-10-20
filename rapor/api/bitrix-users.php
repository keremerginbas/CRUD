<?php
declare(strict_types=1);
require __DIR__.'/bitrix-common.php';
$items=[];foreach(xrePersonelDetay() as $id=>$p)$items[]=['id'=>(string)$id,'name'=>$p['isim'],'dep'=>$p['dep']];
usort($items,fn($a,$b)=>strcoll($a['name'],$b['name']));
xreJson(['ok'=>true,'source'=>'personel-json','items'=>$items]);
