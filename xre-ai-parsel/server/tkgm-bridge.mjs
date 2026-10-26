import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const workerPath=fileURLToPath(new URL('../worker/parcel_bridge.py',import.meta.url));
const python=process.env.PYTHON_BIN||(process.platform==='win32'?'py':'python3');
const cmdArgs=process.env.PYTHON_BIN?[]:(process.platform==='win32'?['-3']:[]);
const inFlight=new Map();
let lastCall=0;
const cache=new Map();

function runPython(payload){
 return new Promise((resolve,reject)=>{
  let child,stdout='',stderr='';
  try {child=spawn(python,[...cmdArgs,workerPath],{
   cwd:path.dirname(workerPath),windowsHide:true,
   env:{...process.env,PYTHONUTF8:'1'},stdio:['pipe','pipe','pipe']
  });}catch(e){return reject(e)}
  const timer=setTimeout(()=>{child.kill();reject(new Error('Python sorgu zaman aşımı (35 sn).'))},35000);
  child.stdout.on('data',buf=>{stdout+=buf;if(stdout.length>30_000_000){child.kill()}});
  child.stderr.on('data',buf=>{stderr+=buf.toString().slice(0,2000)});
  child.once('error',err=>{clearTimeout(timer);reject(new Error('Python başlatılamadı. Python 3.10+ ve requests kurulumunu kontrol edin. '+err.code))});
  child.once('close',code=>{
   clearTimeout(timer);
   if(code!==0)return reject(new Error('Python sorgu motoru çalışmadı. Python 3.10+ ve requests gerekli.'));
   try{resolve(JSON.parse(stdout))}catch{reject(new Error('Python geçerli JSON döndürmedi.'))}
  });
  child.stdin.on('error',()=>{});
  child.stdin.end(JSON.stringify(payload));
 });
}

export async function tkgmQuery(payload,{cacheMs=0}={}){
 const key=JSON.stringify(payload);
 const found=cache.get(key);
 if(cacheMs&&found&&Date.now()<found.expires)return found.result;
 if(inFlight.has(key))return inFlight.get(key);
 // Local personal use: cap total requests; no bulk scraping / concurrent storm.
 if(inFlight.size>=2)return {ok:false,code:'BUSY',error:'Başka sorgu çalışıyor. Tamamlanınca tekrar deneyin.'};
 const job=(async()=>{
  const delay=Math.max(0,1200-(Date.now()-lastCall));
  if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
  lastCall=Date.now();
  try{
   const result=await runPython(payload);
   if(result.ok&&cacheMs){
    if(cache.size>100)cache.clear();
    cache.set(key,{result,expires:Date.now()+cacheMs});
   }
   return result;
  }catch(e){
   console.error('[TKGM BRIDGE]',e.message);
   return {ok:false,code:'UNAVAILABLE',error:e.message};
  }finally{inFlight.delete(key)}
 })();
 inFlight.set(key,job);
 return job;
}
