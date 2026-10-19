'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const {IDBFactory} = require('fake-indexeddb');
const core = require('../core.js');
const {createEngine} = require('../background.js');
const LABEL = 'Ad Soyad / Satıcı';

function raw(extra = {}) {
  return {url:'https://www.sahibinden.com/ilan/emlak-arsa-satilik-ornek-970001/detay',title:'Test arsa',price:6000000,area:1000,location:{city:'Ankara'},phones:['0532 111 22 33'],rawDetails:{'Arsa Tipi':'İmarlı Konut','Tapu Durumu':'Müstakil Parsel','Ada/Parsel No':'100/5'},...extra};
}
function database() {
  const context=vm.createContext({IlanCore:core,indexedDB:new IDBFactory(),module:{exports:{}},console});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..','database.js'),'utf8'),context);
  return context.module.exports;
}

test('seller-less otherwise complete listing is explicitly missing Ad Soyad / Satıcı',()=>{
  const r=core.normalizeRecord(raw());
  assert.equal(r.sellerName,'');assert.equal(r.quality.status,'missing');assert.deepEqual(r.quality.missing,[LABEL]);
});

test('later seller name clears only its stale missing marker across raw and normalized forms',()=>{
  const initial=core.normalizeRecord(raw());
  const fixed=core.normalizeRecord({...initial,sellerName:'  Örnek  Satıcı  ',missing:[LABEL]});
  assert.equal(fixed.sellerName,'Örnek Satıcı');assert.equal(fixed.quality.status,'complete');assert.deepEqual(fixed.quality.missing,[]);
  const other=core.normalizeRecord({...fixed,missing:[LABEL,'İlgili Belediye'],quality:{missing:[LABEL,'Açıklama'],warnings:[]}});
  assert.ok(!other.quality.missing.includes(LABEL));assert.ok(other.quality.missing.includes('İlgili Belediye'));assert.ok(other.quality.missing.includes('Açıklama'));
});

test('Turkish seller column aliases persist through normalizing and IndexedDB import',async()=>{
  const db=database();
  const r=core.normalizeRecord({...raw(),'Ad Soyad / Satıcı':'Örnek Satıcı'});
  assert.equal(r.sellerName,'Örnek Satıcı');await db.upsertMany([r]);
  assert.equal((await db.get(r.id)).sellerName,'Örnek Satıcı');
});

test('crawl with missing seller retains last known name with an explicit stale-value warning',async()=>{
  const db=database(),named=core.normalizeRecord(raw({sellerName:'Önceki Satıcı'}));
  await db.upsertMany([named]);
  await db.upsertMany([raw()],{origin:'crawl',baseline:true,runId:'missing-seller-observation'});
  const stored=await db.get(named.id);
  assert.equal(stored.sellerName,'Önceki Satıcı');assert.equal(stored.quality.status,'missing');
  assert.ok(stored.quality.warnings.some(w=>w.includes('son arşiv değerleri korundu')&&w.includes('Satıcı')));
  const normalizedAgain=core.normalizeRecord(stored);
  assert.ok(normalizedAgain.quality.warnings.some(w=>w.includes('son arşiv değerleri korundu')&&w.includes('Satıcı')));
});

test('one-off capture preserves known seller and creates no market event; later observed name replaces it',async()=>{
  const db=database(),named=core.normalizeRecord(raw({sellerName:'Önceki Satıcı'}));await db.upsertMany([named]);
  let observation=raw({price:7000000});
  const api={storage:{local:{get:async()=>({})}},tabs:{get:async id=>({id,url:named.url,status:'complete'}),sendMessage:async()=>({ok:true,kind:'detail',record:observation})}};
  const engine=createEngine(api,core,db,{now:()=>Date.parse('2026-09-25T12:00:00Z')});
  let captured=await engine.handle({type:'ILAN_CAPTURE_TAB',tabId:1,category:'arsa'});
  assert.equal(captured.ok,true);assert.equal(captured.saved,true);
  let stored=await db.get(named.id);assert.equal(stored.sellerName,'Önceki Satıcı');assert.equal(stored.price,7000000);
  assert.ok(stored.quality.warnings.some(w=>w.includes('Satıcı')));assert.equal((await db.getEvents({limit:0})).length,0);
  observation=raw({price:8000000,sellerName:'Yeni Görünen Satıcı',missing:[LABEL]});
  captured=await engine.handle({type:'ILAN_CAPTURE_TAB',tabId:1,category:'arsa'});assert.equal(captured.ok,true);
  stored=await db.get(named.id);assert.equal(stored.sellerName,'Yeni Görünen Satıcı');assert.equal(stored.price,8000000);
  assert.ok(!stored.quality.missing.includes(LABEL));assert.equal((await db.getEvents({limit:0})).length,0);
});
