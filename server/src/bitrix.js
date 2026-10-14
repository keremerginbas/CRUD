// Bitrix24 REST entegrasyonu: lead/deal aşama değişikliklerinde ilgili SMS akışını başlatır.
const { normalizePhone } = require('./schedule');

function createBitrixClient({ webhookUrl, fetchImpl = fetch }) {
  const base = webhookUrl.replace(/\/+$/, '');
  async function call(method, params = {}) {
    const res = await fetchImpl(`${base}/${method}.json`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(params),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      throw new Error(`Bitrix ${method}: ${data.error_description || data.error || `HTTP ${res.status}`}`);
    }
    return data;
  }
  // Sayfalı listeleri (50'şer) sonuna kadar okur.
  async function callAll(method, params = {}) {
    const items = [];
    let start = 0;
    for (;;) {
      const data = await call(method, { ...params, start });
      items.push(...(Array.isArray(data.result) ? data.result : []));
      if (data.next === undefined) return items;
      start = data.next;
    }
  }
  return { call, callAll };
}

const firstMobile = (phones) => (phones || []).map((p) => normalizePhone(p.VALUE)).find(Boolean) || null;
const fullName = (r) => [r.NAME, r.LAST_NAME].filter(Boolean).join(' ').trim() || r.TITLE || 'Müşteri';
const isYes = (v) => ['y', 'yes', '1', 'true', 'evet'].includes(String(Array.isArray(v) ? v[0] : v ?? '').toLowerCase());

// Lead/deal kaydını okuyup akış için gereken bilgileri çıkarır.
async function fetchEntity(client, type, id, { projectField, consentField }) {
  const { result: rec } = await client.call(`crm.${type}.get`, { id });
  let person = rec;
  if (type === 'deal') {
    person = rec.CONTACT_ID && Number(rec.CONTACT_ID) > 0
      ? (await client.call('crm.contact.get', { id: rec.CONTACT_ID })).result
      : {};
  }
  return {
    stage: type === 'deal' ? rec.STAGE_ID : rec.STATUS_ID,
    project: projectField ? rec[projectField] ?? person[projectField] : undefined,
    consent: consentField ? isYes(rec[consentField] ?? person[consentField]) : undefined,
    name: fullName(person),
    phone: firstMobile(person.PHONE),
  };
}

const projectMatches = (campaignValue, entityValue) => {
  if (!campaignValue) return true;
  const values = Array.isArray(entityValue) ? entityValue : [entityValue];
  return values.some((v) => String(v ?? '') === String(campaignValue));
};

function createBitrixSync({ db, client, config, upsertCustomer, enroll, transaction, log = console.log }) {
  // type: 'lead' | 'deal'. Döner: { action, ... } (test ve log için)
  async function sync(type, id, { force = false } = {}) {
    const key = `${type}:${id}`;
    const info = await fetchEntity(client, type, id, config);
    const prev = db.prepare('SELECT stage FROM bitrix_state WHERE entity = ?').get(key);
    db.prepare(`INSERT INTO bitrix_state (entity, stage, updated_at) VALUES (?, ?, datetime('now'))
      ON CONFLICT (entity) DO UPDATE SET stage = excluded.stage, updated_at = excluded.updated_at`).run(key, info.stage);
    // Deal'de başka bir alan güncellendiğinde de olay gelir; aşama aynıysa hiçbir şey yapma.
    if (!force && prev && prev.stage === info.stage) return { action: 'unchanged', stage: info.stage };

    const campaigns = db.prepare(`SELECT * FROM campaigns WHERE active = 1 AND bitrix_entity = ? AND bitrix_stage = ?`)
      .all(type, info.stage)
      .filter((c) => projectMatches(c.bitrix_project, info.project));
    const keep = new Set(campaigns.map((c) => c.id));

    return transaction(() => {
      // Müşteri başka aşamaya geçti: önceki aşamanın akışını durdur.
      let cancelled = 0;
      for (const e of db.prepare(`SELECT id, campaign_id FROM enrollments WHERE source = ? AND status = 'active'`).all(key)) {
        if (!keep.has(e.campaign_id)) {
          db.prepare(`UPDATE enrollments SET status = 'cancelled' WHERE id = ?`).run(e.id);
          cancelled += 1;
        }
      }
      if (!campaigns.length) return { action: 'no-campaign', stage: info.stage, cancelled };
      if (!info.phone) {
        log(`Bitrix ${key}: geçerli cep telefonu yok, SMS akışı başlatılamadı`);
        return { action: 'no-phone', stage: info.stage, cancelled };
      }
      const customer = upsertCustomer({
        name: info.name,
        phone: info.phone,
        consent: info.consent ?? config.defaultConsent,
        note: `Bitrix ${key}`,
      });
      const started = campaigns.map((c) => enroll(customer.id, c.id, undefined, key).id);
      return { action: 'enrolled', stage: info.stage, cancelled, customer_id: customer.id, enrollments: started };
    });
  }

  // Bitrix "giden webhook" gövdesi: event=ONCRMDEALUPDATE&data[FIELDS][ID]=..&auth[application_token]=..
  async function handleEvent(body) {
    if (config.appToken && body?.auth?.application_token !== config.appToken) {
      const err = new Error('Geçersiz Bitrix uygulama anahtarı');
      err.status = 401;
      throw err;
    }
    const m = /^ONCRM(LEAD|DEAL)(ADD|UPDATE)$/i.exec(body?.event || '');
    const id = body?.data?.FIELDS?.ID;
    if (!m || !id) return { action: 'ignored' };
    return sync(m[1].toLowerCase(), id);
  }

  // Panelde aşama seçimi için: [{ id: 'C3:NEW', name: 'Ankaport › Yeni' }]
  async function stages(type) {
    const statuses = await client.callAll('crm.status.list', { order: { SORT: 'ASC' } });
    if (type === 'lead') {
      return statuses.filter((s) => s.ENTITY_ID === 'STATUS').map((s) => ({ id: s.STATUS_ID, name: s.NAME }));
    }
    let pipelines = {};
    try {
      const { result } = await client.call('crm.category.list', { entityTypeId: 2 });
      pipelines = Object.fromEntries((result.categories || []).map((c) => [String(c.id), c.name]));
    } catch { /* pipeline adları alınamazsa sadece aşama adları gösterilir */ }
    return statuses
      .filter((s) => /^DEAL_STAGE(_\d+)?$/.test(s.ENTITY_ID))
      .map((s) => {
        const cat = s.ENTITY_ID.split('_')[2] || '0';
        return { id: s.STATUS_ID, name: pipelines[cat] ? `${pipelines[cat]} › ${s.NAME}` : s.NAME };
      });
  }

  // Proje alanı liste (enumeration) tipindeyse seçenekleri döner.
  async function projectOptions(type) {
    if (!config.projectField) return [];
    const { result } = await client.call(`crm.${type}.fields`);
    const field = result[config.projectField];
    return (field?.items || []).map((i) => ({ id: String(i.ID), name: i.VALUE }));
  }

  return { sync, handleEvent, stages, projectOptions };
}

function bitrixConfigFromEnv(env = process.env) {
  if (!env.BITRIX_WEBHOOK_URL) return null;
  return {
    webhookUrl: env.BITRIX_WEBHOOK_URL,
    appToken: env.BITRIX_APP_TOKEN || null,
    projectField: env.BITRIX_PROJECT_FIELD || null,
    consentField: env.BITRIX_CONSENT_FIELD || null,
    defaultConsent: isYes(env.BITRIX_DEFAULT_CONSENT),
  };
}

module.exports = { createBitrixClient, createBitrixSync, bitrixConfigFromEnv };
