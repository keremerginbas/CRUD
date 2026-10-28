import test from 'node:test';
import assert from 'node:assert/strict';
import {validateClientParcel} from '../server/parcel-validate.mjs';

const ok={province:'Ankara',district:'Elmadağ',neighborhood:'Tatlıca',block:'886',parcel:'9',areaM2:489,qualification:'Arsa',
 geometry:{type:'Feature',properties:{x:1},geometry:{type:'Polygon',coordinates:[[[33.2214,39.9015],[33.2216,39.9015],[33.2216,39.9019],[33.2214,39.9015]]]}}};
test('geçerli parsel kabul edilir ve gereksiz özellikler atılır',()=>{
 const v=validateClientParcel(ok);
 assert.equal(v.areaM2,489);assert.deepEqual(v.geometry.properties,{block:'886',parcel:'9'});
});
test('bozuk veya Türkiye dışı veri reddedilir',()=>{
 const bad=o=>assert.throws(()=>validateClientParcel({...ok,...o}));
 bad({block:'88a'});bad({parcel:''});bad({province:''});bad({geometry:null});
 bad({geometry:{type:'Point',coordinates:[33,39]}});
 bad({geometry:{type:'Polygon',coordinates:[[[2,48],[2.1,48],[2.1,48.1],[2,48]]]}});
 assert.equal(validateClientParcel({...ok,areaM2:-5}).areaM2,null);
});
