import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import {pool,requireDb,databaseMode} from './db.mjs';
import {tkgmQuery} from './tkgm-bridge.mjs';
const app=express();
// Local development is allowed without auth; remote exposure is blocked until a real login system exists.
const host=process.env.HOST||'127.0.0.1';
if(!['127.0.0.1','localhost','::1'].includes(host)&&process.env.ALLOW_UNAUTHENTICATED_REMOTE!=='I_UNDERSTAND_THE_RISK'){
 console.error('Refusing remote bind: authentication is not implemented.');process.exit(1);
}
app.disable('x-powered-by');app.use(cors({origin:process.env.CORS_ORIGIN||false}));app.use(express.json({limit:'100kb'}));
app.get('/api/health',(_req,res)=>res.json({ok:true,parcelMode:process.env.TKGM_PARCEL_MODE||'public',parcelProviderConfigured:true,parcelProviderReachable:'test edilmedi',authorizedTokenConfigured:Boolean(process.env.TKGM_TOKEN),coordinateQueryEnabled:process.env.TKGM_COORDINATE_ENABLED==='true',pythonBridge:true,aiConfigured:Boolean(process.env.OPENAI_API_KEY),database:databaseMode}));

app.get('/api/parcels/:id',async(req,res)=>{if(!await requireDb(res))return;const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<1)return res.status(400).json({error:'Geçersiz parsel kimliği.'});try{const [rows]=await pool.execute('SELECT id,province,district,neighborhood,block_no,parcel_no,geometry,area_m2,source_name,source_checked_at FROM parcels WHERE id=?',[id]);res.status(rows.length?200:404).json(rows[0]||{error:'Parsel bulunamadı.'})}catch{res.status(500).json({error:'Parsel okunamadı.'})}});
app.get('/api/markers',async(req,res)=>{if(!await requireDb(res))return;try{const [rows]=await pool.query('SELECT id,lat,lng,note,color,is_favorite AS favorite,parcel_id AS parcelId FROM map_markers WHERE user_id=? ORDER BY id DESC LIMIT 3000',['local']);res.json({markers:rows.map(row=>({...row,favorite:Boolean(row.favorite)}))})}catch{res.status(500).json({error:'Veritabanı sorgusu başarısız.'})}});
app.post('/api/markers',async(req,res)=>{if(!await requireDb(res))return;const {lat,lng,note='',favorite=false}=req.body||{};if(!Number.isFinite(lat)||!Number.isFinite(lng)||lat<35||lat>43||lng<25||lng>46||typeof note!=='string'||note.length>3000)return res.status(400).json({error:'Geçersiz konum veya not.'});try{const [r]=await pool.execute('INSERT INTO map_markers(user_id,lat,lng,note,is_favorite) VALUES(?,?,?,?,?)',['local',lat,lng,note,Boolean(favorite)]);res.status(201).json({id:r.insertId})}catch(error){console.error('[MARKER INSERT ERROR]',error);res.status(500).json({error:'Kayıt başarısız.'})}});
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
 const values=[province,district,neighborhood,block,number,JSON.stringify(p.geometry),p.areaM2,record.source,new Date(record.checkedAt).toISOString().slice(0,19).replace('T',' ')];
 if(databaseMode==='sqlite'){
  await pool.execute(`INSERT INTO parcels(province,district,neighborhood,block_no,parcel_no,geometry,area_m2,source_name,source_checked_at)
   VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(province,district,neighborhood,block_no,parcel_no) DO UPDATE SET
   geometry=excluded.geometry,area_m2=excluded.area_m2,source_name=excluded.source_name,source_checked_at=excluded.source_checked_at`,values);
 }else{
  await pool.execute(`INSERT INTO parcels(province,district,neighborhood,block_no,parcel_no,geometry,area_m2,source_name,source_checked_at)
   VALUES(?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE geometry=VALUES(geometry),area_m2=VALUES(area_m2),source_name=VALUES(source_name),source_checked_at=VALUES(source_checked_at)`,values);
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

app.post('/api/analysis',async(req,res)=>{
 const {lat,lng,context}=req.body||{};
 if(typeof lat!=='number'||typeof lng!=='number'||lat<35||lat>43||lng<25||lng>46)return res.status(400).json({error:'Türkiye içinde geçerli koordinat gerekli.'});
 if(!process.env.OPENAI_API_KEY)return res.status(503).json({error:'OPENAI_API_KEY sunucuda tanımlı değil.'});
 try{
 const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{'Authorization':`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:process.env.OPENAI_MODEL||'gpt-4.1-mini',instructions:'Türkçe yaz. Kullanıcının seçtiği koordinat için SADECE verilen doğrulanmış verilerden sonuç çıkar. Harita görüntüsüne, kadastro/imar kaydına, gerçek zamanlı yer bilgilerine erişimin yok. Bölge, ulaşım, fiyat, imar, parsel büyüklüğü, yatırım getirisi gibi unsurları uydurma. Önce veri durumu ve sınırları, sonra doğrulanabilir analiz ve gerekli veri kaynakları başlıklarıyla kısa rapor yaz. Koordinatın tek başına parsel sınırını kanıtlamadığını belirt.',input:JSON.stringify({coordinates:{lat,lng},verifiedContext:typeof context==='object'&&context!==null?context:{}}),max_output_tokens:550})});
 const data=await response.json();if(!response.ok)return res.status(502).json({error:'OpenAI API isteği başarısız.',details:data.error?.message||'Bilinmeyen hata'});
 const analysis=(data.output||[]).flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('\n');
 res.json({analysis,source:'OpenAI; yalnızca gönderilen bağlam',verifiedParcel:false});
 }catch(e){res.status(502).json({error:'AI servisine erişilemedi.'})}
});
app.listen(Number(process.env.PORT||3001),host,()=>console.log('XRE API listening on '+host+':'+(process.env.PORT||3001)));
