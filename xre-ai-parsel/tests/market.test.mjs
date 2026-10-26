import test from 'node:test';
import assert from 'node:assert/strict';
import {placeKey, parseNumber, normalizeListing, summarize, marketAnalysis} from '../server/market.mjs';
import {containsPoint} from '../server/geo.mjs';
import {officialSources} from '../server/sources.mjs';

test('yer adları Türkçe karakter ve ek farkına duyarsız eşleşir',()=>{
 assert.equal(placeKey('TATLICA Mah.'),placeKey('Tatlıca Mahallesi'));
 assert.equal(placeKey('İSMETPAŞA'),placeKey('ismetpaşa mh'));
 assert.equal(placeKey('Elmadağ'),'elmadag');
});
test('fiyat ayrıştırma tahmin yapmaz',()=>{
 assert.equal(parseNumber('1.250.000'),1250000);
 assert.equal(parseNumber('1.250.000,50 TL'),1250000.5);
 assert.equal(parseNumber(489),489);
 assert.equal(parseNumber('fiyat sorunuz'),null);
});
test('ilan normalizasyonu kişisel veriyi atar ve yalnız bilinen sitelere izin verir',()=>{
 const l=normalizeListing({source:'sahibinden',listingId:'123',title:'Satılık arsa',price:900000,currency:'TL',area:500,category:'arsa',
  url:'https://www.sahibinden.com/ilan/123',sellerName:'Ali',phones:['905550000000'],description:'tel 0555',
  location:{city:'Ankara',district:'Elmadağ',neighborhood:'Tatlıca Mah.'},rawDetails:{'İmar Durumu':'Konut','Ada/Parsel No':'886/9'}});
 assert.equal(l.currency,'TRY');assert.equal(l.imar,'Konut');assert.equal(l.adaParsel,'886/9');
 assert.ok(!('sellerName' in l)&&!('phones' in l)&&!('description' in l));
 assert.equal(normalizeListing({source:'x',listingId:'1',url:'https://evil.example/ilan'}),null);
 const csv=normalizeListing({'Kaynak':'emlakjet','İlan No':'9','Fiyat':'1.000.000','Metrekare':'1.000','Kategori':'Arsa','İl':'Ankara','İlçe':'Elmadağ','Mahalle':'Tatlıca','Özellik: İmar Durumu':'Tarla','URL':'https://www.emlakjet.com/ilan/9'});
 assert.equal(csv.price,1000000);assert.equal(csv.area,1000);assert.equal(csv.category,'arsa');assert.equal(csv.imar,'Tarla');
});
test('uç değerler IQR ile ayıklanır',()=>{
 const s=summarize([1000,1100,1200,1300,1400,50000]);
 assert.equal(s.trimmed,1);assert.equal(s.max,1400);assert.equal(s.median,1200);
});
const row=(o)=>({category:'arsa',currency:'TRY',listing_status:'active',city_key:'ankara',district_key:'elmadag',neighborhood_key:'tatlica',neighborhood:'Tatlıca',source:'sahibinden',listing_id:String(Math.random()),...o});
test('mahallede yeterli emsal varsa mahalle, yoksa ilçe kullanılır ve değer kodda hesaplanır',()=>{
 const rows=[500,600,400,450,550].map((a,i)=>row({area:a,price:a*2000+i})).concat([row({neighborhood_key:'lalabel',area:500,price:5_000_000})]);
 const m=marketAnalysis(rows,{province:'Ankara',district:'Elmadağ',neighborhood:'Tatlıca',areaM2:489,block:'886',parcel:'9'});
 assert.equal(m.available,true);assert.equal(m.scope,'neighborhood');
 assert.ok(Math.abs(m.stats.median-2000)<1);
 assert.ok(Math.abs(m.estimate.mid-489*m.stats.median)<1e-6);
 const few=marketAnalysis(rows.slice(0,3),{province:'Ankara',district:'Elmadağ',neighborhood:'Tatlıca',areaM2:489});
 assert.equal(few.available,false);assert.equal(few.estimate,null);
});
test('ayıklanan uç değer emsal listesinde görünmez',()=>{
 const rows=[450,500,520,600,480].map((a,i)=>row({area:a,price:a*(1800+i*40)})).concat([row({area:500,price:99_000_000})]);
 const m=marketAnalysis(rows,{province:'Ankara',district:'Elmadağ',neighborhood:'Tatlıca',areaM2:489});
 assert.equal(m.stats.trimmed,1);assert.equal(m.comparables.length,5);assert.ok(m.comparables.every(c=>c.pricePerM2<3000));
 assert.ok(!('lo' in m.stats));
});
test('aynı ada/parsel ilanı bulunur, kaldırılan/döviz ilanı sayılmaz',()=>{
 const rows=[row({area:489,price:1e6,ada_parsel:'886/9'}),row({area:489,price:1e6,ada_parsel:'1886/9'}),row({area:500,price:1e6,listing_status:'removed'}),row({area:500,price:1e5,currency:'USD'})];
 const m=marketAnalysis(rows,{province:'Ankara',district:'Elmadağ',neighborhood:'Tatlıca',areaM2:489,block:'886',parcel:'9'});
 assert.equal(m.sameParcelListings.length,1);assert.equal(m.totals.district,2);
});
test('nokta-poligon (delikli ve çoklu)',()=>{
 const sq={type:'Polygon',coordinates:[[[0,0],[10,0],[10,10],[0,10],[0,0]],[[4,4],[6,4],[6,6],[4,6],[4,4]]]};
 assert.equal(containsPoint(sq,1,1),true);assert.equal(containsPoint(sq,5,5),false);assert.equal(containsPoint(sq,11,1),false);
 assert.equal(containsPoint({type:'Feature',geometry:{type:'MultiPolygon',coordinates:[sq.coordinates,[[[20,20],[30,20],[30,30],[20,20]]]]}},21,25),true);
});
test('resmî kaynaklar parsel bilgisini içerir',()=>{
 const s=officialSources({province:'Ankara',district:'Elmadağ',neighborhood:'Tatlıca',block:'886',parcel:'9'},2026);
 assert.ok(s.find(x=>x.id==='belediye-imar').url.includes(encodeURIComponent('886 ada 9 parsel')));
 assert.ok(s.every(x=>x.url.startsWith('https://')));
});
