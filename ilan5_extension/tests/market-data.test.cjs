'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {IDBFactory}=require('/workspace/scratch/7830fb02ac8e/test_runtime/node_modules/fake-indexeddb');
const core=require('../core.js');
const NOW='2026-09-25T10:00:00.000Z';
const LATER='2026-09-25T11:00:00.000Z';
function database(factory=new IDBFactory()){
  const context=vm.createContext({IlanCore:core,indexedDB:factory,module:{exports:{}},console});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..','database.js'),'utf8'),context);
  return context.module.exports;
}
function record(id='1001',price=1000000,extras={}){return {url:`https://www.sahibinden.com/ilan/emlak-arsa-satilik-test-${id}/detay`,listingId:id,title:'Müstakil imarlı arsa',price,currency:'TRY',area:500,location:{city:'Ankara'},phones:['0532 111 22 33'],description:'Test ilan açıklaması',rawDetails:{'İmar Durumu':'Konut','Tapu Durumu':'Müstakil Parsel','Ada/Parsel No':'50/10'},...extras};}
function options(extra={}){return {origin:'crawl',runId:'run-1',searchId:'search-A',baseline:false,observedAt:NOW,...extra};}
function removed(id='removed-1',at=LATER){return {status:'removed',lastCheckStatus:'removed',missingCount:2,removedAt:at,lastCheckedAt:at,removalEventId:id};}
const json=value=>JSON.parse(JSON.stringify(value));

test('database v1 upgrades without deleting existing records and creates movement store',async()=>{
  const factory=new IDBFactory();
  await new Promise((resolve,reject)=>{const req=factory.open('ilan5-archive-v2',1);req.onupgradeneeded=()=>{const store=req.result.createObjectStore('records',{keyPath:'id'});store.createIndex('category','category');store.createIndex('updatedAt','updatedAt');store.put(core.normalizeRecord(record()));};req.onsuccess=()=>{req.result.close();resolve();};req.onerror=()=>reject(req.error);});
  const db=database(factory);assert.equal((await db.getAll()).length,1);assert.equal((await db.getEvents({limit:0})).length,0);
  await db.upsertMany([record('1002')],options());assert.equal((await db.getEvents()).length,1);
});

test('first complete baseline populates membership without pretending baseline listings are new',async()=>{
  const db=database();const result=await db.upsertMany([record(),record('1002')],options({baseline:true}));
  assert.deepEqual(json(result),{saved:2,added:2,updated:0,newListings:0,priceIncreases:0,priceDecreases:0});assert.equal((await db.getEvents({limit:0})).length,0);
  const r=await db.get('sahibinden:1001');assert.deepEqual(json(r.market),{searchIds:['search-A'],firstObservedAt:NOW,lastSeenAt:NOW});
});

test('second watched-search scan adds exactly one event only for new membership',async()=>{
  const db=database();await db.upsertMany([record()],options({baseline:true}));
  const result=await db.upsertMany([record(),record('1002')],options({runId:'run-2',observedAt:LATER}));
  assert.equal(result.newListings,1);const events=await db.getEvents({limit:0});assert.equal(events.length,1);assert.equal(events[0].type,'new');assert.equal(events[0].listingId,'1002');assert.deepEqual(json(events[0].searchIds),['search-A']);
});

test('initial baseline of an existing record in another search stays quiet; later new membership is scoped',async()=>{
  const db=database();await db.upsertMany([record()],options({baseline:true}));
  await db.upsertMany([record()],options({runId:'B-first',searchId:'search-B',baseline:true}));
  assert.equal((await db.getEvents()).length,0);
  const result=await db.upsertMany([record()],options({runId:'C-second',searchId:'search-C'}));assert.equal(result.newListings,1);
  assert.equal((await db.getEvents({searchId:'search-A'})).length,0);assert.equal((await db.getEvents({searchId:'search-C'})).length,1);
  assert.deepEqual(json((await db.get('sahibinden:1001')).market.searchIds),['search-A','search-B','search-C']);
});

test('same run replay does not duplicate new or price-change events',async()=>{
  const db=database();await db.upsertMany([record()],options({baseline:true}));
  await db.upsertMany([record('1001',1100000),record('1002')],options({runId:'run-2'}));
  const replay=await db.upsertMany([record('1001',1100000),record('1002')],options({runId:'run-2'}));
  assert.equal(replay.newListings,0);assert.equal(replay.priceIncreases,0);assert.equal((await db.getEvents()).length,2);
});

test('price movements use exact numeric deltas and percentage points',async()=>{
  const db=database();await db.upsertMany([record()],options({baseline:true}));
  const up=await db.upsertMany([record('1001',1100000)],options({runId:'up'}));assert.equal(up.priceIncreases,1);
  const down=await db.upsertMany([record('1001',990000)],options({runId:'down',observedAt:LATER}));assert.equal(down.priceDecreases,1);
  const events=await db.getEvents();assert.equal(events[0].type,'price_down');assert.equal(events[0].delta,-110000);assert.equal(events[0].percent,-10);assert.equal(events[1].percent,10);
});

test('same price, changed currency, missing price and zero denominators are handled without false movements',async()=>{
  const db=database();await db.upsertMany([record()],options({baseline:true}));
  await db.upsertMany([record()],options({runId:'same'}));
  await db.upsertMany([record('1001',null)],options({runId:'missing'}));assert.equal((await db.getEvents()).length,0);
  assert.equal((await db.get('sahibinden:1001')).price,1000000);
  await db.upsertMany([record('1001',100,{currency:'USD'})],options({runId:'currency'}));assert.equal((await db.getEvents()).length,0);
  await db.upsertMany([record('1002',0)],options({baseline:true}));await db.upsertMany([record('1002',500)],options({runId:'zero'}));
  assert.equal((await db.getEvents())[0].percent,null);assert.equal((await db.getEvents())[0].delta,500);
});

test('price changes on a first baseline are suppressed',async()=>{
  const db=database();await db.upsertMany([record()]);await db.upsertMany([record('1001',900000)],options({baseline:true}));assert.equal((await db.getEvents()).length,0);
});

test('default imports create no fake market events and preserve legacy result shape',async()=>{
  const db=database();const result=await db.upsertMany([record()]);assert.deepEqual(json(result),{saved:1,added:1,updated:0});
  await db.upsertMany([record('1001',2000000,{monitoring:removed()})]);assert.equal((await db.getEvents()).length,0);
});

test('crawl with missing fields retains last known details and flags the retention',async()=>{
  const db=database();await db.upsertMany([record()],options({baseline:true}));
  await db.upsertMany([record('1001',null,{phones:[],description:'',rawDetails:{},location:{},area:null})],options({runId:'partial'}));
  const r=await db.get('sahibinden:1001');assert.deepEqual(json(r.phones),['905321112233']);assert.equal(r.description,'Test ilan açıklaması');assert.equal(r.rawDetails['Ada/Parsel No'],'50/10');assert.equal(r.price,1000000);assert.equal(r.quality.status,'missing');assert.ok(r.quality.warnings.some(x=>x.includes('son arşiv değerleri')));assert.equal((await db.getEvents()).length,0);
});

test('market metadata survives normalization, manual correction, imports, trash and restore',async()=>{
  const db=database();await db.upsertMany([record()],options());const original=await db.get('sahibinden:1001');
  assert.deepEqual(core.normalizeRecord(original).market,json(original.market));
  await db.setCategory(original.id,'arsa');await db.setDeleted(original.id,true);await db.setDeleted(original.id,false);await db.upsertMany([record()]);
  assert.deepEqual(json((await db.get(original.id)).market),json(original.market));assert.equal((await db.getEvents()).length,1);
});

test('removed emits once only after confirmed transition, patching telegram status does not repeat',async()=>{
  const db=database();await db.upsertMany([record()],options({baseline:true}));
  await db.patchMonitoring('sahibinden:1001',{status:'suspected',missingCount:1});await db.patchMonitoring('sahibinden:1001',{status:'error'});assert.equal((await db.getEvents()).length,0);
  await db.patchMonitoring('sahibinden:1001',removed());await db.patchMonitoring('sahibinden:1001',removed());await db.patchMonitoring('sahibinden:1001',{notificationStatus:'sent'});
  const events=await db.getEvents();assert.equal(events.length,1);assert.equal(events[0].type,'removed');assert.equal(events[0].at,LATER);assert.equal(events[0].recordId,'sahibinden:1001');assert.deepEqual(json(events[0].searchIds),['search-A']);
});

test('unconfirmed removed patch, user trash and restoration do not create removal events',async()=>{
  const db=database();await db.upsertMany([record()]);await db.patchMonitoring('sahibinden:1001',{status:'removed'});assert.equal((await db.getEvents()).length,0);
  await db.patchMonitoring('sahibinden:1001',{status:'active'});await db.setDeleted('sahibinden:1001',true);await db.patchMonitoring('sahibinden:1001',removed());await db.setDeleted('sahibinden:1001',false);assert.equal((await db.getEvents()).length,0);
});

test('reactivation occurs once after confirmed removed and subsequent fresh removal is a separate event',async()=>{
  const db=database();await db.upsertMany([record()],options({baseline:true}));await db.patchMonitoring('sahibinden:1001',removed());
  const active={status:'active',lastCheckStatus:'active',lastCheckedAt:'2026-09-25T12:00:00Z',lastActiveAt:'2026-09-25T12:00:00Z',removedAt:null,removalEventId:null,missingCount:0};
  await db.patchMonitoring('sahibinden:1001',active);await db.patchMonitoring('sahibinden:1001',active);
  let events=await db.getEvents();assert.equal(events.length,2);assert.equal(events[0].type,'reactivated');
  await db.patchMonitoring('sahibinden:1001',removed('second-removal','2026-09-25T13:00:00Z'));events=await db.getEvents();assert.equal(events.length,3);assert.equal(events[0].type,'removed');
});

test('event query applies since, type and search filters with descending order and limit0 means all',async()=>{
  const db=database();await db.upsertMany([record()],options());await db.upsertMany([record('1002')],options({searchId:'search-B',observedAt:LATER}));
  assert.equal((await db.getEvents({limit:1})).length,1);assert.equal((await db.getEvents({limit:0})).length,2);assert.equal((await db.getEvents({since:LATER})).length,1);assert.equal((await db.getEvents({since:Date.parse(LATER),searchId:'search-A'})).length,0);assert.equal((await db.getEvents({type:'removed'})).length,0);
});

test('backup event import is idempotent, validates atomically and strips unexpected fields',async()=>{
  const source=database();await source.upsertMany([record()],options());const events=await source.getEvents({limit:0}),db=database();
  const polluted={...events[0],token:'DO_NOT_RETAIN',config:{token:'DO_NOT_RETAIN'}};
  assert.ok(!JSON.stringify(core.normalizeMarketEvent(polluted)).includes('DO_NOT_RETAIN'));
  assert.equal((await db.importEvents([polluted])).added,1);assert.equal((await db.importEvents([polluted])).added,0);assert.equal((await db.getAll()).length,0);
  assert.ok(!JSON.stringify(await db.getEvents()).includes('DO_NOT_RETAIN'));
  await assert.rejects(db.importEvents([{...polluted,id:'valid-new-id'},{}]),/Geçersiz/);assert.equal((await db.getEvents()).length,1);
});
