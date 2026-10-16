// XRE WhatsApp yönetim paneli (Bitrix24 içinde açılır). Derleme gerektirmeyen
// tek sayfa; verileri /b24/panel/* uçlarından bilet ile alır.
const escapeHtml = (v: string) =>
  v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function panelHtml(ticket: string, domain: string) {
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>XRE WhatsApp</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Onest:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
:root{
  --paper:#f4f7fa;--surface:#ffffff;--ink:#10243a;--ink-2:#4a5d72;--ink-3:#7d8ea1;--line:#dfe6ee;--line-2:#eef2f6;
  --accent:#0f7f86;--accent-ink:#ffffff;--accent-soft:#e3f3f3;--ok:#1d9b50;--ok-soft:#e4f5ea;--warn:#b86e00;--warn-soft:#fbf0dc;
  --danger:#bb3a33;--danger-soft:#fbe9e7;--scrim:rgba(16,36,58,.38);--shadow:0 18px 50px rgba(16,36,58,.18);
  --r-s:6px;--r-m:10px;
}
@media (prefers-color-scheme:dark){:root{
  --paper:#0f1a26;--surface:#162434;--ink:#e6edf4;--ink-2:#a9b8c7;--ink-3:#7a8ca0;--line:#25384c;--line-2:#1c2d3f;
  --accent:#3bb7bc;--accent-ink:#06222a;--accent-soft:#163c43;--ok:#43c979;--ok-soft:#173a29;--warn:#e7a64a;--warn-soft:#3b2d16;
  --danger:#ef7b73;--danger-soft:#3d1f1d;--scrim:rgba(0,0,0,.55);--shadow:0 18px 50px rgba(0,0,0,.45);
}}
*{box-sizing:border-box}
html,body{margin:0;background:var(--paper);color:var(--ink);font:14px/1.5 Onest,system-ui,-apple-system,"Segoe UI",sans-serif}
button,input,select{font:inherit;color:inherit}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.top{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:20px 28px 0;flex-wrap:wrap;max-width:1560px;margin:0 auto}
.top h1{margin:0;font-size:22px;font-weight:700;letter-spacing:-.01em}
.top p{margin:2px 0 0;color:var(--ink-3);font-size:13px}
.tabs{display:inline-flex;background:var(--surface);border:1px solid var(--line);border-radius:var(--r-m);padding:3px;gap:2px}
.tabs button{border:0;background:none;padding:7px 14px;border-radius:7px;cursor:pointer;color:var(--ink-2);font-weight:600}
.tabs button[aria-selected=true]{background:var(--ink);color:var(--paper)}
main{padding:20px 28px 40px;max-width:1560px;margin:0 auto}
/* Hat panosu: her numara bir hücre */
.board{background:var(--surface);border:1px solid var(--line);border-radius:var(--r-m);padding:18px 20px;margin-bottom:18px;display:grid;grid-template-columns:auto 1fr auto;gap:22px;align-items:center}
.board .count{font-size:30px;font-weight:700;line-height:1;letter-spacing:-.02em}
.board .count small{font-size:15px;color:var(--ink-3);font-weight:500}
.board .caption{color:var(--ink-2);font-size:13px;margin-top:4px}
.cells{display:flex;flex-wrap:wrap;gap:4px}
.cell{width:22px;height:30px;border-radius:4px;background:var(--line);border:0;padding:0;cursor:pointer}
.cell.ok{background:var(--ok)}
.cell:hover{transform:translateY(-2px)}
@media (prefers-reduced-motion:reduce){.cell:hover{transform:none}}
.btn{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);background:var(--surface);padding:7px 13px;border-radius:var(--r-s);cursor:pointer;font-weight:600;white-space:nowrap}
.btn:hover{border-color:var(--ink-3)}
.btn.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}
.btn.primary:hover{filter:brightness(1.07)}
.btn.ghost{border-color:transparent;background:none;color:var(--ink-2)}
.btn.danger{color:var(--danger)}
.btn:disabled{opacity:.5;cursor:default}
.bar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 10px;flex-wrap:wrap}
.bar .hint{color:var(--ink-3);font-size:13px}
.search{min-width:220px;padding:7px 11px;border:1px solid var(--line);border-radius:var(--r-s);background:var(--surface)}
.list{background:var(--surface);border:1px solid var(--line);border-radius:var(--r-m);overflow:hidden}
.row{display:grid;grid-template-columns:minmax(180px,1.4fr) minmax(150px,1fr) 120px minmax(140px,1.2fr) 230px;gap:14px;align-items:center;padding:12px 18px;border-top:1px solid var(--line-2)}
.row:first-child{border-top:0}
.list.staff .row{grid-template-columns:minmax(180px,1.3fr) minmax(120px,.8fr) 220px minmax(160px,1.6fr)}
.list.roles .row{grid-template-columns:minmax(180px,1.3fr) 110px minmax(200px,2fr) 120px}
.row.head{color:var(--ink-3);font-size:12px;font-weight:600;padding-top:10px;padding-bottom:10px;background:var(--paper)}
.name{font-weight:600}
.sub{color:var(--ink-3);font-size:12.5px}
.phone{font-variant-numeric:tabular-nums}
.status{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;padding:3px 9px;border-radius:999px}
.status::before{content:"";width:7px;height:7px;border-radius:50%;background:currentColor}
.status.ok{color:var(--ok);background:var(--ok-soft)}.status.off{color:var(--warn);background:var(--warn-soft)}
.chips{display:flex;flex-wrap:wrap;gap:4px}
.chip{font-size:12px;padding:2px 8px;border-radius:999px;background:var(--accent-soft);color:var(--accent);font-weight:600}
.chip.none{background:var(--line-2);color:var(--ink-3)}
.acts{display:flex;gap:4px;justify-content:flex-end}
select.role{padding:6px 9px;border:1px solid var(--line);border-radius:var(--r-s);background:var(--surface);width:100%}
.empty{padding:48px 24px;text-align:center;color:var(--ink-2)}
.empty strong{display:block;color:var(--ink);font-size:16px;margin-bottom:6px}
.empty .btn{margin-top:14px}
/* Sağdan açılan panel */
.scrim{position:fixed;inset:0;background:var(--scrim);display:none}
.scrim.open{display:block}
.sheet{position:fixed;top:0;right:0;bottom:0;width:min(420px,100%);background:var(--surface);box-shadow:var(--shadow);transform:translateX(100%);transition:transform .22s ease;display:flex;flex-direction:column}
.sheet.open{transform:none}
@media (prefers-reduced-motion:reduce){.sheet{transition:none}}
.sheet header{display:flex;justify-content:space-between;align-items:flex-start;padding:20px 22px 12px;border-bottom:1px solid var(--line-2)}
.sheet h2{margin:0;font-size:17px}
.sheet .body{padding:18px 22px;overflow:auto;flex:1}
.sheet footer{padding:14px 22px;border-top:1px solid var(--line-2);display:flex;justify-content:flex-end;gap:8px}
label.field{display:block;margin-bottom:14px;font-weight:600;font-size:13px}
label.field input{display:block;width:100%;margin-top:6px;padding:9px 11px;border:1px solid var(--line);border-radius:var(--r-s);background:var(--paper)}
.check{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--line-2);cursor:pointer}
.check:last-child{border-bottom:0}
.check input{width:16px;height:16px;accent-color:var(--accent)}
.steps{margin:0 0 14px;padding-left:20px;color:var(--ink-2)}
.qr{display:grid;place-items:center;min-height:280px;border-radius:var(--r-m);background:#fff;border:1px solid var(--line)}
.qr img{width:256px;height:256px;image-rendering:pixelated}
.qr p{color:#4a5d72;padding:0 20px;text-align:center}
.done{color:var(--ok);font-weight:700;font-size:16px}
.note{font-size:12.5px;color:var(--ink-3);margin-top:10px}
.toast{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);background:var(--ink);color:var(--paper);padding:10px 16px;border-radius:var(--r-s);box-shadow:var(--shadow);display:none;max-width:min(560px,92vw);white-space:pre-line}
.toast.show{display:block}
.toast.err{background:var(--danger)}
.range{display:inline-flex;gap:2px;background:var(--surface);border:1px solid var(--line);border-radius:var(--r-s);padding:2px}
.range button{border:0;background:none;padding:5px 11px;border-radius:5px;cursor:pointer;color:var(--ink-2);font-weight:600}
.range button[aria-pressed=true]{background:var(--accent-soft);color:var(--accent)}
.facts{display:flex;gap:28px;flex-wrap:wrap;background:var(--surface);border:1px solid var(--line);border-radius:var(--r-m);padding:16px 20px;margin-bottom:18px}
.fact b{display:block;font-size:24px;line-height:1.1;letter-spacing:-.02em}.fact span{color:var(--ink-2);font-size:13px}
.fact.alert b{color:var(--danger)}
h3.section{font-size:15px;margin:22px 0 8px}
.list.perf .row{grid-template-columns:minmax(180px,1.4fr) minmax(120px,1fr) 130px 130px}
.list.waiting .row{grid-template-columns:minmax(180px,1.4fr) minmax(140px,1fr) 160px}
.list.hot .row{grid-template-columns:minmax(180px,1.2fr) 110px minmax(240px,2.4fr)}
.late{color:var(--danger);font-weight:700}
.score{font-weight:700;font-variant-numeric:tabular-nums}
.temp-sıcak{color:var(--danger)}.temp-ılık{color:var(--warn)}.temp-soğuk{color:var(--ink-3)}
.setting{display:grid;grid-template-columns:1fr auto;gap:16px;align-items:center;padding:16px 20px;border-top:1px solid var(--line-2)}
.setting:first-child{border-top:0}.setting strong{display:block}.setting p{margin:2px 0 0;color:var(--ink-2);font-size:13px;max-width:62ch}
.switch{position:relative;width:42px;height:24px}.switch input{opacity:0;width:0;height:0}
.switch span{position:absolute;inset:0;background:var(--line);border-radius:999px;cursor:pointer;transition:background .15s}
.switch span::after{content:"";position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;transition:transform .15s}
.switch input:checked+span{background:var(--accent)}.switch input:checked+span::after{transform:translateX(18px)}
.switch input:focus-visible+span{outline:2px solid var(--accent);outline-offset:2px}
.num{width:90px;padding:7px 9px;border:1px solid var(--line);border-radius:var(--r-s);background:var(--paper)}
.callout{background:var(--warn-soft);color:var(--warn);border-radius:var(--r-m);padding:12px 16px;margin-bottom:14px;font-weight:600}
@media (max-width:820px){
  .top,main{padding-left:16px;padding-right:16px}
  .board{grid-template-columns:1fr}
  .row{grid-template-columns:1fr;gap:6px}
  .row.head{display:none}
  .acts{justify-content:flex-start}
}
</style></head><body>
<div class="top">
  <div><h1>WhatsApp hatları</h1><p>${escapeHtml(domain)}</p></div>
  <div class="tabs" role="tablist">
    <button role="tab" data-tab="connections" aria-selected="true">Bağlantılar</button>
    <button role="tab" data-tab="staff" aria-selected="false">Personel</button>
    <button role="tab" data-tab="roles" aria-selected="false">Roller</button>
    <button role="tab" data-tab="perf" aria-selected="false">Performans</button>
    <button role="tab" data-tab="settings" aria-selected="false">Ayarlar</button>
  </div>
</div>
<main id="main" aria-live="polite"><p class="sub">Yükleniyor…</p></main>
<div class="scrim" id="scrim"></div>
<aside class="sheet" id="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title"></aside>
<div class="toast" id="toast" role="status"></div>
<script>
const T=${JSON.stringify(ticket)};
let S={connections:[],roles:[],users:[]},tab="connections",poll=null,filter="";
const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
const phone=p=>p?"+"+String(p).replace(/^(\\d{2})(\\d{3})(\\d{3})(\\d{2})(\\d{2})$/,"$1 $2 $3 $4 $5"):"";
async function api(path,body={}){const r=await fetch("/b24/panel/"+path,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...body,t:T})});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(r.status===401?"Oturum süresi doldu. Sayfayı yenileyin.":(j.message||"İşlem tamamlanamadı."));return j;}
let toastTimer;function toast(msg,err){const t=$("#toast");t.textContent=msg;t.className="toast show"+(err?" err":"");clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.className="toast",err?7000:3200);}
function warn(w){if(w&&w.length)toast(w.join("\\n"),true);}
async function load(){try{S=await api("state");render();}catch(e){$("#main").innerHTML='<div class="empty"><strong>Panel yüklenemedi</strong>'+esc(e.message)+'</div>';}}
document.querySelectorAll(".tabs button").forEach(b=>b.onclick=()=>{tab=b.dataset.tab;document.querySelectorAll(".tabs button").forEach(x=>x.setAttribute("aria-selected",String(x===b)));filter="";render();});
function rolesFor(line){return S.roles.filter(r=>r.lines==="all"||r.lines.includes(line));}
function roleOfUser(u){return S.roles.find(r=>r.id===u.roleId)||S.roles.find(r=>r.isDefault);}
function chips(list,emptyText){return list.length?'<div class="chips">'+list.map(x=>'<span class="chip">'+esc(x)+'</span>').join("")+'</div>':'<div class="chips"><span class="chip none">'+esc(emptyText)+'</span></div>';}
function render(){
  const m=$("#main");
  if(tab==="connections"){
    const ok=S.connections.filter(c=>c.status==="connected").length,total=S.connections.length;
    const q=filter.toLowerCase();
    const list=S.connections.filter(c=>!q||(c.name+" "+c.phone+" "+c.profileName).toLowerCase().includes(q));
    m.innerHTML=(total?'<section class="board" aria-label="Hat durumu"><div><div class="count">'+ok+' <small>/ '+total+'</small></div><div class="caption">numara bağlı</div></div><div class="cells">'+S.connections.map(c=>'<button class="cell'+(c.status==="connected"?" ok":"")+'" title="'+esc(c.name+(c.phone?" · "+phone(c.phone):" · bağlı değil"))+'" aria-label="'+esc(c.name)+'" data-qr="'+esc(c.line)+'"></button>').join("")+'</div><button class="btn primary" id="add">Numara ekle</button></section>':'')
      +(total?'<div class="bar"><input class="search" id="search" placeholder="Ad veya numara ara" value="'+esc(filter)+'"><span class="hint">Her numara Bitrix\\'te ayrı bir Açık Kanal\\'dır. Sohbetleri yalnız o numaraya yetkili personel alır.</span></div>'
      +'<div class="list" role="table"><div class="row head" role="row"><span>Bağlantı</span><span>Numara</span><span>Durum</span><span>Erişen roller</span><span></span></div>'
      +list.map(c=>'<div class="row" role="row"><div><div class="name">'+esc(c.name)+'</div><div class="sub">Açık Kanal #'+esc(c.line)+'</div></div><div><div class="phone">'+(c.phone?esc(phone(c.phone)):'<span class="sub">Henüz okutulmadı</span>')+'</div>'+(c.profileName?'<div class="sub">'+esc(c.profileName)+'</div>':'')+'</div><div><span class="status '+(c.status==="connected"?"ok":"off")+'">'+(c.status==="connected"?"Bağlı":"Bağlı değil")+'</span></div><div>'+chips(rolesFor(c.line).map(r=>r.name),"Rol yok")+'</div><div class="acts"><button class="btn'+(c.status==="connected"?"":" primary")+'" data-qr="'+esc(c.line)+'">'+(c.status==="connected"?"Yeniden bağla":"QR okut")+'</button><button class="btn ghost" data-edit="'+esc(c.line)+'" aria-label="'+esc(c.name)+' düzenle">Düzenle</button></div></div>').join("")
      +(list.length?'':'<div class="empty">Aramayla eşleşen numara yok.</div>')+'</div>'
      :'<div class="list"><div class="empty"><strong>İlk WhatsApp numaranızı bağlayın</strong>Numara eklediğinizde Bitrix\\'te onun için bir Açık Kanal açılır ve QR kodu gösterilir.<br><button class="btn primary" id="add">Numara ekle</button></div></div>');
    $("#add").onclick=()=>connForm();
    const s=$("#search");if(s){s.oninput=()=>{filter=s.value;const pos=s.selectionStart;render();const n=$("#search");n.focus();n.setSelectionRange(pos,pos);};}
    m.querySelectorAll("[data-qr]").forEach(b=>b.onclick=()=>qr(b.dataset.qr));
    m.querySelectorAll("[data-edit]").forEach(b=>b.onclick=()=>connForm(S.connections.find(c=>c.line===b.dataset.edit)));
  }
  if(tab==="staff"){
    if(!S.roles.length){m.innerHTML='<div class="list"><div class="empty"><strong>Önce bir rol oluşturun</strong>Rol, personelin hangi numaraların sohbetlerini alacağını belirler.<br><button class="btn primary" id="goRoles">Rol oluştur</button></div></div>';$("#goRoles").onclick=()=>{document.querySelector('[data-tab=roles]').click();};return;}
    const q=filter.toLowerCase();const users=S.users.filter(u=>!q||(u.name+" "+u.email+" "+u.position).toLowerCase().includes(q));
    const def=S.roles.find(r=>r.isDefault);
    const opts=id=>'<option value="">'+(def?"Varsayılan ("+esc(def.name)+")":"Rol yok")+'</option>'+S.roles.map(r=>'<option value="'+esc(r.id)+'"'+(r.id===id?" selected":"")+'>'+esc(r.name)+'</option>').join("");
    m.innerHTML='<div class="bar"><input class="search" id="search" placeholder="Personel ara" value="'+esc(filter)+'"><span class="hint">'+S.users.length+' çalışan</span></div><div class="list staff" role="table"><div class="row head" role="row"><span>Personel</span><span>Pozisyon</span><span>Rol</span><span>Görebildiği numaralar</span></div>'
      +users.map(u=>{const role=roleOfUser(u);const nums=!role?[]:role.lines==="all"?["Tüm numaralar"]:S.connections.filter(c=>role.lines.includes(c.line)).map(c=>c.name);
        return '<div class="row" role="row"><div><div class="name">'+esc(u.name)+'</div><div class="sub">'+esc(u.email||"E-posta yok")+'</div></div><div class="sub">'+esc(u.position||"—")+'</div><div><select class="role" data-user="'+esc(u.id)+'" aria-label="'+esc(u.name)+' rolü">'+opts(u.roleId)+'</select></div><div>'+chips(nums,"Hiçbiri")+'</div></div>';}).join("")
      +(users.length?'':'<div class="empty">Aramayla eşleşen personel yok.</div>')+'</div>';
    const s=$("#search");s.oninput=()=>{filter=s.value;const pos=s.selectionStart;render();const n=$("#search");n.focus();n.setSelectionRange(pos,pos);};
    m.querySelectorAll("[data-user]").forEach(sel=>sel.onchange=async()=>{sel.disabled=true;try{const r=await api("user/role",{userId:sel.dataset.user,roleId:sel.value});warn(r.warnings);if(!(r.warnings||[]).length)toast("Rol güncellendi.");await load();}catch(e){toast(e.message,true);sel.disabled=false;}});
  }
  if(tab==="perf"){perf();return;}
  if(tab==="settings"){
    const st=S.settings||{translate:true,transcribe:true,qualify:true,slaMinutes:15};
    const sw=(id,on)=>'<label class="switch"><input type="checkbox" id="'+id+'"'+(on?" checked":"")+'><span></span></label>';
    m.innerHTML=(S.aiConfigured?'':'<div class="callout">Yapay zekâ özellikleri için sunucuda OpenAI anahtarı tanımlı olmalı. Anahtar girilene kadar çeviri, ses ve nitelendirme çalışmaz.</div>')
      +'<div class="list">'
      +'<div class="setting"><div><strong>Otomatik çeviri</strong><p>Türkçe olmayan mesajlar Türkçe çevirisi ve orijinaliyle gösterilir. Cevabınız müşterinin dilinde gider. Çevirmeden göndermek için mesajı ! ile başlatın.</p></div>'+sw("s-tr",st.translate)+'</div>'
      +'<div class="setting"><div><strong>Sesli mesajı yazıya dök</strong><p>Gelen sesli mesajlar dinlemeden okunabilir; ses dosyası da sohbette kalır.</p></div>'+sw("s-tx",st.transcribe)+'</div>'
      +'<div class="setting"><div><strong>Müşteri nitelendirme</strong><p>Birkaç mesajda bir sohbetten bütçe, bölge, oda sayısı ve amaç çıkarılır; puan ve özet Bitrix lead kartının zaman akışına yazılır.</p></div>'+sw("s-q",st.qualify)+'</div>'
      +'<div class="setting"><div><strong>Cevap süresi hedefi</strong><p>Bu süreden uzun bekleyen sohbetler Performans sekmesinde geciken olarak işaretlenir.</p></div><div><input class="num" type="number" min="1" max="1440" id="s-sla" value="'+st.slaMinutes+'"> dk</div></div>'
      +'</div><div class="bar" style="margin-top:14px;justify-content:flex-end"><button class="btn primary" id="s-save">Ayarları kaydet</button></div>';
    $("#s-save").onclick=async()=>{try{const r=await api("settings/save",{translate:$("#s-tr").checked,transcribe:$("#s-tx").checked,qualify:$("#s-q").checked,slaMinutes:Number($("#s-sla").value)});S.settings=r.settings;toast("Ayarlar kaydedildi.");}catch(e){toast(e.message,true);}};
    return;
  }
  if(tab==="roles"){
    m.innerHTML=S.roles.length?'<div class="bar"><span class="hint">Personel yalnız rolündeki numaraların sohbetlerini alır.</span><button class="btn primary" id="addRole">Rol oluştur</button></div><div class="list roles" role="table"><div class="row head" role="row"><span>Rol</span><span>Personel</span><span>Numaralar</span><span></span></div>'
      +S.roles.map(r=>{const count=S.users.filter(u=>u.roleId===r.id||(!u.roleId&&r.isDefault)).length;const nums=r.lines==="all"?["Tüm numaralar"]:S.connections.filter(c=>r.lines.includes(c.line)).map(c=>c.name);
        return '<div class="row" role="row"><div><div class="name">'+esc(r.name)+'</div>'+(r.isDefault?'<div class="sub">Rol atanmamış personelin varsayılanı</div>':'')+'</div><div>'+count+' kişi</div><div>'+chips(nums,"Hiçbiri")+'</div><div class="acts"><button class="btn" data-role="'+esc(r.id)+'">Düzenle</button></div></div>';}).join("")+'</div>'
      :'<div class="list"><div class="empty"><strong>Henüz rol yok</strong>Rol oluşturana kadar Bitrix\\'teki Açık Kanal operatörlerine dokunulmaz.<br><button class="btn primary" id="addRole">Rol oluştur</button></div></div>';
    $("#addRole").onclick=()=>roleForm();
    m.querySelectorAll("[data-role]").forEach(b=>b.onclick=()=>roleForm(S.roles.find(r=>r.id===b.dataset.role)));
  }
}
let perfDays=7;
const dur=sec=>sec==null?"—":sec<60?sec+" sn":sec<3600?Math.round(sec/60)+" dk":(sec/3600).toFixed(1).replace(".",",")+" sa";
const userName=id=>{const u=S.users.find(x=>x.id===String(id));return u?u.name:(id==="0"?"Bilinmeyen":"Kullanıcı #"+id);};
const lineName=l=>{const c=S.connections.find(x=>x.line===String(l));return c?c.name:"Silinmiş bağlantı (#"+l+")";};
async function perf(){
  const m=$("#main");m.innerHTML='<p class="sub">Yükleniyor…</p>';
  let d;try{d=await api("stats",{days:perfDays});}catch(e){m.innerHTML='<div class="empty"><strong>Veriler alınamadı</strong>'+esc(e.message)+'</div>';return;}
  if(tab!=="perf")return;
  const late=d.waiting.filter(w=>w.late).length;
  const totalIn=d.lines.reduce((a,l)=>a+l.inbound,0),totalNew=d.lines.reduce((a,l)=>a+l.newChats,0);
  const resp=d.agents.filter(a=>a.avgSec!=null);const avg=resp.length?Math.round(resp.reduce((a,x)=>a+x.avgSec*1,0)/resp.length):null;
  m.innerHTML='<div class="bar"><div class="range" role="group" aria-label="Dönem">'+[[1,"Bugün"],[7,"7 gün"],[30,"30 gün"]].map(([v,t])=>'<button data-days="'+v+'" aria-pressed="'+(v===perfDays)+'">'+t+'</button>').join("")+'</div><span class="hint">Cevap süresi hedefi: '+d.slaMinutes+' dk</span></div>'
    +'<div class="facts"><div class="fact'+(late?" alert":"")+'"><b>'+d.waiting.length+'</b><span>yanıt bekleyen'+(late?' · '+late+' tanesi gecikti':'')+'</span></div><div class="fact"><b>'+dur(avg)+'</b><span>ortalama ilk cevap</span></div><div class="fact"><b>'+totalNew+'</b><span>yeni sohbet</span></div><div class="fact"><b>'+totalIn+'</b><span>gelen mesaj</span></div><div class="fact"><b>'+d.foreign+'</b><span>yabancı dilde sohbet</span></div></div>'
    +'<h3 class="section">Yanıt bekleyenler</h3>'+(d.waiting.length?'<div class="list waiting"><div class="row head"><span>Müşteri</span><span>Numara</span><span>Bekliyor</span></div>'+d.waiting.map(w=>'<div class="row"><div><div class="name">'+esc(w.name||phone(w.phone))+'</div><div class="sub">'+esc(phone(w.phone))+'</div></div><div>'+esc(lineName(w.line))+'</div><div class="'+(w.late?"late":"")+'">'+dur(w.waitingMinutes*60)+'</div></div>').join("")+'</div>':'<div class="list"><div class="empty">Cevap bekleyen sohbet yok.</div></div>')
    +'<h3 class="section">Temsilciler</h3>'+(d.agents.length?'<div class="list perf"><div class="row head"><span>Temsilci</span><span>Gönderilen mesaj</span><span>Ort. ilk cevap</span><span>En uzun bekleme</span></div>'+d.agents.sort((a,b)=>(a.avgSec??1e9)-(b.avgSec??1e9)).map(a=>'<div class="row"><div class="name">'+esc(userName(a.id))+'</div><div>'+a.replies+'</div><div'+(a.avgSec!=null&&a.avgSec>d.slaMinutes*60?' class="late"':'')+'>'+dur(a.avgSec)+'</div><div>'+dur(a.maxSec)+'</div></div>').join("")+'</div>':'<div class="list"><div class="empty">Bu dönemde temsilci cevabı yok.</div></div>')
    +'<h3 class="section">Sıcak müşteriler</h3>'+(d.hot.length?'<div class="list hot"><div class="row head"><span>Müşteri</span><span>Puan</span><span>Özet</span></div>'+d.hot.map(h=>'<div class="row"><div><div class="name">'+esc(h.name||phone(h.phone))+'</div><div class="sub">'+esc(lineName(h.line))+(h.lang&&h.lang!=="tr"?' · '+esc(h.lang.toUpperCase()):'')+'</div></div><div class="score temp-'+esc(h.temperature)+'">'+h.score+' · '+esc(h.temperature)+'</div><div class="sub">'+esc(h.summary)+'</div></div>').join("")+'</div>':'<div class="list"><div class="empty">Henüz nitelendirilmiş müşteri yok. Birkaç mesajlık sohbetlerden sonra burada görünür.</div></div>')
    +'<h3 class="section">Numaralar</h3>'+(d.lines.length?'<div class="list perf"><div class="row head"><span>Numara</span><span>Yeni sohbet</span><span>Gelen</span><span>Giden</span></div>'+d.lines.map(l=>'<div class="row"><div class="name">'+esc(lineName(l.line))+'</div><div>'+l.newChats+'</div><div>'+l.inbound+'</div><div>'+l.outbound+'</div></div>').join("")+'</div>':'<div class="list"><div class="empty">Bu dönemde mesaj yok.</div></div>');
  m.querySelectorAll("[data-days]").forEach(b=>b.onclick=()=>{perfDays=Number(b.dataset.days);perf();});
}
let lastFocus=null;
function openSheet(title,body,footer){lastFocus=document.activeElement;$("#sheet").innerHTML='<header><h2 id="sheet-title">'+title+'</h2><button class="btn ghost" id="sheetClose" aria-label="Kapat">Kapat</button></header><div class="body">'+body+'</div>'+(footer?'<footer>'+footer+'</footer>':'');$("#sheet").classList.add("open");$("#scrim").classList.add("open");$("#sheetClose").onclick=closeSheet;const f=$("#sheet input");(f||$("#sheetClose")).focus();}
function closeSheet(){$("#sheet").classList.remove("open");$("#scrim").classList.remove("open");if(poll){clearInterval(poll);poll=null;}if(lastFocus)lastFocus.focus();}
$("#scrim").onclick=closeSheet;document.addEventListener("keydown",e=>{if(e.key==="Escape"&&$("#sheet").classList.contains("open"))closeSheet();});
function connForm(c){
  const editing=Boolean(c);
  openSheet(editing?esc(c.name):"Numara ekle",
    '<label class="field">Bağlantı adı<input id="cn" maxlength="80" placeholder="ör. Satış 7124" value="'+esc(c?c.name:"")+'"></label>'+(editing?'<p class="sub">Açık Kanal #'+esc(c.line)+(c.phone?' · '+esc(phone(c.phone)):'')+'</p>':'<p class="sub">Kaydedince Bitrix\\'te bu numara için bir Açık Kanal açılır ve QR kodu gösterilir.</p>')
    +(editing?'<p class="note">Bağlantıyı silmek WhatsApp oturumunu kapatır. Bitrix\\'teki Açık Kanal ve sohbet geçmişi silinmez.</p>':''),
    (editing?(c.status==="connected"?'<button class="btn" id="off">Bağlantıyı kes</button>':'')+'<button class="btn danger" id="del">Sil</button>':'')+'<button class="btn primary" id="save">'+(editing?"Kaydet":"Ekle ve QR okut")+'</button>');
  $("#cn").onkeydown=e=>{if(e.key==="Enter")$("#save").click();};
  $("#save").onclick=async()=>{const name=$("#cn").value.trim();if(!name){$("#cn").focus();return;}$("#save").disabled=true;
    try{if(editing){await api("connection/rename",{line:c.line,name});closeSheet();toast("Kaydedildi.");load();}else{const r=await api("connection/add",{name});await load();qr(r.line);}}catch(e){toast(e.message,true);$("#save").disabled=false;}};
  if(editing&&$("#off"))$("#off").onclick=async()=>{try{await api("connection/disconnect",{line:c.line});closeSheet();toast("Bağlantı kesildi.");load();}catch(e){toast(e.message,true);}};
  if(editing)$("#del").onclick=async()=>{if(!confirm(c.name+" silinsin mi?"))return;try{await api("connection/delete",{line:c.line});closeSheet();toast("Silindi.");load();}catch(e){toast(e.message,true);}};
}
function roleForm(role){
  const r=role||{id:"",name:"",lines:[],isDefault:false};const all=r.lines==="all";
  openSheet(role?"Rolü düzenle":"Rol oluştur",
    '<label class="field">Rol adı<input id="rn" maxlength="60" placeholder="ör. Satış ekibi" value="'+esc(r.name)+'"></label><p class="sub" style="margin:0 0 6px;font-weight:600">Görebileceği numaralar</p>'
    +'<label class="check"><input type="checkbox" id="rall"'+(all?" checked":"")+'> Tüm numaralar</label><div id="rlines">'
    +S.connections.map(c=>'<label class="check"><input type="checkbox" value="'+esc(c.line)+'"'+(!all&&r.lines.includes(c.line)?" checked":"")+(all?" disabled":"")+'> <span>'+esc(c.name)+' <span class="sub">'+esc(phone(c.phone))+'</span></span></label>').join("")+'</div>'
    +'<label class="check" style="margin-top:12px"><input type="checkbox" id="rdef"'+(r.isDefault?" checked":"")+'> Rol atanmamış personel bu rolü alsın</label>',
    (role?'<button class="btn danger" id="rdel">Sil</button>':'')+'<button class="btn primary" id="rs">Kaydet</button>');
  $("#rall").onchange=()=>document.querySelectorAll("#rlines input").forEach(i=>i.disabled=$("#rall").checked);
  $("#rs").onclick=async()=>{const name=$("#rn").value.trim();if(!name){$("#rn").focus();return;}const lines=$("#rall").checked?"all":[...document.querySelectorAll("#rlines input:checked")].map(i=>i.value);$("#rs").disabled=true;
    try{const res=await api("role/save",{id:r.id,name,lines,isDefault:$("#rdef").checked});closeSheet();if((res.warnings||[]).length)warn(res.warnings);else toast("Rol kaydedildi.");load();}catch(e){toast(e.message,true);$("#rs").disabled=false;}};
  if(role)$("#rdel").onclick=async()=>{if(!confirm(r.name+" rolü silinsin mi?"))return;try{const res=await api("role/delete",{id:r.id});closeSheet();warn(res.warnings);load();}catch(e){toast(e.message,true);}};
}
async function qr(line){
  const c=S.connections.find(x=>x.line===String(line))||{name:"WhatsApp",line};
  openSheet(esc(c.name)+" · QR okut",'<ol class="steps"><li>Telefonda WhatsApp\\'ı açın.</li><li>Ayarlar → Bağlı cihazlar → Cihaz bağla.</li><li>Aşağıdaki kodu okutun.</li></ol><div class="qr" id="qrbox"><p>QR hazırlanıyor…</p></div><p class="note">Kod yaklaşık 20 saniyede bir yenilenir. Bu numara başka bir uygulamaya (ör. WhatCRM) bağlıysa önce oradan çıkış yapın; aksi halde mesajlar iki kez düşer.</p>');
  const tick=async()=>{try{const s=await api("connection/status",{line});
      if(s.status==="connected"){$("#qrbox").innerHTML='<p class="done">Bağlandı · '+esc(phone(s.phone))+'</p>';clearInterval(poll);poll=null;toast(c.name+" bağlandı.");setTimeout(()=>{closeSheet();load();},1400);return;}
      const q=await api("connection/qr",{line});$("#qrbox").innerHTML=q.qr?'<img alt="WhatsApp QR kodu" src="'+esc(q.qr)+'">':'<p>'+esc(q.message||"QR henüz hazır değil.")+'</p>';
    }catch(e){$("#qrbox").innerHTML='<p>'+esc(e.message)+'</p>';}};
  await tick();if($("#sheet").classList.contains("open")&&!poll)poll=setInterval(tick,5000);
}
load();
</script></body></html>`;
}
