import {useEffect, useRef, useState} from 'react';
import {Building2, Calculator, Droplets, ExternalLink, FileSpreadsheet, Landmark, Loader2, MapPinned, Scale, Trash2, TrendingUp, Upload, type LucideIcon} from 'lucide-react';
import {fetchJson, type ComparableSummary, type Market, type OfficialSource} from '@/lib/api';
import {importListings, readListingFile} from '@/lib/comparables';
import {Button} from './ui/button';
import {Badge, Card, CardContent, CardHeader, CardTitle} from './ui/card';

const tl=(n:number)=>n.toLocaleString('tr-TR',{maximumFractionDigits:0})+' ₺';
const SOURCE_LABEL:Record<string,string>={sahibinden:'Sahibinden',emlakjet:'Emlakjet',hepsiemlak:'Hepsiemlak'};

// İlan5 eklentisinden emsal ilan aktarımı.
export function ComparablesImport({onChange}:{onChange?:()=>void}){
 const [summary,setSummary]=useState<ComparableSummary|null>(null);
 const [busy,setBusy]=useState('');
 const [msg,setMsg]=useState('');
 const input=useRef<HTMLInputElement>(null);
 const load=()=>fetchJson<ComparableSummary>('/api/comparables/summary').then(setSummary).catch(e=>setMsg(e.message));
 useEffect(()=>{void load()},[]);
 async function onFile(file:File){
  setMsg('');setBusy('Dosya okunuyor…');
  try{
   const rows=await readListingFile(file);
   const r=await importListings(rows,(d,t)=>setBusy(`Aktarılıyor ${d}/${t}`));
   setMsg(`${r.saved} ilan kaydedildi${r.skipped?`, ${r.skipped} kayıt atlandı (eksik/desteklenmeyen site)`:''}. Satıcı adı ve telefon saklanmadı.`);
   await load();onChange?.();
  }catch(e){setMsg(e instanceof Error?e.message:'Aktarım başarısız.')}finally{setBusy('')}
 }
 async function clear(){
  if(!confirm('Tüm emsal ilanlar silinsin mi?'))return;
  await fetchJson('/api/comparables',{method:'DELETE'}).catch(()=>{});await load();onChange?.();
 }
 return <Card>
  <CardHeader><CardTitle className="flex items-center gap-2"><FileSpreadsheet size={16} className="text-primary"/>Emsal ilanlar</CardTitle>
   <Badge tone={summary?.usable?'ok':'neutral'}>{summary?`${summary.usable} arsa emsali`:'—'}</Badge></CardHeader>
  <CardContent className="space-y-3">
   <p className="text-xs leading-relaxed text-muted-foreground">İlan5 eklentisinin panelinden <b>Yedek (JSON)</b> veya <b>CSV</b> dışa aktarıp buraya yükleyin. Sahibinden, Emlakjet ve Hepsiemlak ilanları parselin ilçe/mahallesiyle eşleştirilir; m² fiyatları kodda hesaplanır.</p>
   {summary&&summary.districts.length>0&&<div className="flex flex-wrap gap-1">{summary.districts.slice(0,8).map(d=><Badge key={d.city+d.district}>{d.district} · {d.n}</Badge>)}</div>}
   <div className="flex gap-2">
    <Button variant="outline" size="sm" className="flex-1" disabled={!!busy} onClick={()=>input.current?.click()}>
     {busy?<Loader2 size={14} className="animate-spin"/>:<Upload size={14}/>}{busy||'İlan5 dosyası yükle'}</Button>
    {!!summary?.total&&<Button variant="ghost" size="sm" onClick={clear} aria-label="Emsalleri sil"><Trash2 size={14}/></Button>}
   </div>
   <input ref={input} type="file" accept=".json,.csv,application/json,text/csv" className="hidden" onChange={e=>{const f=e.target.files?.[0];if(f)void onFile(f);e.target.value=''}}/>
   {msg&&<p className="text-xs text-foreground/80">{msg}</p>}
  </CardContent>
 </Card>;
}

function Stat({label,value,strong}:{label:string;value:string;strong?:boolean}){
 return <div className="rounded-md bg-muted/60 px-2.5 py-2"><div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
  <div className={strong?'text-sm font-bold text-primary':'text-sm font-semibold'}>{value}</div></div>;
}

// Kodda hesaplanan emsal sonucu; AI metninden bağımsız gösterilir.
export function MarketResult({market}:{market:Market}){
 if(!market.available)return <Card><CardHeader><CardTitle className="flex items-center gap-2"><TrendingUp size={16} className="text-amber-500"/>Emsal piyasa</CardTitle><Badge tone="warn">Yetersiz veri</Badge></CardHeader>
  <CardContent className="text-xs leading-relaxed text-muted-foreground">{market.reason} İlçede {market.totals.district}, mahallede {market.totals.neighborhood} uygun arsa ilanı var.</CardContent></Card>;
 const s=market.stats!,e=market.estimate;
 return <Card>
  <CardHeader><CardTitle className="flex items-center gap-2"><TrendingUp size={16} className="text-emerald-500"/>Emsal piyasa (ilan fiyatı)</CardTitle>
   <Badge tone="ok">{s.n} emsal · {market.scope==='neighborhood'?'mahalle':'ilçe'}{market.sizeBand?' · benzer büyüklük':''}</Badge></CardHeader>
  <CardContent className="space-y-3">
   <div className="grid grid-cols-3 gap-1.5">
    <Stat label="m² medyan" value={tl(s.median)} strong/><Stat label="m² alt (%25)" value={tl(s.p25)}/><Stat label="m² üst (%75)" value={tl(s.p75)}/>
   </div>
   {e&&<div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
    <div className="text-[11px] font-semibold text-muted-foreground">{e.areaM2.toLocaleString('tr-TR')} m² için istenen fiyat aralığı</div>
    <div className="mt-0.5 text-lg font-bold text-primary">{tl(e.mid)}</div>
    <div className="text-xs text-muted-foreground">{tl(e.low)} – {tl(e.high)}</div>
   </div>}
   {market.sameParcelListings.length>0&&<div className="rounded-md bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">Bu ada/parsel numarasıyla {market.sameParcelListings.length} ilan bulundu: {market.sameParcelListings.map((c,i)=><a key={i} className="ml-1 underline" href={c.url} target="_blank" rel="noopener noreferrer">{tl(c.price)}</a>)}</div>}
   <ol className="divide-y divide-border rounded-lg border border-border text-xs">
    {market.comparables.map((c,i)=><li key={c.source+c.listingId} className="flex items-center gap-2 px-2.5 py-1.5">
     <span className="w-6 shrink-0 font-mono text-muted-foreground">E{i+1}</span>
     <a href={c.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate font-medium hover:text-primary hover:underline" title={c.title}>{c.title||c.listingId}</a>
     <span className="shrink-0 text-muted-foreground">{c.area.toLocaleString('tr-TR')} m²</span>
     <span className="w-20 shrink-0 text-right font-semibold">{tl(c.pricePerM2)}/m²</span>
    </li>)}
   </ol>
   <p className="text-[11px] leading-relaxed text-muted-foreground">Uç değerler ({s.trimmed}) ayıklandı. İlan fiyatı satış fiyatı değildir; {market.comparables.map(c=>SOURCE_LABEL[c.source]||c.source).filter((v,i,a)=>a.indexOf(v)===i).join(', ')} ilanlarındaki imar bilgisi ilan sahibinin beyanıdır.</p>
  </CardContent>
 </Card>;
}

const GROUP_ICON:Record<string,LucideIcon>={Kadastro:MapPinned,İmar:Building2,Değer:Scale,Kısıt:Droplets,Maliyet:Calculator};
export function OfficialSources({sources}:{sources:OfficialSource[]}){
 return <Card>
  <CardHeader><CardTitle className="flex items-center gap-2"><Landmark size={16} className="text-violet-500"/>Resmî kaynak kontrolü</CardTitle></CardHeader>
  <CardContent className="space-y-1.5 p-3">
   {sources.map(s=>{const Icon=GROUP_ICON[s.group]||Landmark;return <a key={s.id} href={s.url} target="_blank" rel="noopener noreferrer"
    className="group flex items-start gap-2.5 rounded-lg p-2 transition hover:bg-muted">
    <span className="grid size-7 shrink-0 place-items-center rounded-md bg-violet-500/10 text-violet-500"><Icon size={14}/></span>
    <span className="min-w-0 flex-1"><span className="flex items-center gap-1 text-[13px] font-semibold">{s.title}<ExternalLink size={11} className="text-muted-foreground opacity-0 transition group-hover:opacity-100"/></span>
     <span className="block text-[11px] leading-snug text-muted-foreground">{s.detail}{!s.direct&&' (arama bağlantısı)'}</span></span>
   </a>})}
  </CardContent>
 </Card>;
}
