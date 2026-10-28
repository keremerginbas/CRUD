// Sunucu (VPS) TKGM tarafından engellendiğinde aynı herkese açık sorgular kullanıcının tarayıcısından yapılır;
// parselsorgu.tkgm.gov.tr'nin kendi yaptığı GET istekleriyle aynıdır. Token, çerez veya başlık taklidi yoktur.
import type {ParcelInfo, Region, RegionLevel} from './api';

const BASES=['https://cbsapi.tkgm.gov.tr/megsiswebapi.v3.1/api','https://cbsapi.tkgm.gov.tr/megsiswebapi.v3/api'];
type Feature={properties?:Record<string,any>;geometry?:GeoJSON.Geometry|null};

async function tkgmGet(path:string):Promise<any>{
 let last:unknown;
 for(const base of BASES){
  try{
   const res=await fetch(`${base}/${path}`,{credentials:'omit',headers:{Accept:'application/json'}});
   if(res.status===404)throw Object.assign(Error('TKGM: kayıt bulunamadı.'),{notFound:true});
   if(!res.ok)throw Error(`TKGM ${res.status} döndürdü.`);
   return await res.json();
  }catch(e){if((e as {notFound?:boolean}).notFound)throw e;last=e}
 }
 throw Error('TKGM tarayıcıdan da erişilemedi'+(last instanceof Error?` (${last.message})`:'')+'. parselsorgu.tkgm.gov.tr açılıyor mu kontrol edin.');
}

const LIST_PATH:Record<RegionLevel,(parent:string)=>string>={
 province:()=>'idariYapi/ilListe',district:p=>`idariYapi/ilceListe/${p}`,neighborhood:p=>`idariYapi/mahalleListe/${p}`
};
// Sınır geometrileri bellekte tutulur; harita çizimi sunucuya gitmeden yapılır.
const geometries=new Map<string,GeoJSON.Geometry>();
const isPolygon=(g:any)=>g&&(g.type==='Polygon'||g.type==='MultiPolygon')&&Array.isArray(g.coordinates);

export async function browserRegions(level:RegionLevel,parentId:string):Promise<Region[]>{
 if(!/^\d*$/.test(parentId))throw Error('Geçersiz bölge.');
 const data=await tkgmGet(LIST_PATH[level](parentId));
 const feats:Feature[]=Array.isArray(data?.features)?data.features:[];
 if(!feats.length)throw Error('TKGM liste döndürmedi.');
 return feats.filter(f=>f.properties?.id!=null).map(f=>{
  const id=Number(f.properties!.id),name=String(f.properties!.text??'');
  if(isPolygon(f.geometry))geometries.set(`${level}:${id}`,f.geometry!);
  return {id,name,hasBoundary:isPolygon(f.geometry)};
 });
}
export function browserBoundary(level:RegionLevel,id:string):GeoJSON.Feature|null{
 const g=geometries.get(`${level}:${id}`);
 return g?{type:'Feature',properties:{id:Number(id),level},geometry:g}:null;
}

// "1.234,56" / 1234.56 -> sayı; anlaşılmazsa null.
export function parseArea(v:unknown):number|null{
 if(typeof v==='number')return Number.isFinite(v)&&v>0?v:null;
 if(typeof v!=='string')return null;
 const n=Number(/,\d+$/.test(v)?v.replace(/\./g,'').replace(',','.'):v.replace(/,/g,''));
 return Number.isFinite(n)&&n>0?n:null;
}
export async function browserParcel(neighborhoodId:string,block:string,parcel:string):Promise<ParcelInfo>{
 if(![neighborhoodId,block,parcel].every(v=>/^\d{1,10}$/.test(v)))throw Error('Mahalle, ada ve parsel sayı olmalı.');
 const data=await tkgmGet(`parsel/${neighborhoodId}/${block}/${parcel}`);
 const f:Feature=Array.isArray(data?.features)?data.features[0]:data?.type==='Feature'?data:null;
 if(!f||!isPolygon(f.geometry))throw Error('TKGM bu ada/parsel için sınır döndürmedi.');
 const p=f.properties||{};
 // Yanıt istenen parsele ait değilse kabul etme.
 if(p.adaNo!=null&&String(p.adaNo).trim()!==block||p.parselNo!=null&&String(p.parselNo).trim()!==parcel)throw Error('TKGM yanıtı istenen ada/parselle eşleşmedi.');
 return {province:p.ilAd,district:p.ilceAd,neighborhood:p.mahalleAd,block,parcel,areaM2:parseArea(p.alan),
  qualification:p.nitelik??null,sheet:p.pafta??null,geometry:{type:'Feature',properties:p,geometry:f.geometry!}};
}
export async function browserDensity(year:number,districtId:string):Promise<unknown[]>{
 if(!/^\d{1,9}$/.test(districtId))throw Error('Geçersiz ilçe.');
 const rows=await tkgmGet(`analiz?AnalizTip=1&Yil=${year}&IlceId=${districtId}`);
 if(!Array.isArray(rows))throw Error('TKGM analiz yanıtı liste değil.');
 return rows;
}

// Sunucu bir kez engellendiğinde oturum boyunca TKGM sorguları doğrudan tarayıcıdan yapılır.
export const tkgmMode={
 _on:false,
 get viaBrowser(){return this._on},
 set viaBrowser(v:boolean){if(v&&!this._on)window.dispatchEvent(new Event('xre:tkgm-browser'));this._on=v},
};
