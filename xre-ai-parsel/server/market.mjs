// Emsal ilan piyasasi: Ilan5 eklentisi kayitlarini normalize eder ve m² fiyati istatistiklerini
// KODDA hesaplar. AI bu sayilari yeniden hesaplamaz, yalnizca yorumlar.

const SUFFIX=/\b(mahallesi|mahalle|mah|mh|koyu|koy|beldesi|belde)\b\.?/g;
export function placeKey(value){
 return String(value||'').replace(/İ/g,'i').replace(/I/g,'ı').toLocaleLowerCase('tr-TR')
  .replace(/ı/g,'i').normalize('NFKD').replace(/[̀-ͯ]/g,'')
  .replace(/[^a-z0-9 ]+/g,' ').replace(SUFFIX,' ').replace(/\s+/g,' ').trim();
}

// "1.250.000", "1.250.000,50 TL", 1250000 -> sayi; anlasilmazsa null (asla tahmin edilmez).
export function parseNumber(value){
 if(typeof value==='number')return Number.isFinite(value)?value:null;
 if(typeof value!=='string')return null;
 let s=value.replace(/[^\d.,-]/g,'');
 if(!s)return null;
 if(/,\d{1,2}$/.test(s))s=s.replace(/\./g,'').replace(',','.');
 else if(/^\d{1,3}(\.\d{3})+$/.test(s))s=s.replace(/\./g,'');
 else s=s.replace(/,/g,'');
 const n=Number(s);
 return Number.isFinite(n)?n:null;
}

const CATEGORY_LABELS={arsa:'arsa',konut:'konut',isyeri:'isyeri','işyeri':'isyeri',arac:'arac','araç':'arac',diger:'diger','diğer':'diger'};
const text=(v,max=500)=>typeof v==='string'||typeof v==='number'?String(v).trim().slice(0,max):'';
function pick(obj,...keys){for(const k of keys){const v=obj?.[k];if(v!==undefined&&v!==null&&v!=='')return v}return undefined}
function detail(row,name){
 const raw=row.rawDetails||row.raw_details||{};
 return text(pick(raw,name)??pick(row,'Özellik: '+name,name),200);
}

// Yalnizca piyasa alanlari alinir. Satici adi, telefon ve aciklama bilincli olarak ATILIR (KVKK).
export function normalizeListing(input){
 const row=input?.record&&typeof input.record==='object'?input.record:input;
 if(!row||typeof row!=='object')return null;
 const loc=row.location||{};
 const source=text(pick(row,'source','Kaynak'),40).toLowerCase();
 const listingId=text(pick(row,'listingId','listing_id','İlan No'),80);
 const url=text(pick(row,'url','URL','İlan URL','İlan Linki'),1000);
 if(!source||!listingId)return null;
 if(url&&!/^https:\/\/(www\.)?(sahibinden|hepsiemlak|emlakjet)\.com\//i.test(url))return null;
 const catRaw=text(pick(row,'category','Kategori'),20).toLocaleLowerCase('tr-TR');
 const currencyRaw=text(pick(row,'currency','Para Birimi'),8).toUpperCase();
 const removed=Boolean(row.deletedAt)||row.monitoring?.status==='removed'||/kaldırıldı/i.test(text(row['Yayın Durumu']));
 const city=text(pick(loc,'city')??row['İl'],100),district=text(pick(loc,'district')??row['İlçe'],100),neighborhood=text(pick(loc,'neighborhood')??row['Mahalle'],150);
 return {
  source,listingId,url,title:text(pick(row,'title','İlan Başlığı','Başlık')),
  price:parseNumber(pick(row,'price','Fiyat')),currency:['TL','TRY','₺'].includes(currencyRaw)||!currencyRaw?'TRY':currencyRaw,
  area:parseNumber(pick(row,'area','Metrekare')),city,district,neighborhood,
  cityKey:placeKey(city),districtKey:placeKey(district),neighborhoodKey:placeKey(neighborhood),
  category:CATEGORY_LABELS[catRaw]||'diger',
  imar:detail(row,'İmar Durumu'),kaks:detail(row,'Kaks (Emsal)'),tapu:detail(row,'Tapu Durumu'),
  adaParsel:detail(row,'Ada/Parsel No')||detail(row,'Ada/Parsel'),
  listingStatus:removed?'removed':'active',capturedAt:text(pick(row,'capturedAt','Tarama Zamanı'),40)
 };
}

function quantile(sorted,q){
 if(!sorted.length)return null;
 const pos=(sorted.length-1)*q,lo=Math.floor(pos),hi=Math.ceil(pos);
 return sorted[lo]+(sorted[hi]-sorted[lo])*(pos-lo);
}
// Tukey (1.5×IQR) ile uc degerleri ayiklayip ozet istatistik.
export function summarize(values){
 const sorted=[...values].sort((a,b)=>a-b);
 if(sorted.length<4)return {lo:-Infinity,hi:Infinity,n:sorted.length,trimmed:0,median:quantile(sorted,.5),p25:quantile(sorted,.25),p75:quantile(sorted,.75),min:sorted[0]??null,max:sorted.at(-1)??null};
 const q1=quantile(sorted,.25),q3=quantile(sorted,.75),iqr=q3-q1;
 const lo=q1-1.5*iqr,hi=q3+1.5*iqr,kept=sorted.filter(v=>v>=lo&&v<=hi);
 return {lo,hi,n:kept.length,trimmed:sorted.length-kept.length,median:quantile(kept,.5),p25:quantile(kept,.25),p75:quantile(kept,.75),min:kept[0],max:kept.at(-1)};
}

export const MIN_SAMPLE=5;

// rows: veritabanindaki emsal satirlari; parcel: {province,district,neighborhood,areaM2,block,parcel}
export function marketAnalysis(rows,parcel){
 const cityKey=placeKey(parcel?.province),districtKey=placeKey(parcel?.district),neighborhoodKey=placeKey(parcel?.neighborhood);
 const base={available:false,minSample:MIN_SAMPLE,currency:'TRY',scope:null,stats:null,estimate:null,comparables:[],sameParcelListings:[],
  totals:{district:0,neighborhood:0}};
 if(!cityKey||!districtKey)return {...base,reason:'Parsel il/ilçe bilgisi yok; emsal eşleştirilemedi.'};
 const usable=rows.filter(r=>r.category==='arsa'&&r.currency==='TRY'&&r.listing_status!=='removed'&&r.price>0&&r.area>0
  &&r.city_key===cityKey&&r.district_key===districtKey);
 const inNeighborhood=neighborhoodKey?usable.filter(r=>r.neighborhood_key===neighborhoodKey):[];
 base.totals={district:usable.length,neighborhood:inNeighborhood.length};
 // Ayni ada/parsel numarasini tasiyan ilanlar (ilan sahibinin beyani).
 const block=String(parcel?.block??'').replace(/\D/g,''),number=String(parcel?.parcel??'').replace(/\D/g,'');
 if(block&&number){
  const re=new RegExp(`(^|\\D)${block}\\s*[/\\-]\\s*${number}(\\D|$)`);
  base.sameParcelListings=usable.filter(r=>r.neighborhood_key===neighborhoodKey&&re.test(r.ada_parsel||'')).map(publicRow);
 }
 let pool=inNeighborhood.length>=MIN_SAMPLE?inNeighborhood:usable,scope=inNeighborhood.length>=MIN_SAMPLE?'neighborhood':'district';
 // Benzer büyüklük (1/3x–3x) yeterli örnek veriyorsa tercih edilir; m² fiyatı büyüklükle değişir.
 const area=Number(parcel?.areaM2)||0;
 let sizeBand=false;
 if(area>0){const near=pool.filter(r=>r.area>=area/3&&r.area<=area*3);if(near.length>=MIN_SAMPLE){pool=near;sizeBand=true}}
 if(pool.length<MIN_SAMPLE)return {...base,scope,reason:`Bu ilçede yeterli arsa emsali yok (${pool.length} ilan; en az ${MIN_SAMPLE} gerekir).`};
 const {lo,hi,...stats}=summarize(pool.map(r=>r.price/r.area));
 // Listede de yalnızca istatistiğe giren emsaller gösterilir.
 pool=pool.filter(r=>r.price/r.area>=lo&&r.price/r.area<=hi);
 const estimate=area>0?{low:area*stats.p25,mid:area*stats.median,high:area*stats.p75,areaM2:area}:null;
 const comparables=[...pool].sort((a,b)=>Math.abs(Math.log(a.area/(area||a.area)))-Math.abs(Math.log(b.area/(area||b.area)))).slice(0,12).map(publicRow);
 return {...base,available:true,scope,sizeBand,stats,estimate,comparables};
}
function publicRow(r){
 return {source:r.source,listingId:r.listing_id,title:r.title,url:r.url,price:r.price,area:r.area,pricePerM2:r.price/r.area,
  neighborhood:r.neighborhood,imar:r.imar||null,kaks:r.kaks||null,tapu:r.tapu||null,adaParsel:r.ada_parsel||null,capturedAt:r.captured_at||null};
}
