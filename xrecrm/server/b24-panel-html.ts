// XRE WhatsApp yönetim paneli (Bitrix24 içinde açılır). Derleme gerektirmeyen
// tek sayfa; verileri /b24/panel/* uçlarından bilet ile alır.
import { localizeHtml, type Lang } from "./b24-i18n.js";

const escapeHtml = (v: string) =>
  v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export const PANEL_STYLE = `
:root{
  --paper:#f4f7fa;--surface:#ffffff;--ink:#10243a;--ink-2:#4a5d72;--ink-3:#7d8ea1;--line:#dfe6ee;--line-2:#eef2f6;
  --accent:#0f7f86;--accent-ink:#ffffff;--accent-soft:#e3f3f3;--ok:#1d9b50;--ok-soft:#e4f5ea;--warn:#b86e00;--warn-soft:#fbf0dc;
  --danger:#bb3a33;--danger-soft:#fbe9e7;--scrim:rgba(16,36,58,.38);--shadow:0 18px 50px rgba(16,36,58,.18);
  --r-s:6px;--r-m:10px;--c-in:#00a0ab;--c-out:#5654d9;
}
@media (prefers-color-scheme:dark){:root{
  --paper:#0f1a26;--surface:#162434;--ink:#e6edf4;--ink-2:#a9b8c7;--ink-3:#7a8ca0;--line:#25384c;--line-2:#1c2d3f;
  --accent:#3bb7bc;--accent-ink:#06222a;--accent-soft:#163c43;--ok:#43c979;--ok-soft:#173a29;--warn:#e7a64a;--warn-soft:#3b2d16;
  --danger:#ef7b73;--danger-soft:#3d1f1d;--scrim:rgba(0,0,0,.55);--shadow:0 18px 50px rgba(0,0,0,.45);
  --c-in:#12939c;--c-out:#7b78ea;
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
.sheet{position:fixed;top:0;right:0;bottom:0;width:min(420px,100%);background:var(--surface);transform:translateX(100%);visibility:hidden;transition:transform .22s ease,visibility 0s .22s;display:flex;flex-direction:column}
.sheet.open{transform:none;visibility:visible;box-shadow:var(--shadow);transition:transform .22s ease}
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
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:14px}
.ccard{background:var(--surface);border:1px solid var(--line);border-radius:var(--r-m);display:flex;flex-direction:column}
.ccard.ok{border-top:3px solid var(--ok)}.ccard.off{border-top:3px solid var(--line)}
.ccard header{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:14px 16px 0}
.ccard header .name{font-size:15px}
.profile{display:flex;align-items:center;gap:10px;margin:12px 16px;padding:10px 12px;border-radius:var(--r-s);background:var(--paper)}
.avatar{width:36px;height:36px;border-radius:50%;display:grid;place-items:center;font-weight:700;font-size:13px;background:var(--accent-soft);color:var(--accent);flex:none}
.facts-dl{margin:0 16px;display:grid;grid-template-columns:auto 1fr;gap:6px 12px;font-size:13px}
.facts-dl dt{color:var(--ink-3)}.facts-dl dd{margin:0;text-align:right;font-variant-numeric:tabular-nums}
.ccard .chips{margin:12px 16px 0}
.ccard footer{display:flex;gap:6px;padding:14px 16px;margin-top:auto}
.ccard footer .btn{flex:1;justify-content:center}
.view{display:inline-flex;gap:2px;background:var(--surface);border:1px solid var(--line);border-radius:var(--r-s);padding:2px}
.view button{border:0;background:none;padding:5px 10px;border-radius:5px;cursor:pointer;color:var(--ink-2);font-weight:600}
.view button[aria-pressed=true]{background:var(--accent-soft);color:var(--accent)}
.optrow{display:grid;grid-template-columns:1fr auto;gap:12px;align-items:center;padding:12px 0;border-bottom:1px solid var(--line-2)}
.optrow strong{display:block;font-size:13.5px}.optrow p{margin:2px 0 0;color:var(--ink-3);font-size:12.5px}
.charts{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,1fr);gap:14px;margin-bottom:6px}
.chart{background:var(--surface);border:1px solid var(--line);border-radius:var(--r-m);padding:14px 16px;position:relative}
.chart h4{margin:0;font-size:14px}.chart .legend{display:flex;gap:14px;font-size:12.5px;color:var(--ink-2)}
.chart .legend i{display:inline-block;width:12px;height:3px;border-radius:2px;margin-right:6px;vertical-align:middle}
.chart-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;gap:10px}
.chart svg{width:100%;height:auto;display:block;overflow:visible}
.chart .grid line{stroke:var(--line-2)}.chart .axis text{fill:var(--ink-3);font-size:10px}
.chart .end-label{font-size:11px;font-weight:600;fill:var(--ink-2)}
.tip{position:absolute;pointer-events:none;background:var(--ink);color:var(--paper);font-size:12px;padding:7px 10px;border-radius:6px;white-space:nowrap;display:none;z-index:2;box-shadow:var(--shadow)}
.tip b{display:block;margin-bottom:2px}.tip i{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px}
.chart details{margin-top:6px;font-size:12.5px;color:var(--ink-2)}.chart details table{width:100%;border-collapse:collapse;margin-top:6px}
.chart details td,.chart details th{padding:3px 6px;text-align:right;border-bottom:1px solid var(--line-2)}.chart details th:first-child,.chart details td:first-child{text-align:left}
.list.lines .row{grid-template-columns:minmax(160px,1.4fr) repeat(6,minmax(70px,.6fr))}
select.filter{padding:6px 9px;border:1px solid var(--line);border-radius:var(--r-s);background:var(--surface)}
@media (max-width:980px){.charts{grid-template-columns:1fr}}
.lic{font-size:12.5px;font-weight:600}.lic.active,.lic.free{color:var(--ok)}.lic.trial{color:var(--warn)}.lic.expired{color:var(--danger)}.lic.new{color:var(--ink-3)}
.prices{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;margin-bottom:6px}
.price{background:var(--surface);border:1px solid var(--line);border-radius:var(--r-m);padding:14px 16px;cursor:pointer;text-align:left}
.price[aria-pressed=true]{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent) inset}
.price b{display:block;font-size:22px;letter-spacing:-.02em}.price .sub{display:block}
.price .off{display:inline-block;margin-top:6px;font-size:11.5px;font-weight:700;color:var(--ok);background:var(--ok-soft);padding:1px 7px;border-radius:999px}
.list.lic-list .row{grid-template-columns:32px minmax(180px,1.4fr) minmax(140px,1fr) 160px 160px}
.paybar{position:sticky;bottom:0;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;background:var(--surface);border:1px solid var(--line);border-radius:var(--r-m);padding:12px 16px;margin-top:12px;box-shadow:var(--shadow)}
.paybar b{font-size:18px}
.bank{background:var(--paper);border-radius:var(--r-s);padding:12px 14px;margin:10px 0;font-size:13.5px;line-height:1.7}
.bank code{font-size:14px;font-weight:700;letter-spacing:.02em;color:var(--ink)}
.formgrid{display:grid;grid-template-columns:1fr 1fr;gap:0 14px}.formgrid .full{grid-column:1/-1}
.formgrid label.field input,.formgrid label.field textarea{display:block;width:100%;margin-top:6px;padding:9px 11px;border:1px solid var(--line);border-radius:var(--r-s);background:var(--paper)}
.list.pay-list .row{grid-template-columns:140px minmax(160px,1.4fr) 120px 140px 120px}
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
.tabs{flex-wrap:wrap}
.chatframe{display:block;width:100%;height:calc(100vh - 120px);min-height:520px;border:1px solid var(--line);border-radius:var(--r-m);background:var(--surface)}
.livegrid{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);gap:14px;align-items:start}
.stack{display:grid;gap:14px}
.box{background:var(--surface);border:1px solid var(--line);border-radius:var(--r-m);padding:14px 18px}
.box h4{margin:0 0 10px;font-size:14px}
.feed{max-height:620px;overflow:auto}
.feed .item{display:grid;grid-template-columns:46px 1fr;gap:10px;padding:9px 0;border-top:1px solid var(--line-2)}
.feed .item:first-child{border-top:0}.feed time{color:var(--ink-3);font-size:12px;font-variant-numeric:tabular-nums;padding-top:2px}
.feed .msg{color:var(--ink-2);overflow-wrap:anywhere}
.who-müşteri{color:var(--c-in);font-size:12px;font-weight:700}.who-temsilci{color:var(--c-out);font-size:12px;font-weight:700}.who-asistan{color:var(--warn);font-size:12px;font-weight:700}
.who{display:flex;align-items:center;gap:10px;padding:5px 0}.dot{width:9px;height:9px;border-radius:50%;background:var(--ok);flex:none}
.pulse{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--ok);margin-right:4px;animation:pulse 1.6s infinite}
@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(29,155,80,.5)}70%{box-shadow:0 0 0 7px rgba(29,155,80,0)}100%{box-shadow:0 0 0 0 rgba(29,155,80,0)}}
@media (prefers-reduced-motion:reduce){.pulse{animation:none}}
.mini{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.mini b{display:block;font-size:20px}.mini span{color:var(--ink-2);font-size:12px}
.lead{display:flex;justify-content:space-between;gap:8px;padding:5px 0;border-top:1px solid var(--line-2)}
.src{margin:7px 0}.src div{display:flex;justify-content:space-between;gap:8px}.src i{display:block;height:7px;border-radius:4px;background:var(--c-in);margin-top:3px}
.agentgrid{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(280px,1fr);gap:18px;align-items:start}
.testbox{position:sticky;top:12px}
.chatlog{height:340px;overflow:auto;background:var(--paper);border:1px solid var(--line);border-radius:var(--r-s);padding:10px;display:flex;flex-direction:column;gap:8px;margin:8px 0}
.bubble{max-width:85%;padding:8px 11px;border-radius:12px;white-space:pre-wrap;overflow-wrap:anywhere}
.bubble.me{align-self:flex-end;background:var(--accent);color:var(--accent-ink)}.bubble.ai{align-self:flex-start;background:var(--surface);border:1px solid var(--line)}
.bubble small{display:block;margin-top:5px;color:var(--warn);font-weight:600}
.send{display:flex;gap:8px;margin-bottom:6px}.send .txt{flex:1}
.area,.txt,label.field select{display:block;width:100%;margin-top:6px;padding:9px 11px;border:1px solid var(--line);border-radius:var(--r-s);background:var(--paper);color:inherit;font:inherit}
.formgrid label.field select{display:block;width:100%}
.days{display:flex;flex-wrap:wrap;gap:4px 14px;margin-bottom:10px}
.userpick{max-height:180px;overflow:auto;border:1px solid var(--line);border-radius:var(--r-s);padding:6px 10px;background:var(--surface);columns:2}
a.btn{text-decoration:none;color:inherit}a.btn.primary{color:var(--accent-ink)}
.list.reps .row{grid-template-columns:150px 170px minmax(200px,1fr) auto}
@media (max-width:820px){.livegrid,.agentgrid{grid-template-columns:1fr}.testbox{position:static}.userpick{columns:1}}
@media (max-width:820px){
  .top,main{padding-left:16px;padding-right:16px}
  .board{grid-template-columns:1fr}
  .row{grid-template-columns:1fr;gap:6px}
  .row.head{display:none}
  .acts{justify-content:flex-start}
}
`;

export function panelHtml(ticket: string, domain: string, lang: Lang = "tr", chatUrl = "") {
  return localizeHtml(`<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>XRE WhatsApp</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Onest:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>${PANEL_STYLE}</style></head><body>
<div class="top">
  <div><h1>WhatsApp hatları</h1><p>${escapeHtml(domain)}</p></div>
  <div class="tabs" role="tablist">
    <button role="tab" data-tab="connections" aria-selected="true">Bağlantılar</button>
    <button role="tab" data-tab="chats" aria-selected="false">Sohbetler</button>
    <button role="tab" data-tab="live" aria-selected="false">Canlı</button>
    <button role="tab" data-tab="staff" aria-selected="false">Personel</button>
    <button role="tab" data-tab="roles" aria-selected="false">Roller</button>
    <button role="tab" data-tab="perf" aria-selected="false">Performans</button>
    <button role="tab" data-tab="agent" aria-selected="false">AI Asistan</button>
    <button role="tab" data-tab="reports" aria-selected="false">Raporlar</button>
    <button role="tab" data-tab="billing" aria-selected="false">Ödeme</button>
    <button role="tab" data-tab="settings" aria-selected="false">Ayarlar</button>
  </div>
</div>
<main id="main" aria-live="polite"><p class="sub">Yükleniyor…</p></main>
<div class="scrim" id="scrim"></div>
<aside class="sheet" id="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title"></aside>
<div class="toast" id="toast" role="status"></div>
<script>
const T=${JSON.stringify(ticket)},LANG=${JSON.stringify(lang)},CHAT_URL=${JSON.stringify(chatUrl)};
const TEMP={"sıcak":"Sıcak","ılık":"Ilık","soğuk":"Soğuk"};
let S={connections:[],roles:[],users:[]},tab="connections",poll=null,filter="";
const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
const phone=p=>p?"+"+String(p).replace(/^(\\d{2})(\\d{3})(\\d{3})(\\d{2})(\\d{2})$/,"$1 $2 $3 $4 $5"):"";
async function api(path,body={}){const r=await fetch("/b24/panel/"+path,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...body,t:T,lang:LANG})});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(r.status===401?"Oturum süresi doldu. Sayfayı yenileyin.":(j.message||"İşlem tamamlanamadı."));return j;}
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
      +(total?'<div class="bar"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><input class="search" id="search" placeholder="Ad veya numara ara" value="'+esc(filter)+'"><div class="view" role="group" aria-label="Görünüm"><button data-view="cards" aria-pressed="'+(view==="cards")+'">Kart</button><button data-view="list" aria-pressed="'+(view==="list")+'">Liste</button></div></div><span class="hint">Her numara Bitrix\\'te ayrı bir Açık Kanal\\'dır. Sohbetleri yalnız o numaraya yetkili personel alır.</span></div>'
      +(view==="cards"?'<div class="cards">'+list.map(card).join("")+'</div>'+(list.length?'':'<div class="list"><div class="empty">Aramayla eşleşen numara yok.</div></div>')
      :'<div class="list" role="table"><div class="row head" role="row"><span>Bağlantı</span><span>Numara</span><span>Durum</span><span>Erişen roller</span><span></span></div>'
      +list.map(c=>'<div class="row" role="row"><div><div class="name">'+esc(c.name)+'</div><div class="sub">Açık Kanal #'+esc(c.line)+'</div></div><div><div class="phone">'+(c.phone?esc(phone(c.phone)):'<span class="sub">Henüz okutulmadı</span>')+'</div>'+(c.profileName?'<div class="sub">'+esc(c.profileName)+'</div>':'')+'</div><div><span class="status '+(c.status==="connected"?"ok":"off")+'">'+(c.status==="connected"?"Bağlı":"Bağlı değil")+'</span></div><div>'+chips(rolesFor(c.line).map(r=>r.name),"Rol yok")+'</div><div class="acts"><button class="btn'+(c.status==="connected"?"":" primary")+'" data-qr="'+esc(c.line)+'">'+(c.status==="connected"?"Yeniden bağla":"QR okut")+'</button><button class="btn ghost" data-edit="'+esc(c.line)+'" aria-label="'+esc(c.name)+' ayarları">Ayarlar</button></div></div>').join("")
      +(list.length?'':'<div class="empty">Aramayla eşleşen numara yok.</div>')+'</div>')
      :'<div class="list"><div class="empty"><strong>İlk WhatsApp numaranızı bağlayın</strong>Numara eklediğinizde Bitrix\\'te onun için bir Açık Kanal açılır ve QR kodu gösterilir.<br><button class="btn primary" id="add">Numara ekle</button></div></div>');
    m.querySelectorAll("[data-view]").forEach(b=>b.onclick=()=>{view=b.dataset.view;try{localStorage.setItem("xre-wa-view",view);}catch{}render();});
    m.querySelectorAll("[data-buy]").forEach(b=>b.onclick=()=>{buySel=new Set([b.dataset.buy]);document.querySelector('[data-tab=billing]').click();});
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
  if(tab==="live"){live();return;}
  if(tab==="chats"){m.innerHTML=CHAT_URL?'<iframe class="chatframe" title="Sohbetler" src="'+esc(CHAT_URL)+'"></iframe>':'<div class="list"><div class="empty">Sohbet ekranı için sayfayı Bitrix24 içinden yeniden açın.</div></div>';return;}
  if(tab==="agent"){agent();return;}
  if(tab==="reports"){reports();return;}
  if(tab==="billing"){billing();return;}
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
let perfDays=7,perfLine="";
const dur=sec=>sec==null?"—":sec<60?sec+" sn":sec<3600?Math.round(sec/60)+" dk":(sec/3600).toFixed(1).replace(".",",")+" sa";
const userName=id=>{const u=S.users.find(x=>x.id===String(id));return u?u.name:(id==="0"?"Bilinmeyen":"Kullanıcı #"+id);};
const lineName=l=>{const c=S.connections.find(x=>x.line===String(l));return c?c.name:"Silinmiş bağlantı (#"+l+")";};
const nice=v=>{if(v<=4)return 4;const p=Math.pow(10,Math.floor(Math.log10(v)));const n=v/p;return (n<=1?1:n<=2?2:n<=5?5:10)*p;};
const fmtDay=d=>{const [y,m,dd]=d.split("-");return dd+"."+m;};
const longDay=d=>{try{return new Date(d+"T12:00:00").toLocaleDateString("tr-TR",{day:"numeric",month:"long",weekday:"short"});}catch{return d;}};
function endYs(a,b){if(Math.abs(a-b)>=13)return[a,b];const m=(a+b)/2;return a<=b?[m-7,m+7]:[m+7,m-7];}
function lineChart(el,series){
  const W=640,H=220,L=36,R=40,T=10,B=24,iw=W-L-R,ih=H-T-B;
  const max=nice(Math.max(1,...series.map(p=>Math.max(p.inbound,p.outbound))));
  const x=i=>L+(series.length<2?iw/2:i*iw/(series.length-1)),y=v=>T+ih-(v/max)*ih;
  const path=k=>series.map((p,i)=>(i?"L":"M")+x(i).toFixed(1)+" "+y(p[k]).toFixed(1)).join("");
  const ticks=[0,.25,.5,.75,1].map(f=>Math.round(max*f));
  const step=Math.max(1,Math.ceil(series.length/8));
  const last=series.length-1;
  let svg='<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Günlük gelen ve giden mesaj"><g class="grid">'+ticks.map(t=>'<line x1="'+L+'" x2="'+(W-R)+'" y1="'+y(t)+'" y2="'+y(t)+'"/>').join("")+'</g>'
    +'<g class="axis">'+ticks.map(t=>'<text x="'+(L-6)+'" y="'+(y(t)+3)+'" text-anchor="end">'+t+'</text>').join("")
    +series.map((p,i)=>(i%step===0&&last-i>=Math.ceil(step/2))||i===last?'<text x="'+x(i)+'" y="'+(H-6)+'" text-anchor="middle">'+fmtDay(p.day)+'</text>':'').join("")+'</g>'
    +'<path d="'+path("outbound")+'" fill="none" stroke="var(--c-out)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>'
    +'<path d="'+path("inbound")+'" fill="none" stroke="var(--c-in)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>'
    +'<text class="end-label" x="'+(x(last)+6)+'" y="'+endYs(y(series[last].inbound)+4,y(series[last].outbound)+4)[0]+'">'+series[last].inbound+'</text>'
    +'<text class="end-label" x="'+(x(last)+6)+'" y="'+endYs(y(series[last].inbound)+4,y(series[last].outbound)+4)[1]+'">'+series[last].outbound+'</text>'
    +'<line id="xh" y1="'+T+'" y2="'+(T+ih)+'" stroke="var(--ink-3)" stroke-width="1" visibility="hidden"/>'
    +'<circle id="mi" r="4.5" fill="var(--c-in)" stroke="var(--surface)" stroke-width="2" visibility="hidden"/><circle id="mo" r="4.5" fill="var(--c-out)" stroke="var(--surface)" stroke-width="2" visibility="hidden"/>'
    +'<rect id="hit" x="'+L+'" y="'+T+'" width="'+iw+'" height="'+ih+'" fill="transparent"/></svg><div class="tip" id="ltip"></div>';
  el.innerHTML=svg;
  const sv=el.querySelector("svg"),tip=el.querySelector("#ltip"),xh=el.querySelector("#xh"),mi=el.querySelector("#mi"),mo=el.querySelector("#mo");
  const show=i=>{const p=series[i];[xh,mi,mo].forEach(n=>n.setAttribute("visibility","visible"));xh.setAttribute("x1",x(i));xh.setAttribute("x2",x(i));mi.setAttribute("cx",x(i));mi.setAttribute("cy",y(p.inbound));mo.setAttribute("cx",x(i));mo.setAttribute("cy",y(p.outbound));
    tip.innerHTML='<b>'+esc(longDay(p.day))+'</b><div><i style="background:var(--c-in)"></i>'+p.inbound+' gelen</div><div><i style="background:var(--c-out)"></i>'+p.outbound+' giden</div>';tip.style.display="block";
    const r=sv.getBoundingClientRect(),px=x(i)/W*r.width;tip.style.left=Math.min(Math.max(8,px+12),r.width-tip.offsetWidth-8)+"px";tip.style.top="28px";};
  const hide=()=>{[xh,mi,mo].forEach(n=>n.setAttribute("visibility","hidden"));tip.style.display="none";};
  el.querySelector("#hit").addEventListener("mousemove",e=>{const r=sv.getBoundingClientRect();const vx=(e.clientX-r.left)/r.width*W;const i=Math.round((vx-L)/(iw/Math.max(1,series.length-1)));show(Math.max(0,Math.min(last,i)));});
  el.querySelector("#hit").addEventListener("mouseleave",hide);
}
function barChart(el,hours){
  const W=420,H=220,L=30,R=6,T=10,B=24,iw=W-L-R,ih=H-T-B,gap=2,bw=iw/24-gap;
  const max=nice(Math.max(1,...hours));const y=v=>T+ih-(v/max)*ih;const ticks=[0,.5,1].map(f=>Math.round(max*f));
  const bar=(v,i)=>{const x0=L+i*(bw+gap),h=Math.max(0,T+ih-y(v)),r=Math.min(4,h,bw/2);if(!h)return"";const yt=T+ih-h;
    return '<path data-h="'+i+'" d="M'+x0+' '+(T+ih)+'V'+(yt+r)+'Q'+x0+' '+yt+' '+(x0+r)+' '+yt+'H'+(x0+bw-r)+'Q'+(x0+bw)+' '+yt+' '+(x0+bw)+' '+(yt+r)+'V'+(T+ih)+'Z" fill="var(--c-in)"/>';};
  el.innerHTML='<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Gelen mesajların saat dağılımı"><g class="grid">'+ticks.map(t=>'<line x1="'+L+'" x2="'+(W-R)+'" y1="'+y(t)+'" y2="'+y(t)+'"/>').join("")+'</g><g class="axis">'+ticks.map(t=>'<text x="'+(L-5)+'" y="'+(y(t)+3)+'" text-anchor="end">'+t+'</text>').join("")
    +[0,3,6,9,12,15,18,21].map(h=>'<text x="'+(L+h*(bw+gap)+bw/2)+'" y="'+(H-6)+'" text-anchor="middle">'+String(h).padStart(2,"0")+'</text>').join("")+'</g>'
    +hours.map(bar).join("")+hours.map((v,i)=>'<rect data-h="'+i+'" x="'+(L+i*(bw+gap))+'" y="'+T+'" width="'+(bw+gap)+'" height="'+ih+'" fill="transparent"/>').join("")+'</svg><div class="tip" id="btip"></div>';
  const sv=el.querySelector("svg"),tip=el.querySelector("#btip");
  sv.querySelectorAll("rect[data-h]").forEach(rc=>{rc.addEventListener("mouseenter",()=>{const i=Number(rc.dataset.h);sv.querySelectorAll("path[data-h]").forEach(p=>p.style.opacity=p.dataset.h===rc.dataset.h?"1":".45");
    tip.innerHTML='<b>'+String(i).padStart(2,"0")+':00–'+String((i+1)%24).padStart(2,"0")+':00</b>'+hours[i]+' gelen mesaj';tip.style.display="block";const r=sv.getBoundingClientRect();const px=(L+i*(bw+gap))/W*r.width;tip.style.left=Math.min(Math.max(8,px),r.width-tip.offsetWidth-8)+"px";tip.style.top="28px";});
    rc.addEventListener("mouseleave",()=>{sv.querySelectorAll("path[data-h]").forEach(p=>p.style.opacity="1");tip.style.display="none";});});
}
async function perf(){
  const m=$("#main");m.innerHTML='<p class="sub">Yükleniyor…</p>';
  let d;try{d=await api("stats",{days:perfDays,line:perfLine});}catch(e){m.innerHTML='<div class="empty"><strong>Veriler alınamadı</strong>'+esc(e.message)+'</div>';return;}
  if(tab!=="perf")return;
  const late=d.waiting.filter(w=>w.late).length;
  const totalIn=d.series.reduce((a,p)=>a+p.inbound,0),totalOut=d.series.reduce((a,p)=>a+p.outbound,0),totalNew=d.lines.reduce((a,l)=>a+l.newChats,0);
  const resp=d.agents.filter(a=>a.avgSec!=null);const avg=resp.length?Math.round(resp.reduce((a,x)=>a+x.avgSec*1,0)/resp.length):null;
  m.innerHTML='<div class="bar"><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><div class="range" role="group" aria-label="Dönem">'+[[1,"Bugün"],[7,"7 gün"],[30,"30 gün"],[90,"90 gün"]].map(([v,t])=>'<button data-days="'+v+'" aria-pressed="'+(v===perfDays)+'">'+t+'</button>').join("")+'</div>'
      +'<select class="filter" id="pline" aria-label="Numara"><option value="">Tüm numaralar</option>'+S.connections.map(c=>'<option value="'+esc(c.line)+'"'+(c.line===perfLine?" selected":"")+'>'+esc(c.name)+'</option>').join("")+'</select></div><span class="hint">Cevap süresi hedefi: '+d.slaMinutes+' dk</span></div>'
    +'<div class="facts"><div class="fact"><b>'+totalIn+'</b><span>gelen mesaj</span></div><div class="fact"><b>'+totalOut+'</b><span>giden mesaj</span></div><div class="fact"><b>'+totalNew+'</b><span>yeni kişi</span></div><div class="fact"><b>'+dur(avg)+'</b><span>ort. ilk cevap · medyan '+dur(d.medianSec)+'</span></div><div class="fact'+(late?" alert":"")+'"><b>'+d.waiting.length+'</b><span>yanıt bekleyen'+(late?' · '+late+' gecikti':'')+'</span></div><div class="fact"><b>'+d.foreign+'</b><span>yabancı dilde sohbet</span></div></div>'
    +'<div class="charts"><section class="chart"><div class="chart-head"><h4>Günlük mesaj hacmi</h4><div class="legend"><span><i style="background:var(--c-in)"></i>Gelen</span><span><i style="background:var(--c-out)"></i>Giden</span></div></div><div id="lc" style="position:relative"></div>'
      +'<details><summary>Tablo görünümü</summary><table><tr><th>Gün</th><th>Gelen</th><th>Giden</th></tr>'+d.series.slice().reverse().map(p=>'<tr><td>'+esc(longDay(p.day))+'</td><td>'+p.inbound+'</td><td>'+p.outbound+'</td></tr>').join("")+'</table></details></section>'
    +'<section class="chart"><div class="chart-head"><h4>Gelen mesajların saat dağılımı</h4></div><div id="bc" style="position:relative"></div><details><summary>Tablo görünümü</summary><table><tr><th>Saat</th><th>Gelen</th></tr>'+d.hours.map((v,i)=>v?'<tr><td>'+String(i).padStart(2,"0")+':00</td><td>'+v+'</td></tr>':'').join("")+'</table></details></section></div>'
    +'<h3 class="section">Numara bazında</h3>'+(d.lines.length?'<div class="list lines"><div class="row head"><span>Bağlantı</span><span>Gelen</span><span>Giden</span><span>Yeni kişi</span><span>Ort. cevap</span><span>Medyan</span><span>Bekleyen</span></div>'+d.lines.sort((a,b)=>b.inbound-a.inbound).map(l=>'<div class="row"><div class="name">'+esc(lineName(l.line))+'</div><div>'+l.inbound+'</div><div>'+l.outbound+'</div><div>'+l.newChats+'</div><div'+(l.avgSec!=null&&l.avgSec>d.slaMinutes*60?' class="late"':'')+'>'+dur(l.avgSec)+'</div><div>'+dur(l.medianSec)+'</div><div'+(l.waiting?' class="late"':'')+'>'+l.waiting+'</div></div>').join("")+'</div>':'<div class="list"><div class="empty">Bu dönemde mesaj yok.</div></div>')
    +'<h3 class="section">Yanıt bekleyenler</h3>'+(d.waiting.length?'<div class="list waiting"><div class="row head"><span>Müşteri</span><span>Numara</span><span>Bekliyor</span></div>'+d.waiting.map(w=>'<div class="row"><div><div class="name">'+esc(w.name||phone(w.phone))+'</div><div class="sub">'+esc(phone(w.phone))+'</div></div><div>'+esc(lineName(w.line))+'</div><div class="'+(w.late?"late":"")+'">'+dur(w.waitingMinutes*60)+'</div></div>').join("")+'</div>':'<div class="list"><div class="empty">Cevap bekleyen sohbet yok.</div></div>')
    +'<h3 class="section">Temsilciler</h3>'+(d.agents.length?'<div class="list perf"><div class="row head"><span>Temsilci</span><span>Gönderilen mesaj</span><span>Ort. ilk cevap</span><span>En uzun bekleme</span></div>'+d.agents.sort((a,b)=>(a.avgSec??1e9)-(b.avgSec??1e9)).map(a=>'<div class="row"><div class="name">'+esc(userName(a.id))+'</div><div>'+a.replies+'</div><div'+(a.avgSec!=null&&a.avgSec>d.slaMinutes*60?' class="late"':'')+'>'+dur(a.avgSec)+'</div><div>'+dur(a.maxSec)+'</div></div>').join("")+'</div>':'<div class="list"><div class="empty">Bu dönemde temsilci cevabı yok.</div></div>')
    +'<h3 class="section">Sıcak müşteriler</h3>'+(d.hot.length?'<div class="list hot"><div class="row head"><span>Müşteri</span><span>Puan</span><span>Özet</span></div>'+d.hot.map(h=>'<div class="row"><div><div class="name">'+esc(h.name||phone(h.phone))+'</div><div class="sub">'+esc(lineName(h.line))+(h.lang&&h.lang!=="tr"?' · '+esc(h.lang.toUpperCase()):'')+'</div></div><div class="score temp-'+esc(h.temperature)+'">'+h.score+' · '+esc(TEMP[h.temperature]||h.temperature)+'</div><div class="sub">'+esc(h.summary)+'</div></div>').join("")+'</div>':'<div class="list"><div class="empty">Henüz nitelendirilmiş müşteri yok. Birkaç mesajlık sohbetlerden sonra burada görünür.</div></div>');
  lineChart($("#lc"),d.series);barChart($("#bc"),d.hours);
  m.querySelectorAll("[data-days]").forEach(b=>b.onclick=()=>{perfDays=Number(b.dataset.days);perf();});
  $("#pline").onchange=e=>{perfLine=e.target.value;perf();};
}
let buySel=new Set(),buyMonths=12,B=null,billType=null;
const money=(v,c)=>new Intl.NumberFormat("tr-TR",{style:"currency",currency:c||"TRY",maximumFractionDigits:0}).format(v);
async function billing(){
  const m=$("#main");m.innerHTML='<p class="sub">Yükleniyor…</p>';
  try{B=await api("billing/state");}catch(e){m.innerHTML='<div class="empty"><strong>Ödeme bilgileri alınamadı</strong>'+esc(e.message)+'</div>';return;}
  if(tab!=="billing")return;
  const cur=B.pricing.currency,cnt=k=>B.licenses.filter(l=>l.status===k).length;
  const period=B.periods.find(p=>p.months===buyMonths)||B.periods[0];
  const st={active:"Aktif",free:"Ücretsiz",trial:"Deneme",expired:"Süresi doldu",new:"Bağlanmadı"};
  const bi={...(B.billing||{type:"kurumsal"})};if(billType)bi.type=billType;
  m.innerHTML='<div class="facts"><div class="fact"><b>'+cnt("active")+'</b><span>aktif lisans</span></div><div class="fact"><b>'+cnt("trial")+'</b><span>denemede</span></div><div class="fact'+(cnt("expired")?" alert":"")+'"><b>'+cnt("expired")+'</b><span>süresi dolmuş</span></div><div class="fact"><b>'+B.pricing.trialDays+' gün</b><span>ücretsiz deneme, numara bağlanınca başlar</span></div></div>'
    +'<h3 class="section">Numara başına fiyat</h3><div class="prices" role="group" aria-label="Dönem">'+B.periods.map(p=>'<button class="price" data-months="'+p.months+'" aria-pressed="'+(p.months===buyMonths)+'"><span class="sub">'+(p.months===1?"Aylık":p.months+" aylık")+'</span><b>'+money(p.monthlyEquivalent,cur)+'<small class="sub" style="display:inline;font-size:13px"> / ay</small></b><span class="sub">'+(p.months>1?"dönem başına "+money(p.perLine,cur):"aylık ödeme")+'</span>'+(p.discount?'<span class="off">'+(LANG==="tr"?"%"+p.discount:p.discount+"%")+' indirim</span>':'')+'</button>').join("")+'</div>'
    +'<h3 class="section">Lisanslarım</h3>'+(B.licenses.length?'<div class="list lic-list"><div class="row head"><span></span><span>Bağlantı</span><span>Numara</span><span>Durum</span><span>Bitiş</span></div>'
      +B.licenses.map(l=>'<label class="row" style="cursor:pointer"><input type="checkbox" data-sel="'+esc(l.line)+'"'+(buySel.has(l.line)?" checked":"")+(l.status==="free"?" disabled":"")+' aria-label="'+esc(l.name)+' seç"><div class="name">'+esc(l.name)+'</div><div class="phone">'+(l.phone?esc(phone(l.phone)):'<span class="sub">—</span>')+'</div><div><span class="lic '+esc(l.status)+'">'+st[l.status]+(l.status==="trial"?" · "+l.daysLeft+" gün":"")+'</span></div><div class="sub">'+(l.until?esc(day(l.until)):"—")+'</div></label>').join("")+'</div>'
      +'<div class="paybar"><div><span class="sub">'+buySel.size+' numara · '+(buyMonths===1?"1 ay":buyMonths+" ay")+'</span><br><b>'+money(period.perLine*buySel.size,cur)+'</b></div><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="redeem"'+(buySel.size?"":" disabled")+'>Lisans kodu kullan</button><button class="btn primary" id="pay"'+(buySel.size?"":" disabled")+'>Havale ile öde</button></div></div>'
      :'<div class="list"><div class="empty">Henüz numara yok. Bağlantılar sekmesinden numara ekleyin.</div></div>')
    +'<h3 class="section">Ödeme hareketleri</h3>'+((B.payments.length||B.codes.length)?'<div class="list pay-list"><div class="row head"><span>Tarih</span><span>İşlem</span><span>Referans</span><span>Tutar</span><span>Durum</span></div>'
      +B.payments.map(p=>'<div class="row"><div class="sub">'+esc(day(p.createdAt))+'</div><div>Havale · '+p.lines.length+' numara · '+p.months+' ay</div><div><code>'+esc(p.reference)+'</code></div><div>'+money(p.amount,p.currency)+'</div><div><span class="lic '+(p.status==="approved"?"active":p.status==="pending"?"trial":"expired")+'">'+({pending:"Onay bekliyor",approved:"Onaylandı",rejected:"Reddedildi"})[p.status]+'</span></div></div>').join("")
      +B.codes.map(c=>'<div class="row"><div class="sub">'+esc(day(c.usedAt))+'</div><div>Lisans kodu · '+c.lines.length+' numara · '+c.months+' ay</div><div><code>'+esc(c.code)+'</code></div><div>—</div><div><span class="lic active">Uygulandı</span></div></div>').join("")+'</div>'
      :'<div class="list"><div class="empty">Henüz ödeme yok.</div></div>')
    +'<h3 class="section">Fatura bilgileri</h3><div class="list" style="padding:16px 20px"><div class="range" role="group" aria-label="Fatura türü" style="margin-bottom:14px"><button data-btype="kurumsal" aria-pressed="'+(bi.type!=="bireysel")+'">Kurumsal</button><button data-btype="bireysel" aria-pressed="'+(bi.type==="bireysel")+'">Bireysel</button></div>'
      +'<div class="formgrid"><label class="field full">'+(bi.type==="bireysel"?"Ad soyad":"Şirket unvanı")+'<input id="b-title" value="'+esc(bi.title||"")+'"></label><label class="field">'+(bi.type==="bireysel"?"TC kimlik no":"Vergi dairesi")+'<input id="b-office" value="'+esc(bi.type==="bireysel"?bi.taxNumber||"":bi.taxOffice||"")+'"></label>'+(bi.type==="bireysel"?'<label class="field">İl<input id="b-city" value="'+esc(bi.city||"")+'"></label>':'<label class="field">Vergi no<input id="b-no" value="'+esc(bi.taxNumber||"")+'"></label>')
      +'<label class="field full">Adres<textarea id="b-addr" rows="2">'+esc(bi.address||"")+'</textarea></label>'+(bi.type==="bireysel"?'':'<label class="field">İl<input id="b-city" value="'+esc(bi.city||"")+'"></label>')+'<label class="field">Telefon<input id="b-phone" value="'+esc(bi.phone||"")+'"></label><label class="field full">Fatura e-postası<input id="b-mail" type="email" value="'+esc(bi.email||"")+'"></label></div>'
      +'<div style="display:flex;justify-content:flex-end"><button class="btn primary" id="b-save">Fatura bilgilerini kaydet</button></div></div>';
  m.querySelectorAll("[data-months]").forEach(b=>b.onclick=()=>{buyMonths=Number(b.dataset.months);billing();});
  m.querySelectorAll("[data-sel]").forEach(c=>c.onchange=()=>{c.checked?buySel.add(c.dataset.sel):buySel.delete(c.dataset.sel);billing();});
  m.querySelectorAll("[data-btype]").forEach(b=>b.onclick=()=>{billType=b.dataset.btype;billing();});
  const lines=()=>[...buySel];
  if($("#pay"))$("#pay").onclick=async()=>{try{const r=await api("billing/request",{lines:lines(),months:buyMonths});const bank=r.bank||{};
    openSheet("Havale ile ödeme",'<p>Aşağıdaki hesaba <b>'+money(r.request.amount,r.request.currency)+'</b> gönderin. Açıklamaya referans kodunu yazmayı unutmayın.</p><div class="bank">Referans: <code>'+esc(r.request.reference)+'</code><br>Alıcı: <b>'+esc(bank.holder||"XRE")+'</b><br>'+(bank.bankName?'Banka: '+esc(bank.bankName)+'<br>':'')+'IBAN: <code>'+esc(bank.iban||"Henüz tanımlanmadı, destekle iletişime geçin")+'</code></div><p class="note">'+esc(bank.note||"")+'</p><p class="note">Ödemeniz onaylanınca '+r.request.lines.length+' numaranın lisansı '+r.request.months+' ay uzar. Onay durumu "Ödeme hareketleri" bölümünde görünür.</p>','<button class="btn primary" id="okpay">Tamam</button>');
    $("#okpay").onclick=()=>{closeSheet();billing();};}catch(e){toast(e.message,true);}};
  if($("#redeem"))$("#redeem").onclick=()=>{openSheet("Lisans kodu kullan",'<label class="field">Lisans kodu<input id="code" placeholder="ABCD-1234-EF56" autocomplete="off"></label><p class="note">Kod seçili '+buySel.size+' numaraya uygulanır.</p>','<button class="btn primary" id="apply">Uygula</button>');
    $("#apply").onclick=async()=>{try{await api("billing/redeem",{code:$("#code").value,lines:lines()});closeSheet();toast("Lisans kodu uygulandı.");buySel.clear();billing();load();}catch(e){toast(e.message,true);}};};
  $("#b-save").onclick=async()=>{const t=bi.type||"kurumsal";const v=id=>($(id)||{}).value||"";
    try{await api("billing/info",t==="bireysel"?{type:t,title:v("#b-title"),taxNumber:v("#b-office"),city:v("#b-city"),address:v("#b-addr"),phone:v("#b-phone"),email:v("#b-mail")}:{type:t,title:v("#b-title"),taxOffice:v("#b-office"),taxNumber:v("#b-no"),city:v("#b-city"),address:v("#b-addr"),phone:v("#b-phone"),email:v("#b-mail")});toast("Fatura bilgileri kaydedildi.");}catch(e){toast(e.message,true);}};
}
let view="cards";try{view=localStorage.getItem("xre-wa-view")||"cards";}catch{}
const initials=t=>String(t||"WA").trim().split(/\s+/).slice(0,2).map(w=>w[0]).join("").toLocaleUpperCase("tr-TR")||"WA";
const ago=ms=>{if(!ms)return"—";const d=Math.max(0,Date.now()-ms)/60000;if(d<1)return"az önce";if(d<60)return Math.round(d)+" dk önce";if(d<1440)return Math.round(d/60)+" sa önce";return Math.round(d/1440)+" gün önce";};
const day=iso=>{if(!iso)return"—";try{return new Date(iso).toLocaleDateString("tr-TR",{day:"numeric",month:"long",year:"numeric"});}catch{return"—";}};
function card(c){const ok=c.status==="connected";
  return '<article class="ccard '+(ok?"ok":"off")+'"><header><span class="name">'+esc(c.name)+'</span><span class="status '+(ok?"ok":"off")+'">'+(ok?"Bağlı":"Bağlı değil")+'</span></header>'
  +'<div class="profile"><span class="avatar" aria-hidden="true">'+esc(initials(c.profileName||c.name))+'</span><div><b>'+esc(c.profileName||(ok?"WhatsApp profili":"Profil bekleniyor"))+'</b><div class="sub phone">'+(c.phone?esc(phone(c.phone)):"QR okutulmadı")+'</div></div></div>'
  +'<dl class="facts-dl"><dt>Açık Kanal</dt><dd>#'+esc(c.line)+'</dd><dt>Bağlandı</dt><dd>'+(ok?day(c.connectedAt):"—")+'</dd><dt>Son mesaj</dt><dd>'+ago(c.lastMessageAt)+'</dd><dt>Bugün</dt><dd>'+(c.todayIn||0)+' gelen · '+(c.todayOut||0)+' giden</dd><dt>Sohbet</dt><dd>'+(c.chats||0)+(c.waiting?' · <span class="late">'+c.waiting+' bekliyor</span>':'')+'</dd><dt>Lisans</dt><dd>'+licText(c.license)+'</dd></dl>'
  +chips(rolesFor(c.line).map(r=>r.name),"Rol yok")
  +'<footer>'+(c.license&&c.license.status==="expired"?'<button class="btn primary" data-buy="'+esc(c.line)+'">Lisans al</button>':'<button class="btn'+(ok?"":" primary")+'" data-qr="'+esc(c.line)+'">'+(ok?"Yeniden bağla":"QR okut")+'</button>')+'<button class="btn" data-edit="'+esc(c.line)+'" aria-label="'+esc(c.name)+' ayarları">Ayarlar</button></footer></article>';}
function licText(l){if(!l)return"—";const d=l.until?day(l.until):"";
  return {free:'<span class="lic free">Ücretsiz</span>',active:'<span class="lic active">Aktif · '+esc(d)+'</span>',trial:'<span class="lic trial">Deneme · '+l.daysLeft+' gün kaldı</span>',expired:'<span class="lic expired">Süresi doldu</span>',new:'<span class="lic new">Bağlanınca deneme başlar</span>'}[l.status]||"—";}
let lastFocus=null;
function openSheet(title,body,footer){lastFocus=document.activeElement;$("#sheet").innerHTML='<header><h2 id="sheet-title">'+title+'</h2><button class="btn ghost" id="sheetClose" aria-label="Kapat">Kapat</button></header><div class="body">'+body+'</div>'+(footer?'<footer>'+footer+'</footer>':'');$("#sheet").classList.add("open");$("#scrim").classList.add("open");$("#sheetClose").onclick=closeSheet;const f=$("#sheet input");(f||$("#sheetClose")).focus();}
function closeSheet(){$("#sheet").classList.remove("open");$("#scrim").classList.remove("open");if(poll){clearInterval(poll);poll=null;}if(lastFocus)lastFocus.focus();}
$("#scrim").onclick=closeSheet;document.addEventListener("keydown",e=>{if(e.key==="Escape"&&$("#sheet").classList.contains("open"))closeSheet();});
function connForm(c){
  const editing=Boolean(c);const o=(c&&c.options)||{calls:true,groups:false,edits:true};
  const sw=(id,on)=>'<label class="switch"><input type="checkbox" id="'+id+'"'+(on?" checked":"")+'><span></span></label>';
  openSheet(editing?esc(c.name)+" · Ayarlar":"Numara ekle",
    '<label class="field">Bağlantı adı<input id="cn" maxlength="80" placeholder="ör. Satış 7124" value="'+esc(c?c.name:"")+'"></label>'
    +(editing?'<p class="sub">Açık Kanal #'+esc(c.line)+(c.phone?' · '+esc(phone(c.phone)):'')+'</p>'
      +'<div class="optrow"><div><strong>Arama bildirimleri</strong><p>Bu numaraya gelen WhatsApp aramaları sohbete not olarak düşer.</p></div>'+sw("o-calls",o.calls)+'</div>'
      +'<div class="optrow"><div><strong>Grup sohbetleri</strong><p>Numaranın üye olduğu WhatsApp grupları Açık Kanal\\'da tek sohbet olarak görünür.</p></div>'+sw("o-groups",o.groups)+'</div>'
      +'<div class="optrow"><div><strong>Silinen ve düzenlenen mesajlar</strong><p>Müşteri mesajını silerse veya düzenlerse sohbette not olarak görünür.</p></div>'+sw("o-edits",o.edits)+'</div>'
      +'<p class="note">Silmek WhatsApp oturumunu kapatır. Bitrix\\'teki Açık Kanal ve sohbet geçmişi silinmez.</p>'
      :'<p class="sub">Kaydedince Bitrix\\'te bu numara için bir Açık Kanal açılır ve QR kodu gösterilir.</p>'),
    (editing?(c.status==="connected"?'<button class="btn" id="off">Bağlantıyı kes</button>':'')+'<button class="btn danger" id="del">Sil</button>':'')+'<button class="btn primary" id="save">'+(editing?"Kaydet":"Ekle ve QR okut")+'</button>');
  $("#cn").onkeydown=e=>{if(e.key==="Enter")$("#save").click();};
  $("#save").onclick=async()=>{const name=$("#cn").value.trim();if(!name){$("#cn").focus();return;}$("#save").disabled=true;
    try{if(editing){if(name!==c.name)await api("connection/rename",{line:c.line,name});await api("connection/options",{line:c.line,calls:$("#o-calls").checked,groups:$("#o-groups").checked,edits:$("#o-edits").checked});closeSheet();toast("Kaydedildi.");load();}else{const r=await api("connection/add",{name});await load();qr(r.line);}}catch(e){toast(e.message,true);$("#save").disabled=false;}};
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
let liveTimer=null;
const clock=t=>new Date(t).toLocaleTimeString("tr-TR",{timeZone:"Europe/Istanbul",hour:"2-digit",minute:"2-digit"});
const WHO={"müşteri":"Müşteri","temsilci":"Temsilci","asistan":"AI asistan"};
async function live(silent){
  const m=$("#main");if(!silent)m.innerHTML='<p class="sub">Yükleniyor…</p>';
  let d;try{d=await api("live");}catch(e){if(!silent)m.innerHTML='<div class="empty"><strong>Canlı veriler alınamadı</strong>'+esc(e.message)+'</div>';return;}
  if(tab!=="live")return;
  const crm=d.crm,src=crm?Object.entries(crm.bySource).sort((a,b)=>b[1]-a[1]):[],maxSrc=Math.max(1,...src.map(s=>s[1]));
  const sum=o=>Object.entries(o||{}).filter(x=>x[1]).map(([c,v])=>money(v,c)).join(" + ")||"—";
  m.innerHTML='<div class="bar"><span class="hint"><span class="pulse" aria-hidden="true"></span> Canlı · her 20 saniyede yenilenir · son güncelleme '+clock(d.at)+'</span><button class="btn" id="lref">Yenile</button></div>'
    +'<div class="facts"><div class="fact"><b>'+d.online.length+'</b><span>çevrimiçi personel / '+d.totalUsers+'</span></div><div class="fact"><b>'+d.activeChats+'</b><span>aktif sohbet (15 dk)</span></div><div class="fact'+(d.waiting?" alert":"")+'"><b>'+d.waiting+'</b><span>cevap bekleyen'+(d.waiting?" · en uzun "+d.longestWaitMin+" dk":"")+'</span></div><div class="fact"><b>'+d.today.inbound+'</b><span>bugün gelen</span></div><div class="fact"><b>'+d.today.outbound+'</b><span>bugün giden</span></div><div class="fact"><b>'+d.today.newChats+'</b><span>yeni kişi</span></div>'+(d.today.aiReplies?'<div class="fact"><b>'+d.today.aiReplies+'</b><span>AI cevabı</span></div>':'')+'</div>'
    +'<div class="livegrid"><section class="box"><h4>Anlık sohbet akışı</h4>'+(d.feed.length?'<div class="feed">'+d.feed.map(f=>'<div class="item"><time>'+clock(f.at)+'</time><div><div><b>'+esc(f.name||phone(f.phone))+'</b> <span class="who-'+esc(f.from)+'">'+esc(WHO[f.from]||f.from)+'</span> <span class="sub">· '+esc(f.line)+'</span></div><div class="msg">'+esc(f.text)+'</div></div></div>').join("")+'</div>':'<div class="empty">Son 24 saatte mesaj yok.</div>')+'</section>'
    +'<div class="stack"><section class="box"><h4>Çevrimiçi ekip</h4>'+(d.online.length?d.online.map(u=>'<div class="who"><span class="dot" aria-hidden="true"></span><div><div class="name">'+esc(u.name)+'</div>'+(u.position?'<div class="sub">'+esc(u.position)+'</div>':'')+'</div></div>').join(""):'<div class="sub">Şu an çevrimiçi kimse yok.</div>')+'</section>'
    +'<section class="box"><h4>Bugün CRM</h4>'+(crm&&crm.available?'<div class="mini"><div><b>'+crm.leads.length+'</b><span>yeni lead</span></div><div><b>'+crm.deals.length+'</b><span>yeni anlaşma</span></div><div><b>'+crm.won+'</b><span>kazanılan · '+esc(sum(crm.wonAmount))+'</span></div></div>'
      +(crm.leads.length?'<div class="sub" style="margin-top:10px;font-weight:600">Son leadler</div>'+crm.leads.slice(0,6).map(l=>'<div class="lead"><span>'+esc(l.title||("Lead #"+l.id))+'</span><span class="sub">'+esc(l.source||"")+' · '+clock(Date.parse(l.at))+'</span></div>').join(""):'')
      +(crm.deals.length?'<div class="sub" style="margin-top:10px;font-weight:600">Son anlaşmalar</div>'+crm.deals.slice(0,6).map(x=>'<div class="lead"><span>'+esc(x.title||("Anlaşma #"+x.id))+'</span><span class="sub">'+(x.amount?esc(money(x.amount,x.currency)):"")+'</span></div>').join(""):'')
      :'<div class="sub">CRM verisine erişilemedi (uygulamaya CRM izni verilmiş olmalı).</div>')+'</section>'
    +'<section class="box"><h4>Bugünkü lead kaynakları</h4>'+(src.length?src.map(([n,v])=>'<div class="src"><div><span>'+esc(n)+'</span><b>'+v+'</b></div><i style="width:'+Math.max(3,v/maxSrc*100)+'%"></i></div>').join(""):'<div class="sub">Bugün lead yok.</div>')+'</section></div></div>';
  $("#lref").onclick=()=>live(true);
  if(!liveTimer)liveTimer=setInterval(()=>{if(tab==="live"&&!document.hidden)live(true);else if(tab!=="live"){clearInterval(liveTimer);liveTimer=null;}},20000);
}
let A=null,testMsgs=[];
const DAYS=[[1,"Pzt"],[2,"Sal"],[3,"Çar"],[4,"Per"],[5,"Cum"],[6,"Cmt"],[0,"Paz"]];
function agentForm(){const g=id=>$("#"+id);return{enabled:g("a-on").checked,name:g("a-name").value,company:g("a-co").value,tone:g("a-tone").value,instructions:g("a-ins").value,knowledge:g("a-kb").value,
  lines:g("a-all").checked?"all":[...document.querySelectorAll("#a-lines input:checked")].map(i=>i.value),schedule:g("a-sch").value,workStart:g("a-ws").value,workEnd:g("a-we").value,
  workDays:[...document.querySelectorAll("#a-days input:checked")].map(i=>Number(i.value)),mergeSeconds:Number(g("a-merge").value),maxReplies:Number(g("a-max").value),humanPauseHours:Number(g("a-pause").value),handoffMessage:g("a-hand").value};}
async function agent(){
  const m=$("#main");m.innerHTML='<p class="sub">Yükleniyor…</p>';
  try{A=await api("agent/state");}catch(e){m.innerHTML='<div class="empty"><strong>Asistan ayarları alınamadı</strong>'+esc(e.message)+'</div>';return;}
  if(tab!=="agent")return;
  const a=A.agent,all=a.lines==="all";
  const sw=(id,on)=>'<label class="switch"><input type="checkbox" id="'+id+'"'+(on?" checked":"")+'><span></span></label>';
  m.innerHTML=(A.aiConfigured?'':'<div class="callout">AI asistan için sunucuda OpenAI anahtarı tanımlı olmalı.</div>')
    +'<div class="facts"><div class="fact"><b>'+(a.enabled?"Açık":"Kapalı")+'</b><span>asistan durumu</span></div><div class="fact"><b>'+A.usage.today+'</b><span>bugün cevap</span></div><div class="fact"><b>'+A.usage.replies30+'</b><span>30 günde cevap</span></div><div class="fact"><b>'+A.usage.handoffs30+'</b><span>temsilciye devir</span></div></div>'
    +'<div class="agentgrid"><div>'
    +'<div class="list"><div class="setting"><div><strong>AI asistanı çalıştır</strong><p>Asistan bilgi tabanına göre müşteriye cevap verir; bilmediği, pazarlık veya randevu gerektiren konularda sohbeti temsilciye devreder. Temsilci Bitrix’ten yazdığında o sohbette susar. Verdiği her cevap Bitrix sohbetinde 🤖 notuyla görünür.</p></div>'+sw("a-on",a.enabled)+'</div></div>'
    +'<h3 class="section">Kimlik</h3><div class="formgrid"><label class="field">Asistan adı<input id="a-name" maxlength="40" value="'+esc(a.name)+'"></label><label class="field">Firma adı<input id="a-co" maxlength="80" value="'+esc(a.company)+'"></label>'
    +'<label class="field">Üslup<select id="a-tone"><option value="samimi"'+(a.tone==="samimi"?" selected":"")+'>Samimi</option><option value="resmi"'+(a.tone==="resmi"?" selected":"")+'>Resmî</option><option value="kisa"'+(a.tone==="kisa"?" selected":"")+'>Kısa ve net</option></select></label>'
    +'<label class="field">Çalışma zamanı<select id="a-sch"><option value="always"'+(a.schedule==="always"?" selected":"")+'>7/24</option><option value="offhours"'+(a.schedule==="offhours"?" selected":"")+'>Yalnız mesai dışında</option></select></label></div>'
    +'<div id="a-hours"'+(a.schedule==="offhours"?'':' hidden')+'><div class="formgrid"><label class="field">Mesai başlangıcı<input id="a-ws" type="time" value="'+esc(a.workStart)+'"></label><label class="field">Mesai bitişi<input id="a-we" type="time" value="'+esc(a.workEnd)+'"></label></div>'
    +'<div class="days" id="a-days" role="group" aria-label="Mesai günleri">'+DAYS.map(([v,t])=>'<label class="check"><input type="checkbox" value="'+v+'"'+(a.workDays.includes(v)?" checked":"")+'> '+t+'</label>').join("")+'</div></div>'
    +'<h3 class="section">Bilgi tabanı</h3><p class="sub">Projeler, fiyat aralıkları, konumlar, ödeme planları, sık sorulan sorular… Asistan yalnız burada yazanları söyler.</p><textarea class="area" id="a-kb" rows="12" maxlength="40000" placeholder="ör. Proje: Deniz Konakları, Kartal. 1+1 daireler 4.2 milyon TL’den başlar. Teslim 2027 Haziran. %30 peşin, 24 ay vade...">'+esc(a.knowledge)+'</textarea><div class="sub" id="a-kbc" style="text-align:right"></div>'
    +'<label class="field" style="margin-top:12px">Ek yönergeler<textarea class="area" id="a-ins" rows="4" maxlength="4000" placeholder="ör. Her sohbette müşterinin bütçesini ve istediği bölgeyi sor. Yer görme talebinde temsilciye devret.">'+esc(a.instructions)+'</textarea></label>'
    +'<label class="field">Devir mesajı<input class="txt" id="a-hand" maxlength="300" value="'+esc(a.handoffMessage)+'"></label>'
    +'<h3 class="section">Numaralar</h3><label class="check"><input type="checkbox" id="a-all"'+(all?" checked":"")+'> Tüm numaralarda çalışsın</label><div id="a-lines">'+S.connections.map(c=>'<label class="check"><input type="checkbox" value="'+esc(c.line)+'"'+(!all&&a.lines.includes(c.line)?" checked":"")+(all?" disabled":"")+'> <span>'+esc(c.name)+' <span class="sub">'+esc(phone(c.phone))+'</span></span></label>').join("")+'</div>'
    +'<h3 class="section">Gelişmiş</h3><div class="list"><div class="setting"><div><strong>Mesaj birleştirme</strong><p>Müşteri art arda yazarsa bu kadar bekleyip tek cevap verir.</p></div><div><input class="num" type="number" min="0" max="60" id="a-merge" value="'+a.mergeSeconds+'"> sn</div></div>'
    +'<div class="setting"><div><strong>Sohbet başına en fazla cevap</strong><p>Sınıra ulaşınca devir mesajını yazıp temsilciye bırakır.</p></div><div><input class="num" type="number" min="1" max="100" id="a-max" value="'+a.maxReplies+'"></div></div>'
    +'<div class="setting"><div><strong>Temsilci yazdıktan sonra sessizlik</strong><p>Temsilci bir sohbete cevap verdiyse asistan bu süre boyunca o sohbete karışmaz.</p></div><div><input class="num" type="number" min="1" max="168" id="a-pause" value="'+a.humanPauseHours+'"> saat</div></div></div>'
    +'<div class="bar" style="margin-top:14px;justify-content:flex-end"><button class="btn primary" id="a-save">Asistanı kaydet</button></div></div>'
    +'<section class="box testbox"><h4>Deneyin</h4><p class="sub">Kaydetmeden önce asistanı burada deneyin; müşteriye hiçbir şey gönderilmez.</p><div class="chatlog" id="tlog"></div><div class="send"><input class="txt" id="tin" placeholder="Müşteri gibi yazın…" maxlength="1500"><button class="btn primary" id="tsend">Gönder</button></div><button class="btn ghost" id="treset">Sohbeti temizle</button></section></div>';
  const kbc=()=>{$("#a-kbc").textContent=$("#a-kb").value.length.toLocaleString("tr-TR")+" / 40.000 karakter";};kbc();$("#a-kb").oninput=kbc;
  $("#a-sch").onchange=()=>{$("#a-hours").hidden=$("#a-sch").value!=="offhours";};
  $("#a-all").onchange=()=>document.querySelectorAll("#a-lines input").forEach(i=>i.disabled=$("#a-all").checked);
  $("#a-save").onclick=async()=>{$("#a-save").disabled=true;try{const r=await api("agent/save",agentForm());A.agent=r.agent;toast(r.agent.enabled?"Asistan kaydedildi ve çalışıyor.":"Asistan kaydedildi (kapalı).");}catch(e){toast(e.message,true);}$("#a-save").disabled=false;};
  const draw=()=>{$("#tlog").innerHTML=testMsgs.length?testMsgs.map(x=>'<div class="bubble '+(x.from==="asistan"?"ai":"me")+'">'+esc(x.text)+(x.handoff?'<small>Temsilciye devredilir'+(x.reason?": "+esc(x.reason):"")+'</small>':'')+'</div>').join(""):'<p class="sub">Ör. “Merhaba, Kartal’daki projenin fiyatları nedir?”</p>';$("#tlog").scrollTop=1e9;};draw();
  const send=async()=>{const text=$("#tin").value.trim();if(!text)return;$("#tin").value="";testMsgs.push({from:"müşteri",text});draw();$("#tsend").disabled=true;
    try{const f=agentForm();const r=await api("agent/test",{messages:testMsgs,config:f});testMsgs.push({from:"asistan",text:r.reply,handoff:r.handoff,reason:r.reason});}catch(e){toast(e.message,true);}draw();$("#tsend").disabled=false;$("#tin").focus();};
  $("#tsend").onclick=send;$("#tin").onkeydown=e=>{if(e.key==="Enter")send();};$("#treset").onclick=()=>{testMsgs=[];draw();};
}
let R=null;
const PL={daily:"Günlük",weekly:"Haftalık",monthly:"Aylık"};
async function reports(){
  const m=$("#main");m.innerHTML='<p class="sub">Yükleniyor…</p>';
  try{R=await api("reports/state");}catch(e){m.innerHTML='<div class="empty"><strong>Raporlar alınamadı</strong>'+esc(e.message)+'</div>';return;}
  if(tab!=="reports")return;
  const s=R.settings,sw=(id,on)=>'<label class="switch"><input type="checkbox" id="'+id+'"'+(on?" checked":"")+'><span></span></label>';
  const hours=Array.from({length:24},(_,i)=>'<option value="'+i+'"'+(i===s.hour?" selected":"")+'>'+String(i).padStart(2,"0")+':00</option>').join("");
  m.innerHTML=(R.aiConfigured?'':'<div class="callout">OpenAI anahtarı tanımlı değil: raporlar yine oluşur ama yapay zekâ yorumu (özet, riskler, öneriler) eklenmez.</div>')
    +'<div class="bar"><span class="hint">Yönetici raporu: mesaj hacmi, cevap süreleri, temsilciler, sıcak müşteriler ve CRM sonuçları; yapay zekâ yorumuyla.</span><div style="display:flex;gap:8px;flex-wrap:wrap"><select class="filter" id="r-p"><option value="daily">Bugün</option><option value="weekly">Son 7 gün</option><option value="monthly">Son 30 gün</option></select><button class="btn" id="r-make">Anlık rapor oluştur</button><button class="btn primary" id="r-send">Oluştur ve gönder</button></div></div>'
    +'<div class="list"><div class="setting"><div><strong>Günlük rapor</strong><p>Her sabah bir önceki günün özeti.</p></div>'+sw("r-d",s.daily)+'</div><div class="setting"><div><strong>Haftalık rapor</strong><p>Pazartesi sabahı son 7 günün özeti.</p></div>'+sw("r-w",s.weekly)+'</div><div class="setting"><div><strong>Aylık rapor</strong><p>Her ayın 1’inde son 30 günün özeti.</p></div>'+sw("r-m",s.monthly)+'</div>'
    +'<div class="setting"><div><strong>Gönderim saati</strong><p>İstanbul saatiyle.</p></div><select class="filter" id="r-h">'+hours+'</select></div></div>'
    +'<h3 class="section">Kime gitsin?</h3><div class="formgrid"><label class="field">WhatsApp numaraları<textarea class="area" id="r-ph" rows="3" placeholder="0532 000 00 00 (her satıra bir numara)">'+esc(s.phones.map(phone).join("\\n"))+'</textarea></label>'
    +'<label class="field">Gönderen bağlantı<select id="r-l"><option value="">Seçin</option>'+R.lines.map(l=>'<option value="'+esc(l.id)+'"'+(l.id===s.line?" selected":"")+(l.open?"":" disabled")+'>'+esc(l.label)+(l.open?"":" (bağlı değil)")+'</option>').join("")+'</select></label></div>'
    +'<p class="sub" style="font-weight:600;margin:4px 0">Bitrix bildirimi gidecek kişiler</p><div class="userpick" id="r-u">'+S.users.map(u=>'<label class="check"><input type="checkbox" value="'+esc(u.id)+'"'+(s.userIds.includes(String(u.id))?" checked":"")+'> '+esc(u.name)+'</label>').join("")+'</div>'
    +'<div class="bar" style="margin-top:14px;justify-content:flex-end"><button class="btn primary" id="r-save">Ayarları kaydet</button></div>'
    +'<h3 class="section">Oluşturulan raporlar</h3>'+(R.reports.length?'<div class="list reps"><div class="row head"><span>Rapor</span><span>Dönem</span><span>Özet</span><span></span></div>'+R.reports.map(r=>'<div class="row"><div><div class="name">'+esc(PL[r.period])+'</div><div class="sub">'+esc(new Date(r.createdAt).toLocaleString("tr-TR",{timeZone:"Europe/Istanbul"}))+'</div></div><div>'+esc(r.from===r.to?r.from:r.from+" – "+r.to)+'</div><div class="sub">'+esc(r.headline||"—")+'</div><div class="acts"><a class="btn" href="'+esc(r.url)+'" target="_blank" rel="noopener">Aç</a><button class="btn ghost" data-copy="'+esc(r.url)+'">Bağlantıyı kopyala</button></div></div>').join("")+'</div>':'<div class="list"><div class="empty">Henüz rapor yok. “Anlık rapor oluştur” ile ilkini deneyin.</div></div>');
  const form=()=>({daily:$("#r-d").checked,weekly:$("#r-w").checked,monthly:$("#r-m").checked,hour:Number($("#r-h").value),phones:$("#r-ph").value.split("\\n"),line:$("#r-l").value,userIds:[...document.querySelectorAll("#r-u input:checked")].map(i=>i.value),origin:location.origin});
  $("#r-save").onclick=async()=>{try{await api("reports/save",form());toast("Rapor ayarları kaydedildi.");}catch(e){toast(e.message,true);}};
  const make=async send=>{const btn=send?$("#r-send"):$("#r-make");btn.disabled=true;btn.textContent="Hazırlanıyor…";
    try{if(send)await api("reports/save",form());const r=await api("reports/create",{period:$("#r-p").value,send,origin:location.origin});
      if(send){const d=r.delivery||{sent:0,errors:[]};if(d.errors.length)toast((d.sent?d.sent+" alıcıya gönderildi. ":"")+d.errors.join(" · "),true);else toast(d.sent?d.sent+" alıcıya gönderildi.":"Alıcı seçilmedi; rapor yalnız oluşturuldu.",!d.sent);}else window.open(r.url,"_blank","noopener");
      reports();}catch(e){toast(e.message,true);btn.disabled=false;btn.textContent=send?"Oluştur ve gönder":"Anlık rapor oluştur";}};
  $("#r-make").onclick=()=>make(false);$("#r-send").onclick=()=>make(true);
  m.querySelectorAll("[data-copy]").forEach(b=>b.onclick=async()=>{try{await navigator.clipboard.writeText(b.dataset.copy);toast("Bağlantı kopyalandı.");}catch{prompt("Bağlantı",b.dataset.copy);}});
}
load();
</script></body></html>`, lang);
}
