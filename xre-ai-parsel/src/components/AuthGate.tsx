import {useEffect, useRef, useState, type ReactNode} from 'react';
import {ArrowRight, Loader2, LockKeyhole} from 'lucide-react';
import {fetchJson, postJson} from '@/lib/api';
import type {PlanetScene} from '@/planet/scene';
import {Button} from './ui/button';
import {Input} from './ui/input';

const reducedMotion=()=>typeof matchMedia!=='undefined'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
// Türkiye'nin ortası: girişten sonra kamera buraya döner.
const TURKEY:[number,number]=[39.0,35.2];

// Giriş ekranının arkasındaki 3D Dünya; three.js yalnızca bu ekranda yüklenir ve çıkışta serbest bırakılır.
function Planet({sceneRef}:{sceneRef:React.MutableRefObject<PlanetScene|null>}){
 const canvas=useRef<HTMLCanvasElement>(null);
 const [failed,setFailed]=useState(false);
 useEffect(()=>{
  let alive=true,scene:PlanetScene|null=null;
  import('@/planet/scene').then(m=>m.createPlanet(canvas.current!,{reducedMotion:reducedMotion()}))
   .then(s=>{if(!alive){s.dispose();return}scene=s;sceneRef.current=s})
   .catch(e=>{console.warn('3D Dünya yüklenemedi:',e);if(alive)setFailed(true)});
  return()=>{alive=false;scene?.dispose();sceneRef.current=null};
 },[]);
 return <>
  <canvas ref={canvas} aria-hidden="true" className="fixed inset-0 block size-full"/>
  {failed&&<div aria-hidden="true" className="fixed inset-0 bg-[radial-gradient(70%_60%_at_50%_110%,rgba(58,108,255,.35),transparent_70%),#040a1e]"/>}
 </>;
}

// Sunucuda APP_PASSWORD tanımlıysa uygulama yalnızca girişten sonra görünür.
export function AuthGate({children}:{children:ReactNode}){
 const [state,setState]=useState<'loading'|'login'|'leaving'|'ok'>('loading');
 const [password,setPassword]=useState('');
 const [error,setError]=useState('');
 const [busy,setBusy]=useState(false);
 const [fade,setFade]=useState(false);
 const sceneRef=useRef<PlanetScene|null>(null);
 useEffect(()=>{
  fetchJson<{authRequired:boolean;authenticated:boolean}>('/api/auth/me')
   .then(d=>setState(!d.authRequired||d.authenticated?'ok':'login')).catch(()=>setState('ok'));
  const onExpired=()=>{setFade(false);setState('login')};
  window.addEventListener('xre:auth-required',onExpired);
  return()=>window.removeEventListener('xre:auth-required',onExpired);
 },[]);
 async function login(e:React.FormEvent){
  e.preventDefault();setBusy(true);setError('');
  try{await postJson('/api/auth/login',{password})}
  catch(err){setError(err instanceof Error?err.message:'Giriş başarısız.');setBusy(false);return}
  setPassword('');setBusy(false);setState('leaving');
  // Dünya Türkiye'ye döner ve yakınlaşır, sonra ekran panele geçer.
  await sceneRef.current?.flyTo(...TURKEY,1800).catch(()=>{});
  document.documentElement.dataset.xreArrived='1';
  setFade(true);
  setTimeout(()=>setState('ok'),reducedMotion()?0:450);
 }
 if(state==='loading')return <div className="grid h-dvh place-items-center bg-background"><Loader2 className="animate-spin text-primary"/></div>;
 if(state==='ok')return <>{children}</>;
 const leaving=state==='leaving';
 return <div className={`fixed inset-0 overflow-hidden bg-background transition-opacity duration-500 ${fade?'opacity-0':''}`}>
  <Planet sceneRef={sceneRef}/>
  {/* Üstte okunurluk için yalnızca üst kısımda koyu örtü; gezegen altta görünür kalır. */}
  <div aria-hidden="true" className="pointer-events-none fixed inset-0 bg-[radial-gradient(125%_62%_at_50%_-10%,rgba(4,6,15,.82)_0%,rgba(4,6,15,.28)_44%,transparent_68%)]"/>
  <div className="relative z-10 flex h-full flex-col">
   <nav className="mx-auto flex w-full max-w-[1180px] items-center justify-between px-6 py-5">
    <div className="flex items-center gap-2.5">
     <img src="logo-mark.svg" alt="" className="h-9 w-auto"/>
     <div className="leading-none"><div className="font-[Bebas_Neue] text-2xl tracking-wide text-[#38b5fe]">XRE SOFTWARE</div>
      <div className="mt-0.5 font-[Montserrat] text-[8px] font-semibold tracking-[.32em] text-[#38b5fe]/80">PARSEL SORGU UYGULAMASI</div></div>
    </div>
    <span className="hidden text-xs font-semibold tracking-[.18em] text-muted-foreground uppercase sm:block">Kadastro · Analiz · Emsal</span>
   </nav>
   <div className={`flex flex-1 flex-col items-center justify-center px-6 pb-[18vh] text-center transition-[opacity,transform] duration-500 ${leaving?'-translate-y-4 opacity-0':''}`}>
    <span className="xre-rise mb-4 text-xs font-semibold tracking-[.18em] text-primary uppercase" style={{['--rd' as string]:'0ms'}}>Arazi istihbaratı</span>
    <h1 className="xre-rise max-w-[15ch] text-[clamp(34px,5.2vw,62px)] leading-[1.04] font-extrabold tracking-[-.03em] [text-shadow:0_2px_50px_rgba(0,0,0,.55)]" style={{['--rd' as string]:'60ms'}}>
     Parseli Bulun,<br/>Değeri <em className="text-mint-gradient not-italic">Görün</em>
    </h1>
    <p className="xre-rise mt-5 max-w-[560px] text-[clamp(15px,1.8vw,18px)] leading-relaxed text-muted-foreground [text-shadow:0_1px_24px_rgba(0,0,0,.55)]" style={{['--rd' as string]:'180ms'}}>
     TKGM kadastro sınırları, alım satım yoğunluğu, emsal ilanlar ve yapay zekâ analizi tek komuta merkezinde.
    </p>
    <form onSubmit={login} className="xre-rise glass mt-9 flex w-full max-w-md flex-col gap-3 rounded-[26px] p-3 shadow-[var(--shadow)] sm:flex-row sm:items-center sm:rounded-full sm:p-2"
     style={{['--rd' as string]:'300ms'}}>
     <label className="sr-only" htmlFor="xre-password">Şifre</label>
     <div className="relative flex-1">
      <LockKeyhole size={16} className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-muted-foreground"/>
      <Input id="xre-password" aria-label="Şifre" type="password" autoFocus autoComplete="current-password" placeholder="Şifre" value={password}
       onChange={e=>setPassword(e.target.value)} required disabled={leaving} className="h-11 rounded-full border-transparent bg-transparent pl-10 focus-visible:border-input"/>
     </div>
     <Button type="submit" size="lg" className="h-11" disabled={busy||!password||leaving}>{busy||leaving?<Loader2 size={16} className="animate-spin"/>:null}Giriş yap{!busy&&!leaving&&<ArrowRight size={16}/>}</Button>
    </form>
    {error&&<p role="alert" className="mt-3 text-sm font-medium text-parcel">{error}</p>}
   </div>
  </div>
 </div>;
}

export async function logout(){
 await postJson('/api/auth/logout',{}).catch(()=>{});
 window.dispatchEvent(new Event('xre:auth-required'));
}
