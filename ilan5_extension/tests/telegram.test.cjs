'use strict';

// All Telegram requests in this suite are fake; no network is used.
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../core.js');
global.IlanCore = core;
const {createClient, CONFIG_KEY, OUTBOX_KEY, ALARM} = require('../telegram.js');

const TOKEN = '123456789:TEST_TOKEN_NOT_REAL_abcdefghijklmnopqrstuvwxyz';
const CHAT = '-1001234567890';
const BOT = 'ilan5_test_bot';
const clone = x => x === undefined ? undefined : JSON.parse(JSON.stringify(x));

function sample(eventId = 'test-event-1') {
  return {...core.normalizeRecord({url:'https://www.sahibinden.com/ilan/emlak-arsa-satilik-test-9001/detay',title:'Test arsa',price:6000000,location:{city:'Ankara'},phones:['0532 111 22 33'],rawDetails:{'Arsa Tipi':'İmarlı Konut','Tapu Durumu':'Müstakil Parsel','Ada/Parsel No':'100/5'}}),monitoring:{status:'removed',removalEventId:eventId,missingCount:2,removedAt:'2026-09-25T09:00:00Z'}};
}

function harness(extra = {}) {
  const state = clone(extra.state || {}), calls = [], alarms = new Map(), patches = [];
  let now = Date.parse('2026-09-25T09:00:00Z'), client, record=sample();
  let responder = (method, body) => {
    if(method === 'getMe') return {ok:true,result:{id:123456789,is_bot:true,username:BOT,first_name:'Test Bot'}};
    if(method === 'getChat') return {ok:true,result:{id:Number(CHAT),type:'supergroup',title:'Test Group'}};
    if(method === 'getChatMember') return {ok:true,result:{status:'administrator',user:{id:123456789,is_bot:true,username:BOT},can_post_messages:true,can_send_messages:true}};
    if(method === 'sendMessage') return {ok:true,result:{message_id:calls.filter(x=>x.method==='sendMessage').length,chat:{id:Number(CHAT)}}};
    throw Error('Unexpected method '+method);
  };
  const api = {
    storage:{local:{
      get:async keys => {if(keys === null || keys === undefined)return clone(state);if(typeof keys==='string')return {[keys]:clone(state[keys])};return Object.fromEntries(keys.map(k=>[k,clone(state[k])]));},
      set:async value => Object.assign(state,clone(value)),
      remove:async key => {for(const k of [].concat(key))delete state[k];}
    }},
    alarms:{create:async(name,options)=>alarms.set(name,clone(options)),clear:async name=>alarms.delete(name)},
    runtime:{sendMessage:async()=>{}}
  };
  const db = {get:async()=>clone(record),patchMonitoring:async(id,patch)=>{patches.push({id,patch:clone(patch)});record={...record,monitoring:{...record.monitoring,...patch}};return clone(record);}};
  const fetch = async (url, options={}) => {
    const method = String(url).split('/').at(-1);
    let body = {};
    if(options.body)body=typeof options.body==='string'?JSON.parse(options.body):Object.fromEntries(options.body);
    calls.push({method,body});
    const response = await responder(method,body);
    return {ok:response.ok,status:response.ok?200:response.error_code||400,json:async()=>response,text:async()=>JSON.stringify(response)};
  };
  const create = () => createClient(api,db,{token:TOKEN,chatId:CHAT,expectedBotUsername:BOT},{fetch,now:()=>now});
  client = create();
  return {state,calls,alarms,patches,api,db,get client(){return client;},setRecord(value){record=clone(value);},async enqueue(eventId){record=sample(eventId);return client.enqueueRemoval(record,eventId);},respond(fn){responder=fn;},advance(ms){now+=ms;},async restart(){client=create();await client.recover();},async flush(){await client.onAlarm({name:ALARM});},async configure(){return client.handle({type:'ILAN_TELEGRAM_CONFIG',enabled:true,token:TOKEN,chatId:CHAT,expectedBotUsername:BOT});}};
}

test('Telegram status and CONFIG response never reveal token',async()=>{
  const h=harness();
  const configured=await h.configure();
  const status=await h.client.handle({type:'ILAN_TELEGRAM_STATUS'});
  assert.equal(configured.ok,true);
  assert.equal(status.ok,true);
  assert.ok(!JSON.stringify(configured).includes(TOKEN));
  assert.ok(!JSON.stringify(status).includes(TOKEN));
});

test('recipient verification checks expected bot and exact group before sending',async()=>{
  const h=harness();await h.configure();
  const verified=await h.client.handle({type:'ILAN_TELEGRAM_VERIFY'});
  assert.equal(verified.ok,true);
  const before=h.calls.length;
  await h.enqueue('test-event-1');await h.flush();
  const methods=h.calls.map(x=>x.method);
  assert.ok(methods.includes('getMe'));
  assert.ok(methods.includes('getChat'));
  assert.ok(methods.includes('getChatMember'));
  const sends=h.calls.filter(x=>x.method==='sendMessage');
  assert.equal(sends.length,1);
  assert.equal(String(sends[0].body.chat_id),CHAT);
  assert.ok(h.calls.length>before);
});

test('same removal event is sent once across duplicate enqueue and worker restart',async()=>{
  const h=harness();await h.configure();
  await h.enqueue('test-event-2');
  await h.enqueue('test-event-2');
  await h.flush();await h.restart();
  await h.enqueue('test-event-2');await h.flush();
  assert.equal(h.calls.filter(x=>x.method==='sendMessage').length,1);
});

test('network failure after send becomes uncertain and is never auto retried',async()=>{
  const h=harness();await h.configure();
  h.respond((method)=>{
    if(method==='getMe')return {ok:true,result:{id:123456789,is_bot:true,username:BOT}};
    if(method==='getChat')return {ok:true,result:{id:Number(CHAT),type:'supergroup',title:'Test Group'}};
    if(method==='getChatMember')return {ok:true,result:{status:'administrator',user:{id:123456789,is_bot:true}}};
    if(method==='sendMessage')throw Error('simulated response loss');
  });
  await h.enqueue('test-event-3');await h.flush();
  await h.restart();h.advance(24*60*60*1000);await h.flush();
  assert.equal(h.calls.filter(x=>x.method==='sendMessage').length,1);
  assert.ok(JSON.stringify(h.state[OUTBOX_KEY]).includes('uncertain'));
});

test('verification rejects a different bot without sending',async()=>{
  const h=harness();await h.configure();
  h.respond(method=>({ok:true,result:method==='getMe'?{id:888,is_bot:true,username:'wrong_bot'}:{id:Number(CHAT),type:'supergroup'}}));
  const verified=await h.client.handle({type:'ILAN_TELEGRAM_VERIFY'});
  assert.equal(verified.ok,false);
  await h.enqueue('test-event-4');await h.flush();
  assert.equal(h.calls.filter(x=>x.method==='sendMessage').length,0);
});

test('verification rejects a different chat ID without sending',async()=>{
  const h=harness();await h.configure();
  h.respond(method=>({ok:true,result:method==='getMe'?{id:123456789,is_bot:true,username:BOT}:{id:-100999,type:'supergroup',title:'Wrong Group'}}));
  const verified=await h.client.handle({type:'ILAN_TELEGRAM_VERIFY'});
  assert.equal(verified.ok,false);
  await h.enqueue('test-event-5');await h.flush();
  assert.equal(h.calls.filter(x=>x.method==='sendMessage').length,0);
});

test('interrupted sending reservation becomes uncertain after restart without resend',async()=>{
  const h=harness();await h.configure();await h.enqueue('crash-event');
  h.state[OUTBOX_KEY][0].status='sending';
  await h.restart();await h.flush();
  assert.equal(h.state[OUTBOX_KEY][0].status,'uncertain');
  assert.equal(h.calls.filter(x=>x.method==='sendMessage').length,0);
});

test('HTTP 429 obeys retry_after and sends only once after the delay',async()=>{
  const h=harness();await h.configure();await h.client.handle({type:'ILAN_TELEGRAM_VERIFY'});
  let attempts=0;
  h.respond(method=>{assert.equal(method,'sendMessage');attempts++;return attempts===1?{ok:false,error_code:429,parameters:{retry_after:20}}:{ok:true,result:{message_id:456,chat:{id:Number(CHAT)}}};});
  await h.enqueue('rate-limited-event');await h.flush();
  assert.equal(h.state[OUTBOX_KEY][0].status,'queued');
  await h.flush();h.advance(19000);await h.flush();
  assert.equal(attempts,1);
  h.advance(3000);await h.flush();
  assert.equal(attempts,2);
  assert.equal(h.state[OUTBOX_KEY][0].status,'sent');
});

test('newly active listing cancels stale removal notification before Telegram request',async()=>{
  const h=harness();await h.configure();await h.enqueue('reactivated-event');
  h.setRecord({...sample('reactivated-event'),monitoring:{status:'active'}});await h.flush();
  assert.equal(h.calls.filter(x=>x.method==='sendMessage').length,0);
  assert.equal(h.state[OUTBOX_KEY][0].status,'cancelled');
});

test('trashed listing cancels pending removal notification',async()=>{
  const h=harness();await h.configure();await h.enqueue('trash-event');
  h.setRecord({...sample('trash-event'),deletedAt:'2026-09-25T09:01:00Z'});await h.flush();
  assert.equal(h.calls.filter(x=>x.method==='sendMessage').length,0);
  assert.equal(h.state[OUTBOX_KEY][0].status,'cancelled');
});

test('changing configured group never redirects an existing queued message',async()=>{
  const h=harness();await h.configure();await h.enqueue('group-changed-event');
  await h.client.handle({type:'ILAN_TELEGRAM_CONFIG',chatId:'-1009876543210'});await h.flush();
  assert.equal(h.calls.filter(x=>x.method==='sendMessage').length,0);
  assert.equal(h.state[OUTBOX_KEY][0].status,'failed');
});

test('one explicit disappearance or unknown state cannot create notification',async()=>{
  const h=harness();await h.configure();
  for(const monitoring of [{status:'removed',missingCount:1,removalEventId:'guard-event'},{status:'unknown',missingCount:2,removalEventId:'guard-event'}]) {
    await assert.rejects(h.client.enqueueRemoval({...sample('guard-event'),monitoring},'guard-event'),/doğrulanmadan/);
  }
  assert.equal((h.state[OUTBOX_KEY]||[]).length,0);
});

test('missing confirmation count cannot create notification',async()=>{
  const h=harness();await h.configure();
  await assert.rejects(h.client.enqueueRemoval({...sample('no-count-event'),monitoring:{status:'removed',removalEventId:'no-count-event'}},'no-count-event'),/doğrulanmadan/);
});

test('sending reservation exists durably before the send HTTP request',async()=>{
  const h=harness();await h.configure();await h.client.handle({type:'ILAN_TELEGRAM_VERIFY'});
  h.respond(method=>{
    assert.equal(method,'sendMessage');
    assert.equal(h.state[OUTBOX_KEY][0].status,'sending');
    return {ok:true,result:{message_id:456,chat:{id:Number(CHAT)}}};
  });
  await h.enqueue('reservation-event');await h.flush();
  assert.equal(h.state[OUTBOX_KEY][0].status,'sent');
});

test('misdirected send acknowledgement becomes uncertain and does not retry',async()=>{
  const h=harness();await h.configure();await h.client.handle({type:'ILAN_TELEGRAM_VERIFY'});
  h.respond(()=>({ok:true,result:{message_id:123,chat:{id:-10099999999}}}));
  await h.enqueue('wrong-ack-event');await h.flush();await h.flush();
  assert.equal(h.state[OUTBOX_KEY][0].status,'uncertain');
  assert.equal(h.calls.filter(x=>x.method==='sendMessage').length,1);
});
