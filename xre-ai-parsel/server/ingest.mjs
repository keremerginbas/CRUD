// İlan5 eklentisinden doğrudan ilan aktarımı: POST /api/ingest/listings, "Authorization: Bearer <XRE_INGEST_TOKEN>".
// Tarayıcı oturumundan bağımsızdır; yalnızca bu uç noktaya ve yalnızca doğru anahtarla yazılabilir.
import crypto from 'node:crypto';

const sha=v=>crypto.createHash('sha256').update(String(v)).digest();
export function tokenMatches(header,token){
 const m=/^Bearer\s+(\S{16,200})$/.exec(String(header||''));
 return Boolean(token&&m&&crypto.timingSafeEqual(sha(m[1]),sha(token)));
}

export function installIngest(app,{token,save}){
 app.post('/api/ingest/listings',async(req,res)=>{
  if(!token)return res.status(503).json({error:'Sunucuda XRE_INGEST_TOKEN tanımlı değil; eklenti aktarımı kapalı.'});
  if(!tokenMatches(req.headers.authorization,token))return res.status(401).json({error:'Aktarım anahtarı hatalı.'});
  const records=req.body?.records;
  if(!Array.isArray(records)||!records.length||records.length>2000)return res.status(400).json({error:'Bir istekte 1–2000 kayıt gönderin.'});
  try{res.json(await save(records))}
  catch(e){console.error('[INGEST]',e.message);res.status(500).json({error:'İlanlar kaydedilemedi.'})}
 });
 // Eklentinin "Bağlantıyı test et" düğmesi için.
 app.get('/api/ingest/ping',(req,res)=>{
  if(!token)return res.status(503).json({error:'Sunucuda XRE_INGEST_TOKEN tanımlı değil.'});
  res.status(tokenMatches(req.headers.authorization,token)?200:401).json(tokenMatches(req.headers.authorization,token)?{ok:true,app:'XRE Parsel Sorgu'}:{error:'Aktarım anahtarı hatalı.'});
 });
}
