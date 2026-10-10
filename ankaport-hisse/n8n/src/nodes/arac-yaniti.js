// Vapi'ye dönecek araç yanıtı: { results: [{ toolCallId, result }] }
const plan = $('Araç Planı').first().json;

let yanit = null;
try {
  yanit = $('Bitrix: Araç Kaydı').first().json;
} catch (e) {
  yanit = null;
}
const hatalar = batchHatalari(yanit);
const tumuBasarisiz = plan.kayitVar && (!yanit || yanit.error || !yanit.result);

const basarisiz = (tcId) => {
  const k = plan.kritik[tcId];
  return !!k && (tumuBasarisiz || !!hatalar[k]);
};

const results = plan.sonuclar.map((s) => {
  if (basarisiz(s.toolCallId)) {
    return { toolCallId: s.toolCallId, result: 'Sisteme kayıt sırasında teknik bir sorun oldu. Müşteriye talebini not aldığını ve danışmanımızın kendisini arayıp teyit edeceğini söyle.' };
  }
  return s;
});

return [{ json: { results } }];
