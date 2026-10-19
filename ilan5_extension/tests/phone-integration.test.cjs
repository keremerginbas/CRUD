'use strict';

// Screenshot-shaped DOM, visible CSS pseudo text, fake contacts only. No network.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {JSDOM}=require('/workspace/scratch/7830fb02ac8e/test_runtime/node_modules/jsdom');
const {IDBFactory}=require('/workspace/scratch/7830fb02ac8e/test_runtime/node_modules/fake-indexeddb');
const core=require('../core.js');
global.IlanCore=core;
global.XLSX=require('../vendor/xlsx.full.min.js');
const transfer=require('../transfer.js');
const PHONE='905551112233',HIDDEN_PHONE='905559998877';
const URL='https://www.sahibinden.com/ilan/emlak-arsa-satilik-test-980001/detay';

function fixture(visiblePhone='0 (555) 111 22 33') {
  const d=new JSDOM(`<style>.hidden-phone{display:none}</style><main>
    <ul class="breadcrumb"><li>Emlak</li><li>Arsa</li></ul><div class="classifiedDetailTitle"><h1>Örnek imarlı arsa</h1></div>
    <div class="classifiedInfo"><h3>6.000.000 TL</h3><h2><a>Ankara</a><a>Çankaya</a><a>Örnek Mah.</a></h2></div>
    <table><tr><th>İlan No</th><td>980001</td></tr><tr><th>Arsa Tipi</th><td>İmarlı Konut</td></tr><tr><th>Metrekare</th><td>1.000 m²</td></tr><tr><th>Tapu Durumu</th><td>Müstakil Parsel</td></tr><tr><th>Ada/Parsel No</th><td>100 / 5</td></tr></table>
    <div id="classifiedDescription">Örnek ilan açıklaması.</div>
    <aside class="classifiedUserBox"><div class="username-info-area"><h5>Örnek Satıcı</h5></div>
      <div id="phoneInfoPart" class="userContactInfo"><ul><li><span>Cep</span>
        <span class="pretty-phone-part hidden-phone"><span id="hidden-phone" data-content="0 (555) 999 88 77">encrypted-value</span></span>
        <span class="pretty-phone-part show-part"><span id="visible-phone" data-content="${visiblePhone}"></span></span>
      </li></ul></div>
    </aside>
    <script type="application/ld+json">{"telephone":"${HIDDEN_PHONE}"}</script>
  </main><footer><span>0 (555) 999 88 77</span></footer>`,{url:URL,runScripts:'outside-only'});
  const w=d.window,baseStyle=w.getComputedStyle.bind(w);
  function shown(el) {
    for(let node=el;node;node=node.parentElement)if(node.hidden||node.getAttribute('aria-hidden')==='true'||baseStyle(node).display==='none'||baseStyle(node).visibility==='hidden')return false;
    return true;
  }
  Object.defineProperty(w.HTMLElement.prototype,'getClientRects',{value(){return shown(this)?[1]:[];}});
  Object.defineProperty(w.HTMLElement.prototype,'innerText',{get(){if(!shown(this))return '';return [...this.childNodes].map(n=>n.nodeType===3?n.textContent:n.innerText||'').join(['SPAN','A','BUTTON','STRONG'].includes(this.tagName)?'':'\n').trim();}});
  w.getComputedStyle=(el,pseudo)=>{
    const style=baseStyle(el);
    if(!pseudo)return style;
    const content=pseudo==='::before'&&['visible-phone','hidden-phone'].includes(el.id)?'attr(data-content)':'none';
    return new Proxy(style,{get(target,key){if(key==='content')return content;if(key==='getPropertyValue')return name=>name==='content'?content:target.getPropertyValue(name);const value=target[key];return typeof value==='function'?value.bind(target):value;}});
  };
  w.eval(fs.readFileSync(path.join(__dirname,'..','extractor.js'),'utf8'));
  return {w,extract:()=>w.IlanExtractor.extractListing({expectedUrl:URL,revealPhone:false})};
}
function database(){const context=vm.createContext({IlanCore:core,indexedDB:new IDBFactory(),module:{exports:{}},console});vm.runInContext(fs.readFileSync(path.join(__dirname,'..','database.js'),'utf8'),context);return context.module.exports;}

test('CSS-painted phone without reveal button survives extract → core → IndexedDB → XLSX and import',async()=>{
  const f=fixture();
  try {
    assert.equal(f.w.document.querySelector('button'),null);
    assert.equal(f.w.document.querySelector('#visible-phone').textContent,'');
    const extracted=await f.extract();assert.equal(extracted.ok,true);
    assert.deepEqual(Array.from(extracted.record.phones),[PHONE]);
    assert.equal(extracted.record.sellerName,'Örnek Satıcı');
    const normalized=core.normalizeRecord(extracted.record);assert.deepEqual(normalized.phones,[PHONE]);assert.ok(!normalized.quality.missing.includes('Telefon'));
    const db=database();await db.upsertMany([normalized],{origin:'crawl',baseline:true});const stored=await db.get(normalized.id);
    assert.deepEqual(stored.phones,[PHONE]);assert.ok(!stored.phones.includes(HIDDEN_PHONE));
    const wb=transfer.workbookFor([stored]);const rows=global.XLSX.utils.sheet_to_json(wb.Sheets['İlanlar']);assert.equal(rows[0]['Telefon (90)'],PHONE);
    const bytes=global.XLSX.write(wb,{type:'buffer',bookType:'xlsx'});
    const imported=await transfer.importFile({name:'phone.xlsx',size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)});
    assert.deepEqual(imported[0].phones,[PHONE]);assert.ok(!imported[0].quality.missing.includes('Telefon'));
  } finally {f.w.close();}
});

test('fresh successful rescan naturally clears prior Telefon missing state without keeping stale warnings',async()=>{
  const f=fixture(),db=database();
  try {
    const observed=await f.extract();assert.equal(observed.ok,true);
    const earlier=core.normalizeRecord({...observed.record,phones:[],missing:['Telefon'],phoneStatus:'Görünür telefon düğmesi bulunamadı'});
    assert.ok(earlier.quality.missing.includes('Telefon'));await db.upsertMany([earlier]);
    await db.upsertMany([observed.record],{origin:'crawl',baseline:true,runId:'phone-now-visible'});
    const stored=await db.get(earlier.id);assert.deepEqual(stored.phones,[PHONE]);assert.ok(!stored.quality.missing.includes('Telefon'));
    assert.ok(!stored.quality.warnings.some(w=>w.includes('son arşiv değerleri korundu')&&w.includes('Telefon')));
    assert.equal((await db.getEvents({limit:0})).length,0);
  } finally {f.w.close();}
});

test('masked visible number never uses hidden sibling; retained old phone remains explicitly missing/stale',async()=>{
  const visible=fixture(),masked=fixture('0 (5**) *** ** **'),db=database();
  try {
    const known=await visible.extract(),unavailable=await masked.extract();assert.equal(known.ok,true);assert.equal(unavailable.ok,true);
    assert.deepEqual(Array.from(unavailable.record.phones),[]);assert.ok(unavailable.record.missing.includes('Telefon'));
    const normalized=core.normalizeRecord(known.record);await db.upsertMany([normalized]);
    await db.upsertMany([unavailable.record],{origin:'crawl',baseline:true,runId:'phone-masked'});
    const retained=await db.get(normalized.id);assert.deepEqual(retained.phones,[PHONE]);assert.ok(retained.quality.missing.includes('Telefon'));assert.equal(retained.quality.status,'missing');
    assert.ok(retained.quality.warnings.some(w=>w.includes('son arşiv değerleri korundu')&&w.includes('Telefon')));
    const roundTrip=core.normalizeRecord(retained);assert.ok(roundTrip.quality.missing.includes('Telefon'));assert.equal(roundTrip.quality.status,'missing');
    assert.ok(roundTrip.quality.warnings.some(w=>w.includes('son arşiv değerleri korundu')&&w.includes('Telefon')));
  } finally {visible.w.close();masked.w.close();}
});
