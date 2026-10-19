/* Telegram alerts for price drops, new listings and layout warnings, plus account-protection settings. */
(function(root){
  'use strict';
  const KEY='ilan5.alerts.v1',SUMMARY_ALARM='ilan5.summary.v1',LAST_KEY='ilan5.summary.last';
  const DEFAULTS={priceDrop:true,minDropPercent:5,newListing:true,health:true,summary:true,summaryTime:'08:30'};
  const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
  function normalize(value){
    const raw=value&&typeof value==='object'?value:{},percent=Number(raw.minDropPercent);
    const time=/^([01]\d|2[0-3]):[0-5]\d$/.test(String(raw.summaryTime||''))?raw.summaryTime:DEFAULTS.summaryTime;
    return {priceDrop:raw.priceDrop!==false,newListing:raw.newListing!==false,health:raw.health!==false,summary:raw.summary!==false,summaryTime:time,
      minDropPercent:Number.isFinite(percent)&&percent>=0&&percent<=90?percent:DEFAULTS.minDropPercent};
  }
  function money(value,currency){
    if(value===null||value===undefined)return '—';
    try{return new Intl.NumberFormat('tr-TR',{style:'currency',currency:currency||'TRY',maximumFractionDigits:0}).format(value);}
    catch(_){return new Intl.NumberFormat('tr-TR').format(value)+' '+(currency||'');}
  }
  function priceDropText(event){
    return ['🟢 FİYAT DÜŞTÜ (%'+Math.abs(event.percent).toLocaleString('tr-TR',{maximumFractionDigits:1})+')',clean(event.title).slice(0,240)||'Başlıksız ilan',
      'İlan no: '+clean(event.listingId),'Eski: '+money(event.oldPrice,event.currency)+' → Yeni: '+money(event.newPrice,event.currency),'',event.url].join('\n');
  }
  function newListingText(event){
    return ['🆕 TAKİPTEKİ ARAMADA YENİ İLAN',clean(event.title).slice(0,240)||'Başlıksız ilan','İlan no: '+clean(event.listingId),
      'Fiyat: '+money(event.newPrice,event.currency),'',event.url].join('\n');
  }
  // Next local occurrence of HH:MM after `now`.
  function nextSummaryAt(time,now=Date.now()){const [h,m]=time.split(':').map(Number),d=new Date(now);d.setHours(h,m,0,0);if(d.getTime()<=now)d.setDate(d.getDate()+1);return d.getTime();}
  function summaryText(input){
    const n=v=>Number(v||0).toLocaleString('tr-TR'),lines=['☀️ İLAN5 GÜNLÜK ÖZET ('+input.date+')','','Son 24 saat:',
      '🆕 Yeni ilan: '+n(input.newListings),'🟢 Fiyatı düşen: '+n(input.priceDrops),'🔴 Yayından kalkan: '+n(input.removed),'',
      '💎 Fırsat (m² fiyatı bölgenin %20+ altında): '+n(input.opportunities),'📞 Görüşülecek: '+n(input.meetings)+' · İlgileniyor: '+n(input.interested),
      '📦 Arşivde toplam: '+n(input.total)+' ilan'];
    if(input.topDrops?.length){lines.push('','En büyük düşüşler:');for(const e of input.topDrops)lines.push('• %'+Math.abs(e.percent).toLocaleString('tr-TR',{maximumFractionDigits:1})+' '+clean(e.title).slice(0,60)+'\n  '+e.url);}
    return lines.join('\n').slice(0,3800);
  }
  function createAlerts(api,getTelegram,options={}){
    const core=root.IlanCore,getDb=options.getDb||(()=>root.IlanDB),clock=options.now||Date.now;
    async function settings(){try{return normalize((await api.storage.local.get(KEY))[KEY]);}catch(_){return {...DEFAULTS};}}
    async function send(input){const telegram=getTelegram();if(telegram?.enqueueAlert)await telegram.enqueueAlert(input);}
    async function marketEvents(events){
      const s=await settings();
      for(const event of events||[]){
        // Only tracked searches (searchIds) produce "new"; a first baseline run creates no events at all.
        if(event.type==='price_down'&&s.priceDrop&&Number.isFinite(event.percent)&&Math.abs(event.percent)>=s.minDropPercent)
          await send({eventId:'alert:'+event.id,listingId:event.listingId,title:event.title,text:priceDropText(event)});
        else if(event.type==='new'&&s.newListing&&event.searchIds?.length)
          await send({eventId:'alert:'+event.id,listingId:event.listingId,title:event.title,text:newListingText(event)});
      }
    }
    async function health(field,message,job){
      if(!(await settings()).health)return;
      await send({eventId:'health:'+clean(job?.id)+':'+field,title:'İlan5 uyarısı',text:'⚠️ İLAN5 UYARISI\n'+message+'\n\nArama: '+(clean(job?.searchUrl)||'tek tek ilan bağlantıları')});
    }
    // Keeps the daily alarm armed. When Chrome was closed at summary time, today's summary is sent on start.
    async function scheduleSummary(reset=false){
      const s=await settings();if(!api.alarms)return;
      if(!s.summary){await api.alarms.clear(SUMMARY_ALARM);return;}
      const existing=!reset&&api.alarms.get?await api.alarms.get(SUMMARY_ALARM):null;
      if(!existing)await api.alarms.create(SUMMARY_ALARM,{when:nextSummaryAt(s.summaryTime,clock()),periodInMinutes:24*60});
      const last=(await api.storage.local.get(LAST_KEY))[LAST_KEY],now=clock(),due=nextSummaryAt(s.summaryTime,now)-24*60*60*1000;
      // First run after install only marks today; the first summary arrives at the next scheduled time.
      if(last===undefined||last===null){await api.storage.local.set({[LAST_KEY]:core.dayKey(now)});return;}
      if(!reset&&last!==core.dayKey(now)&&now>=due)await sendSummary();
    }
    async function buildSummary(){
      const db=getDb(),now=clock(),since=new Date(now-24*60*60*1000).toISOString();
      const [records,events]=await Promise.all([db.getAll(),db.getEvents?db.getEvents({since,limit:0}):[]]);
      const active=records.filter(r=>!r.deletedAt),stats=core.marketStats(active);
      const drops=events.filter(e=>e.type==='price_down').sort((a,b)=>a.percent-b.percent);
      return {date:new Intl.DateTimeFormat('tr-TR',{dateStyle:'long'}).format(new Date(now)),total:active.length,
        newListings:events.filter(e=>e.type==='new').length,priceDrops:drops.length,removed:events.filter(e=>e.type==='removed').length,
        opportunities:[...stats.values()].filter(x=>x.opportunity).length,meetings:active.filter(r=>r.crm?.status==='meeting').length,
        interested:active.filter(r=>r.crm?.status==='interested').length,topDrops:drops.slice(0,3)};
    }
    async function sendSummary(force=false){
      const s=await settings();if(!s.summary&&!force)return null;
      const summary=await buildSummary(),day=core.dayKey(clock());
      await send({eventId:'summary:'+day+(force?':'+clock():''),title:'Günlük özet',text:summaryText(summary)});
      if(!force)await api.storage.local.set({[LAST_KEY]:day});
      return summary;
    }
    async function onAlarm(alarm){if(alarm.name===SUMMARY_ALARM)await sendSummary();}
    async function handle(message){
      try{
        if(message.type==='ILAN_ALERTS_SUMMARY_NOW'){await sendSummary(true);}
        if(message.type==='ILAN_ALERTS_CONFIG'){const next=normalize({...(await settings()),...message.alerts});await api.storage.local.set({[KEY]:next});await scheduleSummary(true);}
        if(message.type==='ILAN_SAFETY_CONFIG'){const next=core.normalizeSafety({...(await core.safetySettings(api)),...message.safety});await api.storage.local.set({[core.SAFETY_KEY]:next});}
        const daily=(await api.storage.local.get(core.DAILY_KEY))[core.DAILY_KEY];
        const today=core.dayKey(Date.now());
        return {ok:true,alerts:await settings(),safety:await core.safetySettings(api),todayCount:daily?.day===today?Number(daily.count)||0:0};
      }catch(error){return {ok:false,error:String(error.message||error)};}
    }
    return {marketEvents,health,handle,settings,scheduleSummary,buildSummary,sendSummary,onAlarm};
  }
  root.IlanAlerts={KEY,SUMMARY_ALARM,DEFAULTS,normalize,createAlerts,priceDropText,newListingText,summaryText,nextSummaryAt};
  if(typeof module!=='undefined'&&module.exports)module.exports=root.IlanAlerts;
})(globalThis);
