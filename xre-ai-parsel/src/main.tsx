import React, {useCallback, useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {AnimatePresence, MotionConfig, motion} from 'motion/react';
import {ChevronRight, LogOut, Database, FileUp, Layers, ListChecks, LocateFixed, Save, Search, Sparkles, Tag} from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './style.css';
import {fetchBoundary, fetchJson, postJson, type AnalysisResponse, type Health, type OfficialSource, type ParcelResponse, type Pin, type Region, type RegionLevel, type StoredParcel} from '@/lib/api';
import {ComparablesImport, DensityResult, MarketResult, OfficialSources} from '@/components/MarketPanels';
import {DensityPanel} from '@/components/DensityPanel';
import {AuthGate, logout} from '@/components/AuthGate';
import {DensityLegend, type DensityMode} from '@/components/DensityLayer';
import type {DensityPoint} from '@/lib/api';
import {MapView, type MapFocus} from '@/components/MapView';
import {MarkersTable} from '@/components/MarkersTable';
import {AnalysisView} from '@/components/AnalysisView';
import {RegionCombobox} from '@/components/ui/region-combobox';
import {Button} from '@/components/ui/button';
import {Input, Label, Textarea} from '@/components/ui/input';
import {Badge, Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';
import {Tabs, TabsList, TabsPanel, TabsTab} from '@/components/ui/tabs';

const BOUNDARY_ZOOM:Record<RegionLevel,number>={province:9,district:12,neighborhood:15};

function useRegionList(url:string|null,onError:(m:string)=>void){
 const [items,setItems]=useState<Region[]>([]);
 const [loading,setLoading]=useState(false);
 useEffect(()=>{
  setItems([]);
  if(!url)return;
  let active=true;setLoading(true);
  fetchJson<{items:Region[]}>(url).then(d=>{if(active)setItems(d.items||[])})
   .catch(e=>{if(active)onError(e.message)}).finally(()=>{if(active)setLoading(false)});
  return()=>{active=false};
 },[url]);
 return {items,loading};
}

function Kv({label,children}:{label:string;children:React.ReactNode}){
 return <div className="flex items-baseline justify-between gap-3 border-b border-border py-2 text-sm last:border-0">
  <span className="text-muted-foreground">{label}</span><b className="text-right font-semibold text-foreground">{children}</b>
 </div>;
}

function App(){
 const [health,setHealth]=useState<Health|null>(null);
 const [provinceId,setProvinceId]=useState('');
 const [districtId,setDistrictId]=useState('');
 const [neighborhoodId,setNeighborhoodId]=useState('');
 const [regionsError,setRegionsError]=useState('');
 const [boundary,setBoundary]=useState<GeoJSON.Feature|null>(null);
 const [boundaryNote,setBoundaryNote]=useState('');
 const [block,setBlock]=useState('');
 const [parcel,setParcel]=useState('');
 const [parcelGeometry,setParcelGeometry]=useState<GeoJSON.GeoJsonObject|null>(null);
 const [parcelKey,setParcelKey]=useState('');
 const [focus,setFocus]=useState<MapFocus|null>(null);
 const [parcelResult,setParcelResult]=useState<ParcelResponse|null>(null);
 const [searching,setSearching]=useState(false);
 const [queryingCoordinate,setQueryingCoordinate]=useState(false);
 const [pin,setPin]=useState<Pin|null>(null);
 const [showSelectionPin,setShowSelectionPin]=useState(true);
 const [focusPin,setFocusPin]=useState<Pin|null>(null);
 const [note,setNote]=useState('');
 const [satellite,setSatellite]=useState(true);
 const [labels,setLabels]=useState(true);
 const [analysis,setAnalysis]=useState('');
 const [analysisData,setAnalysisData]=useState<AnalysisResponse|null>(null);
 const [sources,setSources]=useState<OfficialSource[]>([]);
 const [analyzing,setAnalyzing]=useState(false);
 const [message,setMessage]=useState('İl seçerek başlayın. Her seçimde ilgili idari sınır haritada kırmızı çizgiyle gösterilir.');
 const [stored,setStored]=useState<Pin[]>([]);
 const [showFavorites,setShowFavorites]=useState(true);
 const [showPins,setShowPins]=useState(true);
 const [tab,setTab]=useState<string>('query');
 const [density,setDensity]=useState<{year:number;province:string;district:string;points:DensityPoint[]}|null>(null);
 const [densityMode,setDensityMode]=useState<DensityMode|'off'>('heat');

 const regionError=useCallback((m:string)=>{setRegionsError(m);setMessage('İdari liste alınamadı: '+m)},[]);
 const provinces=useRegionList('/api/regions/provinces',regionError);
 const districts=useRegionList(provinceId?`/api/regions/districts/${provinceId}`:null,regionError);
 const neighborhoods=useRegionList(districtId?`/api/regions/neighborhoods/${districtId}`:null,regionError);
 const nameOf=(list:Region[],id:string)=>list.find(v=>String(v.id)===id)?.name||'';
 const selectedProvince=nameOf(provinces.items,provinceId);
 const selectedDistrict=nameOf(districts.items,districtId);
 const selectedNeighborhood=nameOf(neighborhoods.items,neighborhoodId);

 useEffect(()=>{
  fetchJson<Health>('/api/health').then(setHealth).catch(()=>setHealth(null));
  fetchJson<{markers:Pin[]}>('/api/markers').then(d=>{if(Array.isArray(d.markers))setStored(d.markers)})
   .catch(e=>setMessage('Kayıtlı işaretçiler yüklenemedi: '+e.message));
 },[]);

 // TKGM Parsel Sorgu gibi: en alt seçili idari birimin sınırını çiz ve ona yakınlaş.
 useEffect(()=>{
  const target:[RegionLevel,string,string]|null=neighborhoodId?['neighborhood',districtId,neighborhoodId]
   :districtId?['district',provinceId,districtId]:provinceId?['province','0',provinceId]:null;
  if(!target){setBoundary(null);setBoundaryNote('');return}
  let active=true;
  fetchBoundary(...target).then(feature=>{
   if(!active)return;
   setBoundary(feature);setBoundaryNote('');
   setFocus({data:feature,key:`${target[0]}-${target[2]}`,maxZoom:BOUNDARY_ZOOM[target[0]]});
  }).catch(e=>{if(active){setBoundary(null);setBoundaryNote(e.message)}});
  return()=>{active=false};
 },[provinceId,districtId,neighborhoodId]);

 // Resmî kaynak bağlantıları seçili bölge/parsel bilgisine göre güncellenir.
 const sp=parcelResult?.parcel;
 const sourceKey=[sp?.province||selectedProvince,sp?.district||selectedDistrict,sp?.neighborhood||selectedNeighborhood,sp?.block||'',sp?.parcel||''].join('|');
 useEffect(()=>{
  const [province,district,neighborhood,b,n]=sourceKey.split('|');
  if(!district){setSources([]);return}
  let active=true;
  fetchJson<{sources:OfficialSource[]}>('/api/sources?'+new URLSearchParams({province,district,neighborhood,block:b,parcel:n}))
   .then(d=>{if(active)setSources(d.sources)}).catch(()=>{});
  return()=>{active=false};
 },[sourceKey]);

 function selectProvince(id:string){setProvinceId(id);setDistrictId('');setNeighborhoodId('');setRegionsError('')}
 function selectDistrict(id:string){setDistrictId(id);setNeighborhoodId('');setRegionsError('')}

 function applyParcelResult(data:ParcelResponse){
  setParcelResult(data);
  const feature=data.parcel?.geometry;
  if(feature?.geometry){
   setShowSelectionPin(false); // Konum pini küçük parselin üzerini örtmesin.
   const key=`${data.parcel?.block||''}-${data.parcel?.parcel||''}-${Date.now()}`;
   setParcelGeometry(feature);setParcelKey(key);setFocus({data:feature,key,maxZoom:20});
   const bounds=L.geoJSON(feature).getBounds();
   if(bounds.isValid()){const c=bounds.getCenter();setPin({lat:c.lat,lng:c.lng,note:''});setNote('');setFocusPin(null)}
  }
  setMessage(`${data.source||'Kadastro servisi'}: parsel yanıtı alındı.${data.warning?' '+data.warning:''}`);
 }
 // Kayıtlı nokta seçilince parselini çiz: önce kayda bağlı parsel, sonra yerel arşivde noktayı içeren parsel.
 async function loadMarkerParcel(p:Pin){
  try{
   const d=p.parcelId?await fetchJson<{parcel:StoredParcel}>('/api/parcels/'+p.parcelId)
    :await fetchJson<{parcel:StoredParcel}>(`/api/parcels/containing?lat=${p.lat}&lng=${p.lng}`);
   const sp=d.parcel;
   if(!sp.geometry)throw Error('Arşivdeki parselin sınır geometrisi yok.');
   const key=`m${p.id}-${sp.id}-${Date.now()}`;
   setParcelResult({ok:true,source:'Yerel arşiv (daha önce alınan TKGM yanıtı)',checkedAt:sp.checkedAt,localParcelId:sp.id,
    parcel:{province:sp.province,district:sp.district,neighborhood:sp.neighborhood,block:sp.block,parcel:sp.parcel,areaM2:sp.areaM2,qualification:sp.qualification,sheet:sp.sheet,geometry:sp.geometry}});
   setParcelGeometry(sp.geometry);setParcelKey(key);setFocus({data:sp.geometry,key,maxZoom:20});setAnalysis('');setAnalysisData(null);
   setMessage(`“${p.note||'Kayıtlı nokta'}”: ${sp.block} ada / ${sp.parcel} parsel (${sp.neighborhood}) gösteriliyor.`);
   return true;
  }catch{
   setMessage(`“${p.note||'Kayıtlı nokta'}” için arşivde parsel sınırı yok. Bu noktanın ada/parselini bir kez sorgulayın; sonra kayıt seçildiğinde sınır otomatik çizilir.`);
   return false;
  }
 }
 async function query(e:React.FormEvent){
  e.preventDefault();
  if(!neighborhoodId){setMessage('Lütfen listeden mahalle seçin.');return}
  setSearching(true);setParcelResult(null);setAnalysis('');
  try{
   applyParcelResult(await postJson<ParcelResponse>('/api/parcels/search',{province:selectedProvince,district:selectedDistrict,
    neighborhood:selectedNeighborhood,neighborhoodId:Number(neighborhoodId),block,parcel}));
  }catch(e){setMessage(e instanceof Error?e.message:'Parsel sorgulaması başarısız.')}finally{setSearching(false)}
 }
 async function queryCoordinate(){
  if(!pin)return;
  setQueryingCoordinate(true);setParcelResult(null);setAnalysis('');
  try{applyParcelResult(await postJson<ParcelResponse>('/api/parcels/coordinate',{lat:pin.lat,lng:pin.lng}))}
  catch(e){setMessage(e instanceof Error?e.message:'Konum sorgusu başarısız.')}finally{setQueryingCoordinate(false)}
 }
 async function importGeoJSON(file:File){
  try{
   if(file.size>3_000_000)throw Error('Dosya 3 MB sınırını aşıyor.');
   const parsed=JSON.parse(await file.text());
   if(!['Feature','FeatureCollection','Polygon','MultiPolygon'].includes(parsed.type))throw Error('GeoJSON dosyası bekleniyor.');
   if(!L.geoJSON(parsed).getBounds().isValid())throw Error('Geçerli geometri bulunamadı.');
   const key=`${file.name}-${Date.now()}`;
   setParcelGeometry(parsed);setParcelKey(key);setFocus({data:parsed,key,maxZoom:20});setParcelResult(null);setShowSelectionPin(true);
   setMessage('GeoJSON haritaya yüklendi. Dosyanın kaynağı ve doğruluğu ayrıca teyit edilmelidir.');
  }catch(e){setMessage(e instanceof Error?e.message:'GeoJSON okunamadı.')}
 }
 async function save(){
  if(!pin)return;
  try{
   const d=await postJson<{id:number;parcelId:number|null}>('/api/markers',{lat:pin.lat,lng:pin.lng,note,favorite:false,parcelId:parcelResult?.localParcelId??undefined});
   setStored(v=>[{...pin,note,id:d.id,favorite:false,parcelId:d.parcelId},...v]);
   setMessage(d.parcelId?'Konum, not ve bağlı parsel kaydedildi.':'Konum ve not kaydedildi (bağlı parsel yok).');
  }catch(e){setMessage(e instanceof Error?e.message:'Kayıt başarısız.')}
 }
 const toggleFavorite=useCallback(async(p:Pin)=>{
  if(!p.id)return;
  try{
   const next=!p.favorite;
   await postJson('/api/markers/'+p.id,{favorite:next},'PATCH');
   setStored(v=>v.map(x=>x.id===p.id?{...x,favorite:next}:x));
   setMessage(next?'Konum favorilere eklendi.':'Konum favorilerden çıkarıldı.');
  }catch(e){setMessage(e instanceof Error?e.message:'Favori güncellenemedi.')}
 },[]);
 const removeMarker=useCallback(async(p:Pin)=>{
  if(!p.id)return;
  try{await fetchJson('/api/markers/'+p.id,{method:'DELETE'});setStored(v=>v.filter(x=>x.id!==p.id))}
  catch(e){setMessage(e instanceof Error?e.message:'Silinemedi.')}
 },[]);
 const showMarker=useCallback((p:Pin)=>{
  setPin({...p});setNote(p.note||'');setShowSelectionPin(false);
  void loadMarkerParcel(p).then(found=>{if(!found){setFocusPin({...p});setShowSelectionPin(true)}});
 },[]);
 async function analyze(){
  if(!pin)return;setAnalyzing(true);setAnalysis('');setAnalysisData(null);
  try{
   const v=parcelResult?.parcel;
   const context=v?{provider:parcelResult?.source,checkedAt:parcelResult?.checkedAt,province:v.province,district:v.district,
    neighborhood:v.neighborhood,block:v.block,parcel:v.parcel,qualification:v.qualification,areaM2:v.areaM2,
    // Geometri yüzlerce köşe içerebilir; LLM isteminde gerekmez.
    geometryAvailable:Boolean(v.geometry)}:{};
   const data=await postJson<AnalysisResponse>('/api/analysis',{lat:pin.lat,lng:pin.lng,context});
   setAnalysisData(data);setAnalysis(data.analysis||'Analiz döndürülmedi.');
  }catch(e){setAnalysis(e instanceof Error?e.message:'AI bağlantısı kurulamadı.')}finally{setAnalyzing(false)}
 }

 const p=parcelResult?.parcel;
 const crumbs=[selectedProvince,selectedDistrict,selectedNeighborhood].filter(Boolean);
 const visibleMarkers=stored.filter(m=>(m.favorite&&showFavorites)||(!m.favorite&&showPins));

 return <MotionConfig reducedMotion="user"><div className="flex h-dvh flex-col bg-background text-foreground max-lg:h-auto max-lg:min-h-dvh">
  <header className="relative z-20 flex h-14 shrink-0 items-center justify-between gap-3 bg-brand px-4 text-white shadow-md">
   <div className="flex items-center gap-2.5">
    <img src="logo-mark.svg" alt="" className="h-10 w-auto drop-shadow-[0_0_6px_rgba(56,181,254,.35)]"/>
    <div className="leading-none">
     <strong className="block font-[Bebas_Neue] text-[26px] font-normal tracking-wide text-[#38b5fe]">XRE SOFTWARE</strong>
     <small className="mt-0.5 block font-[Montserrat] text-[9px] font-semibold tracking-[.32em] text-[#38b5fe]/85">PARSEL SORGU UYGULAMASI</small>
    </div>
   </div>
   <div className="flex items-center gap-1.5 text-[11px]">
    {health&&<><span className="hidden rounded-full bg-white/10 px-2.5 py-1 sm:inline">TKGM: {health.parcelMode}</span>
     <span className={`hidden rounded-full px-2.5 py-1 sm:inline ${health.aiConfigured?'bg-emerald-400/20 text-emerald-200':'bg-white/10 text-white/60'}`}>AI {health.aiConfigured?'hazır':'kapalı'}</span></>}
    <span className="rounded-full border border-white/20 px-2.5 py-1 font-semibold">V13</span>
    {health?.authRequired&&<button onClick={()=>void logout()} title="Çıkış yap" aria-label="Çıkış yap" className="grid size-7 place-items-center rounded-full bg-white/10 hover:bg-white/20"><LogOut size={13}/></button>}
   </div>
  </header>

  <main className="grid min-h-0 flex-1 grid-cols-[380px_minmax(0,1fr)] max-lg:flex max-lg:flex-col-reverse">
   <aside className="flex min-h-0 flex-col border-r border-border bg-card max-lg:border-r-0 max-lg:border-t">
    <Tabs value={tab} onValueChange={v=>setTab(String(v))} className="flex min-h-0 flex-1 flex-col">
     <TabsList className="shrink-0 px-2">
      <TabsTab value="query"><Search size={15}/>İdari Sorgu</TabsTab>
      <TabsTab value="analysis"><Sparkles size={15}/>Analiz</TabsTab>
      <TabsTab value="records"><ListChecks size={15}/>Kayıtlar <Badge className="ml-0.5">{stored.length}</Badge></TabsTab>
     </TabsList>
     <div className="min-h-0 flex-1 overflow-y-auto p-4 [scrollbar-width:thin]">
      <TabsPanel value="query" className="space-y-4">
       <form onSubmit={query} className="space-y-3">
        <RegionCombobox step={1} label="İl" placeholder="İl seçin veya yazın" items={provinces.items} loading={provinces.loading} value={provinceId} onChange={selectProvince}/>
        <RegionCombobox step={2} label="İlçe" placeholder="İlçe seçin veya yazın" items={districts.items} loading={districts.loading} value={districtId} onChange={selectDistrict} disabled={!provinceId}/>
        <RegionCombobox step={3} label="Mahalle / Köy" placeholder="Mahalle seçin veya yazın" items={neighborhoods.items} loading={neighborhoods.loading} value={neighborhoodId} onChange={setNeighborhoodId} disabled={!districtId}/>
        <div className="grid grid-cols-2 gap-3">
         <Label className="flex-col items-stretch">Ada<Input value={block} onChange={e=>setBlock(e.target.value.replace(/\D/g,''))} required placeholder="Ada no" inputMode="numeric" disabled={!neighborhoodId}/></Label>
         <Label className="flex-col items-stretch">Parsel<Input value={parcel} onChange={e=>setParcel(e.target.value.replace(/\D/g,''))} required placeholder="Parsel no" inputMode="numeric" disabled={!neighborhoodId}/></Label>
        </div>
        <Button type="submit" variant="success" size="lg" className="w-full" disabled={searching||!neighborhoodId}>
         {searching?'Sorgulanıyor…':<><Search size={17}/>Sorgula</>}</Button>
       </form>

       {crumbs.length>0&&<nav aria-label="Seçili bölge" className="flex flex-wrap items-center gap-1 text-xs font-medium text-muted-foreground">
        {crumbs.map((c,i)=><React.Fragment key={c}>{i>0&&<ChevronRight size={12}/>}<span className={i===crumbs.length-1?'text-parcel':''}>{c}</span></React.Fragment>)}
       </nav>}
       <div role="status" className="rounded-lg border-l-4 border-primary bg-primary/5 px-3 py-2.5 text-xs leading-relaxed text-foreground/80">
        {message}{boundaryNote&&<span className="mt-1 block text-amber-700 dark:text-amber-400">Sınır: {boundaryNote}</span>}
        {regionsError&&<span className="mt-1 block text-parcel">API ve Python terminalini kontrol edin.</span>}
       </div>

       <AnimatePresence mode="wait">
        {p&&<motion.div key={parcelKey} initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-8}} transition={{duration:.2}}>
         <Card>
          <CardHeader><CardTitle>{p.block} ada / {p.parcel} parsel</CardTitle>{p.geometry&&<Badge tone="parcel">Sınır alındı</Badge>}</CardHeader>
          <CardContent className="py-1">
           <Kv label="İl / İlçe">{p.province||selectedProvince} / {p.district||selectedDistrict}</Kv>
           <Kv label="Mahalle">{p.neighborhood||selectedNeighborhood}</Kv>
           <Kv label="Yüzölçümü">{p.areaM2!=null?p.areaM2.toLocaleString('tr-TR')+' m²':'Veri yok'}</Kv>
           <Kv label="Nitelik">{p.qualification||'Veri yok'}</Kv>
           <Kv label="Pafta">{p.sheet||'Veri yok'}</Kv>
          </CardContent>
          <div className="space-y-2 border-t border-border p-3">
           {parcelGeometry&&<Button variant="danger" size="sm" className="w-full" onClick={()=>setFocus(f=>parcelGeometry?{data:parcelGeometry,key:parcelKey+'-'+Date.now(),maxZoom:20}:f)}><LocateFixed size={14}/>Parsele Yakınlaş</Button>}
           <p className="text-[11px] leading-relaxed text-muted-foreground">Kaynak: {parcelResult?.source} · {parcelResult?.checkedAt?new Date(parcelResult.checkedAt).toLocaleString('tr-TR'):'—'}<br/>
            Tapu kaydı veya imar durum belgesi yerine geçmez. “Arsa” niteliği imarlı olduğunu kanıtlamaz.</p>
          </div>
         </Card>
        </motion.div>}
       </AnimatePresence>
       <p className="text-[11px] leading-relaxed text-muted-foreground">Belirteçsiz doğrudan sorgu denenir. Servis 401/403 döndürürse <a className="font-medium text-primary underline" href="https://parselsorgu.tkgm.gov.tr/" target="_blank" rel="noopener noreferrer">resmî Parsel Sorgu</a> ekranını kullanın. Giriş bilgilerinizi bu uygulamaya girmeyin.</p>
      </TabsPanel>

      <TabsPanel value="analysis" className="space-y-4">
       <Card><CardHeader><CardTitle>Seçili nokta</CardTitle>{pin&&<Badge className="font-mono">{pin.lat.toFixed(6)}, {pin.lng.toFixed(6)}</Badge>}</CardHeader>
        <CardContent className="space-y-3">
         {!pin&&<p className="text-sm text-muted-foreground">Haritaya tıklayarak bir nokta seçin veya parsel sorgulayın.</p>}
         <Button variant="outline" className="w-full" disabled={!pin||queryingCoordinate||health?.coordinateQueryEnabled===false} onClick={queryCoordinate}>
          <LocateFixed size={16}/>{queryingCoordinate?'Koordinat sorgulanıyor…':'Seçilen Noktadaki Parseli Ara'}</Button>
         {health?.coordinateQueryEnabled===false&&<p className="text-[11px] text-muted-foreground">Koordinat sorgusu .env içinde kapalı (TKGM_COORDINATE_ENABLED).</p>}
        </CardContent></Card>
       <DensityPanel province={selectedProvince} district={selectedDistrict} districtId={districtId} loaded={density} onLoaded={setDensity} mode={densityMode} onMode={setDensityMode}/>
       <ComparablesImport/>
       <Card><CardHeader><CardTitle>AI Değerlendirme</CardTitle><Badge tone={health?.aiConfigured?'ok':'neutral'}>{health?.aiConfigured?'Anahtar tanımlı':'Anahtar yok'}</Badge></CardHeader>
        <CardContent className="space-y-3">
         <p className="text-xs leading-relaxed text-muted-foreground">TKGM parsel verisi ve emsal istatistikleri (kodda hesaplanmış) gönderilir; AI rakam üretmez, yorumlar. {health?.aiWebSearch?'Web araştırması açık: resmî kaynaklar ve ilan siteleri kaynak linkiyle taranır.':'Web araştırması kapalı (AI_WEB_SEARCH=false).'}</p>
         <Button className="w-full" disabled={!pin||analyzing} onClick={analyze}><Sparkles size={16}/>{analyzing?'Analiz hazırlanıyor…':'Seçilen Noktayı AI ile Analiz Et'}</Button>
         {!p&&<p className="text-[11px] text-amber-700 dark:text-amber-400">Emsal karşılaştırması için önce parseli sorgulayın veya parseli olan bir kaydı seçin.</p>}
         {analysisData?.density&&<DensityResult density={analysisData.density}/>}
         {analysisData?.market&&<MarketResult market={analysisData.market}/>}
         {analysis&&<AnalysisView text={analysis} lat={pin?.lat} lng={pin?.lng} citations={analysisData?.citations} webSearch={analysisData?.webSearch} note={analysisData?.note}/>}
        </CardContent></Card>
       {sources.length>0&&<OfficialSources sources={sources}/>}
      </TabsPanel>

      <TabsPanel value="records" className="space-y-4">
       <Card><CardHeader><CardTitle>Konum ve not</CardTitle></CardHeader>
        <CardContent className="space-y-2">
         {pin?<><div className="rounded-md bg-primary/5 px-3 py-2 font-mono text-xs text-primary">{pin.lat.toFixed(6)}, {pin.lng.toFixed(6)}</div>
          <Textarea value={note} onChange={e=>setNote(e.target.value)} placeholder="Bu noktaya ilişkin notunuz…"/>
          <Button className="w-full" onClick={save}><Save size={16}/>Konumu ve Notu Kaydet</Button></>
          :<p className="text-sm text-muted-foreground">Haritaya tıklayarak bir konum seçin.</p>}
        </CardContent></Card>
       <MarkersTable markers={stored} onShow={showMarker} onToggleFavorite={toggleFavorite} onRemove={removeMarker}/>
      </TabsPanel>
     </div>
    </Tabs>
   </aside>

   <section className="relative min-h-0 max-lg:h-[60vh] max-lg:min-h-[420px]">
    <MapView satellite={satellite} labels={labels} boundary={boundary} parcel={parcelGeometry} parcelKey={parcelKey} focus={focus}
     pin={pin} showSelectionPin={showSelectionPin} focusPin={focusPin} markers={visibleMarkers} onMarkerClick={showMarker}
     density={density?.points??[]} densityMode={densityMode} densityKey={density?`${density.district}-${density.year}`:''}
     onPick={(lat,lng)=>{setPin({lat,lng,note:''});setNote('');setShowSelectionPin(true)}}/>
    <div className="absolute top-2.5 right-2.5 z-[1000] flex max-w-[calc(100%-4.5rem)] flex-wrap items-center justify-end gap-1.5">
     {parcelGeometry&&<Button variant="danger" size="sm" className="bg-card shadow-md" onClick={()=>setFocus({data:parcelGeometry,key:parcelKey+'-'+Date.now(),maxZoom:20})}><LocateFixed size={14}/>Parsel</Button>}
     <div className="flex items-center gap-3 rounded-lg border border-border bg-card/95 px-3 py-1.5 text-xs font-medium shadow-md backdrop-blur">
      <label className="flex cursor-pointer items-center gap-1.5"><input type="checkbox" className="accent-primary" checked={showFavorites} onChange={e=>setShowFavorites(e.target.checked)}/>Favoriler</label>
      <label className="flex cursor-pointer items-center gap-1.5"><input type="checkbox" className="accent-primary" checked={showPins} onChange={e=>setShowPins(e.target.checked)}/>Pinler</label>
      {satellite&&<label className="flex cursor-pointer items-center gap-1.5"><input type="checkbox" className="accent-primary" checked={labels} onChange={e=>setLabels(e.target.checked)}/><Tag size={12}/>Etiket</label>}
     </div>
     <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-xs font-semibold shadow-md hover:bg-muted">
      <FileUp size={14}/>GeoJSON<input type="file" accept=".geojson,.json,application/geo+json" className="hidden" onChange={e=>{const f=e.target.files?.[0];if(f)void importGeoJSON(f);e.target.value=''}}/></label>
     <Button variant="outline" size="sm" className="shadow-md" onClick={()=>setSatellite(v=>!v)}><Layers size={14}/>{satellite?'Sokak':'Uydu'}</Button>
    </div>
    {density&&densityMode==='heat'&&density.points.length>0&&<DensityLegend max={Math.max(...density.points.map(p=>p.count))}/>}
    {health?.database&&<span className="pointer-events-none absolute right-2 bottom-6 z-[1000] hidden items-center gap-1 rounded bg-card/80 px-1.5 py-0.5 text-[10px] text-muted-foreground md:flex"><Database size={10}/>{health.database}</span>}
   </section>
  </main>
 </div></MotionConfig>;
}
createRoot(document.getElementById('root')!).render(<AuthGate><App/></AuthGate>);
