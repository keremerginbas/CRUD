const test = require('node:test');
const assert = require('node:assert');
const tg = require('../telegram.js');

const TOKEN = '111111:TEST-TOKEN';
const book = { title: "Özgür'ün Salıncağı", isbn: '9786259756189' };
const targets = [{ id: 'ky', name: 'Kitapyurdu' }, { id: 'imge', name: 'İmge Kitabevi' }, { id: 'hb', name: 'Hepsiburada' }];

// Telegram'ın yerine geçen sahte ağ: çağrıları kaydeder, yönteme göre hazır yanıt döner.
function fakeTelegram(replies) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    const method = url.split('/').pop();
    calls.push({ url, method, body: opts && opts.body ? JSON.parse(opts.body) : null });
    const r = replies[method];
    if (r instanceof Error) throw r;
    return { status: r.status || 200, json: async () => r.body };
  };
  return { calls, fetchImpl };
}
const me = { ok: true, result: { id: 111111, is_bot: true, first_name: 'Kitap', username: 'kitap_test_bot', can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false } };
const update = (id, chat) => ({ update_id: id, message: { message_id: id, from: { id: chat.id, is_bot: false, first_name: chat.first_name, language_code: 'tr' }, chat: { ...chat, type: 'private' }, date: 1794380000 + id, text: '/start', entities: [{ offset: 0, length: 6, type: 'bot_command' }] } });

// --- Mesaj metni ---

test('değişiklik ve doğrulama yoksa mesaj üretilmez', () => {
  assert.strictEqual(tg.buildScanMessage({ book, targets, events: [], blocked: [] }), null);
});

test('satış sayacı artınca mesaj siteyi ve satılan adedi söyler', () => {
  const msg = tg.buildScanMessage({ book, targets, events: [{ targetId: 'ky', field: 'soldCount', from: 14, to: 16, ts: 1 }], blocked: [] });
  assert.ok(msg.startsWith("Özgür'ün Salıncağı\n"), msg);
  assert.ok(msg.includes('Kitapyurdu: 2 adet satıldı (satın alma sayacı 14 → 16)'), msg);
});

test('stok azalması ve tükenme ayrı satırlarda bildirilir', () => {
  const msg = tg.buildScanMessage({ book, targets, blocked: [], events: [
    { targetId: 'imge', field: 'status', from: 'in_stock', to: 'out_of_stock', ts: 1 },
    { targetId: 'imge', field: 'stockQty', from: 2, to: 0, ts: 1 },
  ] });
  assert.deepStrictEqual(msg.split('\n').slice(1), ['İmge Kitabevi: Stok tükendi', 'İmge Kitabevi: Stoktan 2 adet düştü (kalan: 0)']);
});

test('yalnızca temin süresi değiştiyse bildirim gönderilmez', () => {
  assert.strictEqual(tg.buildScanMessage({ book, targets, blocked: [], events: [{ targetId: 'imge', field: 'leadTime', from: '3 gün', to: '7 gün', ts: 1 }] }), null);
});

test('doğrulama isteyen siteler tek satırda adlarıyla bildirilir', () => {
  const msg = tg.buildScanMessage({ book, targets, events: [], blocked: ['hb', 'ky'] });
  assert.ok(msg.includes('Doğrulama gerekiyor: Hepsiburada, Kitapyurdu.'), msg);
});

test('çok uzun değişiklik listesi Telegram sınırına sığacak biçimde kısaltılır', () => {
  const events = Array.from({ length: 200 }, (_, i) => ({ targetId: 'imge', field: 'price', from: 100 + i, to: 101 + i, ts: i }));
  const msg = tg.buildScanMessage({ book, targets, events, blocked: [] });
  assert.ok(msg.length <= 4096, `uzunluk ${msg.length}`);
  assert.ok(msg.includes('ve 170 değişiklik daha'), msg.slice(-120));
});

// --- Doğrulama bildiriminin sıklığı ---

test('aynı site için doğrulama bildirimi günde bir kez gönderilir', () => {
  const first = tg.pickBlockedNotices(['hb', 'ky'], {}, '2026-11-11');
  assert.deepStrictEqual(first.ids, ['hb', 'ky']);
  const again = tg.pickBlockedNotices(['hb', 'ky'], first.notified, '2026-11-11');
  assert.deepStrictEqual(again.ids, []);
  const nextDay = tg.pickBlockedNotices(['hb'], again.notified, '2026-11-12');
  assert.deepStrictEqual(nextDay.ids, ['hb']);
});

// --- Bağlanma ---

test('bağlanınca botun adı ve en son yazan sohbet bulunur', async () => {
  const net = fakeTelegram({ getMe: { body: me }, getUpdates: { body: { ok: true, result: [update(1, { id: 500, first_name: 'Eski' }), update(2, { id: 777, first_name: 'Ada' })] } } });
  const res = await tg.connect(TOKEN, net.fetchImpl);
  assert.deepStrictEqual(res, { ok: true, botName: 'kitap_test_bot', chatId: 777, chatName: 'Ada' });
  assert.deepStrictEqual(net.calls.map((c) => c.url), [`https://api.telegram.org/bot${TOKEN}/getMe`, `https://api.telegram.org/bot${TOKEN}/getUpdates`]);
});

test('token geçersizse bağlanma bunu söyler ve sohbet aramaz', async () => {
  const net = fakeTelegram({ getMe: { status: 401, body: { ok: false, error_code: 401, description: 'Unauthorized' } } });
  const res = await tg.connect('yanlis', net.fetchImpl);
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, 'token');
  assert.strictEqual(net.calls.length, 1);
});

test('bota henüz yazılmadıysa bağlanma "önce Başlat" der', async () => {
  const net = fakeTelegram({ getMe: { body: me }, getUpdates: { body: { ok: true, result: [] } } });
  const res = await tg.connect(TOKEN, net.fetchImpl);
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, 'no_chat');
  assert.strictEqual(res.botName, 'kitap_test_bot');
});

test('ağ hatasında bağlanma çökmez, nedeni bildirir', async () => {
  const net = fakeTelegram({ getMe: new TypeError('Failed to fetch') });
  const res = await tg.connect(TOKEN, net.fetchImpl);
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, 'network');
});

// --- Gönderme ---

test('mesaj doğru sohbete, düz metin olarak gönderilir', async () => {
  const net = fakeTelegram({ sendMessage: { body: { ok: true, result: { message_id: 9, date: 1794380100, chat: { id: 777, first_name: 'Ada', type: 'private' }, text: 'Merhaba' } } } });
  const res = await tg.sendMessage(TOKEN, 777, 'Merhaba', net.fetchImpl);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(net.calls[0].url, `https://api.telegram.org/bot${TOKEN}/sendMessage`);
  assert.strictEqual(net.calls[0].body.chat_id, 777);
  assert.strictEqual(net.calls[0].body.text, 'Merhaba');
  assert.strictEqual(net.calls[0].body.parse_mode, undefined);
});

test('bot engellendiyse gönderme başarısız döner ve ne yapılacağını söyler', async () => {
  const net = fakeTelegram({ sendMessage: { status: 403, body: { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' } } });
  const res = await tg.sendMessage(TOKEN, 777, 'Merhaba', net.fetchImpl);
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, 'chat');
  assert.match(res.message, /Başlat/);
});

test('uyarılar (ör. kitap sepette kaldı) mesajın sonuna eklenir', () => {
  const msg = tg.buildScanMessage({ book, targets, events: [], blocked: [], warnings: ['Hepsiburada: Ölçümden sonra kitap sepetinizden çıkarılamadı; sepetinizi kontrol edin.'] });
  assert.deepStrictEqual(msg.split('\n'), ["Özgür'ün Salıncağı", 'Hepsiburada: Ölçümden sonra kitap sepetinizden çıkarılamadı; sepetinizi kontrol edin.']);
});
