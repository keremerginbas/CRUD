// TKGM Parsel Sorgu > Analiz > "Alım Satım Yoğunluğu" yanıtı: [{parselId, enlem, boylam, sayi}, ...]
// Aynı parsel birden çok satırda gelebilir (ör. dönem/işlem türü kırılımı); parsel bazında toplanır.
import {containsPoint} from './geo.mjs';

export function normalizeDensityRows(rows){
 if(!Array.isArray(rows))throw Error('JSON bir dizi olmalı: [{parselId, enlem, boylam, sayi}, ...]');
 const byParcel=new Map();let invalid=0;
 for(const r of rows){
  const id=Number(r?.parselId),lat=Number(r?.enlem),lng=Number(r?.boylam),n=Number(r?.sayi);
  if(!Number.isSafeInteger(id)||id<1||!(lat>=35&&lat<=43)||!(lng>=25&&lng<=46)||!Number.isInteger(n)||n<1||n>100000){invalid++;continue}
  const p=byParcel.get(id);
  if(p){p.count+=n;p.rows++}else byParcel.set(id,{parcelRef:id,lat,lng,count:n,rows:1});
 }
 const points=[...byParcel.values()];
 if(!points.length)throw Error('Geçerli satır bulunamadı. TKGM Analiz yanıtındaki diziyi yapıştırın.');
 return {points,invalid,rows:rows.length,transactions:points.reduce((s,p)=>s+p.count,0)};
}

// Haversine, metre.
export function distanceM(lat1,lng1,lat2,lng2){
 const R=6371000,toRad=d=>d*Math.PI/180,dLat=toRad(lat2-lat1),dLng=toRad(lng2-lng1);
 const a=Math.sin(dLat/2)**2+Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLng/2)**2;
 return 2*R*Math.asin(Math.sqrt(a));
}

// Seçili konum/parsel için yoğunluk özeti; sayılar kodda hesaplanır, AI yalnızca yorumlar.
export function densitySummary(points,{lat,lng,geometry}={}){
 const total=points.reduce((s,p)=>s+p.count,0);
 const ring=r=>{const near=points.filter(p=>distanceM(lat,lng,p.lat,p.lng)<=r);return {radiusM:r,parcels:near.length,transactions:near.reduce((s,p)=>s+p.count,0)}};
 const own=geometry?points.filter(p=>containsPoint(geometry,p.lat,p.lng)):[];
 const sorted=points.map(p=>p.count).sort((a,b)=>a-b);
 const median=sorted.length?sorted[Math.floor((sorted.length-1)/2)]:null;
 return {
  district:{parcels:points.length,transactions:total,medianPerParcel:median,maxPerParcel:sorted.at(-1)??null},
  near:Number.isFinite(lat)&&Number.isFinite(lng)?[ring(500),ring(1000),ring(3000)]:[],
  // Parsel geometrisinin içinde kalan TKGM noktası varsa bu parselin kendi işlem sayısıdır.
  thisParcel:geometry?{transactions:own.reduce((s,p)=>s+p.count,0),matched:own.length>0}:null
 };
}
