// Bitrix CRM kartından sohbet açma
// Danışman kişi/anlaşma kartındaki WhatsApp sekmesine bastığında buraya gelir.
import { q as query } from '../db/pool.js';
import { allowedChannels } from '../services/auth.js';
import { b24 } from '../services/bitrix.js';

// Türk numarasını Meta formatına çevir: 0555 300 00 19 -> 905553000019
function toWaId(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0'))  d = '90' + d.slice(1);
  if (d.length === 10)    d = '90' + d;
  if (!d.startsWith('90') || d.length !== 12) return null;
  return d;
}


// Metin içinden Türk cep numaralarını yakala (yorum, özel alan vb.)
const MOBILE_RE = /(?:\+?90|0)?[\s(.-]*5\d{2}[\s).-]*\d{3}[\s.-]*\d{2}[\s.-]*\d{2}/g;
function phonesInText(v) {
  if (v == null) return [];
  if (Array.isArray(v)) return v.flatMap(phonesInText);
  if (typeof v === 'object') return Object.values(v).flatMap(phonesInText);
  return (String(v).match(MOBILE_RE) || []).filter(m => toWaId(m));
}
const multi = (rec) => (rec?.PHONE || []).map(p => p.VALUE).filter(Boolean);
const fullName = (r) => [r?.NAME, r?.LAST_NAME].filter(Boolean).join(' ') || null;

async function contactPhones(ids) {
  for (const cid of [...new Set(ids)].filter(Boolean)) {
    try {
      const c = await b24('crm.contact.get', { id: cid });
      const p = multi(c);
      if (p.length) return { phones: p, name: fullName(c), ownerType: 'CONTACT', ownerId: +cid };
    } catch {}
  }
  return null;
}

async function companyPhones(companyId) {
  if (!companyId) return null;
  try {
    const co = await b24('crm.company.get', { id: companyId });
    const p = multi(co);
    if (p.length) return { phones: p, name: co?.TITLE || null, ownerType: 'COMPANY', ownerId: +companyId };
    const list = await b24('crm.contact.list', { filter: { COMPANY_ID: companyId }, select: ['ID'] });
    return await contactPhones((list || []).map(c => +c.ID));
  } catch { return null; }
}

// Kayıttan telefona giden tüm yolları sırayla dener
async function collectPhones(type, id) {
  const method = { LEAD: 'crm.lead.get', DEAL: 'crm.deal.get', COMPANY: 'crm.company.get' }[type] || 'crm.contact.get';
  const rec = await b24(method, { id });
  const title = rec?.TITLE || fullName(rec);
  const done = (r) => ({ title, ...r, name: r.name || title });

  // 1) Kaydın kendi telefon alanı
  const own = multi(rec);
  if (own.length) return done({ phones: own, name: fullName(rec) || rec?.TITLE, ownerType: type, ownerId: id });

  // 2) Bağlı kişiler
  const contactIds = [];
  if (rec?.CONTACT_ID) contactIds.push(+rec.CONTACT_ID);
  if (type === 'DEAL' || type === 'LEAD') {
    try {
      const items = await b24(`crm.${type.toLowerCase()}.contact.items.get`, { id });
      for (const it of items || []) if (it?.CONTACT_ID) contactIds.push(+it.CONTACT_ID);
    } catch {}
  }
  const viaContact = await contactPhones(contactIds);
  if (viaContact) return done(viaContact);

  // 3) Bağlı şirket (veya kaydın kendisi şirketse kişileri)
  const viaCompany = await companyPhones(type === 'COMPANY' ? id : rec?.COMPANY_ID);
  if (viaCompany) return done(viaCompany);

  // 4) Kayıt alanları: özel alanlar (UF_*), yorumlar — web formundan gelen kayıtlar için
  const fieldText = Object.entries(rec || {})
    .filter(([k]) => k.startsWith('UF_') || k === 'COMMENTS' || k === 'SOURCE_DESCRIPTION')
    .map(([, v]) => v);
  const inFields = phonesInText(fieldText);
  if (inFields.length) return done({ phones: inFields, name: title, ownerType: type, ownerId: id });

  return done({ phones: [], name: title, ownerType: type, ownerId: id });
}

export default async function crmRoutes(app) {

  // ─────────────────────────────────────────────────────────
  // Kart içinden açılış: entity -> telefon -> sohbet (yoksa oluştur)
  // ─────────────────────────────────────────────────────────
  app.get('/api/crm/open', async (req, reply) => {
    const type = String(req.query.entityType || '').toUpperCase();
    const id   = +req.query.entityId;
    const wantChannel = +req.query.channel || null;

    if (!['CONTACT', 'LEAD', 'DEAL', 'COMPANY'].includes(type) || !id) {
      return reply.code(400).send({ error: 'BAD_ENTITY', message: 'Geçersiz CRM kaydı' });
    }

    // Telefonu Bitrix'ten al — kayıt, bağlı kişiler, şirket ve kayıt alanları sırasıyla taranır
    let found;
    try {
      found = await collectPhones(type, id);
    } catch (e) {
      return reply.code(502).send({ error: 'BITRIX_ERROR', message: e.message });
    }
    const { phones, name, title } = found;
    let { ownerType, ownerId } = found;

    const waIds = phones.map(toWaId).filter(Boolean);
    if (!waIds.length) {
      return reply.code(404).send({
        error: 'NO_PHONE',
        message: 'Bu kayıtta, bağlı kişi/şirkette ve kayıt alanlarında geçerli bir cep numarası bulunamadı',
        title, entity_type: type, entity_id: id,
      });
    }

    const allowed = await allowedChannels(req.user);
    if (!allowed.length) {
      return reply.code(403).send({ error: 'NO_CHANNEL', message: 'Size tanımlı bir hat yok' });
    }

    // Önce mevcut sohbeti ara — yetkili olduğu tüm hatlarda
    for (const wa of waIds) {
      const { rows } = await query(
        `SELECT * FROM wa_conversations
          WHERE wa_id = ? AND FIND_IN_SET(channel_id, ?)
          ORDER BY last_message_at IS NULL, last_message_at DESC LIMIT 1`,
        [wa, allowed.join(',')]);

      if (rows[0]) {
        if (!rows[0].crm_entity_id) {
          await query('UPDATE wa_conversations SET crm_entity_type=?, crm_entity_id=? WHERE id=?',
            [ownerType, ownerId, rows[0].id]);
        }
        return { conversation_id: rows[0].id, channel_id: rows[0].channel_id, created: false };
      }
    }

    // Yoksa oluştur — kullanıcının seçtiği ya da ilk yetkili hatta
    const chId = allowed.includes(wantChannel) ? wantChannel : allowed[0];
    const wa = waIds[0];

    await query(
      `INSERT INTO wa_conversations (channel_id, wa_id, display_name, crm_entity_type, crm_entity_id, assigned_user)
       VALUES (?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE crm_entity_type=VALUES(crm_entity_type), crm_entity_id=VALUES(crm_entity_id)`,
      [chId, wa, name, ownerType, ownerId, req.user.id]);

    const { rows } = await query(
      'SELECT id FROM wa_conversations WHERE channel_id=? AND wa_id=?', [chId, wa]);

    return { conversation_id: rows[0].id, channel_id: chId, created: true };
  });

  // ─────────────────────────────────────────────────────────
  // Numaradan sohbet başlat (arayüzdeki "Yeni sohbet" için)
  // ─────────────────────────────────────────────────────────
  app.post('/api/conversations/start', async (req, reply) => {
    const wa = toWaId(req.body?.phone);
    const chId = +req.body?.channel_id;
    if (!wa) return reply.code(400).send({ error: 'BAD_PHONE', message: 'Numara geçersiz. Örnek: 0533 743 71 09' });

    const allowed = await allowedChannels(req.user);
    if (!allowed.includes(chId)) return reply.code(403).send({ error: 'NO_CHANNEL', message: 'Bu hatta yetkiniz yok' });

    const et = ['CONTACT', 'LEAD', 'DEAL', 'COMPANY'].includes(String(req.body?.entity_type).toUpperCase())
      ? String(req.body.entity_type).toUpperCase() : null;
    const ei = et ? (+req.body?.entity_id || null) : null;

    await query(
      `INSERT INTO wa_conversations (channel_id, wa_id, display_name, assigned_user, crm_entity_type, crm_entity_id)
       VALUES (?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         crm_entity_type = COALESCE(crm_entity_type, VALUES(crm_entity_type)),
         crm_entity_id   = COALESCE(crm_entity_id, VALUES(crm_entity_id))`,
      [chId, wa, req.body?.name || null, req.user.id, et, ei]);

    const { rows } = await query(
      'SELECT id FROM wa_conversations WHERE channel_id=? AND wa_id=?', [chId, wa]);
    return { conversation_id: rows[0].id, channel_id: chId };
  });

  // ─────────────────────────────────────────────────────────
  // KURULUM: CRM kart sekmelerini bağla
  // placement.bind uygulama bağlamı ister; gelen webhook ile çağrılamaz.
  // Bu uç, Bitrix'in uygulamaya verdiği AUTH_ID ile çağırır.
  // Bir kez çalıştırmak yeterlidir.
  // ─────────────────────────────────────────────────────────
  app.get('/api/setup/placements', async (req, reply) => {
    const auth = req.headers['x-bitrix-auth'] || req.query.AUTH_ID;
    const domain = process.env.BITRIX_DOMAIN;

    if (!auth) {
      return reply.code(400).send({
        error: 'NO_AUTH',
        message: 'Bitrix oturum anahtarı yok. Bu ucu Bitrix içinden çağırın.'
      });
    }

    const handler = process.env.APP_HANDLER || 'https://wa.xrex.com.tr/';
    const list = [
      'CRM_LEAD_DETAIL_TAB',
      'CRM_CONTACT_DETAIL_TAB',
      'CRM_DEAL_DETAIL_TAB',
      'CRM_COMPANY_DETAIL_TAB'
    ];

    const out = [];
    for (const PLACEMENT of list) {
      try {
        const res = await fetch(
          `https://${domain}/rest/placement.bind.json?auth=${encodeURIComponent(auth)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ PLACEMENT, HANDLER: handler, TITLE: 'XRE WhatsApp' })
          }
        );
        const data = await res.json();
        out.push({
          PLACEMENT,
          ok: data.result === true,
          error: data.error_description || data.error || null
        });
      } catch (e) {
        out.push({ PLACEMENT, ok: false, error: e.message });
      }
    }
    return out;
  });

  // Bağlı sekmeleri listele (doğrulama için)
  app.get('/api/setup/placements/list', async (req, reply) => {
    const auth = req.headers['x-bitrix-auth'] || req.query.AUTH_ID;
    const domain = process.env.BITRIX_DOMAIN;
    if (!auth) return reply.code(400).send({ error: 'NO_AUTH' });

    const res = await fetch(
      `https://${domain}/rest/placement.get.json?auth=${encodeURIComponent(auth)}`);
    return res.json();
  });
}