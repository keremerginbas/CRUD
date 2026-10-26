/* İlan5 → XRE Parsel Sorgu aktarımı.
   Arşivdeki arsa ilanlarını XRE sunucusuna gönderir (POST /api/ingest/listings, Bearer anahtar).
   Gönderilen alanlar yalnızca piyasa verisidir: satıcı adı, telefon, açıklama, fotoğraf ve notlar GÖNDERİLMEZ. */
'use strict';
(function(root){
 const KEY='xre.sync.v1',ALARM='xre.sync.auto',CHUNK=500,PERIOD_MIN=30;
 const SAFE_DETAILS=['İmar Durumu','Kaks (Emsal)','Gabari','Tapu Durumu','Ada/Parsel No','Ada/Parsel','Arsa Tipi','İlgili Belediye'];

 function marketRecord(r){
  const details={};
  for(const k of SAFE_DETAILS)if(r.rawDetails&&r.rawDetails[k])details[k]=String(r.rawDetails[k]).slice(0,200);
  return {source:r.source,listingId:r.listingId,url:r.url,title:r.title,price:r.price,currency:r.currency,area:r.area,
   category:r.category,location:{city:r.location?.city||'',district:r.location?.district||'',neighborhood:r.location?.neighborhood||''},
   rawDetails:details,capturedAt:r.capturedAt||r.updatedAt||'',deletedAt:r.deletedAt||null,
   monitoring:r.monitoring?.status?{status:r.monitoring.status}:undefined};
 }
 // Kullanıcının yazdığı adres: yalnızca https (veya yerel http), kimlik bilgisi/parça içermez.
 function normalizeBase(value){
  let u;try{u=new URL(String(value||'').trim())}catch{throw Error('Geçerli bir XRE adresi girin (ör. https://xresoftware.com.tr/parsel-sorgu).')}
  const local=['localhost','127.0.0.1'].includes(u.hostname);
  if(u.username||u.password||(u.protocol!=='https:'&&!(local&&u.protocol==='http:')))throw Error('Adres https:// ile başlamalı (yerel kullanım için http://localhost).');
  u.hash='';u.search='';return u.origin+u.pathname.replace(/\/+$/,'');
 }
 async function load(){const d=await chrome.storage.local.get(KEY);return {baseUrl:'',token:'',auto:false,lastSyncAt:'',lastResult:null,...(d[KEY]||{})}}
 async function store(patch){const next={...(await load()),...patch};await chrome.storage.local.set({[KEY]:next});return next}
 const publicState=s=>({ok:true,baseUrl:s.baseUrl,hasToken:Boolean(s.token),auto:s.auto,lastSyncAt:s.lastSyncAt,lastResult:s.lastResult});

 async function call(s,path,init={}){
  if(!s.baseUrl||!s.token)throw Error('Önce XRE adresini ve aktarım anahtarını kaydedin.');
  const res=await fetch(s.baseUrl+path,{...init,headers:{'Authorization':'Bearer '+s.token,'Content-Type':'application/json',...(init.headers||{})}});
  let data={};try{data=await res.json()}catch{}
  if(!res.ok)throw Error(data.error||('XRE sunucusu '+res.status+' döndürdü.'));
  return data;
 }

 async function sync({full=false}={}){
  const s=await load();
  const startedAt=new Date().toISOString();
  const all=await root.IlanDB.getAll();
  // Yalnızca arsa ilanları; tam aktarım istenmedikçe son aktarımdan sonra değişenler.
  const rows=all.filter(r=>r&&r.category==='arsa'&&r.url&&r.listingId&&(full||!s.lastSyncAt||String(r.updatedAt||'')>s.lastSyncAt)).map(marketRecord);
  let saved=0,skipped=0;
  for(let i=0;i<rows.length;i+=CHUNK){const r=await call(s,'/api/ingest/listings',{method:'POST',body:JSON.stringify({records:rows.slice(i,i+CHUNK)})});saved+=r.saved||0;skipped+=r.skipped||0}
  const lastResult={at:startedAt,sent:rows.length,saved,skipped,full};
  await store({lastSyncAt:startedAt,lastResult});
  return {ok:true,...lastResult};
 }

 async function configure(message){
  const patch={};
  if('baseUrl' in message)patch.baseUrl=message.baseUrl?normalizeBase(message.baseUrl):'';
  if(typeof message.token==='string'&&message.token.trim())patch.token=message.token.trim().slice(0,200);
  if('auto' in message)patch.auto=Boolean(message.auto);
  if(patch.baseUrl!==undefined&&patch.baseUrl!==(await load()).baseUrl)patch.lastSyncAt='';// yeni sunucuya ilk aktarım tam olur
  const s=await store(patch);
  if(s.auto)chrome.alarms.create(ALARM,{periodInMinutes:PERIOD_MIN,delayInMinutes:1});else chrome.alarms.clear(ALARM);
  return publicState(s);
 }

 async function handle(message){
  switch(message.type){
   case 'ILAN_XRE_STATUS':return publicState(await load());
   case 'ILAN_XRE_CONFIG':return configure(message);
   case 'ILAN_XRE_TEST':{const s=await load();const r=await call(s,'/api/ingest/ping');return {ok:true,message:'Bağlantı başarılı: '+(r.app||'XRE')}}
   case 'ILAN_XRE_SYNC':return sync({full:Boolean(message.full)});
   default:return {ok:false,error:'Bilinmeyen XRE komutu.'};
  }
 }
 async function onAlarm(alarm){
  if(alarm.name!==ALARM)return;
  const s=await load();if(!s.auto||!s.baseUrl||!s.token)return;
  try{await sync()}catch(e){await store({lastResult:{at:new Date().toISOString(),error:String(e.message||e)}})}
 }
 root.IlanXre={handle,onAlarm,marketRecord,normalizeBase};
 if(typeof module!=='undefined'&&module.exports)module.exports=root.IlanXre;
})(globalThis);
