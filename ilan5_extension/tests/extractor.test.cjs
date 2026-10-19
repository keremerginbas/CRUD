const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {JSDOM} = require('../../test_runtime/node_modules/jsdom');
const script = fs.readFileSync(path.join(__dirname, '../extractor.js'), 'utf8');
let passed = 0;
function dom(html, url) {
  const d = new JSDOM(html, {url, runScripts:'outside-only'}), w = d.window;
  const nativeStyle=w.getComputedStyle.bind(w),pseudoStyles=new WeakMap();
  w.getComputedStyle=(el,pseudo)=>pseudo?{content:'none',display:'inline',visibility:'visible',opacity:'1',fontSize:'16px',color:'rgb(0, 0, 0)',...(pseudoStyles.get(el)?.[pseudo]||{})}:nativeStyle(el);
  function setPseudo(selector,pseudo,style){const el=w.document.querySelector(selector);const values=pseudoStyles.get(el)||{};values[pseudo]=style;pseudoStyles.set(el,values);}
  function shown(el) {
    for (let p = el; p; p = p.parentElement) {
      if (p.hidden || p.getAttribute('aria-hidden') === 'true' || p.style.display === 'none' || p.style.visibility === 'hidden') return false;
    }
    return true;
  }
  Object.defineProperty(w.HTMLElement.prototype, 'getClientRects', {value(){ return shown(this) ? [1] : []; }});
  Object.defineProperty(w.HTMLElement.prototype, 'innerText', {get(){
    if (!shown(this)) return '';
    return [...this.childNodes].map(n => n.nodeType === 3 ? n.textContent : n.innerText || '').join(['SPAN','A','BUTTON','STRONG'].includes(this.tagName) ? '' : '\n').trim();
  }});
  w.eval(script);
  return {d,w,x:w.IlanExtractor,setPseudo};
}
const rows = pairs => pairs.map(([k,v])=>`<tr><th>${k}</th><td>${v}</td></tr>`).join('');
const seller = `<aside class="seller"><h2>İlan Sahibi Örneği</h2><p>Sahibinden İlan</p><button id="show">Telefonu Göster</button><div id="phones" hidden><a href="tel:05550000001">0 (555) 000 00 01</a><a href="tel:03120000002">0 (312) 000 00 02</a></div></aside>`;
async function check(name,fn){ await fn(); passed++; console.log('PASS',name); }
(async()=>{
  await check('Arsa taxonomy, visible details, price/area and right-card phone reveal',async()=>{
    const {w,x}=dom(`<main><nav class="breadcrumb"><a>Emlak</a><a>Arsa</a></nav><h1>Araba takasına uygun örnek ilan</h1><div class="price">8.250.000 TL</div><div class="location">Ankara / Bala / Beynam Mah.</div><table>${rows([['İlan No','0-100'],['Arsa Tipi','İmarlı - Konut'],['Metrekare','1.500 m2'],['Metrekare Birim Fiyatı','5.500 TL'],['Ada / Parsel No','10 / 2'],['Yeni Detay','Aynen korunur']])}</table><section id="ilanAciklamasi">Otomobil kelimesi açıklamada geçebilir.<p>İkinci paragraf.</p></section>${seller}</main><footer><a href="tel:08550000003">0855 000 00 03</a></footer>`, 'https://www.hepsiemlak.com/ankara-bala-satilik/imarli-konut/0-100');
    let clicks=0; w.document.querySelector('#show').onclick=()=>{clicks++;w.document.querySelector('#phones').hidden=false;};
    const result=await x.extractListing({revealPhone:true});
    assert.equal(result.ok,true); const r=result.record;
    assert.equal(r.category,'arsa'); assert.equal(r.price,8250000);assert.equal(r.area,1500);
    assert.equal(r.rawDetails['Yeni Detay'],'Aynen korunur');assert.equal(r.location.district,'Bala');
    assert.deepEqual(Array.from(r.phones),['905550000001','903120000002']);assert.equal(clicks,1);
    assert.ok(r.description.includes('İkinci paragraf.'));assert.ok(!r.categoryEvidence.some(e=>e.category==='arac'));
    w.close();
  });
  await check('Hidden/JSON/footer contacts and masked tel href never become seller phone',async()=>{
    const {w,x}=dom(`<main><h1>Örnek arsa</h1><table>${rows([['İlan No','0-101'],['Arsa Tipi','Tarla']])}</table><aside class="seller"><h2>Satıcı Adı</h2><a href="tel:05550000001">0 (5**) *** ** **</a><div hidden>0533 111 22 33</div></aside></main><footer>0850 000 00 01</footer><script type="application/ld+json">{"telephone":"05559999999"}</script>`, 'https://www.hepsiemlak.com/ankara-satilik/tarla/0-101');
    const {record}=await x.extractListing({revealPhone:false});assert.equal(record.phones.length,0);assert.equal(record.category,'arsa');w.close();
  });
  await check('Sahibinden car fields remain car even with arsa in description',async()=>{
    const {w,x}=dom(`<main><ul class="breadcrumb"><li>Vasıta</li><li>Otomobil</li></ul><div class="classifiedDetailTitle"><h1>Örnek araç</h1></div><div class="classifiedInfo"><h3>1.250.000 TL</h3><h2><a>Ankara</a><a>Çankaya</a><a>Örnek Mah.</a></h2><ul class="classifiedInfoList"><li><strong>İlan No</strong><span>123456</span></li><li><strong>Marka</strong><span>Örnek</span></li><li><strong>Model</strong><span>Araç</span></li><li><strong>KM</strong><span>95.000</span></li></ul></div><div id="classifiedDescription">Arsa ile takas olur.</div><div class="classifiedUserBox"><div class="username-info-area"><h5>Örnek Satıcı</h5></div><div class="user-info-phones">0 (555) 000 00 04</div></div></main>`, 'https://www.sahibinden.com/ilan/vasita-otomobil-ornek-123456/detay');
    const {record}=await x.extractListing({revealPhone:false});assert.equal(record.category,'arac');assert.equal(record.rawDetails.KM,'95.000');assert.equal(record.sellerName,'Örnek Satıcı');assert.equal(record.price,1250000);assert.equal(record.location.city,'Ankara');assert.equal(record.phones[0],'905550000004');w.close();
  });
  const nameURL='https://www.sahibinden.com/ilan/vasita-otomobil-ornek-123456/detay';
  const nameInfo=`<h1>Örnek araç</h1><table>${rows([['İlan No','123456'],['Marka','Örnek']])}</table>`;
  await check('No reveal button: visible CSS name supports nested order, escaped strings and attr()',async()=>{
    const {w,x,setPseudo}=dom(`<main>${nameInfo}<aside class="classifiedUserBox"><div class="username-info-area"><h5 id="name"><span id="first"></span> <span id="last" data-last="Artukoğlu"></span></h5></div></aside></main>`,nameURL);
    setPseudo('#name','::before',{content:'"Dr. "'});setPseudo('#first','::before',{content:'"\\45 rdal"'});setPseudo('#last','::before',{content:'attr(data-last)'});
    const {record}=await x.extractListing({revealPhone:true});assert.equal(record.sellerName,'Dr. Erdal Artukoğlu');assert.equal(record.phones.length,0);assert.ok(record.phoneStatus.includes('bulunamadı'));w.close();
  });
  await check('Plain inline spans in the username area and root username/store-name are read',async()=>{
    for(const [card,expected] of [[`<aside class="classifiedUserBox"><div class="username-info-area"><span>Ayşe</span><span> Yılmaz</span></div></aside>`,'Ayşe Yılmaz'],['<aside class="username">Ali Can</aside>','Ali Can'],['<aside class="store-name">XRE Gayrimenkul</aside>','XRE Gayrimenkul']]){
      const {w,x}=dom(`<main>${nameInfo}${card}</main>`,nameURL);assert.equal((await x.extractListing()).record.sellerName,expected);w.close();
    }
  });
  await check('Non-name heading is skipped and the later actual name candidate is read',async()=>{
    const {w,x}=dom(`<main>${nameInfo}<aside class="classifiedUserBox"><h2>İletişim</h2><h3>Selin Aksoy</h3></aside></main>`,nameURL);assert.equal((await x.extractListing()).record.sellerName,'Selin Aksoy');w.close();
  });
  await check('Initial name survives a narrower phone scope and removed name node after reveal',async()=>{
    const {w,x}=dom(`<main>${nameInfo}<aside class="classifiedUserBox"><div id="name-area" class="username-info-area"><h5>Deniz Kaya</h5></div><div class="contact-card"><button id="show-name-case">Telefonu Göster</button><div id="phone-name-case" hidden>0555 111 22 33</div></div></aside></main>`,nameURL);
    w.document.querySelector('#show-name-case').onclick=()=>{w.document.querySelector('#name-area').remove();w.document.querySelector('#phone-name-case').hidden=false;};
    const {record}=await x.extractListing({revealPhone:true});assert.equal(record.sellerName,'Deniz Kaya');assert.equal(record.phones[0],'905551112233');w.close();
  });
  await check('Hidden, footer, recommendation, masked names and unrelated full-name attributes are not read',async()=>{
    const {w,x,setPseudo}=dom(`<main>${nameInfo}<aside class="classifiedUserBox"><h5 hidden>Gizli Tam İsim</h5><h5 class="username" data-name="Saklı Gerçek İsim" title="Başka Tam İsim">A*** Y***</h5><span id="masked-css" class="username" data-full="Gizli Başka İsim"></span></aside><div class="recommend"><aside class="store-name">Yanlış Mağaza</aside></div></main><footer><aside class="username">Destek İsmi</aside></footer><script type="application/ld+json">{"seller":{"name":"JSON İsmi"}}</script>`,nameURL);
    setPseudo('#masked-css','::before',{content:'"B*** K***" / attr(data-full)'});assert.equal((await x.extractListing()).record.sellerName,'');w.close();
  });
  await check('Unpainted pseudo text and CSS icons do not become a guessed name',async()=>{
    for(const style of [{content:'"Gizli İsim"',display:'none'},{content:'"Gizli İsim"',visibility:'hidden'},{content:'"Gizli İsim"',opacity:'0'},{content:'"Gizli İsim"',fontSize:'0px'},{content:'"Gizli İsim"',color:'rgba(0,0,0,0)'},{content:'"\\e000"'},{content:'counter(secret-name)'}]){
      const {w,x,setPseudo}=dom(`<main>${nameInfo}<aside class="classifiedUserBox"><h5 id="pseudo-name"></h5></aside></main>`,nameURL);setPseudo('#pseudo-name','::before',style);assert.equal((await x.extractListing()).record.sellerName,'');w.close();
    }
  });
  await check('Username area fallback does not absorb membership blocks or inline date labels',async()=>{
    for(const metadata of ['<p>Hesap açma tarihi 2018</p>','<span> Hesap açma tarihi 2018</span>']){
      const {w,x}=dom(`<main>${nameInfo}<aside class="classifiedUserBox"><div class="username-info-area"><span>Ayşe</span>${metadata}</div></aside></main>`,nameURL);assert.equal((await x.extractListing()).record.sellerName,'');w.close();
    }
    const {w,x}=dom(`<main>${nameInfo}<aside class="store-name">1980 Özcan Otomotiv</aside></main>`,nameURL);assert.equal((await x.extractListing()).record.sellerName,'1980 Özcan Otomotiv');w.close();
  });
  function screenshotPhoneCard({fullVisible=true,maskedVisible=false,button=false,full='0 (555) 111 22 33'}={}){
    return `<style>.pretty-phone-part,.encrypted-phone-part{display:none}.show-part{display:inline!important}</style><aside class="classifiedUserBox classified-owner-info common-design"><div class="classifiedUserContent"><div class="username-info-area"><h5>Kemal Ç.</h5></div><ul id="phoneInfoPart" class="userContactInfo"><li><strong class="mobile">Cep</strong><span class="pretty-phone-part ${fullVisible?'show-part':''}"><span id="css-full-phone" class="cssRandomFull" data-content="${full}"></span></span><span class="encrypted-phone-part ${maskedVisible?'show-part':''}"><span id="css-masked-phone" class="cssRandomMask" data-unused-full="0 (555) 999 88 77"></span></span></li></ul>${button?'<button id="optional-phone-button">Telefonu Göster</button>':''}</div></aside>`;
  }
  await check('Screenshot-shape CSS phone is read without a reveal button, for before and after',async()=>{
    for(const pseudo of ['::before','::after']){
      const {w,x,setPseudo}=dom(`<main>${nameInfo}${screenshotPhoneCard()}</main>`,nameURL);
      setPseudo('#css-full-phone',pseudo,{content:'attr(data-content)'});setPseudo('#css-masked-phone','::before',{content:'"0 (555) *** ** 33"'});
      const {record}=await x.extractListing({revealPhone:pseudo==='::after'});assert.deepEqual(Array.from(record.phones),['905551112233']);assert.equal(record.sellerName,'Kemal Ç.');assert.equal(record.phoneStatus,'Görünür numara alındı');w.close();
    }
  });
  await check('Already painted full CSS phone prevents an unnecessary reveal click',async()=>{
    const {w,x,setPseudo}=dom(`<main>${nameInfo}${screenshotPhoneCard({button:true})}</main>`,nameURL);setPseudo('#css-full-phone','::before',{content:'attr(data-content)'});let clicks=0;w.document.querySelector('#optional-phone-button').onclick=()=>clicks++;
    const {record}=await x.extractListing({revealPhone:true});assert.equal(record.phones[0],'905551112233');assert.equal(clicks,0);w.close();
  });
  await check('Hidden full CSS value and visible masked sibling never yield the hidden phone',async()=>{
    const {w,x,setPseudo}=dom(`<main>${nameInfo}${screenshotPhoneCard({fullVisible:false,maskedVisible:true})}</main>`,nameURL);setPseudo('#css-full-phone','::before',{content:'attr(data-content)'});setPseudo('#css-masked-phone','::before',{content:'"0 (555) *** ** 33"'});
    const {record}=await x.extractListing({revealPhone:true});assert.equal(record.phones.length,0);assert.equal(record.sellerName,'Kemal Ç.');w.close();
  });
  await check('Masked pseudo-only value and unused attributes are not decoded as full phone',async()=>{
    const {w,x,setPseudo}=dom(`<main>${nameInfo}${screenshotPhoneCard({fullVisible:false,maskedVisible:true})}</main>`,nameURL);setPseudo('#css-masked-phone','::before',{content:'"0 (555) *** ** 33" / attr(data-unused-full)'});
    assert.equal((await x.extractListing({revealPhone:false})).record.phones.length,0);w.close();
  });
  await check('Separate phone fragments cannot be concatenated into an invented CSS phone',async()=>{
    const {w,x,setPseudo}=dom(`<main>${nameInfo}<aside class="classifiedUserBox"><h5>Kemal Ç.</h5><ul class="userContactInfo"><li><span class="phone-number"><span id="fragment-a"></span><span id="fragment-b"></span></span></li></ul></aside></main>`,nameURL);
    setPseudo('#fragment-a','::before',{content:'"0 (555) 111"'});setPseudo('#fragment-b','::after',{content:'"22 33"'});assert.equal((await x.extractListing()).record.phones.length,0);w.close();
  });
  await check('CSS phones from footer, description, recommendations and unpainted pseudo are excluded',async()=>{
    const {w,x,setPseudo}=dom(`<main>${nameInfo}<aside class="classifiedUserBox"><h5>Kemal Ç.</h5><span class="phone-number" id="transparent-phone" data-content="0 (555) 100 00 01"></span><section id="classifiedDescription"><span class="phone-number" id="description-phone" data-content="0 (555) 100 00 02"></span></section><div style="opacity:0"><span class="phone-number" id="opacity-parent-phone" data-content="0 (555) 100 00 05"></span></div><div style="display:none"><span class="phone-number" id="hidden-parent-phone" data-content="0 (555) 100 00 06"></span></div></aside><div class="recommend"><aside class="classifiedUserBox"><span class="phone-number" id="recommend-phone" data-content="0 (555) 100 00 03"></span></aside></div></main><footer><aside class="classifiedUserBox"><span class="phone-number" id="footer-phone" data-content="0 (555) 100 00 04"></span></aside></footer>`,nameURL);
    setPseudo('#transparent-phone','::before',{content:'attr(data-content)',opacity:'0'});for(const id of ['description-phone','recommend-phone','footer-phone','opacity-parent-phone','hidden-parent-phone'])setPseudo('#'+id,'::before',{content:'attr(data-content)'});
    assert.equal((await x.extractListing()).record.phones.length,0);w.close();
  });
  await check('An existing visible full-phone region waits briefly for its displayed attr value',async()=>{
    const {w,x,setPseudo}=dom(`<main>${nameInfo}${screenshotPhoneCard({full:''})}</main>`,nameURL);setPseudo('#css-full-phone','::before',{content:'attr(data-content)'});
    w.setTimeout(()=>w.document.querySelector('#css-full-phone').setAttribute('data-content','0 (555) 222 33 44'),80);
    const {record}=await x.extractListing({revealPhone:false});assert.equal(record.phones[0],'905552223344');assert.equal(record.phoneStatus,'Görünür numara yüklenince alındı');w.close();
  });
  await check('Explicit conflicting category evidence is unresolved',async()=>{
    const {w,x}=dom(`<main><nav class="breadcrumb"><a>Konut</a><a>Daire</a></nav><h1>Örnek</h1><table>${rows([['İlan No','0-102'],['Arsa Tipi','Konut+Ticaret']])}</table></main>`, 'https://www.hepsiemlak.com/ankara-satilik/imarli-konut/0-102');
    const {record}=await x.extractListing();assert.equal(record.category,'belirsiz');assert.ok(record.warnings.some(s=>s.includes('çelişiyor')));w.close();
  });
  await check('List deduplicates cards, excludes recommendations, preserves all filters',async()=>{
    const {w,x}=dom(`<main><h1>Ankara Arsa</h1><p>51 ilan bulundu</p><article><a href="/ankara-satilik/tarla/0-1">Bir</a><a href="/ankara-satilik/tarla/0-1?tracking=1">Fotoğraf</a></article><a href="/ankara-satilik/tarla/0-2">İki</a><div class="recommend"><a href="/ankara-satilik/tarla/0-999">Öneri</a></div><nav class="pagination"><a href="?page=1">1</a><a href="?page=2">2</a><a href="?page=3">3</a><a rel="next" href="?page=2">Sonraki</a></nav></main>`, 'https://www.hepsiemlak.com/ankara-satilik-sahibinden?subCategories=imarli-konut&p31=5000000&p15=110302');
    const r=x.discoverList();assert.equal(r.links.length,2);assert.equal(r.pagination.expectedTotal,51);assert.equal(r.pagination.complete,false);const u=new URL(r.nextUrl);assert.equal(u.searchParams.get('p31'),'5000000');assert.equal(u.searchParams.get('p15'),'110302');assert.equal(u.searchParams.get('page'),'2');w.close();
  });
  await check('50 cards over five pages preserve pagingSize 50, filters and 250 total',async()=>{
    let current='https://www.sahibinden.com/satilik-arsa/ankara?pagingSize=50&price_min=5000000&region=a&region=b';
    const seen=new Set();
    for(let page=1;page<=5;page++){
      const offset=(page-1)*50;
      const cards=Array.from({length:50},(_,i)=>`<article><a href="/ilan/emlak-arsa-ornek-${100000+offset+i}/detay">İlan ${i+1}</a></article>`).join('');
      const next=page<5?`<a rel="next" href="?pagingOffset=${offset+50}">Sonraki</a>`:'<button disabled>Sonraki</button>';
      const {w,x}=dom(`<main><div class="recommend"><p>1 ilan bulundu</p><a href="/ilan/emlak-arsa-oneri-999999/detay">Öneri</a></div><h1>Ankara Arsa</h1><p>250 ilan bulundu</p>${cards}<nav class="paging">${next}</nav></main>`,current);
      const r=x.discoverList({expectedUrl:current});assert.equal(r.ok,true);assert.equal(r.links.length,50);r.links.forEach(url=>seen.add(url));
      assert.equal(r.pagination.currentPage,page);assert.equal(r.pagination.pageSize,50);assert.equal(r.pagination.inPageCount,50);assert.equal(r.pagination.lastPage,5);assert.equal(r.pagination.expectedTotal,250);assert.equal(r.pagination.hasActualNext,page<5);assert.equal(r.pagination.complete,page===5);
      if(page<5){const u=new URL(r.nextUrl);assert.equal(u.searchParams.get('pagingOffset'),String(page*50));assert.equal(u.searchParams.get('pagingSize'),'50');assert.equal(u.searchParams.get('price_min'),'5000000');assert.deepEqual(u.searchParams.getAll('region'),['a','b']);current=r.nextUrl;}else assert.equal(r.nextUrl,null);
      w.close();
    }
    assert.equal(seen.size,250);
  });
  await check('Sliding page labels never masquerade as the final page',async()=>{
    const {w,x}=dom('<main><a href="/ilan/emlak-arsa-ornek-100000/detay">İlan</a><nav class="paging"><a href="?pagingOffset=0">1</a><a href="?pagingOffset=50">2</a><a href="?pagingOffset=100">3</a><a rel="next" href="?pagingOffset=50"><span>›</span></a></nav></main>', 'https://www.sahibinden.com/satilik-arsa?pagingSize=50');
    const r=x.discoverList();assert.equal(r.pagination.lastPage,null);assert.equal(r.pagination.hasActualNext,true);assert.equal(r.pagination.complete,false);assert.equal(new URL(r.nextUrl).searchParams.get('pagingOffset'),'50');w.close();
  });
  await check('Dynamic Next button uses proven Sahibinden size to advance without a click',async()=>{
    const {w,x}=dom('<main><p>250 ilan bulundu</p><a href="/ilan/emlak-arsa-ornek-100000/detay">İlan</a><nav class="paging"><button id="next">Sonraki</button></nav></main>', 'https://www.sahibinden.com/satilik-arsa?pagingSize=50');let clicks=0;w.document.querySelector('#next').onclick=()=>clicks++;
    const r=x.discoverList();assert.equal(new URL(r.nextUrl).searchParams.get('pagingOffset'),'50');assert.equal(r.pagination.strategy,'generated-offset');assert.equal(r.pagination.hasActualNext,true);assert.equal(r.pagination.complete,false);assert.equal(r.pagination.lastPage,5);assert.equal(clicks,0);w.close();
  });
  await check('Real table layout reads a sibling total and pageNaviButtons without configured size',async()=>{
    const cards=Array.from({length:50},(_,i)=>`<tr><td><a href="/ilan/emlak-arsa-ornek-${200000+i}/detay">İlan</a></td></tr>`).join('');
    const {w,x}=dom(`<div class="searchResultsTitleValue">Arama kriterlerinize uygun 1.234&nbsp;ilan bulundu</div><table id="searchResultsTable">${cards}</table><ul class="pageNaviButtons"><li class="selected">1</li><li><a href="?pagingOffset=50">2</a></li><li><a href="?pagingOffset=100">3</a></li></ul>`, 'https://www.sahibinden.com/satilik-arsa/ankara?price_min=5000000&region=a&region=b');
    const r=x.discoverList();assert.equal(r.links.length,50);assert.equal(r.pagination.expectedTotal,1234);assert.equal(r.pagination.pageSize,50);assert.equal(r.pagination.pageSizeEvidence,'pager');assert.equal(r.pagination.lastPage,25);assert.equal(r.pagination.currentPage,1);assert.equal(r.pagination.strategy,'link');const u=new URL(r.nextUrl);assert.equal(u.searchParams.get('pagingOffset'),'50');assert.equal(u.searchParams.get('pagingSize'),'50');assert.equal(u.searchParams.get('price_min'),'5000000');assert.deepEqual(u.searchParams.getAll('region'),['a','b']);w.close();
  });
  await check('Button-only pagination runs all five full pages using total and selected page size',async()=>{
    let current='https://www.sahibinden.com/satilik-arsa?price_min=5000000';
    const seen=new Set();
    for(let page=1;page<=5;page++){
      const cards=Array.from({length:50},(_,i)=>`<tr><td><a href="/ilan/emlak-arsa-ornek-${300000+(page-1)*50+i}/detay">İlan</a></td></tr>`).join('');
      const {w,x}=dom(`<div class="result-text">250 ilan</div><select name="pagingSize"><option selected value="50">50 ilan</option></select><table id="searchResultsTable">${cards}</table><ul class="paging-navigation"><li><button ${page===5?'disabled':''}>Sonraki</button></li></ul>`,current);
      const r=x.discoverList();r.links.forEach(url=>seen.add(url));assert.equal(r.pagination.currentPage,page);assert.equal(r.pagination.pageSize,50);assert.equal(r.pagination.expectedTotal,250);assert.equal(r.pagination.complete,page===5);
      if(page<5){assert.equal(r.pagination.strategy,'generated-offset');const u=new URL(r.nextUrl);assert.equal(u.searchParams.get('pagingOffset'),String(page*50));assert.equal(u.searchParams.get('price_min'),'5000000');current=r.nextUrl;}else assert.equal(r.nextUrl,null);w.close();
    }
    assert.equal(seen.size,250);
  });
  await check('Known total and full visible cards can recover a missing pager without guessing 20',async()=>{
    const cards=Array.from({length:50},(_,i)=>`<a href="/ilan/emlak-arsa-ornek-${400000+i}/detay">İlan</a>`).join('');
    const {w,x}=dom(`<main><p>123 ilan bulundu</p>${cards}</main>`, 'https://www.sahibinden.com/satilik-arsa?sorting=price_asc');const r=x.discoverList();assert.equal(r.pagination.pageSize,50);assert.equal(r.pagination.pageSizeEvidence,'visible-results');assert.equal(r.pagination.lastPage,3);assert.equal(r.pagination.hasActualNext,false);assert.equal(new URL(r.nextUrl).searchParams.get('pagingOffset'),'50');assert.equal(new URL(r.nextUrl).searchParams.get('sorting'),'price_asc');w.close();
  });
  await check('Short final page keeps proven size instead of treating remaining rows as increment',async()=>{
    const cards=Array.from({length:23},(_,i)=>`<a href="/ilan/emlak-arsa-ornek-${410000+i}/detay">İlan</a>`).join('');
    const {w,x}=dom(`<main><p>123 ilan bulundu</p>${cards}</main>`, 'https://www.sahibinden.com/satilik-arsa?pagingOffset=100&pagingSize=50');const r=x.discoverList();assert.equal(r.pagination.currentPage,3);assert.equal(r.pagination.pageSize,50);assert.equal(r.pagination.complete,true);assert.equal(r.nextUrl,null);w.close();
  });
  await check('Incomplete visible rows cannot invent a page size from a button and total',async()=>{
    const {w,x}=dom('<main><p>250 ilan bulundu</p><a href="/ilan/emlak-arsa-ornek-100000/detay">İlan</a><nav class="paging"><button>Sonraki</button></nav></main>', 'https://www.sahibinden.com/satilik-arsa');const r=x.discoverList();assert.equal(r.pagination.pageSize,null);assert.equal(r.nextUrl,null);assert.equal(r.pagination.complete,false);w.close();
  });
  await check('Next offset increment and data-href can prove page size without numbered links',async()=>{
    const {w,x}=dom('<main><a href="/ilan/emlak-arsa-ornek-100000/detay">İlan</a><nav class="paging-navigation"><button data-href="?pagingOffset=100">Sonraki</button></nav></main>', 'https://www.sahibinden.com/satilik-arsa?pagingOffset=50');const r=x.discoverList();assert.equal(r.pagination.pageSize,50);assert.equal(r.pagination.currentPage,2);assert.equal(new URL(r.nextUrl).searchParams.get('pagingOffset'),'100');w.close();
  });
  await check('Disabled pager with an unhydrated blank list is not a completed scan',async()=>{
    const {w,x}=dom('<main><table id="searchResultsTable"></table><nav class="paging"><button disabled>Sonraki</button></nav></main>', 'https://www.sahibinden.com/satilik-arsa');assert.equal(x.discoverList().pagination.complete,false);w.close();
  });
  await check('Hepsiemlak generated next page requires its observed query convention',async()=>{
    const {w,x}=dom('<main><p>100 ilan bulundu</p><a href="/ankara-satilik/tarla/0-1">İlan</a><nav class="pagination"><a href="?page=1">1</a><button>Sonraki</button></nav></main>', 'https://www.hepsiemlak.com/ankara-satilik?page=2&pagingSize=24&p31=5000000');const r=x.discoverList();assert.equal(new URL(r.nextUrl).searchParams.get('page'),'3');assert.equal(new URL(r.nextUrl).searchParams.get('p31'),'5000000');assert.equal(r.pagination.strategy,'generated-page');w.close();
  });
  await check('Next URL cannot change a search filter or configured page size',async()=>{
    for(const target of ['?pagingOffset=50&price_min=1','?pagingOffset=50&pagingSize=20']){
      const {w,x}=dom(`<main><a href="/ilan/emlak-arsa-ornek-100000/detay">İlan</a><nav class="paging"><a rel="next" href="${target}">Sonraki</a></nav></main>`, 'https://www.sahibinden.com/satilik-arsa?pagingSize=50&price_min=5000000');const r=x.discoverList();assert.equal(r.nextUrl,null);assert.equal(r.pagination.hasActualNext,true);assert.equal(r.pagination.complete,false);w.close();
    }
  });
  await check('Recommendation-only empty marker cannot complete actual results',async()=>{
    const {w,x}=dom('<main><a href="/ilan/emlak-arsa-ornek-100000/detay">İlan</a><div class="recommend">İlan bulunamadı</div></main>', 'https://www.sahibinden.com/satilik-arsa?pagingSize=50');const r=x.discoverList();assert.equal(r.pagination.complete,false);assert.equal(r.pagination.expectedTotal,null);w.close();
  });
  await check('Unknown pagination is partial rather than silently complete',async()=>{
    const {w,x}=dom('<main><h1>Arsa</h1><a href="/ankara-satilik/tarla/0-1">İlan</a></main>', 'https://www.hepsiemlak.com/ankara-satilik');const r=x.discoverList();assert.equal(r.pagination.complete,false);assert.equal(r.nextUrl,null);w.close();
  });
  await check('Explicit final page completes; current page mismatch rejects redirects',async()=>{
    const url='https://www.hepsiemlak.com/ankara-satilik?page=2';
    const {w,x}=dom('<main><a href="/ankara-satilik/tarla/0-2">İlan</a><nav class="pagination"><a href="?page=1">1</a><a href="?page=2">2</a><button disabled>Sonraki</button></nav></main>',url);
    assert.equal(x.discoverList().pagination.complete,true);assert.equal(x.inspect('https://www.hepsiemlak.com/ankara-satilik?page=3').kind,'mismatch');w.close();
  });
  await check('Sahibinden offset and numbered URLs verify the same page without permitting a filter change',async()=>{
    const base='https://www.sahibinden.com/satilik-arsa?pagingOffset=50&pagingSize=50&price_min=5000000';
    const {w,x}=dom('<main><h1>Ankara satılık arsa</h1></main>',base);
    assert.equal(x.inspect('https://www.sahibinden.com/satilik-arsa?pagingOffset=50&pagingSize=50&price_min=5000000&page=2').ok,true);
    w.history.replaceState({},'', '/satilik-arsa?page=2&pagingSize=50&price_min=5000000');
    assert.equal(x.inspect(base).ok,true);
    w.history.replaceState({},'', '/satilik-arsa?page=3&pagingSize=50&price_min=5000000');
    assert.equal(x.inspect(base).kind,'mismatch');
    w.history.replaceState({},'', '/satilik-arsa?page=2&pagingSize=50&price_min=6000000');
    assert.equal(x.inspect(base).kind,'mismatch');w.close();
  });
  await check('Bot challenge returns blocked and performs no extraction',async()=>{
    const {w,x}=dom('<title>Just a moment...</title><h1>Verify you are human</h1>', 'https://www.hepsiemlak.com/ankara-satilik');assert.equal(x.inspect().kind,'blocked');assert.equal(x.discoverList().ok,false);w.close();
  });
  await check('Wrong detail number rejects stale page',async()=>{
    const {w,x}=dom(`<main><h1>Eski ilan</h1><table>${rows([['İlan No','0-888'],['Arsa Tipi','Tarla']])}</table></main>`, 'https://www.hepsiemlak.com/ankara-satilik/tarla/0-111');assert.equal((await x.extractListing()).kind,'mismatch');w.close();
  });
  await check('Description tab may hide info without losing observed facts',async()=>{
    const {w,x}=dom(`<main><section id="info"><nav class="breadcrumb"><a>Arsa</a></nav><h1>Başlangıç başlığı</h1><div class="price">6.750.000 TL</div><div class="location">Ankara / Gölbaşı / Örnek Mah.</div><table>${rows([['İlan No','0-103'],['Metrekare','1.250 m2'],['Ada No','42']])}</table><div class="gallery"><img src="https://example.invalid/photo.jpg"></div><h3>Altyapı</h3><ul><li>Elektrik</li></ul><aside class="seller"><h2>Başlangıç Satıcısı</h2><span>0555 000 00 05</span></aside></section><button id="description-tab" role="tab">İlan Açıklaması</button><section id="description" hidden><p>Sonradan açılan açıklama.</p><table>${rows([['Parsel No','17']])}</table></section></main>`, 'https://www.hepsiemlak.com/ankara-satilik/diger/0-103');
    let clicks=0;w.document.querySelector('#description-tab').onclick=()=>{clicks++;w.document.querySelector('#info').hidden=true;w.document.querySelector('#description').hidden=false;};
    const result=await x.extractListing({revealPhone:false});assert.equal(result.ok,true);const r=result.record;
    assert.equal(clicks,1);assert.equal(r.title,'Başlangıç başlığı');assert.equal(r.price,6750000);assert.equal(r.area,1250);assert.equal(r.category,'arsa');
    assert.equal(r.rawDetails['Ada No'],'42');assert.equal(r.rawDetails['Parsel No'],'17');assert.equal(r.location.district,'Gölbaşı');assert.equal(r.sellerName,'Başlangıç Satıcısı');
    assert.equal(r.phones[0],'905550000005');assert.ok(r.description.includes('Sonradan açılan açıklama.'));assert.ok(r.features.some(v=>v.includes('Elektrik')));assert.equal(r.images[0],'https://example.invalid/photo.jpg');w.close();
  });
  await check('All recognized Sahibinden non-property taxonomy roots become diger',async()=>{
    const roots=['ikinci-el-ve-sifir-alisveris','is-makineleri-sanayi','yedek-parca-aksesuar-donanim-tuning','hayvanlar-alemi','ozel-ders-verenler','yardimci-arayanlar','ustalar-ve-hizmetler','is-ilanlari'];
    for(const prefix of roots){
      const {w,x}=dom(`<main><nav class="breadcrumb"><li><a>İkinci El ve Sıfır Alışveriş</a></li><li><a>Bahçe</a></li><li><a>Ofis</a></li></nav><h1>Örnek ürün</h1><table>${rows([['İlan No','123456'],['Marka','Ürün'],['Model','Örnek'],['Ürün Durumu','Yeni']])}</table></main>`, `https://www.sahibinden.com/ilan/${prefix}-ornek-123456/detay`);
      const r=await x.extractListing();assert.equal(r.record.category,'diger',prefix);assert.ok(r.record.categoryEvidence.some(e=>e.source==='url'&&e.category==='diger'));assert.deepEqual(Array.from(r.record.categoryPath),['İkinci El ve Sıfır Alışveriş','Bahçe','Ofis']);assert.equal(r.record.rawDetails['Ürün Durumu'],'Yeni');w.close();
    }
  });
  await check('Unknown taxonomy and generic product brand/model are never guessed as car',async()=>{
    const {w,x}=dom(`<main><h1>Satılık cihaz</h1><table>${rows([['İlan No','123456'],['Marka','Örnek'],['Model','Ekran']])}</table></main>`, 'https://www.sahibinden.com/ilan/unknown-ornek-123456/detay');assert.equal((await x.extractListing()).record.category,'belirsiz');w.close();
  });
  const watched='https://www.sahibinden.com/ilan/vasita-otomobil-ornek-123456/detay';
  const active=`<div class="classifiedDetailTitle"><h1>Satılık örnek araç</h1></div><ul class="classifiedInfoList"><li><strong>İlan No</strong><span>123456</span></li><li><strong>Marka</strong><span>Örnek</span></li></ul>`;
  await check('Status active requires matching visible ID plus title/info and never reveals phone',async()=>{
    const {w,x}=dom(`<main>${active}${seller}</main>`,watched);let clicks=0;w.document.querySelector('#show').onclick=()=>clicks++;const r=x.checkStatus({expectedUrl:watched});assert.equal(r.status,'active');assert.equal(r.listingId,'123456');assert.equal(r.kind,'status');assert.equal(clicks,0);assert.ok(r.checkedAt);w.close();
  });
  await check('Exact requested detail with explicit site removal heading is removed',async()=>{
    const {w,x}=dom('<main><h1>Bu ilan yayından kaldırılmıştır.</h1></main>',watched);const r=x.checkStatus({expectedUrl:watched});assert.equal(r.status,'removed');assert.ok(r.evidence.includes('kaldırılmıştır'));w.close();
  });
  await check('Dedicated removal notice can coexist with retained listing details',async()=>{
    const {w,x}=dom(`<main>${active}<div role="status">İlanın yayın süresi dolmuştur.</div></main>`,watched);assert.equal(x.checkStatus({expectedUrl:watched}).status,'removed');w.close();
  });
  await check('Seller description, footer, hidden and recommendation removal texts are ignored',async()=>{
    const {w,x}=dom(`<main>${active}<div id="classifiedDescription"><h1>Bu ilan yayından kaldırılmıştır.</h1></div><div class="recommend"><div role="alert">Bu ilan yayından kaldırılmıştır.</div></div><div role="status" hidden>Bu ilan yayından kaldırılmıştır.</div></main><footer><h2>Bu ilan yayından kaldırılmıştır.</h2></footer>`,watched);assert.equal(x.checkStatus({expectedUrl:watched}).status,'active');w.close();
  });
  await check('User-written listing title cannot prove removal',async()=>{
    const {w,x}=dom(`<main>${active.replace('Satılık örnek araç','Bu ilan yayından kaldırılmıştır.')}</main>`,watched);assert.equal(x.checkStatus({expectedUrl:watched}).status,'active');w.close();
  });
  await check('404, blank, missing ID and tentative notice produce unknown',async()=>{
    for(const html of ['<main><h1>404 Sayfa bulunamadı</h1></main>','<main></main>','<main><h1>Aradığınız ilan bulunamadı.</h1></main>','<main><h1>Bu ilan yayından kaldırılmış olabilir.</h1></main>','<main><h1>Satılık araç</h1><table><tr><th>Marka</th><td>Örnek</td></tr></table></main>']){
      const {w,x}=dom(html,watched);assert.equal(x.checkStatus({expectedUrl:watched}).status,'unknown',html);w.close();
    }
  });
  await check('Login and challenge pages never become removed even with removal-like text',async()=>{
    const {w,x}=dom('<title>Just a moment...</title><main><h1>Bu ilan yayından kaldırılmıştır.</h1></main>',watched);assert.equal(x.checkStatus({expectedUrl:watched}).kind,'blocked');w.close();
    const next=dom('<main><h1>Giriş yap</h1><input type="password"><div role="status">Bu ilan yayından kaldırılmıştır.</div></main>',watched);assert.equal(next.x.checkStatus({expectedUrl:watched}).kind,'login');next.w.close();
  });
  await check('Wrong listing URL and wrong visible listing ID are mismatches',async()=>{
    const {w,x}=dom('<main><h1>Bu ilan yayından kaldırılmıştır.</h1></main>',watched.replace('123456','987654'));assert.equal(x.checkStatus({expectedUrl:watched}).kind,'mismatch');w.close();
    const next=dom(`<main>${active.replace('123456','987654')}</main>`,watched);assert.equal(next.x.checkStatus({expectedUrl:watched}).kind,'mismatch');next.w.close();
  });
  await check('Redirects remain unknown unless explicit same-source notice visibly identifies watched ID',async()=>{
    const redirect='https://www.sahibinden.com/sayfa-bulunamadi';
    const cases=[['<main><h1>Bu ilan yayından kaldırılmıştır.</h1></main>','unknown'],['<main><div role="status"><h1>Bu ilan yayından kaldırılmıştır.</h1><p>İlan No: 123456</p></div></main>','removed'],['<main><div role="status"><h1>Bu ilan yayından kaldırılmıştır.</h1><p>İlan No: 987654</p></div></main>','unknown']];
    for(const [html,expected] of cases){const {w,x}=dom(html,redirect);const r=x.checkStatus({expectedUrl:watched});assert.equal(r.status,expected);if(expected==='removed')assert.ok(r.evidence.includes('İlan No: 123456'));w.close();}
  });
  await check('Description/recommendation fabricated info cannot make blank page active',async()=>{
    for(const box of ['id="classifiedDescription"','class="recommend"']){const {w,x}=dom(`<main><section ${box}>${active}</section></main>`,watched);assert.equal(x.checkStatus({expectedUrl:watched}).status,'unknown');w.close();}
  });
  console.log(`${passed} extraction scenarios passed.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
