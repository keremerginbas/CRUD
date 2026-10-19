/* İlan5 data model. The chosen search category is never evidence of listing type. */
(function (root) {
  'use strict';
  const CATEGORIES = Object.freeze({arsa:'Arsa',arac:'Araç',konut:'Konut',isyeri:'İşyeri',diger:'Diğer',belirsiz:'Belirsiz'});
  const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const norm = value => clean(value).toLocaleLowerCase('tr-TR').replace(/ı/g,'i').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
  const plain = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const unique = values => [...new Set(values.filter(Boolean))];
  const safeUrl = value => { try { const u=new URL(clean(value)); return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password ? u.href : ''; } catch {return '';} };
  const canonicalUrl = value => {const url=safeUrl(value);if(!url)return '';const u=new URL(url);u.hash='';u.search='';u.hostname=u.hostname.replace(/^m\./,'www.');return u.href.replace(/\/$/,'');};
  function sourceFor(url) {try {const h=new URL(url).hostname;return /^(www\.|m\.)?hepsiemlak\.com$/.test(h)?'hepsiemlak':/^(www\.|m\.)?sahibinden\.com$/.test(h)?'sahibinden':'import';}catch{return 'import';}}
  function listingIdFromUrl(url) {try {const p=new URL(url).pathname;if(sourceFor(url)==='hepsiemlak')return p.match(/\/(\d+-\d+)\/?$/)?.[1]||'';if(sourceFor(url)==='sahibinden')return p.match(/-(\d+)(?:\/detay)?\/?$/)?.[1]||'';}catch{}return '';}
  function hash(value) {let x=2166136261;for(const c of String(value)){x^=c.charCodeAt(0);x=Math.imul(x,16777619);}return (x>>>0).toString(16);}
  function parseNumber(value) {if(typeof value==='number')return Number.isFinite(value)&&value>=0?value:null;if(!value)return null;const text=String(value).replace(/\u00a0/g,'');if(/-\s*\d/.test(text))return null;let t=text.match(/\d+(?:[.,]\d+)*/)?.[0];if(!t)return null;if(t.includes(','))t=t.replace(/\./g,'').replace(',','.');else if(/^\d{1,3}(\.\d{3})+$/.test(t))t=t.replace(/\./g,'');const n=Number(t);return Number.isFinite(n)?n:null;}
  function normalizePhone(value) {let n=String(value??'').replace(/\D/g,'');if(n.startsWith('0090'))n=n.slice(2);if(n.length===11&&n[0]==='0')n='90'+n.slice(1);else if(n.length===10)n='90'+n;return /^90[23458]\d{9}$/.test(n)?n:'';}
  function phonesFrom(value) {const texts=Array.isArray(value)?value:[value];return unique(texts.flatMap(v=>[...String(v??'').matchAll(/(?<!\d)(?:(?:\+|00)?90[\s().-]*)?0?[23458]\d{2}[\s().-]*\d{3}[\s().-]*\d{2}[\s().-]*\d{2}(?!\d)/g)].map(m=>normalizePhone(m[0]))));}
  function get(obj, ...aliases) {const entries=Object.entries(plain(obj));for(const a of aliases){const key=norm(a);const hit=entries.find(([k,v])=>norm(k)===key&&v!==''&&v!==null&&v!==undefined);if(hit)return hit[1];}return '';}
  function labelKey(k) {const words=norm(k).split(' '),half=words.length/2;return Number.isInteger(half)&&words.slice(0,half).join(' ')===words.slice(half).join(' ')?words.slice(0,half).join(' '):norm(k);}
  function detailGet(details,...aliases) {const keys=aliases.map(norm);return Object.entries(details||{}).find(([k,v])=>keys.includes(labelKey(k))&&clean(v))?.[1]||'';}
  function categoryValue(value) {const n=norm(value);if(Object.hasOwn(CATEGORIES,n))return n;if(/^(arac|vasita|otomobil|motosiklet|kamyon|minivan|suv|ticari arac)( |$)/.test(n))return 'arac';if(/^(arsa|tarla|bahce|imarli|konut ticaret|turistik arsa|depo antrepo izinli|muhtelif arsa)( |$)/.test(n))return 'arsa';if(/^(konut|daire|villa|mustakil ev|rezidans|residence)( |$)/.test(n))return 'konut';if(/^(isyeri|is yeri|dukkan|ofis|buro|magaza|fabrika|atolye)( |$)/.test(n))return 'isyeri';if(n==='diger')return 'diger';return 'belirsiz';}
  function urlEvidence(url) {
    const u=safeUrl(url);if(!u)return [];
    const path=new URL(u).pathname,source=sourceFor(u);let category='belirsiz';
    if(source==='sahibinden') {
      if(/^\/ilan\/vasita-/.test(path))category='arac';
      else if(/^\/ilan\/emlak-arsa-/.test(path))category='arsa';
      else if(/^\/ilan\/emlak-konut-/.test(path))category='konut';
      else if(/^\/ilan\/emlak-is(?:yeri|-yeri)-/.test(path))category='isyeri';
      else if(/^\/ilan\/(?:ikinci-el-ve-sifir-alisveris|is-makineleri-sanayi|yedek-parca-aksesuar-donanim-tuning|hayvanlar-alemi|ozel-ders-verenler|yardimci-arayanlar|ustalar-ve-hizmetler|is-ilanlari|is-makineleri-ve-sanayi)-/.test(path))category='diger';
    } else if(source==='hepsiemlak'&&/\d+-\d+\/?$/.test(path)) {
      const type=path.split('/').filter(Boolean).at(-2);
      if(['arsa','tarla','bahce','bag','zeytinlik','muhtelif-arsa','imarli-konut','imarli-ticari','konutticaret','imarli-sanayi','turistik-arsa','depo-antrepo-izinli','toplu-konut-icin-tahsis','imarli-villa','sit-alani','ozel-kullanim'].includes(type))category='arsa';
      else if(['daire','villa','mustakil-ev','residence','rezidans','yazlik','ciftlik-evi','yali'].includes(type))category='konut';
      else if(['dukkan-magaza','ofis','buro','fabrika','depo','atolye','plaza','isyeri','dukkan'].includes(type))category='isyeri';
    }
    return category==='belirsiz'?[]:[{category,source:'url',text:path}];
  }
  function classify(raw, details, url) {
    const evidence=urlEvidence(url);
    for(const item of [...(Array.isArray(raw.categoryEvidence)?raw.categoryEvidence:[]),...(Array.isArray(raw.classification?.evidence)?raw.classification.evidence:[])]) {
      if(!item||!['url','breadcrumb','field','explicit','import'].includes(item.source))continue;
      const category=categoryValue(item.category);if(category!=='belirsiz')evidence.push({category,source:item.source,text:clean(item.text).slice(0,500)});
    }
    const push=(category,source,text)=>evidence.push({category,source,text:clean(text).slice(0,500)});
    const land=detailGet(details,'Arsa Tipi','İmar Durumu');
    if(land)push('arsa','field','Arsa Tipi / İmar Durumu: '+land);
    if(detailGet(details,'Marka')&&detailGet(details,'Yakıt Tipi','KM','Kilometre','Vites','Motor Hacmi'))push('arac','field','Marka ve araç özellikleri');
    if(detailGet(details,'Konut Tipi','Konut Şekli'))push('konut','field','Konut türü alanı');
    if(detailGet(details,'İşyeri Tipi','İşyeri Türü'))push('isyeri','field','İşyeri türü alanı');
    if(detailGet(details,'Oda Sayısı')&&(detailGet(details,'Bina Yaşı')||detailGet(details,'Bulunduğu Kat'))&&!detailGet(details,'İşyeri Tipi','İşyeri Türü'))push('konut','field','Oda ve bina özellikleri');
    const explicit=categoryValue(get(raw,'category','Kategori','Kayıt Kategorisi'));
    // Imported category is evidence; it cannot override contradictory URL/fields.
    if(explicit!=='belirsiz'&&!(raw.schemaVersion===2&&raw.classification))push(explicit,'import','Kayıttaki kategori: '+get(raw,'category','Kategori','Kayıt Kategorisi'));
    const deduped=[...new Map(evidence.map(e=>[[e.category,e.source,norm(e.text)].join('|'),e])).values()];
    evidence.splice(0,evidence.length,...deduped);
    const distinct=unique(evidence.map(e=>e.category));
    if(raw.manualCategory&&Object.hasOwn(CATEGORIES,raw.manualCategory)&&raw.manualCategory!=='belirsiz')return {category:raw.manualCategory,status:'manual',evidence:[...evidence,{category:raw.manualCategory,source:'manual',text:'Kullanıcı tarafından doğrulandı'}]};
    return {category:distinct.length===1?distinct[0]:'belirsiz',status:distinct.length>1?'conflict':distinct.length?'verified':'unknown',evidence};
  }
  function normalizeMonitoring(value) {
    const raw=plain(value),out={};
    if(typeof raw.enabled==='boolean')out.enabled=raw.enabled;
    for(const key of ['status','lastCheckStatus'])if(['active','suspected','removed','unknown','blocked','error'].includes(raw[key]))out[key]=raw[key];
    for(const key of ['lastCheckedAt','lastActiveAt','firstMissingAt','lastMissingAt','removedAt','notifiedAt'])if(raw[key]===null)out[key]=null;else if(raw[key]&&Number.isFinite(Date.parse(raw[key])))out[key]=new Date(raw[key]).toISOString();
    if(Number.isFinite(Number(raw.missingCount)))out.missingCount=Math.max(0,Math.floor(Number(raw.missingCount)));
    for(const key of ['removalEventId','lastEvidence','lastError','notificationError'])if(raw[key]!==undefined)out[key]=clean(raw[key]).slice(0,key==='lastEvidence'?2000:500);
    if(['pending','queued','queue_error','sending','sent','uncertain','failed','cancelled'].includes(raw.notificationStatus))out.notificationStatus=raw.notificationStatus;
    return out;
  }
  function normalizeMarket(value) {
    const raw=plain(value),out={searchIds:unique((Array.isArray(raw.searchIds)?raw.searchIds:[]).map(id=>clean(id).slice(0,250)))};
    for(const key of ['lastSeenAt','firstObservedAt','latestEventAt'])if(raw[key]&&Number.isFinite(Date.parse(raw[key])))out[key]=new Date(raw[key]).toISOString();
    return out;
  }
  function normalizeMarketEvent(input) {
    if(!input||typeof input!=='object'||!['new','price_up','price_down','removed','reactivated'].includes(input.type))return null;
    const id=clean(input.id).slice(0,1500),recordId=clean(input.recordId).slice(0,500),time=typeof input.at==='number'?input.at:Date.parse(input.at||'');
    if(!id||!recordId||!Number.isFinite(time))return null;
    const oldPrice=parseNumber(input.oldPrice),newPrice=parseNumber(input.newPrice),priceEvent=['price_up','price_down'].includes(input.type);
    if(priceEvent&&(oldPrice===null||newPrice===null||oldPrice===newPrice||(input.type==='price_up'&&newPrice<oldPrice)||(input.type==='price_down'&&newPrice>oldPrice)))return null;
    const delta=priceEvent?newPrice-oldPrice:null;
    return {id,type:input.type,recordId,listingId:clean(input.listingId).slice(0,250),title:clean(input.title).slice(0,2000),url:canonicalUrl(input.url),category:categoryValue(input.category),source:['sahibinden','hepsiemlak','import'].includes(input.source)?input.source:'import',searchIds:normalizeMarket({searchIds:input.searchIds}).searchIds,at:new Date(time).toISOString(),oldPrice,newPrice,currency:clean(input.currency).toUpperCase().slice(0,20),delta,percent:priceEvent&&oldPrice>0?100*delta/oldPrice:null};
  }
  function normalizeRecord(input, options={}) {
    const wrapper=plain(input),raw=plain(wrapper.record&&typeof wrapper.record==='object'?wrapper.record:wrapper);
    const details={};
    for(const container of [wrapper.fields,raw.raw_details,raw.rawDetails,raw.fields])for(const [k,v] of Object.entries(plain(container)))if(!['__proto__','constructor','prototype'].includes(k)&&v!==null&&v!==undefined)details[clean(k)]=typeof v==='object'?JSON.stringify(v):clean(v);
    const propertyNames=['Arsa Tipi','İmar Durumu','Tapu Durumu','Ada/Parsel No','Ada/Parsel','İlgili Belediye','Kaks (Emsal)','Gabari','Takas','Kat Karşılığı','Krediye Uygunluk','Marka','Model','Seri','Yıl','Yakıt Tipi','Vites','KM','Kilometre','Oda Sayısı','Bina Yaşı','Bulunduğu Kat','Konut Tipi','İşyeri Tipi'];
    const spreadsheet=Object.keys(raw).some(k=>['İlan Başlığı','İlan No','Başlık','URL'].includes(k));
    const mappedColumns=new Set(['Kategori','Kayıt Kategorisi','Arşiv Durumu','Veri Durumu','Tarama Durumu','Kaynak','İlan No','İlan Başlığı','Başlık','Fiyat','Fiyat (TL)','Fiyat (ham)','Para Birimi','Metrekare','Metrekare (m²)','İl','İlçe','Mahalle','Konum','Ad Soyad','Ad Soyad / Satıcı','Telefon','Telefon (90)','İlan Açıklaması','Açıklama','URL','İlan URL','İlan Linki','Diğer Özellikler','Eksik Alanlar','Kontrol Notları','Kategori Dayanağı','Tarama Zamanı','Son Kayıt',"Fotoğraf URL'leri",'Kategori Yolu','Yayın Durumu','Son Bağlantı Kontrolü','Son Yayında Görülme','Yayından Kalkma Doğrulaması','Telegram Bildirimi'].map(norm));
    for(const [k,v] of Object.entries(raw)) {
      if(['__proto__','constructor','prototype'].includes(k)||v===null||v===undefined||typeof v==='object'||!clean(v))continue;
      if(/^Özellik:\s*/i.test(k))details[k.replace(/^Özellik:\s*/i,'')]=clean(v);
      else if(propertyNames.some(n=>norm(n)===norm(k))||(spreadsheet&&!mappedColumns.has(norm(k))))details[k]=clean(v);
    }
    const url=canonicalUrl(get(raw,'url','URL','İlan URL','İlan Linki'));
    let source=sourceFor(url);if(source==='import'&&['hepsiemlak','sahibinden'].includes(raw.source)&&!url)source=raw.source;
    const suppliedId=clean(get(raw,'listingId','listing_id','İlan No')||detailGet(details,'İlan No','İlan Numarası'));
    const pathId=listingIdFromUrl(url),listingId=suppliedId||pathId;
    const title=clean(get(raw,'title','İlan Başlığı','Başlık'));
    const originalPrice=clean(get(raw,'originalPrice','Fiyat (ham)','price','Fiyat (TL)','Fiyat'));
    const price=parseNumber(get(raw,'price','Fiyat (TL)','Fiyat','originalPrice'));
    let currency=clean(get(raw,'currency','Para Birimi')).toUpperCase();
    if(!currency)currency=/€|EUR/.test(originalPrice)?'EUR':/\$|USD/.test(originalPrice)?'USD':/£|GBP/.test(originalPrice)?'GBP':'TRY';
    if(currency==='TL'||currency==='₺')currency='TRY';
    const oldLoc=get(raw,'location','Konum');const loc=plain(oldLoc);const parts=typeof oldLoc==='string'?oldLoc.split('/').map(clean):[];
    const location={city:clean(loc.city||get(raw,'city','İl')||parts[0]),district:clean(loc.district||get(raw,'district','İlçe')||parts[1]),neighborhood:clean(loc.neighborhood||get(raw,'neighborhood','Mahalle')||parts[2])};
    const phones=phonesFrom(get(raw,'phones','Telefon (90)','Telefon','phone')||wrapper.phones);
    const sellerName=clean(get(raw,'sellerName','seller','Ad Soyad / Satıcı','Ad Soyad'));
    const area=parseNumber(get(raw,'area','Metrekare (m²)','Metrekare','area_gross')||detailGet(details,'Metrekare','m²','m² (Brüt)','Brüt m²'));
    const importedWarnings=String(get(raw,'Kontrol Notları')||'').split(/\s*[;|]\s*/).filter(Boolean);
    const warnings=unique([...(Array.isArray(raw.warnings)?raw.warnings:[]),...(Array.isArray(raw.quality?.warnings)?raw.quality.warnings:[]),...importedWarnings]).map(clean);
    let classification=classify(raw,details,url);
    if(suppliedId&&pathId&&suppliedId!==pathId){warnings.push('İlan numarası ile kaynak URL uyuşmuyor.');classification={...classification,status:'conflict'};}
    if(classification.category==='arsa'&&/\b(?:site dairesi|satilik daire|kiralik daire)\b/.test(norm(title))&&!raw.manualCategory){warnings.push('Başlık ile arsa kategorisi tutarsız; kaynağı kontrol edin.');classification={...classification,status:'conflict'};}
    if(classification.status==='unknown')warnings.push('Kategori için doğrulanabilir URL veya özellik bulunamadı.');
    if(classification.status==='conflict')warnings.push('Kategori kanıtları uyuşmuyor; otomatik kategoriye dahil edilmedi.');
    if(raw.quality?.warnings?.some(w=>w.includes('Kategori kanıtları'))&&classification.status==='manual')warnings.splice(0,warnings.length,...warnings.filter(w=>!w.includes('Kategori kanıtları')&&!w.includes('Kategori için doğrulanabilir')&&!w.includes('Başlık ile arsa')));
    const missing=unique([...(Array.isArray(raw.missing)?raw.missing:[]),...(Array.isArray(raw.quality?.missing)?raw.quality.missing:[]),...String(get(raw,'Eksik Alanlar')||'').split(/\s*[,|]\s*/)].map(clean)).filter(label=>!sellerName||norm(label)!==norm('Ad Soyad / Satıcı'));if(!title)missing.push('Başlık');if(!listingId)missing.push('İlan numarası');if(price===null)missing.push('Fiyat');if(!url)missing.push('Kaynak URL');if(!phones.length)missing.push('Telefon');if(!sellerName)missing.push('Ad Soyad / Satıcı');if(!location.city)missing.push('İl');
    if(classification.category==='arsa'){if(!area)missing.push('Metrekare');if(!detailGet(details,'Tapu Durumu'))missing.push('Tapu durumu');if(!detailGet(details,'Ada/Parsel No','Ada / Parsel','Ada No')&&!detailGet(details,'Parsel No'))missing.push('Ada / parsel');}
    const review=['unknown','conflict'].includes(classification.status),now=new Date().toISOString();
    const category=classification.category;
    return {schemaVersion:2,id:source+':'+(listingId||(url?'url-'+hash(url):'import-'+hash([title,originalPrice,JSON.stringify(location),phones.join(',')].join('|')))),
      source,url,listingId,title,price,currency,originalPrice,area,location,phones,
      sellerName,description:String(get(raw,'description','İlan Açıklaması','Açıklama')||''),phoneStatus:clean(get(raw,'phoneStatus','Telefon Durumu')),
      rawDetails:details,features:(Array.isArray(raw.features)?raw.features:[get(raw,'Diğer Özellikler')]).filter(Boolean).map(String),
      images:unique((Array.isArray(raw.images)?raw.images:String(get(raw,"Fotoğraf URL'leri")||'').split('\n')).map(safeUrl)),
      category,classification,quality:{status:review?'review':missing.length?'missing':'complete',missing:unique(missing),warnings:unique(warnings)},
      archiveStatus:review?'review':'active',capturedAt:clean(get(raw,'capturedAt','collected_at','Tarama Zamanı'))||now,
      updatedAt:clean(raw.updatedAt)||now,firstSeenAt:clean(raw.firstSeenAt)||now,deletedAt:raw.deletedAt||null,
      manualCategory:raw.manualCategory||null,manualCategorizedAt:raw.manualCategorizedAt||null,
      categoryPath:(Array.isArray(raw.categoryPath)?raw.categoryPath:String(get(raw,'Kategori Yolu')||'').split(' > ')).map(clean).filter(Boolean),monitoring:normalizeMonitoring(raw.monitoring),market:normalizeMarket(raw.market),
      history:(Array.isArray(raw.history)?raw.history:[]).slice(-10).filter(h=>h&&typeof h==='object').map(h=>({at:clean(h.at),price:parseNumber(h.price),currency:clean(h.currency),category:categoryValue(h.category),phones:phonesFrom(h.phones)})),
      sourceSearchUrl:safeUrl(options.sourceSearchUrl||raw.sourceSearchUrl||raw.search_url),collectionCategory:options.targetCategory||raw.collectionCategory||null,
      lists:unique((Array.isArray(raw.lists)?raw.lists:[]).map(id=>clean(id).slice(0,100)))};
  }
  function filterRecords(records, filters={}) {
    const cat=filters.category||'all',q=norm(filters.query),min=parseNumber(filters.minPrice),max=parseNumber(filters.maxPrice);
    return records.filter(r=>{
      if(cat==='trash'){if(!r.deletedAt)return false;}else if(r.deletedAt)return false;
      if(cat==='review'&&r.archiveStatus!=='review')return false;
      if(Object.hasOwn(CATEGORIES,cat)&&(r.category!==cat||r.archiveStatus==='review'))return false;
      if(filters.list&&filters.list!=='all'&&!(Array.isArray(r.lists)&&r.lists.includes(filters.list)))return false;
      if(filters.source&&filters.source!=='all'&&r.source!==filters.source)return false;
      if(filters.currency&&filters.currency!=='all'&&r.currency!==filters.currency)return false;
      if(filters.city&&filters.city!=='all'&&norm(r.location?.city)!==norm(filters.city))return false;
      if(filters.quality&&filters.quality!=='all'&&r.quality?.status!==filters.quality)return false;
      if(filters.availability&&filters.availability!=='all'){const s=r.monitoring?.status||'unknown';if(filters.availability==='unknown'){if(!['unknown','blocked','error'].includes(s))return false;}else if(s!==filters.availability)return false;}
      if(min!==null&&(r.price===null||r.price<min))return false;if(max!==null&&(r.price===null||r.price>max))return false;
      if(q&&!norm([r.title,r.listingId,r.sellerName,r.phones?.join(' '),r.categoryPath?.join(' '),Object.values(r.location||{}).join(' '),Object.values(r.rawDetails||{}).join(' ')].join(' ')).includes(q))return false;
      return true;
    });
  }
  function formatMoney(price,currency='TRY'){if(price===null||price===undefined||price==='')return 'Belirtilmemiş';try{return new Intl.NumberFormat('tr-TR',{style:'currency',currency,maximumFractionDigits:0}).format(price);}catch{return new Intl.NumberFormat('tr-TR').format(price)+' '+currency;}}
  root.IlanCore=Object.freeze({CATEGORIES,clean,norm,safeUrl,canonicalUrl,sourceFor,listingIdFromUrl,parseNumber,normalizePhone,phonesFrom,detailGet,categoryValue,urlEvidence,normalizeMonitoring,normalizeMarket,normalizeMarketEvent,normalizeRecord,filterRecords,formatMoney});
  if(typeof module!=='undefined'&&module.exports)module.exports=root.IlanCore;
})(globalThis);
