// Görüşmenin ses kaydını lead'e dosya olarak eklemek için lead ID'sini bul (yeni lead ise batch sonucundan)
const ses = $('Rapor Planı').first().json.ses;
if (!ses || !ses.url || !ses.leadRef) return [];
let leadId = String(ses.leadRef);
const ref = /^\$result\[(.+)\]$/.exec(leadId);
if (ref) leadId = String(batchSonuclari($input.first().json)[ref[1]] || '');
if (!/^\d+$/.test(leadId)) return [];
return [{ json: { leadId, url: ses.url, dosyaAdi: ses.dosyaAdi, baslik: ses.baslik } }];
