'use strict';
const $=id=>document.getElementById(id);
$('openArchive').addEventListener('click',()=>chrome.tabs.create({url:chrome.runtime.getURL('archive.html?collect=1')}));
$('openArchiveOnly').addEventListener('click',()=>chrome.tabs.create({url:chrome.runtime.getURL('archive.html#archiveTitle')}));
$('capture').addEventListener('click',async()=>{
  $('capture').disabled=true;$('message').className='';$('message').textContent='İlan okunuyor…';
  try{
    const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
    const result=await chrome.runtime.sendMessage({type:'ILAN_CAPTURE_TAB',tabId:tab?.id,category:$('category').value,revealPhone:$('phone').checked});
    if(!result?.ok)throw Error(result?.error||'İlan kaydedilemedi.');
    $('message').textContent=result.message||(result.skipped?'Hedef kategoriyle uyuşmadığı için ilan arşive eklenmedi.':result.review?'İlan, kategori kontrolü için İnceleme gerekli alanına kaydedildi.':'İlan arşive kaydedildi.');
  }catch(error){$('message').className='error';$('message').textContent=error.message;}
  finally{$('capture').disabled=false;}
});
