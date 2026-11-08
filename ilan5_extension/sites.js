/* Supported listing sites. Every site-specific rule (address shape, listing id, phone button,
   paging) lives here, so the crawler, extractor and panel share one definition. */
(function(root){
  'use strict';
  const SITES=Object.freeze([
    {id:'sahibinden',name:'Sahibinden',domain:'sahibinden.com',
      // Detail pages: /ilan/<slug>-<id>/detay
      detail:/^\/ilan\/.+-(\d+)\/detay\/?$/,looseId:/-(\d+)(?:\/detay)?\/?$/,
      phoneButton:/^telefon(?:u| numarasini)?\s+goster$/,paging:'offset',monitor:true,messages:true,
      // Hints from public scrapers; the generic reader is the fallback when the layout changes.
      list:{title:'a.classifiedTitle',location:'td.searchResultsLocationValue',date:'td.searchResultsDateValue'},pageSize:{param:'pagingSize',value:50}},
    {id:'hepsiemlak',name:'Hepsiemlak',domain:'hepsiemlak.com',
      // Detail pages end in <office>-<listing>, e.g. /ankara-golbasi-satilik/tarla/0-47475589
      detail:/\/(\d+-\d+)\/?$/,looseId:/\/(\d+-\d+)\/?$/,
      phoneButton:/^telefon(?:u| numarasini)?\s+goster$/,paging:'page',monitor:true,
      list:{title:'h3,[class*="list-view-title" i]',location:'address,[class*="list-view-location" i]',date:'time,[class*="list-view-date" i]',area:'dd.squareMeter'}},
    {id:'emlakjet',name:'Emlakjet',domain:'emlakjet.com',
      // /ilan/<slug>-19990109 ; the contact button is labelled just "Ara".
      detail:/^\/ilan\/[^/]+-(\d{5,})\/?$/,looseId:/^\/ilan\/[^/]+-(\d{5,})\/?$/,
      phoneButton:/^(?:ara|telefonu goster|numarayi goster)$/,phoneButtonStrict:true,paging:'page',
      list:{title:'h3,h2',location:'[class*="location" i],[class*="address" i]',date:'[class*="date" i]'}},
    {id:'arabam',name:'arabam.com',domain:'arabam.com',category:'arac',
      // /ilan/<seller-type-slug>/<title-slug>/44985286 ; the button reads "Telefonu göster - (0530) 850 ** **".
      detail:/^\/ilan\/(?:[^/]+\/)+(\d{5,})\/?$/,looseId:/^\/ilan\/(?:[^/]+\/)+(\d{5,})\/?$/,
      phoneButton:/^telefon(?:u)?\s+goster\b/,paging:'page',
      list:{title:'td.listing-modelname h2,a[class*="listing-text" i]',location:'td[class*="location" i],[class*="listing-location" i]',date:'td.listing-text.tac,[class*="listing-date" i]'},pageSize:{param:'take',value:50}}
  ]);
  const byId=new Map(SITES.map(site=>[site.id,site]));
  // The 81 provinces, folded (no Turkish letters), to tell "city / district" from "district / neighborhood".
  const PROVINCES=['adana','adiyaman','afyonkarahisar','agri','aksaray','amasya','ankara','antalya','ardahan','artvin','aydin','balikesir','bartin','batman','bayburt','bilecik','bingol','bitlis','bolu','burdur','bursa','canakkale','cankiri','corum','denizli','diyarbakir','duzce','edirne','elazig','erzincan','erzurum','eskisehir','gaziantep','giresun','gumushane','hakkari','hatay','igdir','isparta','istanbul','izmir','kahramanmaras','karabuk','karaman','kars','kastamonu','kayseri','kilis','kirikkale','kirklareli','kirsehir','kocaeli','konya','kutahya','malatya','manisa','mardin','mersin','mugla','mus','nevsehir','nigde','ordu','osmaniye','rize','sakarya','samsun','sanliurfa','siirt','sinop','sivas','sirnak','tekirdag','tokat','trabzon','tunceli','usak','van','yalova','yozgat','zonguldak'];
  const fold=value=>String(value||'').toLocaleLowerCase('tr-TR').replace(/[ıİ]/g,'i').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
  const PROVINCE_NAMES={afyonkarahisar:'Afyonkarahisar',agri:'Ağrı',adiyaman:'Adıyaman',aydin:'Aydın',balikesir:'Balıkesir',bartin:'Bartın',bingol:'Bingöl',canakkale:'Çanakkale',cankiri:'Çankırı',corum:'Çorum',diyarbakir:'Diyarbakır',duzce:'Düzce',elazig:'Elazığ',eskisehir:'Eskişehir',gumushane:'Gümüşhane',igdir:'Iğdır',istanbul:'İstanbul',izmir:'İzmir',kahramanmaras:'Kahramanmaraş',karabuk:'Karabük',kirikkale:'Kırıkkale',kirklareli:'Kırklareli',kirsehir:'Kırşehir',kutahya:'Kütahya',mugla:'Muğla',mus:'Muş',nevsehir:'Nevşehir',nigde:'Niğde',sanliurfa:'Şanlıurfa',sirnak:'Şırnak',tekirdag:'Tekirdağ',usak:'Uşak'};
  const provinceName=key=>PROVINCE_NAMES[key]||key.charAt(0).toLocaleUpperCase('tr-TR')+key.slice(1);
  /** Province name when the text is (or starts with) one of the 81 provinces, else ''. */
  function province(value){const key=fold(value).split(' ')[0];return PROVINCES.includes(key)?provinceName(key):'';}
  /** Province named in a search address (/satilik-arsa/ankara, /ankara-satilik/arsa), else ''. */
  function provinceFromUrl(url){try{for(const part of new URL(url).pathname.toLowerCase().split(/[/-]+/))if(PROVINCES.includes(part))return provinceName(part);}catch(_){/* not a URL */}return '';}
  const bareHost=host=>String(host||'').toLowerCase().replace(/^(?:www|m)\./,'');
  function forHost(host){const bare=bareHost(host);return SITES.find(site=>site.domain===bare)||null;}
  function forUrl(url){try{return forHost(new URL(url).hostname);}catch(_){return null;}}
  function sourceFor(url){return forUrl(url)?.id||'';}
  function listingId(url,{loose=false}={}){
    try{const u=new URL(url),site=forHost(u.hostname);if(!site)return '';return u.pathname.match(loose?site.looseId:site.detail)?.[1]||'';}catch(_){return '';}
  }
  const name=id=>byId.get(id)?.name||(id==='import'?'İçe aktarılan':String(id||''));
  // Chrome match patterns for the manifest and for host checks.
  const matchPatterns=()=>SITES.flatMap(site=>[`https://www.${site.domain}/*`,`https://${site.domain}/*`]);
  const namesText=()=>SITES.map(site=>site.name).join(', ');
  root.IlanSites=Object.freeze({SITES,ids:SITES.map(site=>site.id),province,provinceFromUrl,get:id=>byId.get(id)||null,forHost,forUrl,sourceFor,listingId,name,matchPatterns,namesText});
  if(typeof module!=='undefined'&&module.exports)module.exports=root.IlanSites;
})(typeof globalThis==='undefined'?self:globalThis);
