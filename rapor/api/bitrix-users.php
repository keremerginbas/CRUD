<?php
declare(strict_types=1);
require __DIR__.'/bitrix-common.php';
$items=[];foreach(xrePersonel() as $id=>$name)$items[]=['id'=>$id,'name'=>$name];
usort($items,fn($a,$b)=>strcoll($a['name'],$b['name']));
xreJson(['ok'=>true,'source'=>'static-personel-v7','items'=>$items]);
