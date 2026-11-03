"""XRE Franchise Vapi n8n workflow üreticisi.
Kullanım: python3 gen2.py <cikti.json> [gizli]
  'gizli' verilirse gerçek değerler ortam değişkenlerinden okunur (BITRIX_WEBHOOK_KODU, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID).
  Gizli çıktı dosyası repoya KONMAZ (.gitignore: *GIZLI*.json)."""
import json, os, uuid, sys

GIZLI = len(sys.argv) > 2 and sys.argv[2] == "gizli"
BX = "https://xre.bitrix24.com.tr/rest/1/" + (os.environ["BITRIX_WEBHOOK_KODU"] if GIZLI else "YOUR_WEBHOOK")
TG_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"] if GIZLI else "YOUR_TELEGRAM_BOT_TOKEN"
TG_CHAT = os.environ["TELEGRAM_CHAT_ID"] if GIZLI else "YOUR_TELEGRAM_CHAT_ID"
SMS_USER = os.environ.get("ERCCELL_KULLANICI", "YOUR_ERCCELL_USER") if GIZLI else "YOUR_ERCCELL_USER"
SMS_PASS = os.environ.get("ERCCELL_SIFRE", "YOUR_ERCCELL_PASSWORD") if GIZLI else "YOUR_ERCCELL_PASSWORD"

POT, ARIYOR, RANDEVU, ULAS, OLUMSUZ = "C4:UC_E68BUC", "C4:UC_5688TP", "C4:1", "C4:UC_VNGV9N", "C4:UC_B3W6CW"
AI_RANDEVU_ESKI = "C4:UC_DEJOO8"  # YAPAY ZEKA RANDEVU OLUŞTURANLAR (artık hedef değil)
RUSTEM = 27332
ASSISTANT_OUT = "65a798f1-95dc-487f-9d60-cfa10994d3fb"
ASSISTANT_IN = "0b1a70cf-7139-44d5-96e9-59504dddef4c"
# Vapi numaraları: id -> müşteriye görünen numara. Her 3 dakikada her numara en fazla 1 arama başlatır.
NUMARALAR = {"8c3a1ba4-5ae9-46c7-8ea7-85df0654295c": "0533 743 60 24",
             "536bf387-1d12-4586-ac73-94db146dfe05": "0533 743 68 03",
             "d0c20592-51aa-4bd3-a6e3-6fe01e0e9afd": "0533 743 60 04"}
VAPI_CRED = {"httpHeaderAuth": {"id": "FUVtxEey6Fmi84f2", "name": "META XRE FRANCHISE WHATSAPP"}}

def fill(js):
    for k, v in {"__BX__": BX, "__POT__": POT, "__ARIYOR__": ARIYOR, "__RANDEVU__": RANDEVU, "__AI_RANDEVU_ESKI__": AI_RANDEVU_ESKI, "__ULAS__": ULAS,
                 "__OLUMSUZ__": OLUMSUZ, "__RUSTEM__": str(RUSTEM), "__TG_TOKEN__": TG_TOKEN, "__TG_CHAT__": TG_CHAT, "__SMS_USER__": SMS_USER, "__SMS_PASS__": SMS_PASS,
                 "__NUMARALAR__": json.dumps(NUMARALAR, ensure_ascii=False), "__AS_OUT__": ASSISTANT_OUT, "__AS_IN__": ASSISTANT_IN}.items():
        js = js.replace(k, v)
    assert "__" not in js.replace("__proto__", ""), js[:200]
    return js

# ---- ortak JS parçaları
JS_ZAMAN = r'''const TR=3*3600e3; const p2=n=>String(n).padStart(2,'0');
const GUN=['Pazar','Pazartesi','Salı','Çarşamba','Perşembe','Cuma','Cumartesi'];
function parts(ms){const d=new Date(ms+TR); return {y:d.getUTCFullYear(),m:d.getUTCMonth()+1,d:d.getUTCDate(),wd:d.getUTCDay(),hh:d.getUTCHours(),mi:d.getUTCMinutes()};}
'''
JS_KISI = r'''function first(v){ if(!v)return ""; if(Array.isArray(v)&&v[0])return v[0].VALUE||v[0].value||""; if(typeof v==="object")return v.VALUE||v.value||""; return String(v);}
function tc(s){return String(s||"").toLocaleLowerCase("tr-TR").split(" ").filter(Boolean).map(w=>w.charAt(0).toLocaleUpperCase("tr-TR")+w.slice(1)).join(" ");}
function phone(raw){let d=String(raw||"").replace(/\D/g,""); if(d.startsWith("0090"))d=d.slice(2); if(d.startsWith("90")&&d.length===12)return "+"+d; if(d.startsWith("0")&&d.length===11)return "+90"+d.slice(1); if(d.length===10&&d.startsWith("5"))return "+90"+d; return "";}
'''
# Vapi'ye giden değişkenler: arama anında hesaplanır (tarih/takvim taze olsun diye)
JS_DEGISKEN = r'''function aramaDegiskenleri(firstName){
  const now=Date.now(); const t=parts(now); const takvim=[];
  for(let i=0;i<21;i++){const g=parts(now+i*864e5); takvim.push(`${GUN[g.wd]} ${p2(g.d)}.${p2(g.m)}.${g.y} = ${g.y}-${p2(g.m)}-${p2(g.d)}${i===0?' (bugün)':i===1?' (yarın)':''}`);}
  return {start_mode:firstName?'confirm_name':'ask_name',
    dynamic_greeting:firstName?`Merhabalar, ben iksre Gayrimenkul'den Selin. ${firstName} ile mi görüşüyorum?`:`Merhabalar, ben iksre Gayrimenkul'den Selin. Kiminle görüşüyorum acaba?`,
    bugunun_tarihi:`${p2(t.d)}.${p2(t.m)}.${t.y}`, bugun_iso:`${t.y}-${p2(t.m)}-${p2(t.d)}`, bugun_gun:GUN[t.wd],
    su_anki_saat:`${p2(t.hh)}:${p2(t.mi)}`, takvim:takvim.join('\n'), arama_turu:'Giden'};
}
'''
JS_TELEGRAM = r'''const TG_TOKEN='__TG_TOKEN__'; const TG_CHAT='__TG_CHAT__';
// Grup ID'si -100 önekli (süper grup) olabilir ya da grup süper gruba yükseltilmiş olabilir: hepsi denenir.
async function telegram(ctx,text){
  const ids=[TG_CHAT]; if(!String(TG_CHAT).startsWith('-100')) ids.push('-100'+String(TG_CHAT).replace(/^-/,''));
  let last;
  for(let i=0;i<ids.length;i++){
    const r=await ctx.helpers.httpRequest({method:'POST',url:`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`,body:{chat_id:ids[i],text,parse_mode:'HTML',disable_web_page_preview:true},json:true,ignoreHttpStatusErrors:true});
    if(r&&r.ok) return {ok:true,chat_id:ids[i]};
    last=r; const mig=r&&r.parameters&&r.parameters.migrate_to_chat_id; if(mig) ids.splice(i+1,0,String(mig));
  }
  throw new Error('Telegram mesajı gönderilemedi: '+JSON.stringify(last));
}
const esc=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
'''
JS_SONUC_ALANI = r'''function fs(v,depth=0){if(!v||typeof v!=='object'||depth>6)return{}; if(v.franchise_call_result&&typeof v.franchise_call_result==='object')return v.franchise_call_result; const ks=['arama_sonucu','appointment_date','aranacak_saat','dnc_talebi','extracted_name','xre_bilgi_durumu','ofis_durumu','bolge','ilgi_seviyesi','link_istegi','arama_turu','call_summary','call_successful','user_sentiment']; if(ks.some(k=>Object.prototype.hasOwnProperty.call(v,k)))return v; if(Array.isArray(v)){for(const x of v){const r=fs(x,depth+1); if(Object.keys(r).length)return r;}} for(const x of Object.values(v)){if(x&&typeof x==='object'){const r=fs(x,depth+1); if(Object.keys(r).length)return r;}} return{};}
const ULASILAMAZ_NEDEN=['did-not-answer','no-answer','busy','voicemail','failed','error'];
function norm(s){return String(s||'').toLocaleLowerCase('tr-TR').replace(/ı/g,'i').replace(/ş/g,'s').replace(/ğ/g,'g').replace(/ü/g,'u').replace(/ö/g,'o').replace(/ç/g,'c').replace(/[\s-]+/g,'_').trim();}
const OLUMSUZLAR=['olumsuz','ilgilenmiyor','ilgisiz','istemiyor','red','reddetti','dnc','aranmak_istemiyor','yanlis_kisi','yanlis_numara'];
const ULASILAMADI=['ulasilamadi','cevapsiz','mesgul','sesli_mesaj','telesekreter'];
'''

nodes = []
def guvenli_ifade(v):
    """n8n ifadeleri '={{ ... }}' içinde '}}' ya da '{{' geçemez; araya boşluk koyar."""
    if isinstance(v, str) and v.startswith("={{") and v.endswith("}}"):
        ic = v[3:-2]
        while "}}" in ic or "{{" in ic:
            ic = ic.replace("}}", "} }").replace("{{", "{ {")
        return "={{" + ic + "}}"
    if isinstance(v, dict):
        return {k: guvenli_ifade(x) for k, x in v.items()}
    if isinstance(v, list):
        return [guvenli_ifade(x) for x in v]
    return v

def node(name, type_, ver, pos, params, **extra):
    if type_ != "n8n-nodes-base.code":
        params = guvenli_ifade(params)
    n = {"parameters": params, "id": str(uuid.uuid5(uuid.NAMESPACE_URL, "xre-franchise/" + name)),
         "name": name, "type": type_, "typeVersion": ver, "position": pos}
    n.update(extra)
    nodes.append(n)

def code(name, pos, js, each=False, **extra):
    p = {"jsCode": fill(js)}
    if each:
        p = {"mode": "runOnceForEachItem", "jsCode": fill(js)}
    node(name, "n8n-nodes-base.code", 2, pos, p, **extra)

def iff(name, pos, expr):
    node(name, "n8n-nodes-base.if", 1, pos,
         {"conditions": {"boolean": [{"value1": "={{ " + expr + " }}", "value2": True}]}})

def bx(name, pos, method, body_expr, on_error=False, get_url=None):
    if get_url:
        p = {"url": "=" + BX + "/" + get_url, "options": {}}
    else:
        p = {"method": "POST", "url": BX + "/" + method + ".json", "sendBody": True,
             "specifyBody": "json", "jsonBody": "={{ JSON.stringify(" + body_expr + ") }}", "options": {}}
    extra = {"retryOnFail": True}
    if on_error:
        extra["onError"] = "continueRegularOutput"
    node(name, "n8n-nodes-base.httpRequest", 4.1, pos, p, **extra)

def vapi_call(name, pos, v):
    body = ("{\nassistantId:\"" + ASSISTANT_OUT + "\",\nphoneNumberId:V.phone_number_id,\n"
            "customer:{number:V.phone_e164,name:V.full_name},\n"
            "assistantOverrides:{variableValues:{\n"
            "user_name:V.full_name,\nisim:V.first_name,\nstart_mode:V.start_mode,\ndynamic_greeting:V.dynamic_greeting,\n"
            "bitrix_id:V.deal_id,\nbitrix_deal_id:V.deal_id,\ncustomer_phone:V.phone_e164,\ncustomer_email:V.email,\n"
            "bugunun_tarihi:V.bugunun_tarihi,\nbugun_iso:V.bugun_iso,\nbugun_gun:V.bugun_gun,\nsu_anki_saat:V.su_anki_saat,\n"
            "takvim:V.takvim,\narama_turu:\"Giden\",\ndeneme:String(V.deneme)\n}},\n"
            "metadata:{bitrix_deal_id:V.deal_id,bitrix_contact_id:V.contact_id,arayan_numara:V.arayan_numara,project:\"franchise\",arama_turu:\"Giden\",deneme:String(V.deneme)}\n}").replace("V.", v + ".")
    opts = {}
    node(name, "n8n-nodes-base.httpRequest", 4.1, pos,
         {"method": "POST", "url": "https://api.vapi.ai/call", "authentication": "genericCredentialType",
          "genericAuthType": "httpHeaderAuth", "sendBody": True, "specifyBody": "json",
          "jsonBody": "={{ JSON.stringify(" + body + ") }}", "options": opts},
         credentials=VAPI_CRED, onError="continueRegularOutput")

# ================================================================ 1) ARAMA KUYRUĞU (her 3 dakikada, numara başına 1 arama)
node("Her 3 Dakikada", "n8n-nodes-base.scheduleTrigger", 1.2, [-464, -176],
     {"rule": {"interval": [{"field": "cronExpression", "expression": "*/3 * * * *"}]}})

code("Arama Kuyruğu (3 numara)", [-240, -176], JS_ZAMAN + JS_KISI + JS_DEGISKEN + r'''// ===== AYARLAR =====
const BITRIX='__BX__';
const ST={POT:'__POT__',ARIYOR:'__ARIYOR__',ULAS:'__ULAS__',OLUMSUZ:'__OLUMSUZ__'};
const SORUMLU_ID=__RUSTEM__; // Rüstem Sarıoğlan
const NUMARALAR=__NUMARALAR__; // Vapi numara ID -> görünen numara
const MESAI={baslangic:'09:30',bitis:'19:00',pazar_ara:true};
const TEKRAR_ARAMA_SAATI='10:30'; // ulaşılamayanlar ertesi gün bu saatten itibaren kuyruğa girer
// ===================
const bx=(m,body)=>this.helpers.httpRequest({method:'POST',url:`${BITRIX}/${m}.json`,body,json:true});
const not=(id,text)=>bx('crm.timeline.comment.add',{fields:{ENTITY_ID:id,ENTITY_TYPE:'deal',COMMENT:text}}).catch(()=>{});
const now=Date.now(); const t=parts(now); const dk=t.hh*60+t.mi;
const hm=s=>{const [h,m]=s.split(':').map(Number); return h*60+m;};
if((!MESAI.pazar_ara&&t.wd===0)||dk<hm(MESAI.baslangic)||dk>=hm(MESAI.bitis)) return [];

const sd=$getWorkflowStaticData('global');
sd.franchiseKuyruk=sd.franchiseKuyruk||{}; sd.franchiseRetry=sd.franchiseRetry||{};
for(const [k,v] of Object.entries(sd.franchiseKuyruk)) if(now-v>30*60e3) delete sd.franchiseKuyruk[k];
for(const [k,v] of Object.entries(sd.franchiseRetry)) if(now-v>30*864e5) delete sd.franchiseRetry[k];
const numaraIdleri=Object.keys(NUMARALAR); const kapasite=numaraIdleri.length;

// Adaylar: önce ertesi gün tekrar aranacak ulaşılamayanlar, sonra yeni potansiyeller (eskiden yeniye)
const adaylar=[];
if(dk>=hm(TEKRAR_ARAMA_SAATI)){
  const bugunBaslangic=Date.UTC(t.y,t.m-1,t.d)-TR; let start=0;
  do{ const r=await bx('crm.deal.list',{filter:{CATEGORY_ID:4,STAGE_ID:ST.ULAS},select:['ID','TITLE','CONTACT_ID','MOVED_TIME'],order:{ID:'ASC'},start});
      for(const d of (r.result||[])){ const moved=Date.parse(d.MOVED_TIME||''); if(moved&&moved<bugunBaslangic&&!sd.franchiseRetry[d.ID]) adaylar.push({d,deneme:2}); }
      start=r.next; }while(start);
}
const yeni=await bx('crm.deal.list',{filter:{CATEGORY_ID:4,STAGE_ID:ST.POT},select:['ID','TITLE','CONTACT_ID'],order:{ID:'ASC'}});
for(const d of (yeni.result||[])) adaylar.push({d,deneme:1});

const out=[];
for(const {d,deneme} of adaylar){
  if(out.length>=kapasite) break;
  const id=String(d.ID); if(sd.franchiseKuyruk[id]) continue;
  sd.franchiseKuyruk[id]=now;
  try{
    let c={}; if(d.CONTACT_ID&&String(d.CONTACT_ID)!=='0'){ try{ c=(await bx('crm.contact.get',{id:d.CONTACT_ID})).result||{}; }catch(e){} }
    const tel=phone(first(c.PHONE));
    if(!tel){
      if(deneme===2) sd.franchiseRetry[id]=now;
      await bx('crm.deal.update',{id,fields:{STAGE_ID:ST.OLUMSUZ,ASSIGNED_BY_ID:SORUMLU_ID},params:{REGISTER_SONET_EVENT:'Y'}});
      await not(id,'Vapi AI: Kişi kartında geçerli bir telefon numarası bulunamadı; arama yapılamadı.');
      continue;
    }
    if(deneme===1) await bx('crm.deal.update',{id,fields:{STAGE_ID:ST.ARIYOR,ASSIGNED_BY_ID:SORUMLU_ID},params:{REGISTER_SONET_EVENT:'Y'}});
    else{ sd.franchiseRetry[id]=now; await bx('crm.deal.update',{id,fields:{ASSIGNED_BY_ID:SORUMLU_ID}}); }
    if(c.ID){ try{ await bx('crm.contact.update',{id:c.ID,fields:{ASSIGNED_BY_ID:SORUMLU_ID},params:{REGISTER_SONET_EVENT:'N'}}); }catch(e){} }
    sd.numaraSirasi=((sd.numaraSirasi||0)+1)%kapasite;
    const numaraId=numaraIdleri[sd.numaraSirasi];
    const firstName=tc(c.NAME||''); const fullName=(firstName+' '+tc(c.LAST_NAME||'')).trim()||tc(d.TITLE||'');
    out.push({json:{deal_id:id,contact_id:String(d.CONTACT_ID||''),full_name:fullName||'Değerli Aday',first_name:firstName,phone_e164:tel,email:first(c.EMAIL),
      deneme,phone_number_id:numaraId,arayan_numara:NUMARALAR[numaraId],...aramaDegiskenleri(firstName)}});
  }catch(e){ delete sd.franchiseKuyruk[id]; }
}
return out;''')

vapi_call("Vapi - Aramayı Başlat", [-16, -176], "$json")
iff("Vapi Araması Başladı mı?", [208, -176], "!!$json.id")
bx("Bitrix - Not: Arama Başladı", [432, -256], "crm.timeline.comment.add",
   "{fields:{ENTITY_ID:$('Arama Kuyruğu (3 numara)').item.json.deal_id,ENTITY_TYPE:\"deal\",COMMENT:\"Vapi AI: \"+$('Arama Kuyruğu (3 numara)').item.json.deneme+\". arama başlatıldı (arayan numara: \"+$('Arama Kuyruğu (3 numara)').item.json.arayan_numara+\").\"}}", on_error=True)
code("Başarısız Aramayı Kuyruğa Al", [432, -96], r'''const BITRIX='__BX__'; const ST_POT='__POT__';
const bx=(m,body)=>this.helpers.httpRequest({method:'POST',url:`${BITRIX}/${m}.json`,body,json:true});
const k=$('Arama Kuyruğu (3 numara)').item.json; const id=k.deal_id;
const sd=$getWorkflowStaticData('global'); sd.franchiseHata=sd.franchiseHata||{}; sd.franchiseKuyruk=sd.franchiseKuyruk||{}; sd.franchiseRetry=sd.franchiseRetry||{};
const n=(sd.franchiseHata[id]||0)+1; sd.franchiseHata[id]=n;
const e=$json.error; const hata=String((e&&(e.message||JSON.stringify(e)))||$json.message||JSON.stringify($json)).slice(0,400);
let metin;
if(n<3){
  delete sd.franchiseKuyruk[id];
  if(Number(k.deneme)===1) await bx('crm.deal.update',{id,fields:{STAGE_ID:ST_POT}}); else delete sd.franchiseRetry[id];
  metin=`Vapi AI: Arama başlatılamadı (${n}/3), birkaç dakika içinde tekrar denenecek. Hata: ${hata}`;
}else metin=`Vapi AI: Arama 3 kez başlatılamadı, otomatik deneme durduruldu — manuel kontrol edin. Hata: ${hata}`;
await bx('crm.timeline.comment.add',{fields:{ENTITY_ID:id,ENTITY_TYPE:'deal',COMMENT:metin}});
return {json:{deal_id:id,deneme_hatasi:n}};''', each=True, onError="continueRegularOutput")

# ================================================================ 2) ARAMA SONUCU
node("Webhook - Franchise Vapi Sonucu", "n8n-nodes-base.webhook", 2.1, [-464, 368],
     {"httpMethod": "POST", "path": "franchise-vapi-call-result", "options": {}},
     webhookId="a500cee9-e0a1-453a-aaab-22ca3274da2c")

code("Vapi - Franchise Normalize", [-240, 368], JS_SONUC_ALANI + r'''const input=$input.first().json||{}; const raw=input.body||input; const msg=raw.message||raw; const call=msg.call||raw.call||{}; const analysis=msg.analysis||call.analysis||raw.analysis||{}; const artifact=msg.artifact||call.artifact||raw.artifact||{};
const eventType=String(msg.type||raw.type||''); if(eventType!=='end-of-call-report') return [{json:{event:'vapi_ignored'}}];
let s={}; for(const c of [analysis.structuredData,analysis.structuredDataMulti,msg.structuredOutputs,msg.structuredOutput,artifact.structuredOutputs,artifact.structuredOutput,call.structuredOutputs,call.structuredOutput]){const r=fs(c); if(Object.keys(r).length){s=r;break;}}
const vars=call.assistantOverrides?.variableValues||{}; const meta={...(raw.metadata||{}),...(msg.metadata||{}),...(call.metadata||{}),...(vars||{})};
const er=String(call.endedReason||msg.endedReason||'').toLowerCase(); let result=String(s.arama_sonucu||'').trim();
if(!result && ULASILAMAZ_NEDEN.some(x=>er.includes(x))) result='ulasilamadi';
const ctype=String(call.type||'').toLowerCase().includes('inbound')?'Gelen':(meta.arama_turu||'Giden');
return [{json:{event:'call_analyzed',call_id:String(call.id||''),deal_id:String(meta.bitrix_deal_id||meta.bitrix_id||''),contact_id:String(meta.bitrix_contact_id||''),deneme:Number(meta.deneme||1),arama_turu:ctype,ended_reason:er,ended_at:String(msg.endedAt||call.endedAt||''),recording_url:String(artifact.recordingUrl||msg.recordingUrl||''),arama_sonucu:result,appointment_date:String(s.appointment_date||''),aranacak_saat:String(s.aranacak_saat||''),dnc_talebi:s.dnc_talebi===true,extracted_name:String(s.extracted_name||''),xre_bilgi_durumu:String(s.xre_bilgi_durumu||''),ofis_durumu:String(s.ofis_durumu||''),bolge:String(s.bolge||''),ilgi_seviyesi:String(s.ilgi_seviyesi||''),link_istegi:s.link_istegi===true,call_summary:String(s.call_summary||analysis.summary||''),call_successful:s.call_successful===true,user_sentiment:String(s.user_sentiment||''),customer_phone:String(call.customer?.number||meta.customer_phone||''),phone_number_id:String(call.phoneNumberId||msg.phoneNumber?.id||'')}}];''')

iff("Vapi Sonuç Event mi?", [-16, 368], "$json.event === 'call_analyzed'")

code("Anlaşmayı Bul + Sonucu Belirle", [208, 304], JS_ZAMAN + JS_KISI + JS_SONUC_ALANI + r'''// ===== AYARLAR =====
const BITRIX='__BX__';
const ST={POTANSIYEL:'__POT__',ARIYOR:'__ARIYOR__',RANDEVU:'__RANDEVU__',AI_RANDEVU_ESKI:'__AI_RANDEVU_ESKI__',ULASILAMAYAN:'__ULAS__',OLUMSUZ:'__OLUMSUZ__'};
const SORUMLU_ID=__RUSTEM__; // Rüstem Sarıoğlan
const TEKRAR_ARAMA_SAATI='10:30';
// Randevu tarihinin yazılacağı anlaşma alanları (diğer pipeline'larda kullanılan alanlar)
const RANDEVU_ALANI_TARIH_SAAT='UF_CRM_1786792054'; // Randevu Tarihi ve Saati (datetime)
const RANDEVU_ALANI_TARIH='UF_CRM_1734686018807';    // Randevu Tarihi (date)
// ===================
const bx=(m,body)=>this.helpers.httpRequest({method:'POST',url:`${BITRIX}/${m}.json`,body,json:true});
function okunur(ms){const t=parts(ms); return `${p2(t.d)}.${p2(t.m)}.${t.y} ${GUN[t.wd]} ${p2(t.hh)}:${p2(t.mi)}`;}
function iso(ms){const t=parts(ms); return `${t.y}-${p2(t.m)}-${p2(t.d)}T${p2(t.hh)}:${p2(t.mi)}:00+03:00`;}

// Randevu metnini Türkiye saatine göre kesin tarihe çevirir. Desteklenen: 2026-11-05 14:00, 2026-11-05T14:00(+03:00), 05.11.2026 14:00, 05/11 14.30, "yarın 15:00", "perşembe saat 11", "öğleden sonra 3"
function parseRandevu(raw,refMs){
  const s=String(raw||'').trim(); if(!s) return null;
  if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.test(s)){const ms=Date.parse(s); if(!isNaN(ms)) return {ms,saatVar:true};}
  const low=s.toLocaleLowerCase('tr-TR'); let y=null,m,d,rest=s,mt;
  if((mt=s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/))){y=+mt[1];m=+mt[2];d=+mt[3];rest=s.replace(mt[0],' ');}
  else if((mt=s.match(/(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?(?![:\d])/))&&!/^\d{1,2}[.:]\d{2}$/.test(mt[0])){d=+mt[1];m=+mt[2];y=mt[3]?+mt[3]:null;if(y!==null&&y<100)y+=2000;rest=s.replace(mt[0],' ');}
  else{
    const r=parts(refMs); let add=null;
    if(/öbür gün|ertesi gün/.test(low))add=2; else if(/yarın/.test(low))add=1; else if(/bugün/.test(low))add=0;
    else{const adlar=[['cumartesi',6],['pazartesi',1],['salı',2],['çarşamba',3],['perşembe',4],['cuma',5],['pazar',0]];
      for(const [ad,wd] of adlar){if(low.includes(ad)){add=(wd-r.wd+7)%7; if(add===0)add=7; if(/haftaya|gelecek hafta|önümüzdeki hafta/.test(low)&&add<7)add+=7; break;}}}
    if(add===null) return null; const g=parts(refMs+add*864e5); y=g.y;m=g.m;d=g.d;
  }
  let hh=null,mi=0;
  if((mt=rest.match(/(\d{1,2})[:.](\d{2})/))){hh=+mt[1];mi=+mt[2];}
  else if((mt=rest.toLocaleLowerCase('tr-TR').match(/saat\s*(\d{1,2})/)||rest.toLocaleLowerCase('tr-TR').match(/(?:öğleden sonra|akşam|sabah)\s*(\d{1,2})/))){hh=+mt[1];}
  if(hh!==null&&hh<12&&/öğleden sonra|akşam/.test(low))hh+=12;
  if(hh!==null&&hh>=1&&hh<=7&&!/sabah/.test(low))hh+=12; // "saat 3" -> 15:00 (iş saatlerinde 01-07 arası randevu olmaz)
  if(y===null){const r=parts(refMs); y=r.y; if(Date.UTC(y,m-1,d)<Date.UTC(r.y,r.m-1,r.d))y++;}
  if(!(m>=1&&m<=12&&d>=1&&d<=31&&(hh===null||(hh>=0&&hh<=23))&&mi>=0&&mi<=59)) return null;
  const ms=Date.UTC(y,m-1,d,hh===null?10:hh,mi)-TR; const c=parts(ms);
  if(c.m!==m||c.d!==d) return null; // 31.02 gibi geçersiz tarih
  return {ms,saatVar:hh!==null};
}
// Bir sonraki tekrar arama zamanı: ertesi gün 10:30 (haftanın 7 günü)
function sonrakiTekrar(refMs){const [h,mn]=TEKRAR_ARAMA_SAATI.split(':').map(Number); const g=parts(refMs+864e5); return Date.UTC(g.y,g.m-1,g.d,h,mn)-TR;}

const j=$input.first().json;
// Aynı arama sonucu iki kez gelirse tekrar işlenmez
const sd=$getWorkflowStaticData('global'); sd.franchiseCalls=sd.franchiseCalls||{};
if(j.call_id){ if(sd.franchiseCalls[j.call_id]) return []; sd.franchiseCalls[j.call_id]=Date.now();
  for(const [k,v] of Object.entries(sd.franchiseCalls)) if(Date.now()-v>3*864e5) delete sd.franchiseCalls[k]; }

let dealId=j.deal_id;
// Gelen aramalarda (inbound) deal id gelmez: telefon numarasından bulunur
if(!dealId && j.customer_phone){
  const dg=j.customer_phone.replace(/\D/g,'').replace(/^90/,'').replace(/^0/,'');
  const dup=await bx('crm.duplicate.findbycomm',{entity_type:'CONTACT',type:'PHONE',values:['+90'+dg,'90'+dg,'0'+dg,dg]});
  const kisiler=(dup.result&&dup.result.CONTACT)||[];
  for(const cid of kisiler){
    const dl=await bx('crm.deal.list',{filter:{CATEGORY_ID:4,CONTACT_ID:cid},order:{ID:'DESC'},select:['ID']});
    if(dl.result&&dl.result[0]){dealId=String(dl.result[0].ID);break;}
  }
}
if(!dealId) return [];
const deal=(await bx('crm.deal.get',{id:dealId})).result||{};
if(String(deal.CATEGORY_ID)!=='4') return [];
const contactId=String(deal.CONTACT_ID||j.contact_id||'');
let kisi={}; if(contactId&&contactId!=='0'){ try{ kisi=(await bx('crm.contact.get',{id:contactId})).result||{}; }catch(e){} }
const musteriAdi=(tc(kisi.NAME||'')+' '+tc(kisi.LAST_NAME||'')).trim()||j.extracted_name||deal.TITLE||'';
const musteriTel=phone(first(kisi.PHONE))||j.customer_phone;

const refMs=Date.parse(j.ended_at)||Date.now();
const r=norm(j.arama_sonucu);
let sonuc;
if(j.dnc_talebi||OLUMSUZLAR.includes(r)) sonuc='olumsuz';
else if(r.startsWith('randevu')||(!!j.appointment_date&&!r)) sonuc='randevu';
else if(ULASILAMADI.includes(r)) sonuc='ulasilamadi';
else if(['tekrar_ara','geri_ara','sonra_ara','dusunecek','dusunuyor','geri_aranacak'].includes(r)||j.aranacak_saat) sonuc='tekrar_ara';
else sonuc='belirsiz';
const giden=j.arama_turu!=='Gelen';
const ikinciDeneme=Number(j.deneme||1)>=2;

const uyarilar=[]; let randevu=null;
if(sonuc==='randevu'){
  randevu=parseRandevu(j.appointment_date,refMs);
  if(!randevu) uyarilar.push(`Randevu tarihi okunamadı ("${j.appointment_date||'boş'}") — müşteriyle teyit edin.`);
  else{
    if(!randevu.saatVar) uyarilar.push('Randevu saati belirtilmemiş (10:00 varsayıldı) — saati teyit edin.');
    if(randevu.ms<refMs-30*60e3) uyarilar.push('Randevu tarihi geçmişte görünüyor — teyit edin.');
    if(randevu.ms>refMs+90*864e5) uyarilar.push('Randevu tarihi 90 günden ileri — teyit edin.');
    const h=parts(randevu.ms).hh; if(randevu.saatVar&&(h<8||h>=21)) uyarilar.push('Randevu saati mesai dışı — teyit edin.');
  }
}

// Hedef aşama:
//  randevu -> Randevu Oluşturulan (C4:1), olumsuz -> OLUMSUZ
//  ulaşılamadı / sonra ara / belirsiz -> 1. denemede ULAŞILAMAYANLAR (ertesi gün 10:30'da tekrar aranır), 2. denemede OLUMSUZ
//  gelen aramada net sonuç yoksa aşama değişmez
let hedef=null, etiket;
if(sonuc==='randevu'){hedef=ST.RANDEVU; etiket='RANDEVU OLUŞTURDU';}
else if(sonuc==='olumsuz'){hedef=ST.OLUMSUZ; etiket='OLUMSUZ (istemiyor)';}
else{
  const neden={ulasilamadi:'ULAŞILAMADI',tekrar_ara:'SONRA ARANMAK İSTEDİ',belirsiz:'SONUÇ ALINAMADI'}[sonuc];
  if(!giden) etiket=neden+' (gelen arama, aşama değişmedi)';
  else if(ikinciDeneme){hedef=ST.OLUMSUZ; etiket=neden+' — 2. deneme, OLUMSUZ\'a taşındı';}
  else{hedef=ST.ULASILAMAYAN; etiket=`${neden} — ${okunur(sonrakiTekrar(refMs))} tekrar aranacak`;}
}
// Sadece yapay zeka aşamalarındaki kartlar taşınır; satış ekibinin ilerlettiği kartlar ve randevulu kartlar geri çekilmez.
const AI=[ST.POTANSIYEL,ST.ARIYOR,ST.ULASILAMAYAN,ST.OLUMSUZ,ST.AI_RANDEVU_ESKI,ST.RANDEVU];
const cur=String(deal.STAGE_ID);
const fields={ASSIGNED_BY_ID:SORUMLU_ID};
if(hedef&&AI.includes(cur)&&!(cur===ST.RANDEVU&&hedef!==ST.RANDEVU)) fields.STAGE_ID=hedef;
if(randevu){ fields[RANDEVU_ALANI_TARIH_SAAT]=iso(randevu.ms); fields[RANDEVU_ALANI_TARIH]=iso(randevu.ms).slice(0,10); }

const not=[
  `Vapi AI Franchise Görüşmesi (${j.arama_turu}${giden?`, ${j.deneme||1}. deneme`:''})`,
  `Sonuç: ${etiket}`,
  randevu?`Randevu: ${okunur(randevu.ms)}`:'',
  ...uyarilar.map(u=>'⚠ '+u),
  j.aranacak_saat?`Müşterinin istediği arama zamanı: ${j.aranacak_saat}`:'',
  j.extracted_name?`İsim: ${j.extracted_name}`:'',
  j.bolge?`Bölge: ${j.bolge}`:'', j.ofis_durumu?`Ofis durumu: ${j.ofis_durumu}`:'',
  j.xre_bilgi_durumu?`XRE bilgisi: ${j.xre_bilgi_durumu}`:'', j.ilgi_seviyesi?`İlgi: ${j.ilgi_seviyesi}`:'',
  j.dnc_talebi?'DNC: EVET (tekrar aranmak istemiyor)':'',
  j.call_summary?`Özet: ${j.call_summary}`:'',
  j.recording_url?`Kayıt: ${j.recording_url}`:'',
  j.ended_reason?`Bitiş nedeni: ${j.ended_reason}`:''
].filter(Boolean).join('\n');

const aktivite=sonuc==='randevu'?{
  deadline:randevu?iso(randevu.ms):iso(Date.now()+3600e3),
  title:randevu?`Franchise randevusu – ${musteriAdi} – ${okunur(randevu.ms)}`:`Franchise randevu tarihini teyit et – ${musteriAdi}`,
  description:not
}:null;

return [{json:{...j,deal_id:dealId,contact_id:contactId,musteri_adi:musteriAdi,musteri_tel:musteriTel,sonuc,deal_fields:fields,not,aktivite,randevu_var:!!aktivite,
  ulasilamadi_sms:(giden&&sonuc==='ulasilamadi')?(ikinciDeneme?2:1):0,
  tekrar_tarih:(()=>{const t=parts(sonrakiTekrar(refMs)); return `${p2(t.d)}.${p2(t.m)}.${t.y} saat ${TEKRAR_ARAMA_SAATI}`;})(),
  randevu_okunur:randevu?okunur(randevu.ms):'',randevu_iso:(randevu&&randevu.saatVar&&!uyarilar.length)?iso(randevu.ms):'',uyarilar,deal_link:`https://xre.bitrix24.com.tr/crm/deal/details/${dealId}/`}}];''')

S = "$('Anlaşmayı Bul + Sonucu Belirle').first().json"
bx("Bitrix - Anlaşmayı Güncelle + Rüstem", [432, 304], "crm.deal.update",
   "{id:$json.deal_id,fields:$json.deal_fields,params:{REGISTER_SONET_EVENT:\"Y\"}}")
bx("Bitrix - Sonuç Kişi Sorumlusu Rüstem", [656, 304], "crm.contact.update",
   "{id:" + S + ".contact_id||0,fields:{ASSIGNED_BY_ID:" + str(RUSTEM) + "},params:{REGISTER_SONET_EVENT:\"N\"}}", on_error=True)
bx("Bitrix - Görüşme Notu", [880, 304], "crm.timeline.comment.add",
   "{fields:{ENTITY_ID:" + S + ".deal_id,ENTITY_TYPE:\"deal\",COMMENT:" + S + ".not}}")
iff("Randevu mu?", [1104, 304], S + ".randevu_var === true")
bx("Bitrix - Randevu Aktivitesi (Rüstem)", [1328, 224], "crm.activity.todo.add",
   "{ownerTypeId:2,ownerId:Number(" + S + ".deal_id),deadline:" + S + ".aktivite.deadline,title:" + S + ".aktivite.title,description:" + S + ".aktivite.description,responsibleId:" + str(RUSTEM) + ",pingOffsets:[60]}")
code("Telegram - Randevu Bildirimi", [1552, 224], JS_TELEGRAM + r'''const j=$('Anlaşmayı Bul + Sonucu Belirle').first().json;
const satirlar=[
  '📅 <b>YENİ FRANCHISE RANDEVUSU</b>',
  '',
  `👤 <b>${esc(j.musteri_adi||'-')}</b>`,
  `📞 ${esc(j.musteri_tel||'-')}`,
  `🗓 <b>${esc(j.randevu_okunur||'Tarih teyit edilmeli')}</b>`,
  ...(j.uyarilar||[]).map(u=>'⚠️ '+esc(u)),
  j.bolge?`📍 Bölge: ${esc(j.bolge)}`:'',
  j.ofis_durumu?`🏢 Ofis durumu: ${esc(j.ofis_durumu)}`:'',
  j.ilgi_seviyesi?`🔥 İlgi: ${esc(j.ilgi_seviyesi)}`:'',
  `👔 Sorumlu: Rüstem Sarıoğlan`,
  `☎️ Arama: ${esc(j.arama_turu)}`,
  j.call_summary?`\n📝 ${esc(String(j.call_summary).slice(0,700))}`:'',
  `\n🔗 <a href="${j.deal_link}">Bitrix kartını aç</a>`
].filter(x=>x!=='');
await telegram(this,satirlar.join('\n'));
return [{json:{telegram:'gonderildi'}}];''', onError="continueRegularOutput")
code("Erccell - Müşteri SMS", [1552, 400], r'''// ===== ERCCELL AYARLARI (diğer flow'daki SMS kullanıcı adı / şifresi) =====
const j=$('Anlaşmayı Bul + Sonucu Belirle').first().json; const j_numara=()=>j.phone_number_id;
const SMS_USER='__SMS_USER__'; const SMS_PASSWORD='__SMS_PASS__'; const SMS_BASLIK='XRE';
const NUMARALAR=__NUMARALAR__;
const GERI_DONUS_NO=NUMARALAR[j_numara()]||'0533 743 60 24'; // müşteriyi arayan numara (inbound asistan karşılar)
// ==========================================================================
const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
// Türkçe karakterleri sadeleştir (çalışan West Point akışındaki gibi düz ASCII)
const tr=s=>String(s).replace(/ı/g,'i').replace(/İ/g,'I').replace(/ş/g,'s').replace(/Ş/g,'S').replace(/ğ/g,'g').replace(/Ğ/g,'G').replace(/ü/g,'u').replace(/Ü/g,'U').replace(/ö/g,'o').replace(/Ö/g,'O').replace(/ç/g,'c').replace(/Ç/g,'C');
const hane=String(j.musteri_tel||'').replace(/\D/g,'').replace(/^90/,'').replace(/^0/,'');
const ad=String(j.musteri_adi||'').trim(); const merhaba=`Merhaba ${ad?ad+', ':''}`;
let tur, mesaj;
if(j.randevu_var){
  tur='Randevu SMS\'i';
  // Tarih okunamadıysa ya da teyit gerekiyorsa müşteriye yanlış tarih gitmesin
  if(!j.randevu_iso) return [{json:{sms_durum:tur+' gönderilmedi: randevu tarihi netleşmedi.'}}];
  const tarih=j.randevu_iso.slice(8,10)+'.'+j.randevu_iso.slice(5,7)+'.'+j.randevu_iso.slice(0,4), saat=j.randevu_iso.slice(11,16);
  mesaj=`${merhaba}randevunuz ${tarih} saat ${saat} olarak planlanmıştır. XRE'li günler dileriz.`;
}else if(j.ulasilamadi_sms===1){
  tur='Ulaşılamadı SMS\'i (1. arama)';
  mesaj=`${merhaba}XRE Gayrimenkul olarak sizi aradık ancak ulaşamadık. ${j.tekrar_tarih}'dan itibaren tekrar arayacağız. Dilerseniz ${GERI_DONUS_NO} numarasından bize ulaşabilirsiniz. XRE'li günler dileriz.`;
}else if(j.ulasilamadi_sms===2){
  tur='Ulaşılamadı SMS\'i (2. arama)';
  mesaj=`${merhaba}XRE Gayrimenkul olarak sizi tekrar aradık ancak ulaşamadık. Görüşmek isterseniz ${GERI_DONUS_NO} numarasından bize ulaşabilirsiniz. XRE'li günler dileriz.`;
}else return [{json:{sms_durum:''}}];
if(!/^5\d{9}$/.test(hane)) return [{json:{sms_durum:tur+' gönderilmedi: geçerli cep telefonu yok.'}}];
mesaj=tr(mesaj); const numara='90'+hane;
const xml='<?xml version="1.0" encoding="UTF-8"?>\n<CORPORATESMS><HEADER><USERNAME>'+esc(SMS_USER)+'</USERNAME><PASSWORD>'+esc(SMS_PASSWORD)+'</PASSWORD><SMSHEADER><![CDATA['+SMS_BASLIK+']]></SMSHEADER><SMSTYPE>UC</SMSTYPE><SENDTYPE>1:N</SENDTYPE></HEADER><SMS><SMS_MESSAGE><![CDATA['+mesaj+']]></SMS_MESSAGE><NUMBERS>'+numara+'</NUMBERS></SMS></CORPORATESMS>';
let yanit;
try{
  yanit=await this.helpers.httpRequest({method:'POST',url:'https://gateway.erccell.com.tr/corporatesms/sendsms/',headers:{'Content-Type':'text/xml; charset=UTF-8'},body:xml,json:false,encoding:'text',timeout:20000,ignoreHttpStatusErrors:true});
  if(typeof yanit!=='string') yanit=Buffer.isBuffer(yanit)?yanit.toString('utf8'):JSON.stringify(yanit);
}catch(e){ yanit='HATA: '+String((e&&e.message)||e); }
return [{json:{sms_numara:numara,sms_mesaj:mesaj,sms_durum:`${tur} gönderildi (${numara}): "${mesaj}"\nErccell yanıtı: ${String(yanit).slice(0,300)}`}}];''', onError="continueRegularOutput")
iff("SMS Notu Var mı?", [1776, 400], "!!$json.sms_durum || !!$json.error")
bx("Bitrix - Not: SMS", [2000, 320], "crm.timeline.comment.add",
   "{fields:{ENTITY_ID:" + S + ".deal_id,ENTITY_TYPE:\"deal\",COMMENT:String($json.sms_durum||('SMS hatası: '+JSON.stringify($json.error||$json))).slice(0,1000)}}", on_error=True)
iff("WhatsApp İzni Var mı?", [2224, 304], S + ".link_istegi === true")
node("WhatsApp - Franchise Bilgi Gönder", "n8n-nodes-base.httpRequest", 4.1, [2448, 224],
     {"method": "POST", "url": "YOUR_WHATSAPP_GATEWAY_URL", "sendHeaders": True,
      "headerParameters": {"parameters": [{"name": "Authorization", "value": "Bearer YOUR_API_KEY"}]},
      "sendBody": True, "bodyParameters": {"parameters": [
          {"name": "phone", "value": "={{ " + S + ".customer_phone }}"},
          {"name": "message", "value": "Türkiye ve Kıbrıs genelindeki XRE Kurucu 100 Ofis yapılanmasıyla ilgili tanıtım bilgileri: xre.com.tr/ofis-basvuru"}]},
      "options": {}}, onError="continueRegularOutput")

# ================================================================ 4) GÜN SONU RAPORU (20:00)
node("Her Gün 20:00", "n8n-nodes-base.scheduleTrigger", 1.2, [-464, 1136],
     {"rule": {"interval": [{"field": "cronExpression", "expression": "0 20 * * *"}]}})
code("Rapor Zaman Aralığı", [-240, 1136], JS_ZAMAN + r'''const now=Date.now(); const t=parts(now);
const bas=Date.UTC(t.y,t.m-1,t.d)-TR;
return [{json:{baslangic:new Date(bas).toISOString(),bitis:new Date(now).toISOString(),tarih:`${p2(t.d)}.${p2(t.m)}.${t.y} ${GUN[t.wd]}`}}];''')
node("Vapi - Bugünkü Aramalar", "n8n-nodes-base.httpRequest", 4.1, [-16, 1136],
     {"url": "https://api.vapi.ai/call", "authentication": "genericCredentialType", "genericAuthType": "httpHeaderAuth",
      "sendQuery": True, "queryParameters": {"parameters": [
          {"name": "createdAtGe", "value": "={{ $json.baslangic }}"},
          {"name": "createdAtLt", "value": "={{ $json.bitis }}"},
          {"name": "limit", "value": "1000"}]}, "options": {}},
     credentials=VAPI_CRED, retryOnFail=True, alwaysOutputData=True)
code("Günlük Rapor - Telegram", [208, 1136], JS_SONUC_ALANI + JS_TELEGRAM + r'''const BITRIX='__BX__'; const NUMARALAR=__NUMARALAR__; const ASISTANLAR=['__AS_OUT__','__AS_IN__'];
const bx=(m,body)=>this.helpers.httpRequest({method:'POST',url:`${BITRIX}/${m}.json`,body,json:true});
const z=$('Rapor Zaman Aralığı').first().json;
let calls=[]; for(const it of $input.all()){const v=it.json; if(Array.isArray(v))calls.push(...v); else if(v&&Array.isArray(v.results))calls.push(...v.results); else if(v&&v.id)calls.push(v);}
calls=calls.filter(c=>NUMARALAR[c.phoneNumberId]||ASISTANLAR.includes(c.assistantId));
const numaraBazinda={};
const aranan=new Set(),gelen=new Set(),iletisim=new Set(),randevu=new Set(),olumsuz=new Set(),girisimDisi=new Set();
let saniye=0,maliyet=0,giden=0,gelenSayi=0;
for(const c of calls){
  const num=(c.customer&&c.customer.number)||c.id; const inbound=String(c.type||'').includes('inbound');
  const er=String(c.endedReason||'').toLowerCase();
  const s=fs([c.analysis&&c.analysis.structuredData,c.artifact&&c.artifact.structuredOutputs,c.structuredOutputs,c.analysis]);
  const r=norm(s.arama_sonucu);
  const dur=(c.startedAt&&c.endedAt)?Math.max(0,(Date.parse(c.endedAt)-Date.parse(c.startedAt))/1000):0;
  const ulasilamadi=!c.startedAt||ULASILAMAZ_NEDEN.some(x=>er.includes(x))||ULASILAMADI.includes(r);
  maliyet+=Number(c.cost||0);
  if(inbound){gelen.add(num);gelenSayi++;} else {aranan.add(num);giden++; const nn=NUMARALAR[c.phoneNumberId]||'diğer'; numaraBazinda[nn]=(numaraBazinda[nn]||0)+1;}
  if(!ulasilamadi){iletisim.add(num); saniye+=dur;}
  if(r.startsWith('randevu')) randevu.add(num);
  else if(s.dnc_talebi===true||OLUMSUZLAR.includes(r)) olumsuz.add(num);
}
const ulasilamayan=[...aranan].filter(n=>!iletisim.has(n)).length;
let bekleyen='-'; try{ bekleyen=(await bx('crm.deal.list',{filter:{CATEGORY_ID:4,STAGE_ID:'__ULAS__'},select:['ID']})).total; }catch(e){}
const dk=saniye/60;
const metin=[
  `📊 <b>XRE FRANCHISE – GÜN SONU RAPORU</b>`,
  `🗓 ${esc(z.tarih)}`,
  '',
  `📞 Aranan kişi: <b>${aranan.size}</b> (toplam ${giden} arama)`,
  `📲 Gelen arama: <b>${gelen.size}</b>`,
  `🗣 İletişime geçilen: <b>${iletisim.size}</b>`,
  `📅 Randevu oluşturulan: <b>${randevu.size}</b>`,
  `❌ Olumsuz: <b>${olumsuz.size}</b>`,
  `📵 Ulaşılamayan: <b>${ulasilamayan}</b>`,
  `⏱ Toplam konuşma: <b>${dk.toFixed(1).replace('.',',')} dk</b>`,
  '',
  ...(Object.keys(numaraBazinda).length?['📱 Numara bazında giden arama:',...Object.entries(numaraBazinda).map(([k,v])=>`   ${esc(k)}: ${v}`)]:[]),
  '',
  `🔁 Yarın 10:30'dan itibaren tekrar aranacak havuz: ${bekleyen}`,
  `💵 Vapi maliyeti: $${maliyet.toFixed(2)}`
].join('\n');
await telegram(this,metin);
return [{json:{aranan:aranan.size,iletisim:iletisim.size,randevu:randevu.size,olumsuz:olumsuz.size,ulasilamayan,dakika:+dk.toFixed(1)}}];''')

# ---------------------------------------------------------------- bağlantılar
conns = {}
def link(a, b, out=0):
    m = conns.setdefault(a, {"main": []})["main"]
    while len(m) <= out:
        m.append([])
    m[out].append({"node": b, "type": "main", "index": 0})

for a, b in [("Her 3 Dakikada", "Arama Kuyruğu (3 numara)"), ("Arama Kuyruğu (3 numara)", "Vapi - Aramayı Başlat"),
             ("Vapi - Aramayı Başlat", "Vapi Araması Başladı mı?"), ("Vapi Araması Başladı mı?", "Bitrix - Not: Arama Başladı"),
             ("Webhook - Franchise Vapi Sonucu", "Vapi - Franchise Normalize"), ("Vapi - Franchise Normalize", "Vapi Sonuç Event mi?"),
             ("Vapi Sonuç Event mi?", "Anlaşmayı Bul + Sonucu Belirle"), ("Anlaşmayı Bul + Sonucu Belirle", "Bitrix - Anlaşmayı Güncelle + Rüstem"),
             ("Bitrix - Anlaşmayı Güncelle + Rüstem", "Bitrix - Sonuç Kişi Sorumlusu Rüstem"), ("Bitrix - Sonuç Kişi Sorumlusu Rüstem", "Bitrix - Görüşme Notu"),
             ("Bitrix - Görüşme Notu", "Randevu mu?"), ("Randevu mu?", "Bitrix - Randevu Aktivitesi (Rüstem)"),
             ("Bitrix - Randevu Aktivitesi (Rüstem)", "Telegram - Randevu Bildirimi"), ("Telegram - Randevu Bildirimi", "Erccell - Müşteri SMS"),
             ("Erccell - Müşteri SMS", "SMS Notu Var mı?"), ("SMS Notu Var mı?", "Bitrix - Not: SMS"), ("Bitrix - Not: SMS", "WhatsApp İzni Var mı?"),
             ("WhatsApp İzni Var mı?", "WhatsApp - Franchise Bilgi Gönder"),
             ("Her Gün 20:00", "Rapor Zaman Aralığı"), ("Rapor Zaman Aralığı", "Vapi - Bugünkü Aramalar"),
             ("Vapi - Bugünkü Aramalar", "Günlük Rapor - Telegram")]:
    link(a, b)
link("Vapi Araması Başladı mı?", "Başarısız Aramayı Kuyruğa Al", 1)
link("Randevu mu?", "Erccell - Müşteri SMS", 1)
link("SMS Notu Var mı?", "WhatsApp İzni Var mı?", 1)

names = [n["name"] for n in nodes]
assert len(names) == len(set(names))
for a, v in conns.items():
    assert a in names, a
    for outs in v["main"]:
        for c in outs:
            assert c["node"] in names, c["node"]

wf = {"name": "XRE Franchise Vapi - Anlaşmalar", "nodes": nodes, "pinData": {}, "connections": conns,
      "active": False, "settings": {"executionOrder": "v1", "binaryMode": "separate", "timezone": "Europe/Istanbul"},
      "versionId": str(uuid.uuid4()),
      "meta": {"instanceId": "6dcbeae59cf89cdc0a07d718f42dfd9fbd0d6bdd06e3e96e03e86795f4ea2a95"},
      "id": "YyZhu3ruLdUMHiJ9", "tags": []}
out = json.dumps(wf, ensure_ascii=False, indent=2)
if not GIZLI:
    assert "YOUR_WEBHOOK" in out and "YOUR_TELEGRAM_BOT_TOKEN" in out and "YOUR_ERCCELL_PASSWORD" in out
json.dump(wf, open(sys.argv[1], "w"), ensure_ascii=False, indent=2)
print(len(nodes), "nodes ->", sys.argv[1])
