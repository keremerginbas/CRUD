export type Pin={id?:number;lat:number;lng:number;note:string;favorite?:boolean;parcelId?:number|null};
export type Region={id:number;name:string;hasBoundary?:boolean};
export type RegionLevel='province'|'district'|'neighborhood';
export type ParcelInfo={province?:string;district?:string;neighborhood?:string;block?:string;parcel?:string;areaM2?:number|null;qualification?:string|null;sheet?:string|null;geometry?:GeoJSON.Feature};
export type ParcelResponse={ok?:boolean;error?:string;source?:string;checkedAt?:string;parcel?:ParcelInfo;warning?:string;localParcelId?:number|null};
export type Health={parcelMode?:string;coordinateQueryEnabled?:boolean;aiConfigured?:boolean;aiWebSearch?:boolean;database?:string};
export type StoredParcel=ParcelInfo&{id:number;source?:string;checkedAt?:string};
export type Comparable={source:string;listingId:string;title:string;url:string;price:number;area:number;pricePerM2:number;neighborhood?:string;imar?:string|null;kaks?:string|null;tapu?:string|null;adaParsel?:string|null};
export type Market={available:boolean;reason?:string;scope?:'neighborhood'|'district'|null;sizeBand?:boolean;minSample:number;totals:{district:number;neighborhood:number};
 stats?:{n:number;trimmed:number;median:number;p25:number;p75:number;min:number;max:number}|null;estimate?:{low:number;mid:number;high:number;areaM2:number}|null;
 comparables:Comparable[];sameParcelListings:Comparable[]};
export type OfficialSource={id:string;group:string;title:string;detail:string;url:string;direct?:boolean};
export type AnalysisResponse={analysis:string;citations?:{url:string;title:string}[];webSearch?:boolean;note?:string|null;market?:Market;density?:DensitySummary;sources?:OfficialSource[]};
export type ComparableSummary={total:number;usable:number;districts:{city:string;district:string;n:number}[]};

export async function fetchJson<T>(url:string,options?:RequestInit):Promise<T>{
 const res=await fetch(url,options);
 const raw=await res.text();
 let data:any;
 try{data=raw?JSON.parse(raw):{}}catch{throw new Error('Sunucu JSON yerine beklenmeyen yanıt döndürdü. API terminalini kontrol edin.')}
 if(!res.ok)throw new Error(data.error||`Sunucu hatası: ${res.status}`);
 return data as T;
}

export const postJson=<T,>(url:string,body:unknown,method='POST')=>fetchJson<T>(url,{
 method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)
});

// Sinir istekleri: il icin parentId 0.
export const fetchBoundary=(level:RegionLevel,parentId:string|number,id:string|number)=>
 fetchJson<{feature:GeoJSON.Feature}>(`/api/regions/boundary/${level}/${parentId}/${id}`).then(d=>d.feature);
export type DensityPoint={parcelRef:number;lat:number;lng:number;count:number};
export type DensityDataset={year:number;province:string;district:string;parcels:number;transactions:number;importedAt?:string};
export type DensitySummary={available:boolean;reason?:string;year?:number;district?:{parcels:number;transactions:number;medianPerParcel:number|null;maxPerParcel:number|null};
 near?:{radiusM:number;parcels:number;transactions:number}[];thisParcel?:{transactions:number;matched:boolean}|null};
