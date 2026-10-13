import { q as query } from '../db/pool.js';

const HOOK = process.env.BITRIX_WEBHOOK;

export async function b24(method, params = {}) {
  const res = await fetch(`${HOOK}${method}.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (data.error) throw new Error(`${data.error}: ${data.error_description}`);
  return data.result;
}

const variants = (waId) => {
  const d = waId.replace(/\D/g, '');
  const local = d.startsWith('90') ? d.slice(2) : d;
  return [`+${d}`, d, `0${local}`, local];
};

export async function syncToBitrix(channel, conv, message) {
  if (!HOOK) return;

  if (!conv.crm_entity_id) {
    let found = null;
    for (const v of variants(conv.wa_id)) {
      const res = await b24('crm.duplicate.findbycomm', { entity_type: 'CONTACT', type: 'PHONE', values: [v] });
      if (res?.CONTACT?.length) { found = { type: 'CONTACT', id: res.CONTACT[0] }; break; }
      const lead = await b24('crm.duplicate.findbycomm', { entity_type: 'LEAD', type: 'PHONE', values: [v] });
      if (lead?.LEAD?.length) { found = { type: 'LEAD', id: lead.LEAD[0] }; break; }
    }

    if (!found) {
      const id = await b24('crm.lead.add', {
        fields: {
          TITLE: `WhatsApp — ${conv.display_name || conv.wa_id}`,
          NAME: conv.display_name || null,
          SOURCE_ID: 'WHATSAPP',
          SOURCE_DESCRIPTION: `${channel.label} (${channel.msisdn})`,
          PHONE: [{ VALUE: `+${conv.wa_id}`, VALUE_TYPE: 'MOBILE' }],
          ASSIGNED_BY_ID: conv.assigned_user || undefined,
          COMMENTS: message.body || '',
        },
      });
      found = { type: 'LEAD', id };
    }

    await query(
      'UPDATE wa_conversations SET crm_entity_type = ?, crm_entity_id = ? WHERE id = ?',
      [found.type, found.id, conv.id]
    );
    conv.crm_entity_type = found.type;
    conv.crm_entity_id = found.id;
  }

  await b24('crm.timeline.comment.add', {
    fields: {
      ENTITY_ID: conv.crm_entity_id,
      ENTITY_TYPE: conv.crm_entity_type.toLowerCase(),
      COMMENT: `WhatsApp (${channel.label}) — ${message.direction === 'in' ? 'Gelen' : 'Giden'}\n${message.body || `[${message.msg_type}]`}`,
    },
  }).catch(() => {});
}

export async function listUsers() {
  return b24('user.get', { ACTIVE: true });
}