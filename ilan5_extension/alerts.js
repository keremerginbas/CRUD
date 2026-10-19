/* Telegram alerts for price drops, new listings and layout warnings, plus account-protection settings. */
(function(root){
  'use strict';
  const KEY='ilan5.alerts.v1';
  const DEFAULTS={priceDrop:true,minDropPercent:5,newListing:true,health:true};
  const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
  function normalize(value){
    const raw=value&&typeof value==='object'?value:{},percent=Number(raw.minDropPercent);
    return {priceDrop:raw.priceDrop!==false,newListing:raw.newListing!==false,health:raw.health!==false,
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
  function createAlerts(api,getTelegram){
    const core=root.IlanCore;
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
    async function handle(message){
      try{
        if(message.type==='ILAN_ALERTS_CONFIG'){const next=normalize({...(await settings()),...message.alerts});await api.storage.local.set({[KEY]:next});}
        if(message.type==='ILAN_SAFETY_CONFIG'){const next=core.normalizeSafety({...(await core.safetySettings(api)),...message.safety});await api.storage.local.set({[core.SAFETY_KEY]:next});}
        const daily=(await api.storage.local.get(core.DAILY_KEY))[core.DAILY_KEY];
        const today=core.dayKey(Date.now());
        return {ok:true,alerts:await settings(),safety:await core.safetySettings(api),todayCount:daily?.day===today?Number(daily.count)||0:0};
      }catch(error){return {ok:false,error:String(error.message||error)};}
    }
    return {marketEvents,health,handle,settings};
  }
  root.IlanAlerts={KEY,DEFAULTS,normalize,createAlerts,priceDropText,newListingText};
  if(typeof module!=='undefined'&&module.exports)module.exports=root.IlanAlerts;
})(globalThis);
