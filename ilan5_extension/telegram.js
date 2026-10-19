/* Telegram notifications. Credentials stay in trusted extension storage. */
(function(root){
  'use strict';
  const CONFIG_KEY='ilan5.telegram.config.v1',OUTBOX_KEY='ilan5.telegram.outbox.v1',ALARM='ilan5.telegram.send.v1';
  const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
  const chatId=v=>{const s=clean(v);if(!/^-[1-9]\d{4,15}$/.test(s))throw Error('Telegram grup kimliği negatif sayısal kimlik olmalı.');return s;};
  function createClient(api,db,defaults={},options={}){
    const clock=options.now||Date.now,request=options.fetch||((...args)=>root.fetch(...args));
    let config,outbox,chain=Promise.resolve(),loaded=false;
    const serial=fn=>{const p=chain.then(fn,fn);chain=p.catch(()=>{});return p;};
    const iso=()=>new Date(clock()).toISOString();
    async function load(){if(loaded)return;const c=(await api.storage.local.get(CONFIG_KEY))[CONFIG_KEY];config=c||{token:defaults.token||'',chatId:defaults.chatId||'-5103130278',expectedBotUsername:defaults.expectedBotUsername||'',verified:false,lastError:''};outbox=(await api.storage.local.get(OUTBOX_KEY))[OUTBOX_KEY]||[];loaded=true;
      // Copy first-install defaults into storage once, so config.private.js can be deleted afterwards.
      if(!c&&config.token)await saveConfig();}
    const saveConfig=async()=>{try{await api.storage.local.set({[CONFIG_KEY]:config});}catch(error){loaded=false;throw error;}};
    const saveOutbox=async()=>{try{await api.storage.local.set({[OUTBOX_KEY]:outbox});}catch(error){loaded=false;throw error;}};
    function safeError(error){return clean(error?.message||error).split(config?.token||'__NO_TOKEN__').join('[gizli]').replace(/bot\d+:[A-Za-z0-9_-]+/g,'bot[gizli]').slice(0,350);}
    function statusNow(){const counts={queued:0,sending:0,sent:0,uncertain:0,failed:0};for(const e of outbox)if(e.status in counts)counts[e.status]++;
      return {configured:!!config.token,chatId:config.chatId,chatTitle:config.chatTitle||'',botUsername:config.botUsername||config.expectedBotUsername||'',verified:!!config.verified,verifiedAt:config.verifiedAt||null,lastError:config.lastError||'',counts,events:outbox.slice(-30).reverse().map(e=>({eventId:e.eventId,listingId:e.listingId,title:e.title,status:e.status,error:e.error||'',createdAt:e.createdAt,sentAt:e.sentAt||null}))};}
    async function status(){await load();return statusNow();}
    async function call(method,params){
      if(!/^\d+:[A-Za-z0-9_-]{20,}$/.test(config.token||''))throw Object.assign(Error('Bot tokeni eksik veya biçimi geçersiz.'),{definite:true});
      let response,payload;
      try {response=await request('https://api.telegram.org/bot'+config.token+'/'+method,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(params),signal:AbortSignal.timeout(15000),credentials:'omit',redirect:'error'});}
      catch(_){throw Object.assign(Error('Telegram yanıtı alınamadı; ağ veya zaman aşımı.'),{uncertain:true});}
      try{payload=await response.json();}catch(_){throw Object.assign(Error('Telegram yanıtı doğrulanamadı.'),{uncertain:true});}
      if(!payload.ok){const code=Number(payload.error_code||response.status);const descriptions={400:'Telegram grup veya mesaj bilgilerini reddetti.',401:'Telegram tokeni geçersiz.',403:'Botun gruba mesaj gönderme izni yok.',429:'Telegram hız sınırı; bildirim bekletiliyor.'};
        let message=descriptions[code]||'Telegram işlemi tamamlanamadı.';
        if(payload.parameters?.migrate_to_chat_id)message='Grup yeni kimliğe taşınmış: '+String(payload.parameters.migrate_to_chat_id)+'. Ayarlardaki grup kimliğini doğrulayın.';
        throw Object.assign(Error(message),{code,retryAfter:code===429?Math.max(1,Number(payload.parameters?.retry_after)||60):0,uncertain:code>=500,definite:code<500});
      }
      return payload.result;
    }
    async function verify(){
      try{const expected=chatId(config.chatId),me=await call('getMe',{});
        if(!me?.is_bot||!me.id)throw Error('Telegram bot kimliği doğrulanamadı.');
        if(config.expectedBotUsername&&me.username!==config.expectedBotUsername)throw Error('Token beklenen Telegram botuna ait değil.');
        const chat=await call('getChat',{chat_id:expected});
        if(String(chat?.id)!==expected||!['group','supergroup'].includes(chat.type))throw Error('Hedef Telegram grubu doğrulanamadı.');
        const member=await call('getChatMember',{chat_id:expected,user_id:me.id});
        if(!['creator','administrator','member','restricted'].includes(member?.status)||member.status==='restricted'&&(member.is_member!==true||member.can_send_messages!==true))throw Error('Bot hedef grubun mesaj gönderebilen üyesi değil.');
        if(!['creator','administrator'].includes(member.status)&&chat.permissions?.can_send_messages===false)throw Error('Grupta botun mesaj gönderme yetkisi kapalı.');
        config={...config,verified:true,verifiedAt:iso(),botUsername:me.username||'',botId:me.id,chatTitle:clean(chat.title),lastError:''};await saveConfig();return true;
      }catch(error){config.verified=false;config.lastError=safeError(error);await saveConfig();throw error;}
    }
    async function schedule(){const queued=outbox.filter(e=>e.status==='queued');if(!queued.length){await api.alarms.clear(ALARM);return;}const due=Math.min(...queued.map(e=>e.notBefore||clock()));await api.alarms.create(ALARM,{when:Math.max(clock()+1000,due)});}
    async function patchEntry(entry){if(entry.recordId&&db?.patchMonitoring){try{const record=await db.get(entry.recordId);if(record?.monitoring?.removalEventId===entry.eventId)await db.patchMonitoring(entry.recordId,{notificationStatus:entry.status,notificationError:entry.error||'',notifiedAt:entry.sentAt||null});}catch(_){/* Durable outbox is authoritative; reconciled after restart. */}}}
    function messageFor(record){
      const at=record.monitoring?.removedAt||iso();
      const date=new Intl.DateTimeFormat('tr-TR',{timeZone:'Europe/Istanbul',dateStyle:'short',timeStyle:'short'}).format(new Date(at));
      return ['🔴 İLAN YAYINDAN KALDIRILDI',clean(record.title).slice(0,240)||'Başlıksız ilan','İlan no: '+clean(record.listingId),
        'Kontrol: '+date,'Kaynakta iki ayrı kontrolde yayında olmadığı doğrulandı.','',record.url].join('\n').slice(0,3800);
    }
    async function enqueueRemoval(record,eventId){return serial(async()=>{await load();
      const old=outbox.find(e=>e.eventId===eventId);if(old)return {eventId,status:old.status,duplicate:true};
      const url=new URL(record.url);if(!/^https:$/.test(url.protocol)||!/^www\.sahibinden\.com$/.test(url.hostname)||!/^\/ilan\/.+-\d+\/detay\/?$/.test(url.pathname))throw Error('Bildirim için doğrulanmış Sahibinden ilan bağlantısı gerekli.');
      if(record.monitoring?.status!=='removed'||record.monitoring.removalEventId!==eventId||!Number.isFinite(record.monitoring.missingCount)||record.monitoring.missingCount<2)throw Error('Yayından kalkma doğrulanmadan bildirim oluşturulamaz.');
      const entry={eventId,recordId:record.id,listingId:record.listingId,title:clean(record.title).slice(0,240),chatId:chatId(config.chatId),text:messageFor(record),status:'queued',createdAt:iso(),notBefore:clock(),attempts:0,error:''};
      outbox.push(entry);await saveOutbox();await patchEntry(entry);await schedule();return {eventId,status:'queued',duplicate:false};
    });}
    // Generic notifications (price drop, new listing, health warning). No token = silently skipped.
    async function enqueueAlert(input){return serial(async()=>{await load();
      if(!config.token)return {status:'skipped'};
      const eventId=clean(input.eventId).slice(0,300);if(!eventId)throw Error('Bildirim kimliği eksik.');
      const old=outbox.find(e=>e.eventId===eventId);if(old)return {eventId,status:old.status,duplicate:true};
      outbox.push({eventId,recordId:null,kind:'alert',listingId:clean(input.listingId).slice(0,250),title:clean(input.title).slice(0,240),chatId:chatId(config.chatId),text:String(input.text||'').slice(0,3800),status:'queued',createdAt:iso(),notBefore:clock(),attempts:0,error:''});
      if(outbox.length>3000){const done=new Set(['sent','cancelled']);let drop=outbox.length-3000;outbox=outbox.filter(e=>!(drop>0&&done.has(e.status)&&drop--));}
      await saveOutbox();await schedule();return {eventId,status:'queued',duplicate:false};
    });}
    async function sendEntry(entry){
      // Persist the sending reservation before any send; a restart never blindly resends it.
      entry.status='sending';entry.attempts++;entry.attemptStartedAt=iso();entry.error='';await saveOutbox();
      try{const message=await call('sendMessage',{chat_id:entry.chatId,text:entry.text,link_preview_options:{is_disabled:true}});
        if(!message?.message_id||String(message.chat?.id)!==entry.chatId)throw Object.assign(Error('Telegram teslim yanıtı hedef grupla eşleşmedi.'),{uncertain:true});
        entry.status='sent';entry.messageId=message.message_id;entry.sentAt=iso();config.lastError='';
      }catch(error){entry.error=safeError(error);config.lastError=entry.error;
        if(error.retryAfter){entry.status='queued';entry.notBefore=clock()+error.retryAfter*1000+1000;}
        else entry.status=error.uncertain?'uncertain':'failed';
      }
      await saveOutbox();await saveConfig();await patchEntry(entry);
    }
    async function flush(){await load();const entry=outbox.find(e=>e.status==='queued'&&(e.notBefore||0)<=clock());if(!entry){await schedule();return;}
      if(entry.chatId!==config.chatId){entry.status='failed';entry.error='Grup ayarı değişti; eski hedefteki bildirim yeniden yönlendirilmedi.';await saveOutbox();await patchEntry(entry);await schedule();return;}
      // Recheck the current record before delivering a stale queued removal event.
      if(entry.recordId){const record=await db.get(entry.recordId);if(!record||record.deletedAt||record.monitoring?.status!=='removed'||record.monitoring.removalEventId!==entry.eventId){entry.status='cancelled';entry.error='İlan durumu değişti; bekleyen bildirim iptal edildi.';await saveOutbox();await schedule();return;}}
      if(!config.verified||clock()-Date.parse(config.verifiedAt||0)>24*60*60*1000){try{await verify();}catch(error){entry.status='failed';entry.error=safeError(error);await saveOutbox();await patchEntry(entry);await schedule();return;}}
      await sendEntry(entry);await schedule();
    }
    async function recover(){return serial(async()=>{await load();let changed=false;for(const e of outbox){if(e.status==='sending'){e.status='uncertain';e.error='Gönderim sırasında tarayıcı durdu; teslim belirsiz. Otomatik tekrar gönderilmedi.';changed=true;}await patchEntry(e);}if(changed)await saveOutbox();await schedule();});}
    async function handle(message){return serial(async()=>{await load();try{
      switch(message.type){
        case 'ILAN_TELEGRAM_STATUS':break;
        case 'ILAN_TELEGRAM_CONFIG':{
          const nextChat=message.chatId===undefined?config.chatId:chatId(message.chatId),token=clean(message.token)||config.token;
          if(!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token))throw Error('Geçerli bot tokeni girin.');
          const changed=token!==config.token||nextChat!==config.chatId;
          config={...config,token,chatId:nextChat,expectedBotUsername:token===config.token?config.expectedBotUsername:'',verified:changed?false:config.verified,lastError:''};await saveConfig();break;}
        case 'ILAN_TELEGRAM_VERIFY':await verify();break;
        case 'ILAN_TELEGRAM_TEST':{
          await verify();const entry={eventId:'test-'+clock(),recordId:null,listingId:'',title:'Bağlantı testi',chatId:config.chatId,text:'✅ İlan5 bağlantı testi\nBu bir test mesajıdır; silinen ilan bildirimi değildir.\nKayıtlı Sahibinden ilanları yayından kalktığında, doğrulama sonrasında ilan bağlantısıyla bu gruba bildirim gönderilecektir.',status:'queued',createdAt:iso(),attempts:0};outbox.push(entry);await saveOutbox();await sendEntry(entry);if(entry.status!=='sent')throw Error(entry.error||'Test mesajı teslimi doğrulanamadı.');break;}
        case 'ILAN_TELEGRAM_RETRY':{
          for(const e of outbox)if((!message.eventId||e.eventId===message.eventId)&&e.chatId===config.chatId&&(e.status==='failed'||e.status==='uncertain'&&message.includeUncertain===true)){e.status='queued';e.notBefore=clock();e.error='';}await saveOutbox();await schedule();break;}
        default:throw Error('Bilinmeyen Telegram komutu.');
      }
      return {ok:true,telegram:statusNow()};
    }catch(error){return {ok:false,error:safeError(error),telegram:statusNow()};}});}
    return {handle,status,enqueueRemoval,enqueueAlert,recover,onAlarm:alarm=>alarm.name===ALARM?serial(flush):Promise.resolve()};
  }
  root.IlanTelegram={createClient,CONFIG_KEY,OUTBOX_KEY,ALARM};
  if(typeof module!=='undefined'&&module.exports)module.exports=root.IlanTelegram;
})(globalThis);
