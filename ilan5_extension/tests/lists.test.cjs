'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const {IDBFactory} = require('fake-indexeddb');
const core = require('../core.js');

function raw(id, extra = {}) {
  return {url:`https://www.sahibinden.com/ilan/emlak-arsa-satilik-ornek-${id}/detay`,title:'Test arsa '+id,price:6000000,location:{city:'Ankara'},...extra};
}
function database() {
  const context=vm.createContext({IlanCore:core,indexedDB:new IDBFactory(),module:{exports:{}},console});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..','database.js'),'utf8'),context);
  return context.module.exports;
}

test('normalized records keep a clean, unique list of list ids',()=>{
  assert.deepEqual(core.normalizeRecord(raw(980001)).lists,[]);
  assert.deepEqual(core.normalizeRecord(raw(980001,{lists:[' list-a ','list-a','',null,'list-b']})).lists,['list-a','list-b']);
});

test('filterRecords scopes to the selected list; "all" shows every record',()=>{
  const records=[core.normalizeRecord(raw(980001,{lists:['list-a']})),core.normalizeRecord(raw(980002,{lists:['list-b']})),core.normalizeRecord(raw(980003))];
  assert.equal(core.filterRecords(records,{category:'all',list:'all'}).length,3);
  assert.deepEqual(core.filterRecords(records,{category:'all',list:'list-a'}).map(r=>r.listingId),['980001']);
  assert.deepEqual(core.filterRecords(records,{category:'all',list:'list-b'}).map(r=>r.listingId),['980002']);
});

test('crawl into a new list adds the label without dropping earlier lists or creating duplicates',async()=>{
  const db=database();
  await db.upsertMany([core.normalizeRecord(raw(980001)),core.normalizeRecord(raw(980002))],{origin:'crawl',listId:'list-old',baseline:true});
  // New list: one listing seen again, one brand new.
  const counts=await db.upsertMany([core.normalizeRecord(raw(980002)),core.normalizeRecord(raw(980003))],{origin:'crawl',listId:'list-new',baseline:true});
  assert.equal(counts.added,1);assert.equal(counts.updated,1);
  const all=await db.getAll(),byId=Object.fromEntries(all.map(r=>[r.listingId,r.lists]));
  assert.equal(all.length,3);
  assert.deepEqual(byId['980001'],['list-old']);
  assert.deepEqual(byId['980002'],['list-old','list-new']);
  assert.deepEqual(byId['980003'],['list-new']);
  assert.equal(core.filterRecords(all,{category:'all',list:'list-new'}).length,2);
  // Appending to the existing list again does not duplicate the label.
  await db.upsertMany([core.normalizeRecord(raw(980003))],{origin:'crawl',listId:'list-new',baseline:true});
  assert.deepEqual((await db.get('sahibinden:980003')).lists,['list-new']);
  // No list chosen keeps the old behaviour and leaves labels untouched.
  await db.upsertMany([core.normalizeRecord(raw(980001))],{origin:'crawl',baseline:true});
  assert.deepEqual((await db.get('sahibinden:980001')).lists,['list-old']);
});
