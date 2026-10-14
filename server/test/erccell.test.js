const test = require('node:test');
const assert = require('node:assert');
const { createErccellProvider } = require('../src/providers/erccell');

function fakeFetch(status, text, calls) {
  return async (url, opts) => { calls.push({ url, opts }); return { ok: status < 400, status, text: async () => text }; };
}

test('Erccell XML isteğini doğru kurar', async () => {
  const calls = [];
  const p = createErccellProvider({ username: 'u', password: 'p&1', header: 'XRE', fetchImpl: fakeFetch(200, '<RESULT>12345</RESULT>', calls) });
  const { ref } = await p.send('5321112233', 'Merhaba Ayşe ]]> & <link>');
  const xml = calls[0].opts.body;
  assert.strictEqual(calls[0].url, 'https://gateway.erccell.com.tr/corporatesms/sendsms/');
  assert.strictEqual(calls[0].opts.method, 'POST');
  assert.match(xml, /<NUMBERS>905321112233<\/NUMBERS>/);
  assert.match(xml, /<PASSWORD>p&amp;1<\/PASSWORD>/);
  assert.match(xml, /<SMSHEADER><!\[CDATA\[XRE\]\]><\/SMSHEADER>/);
  assert.match(xml, /<SMSTYPE>UC<\/SMSTYPE>[\s\S]*<SENDTYPE>1:N<\/SENDTYPE>/);
  assert.match(xml, /<SMS_MESSAGE><!\[CDATA\[Merhaba Ayşe ]]]]><!\[CDATA\[> & <link>\]\]><\/SMS_MESSAGE>/);
  assert.strictEqual(ref, '<RESULT>12345</RESULT>');
});

test('Erccell hata yanıtlarını başarısız sayar', async () => {
  const mk = (status, text) => createErccellProvider({ username: 'u', password: 'p', header: 'H', fetchImpl: fakeFetch(status, text, []) });
  await assert.rejects(mk(500, 'boom').send('5321112233', 'x'), /HTTP 500/);
  await assert.rejects(mk(200, '<ERROR>Kullanici adi veya sifre hatali</ERROR>').send('5321112233', 'x'), /Erccell hata/);
  await assert.rejects(mk(200, '').send('5321112233', 'x'), /boş yanıt/);
});
