// Telegram bildirimleri: mesaj metni ve Bot API çağrıları.
// Token yalnızca tarayıcının yerel deposunda durur; bu dosyada ya da depoda yer almaz.
(function (root, factory) {
  const lib = typeof module === 'object' && module.exports ? require('./lib.js') : root.KitapTakipLib;
  const api = factory(lib);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KitapTakipTelegram = api;
})(typeof self !== 'undefined' ? self : this, function (lib) {
  const API = 'https://api.telegram.org';
  const MAX_LINES = 30; // Telegram tek mesajda 4096 karakter kabul eder.
  // Bildirilecek değişiklik türleri; temin süresi gibi ufak oynamalar telefona gönderilmez.
  const NOTIFY_FIELDS = new Set(['status', 'stockQty', 'soldCount', 'rank', 'reviewCount', 'edition', 'price', 'sellers', 'seller']);

  const MESSAGES = {
    token: "Token geçersiz. BotFather'ın verdiği token'ı eksiksiz yapıştırın.",
    chat: "Bot bu sohbete yazamıyor. Telegram'da botu açıp Başlat'a basın, sonra yeniden bağlanın.",
    network: "Telegram'a ulaşılamadı. İnternet bağlantınızı denetleyin.",
    conflict: 'Bu bot başka bir uygulamaya bağlı (webhook tanımlı). BotFather ile yeni bir bot oluşturup onun token\'ını kullanın.',
  };

  // Bir taramanın sonucunu tek mesaja çevirir; söylenecek bir şey yoksa null döner.
  function buildScanMessage({ book, targets, events, blocked, warnings = [] }) {
    const name = Object.fromEntries(targets.map((t) => [t.id, t.name]));
    const lines = events.filter((e) => NOTIFY_FIELDS.has(e.field)).map((e) => `${name[e.targetId] || e.targetId}: ${lib.describeEvent(e)}`);
    const shown = lines.slice(0, MAX_LINES);
    if (lines.length > MAX_LINES) shown.push(`… ve ${lines.length - MAX_LINES} değişiklik daha (ayrıntılar panelde)`);
    if (blocked.length) shown.push(`Doğrulama gerekiyor: ${blocked.map((id) => name[id] || id).join(', ')}. Tarayıcıda açık kalan sekmede doğrulamayı tamamlayıp "Yeniden tara"ya basın.`);
    shown.push(...warnings);
    return shown.length ? [book.title, ...shown].join('\n') : null;
  }

  // Doğrulama isteyen siteler için aynı gün içinde ikinci kez bildirim gönderilmez.
  function pickBlockedNotices(blockedIds, notified, today) {
    const ids = blockedIds.filter((id) => notified[id] !== today);
    const next = { ...notified };
    for (const id of ids) next[id] = today;
    return { ids, notified: next };
  }

  async function call(token, method, params, fetchImpl) {
    const doFetch = fetchImpl || globalThis.fetch;
    let res;
    try {
      res = await doFetch(`${API}/bot${token}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params || {}) });
    } catch (e) {
      return { ok: false, reason: 'network', message: MESSAGES.network };
    }
    let json = null;
    try { json = await res.json(); } catch (e) { /* JSON olmayan yanıt */ }
    if (json && json.ok) return json;
    const code = (json && json.error_code) || res.status;
    const description = (json && json.description) || `HTTP ${res.status}`;
    const reason = code === 401 || code === 404 ? 'token' : code === 403 || /chat not found/i.test(description) ? 'chat' : code === 409 ? 'conflict' : 'other';
    return { ok: false, reason, message: MESSAGES[reason] || `Telegram hatası: ${description}` };
  }

  // Token'ı doğrular ve bota en son yazan sohbeti bulur.
  async function connect(token, fetchImpl) {
    const me = await call(token, 'getMe', null, fetchImpl);
    if (!me.ok) return me;
    const botName = me.result.username;
    const updates = await call(token, 'getUpdates', { limit: 100 }, fetchImpl);
    if (!updates.ok) return updates;
    const chats = updates.result.map((u) => (u.message || u.edited_message || u.channel_post || u.my_chat_member || {}).chat).filter(Boolean);
    const chat = chats[chats.length - 1];
    if (!chat) return { ok: false, reason: 'no_chat', botName, message: `Telegram'da @${botName} botunu açıp Başlat'a basın, sonra yeniden Bağlan'a basın.` };
    return { ok: true, botName, chatId: chat.id, chatName: chat.first_name || chat.title || chat.username || String(chat.id) };
  }

  async function sendMessage(token, chatId, text, fetchImpl) {
    const res = await call(token, 'sendMessage', { chat_id: chatId, text }, fetchImpl);
    return res.ok ? { ok: true } : res;
  }

  return { buildScanMessage, pickBlockedNotices, connect, sendMessage };
});
