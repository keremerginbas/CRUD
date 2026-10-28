// Tarayıcının TKGM'den aldığı parsel sonucunu arşivlemeden önce doğrular (Python köprüsündeki kontrollerle aynı).
const str=(v,max)=>typeof v==='string'&&v.trim()&&v.length<=max?v.trim():null;
function points(obj,out=[]){
 if(Array.isArray(obj)&&obj.length>=2&&typeof obj[0]==='number'&&typeof obj[1]==='number')out.push(obj);
 else if(Array.isArray(obj))for(const c of obj)points(c,out);
 return out;
}
export function validateClientParcel(p){
 if(!p||typeof p!=='object')throw Error('Parsel verisi eksik.');
 const province=str(p.province,150),district=str(p.district,150),neighborhood=str(p.neighborhood,150);
 const block=String(p.block??''),number=String(p.parcel??'');
 if(!province||!district||!neighborhood)throw Error('İl, ilçe ve mahalle gerekli.');
 if(!/^\d{1,10}$/.test(block)||!/^\d{1,10}$/.test(number))throw Error('Ada ve parsel sayı olmalı.');
 const g=p.geometry?.type==='Feature'?p.geometry.geometry:p.geometry;
 if(!g||!['Polygon','MultiPolygon'].includes(g.type))throw Error('Parsel sınırı (Polygon) gerekli.');
 const pts=points(g.coordinates);
 if(pts.length<3||pts.length>12000||pts.some(([x,y])=>!(x>=25&&x<=46&&y>=35&&y<=43)))throw Error('Parsel geometrisi Türkiye sınırları içinde değil veya bozuk.');
 const area=typeof p.areaM2==='number'&&p.areaM2>0&&p.areaM2<1e10?p.areaM2:null;
 return {province,district,neighborhood,block,parcel:number,areaM2:area,
  qualification:str(p.qualification,120),sheet:str(p.sheet,60),
  geometry:{type:'Feature',properties:{block,parcel:number},geometry:{type:g.type,coordinates:g.coordinates}}};
}
