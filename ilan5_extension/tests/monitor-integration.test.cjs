'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const {IDBFactory} = require('fake-indexeddb');
const core = require('../core.js');
const Monitor = require('../monitoring.js');
const Telegram = require('../telegram.js');
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const NOW = Date.parse('2026-09-25T09:00:00Z');
const CHAT = '-1001234567890';
const TOKEN = '123456789:TEST_TOKEN_NOT_REAL_abcdefghijklmnopqrstuvwxyz';
const BOT = 'ilan5_test_bot';

function database() {
  const context = vm.createContext({IlanCore: core, indexedDB: new IDBFactory(), module: {exports: {}}, console});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'database.js'), 'utf8'), context);
  return context.module.exports;
}
function record(id='9100',extra={}) {
  return core.normalizeRecord({url:`https://www.sahibinden.com/ilan/emlak-arsa-satilik-test-${id}/detay`,title:'Test arsa',price:6000000,area:1000,location:{city:'Ankara'},phones:['0532 111 22 33'],rawDetails:{'Arsa Tipi':'İmarlı Konut','Tapu Durumu':'Müstakil Parsel','Ada/Parsel No':'100/5'},...extra});
}
function confirmed(eventId='test-removal') {
  return {status:'removed',lastCheckStatus:'removed',lastCheckedAt:new Date(NOW).toISOString(),lastActiveAt:new Date(NOW-86400000).toISOString(),firstMissingAt:new Date(NOW-900000).toISOString(),lastMissingAt:new Date(NOW).toISOString(),missingCount:2,removedAt:new Date(NOW).toISOString(),removalEventId:eventId,lastEvidence:'İlan yayından kaldırılmıştır.',lastError:'',notificationStatus:'pending',notificationError:'',notifiedAt:null};
}
function harness(db,options={}) {
  const storage={},alarms=new Map(),tabs=new Map(),reads=[],sends=[];
  let now=NOW,busy=false,nextId=1,failQueue=false,engine;
  let respond=(request,tab)=>({ok:true,kind:'status',status:'removed',url:tab.url,listingId:Monitor.detail(tab.url).listingId,evidence:'Bu ilan yayından kaldırılmıştır.',checkedAt:new Date(now).toISOString()});
  const api={
    storage:{local:{get:async k=>({[k]:clone(storage[k])}),set:async data=>Object.assign(storage,clone(data))}},
    runtime:{sendMessage:async()=>{}},
    alarms:{create:async(name,value)=>alarms.set(name,clone(value)),clear:async name=>alarms.delete(name)},
    tabs:{get:async id=>{if(!tabs.has(id))throw Error('missing');return clone(tabs.get(id));},create:async args=>{const tab={id:nextId++,status:'complete',...args};tabs.set(tab.id,tab);return clone(tab);},update:async(id,args)=>{const tab=tabs.get(id);Object.assign(tab,args,{status:'loading'});return clone(tab);},sendMessage:async(id,request)=>{reads.push(clone(request));return respond(request,tabs.get(id));}},
    scripting:{executeScript:async()=>{}}
  };
  const fetch=async(url,options)=>{
    const method=url.split('/').at(-1),body=JSON.parse(options.body);let result;
    if(method==='getMe')result={id:123456789,is_bot:true,username:BOT};
    else if(method==='getChat')result={id:Number(CHAT),type:'supergroup',title:'Test Group'};
    else if(method==='getChatMember')result={status:'administrator',user:{id:123456789,is_bot:true}};
    else if(method==='sendMessage'){sends.push(body);result={message_id:sends.length,chat:{id:Number(CHAT)}};}
    else throw Error('Unexpected Telegram method');
    return {ok:true,status:200,json:async()=>({ok:true,result})};
  };
  const telegram=Telegram.createClient(api,db,{token:TOKEN,chatId:CHAT,expectedBotUsername:BOT},{fetch,now:()=>now});
  const queue={enqueueRemoval:async(r,id)=>{if(failQueue)throw Error('simulated outbox storage failure');return telegram.enqueueRemoval(r,id);}};
  const create=()=>Monitor.createEngine(api,core,db,queue,{now:()=>now,isCrawlerBusy:async()=>busy});
  engine=create();
  return {db,storage,alarms,tabs,reads,sends,telegram,get engine(){return engine;},setBusy(v){busy=v;},setQueueFailure(v){failQueue=v;},respond(fn){respond=fn;},advance(ms){now+=ms;},state(){return clone(storage[Monitor.KEY]);},async run(){return engine.handle({type:'ILAN_MONITOR_RUN'});},async loaded(){const tab=tabs.get(storage[Monitor.KEY].workTabId);tab.status='complete';await engine.onUpdated(tab.id,{status:'complete'});},async step(ms=16000){now+=ms;await engine.onAlarm({name:Monitor.STEP});},async restart(){engine=create();await engine.recover();},async flush(){await telegram.onAlarm({name:Telegram.ALARM});}};
}

test('monitor metadata survives normalization, actual DB upsert, category correction, delete and restore',async()=>{
  const db=database(),r=record('9101',{monitoring:confirmed('state-preservation')});
  assert.deepEqual(core.normalizeRecord(r).monitoring,r.monitoring);
  await db.upsertMany([r]);
  await db.upsertMany([record('9101',{price:7000000})]);
  let stored=await db.get(r.id);
  assert.deepEqual(stored.monitoring,r.monitoring);
  assert.equal(stored.price,7000000);
  await db.setCategory(r.id,'arsa');await db.setDeleted(r.id,true);await db.setDeleted(r.id,false);
  stored=await db.get(r.id);
  assert.deepEqual(stored.monitoring,r.monitoring);
  assert.equal(stored.deletedAt,null);
});

test('old imported monitoring cannot overwrite a more recent local sent state',async()=>{
  const db=database(),r=record('9102');await db.upsertMany([r]);
  await db.patchMonitoring(r.id,{...confirmed('local-event'),notificationStatus:'sent',notifiedAt:new Date(NOW).toISOString()});
  await db.upsertMany([record('9102',{monitoring:{status:'active',missingCount:0}})]);
  const stored=await db.get(r.id);
  assert.equal(stored.monitoring.status,'removed');
  assert.equal(stored.monitoring.removalEventId,'local-event');
  assert.equal(stored.monitoring.notificationStatus,'sent');
});

test('real DB and Telegram outbox produce one notification only after two spaced explicit observations',async()=>{
  const db=database(),r=record('9103');await db.upsertMany([r]);const h=harness(db);
  assert.equal((await h.run()).ok,true);await h.loaded();await h.step();
  assert.equal((await db.get(r.id)).monitoring.status,'suspected');await h.flush();assert.equal(h.sends.length,0);
  h.advance(15*60000);await h.run();await h.loaded();await h.step();await h.flush();
  let stored=await db.get(r.id);
  assert.equal(stored.monitoring.status,'removed');assert.equal(stored.monitoring.notificationStatus,'sent');assert.equal(h.sends.length,1);
  const eventId=stored.monitoring.removalEventId;
  await h.run();await h.loaded();await h.step();await h.restart();await h.flush();
  stored=await db.get(r.id);assert.equal(stored.monitoring.removalEventId,eventId);assert.equal(h.sends.length,1);
  assert.ok(h.sends[0].text.includes(r.url));assert.equal(String(h.sends[0].chat_id),CHAT);
});

test('outbox failure preserves confirmed event and restart reconciles same ID once',async()=>{
  const db=database(),r=record('9104',{monitoring:{status:'suspected',firstMissingAt:new Date(NOW-16*60000).toISOString(),lastMissingAt:new Date(NOW-16*60000).toISOString(),missingCount:1}});await db.upsertMany([r]);
  const h=harness(db);h.setQueueFailure(true);await h.run();await h.loaded();await h.step();
  let stored=await db.get(r.id);assert.equal(stored.monitoring.status,'removed');
  const eventId=stored.monitoring.removalEventId;assert.ok(eventId);assert.equal(h.sends.length,0);
  assert.equal(stored.monitoring.notificationStatus,'queue_error');
  h.setQueueFailure(false);await h.restart();await h.flush();
  stored=await db.get(r.id);assert.equal(stored.monitoring.removalEventId,eventId);assert.equal(stored.monitoring.notificationStatus,'sent');assert.equal(h.sends.length,1);
  await h.restart();await h.flush();assert.equal(h.sends.length,1);
});

test('monitor does not open or read tabs while crawler is busy, resumes safely afterward',async()=>{
  const db=database();await db.upsertMany([record('9105')]);const h=harness(db);h.setBusy(true);
  await h.run();assert.equal(h.state().phase,'waiting_crawler');assert.equal(h.tabs.size,0);assert.equal(h.reads.length,0);
  await h.step(31000);assert.equal(h.tabs.size,0);
  h.setBusy(false);await h.step(31000);assert.equal(h.tabs.size,1);await h.loaded();assert.equal(h.reads.length,1);
});

test('unknown observation interrupts unconfirmed removal streak and never notifies',async()=>{
  const db=database(),r=record('9106',{monitoring:{status:'suspected',firstMissingAt:new Date(NOW-16*60000).toISOString(),missingCount:1}});await db.upsertMany([r]);const h=harness(db);
  h.respond((request,tab)=>({ok:true,kind:'status',status:'unknown',url:tab.url,listingId:'9106',evidence:'Sayfa içeriği okunamadı.'}));
  await h.run();await h.loaded();await h.step();await h.flush();
  let stored=await db.get(r.id);assert.equal(stored.monitoring.status,'unknown');assert.equal(stored.monitoring.missingCount,0);assert.equal(h.sends.length,0);
  h.respond((request,tab)=>({ok:true,kind:'status',status:'removed',url:tab.url,listingId:'9106',evidence:'Bu ilan yayından kaldırılmıştır.'}));
  await h.run();await h.loaded();await h.step();await h.flush();
  stored=await db.get(r.id);assert.equal(stored.monitoring.status,'suspected');assert.equal(h.sends.length,0);
});

test('canonical DB records strip token/settings keys from top level and monitoring',async()=>{
  const db=database(),r={...record('9107'),token:TOKEN,telegram:{token:TOKEN},settings:{token:TOKEN},monitoring:{...confirmed(),token:TOKEN,config:{token:TOKEN}}};
  await db.upsertMany([r]);const stored=await db.get(r.id);
  assert.ok(!JSON.stringify(stored).includes(TOKEN));
  assert.equal(stored.monitoring.removalEventId,'test-removal');
});

test('downloaded JSON backup strips unexpected token/settings while keeping monitoring',async()=>{
  const blobs=[],context=vm.createContext({IlanCore:core,Blob,URL:{createObjectURL:blob=>{blobs.push(blob);return 'blob:test';},revokeObjectURL:()=>{}},document:{createElement:()=>({click(){},remove(){}}),body:{append(){}}},setTimeout:()=>0,module:{exports:{}}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..','transfer.js'),'utf8'),context);
  context.module.exports.exportBackup([{...record('9108',{monitoring:confirmed('backup-event')}),token:TOKEN,telegram:{token:TOKEN},settings:{token:TOKEN}}]);
  const text=await blobs[0].text();assert.ok(!text.includes(TOKEN));
  const data=JSON.parse(text);assert.equal(data.records[0].monitoring.removalEventId,'backup-event');assert.equal(data.records[0].phones[0],'905321112233');
});
