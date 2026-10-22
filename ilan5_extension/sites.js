/* Supported listing sites. Every site-specific rule (address shape, listing id, phone button,
   paging) lives here, so the crawler, extractor and panel share one definition. */
(function(root){
  'use strict';
  const SITES=Object.freeze([
    {id:'sahibinden',name:'Sahibinden',domain:'sahibinden.com',
      // Detail pages: /ilan/<slug>-<id>/detay
      detail:/^\/ilan\/.+-(\d+)\/detay\/?$/,looseId:/-(\d+)(?:\/detay)?\/?$/,
      phoneButton:/^telefon(?:u| numarasini)?\s+goster$/,paging:'offset',monitor:true,messages:true},
    {id:'hepsiemlak',name:'Hepsiemlak',domain:'hepsiemlak.com',
      // Detail pages end in <office>-<listing>, e.g. /ankara-golbasi-satilik/tarla/0-47475589
      detail:/\/(\d+-\d+)\/?$/,looseId:/\/(\d+-\d+)\/?$/,
      phoneButton:/^telefon(?:u| numarasini)?\s+goster$/,paging:'page',monitor:true},
    {id:'emlakjet',name:'Emlakjet',domain:'emlakjet.com',
      // /ilan/<slug>-19990109 ; the contact button is labelled just "Ara".
      detail:/^\/ilan\/[^/]+-(\d{5,})\/?$/,looseId:/^\/ilan\/[^/]+-(\d{5,})\/?$/,
      phoneButton:/^(?:ara|telefonu goster|numarayi goster)$/,phoneButtonStrict:true,paging:'page'},
    {id:'arabam',name:'arabam.com',domain:'arabam.com',category:'arac',
      // /ilan/<seller-type-slug>/<title-slug>/44985286 ; the button reads "Telefonu göster - (0530) 850 ** **".
      detail:/^\/ilan\/(?:[^/]+\/)+(\d{5,})\/?$/,looseId:/^\/ilan\/(?:[^/]+\/)+(\d{5,})\/?$/,
      phoneButton:/^telefon(?:u)?\s+goster\b/,paging:'page'}
  ]);
  const byId=new Map(SITES.map(site=>[site.id,site]));
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
  root.IlanSites=Object.freeze({SITES,ids:SITES.map(site=>site.id),get:id=>byId.get(id)||null,forHost,forUrl,sourceFor,listingId,name,matchPatterns,namesText});
  if(typeof module!=='undefined'&&module.exports)module.exports=root.IlanSites;
})(typeof globalThis==='undefined'?self:globalThis);
