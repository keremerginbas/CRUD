import {useEffect, useState} from 'react';
import {ClipboardPaste, Download, EyeOff, Flame, Loader2, Trash2, Waypoints} from 'lucide-react';
import {fetchJson, postJson, type DensityDataset, type DensityPoint} from '@/lib/api';
import type {DensityMode} from './DensityLayer';
import {Button} from './ui/button';
import {Badge, Card, CardContent, CardHeader, CardTitle} from './ui/card';
import {Textarea} from './ui/input';
import {cn} from '@/lib/utils';

const THIS_YEAR=new Date().getFullYear();
const YEARS=Array.from({length:THIS_YEAR-2014},(_,i)=>THIS_YEAR-i);
type Loaded={year:number;province:string;district:string;points:DensityPoint[]};

// TKGM Parsel Sorgu > Analiz > Alım Satım Yoğunluğu: seçili il/ilçe için.
export function DensityPanel({province,district,districtId,loaded,onLoaded,mode,onMode}:{
 province:string;district:string;districtId:string;loaded:Loaded|null;onLoaded:(d:Loaded|null)=>void;
 mode:DensityMode|'off';onMode:(m:DensityMode|'off')=>void;
}){
 const [year,setYear]=useState(THIS_YEAR-1);
 const [busy,setBusy]=useState(false);
 const [msg,setMsg]=useState('');
 const [datasets,setDatasets]=useState<DensityDataset[]>([]);
 const [paste,setPaste]=useState(false);
 const [raw,setRaw]=useState('');
 const loadList=()=>fetchJson<{datasets:DensityDataset[]}>('/api/density/datasets').then(d=>setDatasets(d.datasets)).catch(()=>{});
 useEffect(()=>{void loadList()},[]);

 async function show(y:number,p:string,d:string){
  const r=await fetchJson<{points:DensityPoint[]}>('/api/density?'+new URLSearchParams({year:String(y),province:p,district:d}));
  onLoaded({year:y,province:p,district:d,points:r.points});if(mode==='off')onMode('heat');
  return r.points;
 }
 async function fromTkgm(){
  setBusy(true);setMsg('');
  try{
   const r=await postJson<{parcels:number;transactions:number}>('/api/density/fetch',{year,districtId:Number(districtId),province,district});
   await show(year,province,district);await loadList();
   setMsg(`TKGM: ${year} yılında ${district} ilçesinde ${r.transactions.toLocaleString('tr-TR')} işlem, ${r.parcels.toLocaleString('tr-TR')} parsel.`);
  }catch(e){setMsg((e instanceof Error?e.message:'TKGM verisi alınamadı.')+' Gerekirse TKGM yanıtını aşağıdan yapıştırın.');setPaste(true)}
  finally{setBusy(false)}
 }
 async function fromPaste(){
  setBusy(true);setMsg('');
  try{
   let rows:unknown;try{rows=JSON.parse(raw)}catch{throw Error('Geçerli JSON değil. TKGM Response sekmesindeki metnin tamamını yapıştırın.')}
   const r=await postJson<{parcels:number;transactions:number;invalid:number}>('/api/density/import',{year,province,district,rows});
   await show(year,province,district);await loadList();setRaw('');setPaste(false);
   setMsg(`${r.transactions.toLocaleString('tr-TR')} işlem, ${r.parcels.toLocaleString('tr-TR')} parsel kaydedildi${r.invalid?` (${r.invalid} hatalı satır atlandı)`:''}.`);
  }catch(e){setMsg(e instanceof Error?e.message:'Aktarılamadı.')}finally{setBusy(false)}
 }
 async function remove(d:DensityDataset){
  await fetchJson('/api/density?'+new URLSearchParams({year:String(d.year),province:d.province,district:d.district}),{method:'DELETE'}).catch(()=>{});
  if(loaded&&loaded.year===d.year&&loaded.district===d.district)onLoaded(null);
  await loadList();
 }
 const ready=Boolean(province&&district&&districtId);
 const total=loaded?.points.reduce((s,p)=>s+p.count,0)??0;
 return <Card>
  <CardHeader><CardTitle className="flex items-center gap-2"><Flame size={16} className="text-orange-500"/>Alım Satım Yoğunluğu</CardTitle>
   <Badge tone="neutral">TKGM</Badge></CardHeader>
  <CardContent className="space-y-3">
   <div className="flex gap-2">
    <select value={year} onChange={e=>setYear(Number(e.target.value))} aria-label="Yıl"
     className="h-9 rounded-lg border border-input bg-card px-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/30">
     {YEARS.map(y=><option key={y} value={y}>{y}</option>)}</select>
    <Button size="sm" className="h-9 flex-1" disabled={!ready||busy} onClick={fromTkgm}>
     {busy?<Loader2 size={14} className="animate-spin"/>:<Download size={14}/>}{ready?`${district} için getir`:'Önce il ve ilçe seçin'}</Button>
   </div>
   <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1 text-xs font-semibold" role="radiogroup" aria-label="Görüntüleme şekli">
    {([['heat','Yoğunluk',Flame],['cluster','Küme',Waypoints],['off','Gizle',EyeOff]] as const).map(([m,label,Icon])=>
     <button key={m} role="radio" aria-checked={mode===m} disabled={!loaded&&m!=='off'} onClick={()=>onMode(m)}
      className={cn('flex h-8 items-center justify-center gap-1 rounded-md transition disabled:opacity-40',mode===m?'bg-card text-foreground shadow-sm':'text-muted-foreground hover:text-foreground')}>
      <Icon size={13}/>{label}</button>)}
   </div>
   {loaded&&<p className="text-xs text-foreground/80">Haritada: <b>{loaded.district} {loaded.year}</b> · {total.toLocaleString('tr-TR')} işlem · {loaded.points.length.toLocaleString('tr-TR')} parsel</p>}
   {msg&&<p className="text-xs leading-relaxed text-muted-foreground">{msg}</p>}
   {datasets.length>0&&<div className="flex flex-wrap gap-1">{datasets.map(d=>
    <span key={`${d.year}${d.province}${d.district}`} className="inline-flex items-center overflow-hidden rounded-full border border-border text-[11px]">
     <button className="px-2 py-0.5 hover:bg-muted" onClick={()=>void show(d.year,d.province,d.district)} title={`${d.transactions} işlem`}>{d.district} {d.year}</button>
     <button className="border-l border-border px-1.5 py-0.5 text-muted-foreground hover:bg-parcel/10 hover:text-parcel" aria-label="Sil" onClick={()=>void remove(d)}><Trash2 size={11}/></button>
    </span>)}</div>}
   <button className="flex items-center gap-1 text-[11px] font-medium text-primary hover:underline" onClick={()=>setPaste(v=>!v)}><ClipboardPaste size={12}/>TKGM yanıtını yapıştır</button>
   {paste&&<div className="space-y-2">
    <Textarea value={raw} onChange={e=>setRaw(e.target.value)} placeholder='[{"parselId":..., "enlem":..., "boylam":..., "sayi":...}]' className="min-h-20 font-mono text-[11px]"/>
    <Button size="sm" variant="outline" className="w-full" disabled={!ready||!raw.trim()||busy} onClick={fromPaste}>{year} · {district||'ilçe'} olarak kaydet</Button>
    <p className="text-[11px] text-muted-foreground">parselsorgu.tkgm.gov.tr → Analiz → Alım Satım Yoğunluğu → F12 Network → <code>analiz?AnalizTip=1…</code> → Response.</p>
   </div>}
  </CardContent>
 </Card>;
}
