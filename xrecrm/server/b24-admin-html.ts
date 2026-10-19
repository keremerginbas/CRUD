// XRE yönetimi için XRE WhatsApp lisans ekranı (CRM sahibi oturumuyla çalışır).
import { PANEL_STYLE } from "./b24-panel-html.js";

export function adminHtml() {
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>WhatsApp by XRE yönetimi</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Onest:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>${PANEL_STYLE}
.portal{background:var(--surface);border:1px solid var(--line);border-radius:var(--r-m);margin-bottom:14px}
.portal summary{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:14px 18px;cursor:pointer;list-style:none;border-radius:var(--r-m)}
.portal summary::-webkit-details-marker{display:none}
.portal summary:hover{background:var(--line-2)}.portal summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.portal[open] summary{border-bottom:1px solid var(--line-2);border-radius:var(--r-m) var(--r-m) 0 0}
.portal .pmain{flex:1;min-width:200px}.portal .pmain b{font-size:15px}
.portal .pstats{display:flex;gap:10px;align-items:center;flex-wrap:wrap;color:var(--ink-2);font-size:13px}
.chev{width:9px;height:9px;border-right:2px solid var(--ink-3);border-bottom:2px solid var(--ink-3);transform:rotate(-45deg);transition:transform .15s;flex:none}
.portal[open] .chev{transform:rotate(45deg)}
.ok-dot{color:var(--ok);font-weight:600}
.list.adm-lines .row{grid-template-columns:32px minmax(160px,1.3fr) minmax(130px,1fr) 150px 140px 90px}
.list.adm-pay .row{grid-template-columns:110px minmax(160px,1.2fr) minmax(150px,1.2fr) 110px 120px 200px}
.list.adm-codes .row{grid-template-columns:180px 90px 110px minmax(160px,1.4fr) 140px}
.inline{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.inline input,.inline select{padding:7px 9px;border:1px solid var(--line);border-radius:var(--r-s);background:var(--paper)}
</style></head><body>
<div class="top"><div><h1>WhatsApp by XRE yönetimi</h1><p>Lisanslar, ödemeler ve fiyatlar</p></div>
<div class="tabs" role="tablist"><button role="tab" data-tab="payments" aria-selected="true">Ödemeler</button><button role="tab" data-tab="portals" aria-selected="false">Portallar</button><button role="tab" data-tab="codes" aria-selected="false">Lisans kodları</button><button role="tab" data-tab="pricing" aria-selected="false">Fiyatlar</button></div></div>
<main id="main"><p class="sub">Yükleniyor…</p></main>
<div class="toast" id="toast" role="status"></div>
<script>
let S=null,tab="payments",pq="";const openP=new Set();
const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
const money=(v,c)=>new Intl.NumberFormat("tr-TR",{style:"currency",currency:c||"TRY",maximumFractionDigits:0}).format(v);
const day=iso=>iso?new Date(iso).toLocaleDateString("tr-TR",{day:"numeric",month:"long",year:"numeric"}):"—";
const phone=p=>p?"+"+String(p).replace(/^(\\d{2})(\\d{3})(\\d{3})(\\d{2})(\\d{2})$/,"$1 $2 $3 $4 $5"):"—";
let tt;function toast(m,e){const t=$("#toast");t.textContent=m;t.className="toast show"+(e?" err":"");clearTimeout(tt);tt=setTimeout(()=>t.className="toast",e?6000:3000);}
async function api(path,body){const r=await fetch("/api/b24-admin/"+path,{method:body?"POST":"GET",credentials:"include",headers:{"content-type":"application/json"},body:body?JSON.stringify(body):undefined});const j=await r.json().catch(()=>({}));
  if(r.status===401)throw new Error("CRM oturumu yok. Önce CRM'e yönetici hesabıyla giriş yapın, sonra bu sayfayı yenileyin.");if(!r.ok)throw new Error(j.message||"İşlem tamamlanamadı.");return j;}
async function load(){try{S=await api("state");render();}catch(e){$("#main").innerHTML='<div class="list"><div class="empty"><strong>Ekran açılamadı</strong>'+esc(e.message)+'<br><a class="btn primary" href="/" style="margin-top:14px;display:inline-flex;text-decoration:none">CRM\\'e git</a></div></div>';}}
document.querySelectorAll(".tabs button").forEach(b=>b.onclick=()=>{tab=b.dataset.tab;document.querySelectorAll(".tabs button").forEach(x=>x.setAttribute("aria-selected",String(x===b)));render();});
const st={active:"Aktif",free:"Ücretsiz",trial:"Deneme",expired:"Süresi doldu",new:"Bağlanmadı"};
function render(){const m=$("#main");const cur=S.pricing.currency;
  if(tab==="payments"){const pend=S.payments.filter(p=>p.status==="pending").length;
    m.innerHTML='<div class="facts"><div class="fact'+(pend?" alert":"")+'"><b>'+pend+'</b><span>onay bekleyen havale</span></div><div class="fact"><b>'+S.portals.length+'</b><span>portal</span></div><div class="fact"><b>'+S.portals.reduce((a,p)=>a+p.lines.filter(l=>l.status==="active").length,0)+'</b><span>aktif lisans</span></div><div class="fact"><b>'+S.portals.reduce((a,p)=>a+p.lines.filter(l=>l.status==="trial").length,0)+'</b><span>denemede numara</span></div></div>'
      +(S.payments.length?'<div class="list adm-pay"><div class="row head"><span>Tarih</span><span>Portal</span><span>İşlem</span><span>Tutar</span><span>Referans</span><span></span></div>'+S.payments.map(p=>'<div class="row"><div class="sub">'+esc(day(p.createdAt))+'</div><div class="name">'+esc(p.domain)+'</div><div>'+p.lines.length+' numara · '+p.months+' ay'+(p.note?'<div class="sub">'+esc(p.note)+'</div>':'')+'</div><div>'+money(p.amount,p.currency)+'</div><div><code>'+esc(p.reference)+'</code></div><div class="acts">'+(p.status==="pending"?'<button class="btn" data-reject="'+esc(p.id)+'">Reddet</button><button class="btn primary" data-approve="'+esc(p.id)+'">Onayla</button>':'<span class="lic '+(p.status==="approved"?"active":"expired")+'">'+(p.status==="approved"?"Onaylandı":"Reddedildi")+' · '+esc(day(p.decidedAt))+'</span>')+'</div></div>').join("")+'</div>'
      :'<div class="list"><div class="empty">Henüz havale bildirimi yok.</div></div>');
    m.querySelectorAll("[data-approve],[data-reject]").forEach(b=>b.onclick=async()=>{const id=b.dataset.approve||b.dataset.reject,ok=Boolean(b.dataset.approve);if(!confirm(ok?"Havaleyi aldığınızı onaylıyor musunuz? Lisans uzatılacak.":"Bildirim reddedilsin mi?"))return;try{await api("payments/"+id+"/"+(ok?"approve":"reject"),{});toast(ok?"Onaylandı, lisans uzatıldı.":"Reddedildi.");load();}catch(e){toast(e.message,true);}});}
  if(tab==="portals"){
    const q=pq.toLowerCase();const list=S.portals.filter(p=>!q||(p.domain+" "+(p.billing&&p.billing.title||"")+" "+p.lines.map(l=>l.name+" "+(l.phone||"")).join(" ")).toLowerCase().includes(q));
    const count=(p,k)=>p.lines.filter(l=>l.status===k).length;
    m.innerHTML='<div class="bar"><input class="search" id="pq" placeholder="Firma, alan adı veya numara ara" value="'+esc(pq)+'"><span class="hint">'+S.portals.length+' firma · '+S.portals.reduce((a,p)=>a+p.lines.length,0)+' numara</span></div>'
      +(list.length?list.map(p=>{const firm=p.billing&&p.billing.title||p.domain,con=p.lines.filter(l=>l.connected).length,exp=count(p,"expired");
        return '<details class="portal"'+(openP.has(p.id)?" open":"")+' data-p="'+esc(p.id)+'"><summary><span class="chev" aria-hidden="true"></span><div class="pmain"><b>'+esc(firm)+'</b><div class="sub">'+esc(p.domain)+' · kuruldu '+esc(day(p.installedAt))+(p.active?"":" · kaldırıldı")+'</div></div>'
          +'<div class="pstats"><span><b>'+p.lines.length+'</b> numara</span><span><b>'+con+'</b> bağlı</span>'+(count(p,"active")?'<span class="lic active">'+count(p,"active")+' aktif</span>':'')+(count(p,"trial")?'<span class="lic trial">'+count(p,"trial")+' deneme</span>':'')+(count(p,"free")?'<span class="lic free">'+count(p,"free")+' ücretsiz</span>':'')+(exp?'<span class="lic expired">'+exp+' süresi dolmuş</span>':'')+'</div></summary>'
          +'<div class="pbody"><div class="inline" style="padding:12px 18px;justify-content:flex-end"><label class="check" style="margin-right:auto"><input type="checkbox" data-all="'+esc(p.id)+'"> Tümünü seç</label><select data-months="'+esc(p.id)+'">'+[1,3,6,12,24].map(x=>'<option value="'+x+'">'+x+' ay</option>').join("")+'</select><button class="btn primary" data-extend="'+esc(p.id)+'">Seçilenleri uzat</button></div>'
          +(p.lines.length?'<div class="list adm-lines" style="border:0;border-top:1px solid var(--line-2);border-radius:0 0 var(--r-m) var(--r-m)"><div class="row head"><span></span><span>Bağlantı</span><span>Numara</span><span>Lisans</span><span>Bitiş</span><span>Bağlı</span></div>'+p.lines.map(l=>'<label class="row"><input type="checkbox" data-pl="'+esc(p.id)+'" value="'+esc(l.line)+'"><div class="name">'+esc(l.name)+'</div><div>'+esc(phone(l.phone))+'</div><div><span class="lic '+esc(l.status)+'">'+st[l.status]+(l.status==="trial"?" · "+l.daysLeft+" gün":"")+'</span></div><div class="sub">'+esc(day(l.until))+'</div><div>'+(l.connected?'<span class="ok-dot">Bağlı</span>':'<span class="sub">Hayır</span>')+'</div></label>').join("")+'</div>':'<div class="empty">Bu firmada henüz numara yok.</div>')
          +'</div></details>';}).join(""):'<div class="list"><div class="empty">'+(S.portals.length?"Aramayla eşleşen firma yok.":"Henüz uygulamayı kuran portal yok.")+'</div></div>');
    $("#pq").oninput=e=>{pq=e.target.value;const pos=e.target.selectionStart;render();const i=$("#pq");i.focus();i.setSelectionRange(pos,pos);};
    m.querySelectorAll("details.portal").forEach(d=>d.addEventListener("toggle",()=>{if(d.open)openP.add(d.dataset.p);else openP.delete(d.dataset.p);}));
    m.querySelectorAll("[data-all]").forEach(c=>c.onchange=()=>m.querySelectorAll('[data-pl="'+c.dataset.all+'"]').forEach(i=>i.checked=c.checked));
    m.querySelectorAll("[data-extend]").forEach(b=>b.onclick=async()=>{const id=b.dataset.extend;const lines=[...m.querySelectorAll('[data-pl="'+id+'"]:checked')].map(i=>i.value);if(!lines.length){toast("Uzatılacak numarayı seçin.",true);return;}const months=Number(m.querySelector('[data-months="'+id+'"]').value);try{await api("extend",{memberId:id,lines,months});toast(lines.length+" numara "+months+" ay uzatıldı.");load();}catch(e){toast(e.message,true);}});}
  if(tab==="codes"){m.innerHTML='<div class="list" style="padding:14px 18px;margin-bottom:14px"><div class="inline"><label>Süre <select id="c-m">'+[1,3,6,12,24].map(x=>'<option value="'+x+'"'+(x===12?" selected":"")+'>'+x+' ay</option>').join("")+'</select></label><label>Numara <input id="c-l" type="number" min="1" max="100" value="1" style="width:70px"></label><label>Adet <input id="c-c" type="number" min="1" max="50" value="1" style="width:70px"></label><input id="c-n" placeholder="Not (ör. müşteri adı)" style="flex:1;min-width:180px"><button class="btn primary" id="c-gen">Kod üret</button></div></div>'
      +(S.codes.length?'<div class="list adm-codes"><div class="row head"><span>Kod</span><span>Süre</span><span>Numara</span><span>Durum</span><span>Oluşturuldu</span></div>'+S.codes.map(c=>'<div class="row"><div><code>'+esc(c.id)+'</code></div><div>'+c.months+' ay</div><div>'+c.maxLines+'</div><div>'+(c.usedBy?'<span class="lic expired">Kullanıldı</span> <span class="sub">'+esc(c.usedDomain||"")+' · '+esc(day(c.usedAt))+'</span>':'<span class="lic active">Kullanılmadı</span>')+(c.note?'<div class="sub">'+esc(c.note)+'</div>':'')+'</div><div class="sub">'+esc(day(c.createdAt))+'</div></div>').join("")+'</div>':'<div class="list"><div class="empty">Henüz lisans kodu yok.</div></div>');
    $("#c-gen").onclick=async()=>{try{const r=await api("codes",{months:Number($("#c-m").value),maxLines:Number($("#c-l").value),count:Number($("#c-c").value),note:$("#c-n").value});toast(r.codes.length+" kod üretildi: "+r.codes.map(c=>c.id).join(", "));load();}catch(e){toast(e.message,true);}};}
  if(tab==="pricing"){const p=S.pricing;
    m.innerHTML='<div class="list" style="padding:18px 20px"><div class="formgrid"><label class="field">Numara başına aylık fiyat<input id="p-m" type="number" min="0" value="'+p.monthly+'"></label><label class="field">Para birimi<input id="p-c" value="'+esc(p.currency)+'" placeholder="TRY"></label><label class="field">Deneme süresi (gün)<input id="p-t" type="number" min="0" max="90" value="'+p.trialDays+'"></label><div></div>'
      +[3,6,12].map(x=>'<label class="field">'+x+' aylık indirim (%)<input id="p-d'+x+'" type="number" min="0" max="90" value="'+(p.discounts[x]||0)+'"></label>').join("")+'<div></div>'
      +'<label class="field">Hesap sahibi<input id="p-h" value="'+esc(p.bank.holder)+'"></label><label class="field">Banka<input id="p-b" value="'+esc(p.bank.bankName)+'"></label><label class="field full">IBAN<input id="p-i" value="'+esc(p.bank.iban)+'" placeholder="TR00 0000 0000 0000 0000 0000 00"></label><label class="field full">Müşteriye not<input id="p-n" value="'+esc(p.bank.note)+'"></label></div>'
      +'<p class="note">Örnek: aylık '+money(p.monthly,p.currency)+' · 12 aylık '+money(Math.round(p.monthly*12*(1-(p.discounts[12]||0)/100)),p.currency)+'</p><div style="display:flex;justify-content:flex-end"><button class="btn primary" id="p-save">Fiyatları kaydet</button></div></div>';
    $("#p-save").onclick=async()=>{const v=id=>$(id).value;try{await api("pricing",{monthly:Number(v("#p-m")),currency:v("#p-c").toUpperCase(),trialDays:Number(v("#p-t")),discounts:{"1":0,"3":Number(v("#p-d3")),"6":Number(v("#p-d6")),"12":Number(v("#p-d12"))},bank:{holder:v("#p-h"),bankName:v("#p-b"),iban:v("#p-i"),note:v("#p-n")}});toast("Fiyatlar kaydedildi.");load();}catch(e){toast(e.message,true);}};}
}
load();
</script></body></html>`;
}
