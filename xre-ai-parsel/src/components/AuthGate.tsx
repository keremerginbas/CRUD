import {useEffect, useState, type ReactNode} from 'react';
import {Loader2, LockKeyhole} from 'lucide-react';
import {fetchJson, postJson} from '@/lib/api';
import {Button} from './ui/button';
import {Input} from './ui/input';

// Sunucuda APP_PASSWORD tanımlıysa uygulama yalnızca girişten sonra görünür.
export function AuthGate({children}:{children:ReactNode}){
 const [state,setState]=useState<'loading'|'login'|'ok'>('loading');
 const [password,setPassword]=useState('');
 const [error,setError]=useState('');
 const [busy,setBusy]=useState(false);
 useEffect(()=>{
  fetchJson<{authRequired:boolean;authenticated:boolean}>('/api/auth/me')
   .then(d=>setState(!d.authRequired||d.authenticated?'ok':'login')).catch(()=>setState('ok'));
  const onExpired=()=>setState('login');
  window.addEventListener('xre:auth-required',onExpired);
  return()=>window.removeEventListener('xre:auth-required',onExpired);
 },[]);
 async function login(e:React.FormEvent){
  e.preventDefault();setBusy(true);setError('');
  try{await postJson('/api/auth/login',{password});setPassword('');setState('ok')}
  catch(err){setError(err instanceof Error?err.message:'Giriş başarısız.')}finally{setBusy(false)}
 }
 if(state==='loading')return <div className="grid h-dvh place-items-center bg-background"><Loader2 className="animate-spin text-primary"/></div>;
 if(state==='ok')return <>{children}</>;
 return <div className="grid min-h-dvh place-items-center bg-brand p-4">
  <form onSubmit={login} className="w-full max-w-sm space-y-4 rounded-2xl border border-white/10 bg-card p-6 shadow-2xl">
   <div className="flex items-center gap-3">
    <img src="logo-mark.svg" alt="" className="h-12 w-auto"/>
    <div className="leading-none"><div className="font-[Bebas_Neue] text-3xl text-[#38b5fe]">XRE SOFTWARE</div>
     <div className="mt-1 font-[Montserrat] text-[9px] font-semibold tracking-[.32em] text-[#38b5fe]/85">PARSEL SORGU UYGULAMASI</div></div>
   </div>
   <label className="block space-y-1.5 text-xs font-semibold text-muted-foreground">Şifre
    <Input type="password" autoFocus autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required/>
   </label>
   {error&&<p role="alert" className="text-sm text-parcel">{error}</p>}
   <Button type="submit" size="lg" className="w-full" disabled={busy||!password}>{busy?<Loader2 size={16} className="animate-spin"/>:<LockKeyhole size={16}/>}Giriş yap</Button>
  </form>
 </div>;
}

export async function logout(){
 await postJson('/api/auth/logout',{}).catch(()=>{});
 window.dispatchEvent(new Event('xre:auth-required'));
}
