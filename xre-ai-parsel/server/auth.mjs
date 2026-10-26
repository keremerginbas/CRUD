// Tek şifreli giriş: APP_PASSWORD tanımlıysa tüm /api istekleri oturum ister.
// Oturum çerezi HMAC ile imzalanır (sunucuda oturum tablosu yok); hatalı denemeler IP başına sınırlanır.
import crypto from 'node:crypto';

const COOKIE='xre_session';
const MAX_AGE_S=7*24*3600;
const FAIL_WINDOW_MS=15*60*1000,MAX_FAILS=5;
const fails=new Map();

const sha=v=>crypto.createHash('sha256').update(String(v)).digest();
const sign=(payload,secret)=>crypto.createHmac('sha256',secret).update(payload).digest('base64url');

export function authConfig(env=process.env){
 const password=env.APP_PASSWORD||'';
 // SESSION_SECRET verilmezse şifreden türetilir; şifre değişince tüm oturumlar düşer.
 const secret=env.SESSION_SECRET||(password?crypto.createHash('sha256').update('xre-session:'+password).digest('hex'):'');
 return {enabled:Boolean(password),password,secret};
}

function readCookie(req){
 const raw=req.headers.cookie||'';
 for(const part of raw.split(';')){const [k,...v]=part.trim().split('=');if(k===COOKIE)return decodeURIComponent(v.join('='))}
 return '';
}
export function verifySession(token,secret,now=Date.now()){
 const [payload,mac]=String(token||'').split('.');
 if(!payload||!mac)return false;
 const expected=sign(payload,secret);
 if(expected.length!==mac.length||!crypto.timingSafeEqual(Buffer.from(expected),Buffer.from(mac)))return false;
 try{const {exp}=JSON.parse(Buffer.from(payload,'base64url').toString());return Number(exp)*1000>now}catch{return false}
}
export function issueSession(secret,now=Date.now()){
 const payload=Buffer.from(JSON.stringify({exp:Math.floor(now/1000)+MAX_AGE_S})).toString('base64url');
 return payload+'.'+sign(payload,secret);
}
export function checkPassword(given,password){
 return typeof given==='string'&&given.length<=200&&crypto.timingSafeEqual(sha(given),sha(password));
}
function tooManyFails(ip,now=Date.now()){
 const list=(fails.get(ip)||[]).filter(t=>now-t<FAIL_WINDOW_MS);fails.set(ip,list);return list.length>=MAX_FAILS;
}

export function installAuth(app,{basePath='',env=process.env}={}){
 const cfg=authConfig(env);
 const cookiePath=basePath||'/';
 const secure=req=>req.secure||req.headers['x-forwarded-proto']==='https';
 const setCookie=(req,res,value,maxAge)=>res.setHeader('Set-Cookie',
  `${COOKIE}=${encodeURIComponent(value)}; Path=${cookiePath}; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure(req)?'; Secure':''}`);
 const authed=req=>!cfg.enabled||verifySession(readCookie(req),cfg.secret);

 app.get('/api/auth/me',(req,res)=>res.json({authRequired:cfg.enabled,authenticated:authed(req)}));
 app.post('/api/auth/login',(req,res)=>{
  if(!cfg.enabled)return res.json({ok:true});
  const ip=req.ip||'?';
  if(tooManyFails(ip))return res.status(429).json({error:'Çok fazla hatalı deneme. 15 dakika sonra tekrar deneyin.'});
  if(!checkPassword(req.body?.password,cfg.password)){fails.get(ip).push(Date.now());return res.status(401).json({error:'Şifre hatalı.'})}
  fails.delete(ip);setCookie(req,res,issueSession(cfg.secret),MAX_AGE_S);res.json({ok:true});
 });
 app.post('/api/auth/logout',(req,res)=>{setCookie(req,res,'',0);res.json({ok:true})});
 // Diğer tüm API çağrıları oturum ister; yazma isteklerinde başka siteden gelen istek (CSRF) reddedilir.
 app.use('/api',(req,res,next)=>{
  if(!authed(req))return res.status(401).json({error:'Oturum gerekli.',authRequired:true});
  if(req.method!=='GET'&&req.headers.origin){
   try{if(new URL(req.headers.origin).host!==req.headers.host)return res.status(403).json({error:'İzin verilmeyen kaynak.'})}
   catch{return res.status(403).json({error:'İzin verilmeyen kaynak.'})}
  }
  next();
 });
 return cfg;
}
