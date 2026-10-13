import { q as query } from '../db/pool.js';
import { sendText, sendTemplate, uploadMedia, sendMedia, markRead } from '../services/meta.js';
import { broadcast } from '../services/realtime.js';
import { requireChannel, allowedChannels } from '../services/auth.js';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
 
const MEDIA_DIR = process.env.MEDIA_DIR ||
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'media');
 
// WhatsApp Cloud API medya kuralları (tür ve boyut sınırları)
const MB = 1024 * 1024;
const MEDIA_RULES = [
  { type: 'image', mimes: ['image/jpeg', 'image/png'], max: 5 * MB },
  { type: 'video', mimes: ['video/mp4', 'video/3gpp'], max: 16 * MB },
  { type: 'audio', mimes: ['audio/aac', 'audio/mp4', 'audio/mpeg', 'audio/amr', 'audio/ogg'], max: 16 * MB },
];
const DOC_MAX = 100 * MB;
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'video/mp4': 'mp4', 'video/3gpp': '3gp',
  'audio/aac': 'aac', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/amr': 'amr', 'audio/ogg': 'ogg',
  'application/pdf': 'pdf' };
const PREVIEW = { image: '📷 Fotoğraf', video: '🎥 Video', audio: '🎤 Ses', document: '📎 Belge' };
 
function classify(mime, size) {
  const m = String(mime || '').split(';')[0].trim().toLowerCase();
  const rule = MEDIA_RULES.find(r => r.mimes.includes(m));
  if (rule) {
    if (size > rule.max) return { error: `${PREVIEW[rule.type]} en fazla ${rule.max / MB} MB olabilir (dosya ${(size / MB).toFixed(1)} MB).` };
    return { type: rule.type, mime: m };
  }
  // Diğer her şey (HEIC/WebP fotoğraflar, Word, Excel, ZIP vb.) belge olarak gider
  if (size > DOC_MAX) return { error: `Belge en fazla 100 MB olabilir (dosya ${(size / MB).toFixed(1)} MB).` };
  return { type: 'document', mime: m || 'application/octet-stream' };
}
 
const WINDOW_MS = 24 * 60 * 60 * 1000;
 
export const windowOpen = (conv) =>
  conv.last_inbound_at && (Date.now() - new Date(conv.last_inbound_at).getTime()) < WINDOW_MS;
 
export default async function messageRoutes(app) {
 
  app.get('/api/channels', async (req) => {
    const ids = await allowedChannels(req.user);
    const { rows } = await query(`
      SELECT c.id, c.label, c.owner_name, c.msisdn, c.status, c.quality_rating,
             CAST(COALESCE(SUM(v.unread_count),0) AS SIGNED) AS unread
        FROM wa_channels c
        LEFT JOIN wa_conversations v ON v.channel_id = c.id
       WHERE FIND_IN_SET(c.id, ?)
       GROUP BY c.id ORDER BY c.label`, [ids.join(',') || '0']);
    return rows;
  });
 
  app.get('/api/channels/:id/conversations', async (req) => {
    const ch = await requireChannel(req.user, +req.params.id);
    const { q: search, limit = 50, before } = req.query;
    const { rows } = await query(`
      SELECT * FROM wa_conversations
       WHERE channel_id = ?
         AND (? IS NULL OR display_name LIKE CONCAT('%',?,'%') OR wa_id LIKE CONCAT('%',?,'%'))
         AND (? IS NULL OR last_message_at < ?)
       ORDER BY last_message_at IS NULL, last_message_at DESC
       LIMIT ?`,
      [ch.id, search || null, search || null, search || null,
       before || null, before || null, String(Math.min(+limit, 100))]);
    return rows.map((c) => ({ ...c, window_open: windowOpen(c) }));
  });
 
  app.get('/api/conversations/:id/messages', async (req) => {
    const { rows: [conv] } = await query('SELECT * FROM wa_conversations WHERE id = ?', [req.params.id]);
    await requireChannel(req.user, conv.channel_id);
    const b = req.query.before || null;
    const { rows } = await query(`
      SELECT * FROM wa_messages
       WHERE conversation_id = ? AND (? IS NULL OR id < ?)
       ORDER BY id DESC LIMIT 50`, [conv.id, b, b]);
    return { conversation: { ...conv, window_open: windowOpen(conv) }, messages: rows.reverse() };
  });
 
  app.post('/api/conversations/:id/read', async (req) => {
    const { rows: [conv] } = await query('SELECT * FROM wa_conversations WHERE id = ?', [req.params.id]);
    const ch = await requireChannel(req.user, conv.channel_id);
    await query('UPDATE wa_conversations SET unread_count = 0 WHERE id = ?', [conv.id]);
    const { rows: [last] } = await query(
      `SELECT wamid FROM wa_messages WHERE conversation_id = ? AND direction = 'in'
        ORDER BY id DESC LIMIT 1`, [conv.id]);
    if (last?.wamid) markRead(ch.phone_number_id, last.wamid).catch(() => {});
    return { ok: true };
  });
 
  app.post('/api/conversations/:id/send', async (req, reply) => {
    const { text, template, language, variables } = req.body;
    const media = null; // Medya yalnızca /media uç noktasından gönderilir (dosya yolu istemciden alınmaz)
    const { rows: [conv] } = await query('SELECT * FROM wa_conversations WHERE id = ?', [req.params.id]);
    const ch = await requireChannel(req.user, conv.channel_id);
 
    if (String(ch.phone_number_id || '').startsWith('PENDING-')) {
      return reply.code(409).send({
        error: 'CHANNEL_NOT_CONNECTED',
        message: 'Bu hat henüz WhatsApp Cloud API\'ye bağlı değil, mesaj gönderilemez.',
      });
    }
 
    if (!windowOpen(conv) && !template) {
      return reply.code(409).send({
        error: 'WINDOW_CLOSED',
        message: '24 saatlik pencere kapalı. Serbest metin gönderilemez, onaylı şablon seçin.',
        last_inbound_at: conv.last_inbound_at,
      });
    }
 
    let res;
    try {
      if (template) {
        res = await sendTemplate(ch.phone_number_id, conv.wa_id, template, language || 'tr', variables || []);
      } else if (media) {
        const mediaId = await uploadMedia(ch.phone_number_id, media.path, media.mime);
        res = await sendMedia(ch.phone_number_id, conv.wa_id, media.type, mediaId, text, media.name);
      } else {
        res = await sendText(ch.phone_number_id, conv.wa_id, text);
      }
    } catch (e) {
      return reply.code(502).send({ error: 'META_ERROR', code: e.code, message: e.message });
    }
 
    const wamid = res.messages?.[0]?.id;
    const { result: ins } = await query(`
      INSERT INTO wa_messages (conversation_id, wamid, direction, msg_type, body,
        template_name, media_path, media_mime, media_name, status, sent_by)
      VALUES (?,?,'out',?,?,?,?,?,?,'sent',?)`,
      [conv.id, wamid, template ? 'template' : media ? media.type : 'text',
       text || null, template || null, media?.path || null, media?.mime || null,
       media?.name || null, req.user.id]);
 
    const { rows: [row] } = await query('SELECT * FROM wa_messages WHERE id = ?', [ins.insertId]);
 
    await query(`
      UPDATE wa_conversations SET last_message_at = NOW(), last_preview = ?,
             assigned_user = COALESCE(assigned_user, ?) WHERE id = ?`,
      [(text || `[${template || media?.type}]`).slice(0, 120), req.user.id, conv.id]);
 
    broadcast(ch.id, { event: 'message', conversation: conv.id, message: row });
    return row;
  });
 
  // ---------------- Medya gönderimi ----------------
  // Gövde: dosyanın kendisi (ham ikili). Başlıklar: Content-Type, X-File-Name. Sorgu: ?caption=
  await app.register(async (sub) => {
    sub.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: DOC_MAX + MB },
      (req, body, done) => done(null, body));
 
    sub.post('/api/conversations/:id/media', { bodyLimit: DOC_MAX + MB }, async (req, reply) => {
      const { rows: [conv] } = await query('SELECT * FROM wa_conversations WHERE id = ?', [req.params.id]);
      if (!conv) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Sohbet bulunamadı' });
      const ch = await requireChannel(req.user, conv.channel_id);
 
      if (String(ch.phone_number_id || '').startsWith('PENDING-'))
        return reply.code(409).send({ error: 'CHANNEL_NOT_CONNECTED', message: 'Bu hat henüz WhatsApp Cloud API\'ye bağlı değil.' });
      if (!windowOpen(conv))
        return reply.code(409).send({ error: 'WINDOW_CLOSED', message: '24 saatlik pencere kapalı. Medya göndermek için müşterinin önce yazması gerekir; önce şablon gönderin.' });
 
      const buf = req.body;
      if (!Buffer.isBuffer(buf) || !buf.length)
        return reply.code(400).send({ error: 'NO_FILE', message: 'Dosya boş' });
 
      let name = 'dosya';
      try { name = decodeURIComponent(req.headers['x-file-name'] || 'dosya'); } catch {}
      name = path.basename(name).replace(/[\u0000-\u001f]/g, '').slice(0, 180) || 'dosya';
 
      const kind = classify(req.headers['content-type'], buf.length);
      if (kind.error) return reply.code(413).send({ error: 'TOO_LARGE', message: kind.error });
 
      const ext = EXT[kind.mime] || (path.extname(name).slice(1).toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin');
      const dir = path.join(MEDIA_DIR, new Date().toISOString().slice(0, 7));
      fs.mkdirSync(dir, { recursive: true });
      const dest = path.join(dir, `out-${crypto.randomBytes(12).toString('hex')}.${ext}`);
      fs.writeFileSync(dest, buf);
 
      const caption = String(req.query.caption || '').slice(0, 1024) || null;
      let res;
      try {
        const mediaId = await uploadMedia(ch.phone_number_id, dest, kind.mime);
        res = await sendMedia(ch.phone_number_id, conv.wa_id, kind.type, mediaId, caption, name);
      } catch (e) {
        fs.rmSync(dest, { force: true });
        return reply.code(502).send({ error: 'META_ERROR', code: e.code, message: e.message });
      }
 
      const wamid = res.messages?.[0]?.id;
      const { result: ins } = await query(`
        INSERT INTO wa_messages (conversation_id, wamid, direction, msg_type, body,
          media_path, media_mime, media_name, status, sent_by)
        VALUES (?,?,'out',?,?,?,?,?,'sent',?)`,
        [conv.id, wamid, kind.type, caption, dest, kind.mime, name, req.user.id]);
      const { rows: [row] } = await query('SELECT * FROM wa_messages WHERE id = ?', [ins.insertId]);
 
      await query(`UPDATE wa_conversations SET last_message_at = NOW(), last_preview = ?,
                   assigned_user = COALESCE(assigned_user, ?) WHERE id = ?`,
        [(caption || PREVIEW[kind.type]).slice(0, 120), req.user.id, conv.id]);
 
      broadcast(ch.id, { event: 'message', conversation: conv.id, message: row });
      return row;
    });
  });
 
  app.get('/api/templates', async () => {
    const { rows } = await query(
      `SELECT name, language, category, body_text, variables
         FROM wa_templates WHERE status = 'APPROVED' ORDER BY category, name`);
    return rows;
  });
}