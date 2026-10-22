/* Saved search schedules. A completed first pass establishes the baseline. */
(function(root){
  'use strict';
  const KEY='ilan5.searches.v1',ALARM='ilan5.search.schedule.v1',MINUTE=60000;
  function searchUrl(value){
    let url;try{url=new URL(String(value));}catch{throw Error('Geçerli bir arama sonuçları bağlantısı girin.');}
    const Sites=root.IlanSites||require('./sites.js'),site=Sites.forHost(url.hostname);
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.port||!site)throw Error(Sites.namesText()+' arama bağlantısı gerekli.');
    if(Sites.listingId(url.href)||/^\/ilan\//.test(url.pathname))throw Error('Tek ilan yerine filtrelenmiş arama sonuçları bağlantısını girin.');
    url.protocol='https:';url.hostname='www.'+site.domain;url.hash='';
    for(const key of [...url.searchParams.keys()])if(['page','p','pagingOffset'].includes(key)||/^utm_|^(?:gclid|fbclid)$/.test(key))url.searchParams.delete(key);
    url.searchParams.sort();return url.href;
  }
  function identifier(url,category){let h=2166136261;for(const c of url+'|'+category){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return 'search-'+(h>>>0).toString(16);}
  function createScheduler(api,core,callbacks={},options={}){
    const now=options.now||Date.now;let state,chain=Promise.resolve();
    const iso=()=>new Date(now()).toISOString(),copy=x=>JSON.parse(JSON.stringify(x));
    const serial=fn=>{const p=chain.then(fn,fn);chain=p.catch(()=>{});return p;};
    async function load(){if(!state)state=(await api.storage.local.get(KEY))[KEY]||{version:1,items:[]};}
    async function persist(){try{await api.storage.local.set({[KEY]:state});}catch(e){state=null;throw e;}}
    function list(){return copy(state.items).sort((a,b)=>a.name.localeCompare(b.name,'tr'));}
    async function schedule(delayFloor=0){
      const items=state.items.filter(s=>s.enabled&&s.nextRunAt);
      if(!items.length){await api.alarms.clear(ALARM);return;}
      const next=Math.min(...items.map(s=>Date.parse(s.nextRunAt)).filter(Number.isFinite));
      if(Number.isFinite(next))await api.alarms.create(ALARM,{when:Math.max(now()+Math.max(1000,delayFloor),next)});
    }
    async function settle(job){
      if(!job?.searchId)return false;
      const item=state.items.find(s=>s.id===job.searchId);if(!item)return false;
      if(item.activeJobId&&item.activeJobId!==job.id)return false;
      const terminal=['completed','incomplete','stopped'].includes(job.status);
      if(terminal&&item.lastSettledKey===job.id+':'+job.status)return false;
      const before=JSON.stringify(item);
      item.lastStatus=job.status;item.lastMessage=job.message||'';item.lastCounts=copy(job.counts||{});item.pageProgress=job.pageProgress?copy(job.pageProgress):null;
      if(['running','paused','blocked'].includes(job.status)){item.activeJobId=job.id;item.nextRunAt=null;}
      if(terminal){
        item.lastSettledKey=job.id+':'+job.status;item.activeJobId=null;item.lastCompletedAt=job.completedAt||iso();
        const complete=job.status==='completed'&&job.listComplete===true&&!job.listIncomplete&&!job.limited&&!(job.counts?.errors>0);
        if(complete){item.hasBaseline=true;item.lastSuccessfulAt=item.lastCompletedAt;}
        item.nextRunAt=item.enabled?new Date(now()+item.intervalMinutes*MINUTE).toISOString():null;
      }
      if(JSON.stringify(item)===before)return false;
      await persist();return true;
    }
    async function reconcileJob(job){return serial(async()=>{await load();await settle(job);await schedule();return list();});}
    async function availability(){
      const job=await callbacks.getJob?.();
      if(job&&['running','paused','blocked'].includes(job.status))return {ready:false,reason:'Mevcut ilan taraması tamamlanmalı veya durdurulmalı.'};
      if(callbacks.canStart&&!(await callbacks.canStart()))return {ready:false,reason:'Bağlantı takibi çalışıyor; arama taraması sırada bekliyor.'};
      return {ready:true};
    }
    async function start(item,manual=false,limits={}){
      const current=await callbacks.getJob?.();
      if(current?.searchId===item.id&&current.status==='running'){await settle(current);return true;}
      const maxListings=manual?Number(limits.maxListings||0):0,maxPages=manual?Number(limits.maxPages||0):0;
      if(!Number.isSafeInteger(maxListings)||maxListings<0||!Number.isSafeInteger(maxPages)||maxPages<0)throw Error('Tarama sınırları sıfır veya pozitif tam sayı olmalı.');
      const available=await availability();
      if(!available.ready){item.lastStatus='waiting';item.lastMessage=available.reason;if(item.enabled)item.nextRunAt=new Date(now()+MINUTE).toISOString();await persist();await schedule(MINUTE);if(manual)throw Error(available.reason);return false;}
      // The durable intent is written first; a worker restart can recover a
      // completed engine start from the job's searchId without double starting.
      item.lastStatus='starting';item.lastMessage='Arama taraması başlatılıyor.';item.lastRunAt=iso();item.nextRunAt=null;await persist();
      let result;try{result=await callbacks.startSearch({type:'ILAN_START',searchUrl:item.searchUrl,category:item.category,maxPages,maxListings,delayMs:item.delayMs,revealPhone:item.revealPhone,searchId:item.id,listId:item.listId||'',baseline:!item.hasBaseline});}catch(error){result={ok:false,error:String(error.message||error)};}
      if(!result?.ok){item.lastStatus='error';item.lastMessage=result?.error||'Arama başlatılamadı.';item.nextRunAt=item.enabled?new Date(now()+Math.min(item.intervalMinutes,15)*MINUTE).toISOString():null;await persist();await schedule();if(manual)throw Error(item.lastMessage);return false;}
      item.activeJobId=result.job.id;item.lastStatus=result.job.status;item.lastMessage=result.job.message||'';item.lastCounts=copy(result.job.counts||{});item.pageProgress=result.job.pageProgress||null;await persist();await settle(result.job);await schedule();return true;
    }
    async function tick(){await load();const job=await callbacks.getJob?.();await settle(job);
      const due=state.items.filter(s=>s.enabled&&s.nextRunAt&&Date.parse(s.nextRunAt)<=now()).sort((a,b)=>Date.parse(a.nextRunAt)-Date.parse(b.nextRunAt))[0];
      if(due)await start(due);else await schedule();
    }
    async function recover(){return serial(async()=>{await load();const job=await callbacks.getJob?.();await settle(job);
      let changed=false;
      for(const item of state.items)if((item.activeJobId||item.lastStatus==='starting')&&(job?.searchId!==item.id||item.activeJobId&&job?.id!==item.activeJobId)){item.activeJobId=null;item.lastStatus='interrupted';item.lastMessage='Önceki tur tamamlanmadı; başlangıç karşılaştırması değiştirilmedi.';item.nextRunAt=item.enabled?iso():null;changed=true;}
      if(changed)await persist();await tick();});}
    async function handle(message){return serial(async()=>{await load();try{
      let selected;
      switch(message.type){
        case 'ILAN_SEARCH_STATUS':await settle(await callbacks.getJob?.());break;
        case 'ILAN_SEARCH_SAVE':{
          const url=searchUrl(message.searchUrl),category=message.category||'all';if(category!=='all'&&!['arsa','arac','konut','isyeri','diger'].includes(category))throw Error('Geçerli bir kategori seçin.');
          const interval=Number(message.intervalMinutes??60),delay=Number(message.delayMs??4000);
          if(!Number.isInteger(interval)||interval<15||interval>43200)throw Error('Yenileme aralığı 15–43200 dakika olmalı.');
          if(!Number.isFinite(delay)||delay<3000||delay>3600000)throw Error('İlan bekleme süresi 3–3600 saniye olmalı.');
          const id=identifier(url,category),old=state.items.find(s=>s.id===id);
          if(old&&(old.searchUrl!==url||old.category!==category))throw Error('Arama kimliği çakıştı; farklı bir arama bağlantısı kullanın.');
          selected=old||{id,searchUrl:url,category,createdAt:iso(),hasBaseline:false,lastStatus:'idle',lastMessage:'İlk tam tarama başlangıç listesini oluşturacak.',lastCounts:{},activeJobId:null};
          selected.name=core.clean(message.name||selected.name||new URL(url).pathname.replace(/\//g,' ').trim()||'Kayıtlı arama').slice(0,100);
          selected.intervalMinutes=interval;selected.delayMs=delay;selected.revealPhone=message.revealPhone!==false;selected.enabled=message.enabled!==false;if(typeof message.listId==='string')selected.listId=core.clean(message.listId).slice(0,100);
          selected.nextRunAt=selected.activeJobId?null:selected.enabled?(selected.nextRunAt||iso()):null;
          if(!old)state.items.push(selected);await persist();await schedule();break;}
        case 'ILAN_SEARCH_RUN':selected=state.items.find(s=>s.id===message.id);if(!selected)throw Error('Kayıtlı arama bulunamadı.');if(typeof message.listId==='string'){selected.listId=core.clean(message.listId).slice(0,100);await persist();}await start(selected,true,message);break;
        case 'ILAN_SEARCH_TOGGLE':selected=state.items.find(s=>s.id===message.id);if(!selected)throw Error('Kayıtlı arama bulunamadı.');selected.enabled=message.enabled===true;selected.nextRunAt=selected.enabled&&!selected.activeJobId?iso():null;await persist();await schedule();break;
        case 'ILAN_SEARCH_REMOVE':{
          selected=state.items.find(s=>s.id===message.id);if(!selected)throw Error('Kayıtlı arama bulunamadı.');const job=await callbacks.getJob?.();if(job?.searchId===selected.id&&['running','paused','blocked'].includes(job.status))throw Error('Bu aramayı kaldırmadan önce çalışan taramayı durdurun.');state.items=state.items.filter(s=>s.id!==selected.id);await persist();await schedule();break;}
        default:throw Error('Bilinmeyen arama takip komutu.');
      }
      return {ok:true,searches:list(),...(selected?{search:copy(selected)}:{})};
    }catch(error){return {ok:false,error:String(error.message||error)};}});}
    return {handle,recover,reconcileJob,onAlarm:alarm=>alarm.name===ALARM?serial(tick):Promise.resolve()};
  }
  root.IlanSearches={KEY,ALARM,searchUrl,identifier,createScheduler};
  if(typeof module!=='undefined'&&module.exports)module.exports=root.IlanSearches;
})(globalThis);
