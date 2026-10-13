import { q as query } from '../db/pool.js';
import { downloadMedia } from '../services/meta.js';
import { broadcast } from '../services/realtime.js';
import { syncToBitrix } from '../services/bitrix.js';
import crypto from 'node:crypto';

const APP_SECRET = process.env.META_APP_SECRET;

export default async function webhookRoutes(app) {
  // GET: Doğrulama ve Canlı DB Testi (GİZLİ URL)
  app.get('/gizli-xre-api-2026', async (req, reply) => {
    const q2 = req.query;
    if (!q2['hub.mode']) {
       try {
           await query("INSERT INTO wa_webhook_log (payload) VALUES ('{\"test_mesaji\": \"Tarayicidan Manuel DB Testi Basarili!\"}')");
           return reply.code(200).send("DB BAGLANTISI VE YAZMA ISLEMI KUSURSUZ CALISIYOR! JSON kurali asildi.");
       } catch (e) {
           return reply.code(500).send("DB HATASI: " + e.message);
       }
    }
    const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN;
    if (q2['hub.mode'] === 'subscribe' && q2['hub.verify_token'] === VERIFY_TOKEN) {
      return reply.code(200).send(q2['hub.challenge']);
    }
    return reply.code(403).send('forbidden');
  });

  // POST: Tüm kısıtlamalar ve config ayarları kaldırıldı (GİZLİ URL)
  app.post('/gizli-xre-api-2026', { config: { rawBody: true } }, async (req, reply) => {
    // Meta imza dogrulamasi — APP_SECRET tanimliysa zorunlu
    if (APP_SECRET) {
      const sig = req.headers['x-hub-signature-256'] || '';
      const expected = 'sha256=' + crypto.createHmac('sha256', APP_SECRET)
        .update(req.rawBody || Buffer.alloc(0)).digest('hex');
      const ok = sig.length === expected.length &&
        crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
      if (!ok) return reply.code(401).send('bad signature');
    }
    try {
      // 1. Veriyi güvenli bir şekilde metne çevir ve Konsola bas
      const bodyStr = req.body ? JSON.stringify(req.body) : '{"sistem_mesaji": "Veri bos geldi"}';
      console.log("META POST ISTEGI YAKALANDI:", bodyStr);
      
      // 2. ÖNCE veritabanına kaydet (Bağlantı kapanmadan işlemi bitir)
      const dbRes = await query('INSERT INTO wa_webhook_log (payload) VALUES (?)', [bodyStr]);
      
      const ins = Array.isArray(dbRes) ? dbRes[0] : (dbRes.result || dbRes);
      const logId = ins?.insertId;

      // 3. Handle fonksiyonunu (mesaj işleme/Bitrix vb.) beklemeden arka planda tetikle
      // Await kullanmıyoruz ki Meta'ya cevap vermek için sistemin bitmesini beklemeyelim
      if (req.body && typeof req.body === 'object') {
          handle(req.body, logId).catch(err => console.error("Arka plan isleme hatasi:", err));
      }

      // 4. İşlem başarılı, ŞİMDİ Meta'ya 200 dön ve isteği Fastify kurallarına göre düzgünce kapat
      return reply.code(200).send('EVENT_RECEIVED');

    } catch (err) {
      console.error("POST Ana Loglama Hatası:", err);
      // Hata durumunda da akışı doğru kapat
      return reply.code(500).send('ERROR');
    }
  });
}

async function handle(body, logId) {
  try {
    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const v = change.value || {};
        const phoneNumberId = v.metadata?.phone_number_id;
        
        if (!phoneNumberId) continue;

        const dbCh = await query('SELECT * FROM wa_channels WHERE phone_number_id = ?', [phoneNumberId]);
        const rows = Array.isArray(dbCh) ? dbCh[0] : (dbCh.rows || dbCh);
        const ch = rows?.[0];

        if (!ch) continue;

        for (const msg of v.messages || []) await onInbound(ch, msg, v.contacts?.[0]);
        for (const st of v.statuses || []) await onStatus(st);
        // Coexistence: danışmanın telefondaki WhatsApp Business uygulamasından yazdığı mesajlar
        for (const ec of v.message_echoes || []) await onEcho(ch, ec);
      }
    }
    
    if (logId) {
      await query('UPDATE wa_webhook_log SET processed = 1 WHERE id = ?', [logId]);
    }
  } catch (e) {
    if (logId) {
      await query('UPDATE wa_webhook_log SET error = ? WHERE id = ?', [e.message.slice(0, 250), logId]);
    }
  }
}

async function onInbound(channel, msg, contact) {
  const waId = msg.from;

  await query(`
    INSERT INTO wa_conversations (channel_id, wa_id, display_name, last_inbound_at, last_message_at, unread_count)
    VALUES (?, ?, ?, NOW(), NOW(), 1)
    ON DUPLICATE KEY UPDATE
      last_inbound_at = NOW(),
      last_message_at = NOW(),
      unread_count = unread_count + 1,
      display_name = COALESCE(VALUES(display_name), display_name)`,
    [channel.id, waId, contact?.profile?.name || null]);

  const dbConv = await query('SELECT * FROM wa_conversations WHERE channel_id = ? AND wa_id = ?', [channel.id, waId]);
  const convRows = Array.isArray(dbConv) ? dbConv[0] : (dbConv.rows || dbConv);
  const conv = convRows?.[0];

  if(!conv) return;

  let media = {};
  const type = msg.type;
  if (['image', 'document', 'audio', 'video', 'sticker'].includes(type) && msg[type]?.id) {
    try {
      const f = await downloadMedia(msg[type].id);
      media = { media_id: msg[type].id, media_path: f.path, media_mime: f.mime, media_name: msg[type].filename || null };
    } catch {}
  }

  const bodyText = msg.text?.body ?? msg[type]?.caption ?? 
    (type === 'location' ? `Konum: ${msg.location?.latitude}, ${msg.location?.longitude}` : null) ?? 
    (type === 'button' ? msg.button?.text : null) ?? 
    (type === 'interactive' ? msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title : null);

  const dbMi = await query(`
    INSERT IGNORE INTO wa_messages (conversation_id, wamid, direction, msg_type, body, media_id, media_path, media_mime, media_name, status)
    VALUES (?,?,'in',?,?,?,?,?,?,'delivered')`,
    [conv.id, msg.id, type, bodyText, media.media_id || null, media.media_path || null, media.media_mime || null, media.media_name || null]);
  
  const mi = Array.isArray(dbMi) ? dbMi[0] : (dbMi.result || dbMi);
  if (!mi || !mi.affectedRows) return;

  const dbRow = await query('SELECT * FROM wa_messages WHERE id = ?', [mi.insertId]);
  const rowRows = Array.isArray(dbRow) ? dbRow[0] : (dbRow.rows || dbRow);
  const row = rowRows?.[0];

  await query('UPDATE wa_conversations SET last_preview = ? WHERE id = ?', [(bodyText || {
      image:'📷 Fotoğraf', video:'🎥 Video', audio:'🎤 Sesli mesaj',
      document:'📎 Belge', sticker:'Çıkartma', location:'📍 Konum'
    }[type] || `[${type}]`).slice(0, 120), conv.id]);

  broadcast(channel.id, { event: 'message', conversation: conv.id, message: row });
  syncToBitrix(channel, conv, row).catch(() => {});
}

async function onEcho(channel, msg) {
  const waId = msg.to;
  if (!waId) return;
  await query(`
    INSERT INTO wa_conversations (channel_id, wa_id, last_message_at)
    VALUES (?, ?, NOW())
    ON DUPLICATE KEY UPDATE last_message_at = NOW()`, [channel.id, waId]);
  const { rows: [conv] } = await query('SELECT * FROM wa_conversations WHERE channel_id = ? AND wa_id = ?', [channel.id, waId]);
  if (!conv) return;

  const type = msg.type || 'text';
  const bodyText = msg.text?.body ?? msg[type]?.caption ?? null;
  const { result: mi } = await query(`
    INSERT IGNORE INTO wa_messages (conversation_id, wamid, direction, msg_type, body, status)
    VALUES (?,?,'out',?,?,'sent')`, [conv.id, msg.id, type, bodyText]);
  if (!mi?.affectedRows) return;

  const { rows: [row] } = await query('SELECT * FROM wa_messages WHERE id = ?', [mi.insertId]);
  await query('UPDATE wa_conversations SET last_preview = ? WHERE id = ?',
    [(bodyText || `[${type}]`).slice(0, 120), conv.id]);
  broadcast(channel.id, { event: 'message', conversation: conv.id, message: row });
  syncToBitrix(channel, conv, row).catch(() => {});
}

async function onStatus(st) {
  const err = st.errors?.[0];
  await query(`
    UPDATE wa_messages SET status = ?, error_code = COALESCE(?, error_code), error_detail = COALESCE(?, error_detail)
    WHERE wamid = ?`,
    [st.status, err?.code || null, err?.title || null, st.id]);
}