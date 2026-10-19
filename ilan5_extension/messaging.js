/* Sahibinden message composer. It prepares text and leaves final send visible to the user. */
(function(root){
  'use strict';
  const visible=el=>!!el&&el.getClientRects().length>0&&getComputedStyle(el).visibility!=='hidden'&&getComputedStyle(el).display!=='none';
  const clean=value=>String(value||'').replace(/\s+/g,' ').trim();
  const clickText=patterns=>{
    const nodes=[...document.querySelectorAll('button,a,input[type="button"],input[type="submit"],div[role="button"],span[role="button"]')].filter(visible);
    return nodes.find(el=>patterns.some(rx=>rx.test(clean(el.innerText||el.value||el.getAttribute('aria-label')||el.title))));
  };
  async function pause(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
  function setText(el,text){
    el.focus();
    if(el.isContentEditable){el.textContent=text;el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:text}));return;}
    el.value=text;
    el.dispatchEvent(new Event('input',{bubbles:true}));
    el.dispatchEvent(new Event('change',{bubbles:true}));
  }
  async function prepare(message){
    const text=clean(message.text);
    if(!/sahibinden\.com\/ilan\//i.test(location.href)) return {ok:false,kind:'mismatch',error:'Mesaj hazırlamak için Sahibinden ilan detay sayfası açılmalı.'};
    if(!text) return {ok:false,kind:'error',error:'Mesaj metni boş.'};
    let composer=[...document.querySelectorAll('textarea,input[type="text"],[contenteditable="true"]')].find(visible);
    if(!composer){
      const trigger=clickText([/mesaj\s*g[oö]nder/i,/satıcıya\s*mesaj/i,/ilan\s*sahibine\s*mesaj/i]);
      if(trigger){trigger.click();await pause(1200);}
      composer=[...document.querySelectorAll('textarea,input[type="text"],[contenteditable="true"]')].find(visible);
    }
    if(!composer) return {ok:false,kind:'missing',error:'Mesaj kutusu bulunamadı. İlan mesaj kabul etmiyor olabilir veya giriş gerekli olabilir.'};
    setText(composer,text);
    const send=clickText([/^g[oö]nder$/i,/mesaj[ıi]?\s*g[oö]nder/i]);
    return {ok:true,kind:'message',filled:true,canSend:!!send,sendText:send?clean(send.innerText||send.value||send.getAttribute('aria-label')):'',message:text};
  }
  root.IlanMessaging={prepare};
  if(typeof module!=='undefined'&&module.exports)module.exports=root.IlanMessaging;
})(globalThis);
