'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../core.js');
const Search = require('../searches.js');
const URL1='https://www.sahibinden.com/satilik-arsa/ankara?price_min=5000000';
const URL2='https://www.hepsiemlak.com/ankara-satilik-sahibinden?p31=5000000&subCategories=imarli-konut';
const clone=x=>x===undefined?undefined:JSON.parse(JSON.stringify(x));

function harness(initial={}) {
  const state=clone(initial),alarms=new Map(),starts=[];
  let now=Date.parse('2026-09-25T09:00:00Z'),job=null,canStart=true,scheduler,startResult;
  const api={storage:{local:{get:async key=>({[key]:clone(state[key])}),set:async data=>Object.assign(state,clone(data))}},alarms:{create:async(name,value)=>alarms.set(name,clone(value)),clear:async name=>alarms.delete(name)}};
  const callbacks={getJob:async()=>clone(job),canStart:async()=>canStart,startSearch:async payload=>{starts.push(clone(payload));if(startResult){const result=await startResult(payload);if(result?.job)job=clone(result.job);return result;}job={id:'job-'+starts.length,searchId:payload.searchId,status:'running',listComplete:false,counts:{errors:0}};return {ok:true,job:clone(job)};}};
  const create=()=>Search.createScheduler(api,core,callbacks,{now:()=>now});scheduler=create();
  return {state,alarms,starts,get scheduler(){return scheduler;},get job(){return job;},setJob(value){job=value;},setCanStart(value){canStart=value;},startWith(fn){startResult=fn;},advance(ms){now+=ms;},async save(extra={}){return scheduler.handle({type:'ILAN_SEARCH_SAVE',searchUrl:URL1,name:'Ankara Arsa',category:'arsa',intervalMinutes:60,delayMs:4000,enabled:true,...extra});},async finish(extra={}){job={...job,status:'completed',listComplete:true,listIncomplete:false,limited:false,completedAt:new Date(now).toISOString(),...extra};return scheduler.reconcileJob(job);},async tick(){await scheduler.onAlarm({name:Search.ALARM});},async restart(){scheduler=create();await scheduler.recover();},async items(){return (await scheduler.handle({type:'ILAN_SEARCH_STATUS'})).searches;}};
}

test('search URL normalization preserves filters and removes only page/tracking parameters',()=>{
  const canonical=Search.searchUrl('http://sahibinden.com/satilik-arsa/ankara?price_min=5000000&page=4&utm_source=x&pagingOffset=60#top');
  assert.equal(canonical,URL1);
  assert.equal(Search.searchUrl(URL2+'&p=6&fbclid=test'),URL2);
  for(const bad of ['https://evil.invalid/','https://www.sahibinden.com.evil.invalid/','https://user:pass@www.sahibinden.com/satilik-arsa','https://www.sahibinden.com/ilan/emlak-arsa-test-123/detay','https://www.hepsiemlak.com/ankara-satilik/imarli-konut/0-123'])assert.throws(()=>Search.searchUrl(bad));
});

test('same canonical search/category updates one saved item and starts baseline first',async()=>{
  const h=harness();let first=await h.save();assert.equal(first.ok,true);
  const same=await h.save({searchUrl:URL1+'&page=4&utm_source=x',name:'Yeni isim'});
  assert.equal(same.search.id,first.search.id);assert.equal(same.searches.length,1);
  const run=await h.scheduler.handle({type:'ILAN_SEARCH_RUN',id:first.search.id});assert.equal(run.ok,true);
  assert.equal(h.starts.length,1);assert.equal(h.starts[0].baseline,true);assert.equal(h.starts[0].maxListings,0);assert.equal(h.starts[0].maxPages,0);assert.equal(h.starts[0].searchId,first.search.id);
});

test('completed unrestricted first scan establishes baseline and later scan compares changes',async()=>{
  const h=harness(),saved=await h.save();await h.scheduler.handle({type:'ILAN_SEARCH_RUN',id:saved.search.id});await h.finish();
  let [item]=await h.items();assert.equal(item.hasBaseline,true);assert.equal(item.lastStatus,'completed');
  h.advance(60*60000+1);await h.tick();assert.equal(h.starts.length,2);assert.equal(h.starts[1].baseline,false);
});

test('intentional capped or failed first scan never claims completed baseline',async()=>{
  for(const completion of [{status:'incomplete',limited:true},{status:'incomplete',listIncomplete:true},{status:'completed',listComplete:true,counts:{errors:1}},{status:'stopped'}]) {
    const h=harness(),saved=await h.save();await h.scheduler.handle({type:'ILAN_SEARCH_RUN',id:saved.search.id});await h.finish(completion);
    const [item]=await h.items();assert.equal(item.hasBaseline,false,JSON.stringify(completion));
    await h.scheduler.handle({type:'ILAN_SEARCH_RUN',id:saved.search.id});assert.equal(h.starts[1].baseline,true);
  }
});

test('manual run limits are one-run only; scheduled later run is unlimited',async()=>{
  const h=harness(),saved=await h.save();
  const result=await h.scheduler.handle({type:'ILAN_SEARCH_RUN',id:saved.search.id,maxListings:50,maxPages:5});assert.equal(result.ok,true);
  assert.equal(h.starts[0].maxListings,50);assert.equal(h.starts[0].maxPages,5);
  await h.finish({status:'incomplete',limited:true});h.advance(60*60000+1);await h.tick();
  assert.equal(h.starts[1].maxListings,0);assert.equal(h.starts[1].maxPages,0);
});

test('scheduler serializes due searches and never overlaps an existing crawl',async()=>{
  const h=harness();await h.save();await h.save({searchUrl:URL2,name:'Hepsi Arsa'});
  await h.tick();await h.tick();assert.equal(h.starts.length,1);
  const pending=(await h.items()).filter(item=>item.id!==h.job.searchId)[0];assert.equal(pending.lastStatus,'waiting');
  await h.finish();h.advance(60001);await h.tick();assert.equal(h.starts.length,2);
});

test('monitor or paused crawler prevents scheduled start without losing saved search',async()=>{
  const h=harness();await h.save();h.setCanStart(false);await h.tick();assert.equal(h.starts.length,0);
  assert.equal((await h.items())[0].lastStatus,'waiting');
  h.setCanStart(true);h.setJob({id:'unrelated',status:'paused'});h.advance(60001);await h.tick();assert.equal(h.starts.length,0);
  h.setJob({id:'unrelated',status:'stopped'});h.advance(60001);await h.tick();assert.equal(h.starts.length,1);
});

test('worker restart recognizes durable running search without duplicate start',async()=>{
  const h=harness(),saved=await h.save();await h.scheduler.handle({type:'ILAN_SEARCH_RUN',id:saved.search.id});await h.restart();
  assert.equal(h.starts.length,1);assert.equal((await h.items())[0].activeJobId,h.job.id);
});

test('interrupted saved start with no matching crawler job recovers baseline without duplicate events',async()=>{
  const h=harness(),saved=await h.save();await h.scheduler.handle({type:'ILAN_SEARCH_RUN',id:saved.search.id});
  h.setJob(null);await h.restart();assert.equal(h.starts.length,2);assert.equal(h.starts[1].baseline,true);
});

test('disabled search stays disabled after restart and cannot auto-start',async()=>{
  const h=harness(),saved=await h.save();await h.scheduler.handle({type:'ILAN_SEARCH_TOGGLE',id:saved.search.id,enabled:false});
  h.advance(24*60*60000);await h.restart();await h.tick();assert.equal(h.starts.length,0);assert.equal((await h.items())[0].enabled,false);
  assert.equal(h.alarms.has(Search.ALARM),false);
});

test('active saved search cannot be removed until crawl stops',async()=>{
  const h=harness(),saved=await h.save();await h.scheduler.handle({type:'ILAN_SEARCH_RUN',id:saved.search.id});
  assert.equal((await h.scheduler.handle({type:'ILAN_SEARCH_REMOVE',id:saved.search.id})).ok,false);
  await h.finish({status:'stopped'});assert.equal((await h.scheduler.handle({type:'ILAN_SEARCH_REMOVE',id:saved.search.id})).ok,true);assert.equal((await h.items()).length,0);
});

test('start rejection is visible and rescheduled without establishing baseline',async()=>{
  const h=harness(),saved=await h.save();h.startWith(async()=>({ok:false,error:'Synthetic start rejection'}));
  const response=await h.scheduler.handle({type:'ILAN_SEARCH_RUN',id:saved.search.id});assert.equal(response.ok,false);
  const [item]=await h.items();assert.equal(item.lastStatus,'error');assert.equal(item.hasBaseline,false);assert.ok(item.nextRunAt);
});

test('thrown start failure is visible and rescheduled without requiring worker restart',async()=>{
  const h=harness(),saved=await h.save();h.startWith(async()=>{throw Error('Synthetic storage failure');});
  const response=await h.scheduler.handle({type:'ILAN_SEARCH_RUN',id:saved.search.id});assert.equal(response.ok,false);
  const [item]=await h.items();assert.equal(item.lastStatus,'error');assert.ok(item.nextRunAt);
});
