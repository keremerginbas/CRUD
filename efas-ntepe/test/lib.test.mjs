// Ortak yardımcıların birim testleri:  node test/lib.test.mjs
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const kaynak = readFileSync(new URL('../n8n/src/lib.js', import.meta.url), 'utf8');
const L = new Function(
  `${kaynak}; return { trIso, trMetin, trGun, trTarihSaatCoz, pencereIcinde, pencereyeTasi, telefonNormalize, telefonVaryantlari, qs, sorumluSec, isimDuzelt, adSoyadBol, vapiMesajCoz, aramaLimiti, pencereMetni };`
)();

const t = (ad, fn) => {
  fn();
  console.log(`  ✅ ${ad}`);
};
const TR = (s) => new Date(s); // ISO + offset

t('telefon normalizasyonu', () => {
  assert.equal(L.telefonNormalize('0532 111 22 33'), '+905321112233');
  assert.equal(L.telefonNormalize('5321112233'), '+905321112233');
  assert.equal(L.telefonNormalize('+90 (532) 111-22-33'), '+905321112233');
  assert.equal(L.telefonNormalize('905321112233'), '+905321112233');
  assert.equal(L.telefonNormalize('0090 532 111 22 33'), '+905321112233');
  assert.equal(L.telefonNormalize('0312 444 24 53'), '+903124442453');
  assert.equal(L.telefonNormalize('+49 151 23456789'), '+4915123456789');
  assert.equal(L.telefonNormalize('123'), null);
  assert.equal(L.telefonNormalize(''), null);
  assert.ok(L.telefonVaryantlari('+905321112233').includes('05321112233'));
});

t('İstanbul saati dönüşümleri', () => {
  const d = L.trTarihSaatCoz('2026-10-08', '14:00');
  assert.equal(d.toISOString(), '2026-10-08T11:00:00.000Z');
  assert.equal(L.trIso(d), '2026-10-08T14:00:00+03:00');
  assert.equal(L.trMetin(d), '08.10.2026 Perşembe 14:00');
  assert.equal(L.trGun(TR('2026-10-08T22:30:00Z')), '2026-10-09'); // gece yarısından sonra İstanbul'da ertesi gün
  assert.equal(L.trTarihSaatCoz('2026-02-30', '10:00'), null);
  assert.equal(L.trTarihSaatCoz('2026-10-08', '25:00'), null);
  assert.equal(L.trTarihSaatCoz('yarın', '10:00'), null);
});

t('çalışma penceresi', () => {
  const p = { GUNLER: [1, 2, 3, 4, 5, 6], BASLA: '10:00', BITIS: '19:00' };
  assert.equal(L.pencereIcinde(TR('2026-10-06T12:00:00+03:00'), p), true); // Salı
  assert.equal(L.pencereIcinde(TR('2026-10-06T19:00:00+03:00'), p), false);
  assert.equal(L.pencereIcinde(TR('2026-10-11T12:00:00+03:00'), p), false); // Pazar
  // Salı 20:30 → Çarşamba 10:00
  assert.equal(L.trIso(L.pencereyeTasi(TR('2026-10-06T20:30:00+03:00'), p)), '2026-10-07T10:00:00+03:00');
  // Salı 08:00 → aynı gün 10:00
  assert.equal(L.trIso(L.pencereyeTasi(TR('2026-10-06T08:00:00+03:00'), p)), '2026-10-06T10:00:00+03:00');
  // Cumartesi 19:30 → Pazartesi 10:00 (Pazar kapalı)
  assert.equal(L.trIso(L.pencereyeTasi(TR('2026-10-10T19:30:00+03:00'), p)), '2026-10-12T10:00:00+03:00');
  assert.equal(L.pencereMetni(p), 'Pazartesi-Cumartesi 10:00-19:00');
});

t('Bitrix batch sorgu kodlaması (http_build_query)', () => {
  const q = L.qs({ id: 5, fields: { STATUS_ID: 'UC_X', PHONE: [{ VALUE: '+90 532', VALUE_TYPE: 'MOBILE' }], BOS: '' }, atla: undefined });
  assert.equal(
    q,
    'id=5&fields%5BSTATUS_ID%5D=UC_X&fields%5BPHONE%5D%5B0%5D%5BVALUE%5D=%2B90%20532&fields%5BPHONE%5D%5B0%5D%5BVALUE_TYPE%5D=MOBILE&fields%5BBOS%5D='
  );
});

t('sorumlu seçimi ve isimler', () => {
  assert.equal(L.sorumluSec([], '12', '3'), '3');
  assert.ok(['7', '9'].includes(L.sorumluSec([7, 9], '12', '3')));
  assert.equal(L.sorumluSec([7, 9], '12', '3'), L.sorumluSec([7, 9], '12', '3')); // deterministik
  assert.equal(L.isimDuzelt('İSMAİL IŞIK'), 'İsmail Işık');
  assert.deepEqual(L.adSoyadBol('Ayşe Nur Kaya'), { NAME: 'Ayşe Nur', LAST_NAME: 'Kaya' });
});

t('arama limiti (müşteri geri arama isterse ek hak)', () => {
  const A = { MAX_DENEME: 3, TEKRAR_ARA_EK_HAK: 2 };
  assert.equal(L.aramaLimiti(A, 'ULASILAMADI'), 3);
  assert.equal(L.aramaLimiti(A, 'TEKRAR_ARA'), 5);
  assert.equal(L.aramaLimiti(A, 'ULASILAMADI_TA'), 5);
});

t('Vapi mesaj çözümleme', () => {
  const m = L.vapiMesajCoz({
    message: {
      type: 'end-of-call-report',
      endedReason: 'customer-did-not-answer',
      cost: 0.12,
      call: { id: 'c1', customer: { number: '+905321112233' }, assistantOverrides: { variableValues: { lead_id: '42', deneme: '2' } } },
      artifact: { messages: [{ role: 'bot', message: 'Merhaba' }] },
    },
  });
  assert.equal(m.leadId, '42');
  assert.equal(m.deneme, 2);
  assert.equal(m.ulasildi, false);
  assert.equal(m.maliyet, 0.12);
  const k = L.vapiMesajCoz({ message: { type: 'end-of-call-report', transcript: 'AI: Merhaba\nUser: Evet benim', call: {} } });
  assert.equal(k.ulasildi, true);
  const so = L.vapiMesajCoz({
    message: {
      type: 'end-of-call-report',
      analysis: { summary: 'English summary' },
      artifact: { structuredOutputs: { 'id-1': { name: 'efas_ntepe_sonuc', result: { sonuc: 'kararsiz', ozet: 'Türkçe özet' } } } },
      call: {},
    },
  });
  assert.equal(so.yapi.sonuc, 'kararsiz');
  assert.equal(so.ozet, 'Türkçe özet');
  const tc = L.vapiMesajCoz({ message: { type: 'tool-calls', toolCallList: [{ id: 'x', function: { name: 'a', arguments: '{"b":1}' } }] } });
  assert.deepEqual(tc.toolCalls, [{ id: 'x', ad: 'a', arg: { b: 1 } }]);
});

console.log('lib testleri tamam');
