"""MOTTO SARAYKENT — Vapi outbound n8n workflow üreticisi.
Kullanım: python3 motto_uret.py <cikti.json> [gizli]
  'gizli' verilirse BITRIX_WEBHOOK_KODU ve TELEGRAM_BOT_TOKEN ortam değişkenlerinden okunur.
  Gizli çıktı repoya KONMAZ (.gitignore: *GIZLI*.json)."""
import json, os, sys, uuid

GIZLI = len(sys.argv) > 2 and sys.argv[2] == "gizli"
BX = "https://xre.bitrix24.com.tr/rest/1/" + (os.environ["BITRIX_WEBHOOK_KODU"] if GIZLI else "YOUR_WEBHOOK")
TG_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"] if GIZLI else "YOUR_TELEGRAM_BOT_TOKEN"
VAPI_CRED = {"httpHeaderAuth": {"id": "zIhaRE8nBbWH1bw6", "name": "Vapi Header Auth"}}

AYARLAR = r"""// ================================================================
//  MOTTO SARAYKENT — AYARLAR (değiştirmeniz gereken her şey burada)
// ================================================================
const AYARLAR = {
  PROJE_ADI: 'MOTTO SARAYKENT',
  BITRIX: '__BX__',
  // Vapi
  VAPI_ASISTAN: 'MOTTO SARAYKENT - OUTBOUND', // asistanın Vapi'deki ADI ya da ID'si
  NUMARA_ID: '7a0ea572-de5c-4437-9ede-dab72b28d86d', // +90 533 743 71 16
  NUMARA: '0533 743 71 16',
  // Bitrix lead statüleri
  KAYNAK_STATU: 'UC_7DXC14', // MOTTO İÇİN GELEN — bu statüdeki lead'ler aranır, statüye DOKUNULMAZ
  RANDEVU_STATU: 'UC_WK3LVR', // RANDEVU OLUŞTURANLAR (yapay zeka statüsü isteniyorsa: 'UC_ML92HM')
  RANDEVU_ALANI: 'UF_CRM_1769424669', // lead "Randevu Tarihi" (datetime)
  // Randevu oluşunca lead bu satışçılara SIRAYLA atanır (başka hiçbir durumda sorumlu değişmez)
  SATIS_SORUMLU_IDLERI: [17984, 22186, 26120, 26352, 1174, 116, 25258, 5778, 11690],
  // Arama saatleri (Türkiye saati). Dışında düşen form bir sonraki başlangıçta aranır.
  MESAI: { BASLA: '09:30', BITIS: '19:00', PAZAR_ARA: true },
  // Telegram
  TELEGRAM_TOKEN: '__TG__',
  TELEGRAM_RANDEVU_CHAT: '-5179169844', // anlık randevu bildirimi
  TELEGRAM_RAPOR_CHAT: '-5110365688', // 20:00 gün sonu raporu
};
return [{ json: AYARLAR }];
"""

ORTAK = r"""const TR=3*3600e3; const p2=n=>String(n).padStart(2,'0');
const GUN=['Pazar','Pazartesi','Salı','Çarşamba','Perşembe','Cuma','Cumartesi'];
function parts(ms){const d=new Date(ms+TR); return {y:d.getUTCFullYear(),m:d.getUTCMonth()+1,d:d.getUTCDate(),wd:d.getUTCDay(),hh:d.getUTCHours(),mi:d.getUTCMinutes()};}
function iso(ms){const t=parts(ms); return `${t.y}-${p2(t.m)}-${p2(t.d)}T${p2(t.hh)}:${p2(t.mi)}:00+03:00`;}
function okunur(ms){const t=parts(ms); return `${p2(t.d)}.${p2(t.m)}.${t.y} ${GUN[t.wd]} ${p2(t.hh)}:${p2(t.mi)}`;}
function first(v){ if(!v)return ''; if(Array.isArray(v)&&v[0])return v[0].VALUE||v[0].value||''; if(typeof v==='object')return v.VALUE||v.value||''; return String(v);}
function tc(s){return String(s||'').toLocaleLowerCase('tr-TR').split(' ').filter(Boolean).map(w=>w.charAt(0).toLocaleUpperCase('tr-TR')+w.slice(1)).join(' ');}
function phone(raw){let d=String(raw||'').replace(/\D/g,''); if(d.startsWith('0090'))d=d.slice(2); if(d.startsWith('90')&&d.length===12)return '+'+d; if(d.startsWith('0')&&d.length===11)return '+90'+d.slice(1); if(d.length===10&&d.startsWith('5'))return '+90'+d; return '';}
const esc=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const hm=s=>{const [h,m]=String(s).split(':').map(Number); return h*60+(m||0);};
function mesaiIci(ms,M){const x=parts(ms); if(!M.PAZAR_ARA&&x.wd===0)return false; const dk=x.hh*60+x.mi; return dk>=hm(M.BASLA)&&dk<hm(M.BITIS);}
function sonrakiMesai(ms,M){for(let i=0;i<9;i++){const g=parts(ms+i*864e5); const bas=Date.UTC(g.y,g.m-1,g.d)-TR+hm(M.BASLA)*60e3; if(bas>ms&&mesaiIci(bas,M))return bas;} return ms+864e5;}
async function telegram(ctx,token,chat,text){
  const ids=[String(chat)]; if(!ids[0].startsWith('-100')) ids.push('-100'+ids[0].replace(/^-/,''));
  let last;
  for(let i=0;i<ids.length;i++){
    const r=await ctx.helpers.httpRequest({method:'POST',url:`https://api.telegram.org/bot${token}/sendMessage`,body:{chat_id:ids[i],text,parse_mode:'HTML',disable_web_page_preview:true},json:true,ignoreHttpStatusErrors:true});
    if(r&&r.ok) return true; last=r; const mig=r&&r.parameters&&r.parameters.migrate_to_chat_id; if(mig) ids.splice(i+1,0,String(mig));
  }
  throw new Error('Telegram mesajı gönderilemedi: '+JSON.stringify(last));
}
const ULASILAMAZ=['did-not-answer','no-answer','busy','voicemail','failed','error','silence-timed-out'];
"""

nodes = []
def node(name, type_, ver, pos, params, **extra):
    n = {"parameters": params, "id": str(uuid.uuid5(uuid.NAMESPACE_URL, "motto/" + name)),
         "name": name, "type": type_, "typeVersion": ver, "position": pos}
    n.update(extra); nodes.append(n)

def code(name, pos, js, **extra):
    js = js.replace("__BX__", BX).replace("__TG__", TG_TOKEN)
    node(name, "n8n-nodes-base.code", 2, pos, {"jsCode": js}, **extra)

A = "const A=$('AYARLAR').first().json; const bx=(m,body)=>this.helpers.httpRequest({method:'POST',url:`${A.BITRIX}/${m}.json`,body,json:true});\n"

# ======================= 1) FORM → ARAMA
node("Bitrix - Motto Form Lead", "n8n-nodes-base.webhook", 2.1, [-600, 0],
     {"httpMethod": "POST", "path": "motto-form-lead", "options": {}},
     webhookId=str(uuid.uuid5(uuid.NAMESPACE_URL, "motto/webhook-form")))
code("AYARLAR", [-380, 0], AYARLAR)
code("Lead Hazırla", [-160, 0], ORTAK + A + r"""// Bitrix robotundan gelen lead'i okur; sadece MOTTO İÇİN GELEN statüsündekileri arar. Statüye dokunmaz.
const w=$('Bitrix - Motto Form Lead').first().json; const b=w.body||{}; const q=w.query||{};
const leadId=String(b['document_id[2]']||b['data[FIELDS][ID]']||b.id||q.id||'').replace('LEAD_','').trim();
if(!/^\d+$/.test(leadId)) return [];
const sd=$getWorkflowStaticData('global'); sd.mottoAranan=sd.mottoAranan||{};
const now=Date.now();
for(const [k,v] of Object.entries(sd.mottoAranan)) if(now-v>30*864e5) delete sd.mottoAranan[k];
if(sd.mottoAranan[leadId] && now-sd.mottoAranan[leadId]<24*3600e3) return []; // aynı lead 24 saatte bir kez
const lead=(await bx('crm.lead.get',{id:leadId})).result||{};
if(String(lead.STATUS_ID)!==A.KAYNAK_STATU) return [];
let kisi={}; if(lead.CONTACT_ID&&String(lead.CONTACT_ID)!=='0'){ try{ kisi=(await bx('crm.contact.get',{id:lead.CONTACT_ID})).result||{}; }catch(e){} }
const tel=phone(first(lead.PHONE))||phone(first(kisi.PHONE));
let ad=tc(lead.NAME||kisi.NAME||''), soyad=tc(lead.LAST_NAME||kisi.LAST_NAME||'');
const k=x=>x.toLocaleLowerCase('tr-TR').replace(/ı/g,'i');
if(soyad&&k(ad).endsWith(' '+k(soyad))) ad=ad.slice(0,ad.length-soyad.length).trim();
if(!tel){
  await bx('crm.timeline.comment.add',{fields:{ENTITY_ID:leadId,ENTITY_TYPE:'lead',COMMENT:`${A.PROJE_ADI} yapay zeka: geçerli telefon numarası bulunamadı, arama yapılmadı.`}});
  return [];
}
sd.mottoAranan[leadId]=now;
return [{json:{lead_id:leadId,ad,ad_soyad:(ad+' '+soyad).trim(),telefon:tel,eposta:first(lead.EMAIL)||first(kisi.EMAIL)}}];""")
node("Vapi: Asistanlar", "n8n-nodes-base.httpRequest", 4.2, [60, 0],
     {"url": "https://api.vapi.ai/assistant", "authentication": "genericCredentialType", "genericAuthType": "httpHeaderAuth",
      "sendQuery": True, "queryParameters": {"parameters": [{"name": "limit", "value": "100"}]}, "options": {"timeout": 20000}},
     credentials=VAPI_CRED, executeOnce=True, alwaysOutputData=True, retryOnFail=True)
code("Saat Kontrolü", [280, 0], ORTAK + A + r"""// Mesai dışıysa bekletir; içindeyse müşteriyi TEK SEFER arar (hat meşgulse tekrar denemez)
const L=$('Lead Hazırla').first().json; const now=Date.now();
if(!mesaiIci(now,A.MESAI)) return [{json:{durum:'bekle',bekle_until:new Date(sonrakiMesai(now,A.MESAI)).toISOString()}}];
// Bu sırada satış ekibi lead'i başka statüye taşıdıysa arama
const lead=(await bx('crm.lead.get',{id:L.lead_id})).result||{};
if(String(lead.STATUS_ID)!==A.KAYNAK_STATU) return [{json:{durum:'iptal',neden:'lead statüsü değişti'}}];
// Asistan (ad ya da ID)
const norm=s=>String(s||'').toLocaleLowerCase('tr-TR').replace(/\s+/g,' ').trim();
const liste=$('Vapi: Asistanlar').all().map(i=>i.json).flatMap(v=>Array.isArray(v)?v:[v]).filter(a=>a&&a.id);
const asistan=liste.find(a=>a.id===A.VAPI_ASISTAN)||liste.find(a=>norm(a.name)===norm(A.VAPI_ASISTAN))||(/^[0-9a-f-]{36}$/i.test(A.VAPI_ASISTAN)?{id:A.VAPI_ASISTAN}:null);
if(!asistan) throw new Error(`Vapi'de "${A.VAPI_ASISTAN}" asistanı bulunamadı. AYARLAR > VAPI_ASISTAN değerini kontrol edin.`);
const t=parts(now); const takvim=[];
for(let i=0;i<21;i++){const g=parts(now+i*864e5); takvim.push(`${GUN[g.wd]} ${p2(g.d)}.${p2(g.m)}.${g.y} = ${g.y}-${p2(g.m)}-${p2(g.d)}${i===0?' (bugün)':i===1?' (yarın)':''}`);}
const vars={lead_id:L.lead_id,bitrix_id:L.lead_id,musteri_adi:L.ad||'',isim:L.ad||'',user_name:L.ad_soyad||'',start_mode:L.ad?'confirm_name':'ask_name',
  customer_phone:L.telefon,customer_email:L.eposta||'',bugun_gun:GUN[t.wd],bugunun_tarihi:`${p2(t.d)}.${p2(t.m)}.${t.y}`,bugun_iso:`${t.y}-${p2(t.m)}-${p2(t.d)}`,
  su_anki_saat:`${p2(t.hh)}:${p2(t.mi)}`,takvim:takvim.join('\n'),arama_turu:'Giden'};
return [{json:{durum:'ara',vapiBody:{assistantId:asistan.id,phoneNumberId:A.NUMARA_ID,customer:L.ad_soyad?{number:L.telefon,name:L.ad_soyad.slice(0,40)}:{number:L.telefon},
  assistantOverrides:{variableValues:vars},metadata:{project:'motto-saraykent',lead_id:L.lead_id,bitrix_id:L.lead_id}}}}];""")
node("Ne Yapılacak?", "n8n-nodes-base.switch", 3.2, [500, 0], {
    "rules": {"values": [
        {"conditions": {"options": {"caseSensitive": True, "leftValue": "", "typeValidation": "loose", "version": 2},
                        "conditions": [{"id": str(uuid.uuid4()), "leftValue": "={{ $json.durum }}", "rightValue": "ara", "operator": {"type": "string", "operation": "equals"}}],
                        "combinator": "and"}, "renameOutput": True, "outputKey": "Ara"},
        {"conditions": {"options": {"caseSensitive": True, "leftValue": "", "typeValidation": "loose", "version": 2},
                        "conditions": [{"id": str(uuid.uuid4()), "leftValue": "={{ $json.durum }}", "rightValue": "bekle", "operator": {"type": "string", "operation": "equals"}}],
                        "combinator": "and"}, "renameOutput": True, "outputKey": "Bekle"}]},
    "options": {}})
node("Bekle", "n8n-nodes-base.wait", 1.1, [720, 120], {"resume": "specificTime", "dateTime": "={{ $json.bekle_until }}"},
     webhookId=str(uuid.uuid5(uuid.NAMESPACE_URL, "motto/wait")))
node("Vapi: Aramayı Başlat", "n8n-nodes-base.httpRequest", 4.2, [720, -120],
     {"method": "POST", "url": "https://api.vapi.ai/call", "authentication": "genericCredentialType", "genericAuthType": "httpHeaderAuth",
      "sendBody": True, "specifyBody": "json", "jsonBody": "={{ JSON.stringify($json.vapiBody) }}", "options": {"timeout": 30000}},
     credentials=VAPI_CRED, onError="continueRegularOutput")
code("Arama Notu", [940, -120], A + r"""const L=$('Lead Hazırla').first().json; const r=$input.first().json;
const metin=r.id?`${A.PROJE_ADI} yapay zeka araması başlatıldı (arayan numara: ${A.NUMARA}).`
  :`${A.PROJE_ADI} yapay zeka araması BAŞLATILAMADI — müşteriyi manuel arayın. Hata: ${String((r.error&&(r.error.message||JSON.stringify(r.error)))||r.message||JSON.stringify(r)).slice(0,300)}`;
await bx('crm.timeline.comment.add',{fields:{ENTITY_ID:L.lead_id,ENTITY_TYPE:'lead',COMMENT:metin}});
return [{json:{lead_id:L.lead_id,call_id:r.id||'',basladi:!!r.id}}];""", onError="continueRegularOutput")

# ======================= 2) ARAMA SONUCU
node("Vapi - Motto Sonuç", "n8n-nodes-base.webhook", 2.1, [-600, 500],
     {"httpMethod": "POST", "path": "motto-vapi-call-result", "options": {}},
     webhookId=str(uuid.uuid5(uuid.NAMESPACE_URL, "motto/webhook-result")))
code("AYARLAR (Sonuç)", [-380, 500], AYARLAR)
code("Sonucu İşle", [-160, 500], ORTAK + A.replace("$('AYARLAR')", "$('AYARLAR (Sonuç)')") + r"""// Görüşme bitti. Statüye/sorumluya YALNIZCA randevu oluştuysa dokunulur.
const raw=$('Vapi - Motto Sonuç').first().json; const body=raw.body||raw; const msg=body.message||body;
if(String(msg.type||'')!=='end-of-call-report') return [];
const call=msg.call||{}; const art=msg.artifact||call.artifact||{}; const an=msg.analysis||call.analysis||{};
const vv=(call.assistantOverrides&&call.assistantOverrides.variableValues)||{}; const meta={...(call.metadata||{}),...(msg.metadata||{})};
if(meta.project&&meta.project!=='motto-saraykent') return [];
const leadId=String(meta.lead_id||vv.lead_id||'').replace(/\D/g,''); if(!leadId) return [];
const sd=$getWorkflowStaticData('global'); sd.mottoCagri=sd.mottoCagri||{};
if(call.id){ if(sd.mottoCagri[call.id]) return []; sd.mottoCagri[call.id]=Date.now(); for(const [k,v] of Object.entries(sd.mottoCagri)) if(Date.now()-v>3*864e5) delete sd.mottoCagri[k]; }

// Görüşme içeriği
const mesajlar=art.messages||msg.messages||[];
const kullanici=mesajlar.filter(m=>m&&m.role==='user'&&String(m.message||'').trim());
const er=String(msg.endedReason||call.endedReason||'').toLowerCase();
const ulasildi=kullanici.length>0&&!ULASILAMAZ.some(x=>er.includes(x)&&x!=='silence-timed-out');
// Randevu: randevu_olustur aracı çağrıldıysa ya da yapılandırılmış sonuç randevu ise
let arac=null;
(function ara(v,d){ if(!v||typeof v!=='object'||d>8||arac) return; const f=v.function||v;
  if(f&&typeof f.name==='string'&&/randevu/i.test(f.name)&&f.arguments!==undefined){ try{arac=typeof f.arguments==='string'?JSON.parse(f.arguments):f.arguments;}catch(e){arac={};} return; }
  for(const x of Object.values(v)) ara(x,d+1); })(mesajlar,0);
let yapi={}; (function bul(v,d){ if(!v||typeof v!=='object'||d>6) return; const ks=Object.keys(v).map(k=>k.trim()); if(ks.includes('arama_sonucu')||ks.includes('appointment_date')){ for(const [k,x] of Object.entries(v)) yapi[k.trim()]=x; return; } for(const x of Object.values(v)) bul(x,d+1); })([an.structuredData,art.structuredOutputs,msg.structuredOutputs,call.structuredOutputs],0);
const sonuc=String(yapi.arama_sonucu||'').toLowerCase();
const randevu=!!arac||sonuc.startsWith('randevu');
// Randevu tarihi (varsa): araç argümanları ya da yapılandırılmış sonuçtan
function tarihBul(o){ if(!o) return null; let t='',s='';
  for(const [k,v] of Object.entries(o)){ const kk=k.toLowerCase(); if(!v) continue;
    if(/tarih|date|gun/.test(kk)&&!t) t=String(v); else if(/saat|time/.test(kk)&&!s) s=String(v); }
  const m=/(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2})[:.](\d{2}))?/.exec(t); if(!m) return null;
  let hh=m[4], mi=m[5]; const ms=/(\d{1,2})[:.](\d{2})/.exec(s); if(!hh&&ms){hh=ms[1];mi=ms[2];} if(!hh) return null;
  if(/[+-]\d{2}:?\d{2}$|Z$/.test(t.trim())){ const x=Date.parse(t.trim()); return isNaN(x)?null:x; }
  return Date.UTC(+m[1],+m[2]-1,+m[3],+hh,+mi)-TR; }
let randevuMs=randevu?(tarihBul(arac)||tarihBul(yapi)):null;
if(randevuMs&&(randevuMs<Date.now()-30*60e3||randevuMs>Date.now()+90*864e5)) randevuMs=null;

const lead=(await bx('crm.lead.get',{id:leadId})).result||{};
const adSoyad=tc([lead.NAME,lead.LAST_NAME].filter(Boolean).join(' '))||(arac&&arac.ad_soyad)||'';
const tel=phone(first(lead.PHONE))||phone(call.customer&&call.customer.number);
const ozet=String(yapi.call_summary||yapi.ozet||an.summary||'').trim();
const kayit=art.recordingUrl||msg.recordingUrl||'';
const sure=Math.round(Number(msg.durationSeconds)||0);
let baslik, atanan='';

if(randevu){
  // Satışçılara sırayla dağıt
  const liste=(A.SATIS_SORUMLU_IDLERI||[]).map(String).filter(Boolean);
  sd.mottoSira=Number(sd.mottoSira)||0; atanan=liste.length?liste[sd.mottoSira%liste.length]:String(lead.ASSIGNED_BY_ID||''); sd.mottoSira=(sd.mottoSira+1)%Math.max(liste.length,1);
  const fields={STATUS_ID:A.RANDEVU_STATU,ASSIGNED_BY_ID:atanan};
  if(randevuMs) fields[A.RANDEVU_ALANI]=iso(randevuMs);
  const u=await bx('crm.lead.update',{id:leadId,fields,params:{REGISTER_SONET_EVENT:'Y'}});
  if(!u||u.error) throw new Error('Bitrix lead güncellenemedi: '+JSON.stringify(u));
  const gorev=randevuMs||(Date.now()+15*60e3);
  await bx('crm.activity.todo.add',{ownerTypeId:1,ownerId:Number(leadId),deadline:iso(gorev),responsibleId:Number(atanan)||undefined,
    title:`${A.PROJE_ADI} randevu — ${randevuMs?okunur(randevuMs):'GÜN/SAAT BELİRLEYİN'} — ${adSoyad||tel}`.slice(0,250),
    description:[`Yapay zeka görüşmesinde randevu oluşturuldu.`,randevuMs?`Randevu: ${okunur(randevuMs)}`:'Gün ve saat belirlenmedi — müşteriyi arayıp birlikte belirleyin.',`Telefon: ${tel}`,ozet?`Özet: ${ozet}`:''].filter(Boolean).join('\n'),
    pingOffsets:randevuMs?[1440,60]:[0]});
  baslik=`RANDEVU OLUŞTURDU${randevuMs?` — ${okunur(randevuMs)}`:' — gün/saat satış temsilcisince belirlenecek'}`;
  // Telegram anlık bildirim
  try{ await telegram(this,A.TELEGRAM_TOKEN,A.TELEGRAM_RANDEVU_CHAT,[
    '📅 <b>YENİ MOTTO SARAYKENT RANDEVUSU</b>','',
    `👤 <b>${esc(adSoyad||'-')}</b>`,`📞 ${esc(tel||'-')}`,
    `🗓 <b>${esc(randevuMs?okunur(randevuMs):'Gün/saat satış temsilcisince belirlenecek')}</b>`,
    `👔 Atanan satışçı ID: ${esc(atanan)}`,
    ozet?`\n📝 ${esc(ozet.slice(0,600))}`:'',
    `\n🔗 <a href="https://xre.bitrix24.com.tr/crm/lead/details/${leadId}/">Bitrix kartını aç</a>`].filter(Boolean).join('\n')); }catch(e){}
} else if(!ulasildi){
  baslik='ULAŞILAMADI';
} else {
  baslik=`görüşüldü, randevu oluşmadı${sonuc?` (${sonuc})`:''}`;
}
await bx('crm.timeline.comment.add',{fields:{ENTITY_ID:leadId,ENTITY_TYPE:'lead',COMMENT:[
  `${A.PROJE_ADI} yapay zeka görüşmesi — ${baslik}`,
  randevu?`Statü: RANDEVU OLUŞTURANLAR, sorumlu: ${atanan}`:'Statü ve sorumlu değiştirilmedi.',
  `Süre: ${sure} sn | Bitiş: ${er||'-'}`, ozet?`Özet: ${ozet.slice(0,1500)}`:'', kayit?`Ses kaydı: ${kayit}`:''].filter(Boolean).join('\n')}});
return [{json:{lead_id:leadId,randevu,ulasildi,atanan,baslik}}];""")

# ======================= 3) GÜN SONU RAPORU
node("Her Gün 20:00", "n8n-nodes-base.scheduleTrigger", 1.2, [-600, 900],
     {"rule": {"interval": [{"field": "cronExpression", "expression": "0 20 * * *"}]}})
code("AYARLAR (Rapor)", [-380, 900], AYARLAR)
node("Vapi: Bugünkü Aramalar", "n8n-nodes-base.httpRequest", 4.2, [-160, 900],
     {"url": "https://api.vapi.ai/call", "authentication": "genericCredentialType", "genericAuthType": "httpHeaderAuth",
      "sendQuery": True, "queryParameters": {"parameters": [
          {"name": "createdAtGe", "value": "={{ new Date(Date.UTC(new Date(Date.now()+3*3600e3).getUTCFullYear(), new Date(Date.now()+3*3600e3).getUTCMonth(), new Date(Date.now()+3*3600e3).getUTCDate()) - 3*3600e3).toISOString() }}"},
          {"name": "limit", "value": "1000"}]}, "options": {"timeout": 30000}},
     credentials=VAPI_CRED, alwaysOutputData=True, retryOnFail=True)
code("Gün Sonu Raporu", [60, 900], ORTAK + r"""const A=$('AYARLAR (Rapor)').first().json;
let calls=$input.all().map(i=>i.json).flatMap(v=>Array.isArray(v)?v:(v&&Array.isArray(v.results)?v.results:[v])).filter(c=>c&&c.id&&c.phoneNumberId===A.NUMARA_ID);
const giden=calls.filter(c=>!String(c.type||'').includes('inbound'));
const kisi=new Set(), ulasilan=new Set(); let basarili=0,basarisiz=0,saniye=0,randevu=0,maliyet=0,gelen=calls.length-giden.length;
for(const c of giden){
  const num=(c.customer&&c.customer.number)||c.id; kisi.add(num);
  const er=String(c.endedReason||'').toLowerCase();
  const konustu=!!c.startedAt&&!ULASILAMAZ.filter(x=>x!=='silence-timed-out').some(x=>er.includes(x))&&((c.artifact&&c.artifact.messages)||c.messages||[]).some(m=>m&&m.role==='user');
  if(konustu){ basarili++; ulasilan.add(num); if(c.startedAt&&c.endedAt) saniye+=Math.max(0,(Date.parse(c.endedAt)-Date.parse(c.startedAt))/1000); } else basarisiz++;
  if(JSON.stringify((c.artifact&&c.artifact.messages)||c.messages||[]).match(/"name":"[^"]*randevu[^"]*"/i)||/"arama_sonucu"\s*:\s*"randevu/i.test(JSON.stringify(c.analysis||{})+JSON.stringify((c.artifact&&c.artifact.structuredOutputs)||{}))) randevu++;
  maliyet+=Number(c.cost||0);
}
const t=parts(Date.now()); const dk=saniye/60;
const metin=[
  '📊 <b>MOTTO SARAYKENT — GÜN SONU RAPORU</b>',
  `🗓 ${p2(t.d)}.${p2(t.m)}.${t.y} ${GUN[t.wd]}`,'',
  `📞 Yapılan arama: <b>${giden.length}</b>`,
  `👥 Aranan kişi: <b>${kisi.size}</b>`,
  `🗣 İletişime geçilen kişi: <b>${ulasilan.size}</b>`,
  `✅ Başarılı arama (müşteriyle konuşuldu): <b>${basarili}</b>`,
  `❌ Başarısız arama (açmadı/meşgul/ulaşılamadı): <b>${basarisiz}</b>`,
  `📅 Randevu oluşturulan: <b>${randevu}</b>`,
  `⏱ Toplam konuşma süresi: <b>${dk.toFixed(1).replace('.',',')} dk</b>`,
  gelen?`📲 Gelen arama: <b>${gelen}</b>`:'',
  '',`📱 Arayan numara: ${esc(A.NUMARA)}`,`💵 Vapi maliyeti: $${maliyet.toFixed(2)}`].filter(x=>x!=='' || true).join('\n').replace(/\n{3,}/g,'\n\n');
await telegram(this,A.TELEGRAM_TOKEN,A.TELEGRAM_RAPOR_CHAT,metin);
return [{json:{arama:giden.length,kisi:kisi.size,iletisim:ulasilan.size,basarili,basarisiz,randevu,dakika:+dk.toFixed(1)}}];""")

node("KURULUM", "n8n-nodes-base.stickyNote", 1, [-640, -420], {"width": 760, "height": 360, "content":
"## MOTTO SARAYKENT — Vapi\n"
"**1. Bitrix:** Müşteri adayları → Otomasyon kuralları → **MOTTO İÇİN GELEN** sütununa *Giden webhook* kuralı ekleyin:\n"
"`https://xre111.shop/webhook/motto-form-lead`\n\n"
"**2. Vapi:** MOTTO SARAYKENT - OUTBOUND asistanı → Advanced → Server URL:\n"
"`https://xre111.shop/webhook/motto-vapi-call-result` (Server Messages: end-of-call-report)\n\n"
"**3. n8n:** 3 Vapi düğümünde credential = Vapi Header Auth. Workflow'u Active yapın.\n\n"
"Statü değiştirilmez. Yalnızca randevu oluşursa lead RANDEVU OLUŞTURANLAR'a geçer ve satışçılara sırayla atanır.\n"
"Ayarlar: her tetikleyicinin hemen arkasındaki AYARLAR düğümü (üçü aynı tutulmalı)."})

conns = {}
def link(a, b, out=0):
    m = conns.setdefault(a, {"main": []})["main"]
    while len(m) <= out: m.append([])
    m[out].append({"node": b, "type": "main", "index": 0})
for a, b in [("Bitrix - Motto Form Lead", "AYARLAR"), ("AYARLAR", "Lead Hazırla"), ("Lead Hazırla", "Vapi: Asistanlar"),
             ("Vapi: Asistanlar", "Saat Kontrolü"), ("Saat Kontrolü", "Ne Yapılacak?"),
             ("Ne Yapılacak?", "Vapi: Aramayı Başlat"), ("Bekle", "Saat Kontrolü"), ("Vapi: Aramayı Başlat", "Arama Notu"),
             ("Vapi - Motto Sonuç", "AYARLAR (Sonuç)"), ("AYARLAR (Sonuç)", "Sonucu İşle"),
             ("Her Gün 20:00", "AYARLAR (Rapor)"), ("AYARLAR (Rapor)", "Vapi: Bugünkü Aramalar"), ("Vapi: Bugünkü Aramalar", "Gün Sonu Raporu")]:
    link(a, b)
link("Ne Yapılacak?", "Bekle", 1)

names = [n["name"] for n in nodes]; assert len(names) == len(set(names))
for a, v in conns.items():
    assert a in names, a
    for outs in v["main"]:
        for c in outs: assert c["node"] in names, c["node"]
wf = {"name": "MOTTO SARAYKENT - Vapi Outbound", "nodes": nodes, "pinData": {}, "connections": conns, "active": False,
      "settings": {"executionOrder": "v1", "timezone": "Europe/Istanbul"},
      "meta": {"instanceId": "6dcbeae59cf89cdc0a07d718f42dfd9fbd0d6bdd06e3e96e03e86795f4ea2a95"}}
out = json.dumps(wf, ensure_ascii=False, indent=2)
if not GIZLI: assert "YOUR_WEBHOOK" in out and "YOUR_TELEGRAM_BOT_TOKEN" in out
open(sys.argv[1], "w").write(out)
print(len(nodes), "nodes ->", sys.argv[1])
