import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeDensityRows, densitySummary, distanceM} from '../server/density.mjs';

// TKGM yanıtından kesit (Ankara / Ayaş, 2025): aynı parsel birden çok satırda gelir.
const SAMPLE=[
 {parselId:24992257,enlem:40.033439303218159,boylam:32.242180660188339,sayi:17},
 {parselId:24992257,enlem:40.033439303218159,boylam:32.242180660188339,sayi:5},
 {parselId:24992256,enlem:40.035977623744913,boylam:32.245286792508793,sayi:3},
 {parselId:15285879,enlem:39.964874740504477,boylam:32.206746286727139,sayi:1},
 {parselId:0,enlem:40,boylam:32,sayi:1},{parselId:5,enlem:10,boylam:32,sayi:1},{parselId:6,enlem:40,boylam:32,sayi:1.5}
];
test('aynı parsel satırları toplanır, bozuk satırlar sayılmaz',()=>{
 const d=normalizeDensityRows(SAMPLE);
 assert.equal(d.points.length,3);assert.equal(d.invalid,3);assert.equal(d.transactions,26);
 assert.equal(d.points.find(p=>p.parcelRef===24992257).count,22);
 assert.throws(()=>normalizeDensityRows({}));assert.throws(()=>normalizeDensityRows([{a:1}]));
});
test('mesafe ve çevre özetleri',()=>{
 assert.ok(Math.abs(distanceM(40,32,40.009,32)-1000)<5);
 const {points}=normalizeDensityRows(SAMPLE);
 const s=densitySummary(points,{lat:40.0334,lng:32.2421});
 assert.equal(s.district.transactions,26);assert.equal(s.district.maxPerParcel,22);
 assert.deepEqual(s.near.map(r=>r.transactions),[25,25,25]);
 assert.equal(s.thisParcel,null);
 const box={type:'Polygon',coordinates:[[[32.2421,40.0333],[32.2423,40.0333],[32.2423,40.0336],[32.2421,40.0336],[32.2421,40.0333]]]};
 assert.deepEqual(densitySummary(points,{lat:40.0334,lng:32.2422,geometry:box}).thisParcel,{transactions:22,matched:true});
});
