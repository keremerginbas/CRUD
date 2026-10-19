// XRE yönetimi için WhatsApp by XRE lisans ekranı (CRM sahibi oturumuyla çalışır):
// genel bakış (gelir, dönüşüm, süresi dolacaklar), ödemeler, portallar, kodlar, fiyatlar.
import { PANEL_STYLE } from "./b24-panel-html.js";

const ICONS: Record<string, string> = {
  overview: '<path d="M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-4H4zM14 4v4h6V4z"/>',
  payments: '<path d="M3 7h18v10H3zM3 10h18M7 14h3"/>',
  portals: '<path d="M4 5h16v5H4zM4 14h16v5H4zM8 7.5h.01M8 16.5h.01"/>',
  codes: '<path d="M8 10V7a4 4 0 1 1 8 0v3M6 10h12v10H6zM12 14v2"/>',
  pricing: '<path d="M20 12l-8 8-8-8V4h8zM8 8h.01"/>',
};
const icon = (k: string) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[k]}</svg>`;

export function adminHtml() {
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>WhatsApp by XRE yönetimi</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Onest:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>${PANEL_STYLE}
.shell{display:grid;grid-template-columns:236px minmax(0,1fr);min-height:100vh}
.side{background:var(--surface);border-right:1px solid var(--line);padding:20px 14px;display:flex;flex-direction:column;gap:18px;position:sticky;top:0;height:100vh}
.side .brand{display:flex;align-items:center;gap:10px;padding:0 8px;font-weight:700;font-size:15px;line-height:1.2}
.side .brand small{display:block;font-weight:500;color:var(--ink-3);font-size:12px}
.nav{display:flex;flex-direction:column;gap:2px}
.nav button{display:flex;align-items:center;gap:11px;border:0;background:none;padding:9px 10px;border-radius:8px;cursor:pointer;color:var(--ink-2);font-weight:600;text-align:left}
.nav button:hover{background:var(--line-2);color:var(--ink)}
.nav button[aria-selected=true]{background:var(--accent-soft);color:var(--accent)}
.nav .count{margin-left:auto;min-width:20px;padding:0 6px;border-radius:999px;background:var(--danger);color:#fff;font-size:11.5px;line-height:20px;text-align:center}
.side .foot{margin-top:auto;padding:0 8px;font-size:12.5px;color:var(--ink-3)}
.side .foot a{color:var(--ink-2)}
.content{min-width:0}
.head2{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap;padding:24px 32px 0;max-width:1400px}
.head2 h1{margin:0;font-size:24px;letter-spacing:-.015em}
.head2 p{margin:3px 0 0;color:var(--ink-3);font-size:13px}
.content main{max-width:1400px;margin:0;padding:20px 32px 48px}
.kpis{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:12px;margin-bottom:16px}
.kpi{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:16px 18px;box-shadow:0 1px 2px rgba(16,36,58,.04)}
.kpi span{display:block;color:var(--ink-3);font-size:12.5px;font-weight:600}
.kpi b{display:block;font-size:28px;letter-spacing:-.02em;line-height:1.15;margin-top:6px;font-variant-numeric:tabular-nums}
.kpi small{display:block;color:var(--ink-3);font-size:12.5px;margin-top:4px}
.kpi.alert{border-color:var(--danger);box-shadow:0 0 0 1px var(--danger) inset}
.kpi.alert b{color:var(--danger)}
.grid2{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,1fr);gap:16px;margin-bottom:16px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:16px 18px;box-shadow:0 1px 2px rgba(16,36,58,.04);min-width:0}
.card h3{margin:0 0 2px;font-size:14px}
.card .cap{color:var(--ink-3);font-size:12.5px;margin:0 0 12px}
.card details{margin-top:8px;font-size:13px}.card summary{cursor:pointer;color:var(--ink-2)}
.card table{width:100%;border-collapse:collapse;margin-top:6px}.card td,.card th{padding:5px 4px;text-align:left;border-top:1px solid var(--line-2);font-variant-numeric:tabular-nums}
.rchart{position:relative}
.rchart svg{display:block;width:100%;height:220px;overflow:visible}
.rchart .grid{stroke:var(--line-2)}.rchart .axis{fill:var(--ink-3);font-size:11.5px}
.rchart .bar{fill:var(--c-in)}.rchart .bar.dim{fill:var(--c-in);opacity:.45}
.rchart .hit{fill:transparent;cursor:default}
.rchart .val{fill:var(--ink);font-size:12px;font-weight:600}
.tip{position:absolute;pointer-events:none;background:var(--ink);color:var(--paper);font-size:12.5px;padding:6px 9px;border-radius:7px;white-space:nowrap;transform:translate(-50%,-100%);opacity:0;transition:opacity .1s}
.mix{display:grid;gap:12px}
.mix .r{display:grid;grid-template-columns:52px 1fr 34px;gap:10px;align-items:center;font-size:13px}
.mix .track{height:8px;border-radius:999px;background:var(--line-2);overflow:hidden}
.mix .fill{height:100%;border-radius:999px;background:var(--c-in)}
.mix b{text-align:right;font-variant-numeric:tabular-nums}
.mini{display:flex;flex-direction:column}
.mini .it{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;padding:9px 0;border-top:1px solid var(--line-2)}
.mini .it:first-child{border-top:0}
.mini .it .name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.link{border:0;background:none;color:var(--accent);font-weight:600;cursor:pointer;padding:0}
.portal{background:var(--surface);border:1px solid var(--line);border-radius:12px;margin-bottom:12px;box-shadow:0 1px 2px rgba(16,36,58,.04)}
.portal summary{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:14px 18px;cursor:pointer;list-style:none;border-radius:12px}
.portal summary::-webkit-details-marker{display:none}
.portal summary:hover{background:var(--line-2)}.portal summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.portal[open] summary{border-bottom:1px solid var(--line-2);border-radius:12px 12px 0 0}
.portal .pmain{flex:1;min-width:200px}.portal .pmain b{font-size:15px}
.portal .pstats{display:flex;gap:10px;align-items:center;flex-wrap:wrap;color:var(--ink-2);font-size:13px}
.chev{width:9px;height:9px;border-right:2px solid var(--ink-3);border-bottom:2px solid var(--ink-3);transform:rotate(-45deg);transition:transform .15s;flex:none}
.portal[open] .chev{transform:rotate(45deg)}
.pill{display:inline-block;font-size:11.5px;font-weight:700;padding:2px 9px;border-radius:999px;background:var(--accent-soft);color:var(--accent)}
.ok-dot{color:var(--ok);font-weight:600}
.list.adm-lines .row{grid-template-columns:32px minmax(160px,1.3fr) minmax(130px,1fr) 150px 140px 90px}
.list.adm-pay .row{grid-template-columns:110px minmax(160px,1.2fr) minmax(150px,1.2fr) 110px 120px 200px}
.list.adm-codes .row{grid-template-columns:180px 110px 90px minmax(160px,1.4fr) 140px}
.inline{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.inline input,.inline select{padding:7px 9px;border:1px solid var(--line);border-radius:var(--r-s);background:var(--paper)}
@media (max-width:900px){
  .shell{grid-template-columns:1fr}
  .side{position:static;height:auto;flex-direction:row;align-items:center;overflow-x:auto;padding:10px 12px;border-right:0;border-bottom:1px solid var(--line)}
  .nav{flex-direction:row}.side .foot{display:none}
  .head2,.content main{padding-left:16px;padding-right:16px}
  .grid2{grid-template-columns:1fr}
}
</style></head><body>
<div class="shell">
<aside class="side">
  <div class="brand"><svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="9" fill="var(--accent)"/><path d="M9 11.5h14v8H15l-4 3v-3H9z" fill="none" stroke="var(--accent-ink)" stroke-width="2" stroke-linejoin="round"/></svg><div>WhatsApp by XRE<small>Yönetim</small></div></div>
  <nav class="nav" role="tablist" aria-label="Bölümler">
    <button role="tab" data-tab="overview" aria-selected="true">${icon("overview")}Genel bakış</button>
    <button role="tab" data-tab="payments" aria-selected="false">${icon("payments")}Ödemeler<span class="count" id="payCount" hidden></span></button>
    <button role="tab" data-tab="portals" aria-selected="false">${icon("portals")}Portallar</button>
    <button role="tab" data-tab="codes" aria-selected="false">${icon("codes")}Lisans kodları</button>
    <button role="tab" data-tab="pricing" aria-selected="false">${icon("pricing")}Fiyatlar</button>
  </nav>
  <div class="foot"><a href="/">CRM’e dön</a></div>
</aside>
<div class="content">
<div class="head2"><div><h1 id="title">Genel bakış</h1><p id="subtitle">Gelir, müşteriler ve lisanslar</p></div><button class="btn" id="refresh">Yenile</button></div>
<main id="main"><p class="sub">Yükleniyor…</p></main>
</div></div>
<div class="toast" id="toast" role="status"></div>
<script>
let S=null,tab="overview",pq="";const openP=new Set();
const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
const money=(v,c)=>new Intl.NumberFormat("tr-TR",{style:"currency",currency:c||"USD",maximumFractionDigits:2,minimumFractionDigits:Number(v)%1?2:0}).format(v);
const PN={basic:"Basic",pro:"Pro",proplus:"Pro+"};
const planSel=(id,sel)=>'<select '+id+'>'+["basic","pro","proplus"].map(k=>'<option value="'+k+'"'+(k===(sel||"proplus")?" selected":"")+'>'+PN[k]+'</option>').join("")+'</select>';
const day=iso=>iso?new Date(iso).toLocaleDateString("tr-TR",{day:"numeric",month:"long",year:"numeric"}):"—";
const monthName=m=>new Date(m+"-01T12:00:00Z").toLocaleDateString("tr-TR",{month:"short"});
const phone=p=>p?"+"+String(p).replace(/^(\\d{2})(\\d{3})(\\d{3})(\\d{2})(\\d{2})$/,"$1 $2 $3 $4 $5"):"—";
const TITLES={overview:["Genel bakış","Gelir, müşteriler ve lisanslar"],payments:["Ödemeler","Havale bildirimlerini onaylayın"],portals:["Portallar","Uygulamayı kuran firmalar ve numaraları"],codes:["Lisans kodları","Müşteriye verilecek ön ödemeli kodlar"],pricing:["Fiyatlar","Paket fiyatları, indirimler ve banka bilgisi"]};
let tt;function toast(m,e){const t=$("#toast");t.textContent=m;t.className="toast show"+(e?" err":"");clearTimeout(tt);tt=setTimeout(()=>t.className="toast",e?6000:3000);}
async function api(path,body){const r=await fetch("/api/b24-admin/"+path,{method:body?"POST":"GET",credentials:"include",headers:{"content-type":"application/json"},body:body?JSON.stringify(body):undefined});const j=await r.json().catch(()=>({}));
  if(r.status===401)throw new Error("CRM oturumu yok. Önce CRM'e yönetici hesabıyla giriş yapın, sonra bu sayfayı yenileyin.");if(!r.ok)throw new Error(j.message||"İşlem tamamlanamadı.");return j;}
async function load(){try{S=await api("state");const pc=S.payments.filter(p=>p.status==="pending").length;const b=$("#payCount");b.hidden=!pc;b.textContent=pc;render();}catch(e){$("#main").innerHTML='<div class="list"><div class="empty"><strong>Ekran açılamadı</strong>'+esc(e.message)+'<br><a class="btn primary" href="/" style="margin-top:14px;display:inline-flex;text-decoration:none">CRM\\'e git</a></div></div>';}}
function go(t){tab=t;document.querySelectorAll(".nav button").forEach(x=>x.setAttribute("aria-selected",String(x.dataset.tab===t)));$("#title").textContent=TITLES[t][0];$("#subtitle").textContent=TITLES[t][1];render();window.scrollTo(0,0);}
document.querySelectorAll(".nav button").forEach(b=>b.onclick=()=>go(b.dataset.tab));
$("#refresh").onclick=()=>load();
const st={active:"Aktif",free:"Ücretsiz",trial:"Deneme",expired:"Süresi doldu",new:"Bağlanmadı"};
function barChart(el,data,cur){
  const w=Math.max(280,el.clientWidth),h=220,pl=46,pr=8,pt=22,pb=26,max=Math.max(1,...data.map(d=>d.amount));
  const nice=v=>{const p=Math.pow(10,Math.floor(Math.log10(v)));return Math.ceil(v/p)*p;};const top=nice(max);
  const iw=w-pl-pr,ih=h-pt-pb,bw=Math.min(44,iw/data.length*0.56),step=iw/data.length;
  let s='<svg viewBox="0 0 '+w+' '+h+'" role="img" aria-label="Aylık tahsilat">';
  for(let i=0;i<=4;i++){const y=pt+ih-(ih*i/4);s+='<line class="grid" x1="'+pl+'" x2="'+(w-pr)+'" y1="'+y+'" y2="'+y+'"/><text class="axis" x="'+(pl-8)+'" y="'+(y+4)+'" text-anchor="end">'+esc(new Intl.NumberFormat("tr-TR",top>=100000?{notation:"compact"}:{maximumFractionDigits:0}).format(top*i/4))+'</text>';}
  data.forEach((d,i)=>{const x=pl+step*i+(step-bw)/2,bh=d.amount?Math.max(3,ih*d.amount/top):0,y=pt+ih-bh,r=Math.min(4,bh/2),last=i===data.length-1;
    if(bh)s+='<path class="bar'+(last?"":" dim")+'" d="M'+x+','+(pt+ih)+'V'+(y+r)+'Q'+x+','+y+' '+(x+r)+','+y+'H'+(x+bw-r)+'Q'+(x+bw)+','+y+' '+(x+bw)+','+(y+r)+'V'+(pt+ih)+'Z"/>';
    if(last&&d.amount)s+='<text class="val" x="'+(x+bw/2)+'" y="'+(y-7)+'" text-anchor="middle">'+esc(money(d.amount,cur))+'</text>';
    s+='<text class="axis" x="'+(x+bw/2)+'" y="'+(h-6)+'" text-anchor="middle">'+esc(monthName(d.month))+'</text>';
    s+='<rect class="hit" data-i="'+i+'" x="'+(pl+step*i)+'" y="'+pt+'" width="'+step+'" height="'+ih+'"/>';});
  el.innerHTML=s+'</svg><div class="tip" id="tip"></div>';
  const tip=el.querySelector("#tip");
  el.querySelectorAll(".hit").forEach(r=>{r.onmouseenter=()=>{const d=data[Number(r.dataset.i)],x=pl+step*Number(r.dataset.i)+step/2;tip.innerHTML='<b>'+esc(new Date(d.month+"-01T12:00:00Z").toLocaleDateString("tr-TR",{month:"long",year:"numeric"}))+'</b><br>'+esc(money(d.amount,cur));tip.style.left=(x/w*100)+"%";tip.style.top=Math.max(18,pt+ih-(d.amount?ih*d.amount/top:0)-8)+"px";tip.style.opacity=1;};r.onmouseleave=()=>tip.style.opacity=0;});
}
function overview(m){
  const k=S.metrics,cur=k.currency,pend=S.payments.filter(p=>p.status==="pending");
  const paying=Object.values(k.planMix).reduce((a,b)=>a+b,0);
  m.innerHTML='<div class="kpis">'
    +'<div class="kpi"><span>Aylık yinelenen gelir</span><b>'+esc(money(k.mrr,cur))+'</b><small>'+k.activeLines+' aktif lisans · liste fiyatıyla</small></div>'
    +'<div class="kpi"><span>Bu ay tahsil edilen</span><b>'+esc(money(k.thisMonth,cur))+'</b><small>toplam '+esc(money(k.total,cur))+'</small></div>'
    +'<div class="kpi'+(k.pendingCount?" alert":"")+'"><span>Onay bekleyen havale</span><b>'+k.pendingCount+'</b><small>'+(k.pendingCount?esc(money(k.pendingAmount,cur))+' bekliyor':'bekleyen yok')+'</small></div>'
    +'<div class="kpi"><span>Ödeyen firma</span><b>'+k.payingPortals+' <small style="display:inline;font-size:15px">/ '+k.portals+'</small></b><small>'+(k.conversion==null?"henüz deneme yok":"denemeden ücretliye %"+k.conversion)+'</small></div>'
    +'<div class="kpi"><span>Denemedeki numara</span><b>'+k.trials+'</b><small>deneme süresi '+S.pricing.trialDays+' gün</small></div></div>'
    +'<div class="grid2"><section class="card"><h3>Aylık tahsilat</h3><p class="cap">Son 6 ay, onaylanan havaleler (lisans kodları hariç)</p><div class="rchart" id="rev"></div>'
      +'<details><summary>Tablo görünümü</summary><table><tr><th>Ay</th><th>Tutar</th></tr>'+k.byMonth.map(d=>'<tr><td>'+esc(new Date(d.month+"-01T12:00:00Z").toLocaleDateString("tr-TR",{month:"long",year:"numeric"}))+'</td><td>'+esc(money(d.amount,cur))+'</td></tr>').join("")+'</table></details></section>'
    +'<section class="card"><h3>Paket dağılımı</h3><p class="cap">Ödeyen firmalar, portalın geçerli paketine göre</p>'+(paying?'<div class="mix">'+["basic","pro","proplus"].map(p=>'<div class="r"><span>'+PN[p]+'</span><div class="track"><div class="fill" style="width:'+(paying?Math.round(k.planMix[p]/paying*100):0)+'%"></div></div><b>'+k.planMix[p]+'</b></div>').join("")+'</div>':'<p class="sub">Henüz ödeyen firma yok.</p>')
      +'<h3 style="margin-top:20px">Son ödeme bildirimleri</h3><div class="mini">'+(S.payments.slice(0,4).map(p=>'<div class="it"><div class="name">'+esc(p.domain)+'<div class="sub">'+(p.plan?PN[p.plan]+' · ':'')+p.lines.length+' numara · '+p.months+' ay</div></div><div style="text-align:right"><b>'+esc(money(p.amount,p.currency))+'</b><div class="lic '+(p.status==="approved"?"active":p.status==="pending"?"trial":"expired")+'">'+({pending:"Onay bekliyor",approved:"Onaylandı",rejected:"Reddedildi"})[p.status]+'</div></div></div>').join("")||'<p class="sub">Henüz ödeme yok.</p>')+'</div>'
      +(pend.length?'<button class="link" data-go="payments" style="margin-top:8px">Bekleyenleri onayla →</button>':'')+'</section></div>'
    +'<section class="card"><h3>Süresi dolacaklar</h3><p class="cap">3 gün içinde biten denemeler ve 14 gün içinde biten lisanslar; müşteriye Bitrix bildirimi otomatik gider</p>'
      +(k.expiringSoon.length?'<div class="mini">'+k.expiringSoon.map(x=>'<div class="it"><div class="name">'+esc(x.firm)+' · '+esc(x.name)+'<div class="sub">'+esc(x.domain)+'</div></div><div style="display:flex;gap:12px;align-items:center"><span class="lic '+esc(x.status)+'">'+st[x.status]+' · '+x.daysLeft+' gün</span><button class="link" data-open="'+esc(x.domain)+'">Aç</button></div></div>').join("")+'</div>':'<p class="sub">Yakında süresi dolan lisans yok.</p>')+'</section>';
  barChart($("#rev"),k.byMonth,cur);
  m.querySelectorAll("[data-go]").forEach(b=>b.onclick=()=>go(b.dataset.go));
  m.querySelectorAll("[data-open]").forEach(b=>b.onclick=()=>{const p=S.portals.find(x=>x.domain===b.dataset.open);if(p)openP.add(p.id);pq=b.dataset.open;go("portals");});
}
function render(){const m=$("#main");const cur=S.pricing.currency;
  if(tab==="overview"){overview(m);return;}
  if(tab==="payments"){
    m.innerHTML=(S.payments.length?'<div class="list adm-pay"><div class="row head"><span>Tarih</span><span>Portal</span><span>İşlem</span><span>Tutar</span><span>Referans</span><span></span></div>'+S.payments.map(p=>'<div class="row"><div class="sub">'+esc(day(p.createdAt))+'</div><div class="name">'+esc(p.domain)+'</div><div>'+(p.plan?'<span class="pill">'+PN[p.plan]+'</span> ':'')+p.lines.length+' numara · '+p.months+' ay'+(p.note?'<div class="sub">'+esc(p.note)+'</div>':'')+'</div><div>'+money(p.amount,p.currency)+'</div><div><code>'+esc(p.reference)+'</code></div><div class="acts">'+(p.status==="pending"?'<button class="btn" data-reject="'+esc(p.id)+'">Reddet</button><button class="btn primary" data-approve="'+esc(p.id)+'">Onayla</button>':'<span class="lic '+(p.status==="approved"?"active":"expired")+'">'+(p.status==="approved"?"Onaylandı":"Reddedildi")+' · '+esc(day(p.decidedAt))+'</span>')+'</div></div>').join("")+'</div>'
      :'<div class="list"><div class="empty"><strong>Henüz havale bildirimi yok</strong>Müşteri Ödeme sekmesinden havale bildirdiğinde burada görünür; B24_ADMIN_WEBHOOK tanımlıysa size de bildirim gelir.</div></div>');
    m.querySelectorAll("[data-approve],[data-reject]").forEach(b=>b.onclick=async()=>{const id=b.dataset.approve||b.dataset.reject,ok=Boolean(b.dataset.approve);if(!confirm(ok?"Havaleyi aldığınızı onaylıyor musunuz? Lisans uzatılacak.":"Bildirim reddedilsin mi?"))return;try{await api("payments/"+id+"/"+(ok?"approve":"reject"),{});toast(ok?"Onaylandı, lisans uzatıldı.":"Reddedildi.");load();}catch(e){toast(e.message,true);}});}
  if(tab==="portals"){
    const q=pq.toLowerCase();const list=S.portals.filter(p=>!q||(p.domain+" "+(p.billing&&p.billing.title||"")+" "+p.lines.map(l=>l.name+" "+(l.phone||"")).join(" ")).toLowerCase().includes(q));
    const count=(p,k)=>p.lines.filter(l=>l.status===k).length;
    m.innerHTML='<div class="bar"><input class="search" id="pq" placeholder="Firma, alan adı veya numara ara" value="'+esc(pq)+'"><span class="hint">'+S.portals.length+' firma · '+S.portals.reduce((a,p)=>a+p.lines.length,0)+' numara</span></div>'
      +(list.length?list.map(p=>{const firm=p.billing&&p.billing.title||p.domain,con=p.lines.filter(l=>l.connected).length,exp=count(p,"expired");
        return '<details class="portal"'+(openP.has(p.id)?" open":"")+' data-p="'+esc(p.id)+'"><summary><span class="chev" aria-hidden="true"></span><div class="pmain"><b>'+esc(firm)+'</b><div class="sub">'+esc(p.domain)+' · kuruldu '+esc(day(p.installedAt))+(p.active?"":" · kaldırıldı")+'</div></div>'
          +'<div class="pstats"><span class="pill">'+esc(PN[p.plan]||"")+'</span><span><b>'+p.lines.length+'</b> numara</span><span><b>'+con+'</b> bağlı</span>'+(count(p,"active")?'<span class="lic active">'+count(p,"active")+' aktif</span>':'')+(count(p,"trial")?'<span class="lic trial">'+count(p,"trial")+' deneme</span>':'')+(count(p,"free")?'<span class="lic free">'+count(p,"free")+' ücretsiz</span>':'')+(exp?'<span class="lic expired">'+exp+' süresi dolmuş</span>':'')+'</div></summary>'
          +'<div class="pbody"><div class="inline" style="padding:12px 18px;justify-content:flex-end"><label class="check" style="margin-right:auto"><input type="checkbox" data-all="'+esc(p.id)+'"> Tümünü seç</label>'+planSel('data-plan="'+esc(p.id)+'"',p.plan)+'<select data-months="'+esc(p.id)+'">'+[1,3,6,12,24].map(x=>'<option value="'+x+'">'+x+' ay</option>').join("")+'</select><button class="btn primary" data-extend="'+esc(p.id)+'">Seçilenleri uzat</button></div>'
          +(p.lines.length?'<div class="list adm-lines" style="border:0;border-top:1px solid var(--line-2);border-radius:0 0 12px 12px"><div class="row head"><span></span><span>Bağlantı</span><span>Numara</span><span>Lisans</span><span>Bitiş</span><span>Bağlı</span></div>'+p.lines.map(l=>'<label class="row"><input type="checkbox" data-pl="'+esc(p.id)+'" value="'+esc(l.line)+'"><div class="name">'+esc(l.name)+'</div><div>'+esc(phone(l.phone))+'</div><div><span class="lic '+esc(l.status)+'">'+st[l.status]+(l.status==="trial"?" · "+l.daysLeft+" gün":"")+(l.status==="active"&&l.plan?" · "+PN[l.plan]:"")+'</span></div><div class="sub">'+esc(day(l.until))+'</div><div>'+(l.connected?'<span class="ok-dot">Bağlı</span>':'<span class="sub">Hayır</span>')+'</div></label>').join("")+'</div>':'<div class="empty">Bu firmada henüz numara yok.</div>')
          +'</div></details>';}).join(""):'<div class="list"><div class="empty">'+(S.portals.length?"Aramayla eşleşen firma yok.":"Henüz uygulamayı kuran portal yok.")+'</div></div>');
    $("#pq").oninput=e=>{pq=e.target.value;const pos=e.target.selectionStart;render();const i=$("#pq");i.focus();i.setSelectionRange(pos,pos);};
    m.querySelectorAll("details.portal").forEach(d=>d.addEventListener("toggle",()=>{if(d.open)openP.add(d.dataset.p);else openP.delete(d.dataset.p);}));
    m.querySelectorAll("[data-all]").forEach(c=>c.onchange=()=>m.querySelectorAll('[data-pl="'+c.dataset.all+'"]').forEach(i=>i.checked=c.checked));
    m.querySelectorAll("[data-extend]").forEach(b=>b.onclick=async()=>{const id=b.dataset.extend;const lines=[...m.querySelectorAll('[data-pl="'+id+'"]:checked')].map(i=>i.value);if(!lines.length){toast("Uzatılacak numarayı seçin.",true);return;}const months=Number(m.querySelector('[data-months="'+id+'"]').value);try{await api("extend",{memberId:id,lines,months,plan:m.querySelector('[data-plan="'+id+'"]').value});toast(lines.length+" numara "+months+" ay uzatıldı.");load();}catch(e){toast(e.message,true);}});}
  if(tab==="codes"){m.innerHTML='<div class="card" style="margin-bottom:14px"><div class="inline"><label>Süre <select id="c-m">'+[1,3,6,12,24].map(x=>'<option value="'+x+'"'+(x===12?" selected":"")+'>'+x+' ay</option>').join("")+'</select></label><label>Paket '+planSel('id="c-p"')+'</label><label>Numara <input id="c-l" type="number" min="1" max="100" value="1" style="width:70px"></label><label>Adet <input id="c-c" type="number" min="1" max="50" value="1" style="width:70px"></label><input id="c-n" placeholder="Not (ör. müşteri adı)" style="flex:1;min-width:180px"><button class="btn primary" id="c-gen">Kod üret</button></div></div>'
      +(S.codes.length?'<div class="list adm-codes"><div class="row head"><span>Kod</span><span>Paket · süre</span><span>Numara</span><span>Durum</span><span>Oluşturuldu</span></div>'+S.codes.map(c=>'<div class="row"><div><code>'+esc(c.id)+'</code></div><div>'+(c.plan?PN[c.plan]+' · ':'')+c.months+' ay</div><div>'+c.maxLines+'</div><div>'+(c.usedBy?'<span class="lic expired">Kullanıldı</span> <span class="sub">'+esc(c.usedDomain||"")+' · '+esc(day(c.usedAt))+'</span>':'<span class="lic active">Kullanılmadı</span>')+(c.note?'<div class="sub">'+esc(c.note)+'</div>':'')+'</div><div class="sub">'+esc(day(c.createdAt))+'</div></div>').join("")+'</div>':'<div class="list"><div class="empty">Henüz lisans kodu yok.</div></div>');
    $("#c-gen").onclick=async()=>{try{const r=await api("codes",{plan:$("#c-p").value,months:Number($("#c-m").value),maxLines:Number($("#c-l").value),count:Number($("#c-c").value),note:$("#c-n").value});toast(r.codes.length+" kod üretildi: "+r.codes.map(c=>c.id).join(", "));load();}catch(e){toast(e.message,true);}};}
  if(tab==="pricing"){const p=S.pricing;
    m.innerHTML='<div class="card"><h3>Paketler</h3><p class="cap">Numara başına aylık fiyat</p><div class="formgrid">'+["basic","pro","proplus"].map(k=>'<label class="field">'+PN[k]+'<input id="p-'+k+'" type="number" min="0" step="0.01" value="'+p.plans[k]+'"></label>').join("")+'<label class="field">Para birimi<input id="p-c" value="'+esc(p.currency)+'" placeholder="USD"></label><label class="field">Deneme süresi (gün)<input id="p-t" type="number" min="0" max="90" value="'+p.trialDays+'"></label><div></div>'
      +[3,6,12].map(x=>'<label class="field">'+x+' aylık indirim (%)<input id="p-d'+x+'" type="number" min="0" max="90" value="'+(p.discounts[x]||0)+'"></label>').join("")+'<div></div></div>'
      +'<h3 style="margin-top:18px">Banka bilgisi</h3><p class="cap">Müşteriye havale ekranında gösterilir</p><div class="formgrid"><label class="field">Hesap sahibi<input id="p-h" value="'+esc(p.bank.holder)+'"></label><label class="field">Banka<input id="p-b" value="'+esc(p.bank.bankName)+'"></label><label class="field full">IBAN<input id="p-i" value="'+esc(p.bank.iban)+'" placeholder="TR00 0000 0000 0000 0000 0000 00"></label><label class="field full">Müşteriye not<input id="p-n" value="'+esc(p.bank.note)+'"></label></div>'
      +'<p class="note">Örnek (12 aylık, numara başına): '+["basic","pro","proplus"].map(k=>PN[k]+' '+money(Math.round(p.plans[k]*12*(1-(p.discounts[12]||0)/100)*100)/100,p.currency)).join(" · ")+'</p><div style="display:flex;justify-content:flex-end"><button class="btn primary" id="p-save">Fiyatları kaydet</button></div></div>';
    $("#p-save").onclick=async()=>{const v=id=>$(id).value;try{await api("pricing",{plans:{basic:Number(v("#p-basic")),pro:Number(v("#p-pro")),proplus:Number(v("#p-proplus"))},currency:v("#p-c").toUpperCase(),trialDays:Number(v("#p-t")),discounts:{"1":0,"3":Number(v("#p-d3")),"6":Number(v("#p-d6")),"12":Number(v("#p-d12"))},bank:{holder:v("#p-h"),bankName:v("#p-b"),iban:v("#p-i"),note:v("#p-n")}});toast("Fiyatlar kaydedildi.");load();}catch(e){toast(e.message,true);}};}
}
window.addEventListener("resize",()=>{if(tab==="overview"&&S&&$("#rev"))barChart($("#rev"),S.metrics.byMonth,S.metrics.currency);});
load();
</script></body></html>`;
}
