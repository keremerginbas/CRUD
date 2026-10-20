/* Local-only import/export. No file content is uploaded. SheetJS is vendored. */
(function(root){
  'use strict';
  const LIMIT=50000;
  const C=()=>root.IlanCore;
  const filename=(suffix)=>'ilan5_'+new Date().toISOString().replace(/[T:]/g,'_').slice(0,19)+suffix;
  function download(value,type,name){const blob=value instanceof Blob?value:new Blob([value],{type});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);return name;}
  function requireData(records){if(!Array.isArray(records)||!records.length)throw Error('Seçili filtrelerde dışa aktarılacak kayıt yok.');}
  function jsonRows(data){
    if(Array.isArray(data))return data;
    if(!data||typeof data!=='object')throw Error('JSON içinde ilan kayıtları bulunamadı.');
    if(Array.isArray(data.records))return data.records;
    if(data.rows&&typeof data.rows==='object'&&!Array.isArray(data.rows))return Object.values(data.rows);
    if(data.url||data.title||data.listing_id||data['URL']||data['İlan Başlığı']||data.record)return [data];
    throw Error('Desteklenen dosyalar: İlan5 yedeği, bot .durum.json dosyası veya ilan kayıtları listesi.');
  }
  function normalizeImported(rows){
    if(rows.length>LIMIT)throw Error('Bir seferde en fazla 50.000 kayıt içe aktarılabilir.');
    const records=new Map();let invalid=0,duplicates=0;
    for(const row of rows){if(!row||typeof row!=='object'||Array.isArray(row)){invalid++;continue;}
      const record=C().normalizeRecord(row);if(!record.title&&!record.url&&!record.listingId){invalid++;continue;}
      if(records.has(record.id))duplicates++;
      records.set(record.id,record);
    }
    const out=[...records.values()];
    if(!out.length&&rows.length)throw Error('İlan sütunları bulunamadı. İlan Başlığı, URL veya İlan No içeren dosyayı seçin.');
    out.importSummary={total:rows.length,valid:out.length,invalid,duplicates,review:out.filter(r=>r.archiveStatus==='review').length};return out;
  }
  async function importFile(file){
    if(!file||file.size>50*1024*1024)throw Error('İçe aktarılacak dosya en fazla 50 MB olabilir.');
    const ext=file.name.toLowerCase().split('.').at(-1);
    if(ext==='json'){let data;try{data=JSON.parse(await file.text());}catch{throw Error('JSON dosyası okunamadı; geçerli bir yedek seçin.');}const records=normalizeImported(jsonRows(data));if(data.events!==undefined){if(!Array.isArray(data.events))throw Error('Yedekteki hareket geçmişi bir liste olmalı.');const events=data.events.map(e=>C().normalizeMarketEvent(e));if(events.some(e=>!e))throw Error('Yedekte geçersiz ilan hareketi var.');records.marketEvents=events;}if(Array.isArray(data.lists))records.listMeta=data.lists;if(data.settings&&typeof data.settings==='object')records.settingsMeta=data.settings;return records;}
    if(!['xlsx','csv'].includes(ext))throw Error('JSON, XLSX veya CSV dosyası seçin.');
    if(!root.XLSX)throw Error('Excel bileşeni yüklenemedi. Eklenti dosyalarının tamamını aynı klasörde tutun.');
    const bytes=new Uint8Array(await file.arrayBuffer());
    const wb=root.XLSX.read(bytes,{type:'array',cellFormula:false,cellDates:false,sheetRows:LIMIT+2,raw:true});
    const name=wb.SheetNames.find(n=>C().norm(n)==='ilanlar')||wb.SheetNames[0];
    if(!name)throw Error('Çalışma sayfası bulunamadı.');
    const rows=root.XLSX.utils.sheet_to_json(wb.Sheets[name],{defval:'',raw:true});
    return normalizeImported(rows);
  }
  const fields=[
    ['Kategori',r=>C().CATEGORIES[r.category]||'Belirsiz'],['Arşiv Durumu',r=>r.archiveStatus==='review'?'İnceleme gerekli':'Arşiv'],
    ['Veri Durumu',r=>r.quality?.status==='complete'?'Temel alanlar alındı':r.quality?.status==='review'?'İnceleme gerekli':'Eksik alan var'],
    ['Kaynak',r=>r.source],['İlan No',r=>r.listingId],['İlan Başlığı',r=>r.title],['Fiyat',r=>r.price],['Para Birimi',r=>r.currency],
    ['Metrekare',r=>r.area],['İl',r=>r.location?.city],['İlçe',r=>r.location?.district],['Mahalle',r=>r.location?.neighborhood],
    ['Ad Soyad',r=>r.sellerName],['Telefon (90)',r=>r.phones.join(' | ')],['İlan Açıklaması',r=>r.description],['URL',r=>r.url],
    ['Diğer Özellikler',r=>r.features.join('\n')],['Eksik Alanlar',r=>r.quality?.missing?.join(' | ')],['Kontrol Notları',r=>r.quality?.warnings?.join(' | ')],
    ['Kategori Dayanağı',r=>r.classification?.evidence?.map(e=>`${e.source}: ${e.text}`).join('\n')],
    ['Tarama Zamanı',r=>r.capturedAt],['Son Kayıt',r=>r.updatedAt],['Fotoğraf URL\'leri',r=>r.images.join('\n')],
    ['Kategori Yolu',r=>(r.categoryPath||[]).join(' > ')],
    ['Listeler',r=>(r.listNames||r.lists||[]).join(' | ')],['m² Fiyatı',r=>{const v=C().pricePerArea(r);return v===null?'':Math.round(v);}],['Takip Durumu',r=>C().CRM_STATUSES[r.crm?.status]||''],['Not',r=>r.crm?.note||''],['Mesaj Gönderildi',r=>r.messagedAt||''],['Yayın Durumu',r=>({active:'Yayında',suspected:'Yayından kalkma şüphesi',removed:'Yayından kaldırıldı',unknown:'Doğrulanmadı',blocked:'Erişim kontrolü',error:'Kontrol hatası'})[r.monitoring?.status]||'Kontrol edilmedi'],
    ['Son Bağlantı Kontrolü',r=>r.monitoring?.lastCheckedAt],['Son Yayında Görülme',r=>r.monitoring?.lastActiveAt],['Yayından Kalkma Doğrulaması',r=>r.monitoring?.removedAt],['Telegram Bildirimi',r=>r.monitoring?.notificationStatus]
  ];
  function exportRows(records){const extra=[...new Set(records.flatMap(r=>Object.keys(r.rawDetails||{})))].sort((a,b)=>a.localeCompare(b,'tr'));
    return [fields.map(f=>f[0]).concat(extra.map(k=>'Özellik: '+k)),...records.map(r=>fields.map(([,f])=>f(r)??'').concat(extra.map(k=>r.rawDetails?.[k]??'')))];}
  function workbookFor(records){requireData(records);const XLSX=root.XLSX;if(!XLSX)throw Error('Excel bileşeni bulunamadı.');
    const wb=XLSX.utils.book_new(),rows=exportRows(records);
    const clipped=rows.map(row=>row.map(v=>typeof v==='string'&&v.length>32767?v.slice(0,32650)+'\n[Uzun metnin tamamı JSON yedeğindedir.]':v));
    const ws=XLSX.utils.aoa_to_sheet(clipped);ws['!autofilter']={ref:ws['!ref']};ws['!cols']=rows[0].map(h=>({wch:/Açıklaması|Başlığı|Notları|URL|Dayanağı/.test(h)?45:22}));
    // Explicit text cells: scraped strings must never become Excel formulas.
    for(const [addr,cell] of Object.entries(ws))if(!addr.startsWith('!')&&typeof cell.v==='string'){cell.t='s';delete cell.f;}
    XLSX.utils.book_append_sheet(wb,ws,'İlanlar');
    const summary=XLSX.utils.aoa_to_sheet([['Alan','Değer'],['Aktarılan kayıt',records.length],['İnceleme gerekli',records.filter(r=>r.archiveStatus==='review').length],['Eksik alanlı',records.filter(r=>r.quality?.status==='missing').length],['Kapsam','Ekranda uygulanan filtrelere göre aktarıldı.'],['Açıklama','Boş alanlar doldurulmaz. Kayıtlar ilan sahibinin beyanıdır; tapu doğrulaması değildir.']]);
    XLSX.utils.book_append_sheet(wb,summary,'Aktarım Özeti');return wb;
  }
  function exportXlsx(records){const wb=workbookFor(records);const bytes=root.XLSX.write(wb,{bookType:'xlsx',type:'array',compression:true});return download(bytes,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',filename('.xlsx'));}
  function csvText(records){requireData(records);const safe=value=>{let s=String(value??'');if(typeof value==='string'&&/^[\s]*[=+@-]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};return '\uFEFF'+exportRows(records).map(row=>row.map(safe).join(';')).join('\r\n');}
  function exportCsv(records){return download(csvText(records),'text/csv;charset=utf-8',filename('.csv'));}
  function exportBackup(records,options={}){const events=(options.events||[]).map(e=>C().normalizeMarketEvent(e)).filter(Boolean);return download(JSON.stringify({type:'ilan5-backup',schemaVersion:2,exportedAt:new Date().toISOString(),records:records.map(r=>C().normalizeRecord(r)),events,lists:Array.isArray(options.lists)?options.lists:[],...(options.settings?{settings:options.settings}:{})},null,2),'application/json;charset=utf-8',filename('_yedek.json'));}
  root.IlanTransfer={importFile,exportXlsx,exportCsv,exportBackup,jsonRows,normalizeImported,exportRows,workbookFor,csvText};
  if(typeof module!=='undefined'&&module.exports)module.exports=root.IlanTransfer;
})(globalThis);
