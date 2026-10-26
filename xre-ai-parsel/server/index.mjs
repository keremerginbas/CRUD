import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import {pool,requireDb,databaseMode} from './db.mjs';
import {tkgmQuery} from './tkgm-bridge.mjs';
import {containsPoint} from './geo.mjs';
import {marketAnalysis, normalizeListing, placeKey} from './market.mjs';
import {officialSources} from './sources.mjs';
import {densitySummary, normalizeDensityRows} from './density.mjs';
const app=express();
// Local development is allowed without auth; remote exposure is blocked until a real login system exists.
const host=process.env.HOST||'127.0.0.1';
if(!['127.0.0.1','localhost','::1'].includes(host)&&process.env.ALLOW_UNAUTHENTICATED_REMOTE!=='I_UNDERSTAND_THE_RISK'){
 console.error('Refusing remote bind: authentication is not implemented.');process.exit(1);
}
app.disable('x-powered-by');app.use(cors({origin:process.env.CORS_ORIGIN||false}));// Emsal ice aktarma parcali buyuk govde alir; diger tum istekler 100 KB ile sinirli.
const smallJson=express.json({limit:'100kb'}),importJson=express.json({limit:'8mb'});
const LARGE_BODY=new Set(['/api/comparables/import','/api/density/import']);
app.use((req,res,next)=>(LARGE_BODY.has(req.path)?importJson:smallJson)(req,res,next));
app.get('/api/health',(_req,res)=>res.json({ok:true,parcelMode:process.env.TKGM_PARCEL_MODE||'public',parcelProviderConfigured:true,parcelProviderReachable:'test edilmedi',authorizedTokenConfigured:Boolean(process.env.TKGM_TOKEN),coordinateQueryEnabled:process.env.TKGM_COORDINATE_ENABLED==='true',pythonBridge:true,aiConfigured:Boolean(process.env.OPENAI_API_KEY),aiWebSearch:process.env.AI_WEB_SEARCH!=='false',database:databaseMode}));

const PARCEL_COLUMNS='id,province,district,neighborhood,block_no,parcel_no,geometry,area_m2,qualification,sheet,source_name,source_checked_at';
function parcelRow(row){
 let geometry=row.geometry;
 if(typeof geometry==='string'){try{geometry=JSON.parse(geometry)}catch{geometry=null}}
 return {id:row.id,province:row.province,district:row.district,neighborhood:row.neighborhood,block:row.block_no,parcel:row.parcel_no,
  areaM2:row.area_m2==null?null:Number(row.area_m2),qualification:row.qualification||null,sheet:row.sheet||null,geometry,
  source:row.source_name,checkedAt:row.source_checked_at};
}
const validLatLng=(lat,lng)=>Number.isFinite(lat)&&Number.isFinite(lng)&&lat>=35&&lat<=43&&lng>=25&&lng<=46;
// Daha once sorgulanip yerel arsive kaydedilmis parseller icinde noktayi iceren parsel (ag istegi yok).
async function findContainingParcel(lat,lng){
 const [rows]=await pool.query(`SELECT ${PARCEL_COLUMNS} FROM parcels WHERE geometry IS NOT NULL ORDER BY id DESC LIMIT 5000`);
 for(const row of rows){const p=parcelRow(row);if(p.geometry&&containsPoint(p.geometry,lat,lng))return p}
 return null;
}
app.get('/api/parcels/containing',async(req,res)=>{
 const lat=Number(req.query.lat),lng=Number(req.query.lng);
 if(!validLatLng(lat,lng))return res.status(400).json({error:'Geçerli Türkiye koordinatı gerekli.'});
 try{const p=await findContainingParcel(lat,lng);res.status(p?200:404).json(p?{parcel:p}:{error:'Bu nokta yerel arşivdeki hiçbir parselin içinde değil.'})}
 catch(e){console.error('[PARCEL CONTAINING]',e.message);res.status(500).json({error:'Parsel arşivi okunamadı.'})}
});
app.get('/api/parcels/:id',async(req,res)=>{if(!await requireDb(res))return;const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<1)return res.status(400).json({error:'Geçersiz parsel kimliği.'});try{const [rows]=await pool.execute(`SELECT ${PARCEL_COLUMNS} FROM parcels WHERE id=?`,[id]);res.status(rows.length?200:404).json(rows.length?{parcel:parcelRow(rows[0])}:{error:'Parsel bulunamadı.'})}catch{res.status(500).json({error:'Parsel okunamadı.'})}});
app.get('/api/markers',async(req,res)=>{if(!await requireDb(res))return;try{const [rows]=await pool.query('SELECT id,lat,lng,note,color,is_favorite AS favorite,parcel_id AS parcelId FROM map_markers WHERE user_id=? ORDER BY id DESC LIMIT 3000',['local']);res.json({markers:rows.map(row=>({...row,favorite:Boolean(row.favorite)}))})}catch{res.status(500).json({error:'Veritabanı sorgusu başarısız.'})}});
app.post('/api/markers',async(req,res)=>{
 if(!await requireDb(res))return;
 const {lat,lng,note='',favorite=false}=req.body||{};
 if(!validLatLng(lat,lng)||typeof note!=='string'||note.length>3000)return res.status(400).json({error:'Geçersiz konum veya not.'});
 try{
  // Nokta arşivdeki bir parselin içindeyse kayda bağla; kayıt seçildiğinde parsel sınırı çizilebilsin.
  let parcelId=Number.isSafeInteger(req.body.parcelId)&&req.body.parcelId>0?req.body.parcelId:null;
  if(parcelId){const [rows]=await pool.execute('SELECT id FROM parcels WHERE id=?',[parcelId]);if(!rows.length)parcelId=null}
  if(!parcelId)parcelId=(await findContainingParcel(lat,lng))?.id??null;
  const [r]=await pool.execute('INSERT INTO map_markers(user_id,lat,lng,note,is_favorite,parcel_id) VALUES(?,?,?,?,?,?)',['local',lat,lng,note,Boolean(favorite),parcelId]);
  res.status(201).json({id:r.insertId,parcelId});
 }catch(error){console.error('[MARKER INSERT ERROR]',error);res.status(500).json({error:'Kayıt başarısız.'})}
});
app.patch('/api/markers/:id',async(req,res)=>{if(!await requireDb(res))return;const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<1||typeof req.body?.favorite!=='boolean')return res.status(400).json({error:'Geçersiz istek.'});try{const [r]=await pool.execute('UPDATE map_markers SET is_favorite=? WHERE id=? AND user_id=?',[req.body.favorite,id,'local']);res.status(r.affectedRows?200:404).json({ok:Boolean(r.affectedRows)})}catch(error){console.error('[MARKER UPDATE ERROR]',error);res.status(500).json({error:'Güncelleme başarısız.'})}});
app.delete('/api/markers/:id',async(req,res)=>{if(!await requireDb(res))return;const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<1)return res.status(400).json({error:'Geçersiz id.'});try{const [result]=await pool.execute('DELETE FROM map_markers WHERE id=? AND user_id=?',[id,'local']);res.status(result.affectedRows?200:404).json(result.affectedRows?{ok:true}:{error:'Kayıt bulunamadı.'})}catch{res.status(500).json({error:'Silme başarısız.'})}});
app.get('/api/jobs/:id',async(req,res)=>{if(!await requireDb(res))return;const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<1)return res.status(400).json({error:'Geçersiz görev kimliği.'});try{const [rows]=await pool.execute('SELECT id,status,error_message,updated_at FROM query_jobs WHERE id=?',[id]);res.status(rows.length?200:404).json(rows[0]||{error:'Görev bulunamadı.'})}catch{res.status(500).json({error:'Görev okunamadı.'})}});

// Lists are read from the upstream TKGM client, never pre-populated with guessed IDs.
function sendProviderResult(res,result){
 if(result.ok)return res.json(result);
 const statuses={BAD_REQUEST:400,AUTH_REQUIRED:403,ACCESS_RESTRICTED:403,NOT_FOUND:404,RATE_LIMIT:429,DISABLED:403,BUSY:429};
 return res.status(statuses[result.code]||502).json(result);
}
// TKGM idari listeleri sinir poligonlariyla gelir. Acilir listeye yalnizca id/ad gider;
// poligon ayni onbellekten /api/regions/boundary ile tek kayit olarak istenir.
const REGION_LEVELS={
 province:{payload:()=>({action:'provinces'}),cacheMs:24*60*60*1000},
 district:{payload:parentId=>({action:'districts',provinceId:parentId}),cacheMs:12*60*60*1000},
 neighborhood:{payload:parentId=>({action:'neighborhoods',districtId:parentId}),cacheMs:12*60*60*1000}
};
async function regionList(level,parentId){
 const def=REGION_LEVELS[level];
 return tkgmQuery(def.payload(parentId),{cacheMs:def.cacheMs});
}
function sendRegionItems(res,result){
 if(!result.ok)return sendProviderResult(res,result);
 res.json({ok:true,items:(result.items||[]).map(({id,name,geometry})=>({id,name,hasBoundary:Boolean(geometry)}))});
}
const validId=v=>/^\d{1,9}$/.test(v);
app.get('/api/regions/provinces',async(_req,res)=>sendRegionItems(res,await regionList('province')));
app.get('/api/regions/districts/:provinceId',async(req,res)=>{
 if(!validId(req.params.provinceId))return res.status(400).json({error:'Geçersiz il kimliği.'});
 sendRegionItems(res,await regionList('district',Number(req.params.provinceId)));
});
app.get('/api/regions/neighborhoods/:districtId',async(req,res)=>{
 if(!validId(req.params.districtId))return res.status(400).json({error:'Geçersiz ilçe kimliği.'});
 sendRegionItems(res,await regionList('neighborhood',Number(req.params.districtId)));
});
// level=province icin parentId 0 gonderilir.
app.get('/api/regions/boundary/:level/:parentId/:id',async(req,res)=>{
 const {level,parentId,id}=req.params;
 if(!REGION_LEVELS[level]||!validId(parentId)||!validId(id))return res.status(400).json({error:'Geçersiz bölge isteği.'});
 const result=await regionList(level,Number(parentId));
 if(!result.ok)return sendProviderResult(res,result);
 const item=(result.items||[]).find(x=>String(x.id)===id);
 if(!item)return res.status(404).json({error:'Bölge bulunamadı.'});
 if(!item.geometry)return res.status(404).json({error:'TKGM bu bölge için sınır geometrisi döndürmedi.'});
 res.json({ok:true,feature:{type:'Feature',properties:{id:item.id,name:item.name,level},geometry:item.geometry}});
});

async function storeVerifiedParcel(payload,record){
 const p=record.parcel;
 const province=p.province||payload.province||'',district=p.district||payload.district||'';
 const neighborhood=p.neighborhood||payload.neighborhood||'';
 const block=String(p.block||payload.block||''),number=String(p.parcel||payload.parcel||'');
 // Save ONLY successful, geometry-backed upstream responses.
 if(!province||!district||!neighborhood||!block||!number||!p.geometry) return null;
 const values=[province,district,neighborhood,block,number,JSON.stringify(p.geometry),p.areaM2,p.qualification||null,p.sheet||null,record.source,new Date(record.checkedAt).toISOString().slice(0,19).replace('T',' ')];
 if(databaseMode==='sqlite'){
  await pool.execute(`INSERT INTO parcels(province,district,neighborhood,block_no,parcel_no,geometry,area_m2,qualification,sheet,source_name,source_checked_at)
   VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(province,district,neighborhood,block_no,parcel_no) DO UPDATE SET
   geometry=excluded.geometry,area_m2=excluded.area_m2,qualification=excluded.qualification,sheet=excluded.sheet,source_name=excluded.source_name,source_checked_at=excluded.source_checked_at`,values);
 }else{
  await pool.execute(`INSERT INTO parcels(province,district,neighborhood,block_no,parcel_no,geometry,area_m2,qualification,sheet,source_name,source_checked_at)
   VALUES(?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE geometry=VALUES(geometry),area_m2=VALUES(area_m2),qualification=VALUES(qualification),sheet=VALUES(sheet),source_name=VALUES(source_name),source_checked_at=VALUES(source_checked_at)`,values);
 }
 const [rows]=await pool.execute('SELECT id FROM parcels WHERE province=? AND district=? AND neighborhood=? AND block_no=? AND parcel_no=?',[province,district,neighborhood,block,number]);
 return rows[0]?.id||null;
}

app.post('/api/parcels/search',async(req,res)=>{
 const {province,district,neighborhood,neighborhoodId,block,parcel}=req.body||{};
 const v=String(block||''),n=String(parcel||'');
 const idOk=Number.isSafeInteger(neighborhoodId)&&neighborhoodId>0;
 const namesOk=[province,district,neighborhood].every(s=>typeof s==='string'&&s.trim()&&s.length<=150);
 if(!/^\d{1,10}$/.test(v)||!/^\d{1,10}$/.test(n)||(!idOk&&!namesOk))
  return res.status(400).json({error:'İl, ilçe, mahalle, ada ve parsel bilgilerini kontrol edin.'});
 const result=await tkgmQuery({action:'parcel',province,district,neighborhood,neighborhoodId:idOk?neighborhoodId:null,block:v,parcel:n});
 if(!result.ok)return sendProviderResult(res,result);
 try{result.localParcelId=await storeVerifiedParcel(req.body,result)}
 catch(e){console.error('[PARCEL STORE]',e.message);result.warning='Parsel verisi alındı ancak yerel arşive kaydedilemedi.'}
 return res.json(result);
});

app.post('/api/parcels/coordinate',async(req,res)=>{
 const {lat,lng}=req.body||{};
 if(typeof lat!=='number'||typeof lng!=='number'||lat<35||lat>43||lng<25||lng>46)
  return res.status(400).json({error:'Geçerli Türkiye koordinatı gerekli.'});
 if(process.env.TKGM_COORDINATE_ENABLED!=='true')
  return res.status(403).json({error:'Koordinat sorgusu .env içinde etkinleştirilmemiş.'});
 const result=await tkgmQuery({action:'coordinate',lat,lng});
 if(!result.ok)return sendProviderResult(res,result);
 try{result.localParcelId=await storeVerifiedParcel({},result)}
 catch(e){console.error('[PARCEL STORE]',e.message);result.warning='Parsel verisi alındı ancak yerel arşive kaydedilemedi.'}
 return res.json(result);
});

// --- Emsal ilanlar (İlan5 eklentisi JSON/CSV dışa aktarımı) ---
const COMPARABLE_COLUMNS=['source','listing_id','title','price','currency','area','city','district','neighborhood','city_key','district_key','neighborhood_key','category','url','imar','kaks','tapu','ada_parsel','listing_status','captured_at'];
app.post('/api/comparables/import',async(req,res)=>{
 const records=req.body?.records;
 if(!Array.isArray(records)||!records.length||records.length>2000)return res.status(400).json({error:'Bir istekte 1–2000 kayıt gönderin.'});
 const listings=records.map(normalizeListing).filter(Boolean);
 const placeholders=COMPARABLE_COLUMNS.map(()=>'?').join(',');
 const update=COMPARABLE_COLUMNS.slice(2).map(c=>databaseMode==='sqlite'?`${c}=excluded.${c}`:`${c}=VALUES(${c})`).join(',');
 const sql=`INSERT INTO comparables(${COMPARABLE_COLUMNS.join(',')}) VALUES(${placeholders}) `+
  (databaseMode==='sqlite'?`ON CONFLICT(source,listing_id) DO UPDATE SET ${update}`:`ON DUPLICATE KEY UPDATE ${update}`);
 try{
  for(const l of listings)await pool.execute(sql,[l.source,l.listingId,l.title,l.price,l.currency,l.area,l.city,l.district,l.neighborhood,l.cityKey,l.districtKey,l.neighborhoodKey,l.category,l.url,l.imar,l.kaks,l.tapu,l.adaParsel,l.listingStatus,l.capturedAt]);
  res.json({ok:true,received:records.length,saved:listings.length,skipped:records.length-listings.length});
 }catch(e){console.error('[COMPARABLES IMPORT]',e.message);res.status(500).json({error:'Emsal kayıtları kaydedilemedi.'})}
});
app.get('/api/comparables/summary',async(_req,res)=>{
 try{
  const [[totals]]=await pool.query("SELECT COUNT(*) AS total,SUM(CASE WHEN category='arsa' AND listing_status<>'removed' AND price>0 AND area>0 THEN 1 ELSE 0 END) AS usable FROM comparables");
  const [districts]=await pool.query("SELECT city,district,COUNT(*) AS n FROM comparables WHERE category='arsa' AND listing_status<>'removed' GROUP BY city_key,district_key ORDER BY n DESC LIMIT 15");
  res.json({total:Number(totals?.total||0),usable:Number(totals?.usable||0),districts});
 }catch(e){console.error('[COMPARABLES SUMMARY]',e.message);res.status(500).json({error:'Emsal özeti okunamadı.'})}
});
app.delete('/api/comparables',async(_req,res)=>{
 try{await pool.execute('DELETE FROM comparables');res.json({ok:true})}catch{res.status(500).json({error:'Silinemedi.'})}
});

app.get('/api/sources',(req,res)=>{
 const q=k=>String(req.query[k]||'').slice(0,150);
 res.json({sources:officialSources({province:q('province'),district:q('district'),neighborhood:q('neighborhood'),block:q('block').replace(/\D/g,''),parcel:q('parcel').replace(/\D/g,'')})});
});

// --- TKGM alım satım yoğunluğu (Parsel Sorgu > Analiz yanıtı içe aktarılır) ---
const validYear=y=>Number.isInteger(y)&&y>=2000&&y<=2100;
async function saveDensity(year,province,district,rows){
 const data=normalizeDensityRows(rows);
 const pk=placeKey(province),dk=placeKey(district);
 // Aynı yıl/ilçe yeniden yüklenirse önceki veri tamamen değiştirilir (karışık veri olmasın).
 await pool.execute('DELETE FROM density_points WHERE year=? AND province_key=? AND district_key=?',[year,pk,dk]);
 for(const p of data.points)await pool.execute('INSERT INTO density_points(year,province,district,province_key,district_key,parcel_ref,lat,lng,count) VALUES(?,?,?,?,?,?,?,?,?)',[year,province.trim(),district.trim(),pk,dk,p.parcelRef,p.lat,p.lng,p.count]);
 return {ok:true,year,province,district,rows:data.rows,parcels:data.points.length,transactions:data.transactions,invalid:data.invalid};
}
const validNames=(province,district)=>[province,district].every(v=>typeof v==='string'&&v.trim()&&v.length<=150);
app.post('/api/density/import',async(req,res)=>{
 const {year,province,district,rows}=req.body||{};
 if(!validYear(year)||!validNames(province,district))return res.status(400).json({error:'Yıl, il ve ilçe seçili olmalı.'});
 try{res.json(await saveDensity(year,province,district,rows))}
 catch(e){const bad=/JSON|satır/.test(e.message);if(!bad)console.error('[DENSITY IMPORT]',e.message);res.status(bad?400:500).json({error:bad?e.message:'Yoğunluk verisi kaydedilemedi.'})}
});
// TKGM Parsel Sorgu > Analiz > Alım Satım Yoğunluğu'nu doğrudan çeker (AnalizTip=1).
app.post('/api/density/fetch',async(req,res)=>{
 const {year,districtId,province,district}=req.body||{};
 if(!validYear(year)||!Number.isSafeInteger(districtId)||districtId<1||!validNames(province,district))
  return res.status(400).json({error:'Yıl, il ve ilçe seçili olmalı.'});
 const result=await tkgmQuery({action:'analysis',analysisType:1,year,districtId},{cacheMs:12*60*60*1000});
 if(!result.ok)return sendProviderResult(res,result);
 try{res.json({...await saveDensity(year,province,district,result.rows),source:result.source,checkedAt:result.checkedAt})}
 catch(e){const bad=/JSON|satır/.test(e.message);if(!bad)console.error('[DENSITY FETCH]',e.message);res.status(bad?404:500).json({error:bad?'TKGM bu ilçe/yıl için işlem noktası döndürmedi.':'Yoğunluk verisi kaydedilemedi.'})}
});
app.get('/api/density/datasets',async(_req,res)=>{
 try{const [rows]=await pool.query('SELECT year,province,district,COUNT(*) AS parcels,SUM(count) AS transactions,MAX(imported_at) AS importedAt FROM density_points GROUP BY year,province_key,district_key ORDER BY year DESC,province,district');
  res.json({datasets:rows.map(r=>({...r,parcels:Number(r.parcels),transactions:Number(r.transactions)}))})}
 catch(e){console.error('[DENSITY LIST]',e.message);res.status(500).json({error:'Yoğunluk verileri okunamadı.'})}
});
app.get('/api/density',async(req,res)=>{
 const year=Number(req.query.year),province=String(req.query.province||''),district=String(req.query.district||'');
 if(!validYear(year)||!province||!district)return res.status(400).json({error:'Yıl, il ve ilçe gerekli.'});
 try{const [rows]=await pool.execute('SELECT parcel_ref AS parcelRef,lat,lng,count FROM density_points WHERE year=? AND province_key=? AND district_key=?',[year,placeKey(province),placeKey(district)]);
  res.json({year,province,district,points:rows})}
 catch(e){console.error('[DENSITY GET]',e.message);res.status(500).json({error:'Yoğunluk verisi okunamadı.'})}
});
app.delete('/api/density',async(req,res)=>{
 const year=Number(req.query.year),province=String(req.query.province||''),district=String(req.query.district||'');
 if(!validYear(year)||!province||!district)return res.status(400).json({error:'Yıl, il ve ilçe gerekli.'});
 try{await pool.execute('DELETE FROM density_points WHERE year=? AND province_key=? AND district_key=?',[year,placeKey(province),placeKey(district)]);res.json({ok:true})}
 catch{res.status(500).json({error:'Silinemedi.'})}
});
// Analiz için: ilçenin en güncel yılındaki yoğunluk özeti + parsel geometrisi arşivdeyse parselin kendi işlemleri.
async function loadDensity(parcel,lat,lng){
 const pk=placeKey(parcel.province),dk=placeKey(parcel.district);
 const [[latest]]=await pool.execute('SELECT MAX(year) AS year FROM density_points WHERE province_key=? AND district_key=?',[pk,dk]);
 if(!latest?.year)return {available:false,reason:'Bu ilçe için TKGM alım satım yoğunluğu verisi yüklenmedi.'};
 const [points]=await pool.execute('SELECT parcel_ref AS parcelRef,lat,lng,count FROM density_points WHERE year=? AND province_key=? AND district_key=?',[latest.year,pk,dk]);
 let geometry=null;
 if(parcel.block&&parcel.parcel){
  const [rows]=await pool.execute('SELECT geometry FROM parcels WHERE province=? AND district=? AND neighborhood=? AND block_no=? AND parcel_no=?',[parcel.province,parcel.district,parcel.neighborhood,parcel.block,parcel.parcel]);
  if(rows[0]?.geometry){try{geometry=typeof rows[0].geometry==='string'?JSON.parse(rows[0].geometry):rows[0].geometry}catch{}}
 }
 return {available:true,year:Number(latest.year),source:'TKGM Parsel Sorgu > Analiz > Alım Satım Yoğunluğu (kullanıcı içe aktardı)',...densitySummary(points,{lat,lng,geometry})};
}

async function loadMarket(context){
 const [rows]=await pool.execute(`SELECT ${COMPARABLE_COLUMNS.join(',')} FROM comparables WHERE city_key=? AND district_key=?`,[placeKey(context.province),placeKey(context.district)]);
 return marketAnalysis(rows,context);
}
const round=(n,step=1)=>n==null?null:Math.round(n/step)*step;
// LLM'e giden piyasa özeti: sayılar kodda hesaplanmış ve yuvarlanmıştır.
function marketForPrompt(m){
 if(!m.available)return {available:false,reason:m.reason,totals:m.totals};
 return {available:true,scope:m.scope==='neighborhood'?'aynı mahalle':'aynı ilçe',sizeBand:m.sizeBand,sample:m.stats.n,outliersRemoved:m.stats.trimmed,
  pricePerM2_TRY:{median:round(m.stats.median),p25:round(m.stats.p25),p75:round(m.stats.p75),min:round(m.stats.min),max:round(m.stats.max)},
  askingValueRange_TRY:m.estimate&&{low:round(m.estimate.low,1000),mid:round(m.estimate.mid,1000),high:round(m.estimate.high,1000),areaM2:m.estimate.areaM2},
  comparables:m.comparables.map((c,i)=>({ref:`E${i+1}`,source:c.source,neighborhood:c.neighborhood,areaM2:c.area,priceTRY:c.price,pricePerM2:round(c.pricePerM2),imar:c.imar,kaks:c.kaks,tapu:c.tapu,url:c.url})),
  sameParcelListings:m.sameParcelListings.map(c=>({source:c.source,priceTRY:c.price,areaM2:c.area,imar:c.imar,url:c.url}))};
}
const ANALYSIS_INSTRUCTIONS=`Sen Türkiye'de arsa değerlemesi ve imar konusunda deneyimli, temkinli bir gayrimenkul analistisin. Türkçe yaz.
KESİN KURALLAR:
1. Sayısal değerleri YALNIZCA "verifiedContext" ve "market" alanlarından al. Hiçbir sayıyı yeniden hesaplama, yuvarlama veya tahmin etme; verildiği gibi kullan.
2. market.available=false ise değer aralığı VERME; nedenini yaz ve kaç emsal gerektiğini belirt.
3. Emsal değerleri ilan (istenen) fiyatlarıdır, satış fiyatı değildir; bunu açıkça belirt. Emsallere [E1], [E2] biçiminde atıf yap.
4. TKGM niteliği "Arsa" olsa bile imarlı olduğu anlamına gelmez. İmar durumu, TAKS/KAKS ve yapılaşma hakkı ancak belediye imar durum belgesi ve onaylı plan (e-Plan) ile kesinleşir.
5. Web araştırması yaptıysan yalnızca bulduğun ve kaynağını gösterebildiğin bilgileri yaz; her bilginin yanına kaynağın alan adını yaz. Bulamadığın konu için "bulunamadı" de. Kaynaksız iddia, uydurma kurum adı, tarih veya rakam YAZMA.
6. Web araştırmasında öncelik: ilgili ilçe belediyesinin e-imar/imar durumu ve arsa m² birim değeri (emlak vergisi) sayfaları, e-Plan (Çevre, Şehircilik ve İklim Değişikliği Bakanlığı), DSİ kamulaştırma/proje bilgileri, Bakanlığın güncel yıl yapı yaklaşık birim maliyetleri tebliği, ardından sahibinden/emlakjet/hepsiemlak'taki aynı mahalle ilanları.
7. Koordinatın tek başına parsel sınırını kanıtlamadığını unutma; geometri TKGM'den geldiyse bunu belirt.
8. "tkgmTransactionDensity" TKGM'nin resmî alım satım yoğunluğu verisidir (işlem adedi, fiyat değil). available=true ise bölgenin piyasa hareketliliğini bununla yorumla; sayıları verildiği gibi kullan, yılını belirt. thisParcel.matched=false ise "bu parselde o yıl işlem kaydı görünmüyor" de, "hiç satılmamış" deme.
BAŞLIKLAR (### ile, bu sırayla): Özet, Parsel Verisi, Alım Satım Hareketliliği (TKGM), Emsal Piyasa Analizi, Değer Aralığı (İlan Fiyatlarına Göre), Resmî Kaynak Bulguları, Riskler ve Eksik Bilgiler, Önerilen Adımlar.
Maddeleri "- Etiket: değer" biçiminde kısa yaz.`;

async function openaiResponse(body){
 const response=await fetch((process.env.OPENAI_BASE_URL||'https://api.openai.com/v1').replace(/\/$/,'')+'/responses',{method:'POST',headers:{'Authorization':`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
 const data=await response.json().catch(()=>({}));
 return {ok:response.ok,data};
}
function extractOutput(data){
 const parts=(data.output||[]).filter(x=>x.type==='message').flatMap(x=>x.content||[]).filter(x=>x.type==='output_text');
 const citations=new Map();
 for(const part of parts)for(const a of part.annotations||[])if(a.type==='url_citation'&&/^https?:\/\//.test(a.url||''))citations.set(a.url,{url:a.url,title:a.title||a.url});
 return {text:parts.map(x=>x.text).join('\n'),citations:[...citations.values()].slice(0,20)};
}

app.post('/api/analysis',async(req,res)=>{
 const {lat,lng,context}=req.body||{};
 if(!validLatLng(lat,lng))return res.status(400).json({error:'Türkiye içinde geçerli koordinat gerekli.'});
 if(!process.env.OPENAI_API_KEY)return res.status(503).json({error:'OPENAI_API_KEY sunucuda tanımlı değil.'});
 const ctx=typeof context==='object'&&context!==null?context:{};
 const parcel={province:String(ctx.province||''),district:String(ctx.district||''),neighborhood:String(ctx.neighborhood||''),
  block:String(ctx.block||''),parcel:String(ctx.parcel||''),areaM2:Number(ctx.areaM2)||null};
 let market={available:false,reason:'Parsel sorgulanmadı; emsal eşleştirmesi için önce ada/parsel sorgulayın.',totals:{district:0,neighborhood:0},comparables:[],sameParcelListings:[]};
 try{if(parcel.province&&parcel.district)market=await loadMarket(parcel)}catch(e){console.error('[MARKET]',e.message)}
 let density={available:false,reason:'Parsel il/ilçe bilgisi yok.'};
 try{if(parcel.province&&parcel.district)density=await loadDensity(parcel,lat,lng)}catch(e){console.error('[DENSITY]',e.message)}
 const sources=officialSources(parcel);
 const webSearch=process.env.AI_WEB_SEARCH!=='false';
 const body={model:process.env.OPENAI_MODEL||'gpt-4.1-mini',instructions:ANALYSIS_INSTRUCTIONS,max_output_tokens:1800,
  input:JSON.stringify({coordinates:{lat,lng},verifiedContext:ctx,market:marketForPrompt(market),tkgmTransactionDensity:density,
   officialSourcesToCheck:sources.map(s=>({title:s.title,detail:s.detail})),today:new Date().toISOString().slice(0,10)})};
 try{
  let usedWeb=webSearch,note=null;
  let r=await openaiResponse(webSearch?{...body,tools:[{type:'web_search'}]}:body);
  if(!r.ok&&webSearch){
   // Model web aramasını desteklemiyorsa aramasız tekrar dene ve kullanıcıya söyle.
   console.error('[AI WEB SEARCH]',r.data.error?.message);
   note='Web araştırması bu modelde/hesapta çalışmadı; analiz yalnızca yerel verilerle yapıldı.';usedWeb=false;
   r=await openaiResponse(body);
  }
  if(!r.ok)return res.status(502).json({error:'OpenAI API isteği başarısız.',details:r.data.error?.message||'Bilinmeyen hata'});
  const out=extractOutput(r.data);
  res.json({analysis:out.text,citations:out.citations,webSearch:usedWeb,note,market,density,sources,model:body.model,
   source:'OpenAI; yerel TKGM verisi + içe aktarılan emsal ilanlar'+(usedWeb?' + web araştırması':'')});
 }catch(e){console.error('[AI]',e.message);res.status(502).json({error:'AI servisine erişilemedi.'})}
});
app.listen(Number(process.env.PORT||3001),host,()=>console.log('XRE API listening on '+host+':'+(process.env.PORT||3001)));
