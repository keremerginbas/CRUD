/* Persistent archive and observed listing movements, shared by extension pages and workers. */
(function(root){
  'use strict';
  const DB_NAME='ilan5-archive-v2', DB_VERSION=3;
  let connection;
  const core=()=>root.IlanCore;
  const now=()=>new Date().toISOString();
  const date=value=>{const n=typeof value==='number'?value:Date.parse(value||'');return Number.isFinite(n)?new Date(n).toISOString():'';};
  const later=(a,b)=>!a?b:!b?a:a>b?a:b;
  const earlier=(a,b)=>!a?b:!b?a:a<b?a:b;
  function open(){
    if(connection)return connection;
    connection=new Promise((resolve,reject)=>{
      const request=indexedDB.open(DB_NAME,DB_VERSION);
      request.onupgradeneeded=()=>{
        const db=request.result;
        if(!db.objectStoreNames.contains('records')){const store=db.createObjectStore('records',{keyPath:'id'});store.createIndex('category','category');store.createIndex('updatedAt','updatedAt');}
        if(!db.objectStoreNames.contains('events')){const events=db.createObjectStore('events',{keyPath:'id'});events.createIndex('at','at');events.createIndex('recordId','recordId');events.createIndex('searchIds','searchIds',{multiEntry:true});}
        if(!db.objectStoreNames.contains('messageQueue')){const queue=db.createObjectStore('messageQueue',{keyPath:'id'});queue.createIndex('status','status');queue.createIndex('recordId','recordId');queue.createIndex('sellerKey','sellerKey');queue.createIndex('createdAt','createdAt');}
        if(!db.objectStoreNames.contains('messageTemplates')){const templates=db.createObjectStore('messageTemplates',{keyPath:'id'});templates.createIndex('updatedAt','updatedAt');}
      };
      request.onsuccess=()=>{request.result.onversionchange=()=>{request.result.close();connection=null;};resolve(request.result);};
      request.onblocked=()=>{connection=null;reject(new Error('Arşiv veritabanı eski İlan5 paneli tarafından açık tutuluyor. Açık İlan5 sekmelerini kapatıp eklentiyi Yenile düğmesiyle tekrar yükleyin.'));};
      request.onerror=()=>{connection=null;reject(request.error);};
    });
    return connection;
  }
  function readResult(request){return new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
  async function getAll(){const db=await open();return readResult(db.transaction('records','readonly').objectStore('records').getAll());}
  async function get(id){const db=await open();return readResult(db.transaction('records','readonly').objectStore('records').get(id));}
  function notifyChanged(){changed();}
  function changed(){if(root.chrome?.storage?.local)root.chrome.storage.local.set({'ilan5.archive.updated':Date.now()}).catch(()=>{});}
  function mergeMarket(old,incoming){
    const a=core().normalizeMarket(old),b=core().normalizeMarket(incoming);
    return core().normalizeMarket({searchIds:[...a.searchIds,...b.searchIds],firstObservedAt:earlier(a.firstObservedAt,b.firstObservedAt),lastSeenAt:later(a.lastSeenAt,b.lastSeenAt),latestEventAt:later(a.latestEventAt,b.latestEventAt)});
  }
  function eventId(parts){return parts.map(part=>encodeURIComponent(String(part??''))).join(':');}
  const normalizeEvent=input=>core().normalizeMarketEvent(input);
  function makeEvent(record,type,id,at,oldPrice=null,searchIds=record.market?.searchIds||[]){return normalizeEvent({id,type,recordId:record.id,listingId:record.listingId,title:record.title,url:record.url,category:record.category,source:record.source,searchIds,at,oldPrice,newPrice:record.price,currency:record.currency});}
  function writeEvent(store,event,onAdded){
    if(!event)return;
    const request=store.get(event.id);
    request.onsuccess=()=>{if(!request.result){store.put(event);onAdded?.(event);}};
  }
  // Missing observations keep the last known value, with an explicit stale-value note.
  // Imports retain their existing replacement semantics; this applies only to a new crawl.
  function preserveKnown(record,old){
    const result={...record,location:{...record.location},rawDetails:{...record.rawDetails}},retained=[];
    for(const [key,label] of [['title','Başlık'],['sellerName','Satıcı'],['description','Açıklama']])if(!result[key]&&old[key]){result[key]=old[key];retained.push(label);}
    for(const [key,label] of [['phones','Telefon'],['images','Fotoğraflar'],['features','Özellikler']])if(!result[key].length&&old[key]?.length){result[key]=old[key];retained.push(label);}
    if(result.area===null&&old.area!==null&&old.area!==undefined){result.area=old.area;retained.push('Metrekare');}
    if(result.price===null&&old.price!==null&&old.price!==undefined){result.price=old.price;result.currency=old.currency;result.originalPrice=old.originalPrice;retained.push('Fiyat');}
    for(const key of ['city','district','neighborhood'])if(!result.location[key]&&old.location?.[key]){result.location[key]=old.location[key];retained.push('Konum');}
    for(const [key,value] of Object.entries(old.rawDetails||{}))if(!result.rawDetails[key]&&value){result.rawDetails[key]=value;retained.push('İlan özellikleri');}
    if(retained.length)result.quality={...result.quality,status:result.quality.status==='review'?'review':'missing',warnings:[...new Set([...(result.quality.warnings||[]),'Yeni taramada alınamayan alanlarda son arşiv değerleri korundu: '+[...new Set(retained)].join(', ')+'.'])]};
    return result;
  }
  async function upsertMany(records,options={}){
    if(!Array.isArray(records)||records.length>50000)throw Error('Bir işlemde en fazla 50.000 kayıt aktarılabilir.');
    const normalized=[...new Map(records.map(record=>{const r=core().normalizeRecord(record);if(!r.title&&!r.url&&!r.listingId)throw Error('İlan başlığı veya kaynağı olmayan kayıt aktarılamaz.');return [r.id,r];})).values()];
    const crawl=options.origin==='crawl',searchId=core().clean(options.searchId).slice(0,250),listId=core().clean(options.listId).slice(0,100),at=date(options.observedAt)||now(),runId=core().clean(options.runId)||at;
    const db=await open();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(['records','events'],'readwrite'),store=tx.objectStore('records'),events=tx.objectStore('events');
      const counts={saved:normalized.length,added:0,updated:0};if(crawl){Object.assign(counts,{newListings:0,priceIncreases:0,priceDecreases:0});Object.defineProperty(counts,'events',{value:[],enumerable:false});}
      for(const record of normalized){
        const request=store.get(record.id);
        request.onsuccess=()=>{
          const old=request.result;let result=record;
          if(old){
            counts.updated++;
            if(old.manualCategory&&!record.manualCategory)result=core().normalizeRecord({...record,manualCategory:old.manualCategory,manualCategorizedAt:old.manualCategorizedAt});
            if(crawl)result=preserveKnown(result,old);
            result.firstSeenAt=old.firstSeenAt||old.capturedAt;result.deletedAt=old.deletedAt||record.deletedAt||null;
            result.monitoring=core().normalizeMonitoring({...record.monitoring,...old.monitoring});
            result.market=mergeMarket(old.market,record.market);
            result.history=[...(old.history||[]),{at:old.updatedAt,price:old.price,currency:old.currency,category:old.category,phones:old.phones}].slice(-10);
          }else counts.added++;
          // Lists are additive labels: a record keeps every list it was ever collected into.
          if(old&&!result.crm?.status&&!result.crm?.note&&(old.crm?.status||old.crm?.note))result.crm=old.crm;
          if(old||listId)result.lists=[...new Set([...(old?.lists||[]),...(result.lists||[]),...(listId?[listId]:[])])];
          if(crawl){
            const priorMarket=core().normalizeMarket(old?.market),pending=[];
            const newlyObserved=searchId?!priorMarket.searchIds.includes(searchId):!old;
            result.market=mergeMarket(result.market,{searchIds:searchId?[searchId]:[],firstObservedAt:at,lastSeenAt:at});
            if(!options.baseline&&!result.deletedAt){
              if(newlyObserved)pending.push(makeEvent(result,'new',eventId([runId,result.id,'new',searchId]),at,null,searchId?[searchId]:[]));
              // The current extraction must actually contain both a price and the same currency.
              if(old&&old.price!==null&&record.price!==null&&Number.isFinite(old.price)&&Number.isFinite(record.price)&&old.currency===record.currency&&old.price!==record.price){
                const type=record.price>old.price?'price_up':'price_down';
                pending.push(makeEvent(result,type,eventId([runId,result.id,type,searchId]),at,old.price,searchId?[searchId]:result.market.searchIds));
              }
            }
            for(const event of pending)writeEvent(events,event,added=>{counts.events.push(added);const key=added.type==='new'?'newListings':added.type==='price_up'?'priceIncreases':'priceDecreases';counts[key]++;result.market.latestEventAt=later(result.market.latestEventAt,added.at);store.put(result);});
          }
          result.updatedAt=now();store.put(result);
        };
      }
      tx.oncomplete=()=>{changed();resolve(counts);};tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('Arşiv kaydı iptal edildi.'));
    });
  }
  async function mutate(id,transform){
    const db=await open();return new Promise((resolve,reject)=>{
      const tx=db.transaction(['records','events'],'readwrite'),store=tx.objectStore('records');let result;
      const req=store.get(id);
      req.onsuccess=()=>{
        if(!req.result){tx.abort();return;}
        try{result=transform(req.result,tx.objectStore('events'),store);result.updatedAt=now();store.put(result);}catch(error){tx.abort();reject(error);}
      };
      tx.oncomplete=()=>{changed();resolve(result);};tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('Kayıt bulunamadı veya değişiklik kaydedilemedi.'));
    });
  }
  function setCategory(id,category){if(!Object.hasOwn(core().CATEGORIES,category)||category==='belirsiz')return Promise.reject(Error('Geçerli bir kategori seçin.'));return mutate(id,record=>({...core().normalizeRecord({...record,manualCategory:category,manualCategorizedAt:now()}),history:record.history||[]}));}
  function setCrm(id,patch){return mutate(id,record=>({...record,crm:core().normalizeCrm({...record.crm,...patch,updatedAt:now()})}));}
  // Moves (toId) or removes (toId empty) a list label on every record. Records themselves are never deleted.
  async function relabelList(fromId,toId=''){
    fromId=core().clean(fromId);toId=core().clean(toId);if(!fromId)throw Error('Liste seçin.');
    const db=await open();return new Promise((resolve,reject)=>{
      const tx=db.transaction('records','readwrite'),store=tx.objectStore('records');let changed=0;
      const request=store.openCursor();
      request.onsuccess=()=>{const cursor=request.result;if(!cursor)return;const record=cursor.value;
        if(Array.isArray(record.lists)&&record.lists.includes(fromId)){record.lists=[...new Set(record.lists.map(id=>id===fromId?toId:id).filter(Boolean))];record.updatedAt=now();cursor.update(record);changed++;}
        cursor.continue();};
      tx.oncomplete=()=>{if(changed)notifyChanged();resolve({changed});};tx.onerror=()=>reject(tx.error);
    });
  }
  function setDeleted(id,deleted){return mutate(id,record=>({...record,deletedAt:deleted?now():null}));}
  const sellerKey=record=>core().clean(record?.sellerName||'').toLocaleLowerCase('tr-TR')+'|'+core().clean((record?.phones||[])[0]||'')+'|'+core().clean(record?.source||'');
  const defaultTemplate=()=>({id:'default-arsa',name:'Arsa değerlendirme mesajı',body:'Merhaba {ad_soyad}, {ilan_basligi} ilanınızı gördüm. XRE olarak arsa ve proje geliştirme alanında çalışıyoruz. Uygun olursa ilanınızla ilgili kısa bir görüşme yapmak isteriz.',updatedAt:now(),createdAt:now()});
  function renderTemplate(template,record){
    const map={
      ad_soyad:record.sellerName||'',
      ilan_basligi:record.title||'',
      ilan_no:record.listingId||record.ilanNo||'',
      il:record.location?.city||'',
      ilce:record.location?.district||'',
      mahalle:record.location?.neighborhood||'',
      fiyat:record.price==null?'':core().formatMoney(Number(record.price),record.currency||'TRY'),
      url:record.url||''
    };
    return core().clean(String(template?.body||'')).replace(/\{([a-zA-Z0-9_ğüşöçıİĞÜŞÖÇ]+)\}/g,(_,key)=>map[key]??'').replace(/[ \t]+\n/g,'\n').trim();
  }
  async function getMessageTemplates(){
    const db=await open(),store=db.transaction('messageTemplates','readonly').objectStore('messageTemplates'),rows=await readResult(store.getAll());
    return rows.length?rows.sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt))):[defaultTemplate()];
  }
  async function saveMessageTemplate(input){
    const body=core().clean(input?.body);if(!body)throw Error('Mesaj şablonu boş olamaz.');
    const template={id:core().clean(input.id)||'tpl-'+Date.now(),name:core().clean(input.name)||'Mesaj şablonu',body,updatedAt:now(),createdAt:input.createdAt||now()};
    const db=await open();await new Promise((resolve,reject)=>{const tx=db.transaction('messageTemplates','readwrite');tx.objectStore('messageTemplates').put(template);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
    changed();return template;
  }
  async function getMessageQueue(options={}){
    const db=await open(),rows=await readResult(db.transaction('messageQueue','readonly').objectStore('messageQueue').getAll());
    const status=core().clean(options.status);
    return rows.filter(row=>!status||status==='all'||row.status===status).sort((a,b)=>String(b.updatedAt||b.createdAt).localeCompare(String(a.updatedAt||a.createdAt)));
  }
  async function createMessageQueue(options={}){
    const category=options.category||'arsa',template=(await getMessageTemplates()).find(t=>t.id===options.templateId)||(await getMessageTemplates())[0],limit=Number(options.limit||0);
    const records=(await getAll()).filter(record=>!record.deletedAt&&record.source==='sahibinden'&&(category==='all'||record.category===category)&&record.url&&/sahibinden\.com/i.test(record.url));
    const db=await open(),existing=await readResult(db.transaction('messageQueue','readonly').objectStore('messageQueue').getAll()),usedRecords=new Set(existing.filter(q=>q.status!=='cancelled').map(q=>q.recordId)),usedSellers=new Set(existing.filter(q=>q.status==='sent'||q.status==='prepared').map(q=>q.sellerKey));
    const selected=[];for(const record of records){if(usedRecords.has(record.id))continue;const key=sellerKey(record);if(options.skipSameSeller!==false&&key.trim()!=='||'&&usedSellers.has(key))continue;selected.push(record);if(limit&&selected.length>=limit)break;}
    const items=selected.map(record=>({id:'msg-'+Date.now()+'-'+Math.random().toString(36).slice(2,8),recordId:record.id,sellerKey:sellerKey(record),status:'queued',attempts:0,templateId:template.id,message:renderTemplate(template,record),url:record.url,title:record.title,listingId:record.listingId,category:record.category,sellerName:record.sellerName,createdAt:now(),updatedAt:now()}));
    if(items.length){await new Promise((resolve,reject)=>{const tx=db.transaction('messageQueue','readwrite'),store=tx.objectStore('messageQueue');items.forEach(item=>store.put(item));tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});changed();}
    return {created:items.length,items};
  }
  async function updateMessageItem(id,patch){
    const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction('messageQueue','readwrite'),store=tx.objectStore('messageQueue'),req=store.get(id);let next;
      req.onsuccess=()=>{if(!req.result){tx.abort();return;}next={...req.result,...patch,updatedAt:now()};store.put(next);};
      tx.oncomplete=()=>{changed();resolve(next);};tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('Mesaj kaydı bulunamadı.'));});
  }
  async function deleteMessageItem(id){
    const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction('messageQueue','readwrite'),store=tx.objectStore('messageQueue'),req=store.get(id);let removed=false;
      req.onsuccess=()=>{if(!req.result){tx.abort();return;}if(req.result.status==='opening'){tx.abort();reject(Error('Şu anda hazırlanmakta olan mesaj silinemez.'));return;}store.delete(id);removed=true;};
      tx.oncomplete=()=>{if(removed)changed();resolve({deleted:removed});};tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('Mesaj silinemedi.'));
    });
  }
  async function clearMessageQueue(){
    const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction('messageQueue','readwrite'),store=tx.objectStore('messageQueue'),req=store.openCursor();let deleted=0,protectedCount=0;
      req.onsuccess=()=>{const cursor=req.result;if(!cursor)return;if(cursor.value.status==='opening')protectedCount++;else{cursor.delete();deleted++;}cursor.continue();};
      tx.oncomplete=()=>{if(deleted)changed();resolve({deleted,protectedCount});};tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('Mesaj kuyruğu temizlenemedi.'));
    });
  }
  async function getNextMessageItem(){
    const rows=await getMessageQueue({status:'queued'});return rows.sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt)))[0]||null;
  }
  function patchMonitoring(id,patch){
    return mutate(id,(record,events,store)=>{
      const previous=record.monitoring||{},monitoring=core().normalizeMonitoring({...previous,...patch}),result={...record,monitoring,market:core().normalizeMarket(record.market)};
      let event=null;
      const confirmed=monitoring.status==='removed'&&monitoring.removalEventId&&monitoring.removedAt&&monitoring.missingCount>=2;
      if(!record.deletedAt&&confirmed&&previous.status!=='removed')event=makeEvent(result,'removed',eventId(['monitor',record.id,'removed',monitoring.removalEventId]),monitoring.removedAt);
      if(!record.deletedAt&&previous.status==='removed'&&previous.removalEventId&&previous.removedAt&&monitoring.status==='active')event=makeEvent(result,'reactivated',eventId(['monitor',record.id,'reactivated',previous.removalEventId]),date(monitoring.lastActiveAt)||date(monitoring.lastCheckedAt)||now());
      if(monitoring.status==='active'&&patch.status==='active')result.market.lastSeenAt=later(result.market.lastSeenAt,date(monitoring.lastActiveAt)||date(monitoring.lastCheckedAt)||now());
      writeEvent(events,event,added=>{result.market.latestEventAt=later(result.market.latestEventAt,added.at);store.put(result);});
      return result;
    });
  }
  async function getEvents(options={}){
    const since=date(options.since),searchId=core().clean(options.searchId),type=options.type,rawLimit=Number(options.limit??500),limit=Number.isFinite(rawLimit)&&rawLimit>=0?Math.floor(rawLimit):500;
    const db=await open();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('events','readonly'),request=tx.objectStore('events').index('at').openCursor(null,'prev'),rows=[];
      request.onsuccess=()=>{const cursor=request.result;if(!cursor){resolve(rows);return;}const row=cursor.value;if(since&&row.at<since){resolve(rows);return;}
        if((!searchId||searchId==='all'||row.searchIds?.includes(searchId))&&(!type||type==='all'||row.type===type))rows.push(row);
        if(limit&&rows.length>=limit){resolve(rows);return;}cursor.continue();
      };request.onerror=()=>reject(request.error);tx.onabort=()=>reject(tx.error||Error('Hareket geçmişi okunamadı.'));
    });
  }
  async function importEvents(input){
    if(!Array.isArray(input))throw Error('Hareket yedeği bir liste olmalı.');
    const normalized=[...new Map(input.map(raw=>{const event=normalizeEvent(raw);if(!event)throw Error('Geçersiz hareket kaydı.');return [event.id,event];})).values()];
    const db=await open();return new Promise((resolve,reject)=>{
      const tx=db.transaction('events','readwrite'),store=tx.objectStore('events');let added=0;
      normalized.forEach(event=>writeEvent(store,event,()=>added++));
      tx.oncomplete=()=>{changed();resolve({saved:normalized.length,added,existing:normalized.length-added});};tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('Hareket yedeği kaydedilemedi.'));
    });
  }
  root.IlanDB={getAll,get,upsertMany,setCategory,setDeleted,setCrm,relabelList,patchMonitoring,getEvents,importEvents,getMessageTemplates,saveMessageTemplate,getMessageQueue,createMessageQueue,updateMessageItem,deleteMessageItem,clearMessageQueue,getNextMessageItem};
  if(typeof module!=='undefined'&&module.exports)module.exports=root.IlanDB;
})(globalThis);
