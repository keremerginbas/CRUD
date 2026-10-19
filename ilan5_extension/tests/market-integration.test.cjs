'use strict';

// Actual core/database/crawler modules. Browser pages are synthetic; no requests.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const {IDBFactory} = require('/workspace/scratch/7830fb02ac8e/test_runtime/node_modules/fake-indexeddb');
const core = require('../core.js');
const Background = require('../background.js');
const Monitor = require('../monitoring.js');
const SEARCH = 'https://www.sahibinden.com/satilik-arsa/ankara?sahibinden=true';
const SEARCH_ID = 'saved-ankara-land';
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

function database() {
  const context = vm.createContext({IlanCore: core, indexedDB: new IDBFactory(), module: {exports: {}}, console});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'database.js'), 'utf8'), context);
  return context.module.exports;
}
function listing(id,price=6000000,extra={}) {
  return {url:`https://www.sahibinden.com/ilan/emlak-arsa-satilik-test-${id}/detay`,title:`Test arsa ${id}`,price,currency:'TRY',area:1000,location:{city:'Ankara'},phones:['0532 111 22 33'],rawDetails:{'Arsa Tipi':'İmarlı Konut','Tapu Durumu':'Müstakil Parsel','Ada/Parsel No':'100/5'},...extra};
}
function harness(db) {
  const storage={},tabs=new Map(),alarms=new Map(),reads=[];
  let now=Date.parse('2026-09-25T09:00:00Z'),nextId=1,rows=[],engine,pageSize=Infinity;
  const api={
    storage:{local:{get:async key=>({[key]:clone(storage[key])}),set:async data=>Object.assign(storage,clone(data))}},
    runtime:{sendMessage:async()=>{}},
    alarms:{create:async(name,value)=>alarms.set(name,clone(value)),clear:async name=>alarms.delete(name)},
    tabs:{get:async id=>{if(!tabs.has(id))throw Error('missing');return clone(tabs.get(id));},create:async args=>{const tab={id:nextId++,status:'complete',...args};tabs.set(tab.id,tab);return clone(tab);},update:async(id,args)=>{const tab=tabs.get(id);Object.assign(tab,args,{status:'loading'});return clone(tab);},sendMessage:async(id,request)=>{
      reads.push({id,...clone(request)});
      if(request.mode==='list'){
        const page=Number(new URL(request.expectedUrl).searchParams.get('page')||1),pages=Number.isFinite(pageSize)?Math.max(1,Math.ceil(rows.length/pageSize)):1;
        const current=Number.isFinite(pageSize)?rows.slice((page-1)*pageSize,page*pageSize):rows;
        return {ok:true,kind:'list',links:current.map(r=>r.url),nextUrl:page<pages?'?page='+(page+1):null,pagination:{complete:page===pages,expectedTotal:rows.length,currentPage:page,lastPage:pages}};
      }
      const row=rows.find(r=>core.canonicalUrl(r.url)===core.canonicalUrl(request.expectedUrl));
      if(!row)throw Error('Unexpected detail URL');return {ok:true,kind:'detail',record:clone(row)};
    }},
    scripting:{executeScript:async()=>{}}
  };
  engine=Background.createEngine(api,core,db,{now:()=>now});
  return {storage,tabs,reads,get engine(){return engine;},state(){return clone(storage[Background.JOB_KEY]);},advance(ms){now+=ms;},setPageSize(value){pageSize=value;},async crawl(items,baseline){
    rows=items;now+=60000;
    const started=await engine.handle({type:'ILAN_START',searchUrl:SEARCH,searchId:SEARCH_ID,baseline,category:'arsa',delayMs:4000,maxListings:0,maxPages:0,revealPhone:true});
    assert.equal(started.ok,true);
    for(let guard=0;guard<1000;guard++) {
      const state=storage[Background.JOB_KEY];
      if(['completed','incomplete','blocked','paused','stopped'].includes(state.status))return clone(state);
      const tab=tabs.get(state.workTabId);
      if(state.current&&tab?.status==='loading') {tab.status='complete';await engine.onUpdated(tab.id,{status:'complete'},clone(tab));}
      else {now+=5000;await engine.onAlarm({name:Background.STEP_ALARM});}
    }
    throw Error('Synthetic crawl did not finish in bounded steps');
  }};
}

test('actual crawler baseline emits no market events; later same search records new and price changes once',async()=>{
  const db=database(),h=harness(db);
  const first=await h.crawl([listing('9201',6000000),listing('9202',8000000)],true);
  assert.equal(first.status,'completed');assert.equal((await db.getAll()).length,2);
  assert.equal((await db.getEvents({limit:0})).length,0);
  const second=await h.crawl([listing('9201',6500000),listing('9202',7500000),listing('9203',9000000)],false);
  assert.equal(second.status,'completed');
  const events=await db.getEvents({limit:0});
  assert.deepEqual(Array.from(events,e=>e.type).sort(),['new','price_down','price_up']);
  assert.equal(second.counts.newListings,1);assert.equal(second.counts.priceIncreases,1);assert.equal(second.counts.priceDecreases,1);
  assert.ok(events.every(e=>e.searchIds.includes(SEARCH_ID)));
  const up=events.find(e=>e.type==='price_up');assert.equal(up.oldPrice,6000000);assert.equal(up.newPrice,6500000);assert.equal(up.currency,'TRY');
  await h.crawl([listing('9201',6500000),listing('9202',7500000),listing('9203',9000000)],false);
  assert.equal((await db.getEvents({limit:0})).length,3);
});

test('five actual synthetic result pages archive all fifty details once in real IndexedDB',async()=>{
  const db=database(),h=harness(db);h.setPageSize(10);
  const rows=Array.from({length:50},(_,i)=>listing(String(9500+i),6000000+i*1000));
  const result=await h.crawl(rows,true);
  assert.equal(result.status,'completed');assert.equal(result.pages,5);assert.equal(result.counts.processed,50);assert.equal(result.counts.saved,50);
  assert.equal((await db.getAll()).length,50);assert.equal((await db.getEvents({limit:0})).length,0);
  assert.equal(h.reads.filter(r=>r.mode==='list').length,5);assert.equal(h.reads.filter(r=>r.mode==='detail').length,50);
  const detailIds=h.reads.filter(r=>r.mode==='detail').map(r=>core.listingIdFromUrl(r.expectedUrl));assert.equal(new Set(detailIds).size,50);
});

test('spreadsheet/JSON imports alone emit no events, and baseline membership avoids later false additions',async()=>{
  const db=database(),h=harness(db);
  await db.upsertMany([{'URL':listing('9210').url,'İlan Başlığı':'İçe aktarılan arsa','Fiyat (TL)':5000000,'İl':'Ankara','Arsa Tipi':'İmarlı Konut'}]);
  await db.upsertMany([listing('9210',7000000)]);
  assert.equal((await db.getEvents({limit:0})).length,0);
  await h.crawl([listing('9210',7000000)],true);
  const result=await h.crawl([listing('9210',7000000)],false);
  assert.equal(result.counts.newListings,0);
  assert.equal((await db.getEvents({limit:0})).length,0);
});

test('pre-existing imported record first seen in a baselined search is new to that search, not claimed newly published',async()=>{
  const db=database(),h=harness(db);
  await db.upsertMany([listing('9211',7000000)]);
  await h.crawl([listing('9212',6000000)],true);
  const result=await h.crawl([listing('9212',6000000),listing('9211',7000000)],false);
  assert.equal(result.counts.newListings,1);
  const events=await db.getEvents({type:'new',limit:0});assert.equal(events.length,1);assert.equal(events[0].listingId,'9211');assert.ok(events[0].searchIds.includes(SEARCH_ID));
});

test('absence from later search results never means removed and preserves archive',async()=>{
  const db=database(),h=harness(db);
  await h.crawl([listing('9220'),listing('9221')],true);
  await h.crawl([listing('9220')],false);
  const unseen=await db.get('sahibinden:9221');
  assert.ok(unseen);assert.equal(unseen.deletedAt,null);assert.notEqual(unseen.monitoring.status,'removed');
  assert.equal((await db.getEvents({type:'removed',limit:0})).length,0);
});

test('currency change is not reported as a comparable price increase or decrease',async()=>{
  const db=database(),h=harness(db);
  await h.crawl([listing('9230',6000000)],true);
  await h.crawl([listing('9230',150000,{currency:'USD'})],false);
  const stored=await db.get('sahibinden:9230');assert.equal(stored.currency,'USD');
  assert.equal((await db.getEvents({limit:0})).filter(e=>e.type.startsWith('price_')).length,0);
});

test('only confirmed monitoring transition creates removal event, not unknown, suspect or trash',async()=>{
  const db=database(),h=harness(db);await h.crawl([listing('9240')],true);
  const id='sahibinden:9240',start=Date.parse('2026-09-25T12:00:00Z');
  let record=await db.get(id);
  await db.patchMonitoring(id,Monitor.observationPatch(record.monitoring,'unknown',start,15,'','Sayfa okunamadı',id));
  await db.setDeleted(id,true);await db.setDeleted(id,false);
  record=await db.get(id);await db.patchMonitoring(id,Monitor.observationPatch(record.monitoring,'removed',start+60000,15,'İlan yayından kaldırılmıştır.','',id));
  assert.equal((await db.getEvents({type:'removed',limit:0})).length,0);
  record=await db.get(id);await db.patchMonitoring(id,Monitor.observationPatch(record.monitoring,'removed',start+17*60000,15,'İlan yayından kaldırılmıştır.','',id));
  let events=await db.getEvents({type:'removed',limit:0});assert.equal(events.length,1);assert.equal(events[0].recordId,id);
  record=await db.get(id);await db.patchMonitoring(id,Monitor.observationPatch(record.monitoring,'removed',start+33*60000,15,'İlan yayından kaldırılmıştır.','',id));
  events=await db.getEvents({type:'removed',limit:0});assert.equal(events.length,1);
});
