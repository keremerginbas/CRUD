export type Pin={id?:number;lat:number;lng:number;note:string;favorite?:boolean};
export type Region={id:number;name:string;hasBoundary?:boolean};
export type RegionLevel='province'|'district'|'neighborhood';
export type ParcelInfo={province?:string;district?:string;neighborhood?:string;block?:string;parcel?:string;areaM2?:number|null;qualification?:string|null;sheet?:string|null;geometry?:GeoJSON.Feature};
export type ParcelResponse={ok?:boolean;error?:string;source?:string;checkedAt?:string;parcel?:ParcelInfo;warning?:string;localParcelId?:number|null};
export type Health={parcelMode?:string;coordinateQueryEnabled?:boolean;aiConfigured?:boolean;database?:string};

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
