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
const fullName = (r) => [r.NAME, r.LAST_NAME].filter(Boolean).join(' ').trim() || 'Değerli müşterimiz';
const isYes = (v) => ['y', 'yes', '1', 'true', 'evet'].includes(String(Array.isArray(v) ? v[0] : v ?? '').toLowerCase());

// Lead/deal kaydını okuyup akış için gereken bilgileri çıkarır.
async function fetchEntity(client, type, id, { projectField, consentField, optOutField }) {
  const { result: rec } = await client.call(`crm.${type}.get`, { id });
  // Deal'de kişi bilgisi contact'ta; lead'de telefon yoksa bağlı contact'a bakılır.
  let person = rec;
  const hasContact = rec.CONTACT_ID && Number(rec.CONTACT_ID) > 0;
  if (type === 'deal' || (!firstMobile(rec.PHONE) && hasContact)) {
    person = hasContact ? (await client.call('crm.contact.get', { id: rec.CONTACT_ID })).result || {} : {};
  }
  const pick = (field) => rec[field] ?? person[field];
  return {
    stage: type === 'deal' ? rec.STAGE_ID : rec.STATUS_ID,
    project: projectField ? pick(projectField) : undefined,
    consent: consentField ? isYes(pick(consentField)) : undefined,
    optedOut: optOutField ? isYes(pick(optOutField)) : false,
    name: person.NAME || person.LAST_NAME ? fullName(person) : fullName(rec),
    phone: firstMobile(person.PHONE) || firstMobile(rec.PHONE),
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

    const campaigns = db.prepare(`SELECT * FROM campaigns WHERE active = 1 AND bitrix_entity = ?`)
      .all(type)
      .filter((c) => JSON.parse(c.bitrix_stages || '[]').includes(info.stage))
      .filter((c) => projectMatches(c.bitrix_project, info.project));
    const keep = new Set(campaigns.map((c) => c.id));
    const stop = getStopStages(db).includes(info.stage);

    return transaction(() => {
      const cancelOthers = () => {
        let n = 0;
        for (const e of db.prepare(`SELECT id, campaign_id FROM enrollments WHERE source = ? AND status = 'active'`).all(key)) {
          if (!keep.has(e.campaign_id)) {
            db.prepare(`UPDATE enrollments SET status = 'cancelled' WHERE id = ?`).run(e.id);
            n += 1;
          }
        }
        return n;
      };
      // Randevu/satış/olumsuz gibi durdurma statüsü veya "bir daha aranmasın": tüm serileri durdur.
      if (stop || info.optedOut) {
        keep.clear();
        return { action: 'stopped', stage: info.stage, cancelled: cancelOthers() };
      }
      // Kampanyası olmayan ara statü (ör. "YAPAY ZEKA ARIYOR"): mevcut seri devam eder.
      if (!campaigns.length) return { action: 'no-campaign', stage: info.stage, cancelled: 0 };
      // Başka bir projenin statüsüne geçti: önceki projenin serisini durdur.
      const cancelled = cancelOthers();
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
      return statuses.filter((s) => s.ENTITY_ID === 'STATUS').map((s) => ({ id: s.STATUS_ID, name: s.NAME, semantics: s.EXTRA?.SEMANTICS }));
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

  // ---------- Eski kayıtları toplu seriye alma ----------
  // Webhook sadece yeni değişiklikleri yakalar; kampanyanın statülerinde bekleyen eski kayıtlar kuyruğa alınır.
  async function listForCampaign(campaign, days) {
    const stageField = campaign.bitrix_entity === 'deal' ? 'STAGE_ID' : 'STATUS_ID';
    const filter = { [stageField]: JSON.parse(campaign.bitrix_stages || '[]') };
    if (days) {
      const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString().slice(0, 10);
      filter['>=DATE_CREATE'] = `${since}T00:00:00+03:00`;
    }
    const rows = await client.callAll(`crm.${campaign.bitrix_entity}.list`, { filter, select: ['ID'], order: { ID: 'DESC' } });
    return rows.map((r) => `${campaign.bitrix_entity}:${r.ID}`);
  }

  async function queueBackfill(campaign, { days = null, dryRun = true } = {}) {
    if (!campaign.bitrix_entity) throw Object.assign(new Error("Kampanya Bitrix'e bağlı değil"), { status: 400 });
    if (!campaign.active) throw Object.assign(new Error('Önce kampanyayı aktif edin'), { status: 400 });
    const entities = await listForCampaign(campaign, days);
    const alreadyQueued = db.prepare('SELECT COUNT(*) n FROM bitrix_backfill WHERE campaign_id = ?').get(campaign.id).n;
    if (dryRun) return { campaign_id: campaign.id, found: entities.length, already_queued: alreadyQueued, dry_run: true };
    const insert = db.prepare('INSERT OR IGNORE INTO bitrix_backfill (entity, campaign_id) VALUES (?, ?)');
    let queued = 0;
    transaction(() => { for (const e of entities) queued += insert.run(e, campaign.id).changes; });
    return { campaign_id: campaign.id, found: entities.length, queued };
  }

  // Kuyruktan en fazla `limit` kayıt işler (cron her dakika çağırır). Bitrix hız sınırı için aralarda bekler.
  async function processBackfill({ limit = 40, throttleMs = 500 } = {}) {
    const rows = db.prepare(`SELECT * FROM bitrix_backfill WHERE status = 'pending' ORDER BY id LIMIT ?`).all(limit);
    const mark = db.prepare(`UPDATE bitrix_backfill SET status = ?, result = ?, updated_at = datetime('now') WHERE id = ?`);
    for (const row of rows) {
      const [type, id] = row.entity.split(':');
      try {
        const r = await sync(type, id, { force: true });
        mark.run('done', r.action, row.id);
      } catch (err) {
        mark.run('error', String(err.message || err).slice(0, 300), row.id);
        log(`Toplu ekleme ${row.entity} hata: ${err.message || err}`);
      }
      if (throttleMs) await new Promise((r) => setTimeout(r, throttleMs));
    }
    return { processed: rows.length };
  }

  function backfillStatus() {
    return db.prepare(`
      SELECT b.campaign_id, k.name AS campaign_name,
        SUM(b.status = 'pending') AS pending, SUM(b.status = 'done') AS done, SUM(b.status = 'error') AS errors,
        SUM(b.result = 'enrolled') AS enrolled, SUM(b.result = 'no-phone') AS no_phone,
        SUM(b.result IN ('stopped', 'no-campaign', 'unchanged')) AS skipped
      FROM bitrix_backfill b JOIN campaigns k ON k.id = b.campaign_id
      GROUP BY b.campaign_id ORDER BY b.campaign_id
    `).all();
  }

  return { sync, handleEvent, stages, projectOptions, queueBackfill, processBackfill, backfillStatus };
}

function getStopStages(db) {
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'bitrix_stop_stages'`).get();
  return row ? JSON.parse(row.value) : [];
}

function setStopStages(db, stages) {
  db.prepare(`INSERT INTO settings (key, value) VALUES ('bitrix_stop_stages', ?)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value`).run(JSON.stringify(stages));
}

function bitrixConfigFromEnv(env = process.env) {
  if (!env.BITRIX_WEBHOOK_URL) return null;
  return {
    webhookUrl: env.BITRIX_WEBHOOK_URL,
    appToken: env.BITRIX_APP_TOKEN || null,
    projectField: env.BITRIX_PROJECT_FIELD || null,
    consentField: env.BITRIX_CONSENT_FIELD || null,
    optOutField: env.BITRIX_OPTOUT_FIELD || null,
    defaultConsent: isYes(env.BITRIX_DEFAULT_CONSENT),
  };
}

// cron ve süreç içi zamanlayıcı için: .env'den Bitrix bağlantısını kurar (yoksa null).
function createBitrixSyncFromEnv(db, { env = process.env, log = console.log } = {}) {
  const config = bitrixConfigFromEnv(env);
  if (!config) return null;
  const { createServices } = require('./services');
  const { upsertCustomer, enroll, transaction } = createServices({ db });
  return createBitrixSync({ db, client: createBitrixClient(config), config, upsertCustomer, enroll, transaction, log });
}

module.exports = {
  createBitrixClient, createBitrixSync, createBitrixSyncFromEnv, bitrixConfigFromEnv, getStopStages, setStopStages,
};
