/* İlan5 archive — all listing content is rendered as plain text. */
'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const Core = globalThis.IlanCore;
  const DB = globalThis.IlanDB;
  const Transfer = globalThis.IlanTransfer;
  const labels = Core?.CATEGORIES || {arsa:'Arsa',arac:'Araç',konut:'Konut',isyeri:'İşyeri',diger:'Diğer',belirsiz:'Belirsiz'};
  const state = {records:[],filtered:[],category:'arsa',page:1,pageSize:25,job:null,busy:false,detailId:null,loading:false,monitor:null,telegram:null,monitorBusy:false,telegramBusy:false,monitorDirty:false,telegramDirty:false,monitorLoaded:false,telegramLoaded:false,events:[],marketPage:1,marketType:'all',searches:[],searchBusy:false,collectMode:'search',lists:[],stats:new Map(),sellers:new Map(),safetyLoaded:false};
  let toastTimer, searchTimer,marketRefreshTimer,marketRequest=0;
  const el = (tag, className, text) => {const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined&&text!==null)node.textContent=String(text);return node;};
  const display = value => value === null || value === undefined || value === '' ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  const unique = values => [...new Set(values.filter(Boolean))];
  const isReview = r => r.archiveStatus==='review' || r.quality?.status==='review' || ['unknown','conflict'].includes(r.classification?.status) || r.category==='belirsiz';
  const isDeleted = r => Boolean(r.deletedAt);
  const sourceName = s => ({hepsiemlak:'Hepsiemlak',sahibinden:'Sahibinden',import:'İçe aktarılan'})[s] || display(s);
  const phoneList = r => Array.isArray(r.phones) ? r.phones.filter(Boolean).map(String) : [];
  const formatPhone = phone => {const n=String(phone).replace(/\D/g,'');return /^90\d{10}$/.test(n) ? `0${n.slice(2,5)} ${n.slice(5,8)} ${n.slice(8,10)} ${n.slice(10)}` : phone;};
  const formatDate = value => {if(!value)return '—';const d=new Date(value);return Number.isNaN(d.valueOf())?String(value):new Intl.DateTimeFormat('tr-TR',{dateStyle:'medium',timeStyle:'short'}).format(d);};
  const money = r => r.price===null || r.price===undefined || r.price==='' ? 'Fiyat belirtilmemiş' : Core.formatMoney(Number(r.price),r.currency||'TRY');
  const safeUrl = raw => {try{const url=new URL(raw);return ['http:','https:'].includes(url.protocol)?url.href:null;}catch{return null;}};
  const locationText = r => [r.location?.city,r.location?.district,r.location?.neighborhood].filter(Boolean).join(' · ');
  function toast(message,error=false){clearTimeout(toastTimer);$('toast').textContent=message;$('toast').classList.toggle('error',error);$('toast').hidden=false;toastTimer=setTimeout(()=>{$('toast').hidden=true;},error?9000:5500);}
  function quality(r){if(isDeleted(r))return {label:'Çöp kutusunda',css:'deleted'};if(isReview(r))return {label:'İnceleme gerekli',css:'review'};if(r.quality?.status==='missing')return {label:'Eksik alan var',css:'missing'};if(r.quality?.status==='complete')return {label:'Temel alanlar tam',css:''};return {label:'Kontrol edilmedi',css:'missing'};}
  function qualityBadge(r){const q=quality(r);return el('span',`status-badge ${q.css}`,q.label);}
  function currentFilters(){return {category:state.category,list:$('filterList').value,excludeList:$('filterExcludeList').value,crm:$('filterCrm').value,insight:$('filterInsight').value,query:$('filterQuery').value.trim(),source:$('filterSource').value,currency:$('filterCurrency').value,city:$('filterCity').value,minPrice:$('filterMinPrice').value===''?null:Number($('filterMinPrice').value),maxPrice:$('filterMaxPrice').value===''?null:Number($('filterMaxPrice').value),quality:$('filterQuality').value,availability:$('filterAvailability').value};}
  function resetFilters(){ $('filterQuery').value='';$('filterSource').value='all';$('filterCurrency').value='all';$('filterCity').value='all';$('filterMinPrice').value='';$('filterMaxPrice').value='';$('filterQuality').value='all';$('filterAvailability').value='all';$('filterExcludeList').value='none';$('filterCrm').value='all';$('filterInsight').value='all';state.page=1;render();}
  function setCategory(category){state.category=category;state.page=1;document.querySelectorAll('[data-category]').forEach(button=>{const active=button.dataset.category===category;button.classList.toggle('active',active);if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});render();}
  function categoryRecords(category=state.category){return Core.filterRecords(state.records,{category,list:$('filterList').value});}
  // Lists are named labels on records. Names live in extension storage; records only carry list ids.
  const LISTS_KEY='ilan5.lists';
  async function loadLists(){try{const value=globalThis.chrome?.storage?.local?(await chrome.storage.local.get(LISTS_KEY))[LISTS_KEY]:null;state.lists=Array.isArray(value)?value.filter(l=>l&&typeof l.id==='string'&&l.id):[];}catch{state.lists=[];}}
  async function saveLists(){if(globalThis.chrome?.storage?.local)await chrome.storage.local.set({[LISTS_KEY]:state.lists});}
  async function mergeLists(incoming){let changed=false;for(const list of Array.isArray(incoming)?incoming:[])if(list&&typeof list.id==='string'&&list.id&&!state.lists.some(l=>l.id===list.id)){state.lists.push({id:list.id.slice(0,100),name:String(list.name||list.id).slice(0,80),createdAt:list.createdAt||new Date().toISOString()});changed=true;}if(changed)await saveLists();}
  function allLists(){const known=new Map(state.lists.map(l=>[l.id,{...l,count:0}]));for(const r of state.records){if(isDeleted(r))continue;for(const id of r.lists||[]){if(!known.has(id))known.set(id,{id,name:id,createdAt:'',count:0});known.get(id).count++;}}return [...known.values()].sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));}
  function listName(id){return allLists().find(l=>l.id===id)?.name||id;}
  function populateLists(){const current=$('filterList').value,lists=allLists();$('filterList').replaceChildren(new Option('Tüm listeler','all'));for(const l of lists)$('filterList').append(new Option(`${l.name} (${l.count.toLocaleString('tr-TR')})`,l.id));$('filterList').value=lists.some(l=>l.id===current)?current:'all';populateListTools();}
  const sellerCount=r=>Core.sellerListingCount(r,state.sellers);
  function applyInsight(rows,insight){
    if(insight==='opportunity')return rows.filter(r=>state.stats.get(r.id)?.opportunity);
    if(insight==='multi')return rows.filter(r=>sellerCount(r)>=3);
    if(insight==='single')return rows.filter(r=>sellerCount(r)===1);
    return rows;
  }
  function populateListTools(){
    const lists=allLists(),current=$('filterExcludeList').value;
    $('filterExcludeList').replaceChildren(new Option('Karşılaştırma yok','none'),...lists.map(l=>new Option(l.name,l.id)));
    $('filterExcludeList').value=lists.some(l=>l.id===current)?current:'none';
    $('listManageBtn').disabled=$('filterList').value==='all';
  }
  function openListManager(){
    const id=$('filterList').value,list=allLists().find(l=>l.id===id);if(!list)return;
    $('listManageTitle').textContent=list.name;$('listManageInfo').textContent=`${list.count.toLocaleString('tr-TR')} ilan bu listede. Kaldırma veya birleştirme ilanları silmez; yalnız liste etiketini değiştirir.`;
    $('listRenameInput').value=list.name;
    const others=allLists().filter(l=>l.id!==id);$('listMergeSelect').replaceChildren(...others.map(l=>new Option(l.name,l.id)));$('listMergeSelect').disabled=$('listMergeBtn').disabled=!others.length;
    $('listManageDialog').showModal();
  }
  async function renameList(){
    const id=$('filterList').value,name=$('listRenameInput').value.trim().slice(0,80);if(!name){toast('Liste adı boş olamaz.',true);return;}
    const known=state.lists.find(l=>l.id===id);if(known)known.name=name;else state.lists.push({id,name,createdAt:new Date().toISOString()});
    await saveLists();populateLists();render();$('listManageTitle').textContent=name;toast('Liste adı güncellendi.');
  }
  async function relabel(toId){
    const id=$('filterList').value;if(id==='all')return;
    const target=toId?listName(toId):'';
    if(!confirm(toId?`“${listName(id)}” listesindeki ilanlar “${target}” listesine taşınsın mı?`:`“${listName(id)}” listesi kaldırılsın mı? İlanlar arşivde kalır.`))return;
    try{const result=await DB.relabelList(id,toId);state.lists=state.lists.filter(l=>l.id!==id);await saveLists();$('listManageDialog').close();
      await refresh();$('filterList').value=toId||'all';populateLists();state.page=1;render();
      toast(toId?`${result.changed} ilan “${target}” listesine taşındı.`:`Liste kaldırıldı; ${result.changed} ilan arşivde kalmaya devam ediyor.`);}
    catch(error){toast(error.message,true);}
  }
  // Account-protection and Telegram alert settings live in the background worker.
  async function syncSafety(){if(!globalThis.chrome?.runtime?.sendMessage)return;try{const result=await runtime('ILAN_SAFETY_STATUS');renderSafety(result);}catch(_){/* Older worker. */}}
  function renderSafety(result){
    if(!result)return;const s=result.safety||{},a=result.alerts||{};
    if(!state.safetyLoaded||document.activeElement?.closest?.('#safetySettings,#alertSettings')===null){
      $('safetyWindow').checked=s.separateWindow!==false;$('safetySkipKnown').checked=s.skipKnown!==false;$('safetyReusePhone').checked=s.reuseKnownPhone!==false;$('safetyDailyLimit').value=s.dailyLimit??400;
      $('alertPriceDrop').checked=a.priceDrop!==false;$('alertMinDrop').value=a.minDropPercent??5;$('alertNewListing').checked=a.newListing!==false;$('alertHealth').checked=a.health!==false;$('alertSummary').checked=a.summary!==false;$('alertSummaryTime').value=a.summaryTime||'08:30';
    }
    state.safetyLoaded=true;
    $('safetyToday').textContent=s.dailyLimit?`Bugün ${Number(result.todayCount||0).toLocaleString('tr-TR')} / ${Number(s.dailyLimit).toLocaleString('tr-TR')} ilan açıldı · 0 = sınırsız`:`Bugün ${Number(result.todayCount||0).toLocaleString('tr-TR')} ilan açıldı · limit kapalı`;
  }
  async function saveSafety(){
    const limit=Number($('safetyDailyLimit').value);if(!Number.isInteger(limit)||limit<0){toast('Günlük limit 0 veya pozitif tam sayı olmalı.',true);return;}
    try{renderSafety(await runtime('ILAN_SAFETY_CONFIG',{safety:{separateWindow:$('safetyWindow').checked,skipKnown:$('safetySkipKnown').checked,reuseKnownPhone:$('safetyReusePhone').checked,dailyLimit:limit}}));toast('Güvenli tarama ayarı kaydedildi.');}catch(error){toast(error.message,true);}
  }
  async function saveAlerts(){
    const percent=Number($('alertMinDrop').value);if(!Number.isFinite(percent)||percent<0||percent>90){toast('Fiyat düşüş eşiği 0–90 arasında olmalı.',true);return;}
    try{renderSafety(await runtime('ILAN_ALERTS_CONFIG',{alerts:{priceDrop:$('alertPriceDrop').checked,minDropPercent:percent,newListing:$('alertNewListing').checked,health:$('alertHealth').checked,summary:$('alertSummary').checked,summaryTime:$('alertSummaryTime').value||'08:30'}}));toast('Bildirim ayarları kaydedildi.');}catch(error){toast(error.message,true);}
  }
  // Weekly backup runs while the panel is open; Chrome extensions cannot write files silently in the background.
  const BACKUP_KEY='ilan5.backup.v1';
  async function backupConfig(){try{const value=globalThis.chrome?.storage?.local?(await chrome.storage.local.get(BACKUP_KEY))[BACKUP_KEY]:null;return {auto:value?.auto!==false,lastAt:value?.lastAt||null};}catch(_){return {auto:true,lastAt:null};}}
  async function renderBackup(){const config=await backupConfig();$('autoBackup').checked=config.auto;$('lastBackupText').textContent=config.lastAt?`Son yedek: ${formatDate(config.lastAt)}`:'Henüz yedek alınmadı.';}
  // Settings that make a move to another computer complete. The Telegram token is never written to a file.
  async function collectSettings(){
    if(!globalThis.chrome?.storage?.local)return null;
    const keys=['ilan5.searches.v1','ilan5.monitor.v1',Core.SAFETY_KEY,'ilan5.alerts.v1'];
    const stored=await chrome.storage.local.get(keys),monitor=stored['ilan5.monitor.v1']||{};
    const searches=(stored['ilan5.searches.v1']?.items||[]).map(s=>({searchUrl:s.searchUrl,name:s.name,category:s.category,intervalMinutes:s.intervalMinutes,delayMs:s.delayMs,revealPhone:s.revealPhone,enabled:s.enabled,listId:s.listId||''}));
    return {searches,safety:stored[Core.SAFETY_KEY]||null,alerts:stored['ilan5.alerts.v1']||null,
      monitor:{enabled:monitor.enabled!==false,intervalMinutes:monitor.intervalMinutes||360,confirmationMinutes:monitor.confirmationMinutes||15},templates:DB.getMessageTemplates?await DB.getMessageTemplates():[]};
  }
  async function restoreSettings(settings){
    const done=[];
    if(settings.safety){await runtime('ILAN_SAFETY_CONFIG',{safety:settings.safety});done.push('güvenli tarama');}
    if(settings.alerts){await runtime('ILAN_ALERTS_CONFIG',{alerts:settings.alerts});done.push('bildirimler');}
    if(settings.monitor){await runtime('ILAN_MONITOR_CONFIG',settings.monitor);done.push('bağlantı takibi');}
    for(const template of settings.templates||[])if(template?.body)await DB.saveMessageTemplate(template);
    if(settings.templates?.length)done.push('mesaj şablonları');
    let searches=0;
    // Searches come back switched off so nothing starts crawling before the new computer is set up.
    for(const s of settings.searches||[]){try{await runtime('ILAN_SEARCH_SAVE',{...s,enabled:false});searches++;}catch(error){console.warn('Arama aktarılamadı',error.message);}}
    if(searches)done.push(`${searches} kayıtlı arama (takibi kapalı)`);
    await syncSafety();await syncSearches();await syncMonitoring();
    return done;
  }
  async function runBackup(auto=false){
    const events=DB.getEvents?await DB.getEvents({limit:0}):[];
    let settings=null;try{settings=await collectSettings();}catch(_){settings=null;}
    await Transfer.exportBackup(state.records,{events,lists:allLists().map(({id,name,createdAt})=>({id,name,createdAt})),settings});
    if(globalThis.chrome?.storage?.local)await chrome.storage.local.set({[BACKUP_KEY]:{...(await backupConfig()),lastAt:new Date().toISOString()}});
    await renderBackup();toast(auto?'Haftalık otomatik yedek indirildi (İndirilenler klasörü).':'Tam arşiv yedeğinin indirilmesi başlatıldı.');
  }
  async function checkAutoBackup(){const config=await backupConfig();if(config.auto&&state.records.length&&(!config.lastAt||Date.now()-Date.parse(config.lastAt)>7*24*60*60*1000)){try{await runBackup(true);}catch(error){toast('Otomatik yedek alınamadı: '+error.message,true);}}}
  function defaultListName(){const d=new Intl.DateTimeFormat('tr-TR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date());const name=$('trackSearchName')?.value.trim();return name?`${name} · ${d}`:`Liste ${d}`;}
  // Asks where the new crawl should go. Resolves to {listId} ('' = no list) or null when cancelled.
  function chooseList(preferred=''){
    const dialog=$('listDialog');
    // Never skip the question silently: browsers without <dialog> get a plain confirm.
    if(!dialog?.showModal)return Promise.resolve(confirm('Yeni liste oluşturulsun mu? İptal: genel arşive ekle.')?(()=>{const list={id:'list-'+Date.now().toString(36),name:defaultListName(),createdAt:new Date().toISOString()};state.lists.push(list);saveLists();return {listId:list.id};})():{listId:''});
    const lists=allLists(),select=$('listExistingSelect'),selected=lists.some(l=>l.id===preferred)?preferred:$('filterList').value;
    select.replaceChildren(...lists.map(l=>new Option(`${l.name} (${l.count.toLocaleString('tr-TR')} ilan)`,l.id)));
    if(lists.some(l=>l.id===selected))select.value=selected;
    const existing=dialog.querySelector('input[value="existing"]');existing.disabled=!lists.length;
    $('listExistingHint').textContent=lists.length?'Aynı ilan tekrar gelirse güncellenir, iki kez eklenmez.':'Henüz oluşturulmuş liste yok.';
    dialog.querySelector(`input[value="${lists.length&&selected!=='all'?'existing':'new'}"]`).checked=true;
    $('listNameInput').value=defaultListName();
    const sync=()=>{const choice=dialog.querySelector('input[name="listChoice"]:checked').value;$('listNameLabel').hidden=choice!=='new';$('listExistingLabel').hidden=choice!=='existing';};
    sync();dialog.querySelectorAll('input[name="listChoice"]').forEach(input=>{input.onchange=sync;});
    return new Promise(resolve=>{
      dialog.addEventListener('close',async()=>{
        if(dialog.returnValue!=='ok'){resolve(null);return;}
        const choice=dialog.querySelector('input[name="listChoice"]:checked').value;
        if(choice==='none'){resolve({listId:''});return;}
        if(choice==='existing'&&select.value){resolve({listId:select.value});return;}
        const name=$('listNameInput').value.trim()||defaultListName(),list={id:'list-'+Date.now().toString(36)+Math.random().toString(36).slice(2,6),name:name.slice(0,80),createdAt:new Date().toISOString()};
        state.lists.push(list);try{await saveLists();}catch(error){toast('Liste adı kaydedilemedi: '+error.message,true);}
        resolve({listId:list.id});
      },{once:true});
      dialog.returnValue='';dialog.showModal();
    });
  }
  function showList(listId){populateLists();if(!listId)return;if(![...$('filterList').options].some(o=>o.value===listId))$('filterList').append(new Option(listName(listId),listId));$('filterList').value=listId;state.page=1;render();}
  function populateCities(){const current=$('filterCity').value;const cities=unique(state.records.filter(r=>!isDeleted(r)).map(r=>r.location?.city)).sort((a,b)=>a.localeCompare(b,'tr'));$('filterCity').replaceChildren(new Option('Tüm iller','all'));for(const city of cities)$('filterCity').append(new Option(city,city));$('filterCity').value=cities.includes(current)?current:'all';}
  function updateCounts(){for(const node of document.querySelectorAll('[data-count]'))node.textContent=categoryRecords(node.dataset.count).length.toLocaleString('tr-TR');}
  function render(){
    const f=currentFilters();
    const currencyRequired=(f.minPrice!==null||f.maxPrice!==null)&&f.currency==='all';
    state.filtered=(currencyRequired?[]:applyInsight(Core.filterRecords(state.records,f),f.insight)).slice().sort((a,b)=>String(b.capturedAt||'').localeCompare(String(a.capturedAt||'')));
    const base=categoryRecords(), label=labels[state.category]||({all:'Tüm ilanlar',review:'İnceleme gerekli',trash:'Çöp kutusu'})[state.category]||'İlan';
    const title=labels[state.category]?`${label} arşivi`:label;
    $('pageTitle').textContent='Veri çekme ve ilan takibi';$('archiveViewTitle').textContent=labels[state.category]?`${label} ilanları`:label;
    $('pageSubtitle').textContent='Bağlantıyı girin, kategoriyi seçin ve ilanları tarayıcınızdan toplamaya başlayın.';
    $('categoryHint').textContent=({all:'Doğrulanan ilanlar ve incelemeye ayrılan kayıtlar birlikte görünür.',review:'Bu kayıtlar kontrol edilene kadar kategori arşivlerine dahil edilmez.',trash:'Buradaki ilanlar normal arşiv ve kategori dışa aktarımlarında yer almaz.'})[state.category]||`Bu görünüm yalnızca ${label.toLocaleLowerCase('tr-TR')} ilanlarını listeler.`;
    $('statCategoryLabel').textContent=labels[state.category]?`${label} ilanı`:({all:'Arşivdeki ilanlar',review:'İncelenecek kayıt',trash:'Kaldırılan ilan'})[state.category];
    $('statCategoryFoot').textContent=state.category==='all'?'Tüm arşivde':'Seçili görünümde';
    $('statCategory').textContent=base.length.toLocaleString('tr-TR');
    $('statPhones').textContent=base.filter(r=>phoneList(r).length).length.toLocaleString('tr-TR');
    $('statComplete').textContent=base.filter(r=>r.quality?.status==='complete').length.toLocaleString('tr-TR');
    $('statReview').textContent=categoryRecords('review').length.toLocaleString('tr-TR');
    $('resultCount').textContent=state.filtered.length.toLocaleString('tr-TR');
    $('specificHeader').textContent=state.category==='arac'?'Model / KM':state.category==='all'||state.category==='review'||state.category==='trash'?'Kategori':'Alan';
    const filterActive=Boolean(f.excludeList!=='none'||f.crm!=='all'||f.insight!=='all'||f.query||f.source!=='all'||f.currency!=='all'||f.city!=='all'||f.minPrice!==null||f.maxPrice!==null||f.quality!=='all'||f.availability!=='all');
    $('filterDot').hidden=!(f.excludeList!=='none'||f.crm!=='all'||f.insight!=='all'||f.currency!=='all'||f.minPrice!==null||f.maxPrice!==null||f.quality!=='all'||f.availability!=='all');
    $('filterSummary').hidden=!filterActive;$('filterSummary').textContent=`${base.length.toLocaleString('tr-TR')} kayıttan ${state.filtered.length.toLocaleString('tr-TR')} ilan filtrelerle eşleşiyor.`;
    if(f.minPrice!==null&&f.maxPrice!==null&&f.minPrice>f.maxPrice){$('filterSummary').hidden=false;$('filterSummary').textContent='En düşük fiyat, en yüksek fiyattan büyük. Fiyat aralığını kontrol edin.';}
    if(currencyRequired){$('filterSummary').hidden=false;$('filterSummary').textContent='Fiyat aralığı için bir para birimi seçin. Farklı para birimlerindeki fiyatlar birlikte karşılaştırılmaz.';}
    const totalPages=Math.max(1,Math.ceil(state.filtered.length/state.pageSize));state.page=Math.min(state.page,totalPages);
    const start=(state.page-1)*state.pageSize, pageRows=state.filtered.slice(start,start+state.pageSize);
    const tbody=$('recordsBody');tbody.replaceChildren();
    for(const r of pageRows){
      const tr=el('tr'),first=el('td'),open=el('button','record-title',r.title||'Başlık okunamadı');open.type='button';open.addEventListener('click',()=>showDetail(r.id));first.append(open);
      const meta=el('div','record-meta');meta.append(el('span','source-tag',sourceName(r.source)),el('span','',String(r.listingId||r.ilanNo||r.id||'').replace(/^(hepsiemlak|sahibinden):/,'')));first.append(meta);if(r.crm?.status)meta.append(el('span','insight-badge crm',Core.CRM_STATUSES[r.crm.status]));const av=availabilityBadge(r);first.append(av);tr.append(first);
      const priceCell=el('td','price-cell',money(r)),stat=state.stats.get(r.id);if(stat){priceCell.append(el('span','ppa',`${Core.formatMoney(Math.round(stat.ppa),r.currency||'TRY')} / m²`));if(stat.opportunity){const badge=el('span','insight-badge opportunity',`Fırsat −%${Math.round((1-stat.ratio)*100)}`);badge.title=`Bölge medyanı ${Core.formatMoney(Math.round(stat.median),r.currency||'TRY')} / m² (${stat.sample} ilan)`;priceCell.append(badge);}}tr.append(priceCell);
      const loc=el('td');loc.append(el('span','location-main',[r.location?.city,r.location?.district].filter(Boolean).join(' / ')||'—'),el('span','location-sub',r.location?.neighborhood||''));tr.append(loc);
      let specific='—';if(['all','review','trash'].includes(state.category))specific=labels[r.category]||'Belirsiz';else if(state.category==='arac'){const detail=r.rawDetails||{};specific=[detail.Yıl||detail.Yil||detail.Model,detail.KM||detail.Km||detail.Kilometre].filter(Boolean).join(' · ')||'—';}else if(r.area!==null&&r.area!==undefined&&r.area!=='')specific=`${Number(r.area).toLocaleString('tr-TR')} m²`;
      tr.append(el('td','',specific));const phones=phoneList(r);const p=el('td','phone-cell',phones.length?formatPhone(phones[0]):'—');if(phones.length>1)p.append(el('span','location-sub',`+${phones.length-1} telefon`));const sellerTotal=sellerCount(r);if(sellerTotal>=3){const badge=el('span','insight-badge multi',`${sellerTotal} ilanı var`);badge.title='Bu telefon numarası arşivde birden fazla ilanda geçiyor; emlakçı olabilir.';p.append(badge);}tr.append(p);
      const status=el('td');status.append(qualityBadge(r));tr.append(status);
      const action=el('td'),btn=el('button','row-open','›');btn.type='button';btn.setAttribute('aria-label',`${r.title||'İlan'} ayrıntılarını aç`);btn.addEventListener('click',()=>showDetail(r.id));action.append(btn);tr.append(action);tbody.append(tr);
    }
    $('tableWrap').hidden=!pageRows.length;$('emptyState').hidden=Boolean(pageRows.length);
    const archiveEmpty=base.length===0&&!filterActive;
    $('emptyTitle').textContent=filterActive?'Bu filtrelerle eşleşen ilan yok':state.category==='review'?'İnceleme bekleyen kayıt yok':state.category==='trash'?'Çöp kutusu boş':`${labels[state.category]||'İlan'} arşiviniz hazır`;
    $('emptyText').textContent=filterActive?'Aramanızı veya filtrelerinizi değiştirerek tekrar deneyin.':state.category==='review'?'Kategori bilgisi belirsiz veya çelişkili olan ilanlar burada gösterilir.':state.category==='trash'?'Arşivden kaldırdığınız ilanlar, geri alabilmeniz için burada saklanır.':'İlk ilanlarınızı toplamak için bir arama bağlantısı ekleyin veya mevcut Excel / JSON dosyanızı içe aktarın.';
    $('emptyActions').hidden=!archiveEmpty||['review','trash'].includes(state.category);
    $('rangeText').textContent=state.filtered.length?`${(start+1).toLocaleString('tr-TR')}–${Math.min(start+state.pageSize,state.filtered.length).toLocaleString('tr-TR')} / ${state.filtered.length.toLocaleString('tr-TR')} ilan`:'Henüz görüntülenecek kayıt yok';
    $('pageIndicator').textContent=`${state.page} / ${totalPages}`;$('prevPageBtn').disabled=state.page<=1;$('nextPageBtn').disabled=state.page>=totalPages;
    $('xlsxBtn').disabled=!state.filtered.length;$('csvBtn').disabled=!state.filtered.length;updateCounts();renderAvailabilityCounts();
  }
  // Automatic refreshes re-read the archive only when its change stamp moved; actions call refresh() directly.
  const ARCHIVE_STAMP='ilan5.archive.updated';let autoTimer=null;
  async function archiveStamp(){try{return globalThis.chrome?.storage?.local?(await chrome.storage.local.get(ARCHIVE_STAMP))[ARCHIVE_STAMP]||0:0;}catch(_){return 0;}}
  function autoRefresh(){clearTimeout(autoTimer);autoTimer=setTimeout(async()=>{if(document.hidden){state.staleWhileHidden=true;return;}const stamp=await archiveStamp();if(state.loadedStamp!==undefined&&stamp===state.loadedStamp)return;refresh();},400);}
  async function refresh(){if(state.loading){state.refreshAgain=true;return;}state.loading=true;try{const stamp=await archiveStamp();state.records=await DB.getAll();state.loadedStamp=stamp;state.stats=Core.marketStats(state.records);state.sellers=Core.sellerCounts(state.records);populateCities();populateLists();render();}catch(error){toast(`Arşiv okunamadı: ${error.message}`,true);}finally{state.loading=false;if(state.refreshAgain){state.refreshAgain=false;autoRefresh();}}}
  function crmSection(r){
    const section=makeSection('Takip ve not'),box=el('div','crm-controls'),select=el('select'),note=el('textarea'),save=el('button','button secondary compact','Kaydet');
    select.setAttribute('aria-label','Takip durumu');select.append(new Option('Durum seçilmedi',''));for(const [key,name] of Object.entries(Core.CRM_STATUSES))select.append(new Option(name,key));select.value=r.crm?.status||'';
    note.value=r.crm?.note||'';note.placeholder='Görüşme notu, fiyat pazarlığı, geri arama tarihi…';note.maxLength=4000;note.setAttribute('aria-label','İlan notu');save.type='button';
    save.addEventListener('click',async()=>{save.disabled=true;try{await DB.setCrm(r.id,{status:select.value,note:note.value});await refresh();toast('Takip durumu ve not kaydedildi.');}catch(error){toast(error.message,true);}finally{save.disabled=false;}});
    box.append(select,note,save);if(r.messagedAt)box.append(el('span','insight-badge crm',`Mesaj gönderildi: ${formatDate(r.messagedAt)}`));if(r.crm?.updatedAt)box.append(el('span','detail-meta',`Son güncelleme: ${formatDate(r.crm.updatedAt)}`));section.append(box);return section;
  }
  function placeSection(r){
    const section=makeSection('Konum ve parsel'),links=el('div','map-links'),place=[r.location?.neighborhood,r.location?.district,r.location?.city].filter(Boolean).join(', ');
    const detail=r.rawDetails||{},pick=(...keys)=>{for(const key of keys)for(const [k,v] of Object.entries(detail))if(k.toLocaleLowerCase('tr-TR').replace(/\s/g,'')===key.toLocaleLowerCase('tr-TR').replace(/\s/g,'')&&v)return String(v);return '';};
    const adaParsel=pick('Ada/Parsel No','Ada / Parsel','Ada/Parsel')||[pick('Ada No'),pick('Parsel No')].filter(Boolean).join(' / ');
    const link=(text,href)=>{const a=el('a','button compact secondary',text);a.href=href;a.target='_blank';a.rel='noopener noreferrer';links.append(a);};
    if(place)link('Haritada göster ↗','https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(place));
    link('TKGM parsel sorgu ↗','https://parselsorgu.tkgm.gov.tr/');
    section.append(links);
    section.append(el('p','support-text',adaParsel?`Ada / parsel: ${adaParsel}. Parsel sorguda il, ilçe, mahalle ve bu numaraları girerek sınırları görebilirsiniz.`:'İlanda ada/parsel bilgisi yok. Harita konumu mahalle düzeyindedir; kesin yer değildir.'));
    return section;
  }
  function makeSection(title){const section=el('section','detail-section');section.append(el('h3','',title));return section;}
  function detailField(container,label,value){const field=el('div','detail-field');field.append(el('dt','',label),el('dd','',display(value)));container.append(field);}
  async function showDetail(id){
    const r=state.records.find(record=>record.id===id)||await DB.get(id);if(!r){toast('Bu kayıt artık bulunamıyor.',true);return;}state.detailId=id;
    const content=$('detailContent');content.replaceChildren();const badges=el('div','detail-badges');badges.append(el('span','source-tag',sourceName(r.source)),el('span','source-tag',labels[r.category]||'Belirsiz'),qualityBadge(r));content.append(badges);
    const title=el('h2','detail-title',r.title||'Başlık okunamadı');title.id='detailTitle';content.append(title,el('p','detail-price',money(r)),el('p','detail-location',locationText(r)||'Konum belirtilmemiş'));
    const warnings=unique([...(r.quality?.missing||[]).map(field=>`Eksik alan: ${field}`),...(r.quality?.warnings||[])]);
    if(isReview(r)||warnings.length){const notice=el('div','detail-notice');notice.append(el('p','',isReview(r)?'Kategoriyi doğrulayın. Bu kayıt kontrol edilene kadar kategori arşivlerine eklenmez.':'Bazı alanlar okunamadı veya ilanda belirtilmemiş.'));if(warnings.length){const list=el('ul');for(const warning of warnings)list.append(el('li','',display(warning)));notice.append(list);}content.append(notice);}
    content.append(availabilitySection(r));
    const contacts=makeSection('İletişim');const grid=el('dl','detail-grid');detailField(grid,'İlan sahibi / satıcı',r.sellerName);detailField(grid,'İlan numarası',r.listingId||r.ilanNo||r.id);contacts.append(grid);const phones=el('div','detail-phones');for(const phone of phoneList(r)){const link=el('a','',formatPhone(phone));const normalized=phone.replace(/[^\d+]/g,'');if(normalized)link.href=`tel:${normalized}`;phones.append(link);}if(!phones.childElementCount)phones.append(el('p','empty-detail','Telefon alınamadı veya ilanda görünür değil.'));contacts.append(phones);content.append(contacts);
    content.append(crmSection(r),placeSection(r));
    const raw=makeSection('İlan bilgileri'),rawGrid=el('dl','detail-grid');const stat=state.stats.get(r.id);if(stat){detailField(rawGrid,'m² fiyatı',`${Core.formatMoney(Math.round(stat.ppa),r.currency||'TRY')} / m²`);if(stat.ratio!==null)detailField(rawGrid,'Bölge karşılaştırması',`Bölge medyanı ${Core.formatMoney(Math.round(stat.median),r.currency||'TRY')} / m² · ${stat.sample} ilan · ${stat.ratio<1?'%'+Math.round((1-stat.ratio)*100)+' altında':'%'+Math.round((stat.ratio-1)*100)+' üstünde'}`);}const sellerTotal=sellerCount(r);if(sellerTotal>1)detailField(rawGrid,'Satıcının arşivdeki ilanları',`${sellerTotal} ilan (aynı telefon)`);if(r.lists?.length)detailField(rawGrid,'Listeler',r.lists.map(listName).join(', '));if(r.area!==null&&r.area!==undefined)detailField(rawGrid,'Alan',`${Number(r.area).toLocaleString('tr-TR')} m²`);for(const [key,value] of Object.entries(r.rawDetails||{}))detailField(rawGrid,key,value);if(!rawGrid.childElementCount)raw.append(el('p','empty-detail','Ek ilan alanı kaydedilmemiş.'));else raw.append(rawGrid);content.append(raw);
    if(r.features?.length){const features=makeSection('Özellikler'),list=el('div','detail-feature-list');for(const f of r.features)list.append(el('span','',display(f)));features.append(list);content.append(features);}
    const description=makeSection('İlan açıklaması');description.append(el('div','detail-description',r.description||'Açıklama kaydedilmemiş.'));content.append(description);
    const classification=makeSection('Kategori kontrolü');if(r.categoryPath?.length)classification.append(el('p','support-text',r.categoryPath.join(' › ')));const tip=el('p','support-text',r.classification?.status==='manual'?'Bu kayıt için kategori elle doğrulandı.':'İlanın kategori bilgilerini kontrol ederek gerekirse arşivini değiştirebilirsiniz.');classification.append(tip);
    if(r.classification?.evidence?.length){const list=el('ul','detail-evidence');for(const evidence of r.classification.evidence.slice(0,12)){list.append(el('li','',`${labels[evidence.category]||'Kategori'}: ${display(evidence.text)} (${display(evidence.source)})`));}classification.append(list);}
    const controls=el('div','correction-controls'),select=el('select');select.setAttribute('aria-label','İlanın doğru kategorisi');for(const [key,name] of Object.entries(labels))if(key!=='belirsiz')select.append(new Option(name,key));select.value=r.category==='belirsiz'?'arsa':r.category;
    const save=el('button','button secondary','Kategoriyi doğrula');save.type='button';save.addEventListener('click',async()=>{save.disabled=true;try{await DB.setCategory(id,select.value);await refresh();await showDetail(id);toast('Kategori güncellendi. Kayıt ilgili arşive taşındı.');}catch(error){toast(error.message,true);save.disabled=false;}});controls.append(select,save);classification.append(controls);content.append(classification);
    const actions=el('div','detail-action-row'),url=safeUrl(r.url);if(url){const a=el('a','button primary detail-source-link','Kaynak ilanı aç ↗');a.href=url;a.target='_blank';a.rel='noopener noreferrer';actions.append(a);}const remove=el('button','button secondary',isDeleted(r)?'Arşive geri al':'Çöp kutusuna taşı');remove.type='button';remove.addEventListener('click',async()=>{remove.disabled=true;try{await DB.setDeleted(id,!isDeleted(r));await refresh();$('detailDialog').close();toast(isDeleted(r)?'İlan arşive geri alındı.':'İlan çöp kutusuna taşındı; buradan geri alabilirsiniz.');}catch(error){toast(error.message,true);remove.disabled=false;}});actions.append(remove);content.append(actions);
    const meta=el('div','detail-meta');meta.append(el('div','',`Kaydedilme: ${formatDate(r.capturedAt)}`),el('div','',`Arşiv güncellemesi: ${formatDate(r.updatedAt)}`));content.append(meta);
    if(!$('detailDialog').open)$('detailDialog').showModal();
  }
  function showCollect(){ $('collectPanel').hidden=false;$('showCollectBtn').setAttribute('aria-expanded','true');$('collectPanel').scrollIntoView({behavior:'smooth',block:'start'});$(state.collectMode==='links'?'directUrls':'searchUrl').focus();}
  async function runtime(type,config={}){if(!globalThis.chrome?.runtime?.sendMessage)throw Error('Bu ekranı kurulu İlan5 eklentisi üzerinden açın.');const result=await chrome.runtime.sendMessage({type,...config});if(!result?.ok)throw Error(result?.error||'İşlem için yanıt alınamadı.');return result;}
  const jobStates={idle:'Hazır',starting:'Başlatılıyor',running:'Tarama sürüyor',collecting:'Bağlantılar toplanıyor',paused:'Tarama duraklatıldı',blocked:'Tarayıcıda kontrol bekleniyor',stopping:'Durduruluyor',stopped:'Tarama durduruldu',completed:'Tarama tamamlandı',incomplete:'Tarama kısmen tamamlandı',done:'Tarama tamamlandı',error:'Tarama hatası'};
  function renderJob(job){state.job=job;$('jobPanel').hidden=!job;updateCollectReady();if(!job){$('pageProgressSummary').hidden=true;$('captureBtn').disabled=state.busy;return;}
    renderPageProgress(job);
    const status=job.status||job.state||'idle',active=['starting','running','collecting','stopping'].includes(status),counts=job.counts||{};
    $('jobTitle').textContent=jobStates[status]||'Tarama durumu';$('jobMessage').textContent=job.message||job.currentUrl||'';$('jobDot').className=`job-dot ${status}`;
    for(const [key,id] of Object.entries({discovered:'jobDiscovered',processed:'jobProcessed',saved:'jobSaved',unchanged:'jobUnchanged',skipped:'jobSkipped',review:'jobReview',errors:'jobErrors'}))$(id).textContent=Number(counts[key]||0).toLocaleString('tr-TR');
    const queued=Array.isArray(job.listingQueue)?Math.max(0,job.listingQueue.length-Number(job.detailIndex||0)):Math.max(0,Number(counts.discovered||0)-Number(counts.processed||0));$('jobQueued').textContent=queued.toLocaleString('tr-TR');
    const p=job.pageProgress,determinate=p&&p.stage!=='list'&&Number(p.pageFound)>0&&p.pageProcessed!==null&&p.pageProcessed!==undefined&&Number.isFinite(Number(p.pageProcessed));
    const percent=determinate?Math.max(0,Math.min(100,Math.round(Number(p.pageProcessed)/Number(p.pageFound)*100))):null;
    $('jobProgressFill').style.width=percent===null?'0%':`${percent}%`;$('jobProgress').classList.toggle('indeterminate',percent===null&&active);
    $('jobProgressLabel').textContent=determinate?'Bu sayfanın ilerlemesi':active?'Liste sayfası okunuyor':'Sayfa ilerlemesi';$('jobProgressValue').textContent=percent===null?'':`%${percent}`;
    if(percent===null)$('jobProgress').removeAttribute('aria-valuenow');else $('jobProgress').setAttribute('aria-valuenow',String(percent));
    $('jobProgress').setAttribute('aria-valuetext',determinate?`${p.pageProcessed} / ${p.pageFound} ilan; yalnızca bu sayfa`:'Toplam ilerleme henüz belirlenemedi');
    $('jobPanel').dataset.status=status;
    const attention=({blocked:'Tarama doğrulama veya giriş bekliyor. Tarama sekmesini kontrol ettikten sonra Devam et seçeneğini kullanın. Bu durum ilanların silindiği anlamına gelmez.',paused:'Tarama duraklatıldı. Kaydedilen ilanlar ve kalan sıra korunuyor.',stopped:'Tarama durduruldu. Arşiv kayıtları korunuyor; kalan sıraya devam edebilirsiniz.',incomplete:'Tüm sonuçların tarandığı doğrulanamadı. Son hareketleri kontrol edin; bu tarama tam olarak işaretlenmedi.',error:'Tarama tamamlanamadı. Son hareketlerde hata ayrıntısını inceleyin.'})[status]||'';
    $('jobAttention').hidden=!attention;$('jobAttention').textContent=attention;
    $('pauseBtn').disabled=state.busy||!active||status==='stopping';$('resumeBtn').disabled=state.busy||!['paused','blocked','stopped'].includes(status);$('stopBtn').disabled=state.busy||!['starting','running','collecting','paused','blocked','error'].includes(status);$('captureBtn').disabled=state.busy||active;
    const logs=$('jobLogs');logs.replaceChildren();for(const entry of (job.logs||[]).slice(-20).reverse()){logs.append(el('li','',typeof entry==='string'?entry:`${entry.at?formatDate(entry.at)+' · ':''}${entry.message||''}`));}if(!logs.childElementCount)logs.append(el('li','','Henüz hareket yok.'));
  }
  async function jobAction(type,config={}){if(state.busy)return;state.busy=true;renderJob(state.job);try{const result=await runtime(type,config);if(result.job)renderJob(result.job);const captureMessage=type==='ILAN_CAPTURE_TAB'?(result.skipped?'Hedef kategoriyle uyuşmadığı için ilan arşive eklenmedi.':result.review?'İlan, kategori kontrolü için İnceleme gerekli alanına kaydedildi.':'İlan arşive kaydedildi.'):null;toast(captureMessage||({ILAN_START_LINKS:'Eklenen ilan bağlantılarının taraması başlatıldı.',ILAN_START:'Tarama başlatıldı.',ILAN_PAUSE:'Duraklatma istendi.',ILAN_RESUME:'Tarama devam ediyor.',ILAN_STOP:'Durdurma istendi. Kaydedilen ilanlar korunur.',ILAN_CAPTURE_TAB:'Açık ilan işlendi. Arşiv güncelleniyor.'})[type]||'İşlem tamamlandı.');await refresh();}catch(error){toast(error.message,true);}finally{state.busy=false;renderJob(state.job);}}
  async function exportFiltered(kind){try{if(!state.filtered.length){toast('Dışa aktarılacak kayıt bulunmuyor.');return;}await Transfer[kind](state.filtered.map(r=>({...r,listNames:(r.lists||[]).map(listName)})));toast(`${state.filtered.length} filtrelenmiş ilan için indirme başlatıldı.`);}catch(error){toast(`Dosya oluşturulamadı: ${error.message}`,true);}}
  async function importFile(file){if(!file)return;$('importBtn').disabled=true;try{const records=await Transfer.importFile(file);if(!records?.length){toast('Dosyada içe aktarılabilir ilan bulunamadı.',true);return;}const before=state.records.length;const result=await DB.upsertMany(records);if(records.marketEvents?.length&&DB.importEvents)await DB.importEvents(records.marketEvents);if(records.listMeta)await mergeLists(records.listMeta);
    if(records.settingsMeta&&confirm('Bu yedekte kayıtlı aramalar ve ayarlar da var. Bu bilgisayara aktarılsın mı?\n\nKayıtlı aramalar takibi kapalı olarak gelir; İzlenen aramalar bölümünden “Takibi aç” ile başlatırsınız. Telegram tokeni yedekte yoktur, bir kez panelden girmeniz gerekir.')){try{const done=await restoreSettings(records.settingsMeta);if(done.length)setTimeout(()=>toast('Ayarlar aktarıldı: '+done.join(', ')+'.'),5600);}catch(error){toast('Ayarlar aktarılamadı: '+error.message,true);}}await refresh();await refreshMarket();const summary=records.importSummary||{};const review=records.filter(isReview).length;toast(`${records.length} kayıt işlendi; ${result?.added??Math.max(0,state.records.length-before)} yeni ilan eklendi.${result?.updated?` ${result.updated} mevcut ilan güncellendi.`:''}${review?` ${review} kayıt kategori incelemesi gerektiriyor.`:''}${summary.invalid?` ${summary.invalid} geçersiz satır atlandı.`:''}${summary.duplicates?` ${summary.duplicates} yinelenen satır birleştirildi.`:''}`);}catch(error){toast(`Dosya içe aktarılamadı: ${error.message}`,true);}finally{$('importBtn').disabled=false;$('importFile').value='';}}

  const availabilityLabels={active:'Yayında',suspected:'Tekrar kontrol bekliyor',removed:'Yayından kaldırılmış',unknown:'Henüz doğrulanmadı',blocked:'Erişim kontrolü bekliyor',error:'Kontrol tamamlanamadı'};
  const notificationLabels={queued:'Bildirim sırada',sending:'Gönderiliyor',sent:'Telegram bildirimi gönderildi',failed:'Bildirim gönderilemedi',uncertain:'Teslimat durumu belirsiz',pending:'Bildirim bekliyor',queue_error:'Bildirim kuyruğu yeniden denenecek',cancelled:'İlan durumu değişti; bildirim iptal edildi',none:'Bildirim oluşturulmadı',not_required:'Bildirim gerekmiyor'};
  function availabilityStatus(record){return record.monitoring?.status||'unknown';}
  function availabilityBadge(record){const status=availabilityStatus(record),badge=el('span',`availability-label ${status}`);badge.append(el('span',`availability-dot ${status}`),el('span','',availabilityLabels[status]||'Henüz doğrulanmadı'));return badge;}
  function renderAvailabilityCounts(){const records=state.records.filter(r=>!isDeleted(r));for(const [kind,id] of Object.entries({active:'availableCount',suspected:'suspectedCount',removed:'removedCount',unknown:'unknownCount'})){const count=records.filter(r=>kind==='unknown'?['unknown','blocked','error'].includes(availabilityStatus(r)):availabilityStatus(r)===kind).length;$(id).textContent=count.toLocaleString('tr-TR');}}
  function availabilitySection(record){const section=makeSection('Yayın durumu ve bildirim');section.append(availabilityBadge(record));const m=record.monitoring||{},fields=el('dl','detail-grid');detailField(fields,'Son kontrol',formatDate(m.lastCheckedAt));detailField(fields,'Son yayında görülme',formatDate(m.lastActiveAt));detailField(fields,'İlk kaldırılma işareti',formatDate(m.firstMissingAt));detailField(fields,'Kaldırılmanın doğrulandığı zaman',formatDate(m.removedAt));section.append(fields);if(m.lastEvidence)section.append(el('p','monitor-detail-evidence',`Kontrol sonucu: ${display(m.lastEvidence)}`));if(m.lastError)section.append(el('p','monitor-detail-evidence',`Kontrol notu: ${display(m.lastError)}`));section.append(el('p','monitor-detail-telegram',notificationLabels[m.notificationStatus]||'Henüz Telegram bildirimi yok.'));if(['unknown','blocked','error'].includes(availabilityStatus(record)))section.append(el('p','monitor-detail-note','Bu durum ilanın kaldırıldığı anlamına gelmez. Sonuç kesinleşince yayın durumu güncellenir.'));if(availabilityStatus(record)==='removed')section.append(el('p','monitor-detail-note','İlanın arşiv kaydı korunur. Bu durum, sizin çöp kutusuna taşımanızdan ayrıdır.'));return section;}
  function showMonitoring(){const open=$('monitorPanel').hidden;$('monitorPanel').hidden=!open;$('showMonitorBtn').setAttribute('aria-expanded',String(open));if(open){$('monitorPanel').scrollIntoView({behavior:'smooth',block:'nearest'});syncMonitoring();}}
  function renderMonitor(monitor){if(!monitor)return;state.monitor=monitor;const status=monitor.status||monitor.phase||'idle',enabled=monitor.enabled!==false;
    const names={idle:'Kontrol için hazır',running:'Arşiv kontrol ediliyor',waiting:'Sonraki kontrol bekleniyor',waiting_crawler:'İlan taramasının bitmesi bekleniyor',blocked:'Tarayıcıda erişim kontrolü bekleniyor',paused:'Kontroller duraklatıldı'};
    $('monitorEnabledBadge').textContent=!enabled?'Otomatik kontrol kapalı':status==='paused'?'Duraklatıldı':status==='blocked'?'Kontrol bekleniyor':'Otomatik takip açık';$('monitorEnabledBadge').className=`monitor-state-badge ${!enabled||['paused','blocked'].includes(status)?'paused':''}`;
    $('monitorRunState').textContent=names[status]||'Durum kontrol ediliyor';$('monitorRunMessage').textContent=monitor.message||'';$('monitorLastRun').textContent=formatDate(monitor.lastRun);$('monitorNextRun').textContent=enabled?formatDate(monitor.nextDue):'Otomatik kontrol kapalı';
    $('monitorSummaryText').textContent=status==='running'?`${Number(monitor.counts?.checked||0).toLocaleString('tr-TR')} bağlantı kontrol edildi.`:'Yayın durumu değişse de ilan bilgileriniz arşivde kalır.';$('lastCheckSummary').textContent=monitor.lastRun?`Son kontrol: ${formatDate(monitor.lastRun)}`:'Henüz kontrol yapılmadı.';
    if(!state.monitorDirty){$('monitorEnabled').checked=enabled;$('monitorInterval').value=monitor.intervalMinutes??360;$('monitorConfirmation').value=monitor.confirmationMinutes??15;}state.monitorLoaded=true;
    $('saveMonitorBtn').disabled=state.monitorBusy;$('runMonitorBtn').disabled=state.monitorBusy||status==='running';$('runMonitorQuickBtn').disabled=$('runMonitorBtn').disabled;$('pauseMonitorBtn').disabled=state.monitorBusy||!enabled||status==='paused';$('resumeMonitorBtn').disabled=state.monitorBusy||(enabled&&!['paused','blocked'].includes(status));renderAvailabilityCounts();
  }
  function renderTelegram(telegram){if(!telegram)return;state.telegram=telegram;const counts=telegram.counts||{};
    if(!state.telegramDirty)$('telegramChatId').value=telegram.chatId||'-5103130278';
    $('telegramTokenHint').textContent=telegram.configured?'Bir bot tokeni kayıtlı. Değiştirmeyecekseniz bu alanı boş bırakın.':'Bot tokeni henüz kaydedilmemiş.';
    $('telegramVerifiedBadge').textContent=telegram.verified?'Bağlantı doğrulandı':telegram.configured?'Doğrulama gerekli':'Bot ayarlanmamış';$('telegramVerifiedBadge').className=`monitor-state-badge ${telegram.verified?'':'paused'}`;
    $('telegramDestination').textContent=[telegram.chatTitle,telegram.botUsername?'@'+telegram.botUsername.replace(/^@/,''):'',telegram.chatId].filter(Boolean).join(' · ')||'Grup ve bot bilgileri doğrulamayla gösterilir.';
    $('telegramError').textContent=telegram.lastError||'';$('telegramError').hidden=!telegram.lastError;
    $('telegramPending').textContent=Number((counts.queued||0)+(counts.sending||0)).toLocaleString('tr-TR');$('telegramSent').textContent=Number(counts.sent||0).toLocaleString('tr-TR');$('telegramFailed').textContent=Number(counts.failed||0).toLocaleString('tr-TR');$('telegramUncertain').textContent=Number(counts.uncertain||0).toLocaleString('tr-TR');
    $('retryUncertainLabel').hidden=!counts.uncertain;$('telegramRetryHint').hidden=!counts.uncertain;if(!counts.uncertain)$('retryUncertain').checked=false;
    $('saveTelegramBtn').disabled=state.telegramBusy;$('verifyTelegramBtn').disabled=state.telegramBusy||!telegram.configured||state.telegramDirty;$('testTelegramBtn').disabled=state.telegramBusy||!telegram.verified||state.telegramDirty;
    $('retryTelegramBtn').disabled=state.telegramBusy||!telegram.verified||state.telegramDirty||!(counts.failed||counts.uncertain&&$('retryUncertain').checked);$('retryTelegramBtn').textContent=$('retryUncertain').checked?'Hatalı ve belirsiz gönderimleri tekrar dene':'Hatalı gönderimleri tekrar dene';state.telegramLoaded=true;
  }
  async function syncMonitoring(){if(!globalThis.chrome?.runtime?.sendMessage)return;const results=await Promise.allSettled([runtime('ILAN_MONITOR_STATUS'),runtime('ILAN_TELEGRAM_STATUS')]);if(results[0].status==='fulfilled')renderMonitor(results[0].value.monitor);else if(!state.monitorLoaded){$('monitorEnabledBadge').textContent='Durum alınamadı';$('monitorRunState').textContent='Takip durumu alınamadı.';}if(results[1].status==='fulfilled')renderTelegram(results[1].value.telegram);else if(!state.telegramLoaded)$('telegramTokenHint').textContent='Bot ayarları okunamadı; eklentinin çalıştığını kontrol edin.';}
  async function monitorAction(type,config={}){if(state.monitorBusy)return;state.monitorBusy=true;renderMonitor(state.monitor);try{const result=await runtime(type,config);if(type==='ILAN_MONITOR_CONFIG')state.monitorDirty=false;if(result.monitor)renderMonitor(result.monitor);toast(({ILAN_MONITOR_CONFIG:'Kontrol ayarları kaydedildi.',ILAN_MONITOR_RUN:'Kontrol isteği sıraya alındı; ilan taraması sürüyorsa tamamlanınca başlayacak.',ILAN_MONITOR_PAUSE:'Arşiv kontrolleri duraklatıldı.',ILAN_MONITOR_RESUME:'Arşiv kontrolleri devam ediyor.'})[type]||'İşlem tamamlandı.');await refresh();}catch(error){toast(error.message,true);}finally{state.monitorBusy=false;renderMonitor(state.monitor);}}
  async function telegramAction(type,config={}){if(state.telegramBusy)return;state.telegramBusy=true;renderTelegram(state.telegram);try{const result=await runtime(type,config);if(type==='ILAN_TELEGRAM_CONFIG'){state.telegramDirty=false;$('telegramToken').value='';}if(result.telegram)renderTelegram(result.telegram);toast(result.message||({ILAN_TELEGRAM_CONFIG:'Telegram ayarları kaydedildi.',ILAN_TELEGRAM_VERIFY:'Bot ve grup bağlantısı doğrulandı.',ILAN_TELEGRAM_TEST:'Test mesajı gönderme işlemi tamamlandı.',ILAN_TELEGRAM_RETRY:'Seçilen bildirimler yeniden gönderim için işlendi.'})[type]||'İşlem tamamlandı.');await syncMonitoring();}catch(error){toast(error.message,true);}finally{state.telegramBusy=false;renderTelegram(state.telegram);}}
  function bindMonitoring(){
    $('showMonitorBtn').addEventListener('click',showMonitoring);$('closeMonitorBtn').addEventListener('click',()=>{$('monitorPanel').hidden=true;$('showMonitorBtn').setAttribute('aria-expanded','false');$('showMonitorBtn').focus();});
    document.querySelectorAll('[data-availability]').forEach(button=>button.addEventListener('click',()=>{setCategory('all');$('filterAvailability').value=button.dataset.availability;$('extraFilters').hidden=false;$('moreFiltersBtn').setAttribute('aria-expanded','true');state.page=1;render();$('archiveTitle').scrollIntoView({behavior:'smooth',block:'nearest'});}));
    $('monitorForm').addEventListener('input',()=>{state.monitorDirty=true;});$('monitorForm').addEventListener('submit',event=>{event.preventDefault();const interval=Number($('monitorInterval').value),confirmation=Number($('monitorConfirmation').value);if(!Number.isInteger(interval)||interval<15||!Number.isInteger(confirmation)||confirmation<10){toast('Kontrol aralığı en az 15, doğrulama aralığı en az 10 dakika olmalı.',true);return;}monitorAction('ILAN_MONITOR_CONFIG',{enabled:$('monitorEnabled').checked,intervalMinutes:interval,confirmationMinutes:confirmation});});
    $('runMonitorBtn').addEventListener('click',()=>monitorAction('ILAN_MONITOR_RUN'));$('runMonitorQuickBtn').addEventListener('click',()=>monitorAction('ILAN_MONITOR_RUN'));$('pauseMonitorBtn').addEventListener('click',()=>monitorAction('ILAN_MONITOR_PAUSE'));$('resumeMonitorBtn').addEventListener('click',()=>monitorAction('ILAN_MONITOR_RESUME'));
    $('telegramForm').addEventListener('input',()=>{state.telegramDirty=true;renderTelegram(state.telegram);});$('telegramForm').addEventListener('submit',event=>{event.preventDefault();const chatId=$('telegramChatId').value.trim(),token=$('telegramToken').value.trim();if(!chatId){toast('Telegram grup kimliğini girin.',true);return;}const config={chatId};if(token)config.token=token;telegramAction('ILAN_TELEGRAM_CONFIG',config);});
    $('verifyTelegramBtn').addEventListener('click',()=>telegramAction('ILAN_TELEGRAM_VERIFY'));$('testTelegramBtn').addEventListener('click',()=>telegramAction('ILAN_TELEGRAM_TEST'));$('retryTelegramBtn').addEventListener('click',()=>telegramAction('ILAN_TELEGRAM_RETRY',{includeUncertain:$('retryUncertain').checked}));$('retryUncertain').addEventListener('change',()=>renderTelegram(state.telegram));
  }


  const eventNames={new:'Aramada yeni görülen',removed:'Yayından kaldırıldı',price_down:'Fiyat düştü',price_up:'Fiyat yükseldi',reactivated:'Yeniden yayında'};
  const eventSymbols={new:'+',removed:'−',price_down:'↘',price_up:'↗',reactivated:'↻'};
  const searchStatusNames={idle:'Hazır',running:'Taranıyor',queued:'Tarama sırada',starting:'Başlatılıyor',completed:'Tarama tamamlandı',done:'Tarama tamamlandı',incomplete:'Tarama kısmi kaldı',error:'Tarama hatası',blocked:'Tarayıcıda kontrol bekleniyor',paused:'Duraklatıldı',waiting:'Sonraki tur bekleniyor',stopped:'Durduruldu'};
  function eventPrice(value,currency){return value===null||value===undefined||value===''?'—':Core.formatMoney(Number(value),currency||'TRY');}
  function eventRecord(event){return state.records.find(record=>record.id===event.recordId||record.listingId&&record.listingId===event.listingId);}
  function updateMarketSearchOptions(){const selected=$('marketSearch').value||'all',options=new Map(state.searches.map(search=>[search.id,search.name||search.searchUrl]));for(const event of state.events)for(const id of event.searchIds||[])if(id&&!options.has(id))options.set(id,`Arşivdeki arama · ${String(id).slice(-10)}`);if(selected!=='all'&&!options.has(selected))options.set(selected,`Arşivdeki arama · ${String(selected).slice(-10)}`);$('marketSearch').replaceChildren(new Option('Tüm aramalar','all'));for(const [id,name] of options)$('marketSearch').append(new Option(name,id));$('marketSearch').value=selected;}
  function renderMarket(){const groups={new:new Set(),removed:new Set(),price_down:new Set(),price_up:new Set(),reactivated:new Set()};for(const event of state.events)if(Object.hasOwn(groups,event.type))groups[event.type].add(event.recordId||`${event.source||''}:${event.listingId||event.id}`);const counts=Object.fromEntries(Object.entries(groups).map(([type,ids])=>[type,ids.size]));
    for(const [type,id] of Object.entries({new:'eventNewCount',removed:'eventRemovedCount',price_down:'eventDownCount',price_up:'eventUpCount',reactivated:'eventReactivatedCount'}))$(id).textContent=counts[type].toLocaleString('tr-TR');
    document.querySelectorAll('[data-event-type]').forEach(button=>{const active=button.dataset.eventType===state.marketType;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});
    const filtered=state.events.filter(event=>state.marketType==='all'||event.type===state.marketType),totalPages=Math.max(1,Math.ceil(filtered.length/20));state.marketPage=Math.max(1,Math.min(state.marketPage,totalPages));const start=(state.marketPage-1)*20,page=filtered.slice(start,start+20);
    $('marketEventCount').textContent=filtered.length.toLocaleString('tr-TR');$('marketResetTypeBtn').hidden=state.marketType==='all';const selectedSearch=$('marketSearch').selectedOptions[0]?.textContent||'Tüm aramalar';$('marketScopeLabel').textContent=`${selectedSearch} · ${$('marketTimeframe').selectedOptions[0]?.textContent||'Son 24 saat'}`;
    const tbody=$('marketBody');tbody.replaceChildren();for(const event of page){const row=el('tr'),type=el('td'),badge=el('span',`market-event-label ${event.type}`);badge.append(el('span','',eventSymbols[event.type]||'·'),el('span','',eventNames[event.type]||'İlan hareketi'));type.append(badge);row.append(type);
      const title=el('td'),record=eventRecord(event),titleNode=el(record?'button':'span','record-title',event.title||record?.title||'Başlık kaydedilmemiş');if(record){titleNode.type='button';titleNode.addEventListener('click',()=>showDetail(record.id));}title.append(titleNode,el('div','record-meta',[labels[event.category]||'Diğer',sourceName(event.source),event.listingId].filter(Boolean).join(' · ')));row.append(title);
      const price=el('td');price.append(el('span','market-price-new',eventPrice(event.newPrice??event.oldPrice,event.currency)));if(['price_up','price_down'].includes(event.type))price.append(el('span','market-price-old',eventPrice(event.oldPrice,event.currency)));row.append(price);
      const change=el('td');if(['price_up','price_down'].includes(event.type)){const percent=event.percent===null||event.percent===undefined?null:Number(event.percent),delta=event.delta===null||event.delta===undefined?null:Number(event.delta);change.append(el('span',`market-price-change ${event.type}`,Number.isFinite(percent)?`${eventSymbols[event.type]} %${Math.abs(percent).toLocaleString('tr-TR',{maximumFractionDigits:2})}`:'Oran hesaplanamadı'));if(Number.isFinite(delta))change.append(el('span','market-delta',`${delta>0?'+':delta<0?'−':''}${eventPrice(Math.abs(delta),event.currency)}`));}else change.append(el('span','muted-dash','—'));row.append(change,el('td','market-date',formatDate(event.at)));
      const source=el('td'),url=safeUrl(event.url);if(url){const link=el('a','market-source-link','↗');link.href=url;link.target='_blank';link.rel='noopener noreferrer';link.setAttribute('aria-label',`${event.title||'İlan'} kaynak sayfasını aç`);source.append(link);}row.append(source);tbody.append(row);
    }
    $('marketFeedWrap').hidden=!page.length;$('marketEmpty').hidden=Boolean(page.length);$('marketRange').textContent=filtered.length?`${(start+1).toLocaleString('tr-TR')}–${Math.min(start+20,filtered.length).toLocaleString('tr-TR')} / ${filtered.length.toLocaleString('tr-TR')} hareket`:'Seçili dönemde hareket yok';$('marketPageIndicator').textContent=`${state.marketPage} / ${totalPages}`;$('marketPrevBtn').disabled=state.marketPage<=1;$('marketNextBtn').disabled=state.marketPage>=totalPages;
    const emptyHeading=$('marketEmpty').querySelector('h3'),emptyText=$('marketEmpty').querySelector('p');emptyHeading.textContent=state.marketType==='all'?'Hareketler burada görünecek':'Bu türde kayıtlı hareket yok';emptyText.textContent='İlk tarama başlangıç kaydıdır; sonraki taramalarda yeni görülenler ve doğrulanmış değişimler gösterilir.';
  }
  async function refreshMarket(){if(!DB.getEvents){state.events=[];renderMarket();return;}const request=++marketRequest,period=$('marketTimeframe').value,searchId=$('marketSearch').value;const since=period==='all'?undefined:new Date(Date.now()-(period==='7d'?7:1)*24*60*60*1000).toISOString();try{const events=await DB.getEvents({since,searchId:searchId==='all'?undefined:searchId,limit:0});if(request!==marketRequest)return;state.events=Array.isArray(events)?events.slice().sort((a,b)=>String(b.at).localeCompare(String(a.at))):[];updateMarketSearchOptions();renderMarket();}catch(error){if(request!==marketRequest)return;toast(`İlan hareketleri okunamadı: ${error.message}`,true);}}
  function scheduleMarketRefresh(){clearTimeout(marketRefreshTimer);marketRefreshTimer=setTimeout(refreshMarket,350);}
  function renderSearches(){const list=$('searchesList');list.replaceChildren();for(const search of state.searches){const card=el('article','saved-search-card'),info=el('div'),heading=el('h3','saved-search-title');heading.append(el('span',`availability-dot ${search.enabled?'active':'unknown'}`),el('span','',search.name||'İzlenen arama'));info.append(heading,el('div','saved-search-meta',`${search.category==='all'?'Tüm kategoriler':labels[search.category]||'Diğer'} · ${Number(search.intervalMinutes||60).toLocaleString('tr-TR')} dakikada bir · ${search.enabled?'Takip açık':'Takip kapalı'}`),el('div','saved-search-meta',search.hasBaseline?'Başlangıç kaydı oluşturuldu.':'İlk eksiksiz taramada başlangıç kaydı oluşturulacak.'));const source=safeUrl(search.searchUrl);if(source){const link=el('a','saved-search-meta','Arama sayfasını aç ↗');link.href=source;link.target='_blank';link.rel='noopener noreferrer';info.append(link);}card.append(info);
      const status=el('div'),statusLabel=el('div',`saved-search-state ${['error','blocked','incomplete'].includes(search.lastStatus)?'error':''}`,searchStatusNames[search.lastStatus]||'İlk tarama bekleniyor');status.append(statusLabel);if(search.lastMessage)status.append(el('div','saved-search-meta',search.lastMessage));const times=el('div','saved-search-times');times.append(el('span','',`Son tarama: ${formatDate(search.lastRunAt)}`),el('span','',`Sonraki: ${search.enabled?formatDate(search.nextRunAt):'Takip kapalı'}`));status.append(times);card.append(status);
      if(search.listId)card.append(el('p','capture-help',`Kaydedildiği liste: ${listName(search.listId)}`));const actions=el('div','saved-search-actions');for(const [text,type,config] of [['Şimdi tara','ILAN_SEARCH_RUN',{id:search.id}],[search.enabled?'Takibi durdur':'Takibi aç','ILAN_SEARCH_TOGGLE',{id:search.id,enabled:!search.enabled}],['Takipten çıkar','ILAN_SEARCH_REMOVE',{id:search.id}]]){const button=el('button','button compact secondary',text);button.type='button';button.disabled=state.searchBusy;button.addEventListener('click',async()=>{if(type==='ILAN_SEARCH_RUN'){const target=await chooseList(search.listId||'');if(!target)return;showList(target.listId);await searchAction(type,{...config,listId:target.listId});return;}searchAction(type,config);});if(type==='ILAN_SEARCH_REMOVE')button.title='Yalnızca düzenli takip kaldırılır; arşiv ve hareket kayıtları korunur.';actions.append(button);}card.append(actions);list.append(card);
    }$('searchesEmpty').hidden=Boolean(state.searches.length);$('saveSearchBtn').disabled=state.searchBusy;updateMarketSearchOptions();renderMarket();
  }
  async function syncSearches(){if(!globalThis.chrome?.runtime?.sendMessage)return;try{const result=await runtime('ILAN_SEARCH_STATUS');if(Array.isArray(result.searches)){state.searches=result.searches;renderSearches();}}catch(error){if(!$('searchesPanel').hidden)console.warn('İzlenen aramalar okunamadı:',error.message);}}
  async function searchAction(type,config={}){if(state.searchBusy)return;state.searchBusy=true;renderSearches();try{const result=await runtime(type,config);if(Array.isArray(result.searches))state.searches=result.searches;if(result.job)renderJob(result.job);toast(result.message||({ILAN_SEARCH_SAVE:'Arama düzenli takibe kaydedildi.',ILAN_SEARCH_RUN:'Arama için tarama isteği alındı.',ILAN_SEARCH_TOGGLE:config.enabled?'Düzenli takip açıldı.':'Düzenli takip kapatıldı.',ILAN_SEARCH_REMOVE:'Arama takipten çıkarıldı. Arşiv ve hareket kayıtları korundu.'})[type]||'İşlem tamamlandı.');await syncSearches();return result;}catch(error){toast(error.message,true);return null;}finally{state.searchBusy=false;renderSearches();}}
  function collectUrl(value){
    try{
      const url=new URL(value);
      if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.port)return null;
      const host=url.hostname.toLowerCase();
      const source=['sahibinden','hepsiemlak'].find(name=>host===`${name}.com`||host===`www.${name}.com`||host===`m.${name}.com`);
      if(!source)return null;
      const isListing=source==='sahibinden'?/^\/ilan\/.+-\d+\/detay\/?$/.test(url.pathname):/\/\d+-\d+\/?$/.test(url.pathname);
      return {source,isListing,url:url.href};
    }catch{return null;}
  }
  function collectValidation(){
    const direct=state.collectMode==='links',raw=direct?$('directUrls').value:$('searchUrl').value;
    const urls=unique(raw.split(/\r?\n/).map(value=>value.trim()));
    if(!urls.length)return {valid:false,empty:true,label:'Bağlantı ekleyin',message:''};
    const parsed=urls.map(collectUrl),invalid=parsed.findIndex(value=>!value);
    if(invalid!==-1)return {valid:false,label:'Bağlantıyı kontrol edin',message:`${direct?`${invalid+1}. bağlantı: `:''}Geçerli bir Sahibinden veya Hepsiemlak adresi girin.`};
    if(!direct&&(urls.length!==1||parsed[0].isListing))return {valid:false,label:'Arama bağlantısı gerekli',message:'Bu alan sonuç listesinin adresi içindir. Tek ilan için İlan bağlantıları sekmesini seçin.'};
    if(direct&&parsed.some(value=>!value.isListing))return {valid:false,label:'İlan bağlantısı gerekli',message:'Her satıra bir ilan detay bağlantısı girin. Sonuç listesi için Arama bağlantısı sekmesini seçin.'};
    if(new Set(parsed.map(value=>value.source)).size>1)return {valid:false,label:'Kaynaklar farklı',message:'Sahibinden ve Hepsiemlak bağlantılarını ayrı taramalarda ekleyin.'};
    return {valid:true,urls,label:`${sourceName(parsed[0].source)} · Tarama hazır`,message:direct?`${urls.length.toLocaleString('tr-TR')} tekil ilan bağlantısı hazır.`:'Bağlantı biçimi geçerli. Tarama başlatıldığında sayfaya erişim kontrol edilir.'};
  }
  function updateCollectReady(){
    const result=collectValidation(),direct=state.collectMode==='links',field=$(direct?'directUrls':'searchUrl');
    $('collectionReadyText').textContent=result.label;$('collectionReady').classList.toggle('ready',result.valid);$('collectionReady').classList.toggle('warning',!result.valid&&!result.empty);
    $('collectValidation').textContent=result.message;$('collectValidation').hidden=!result.message;$('collectValidation').classList.toggle('invalid',!result.valid&&!result.empty);
    field.setAttribute('aria-invalid',String(!result.valid&&!result.empty));field.setAttribute('aria-describedby','collectValidation');field.setCustomValidity(!result.valid&&!result.empty?result.message:'');
    const lines=$('directUrls').value.split(/\r?\n/).map(value=>value.trim()).filter(Boolean),count=new Set(lines).size;$('directUrlCount').textContent=`${count.toLocaleString('tr-TR')} bağlantı${lines.length!==count?' · yinelenen satırlar birleştirilir':''}`;
    const status=state.job?.status||state.job?.state||'idle';$('startBtn').disabled=state.busy||!result.valid||['starting','running','collecting','stopping','paused','blocked'].includes(status);
    return result;
  }
  function setCollectMode(mode){state.collectMode=mode;const direct=mode==='links';$('searchModeFields').hidden=direct;$('linksModeFields').hidden=!direct;$('searchUrl').required=!direct;$('searchUrl').disabled=direct;$('directUrls').required=direct;$('directUrls').disabled=!direct;$('maxListings').closest('label').hidden=direct;$('maxListings').disabled=direct;$('collectFollowSettings').hidden=direct;$('trackSearchInterval').disabled=direct;$('collectionRoute').hidden=direct;$('modeSearchBtn').classList.toggle('active',!direct);$('modeLinksBtn').classList.toggle('active',direct);$('modeSearchBtn').setAttribute('aria-selected',String(!direct));$('modeLinksBtn').setAttribute('aria-selected',String(direct));$('startBtn').textContent=direct?'İlanları getir':'Taramayı başlat';updateCollectReady();}
  async function startCollection(){const max=Number($('maxListings').value),delay=Number($('delaySeconds').value),interval=Number($('trackSearchInterval').value);if(!Number.isFinite(delay)||delay<3){toast('İlanlar arasındaki bekleme en az 3 saniye olmalı.',true);return;}if(state.collectMode==='links'){const urls=$('directUrls').value.split(/\r?\n/).map(value=>value.trim()).filter(Boolean);if(!urls.length){toast('En az bir ilan bağlantısını ekleyin.',true);return;}const target=await chooseList();if(!target)return;showList(target.listId);await jobAction('ILAN_START_LINKS',{urls,listId:target.listId,category:$('collectCategory').value,maxListings:0,delayMs:delay*1000,revealPhone:$('revealPhone').checked});return;}if(!Number.isInteger(max)||max<0){toast('İlan sınırı 0 veya pozitif tam sayı olmalı.',true);return;}if($('trackSearch').checked&&(!Number.isInteger(interval)||interval<15)){toast('Düzenli tarama aralığı en az 15 dakika olmalı.',true);return;}const target=await chooseList();if(!target)return;showList(target.listId);const config={listId:target.listId,searchUrl:$('searchUrl').value.trim(),category:$('collectCategory').value,maxListings:max,maxPages:0,delayMs:delay*1000,revealPhone:$('revealPhone').checked};if(!$('trackSearch').checked){await jobAction('ILAN_START',config);return;}if(!Number.isInteger(interval)||interval<15){toast('Düzenli tarama aralığı en az 15 dakika olmalı.',true);return;}if(state.busy)return;state.busy=true;renderJob(state.job);let saved=false;try{const result=await runtime('ILAN_SEARCH_SAVE',{listId:config.listId,searchUrl:config.searchUrl,name:$('trackSearchName').value.trim(),category:config.category,intervalMinutes:interval,enabled:true,revealPhone:config.revealPhone,delayMs:config.delayMs});saved=true;if(Array.isArray(result.searches)){state.searches=result.searches;renderSearches();}if(!result.search?.id)throw Error('Kaydedilen aramanın kimliği alınamadı.');const run=await runtime('ILAN_SEARCH_RUN',{id:result.search.id,maxListings:max,maxPages:0});if(run.job)renderJob(run.job);toast('Arama düzenli takibe alındı ve tarama isteği iletildi.');await syncSearches();}catch(error){toast(`${saved?'Arama kaydedildi; tarama başlatılamadı. ':''}${error.message}`,true);}finally{state.busy=false;renderJob(state.job);}}
  function renderPageProgress(job){const p=job?.pageProgress;$('pageProgressSummary').hidden=!p;if(!p)return;const finite=value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value)),num=value=>Number(value).toLocaleString('tr-TR');$('pageProgressTitle').textContent=finite(p.currentPage)?`Sayfa ${num(p.currentPage)}${finite(p.totalPages)&&Number(p.totalPages)>0?' / '+num(p.totalPages):' · toplam henüz bilinmiyor'}`:'Sayfa bilgisi bekleniyor';const paused={paused:'Duraklatıldı',blocked:'Tarayıcıda kontrol bekliyor',stopped:'Durduruldu',incomplete:'Kısmi tarama',error:'Hata nedeniyle durdu'}[job.status||job.state];$('pageProgressStage').textContent=paused||({list:'İlan bağlantıları okunuyor',details:'Bu sayfanın ilanları işleniyor',done:job.status==='completed'?'Tarama tamamlandı':'Sayfa işleme sona erdi'})[p.stage]||'Tarama sürüyor';$('pageProgressCurrent').textContent=finite(p.pageProcessed)&&finite(p.pageFound)?`Bu sayfada ${num(p.pageProcessed)} / ${num(p.pageFound)} ilan`:finite(p.pageFound)?`Bu sayfada ${num(p.pageFound)} ilan bulundu`:'İlan sayısı bekleniyor';$('pageProgressTotal').textContent=finite(p.totalProcessed)?`Toplam ${num(p.totalProcessed)}${finite(p.totalExpected)&&Number(p.totalExpected)>0?' / '+num(p.totalExpected):''} ilan işlendi`:'';}
  function bindMarket(){
    $('modeSearchBtn').addEventListener('click',()=>setCollectMode('search'));$('modeLinksBtn').addEventListener('click',()=>setCollectMode('links'));for(const id of ['searchUrl','directUrls'])for(const event of ['input','change'])$(id).addEventListener(event,updateCollectReady);$('navCollectBtn').addEventListener('click',showCollect);setCollectMode('search');
    for(const id of ['marketTimeframe','marketSearch'])$(id).addEventListener('change',()=>{state.marketPage=1;refreshMarket();});document.querySelectorAll('[data-event-type]').forEach(button=>button.addEventListener('click',()=>{state.marketType=state.marketType===button.dataset.eventType?'all':button.dataset.eventType;state.marketPage=1;renderMarket();}));$('marketResetTypeBtn').addEventListener('click',()=>{state.marketType='all';state.marketPage=1;renderMarket();});$('marketPrevBtn').addEventListener('click',()=>{state.marketPage--;renderMarket();});$('marketNextBtn').addEventListener('click',()=>{state.marketPage++;renderMarket();});
    $('showSearchesBtn').addEventListener('click',()=>{const open=$('searchesPanel').hidden;$('searchesPanel').hidden=!open;$('showSearchesBtn').setAttribute('aria-expanded',String(open));if(open){$('searchesPanel').scrollIntoView({behavior:'smooth',block:'nearest'});syncSearches();}});$('closeSearchesBtn').addEventListener('click',()=>{$('searchesPanel').hidden=true;$('showSearchesBtn').setAttribute('aria-expanded','false');$('showSearchesBtn').focus();});$('newSearchDetails').addEventListener('toggle',()=>{if($('newSearchDetails').open&&!$('savedSearchUrl').value&&$('searchUrl').value){$('savedSearchUrl').value=$('searchUrl').value;$('savedSearchName').value=$('trackSearchName').value;$('savedSearchCategory').value=$('collectCategory').value;}});
    $('savedSearchForm').addEventListener('submit',async event=>{event.preventDefault();const interval=Number($('savedSearchInterval').value);if(!Number.isInteger(interval)||interval<15){toast('Tarama aralığı en az 15 dakika olmalı.',true);return;}const result=await searchAction('ILAN_SEARCH_SAVE',{searchUrl:$('savedSearchUrl').value.trim(),name:$('savedSearchName').value.trim(),category:$('savedSearchCategory').value,intervalMinutes:interval,enabled:$('savedSearchEnabled').checked,revealPhone:true,delayMs:4000});if(result)$('newSearchDetails').open=false;});$('trackSearch').addEventListener('change',()=>{$('trackSearchFields').hidden=!$('trackSearch').checked;});
  }

  function bind(){
    bindMonitoring();bindMarket();
    document.querySelectorAll('[data-category]').forEach(button=>{button.setAttribute('aria-label',({all:'Tüm ilanlar',review:'İnceleme gerekli',trash:'Çöp kutusu'})[button.dataset.category]||labels[button.dataset.category]);button.addEventListener('click',()=>setCategory(button.dataset.category));});
    $('showCollectBtn').addEventListener('click',showCollect);$('emptyCollectBtn').addEventListener('click',showCollect);
    for(const id of ['importBtn','emptyImportBtn'])$(id).addEventListener('click',()=>$('importFile').click());$('importFile').addEventListener('change',event=>importFile(event.target.files[0]));
    $('backupBtn').addEventListener('click',async()=>{try{await runBackup(false);}catch(error){toast(error.message,true);}});
    $('autoBackup').addEventListener('change',async()=>{if(globalThis.chrome?.storage?.local)await chrome.storage.local.set({[BACKUP_KEY]:{...(await backupConfig()),auto:$('autoBackup').checked}});await renderBackup();toast($('autoBackup').checked?'Haftalık otomatik yedek açık. Panel açıldığında, son yedekten 7 gün geçtiyse yedek iner.':'Otomatik yedek kapatıldı.');});
    for(const id of ['safetyWindow','safetySkipKnown','safetyReusePhone','safetyDailyLimit'])$(id).addEventListener('change',saveSafety);
    for(const id of ['alertPriceDrop','alertMinDrop','alertNewListing','alertHealth','alertSummary','alertSummaryTime'])$(id).addEventListener('change',saveAlerts);
    $('summaryNowBtn').addEventListener('click',async()=>{$('summaryNowBtn').disabled=true;try{await runtime('ILAN_ALERTS_SUMMARY_NOW');toast('Günlük özet Telegram kuyruğuna alındı. Telegram bağlantısı doğrulanmamışsa gönderilmez.');}catch(error){toast(error.message,true);}finally{$('summaryNowBtn').disabled=false;}});
    for(const [key,name] of Object.entries(Core.CRM_STATUSES))$('filterCrm').append(new Option(name,key));
    $('listManageBtn').addEventListener('click',openListManager);$('listRenameBtn').addEventListener('click',renameList);
    $('listMergeBtn').addEventListener('click',()=>relabel($('listMergeSelect').value));$('listDeleteBtn').addEventListener('click',()=>relabel(''));
    $('xlsxBtn').addEventListener('click',()=>exportFiltered('exportXlsx'));$('csvBtn').addEventListener('click',()=>exportFiltered('exportCsv'));
    $('filterQuery').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{state.page=1;render();},150);});for(const id of ['filterList','filterSource','filterCity','filterMinPrice','filterMaxPrice','filterQuality','filterCurrency','filterAvailability','filterExcludeList','filterCrm','filterInsight'])$(id).addEventListener('input',()=>{state.page=1;$('listManageBtn').disabled=$('filterList').value==='all';render();});
    $('moreFiltersBtn').addEventListener('click',()=>{const open=$('extraFilters').hidden;$('extraFilters').hidden=!open;$('moreFiltersBtn').setAttribute('aria-expanded',String(open));});$('clearFiltersBtn').addEventListener('click',resetFilters);
    $('pageSize').addEventListener('change',()=>{state.pageSize=Number($('pageSize').value);state.page=1;render();});$('prevPageBtn').addEventListener('click',()=>{state.page--;render();});$('nextPageBtn').addEventListener('click',()=>{state.page++;render();});
    $('closeDetailBtn').addEventListener('click',()=>$('detailDialog').close());$('detailDialog').addEventListener('click',event=>{if(event.target===$('detailDialog')){const rect=event.target.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)event.target.close();}});
    $('collectForm').addEventListener('submit',event=>{event.preventDefault();const check=updateCollectReady();if(!check.valid){toast(check.message||'Önce bir bağlantı ekleyin.',true);return;}startCollection();});
    $('captureBtn').addEventListener('click',()=>jobAction('ILAN_CAPTURE_TAB',{category:$('collectCategory').value,revealPhone:$('revealPhone').checked,listId:$('filterList').value==='all'?'':$('filterList').value}));$('pauseBtn').addEventListener('click',()=>jobAction('ILAN_PAUSE'));$('resumeBtn').addEventListener('click',()=>jobAction('ILAN_RESUME'));$('stopBtn').addEventListener('click',()=>jobAction('ILAN_STOP'));
  }
  async function syncJob(){try{if(globalThis.chrome?.storage?.local){const result=await chrome.storage.local.get('ilan5.job.v2');renderJob(result['ilan5.job.v2']||null);}}catch(error){console.warn('Tarama durumu okunamadı',error.message);}}
  async function init(){if(!Core||!DB||!Transfer){toast('Eklenti dosyalarından biri eksik. Paketi yeniden çıkarıp eklentiyi yenileyin.',true);return;}try{const version=chrome.runtime.getManifest?.().version;if(version)$('versionText').textContent='Sürüm '+version;}catch(_){}bind();await loadLists();await refresh();await syncJob();await syncMonitoring();await syncSearches();await refreshMarket();await syncSafety();await renderBackup();await checkAutoBackup();setInterval(checkAutoBackup,60*60*1000);setInterval(()=>{if(!document.hidden)syncSafety();},20000);
    if(globalThis.chrome?.storage?.onChanged)chrome.storage.onChanged.addListener((changes,area)=>{if(area!=='local')return;if(changes['ilan5.job.v2'])renderJob(changes['ilan5.job.v2'].newValue||null);if(changes['ilan5.monitor.v1'])renderMonitor(changes['ilan5.monitor.v1'].newValue||null);if(Object.keys(changes).some(key=>key.startsWith('ilan5.telegram')))syncMonitoring();if(Object.keys(changes).some(key=>key.includes('search')))syncSearches();if(changes['ilan5.archive.updated']||Object.keys(changes).some(key=>key.includes('event')))scheduleMarketRefresh();if(changes[ARCHIVE_STAMP])autoRefresh();});
    if(globalThis.chrome?.runtime?.onMessage)chrome.runtime.onMessage.addListener(message=>{if(message.type==='ILAN_MONITOR_UPDATED'||message.type==='ILAN_TELEGRAM_UPDATED'){syncMonitoring();autoRefresh();}if(['ILAN_ARCHIVE_CHANGED','ILAN_UPDATED','ILAN_JOB_UPDATED'].includes(message.type)){autoRefresh();syncJob();scheduleMarketRefresh();}if(message.type==='ILAN_SEARCH_UPDATED'){syncSearches();scheduleMarketRefresh();}});
    setInterval(syncJob,2000);setInterval(()=>{if(!document.hidden){syncMonitoring();syncSearches();refreshMarket();}},15000);setInterval(()=>{if(!document.hidden)autoRefresh();},6000);document.addEventListener('visibilitychange',()=>{if(!document.hidden&&state.staleWhileHidden){state.staleWhileHidden=false;autoRefresh();}});
    if(new URL(location.href).searchParams.get('collect')==='1')showCollect();
  }
  init();
})();
