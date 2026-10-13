import fs from 'node:fs';
import path from 'node:path';

const GRAPH = 'https://graph.facebook.com/v21.0';
const TOKEN = process.env.META_TOKEN;
const MEDIA_DIR = process.env.MEDIA_DIR || path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'media');

async function graph(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${TOKEN}`, ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(data?.error?.message || `Meta ${res.status}`);
    e.code = data?.error?.code;
    throw e;
  }
  return data;
}

export async function sendText(phoneNumberId, to, text) {
  return graph(`${GRAPH}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { preview_url: true, body: text },
    }),
  });
}

export async function sendTemplate(phoneNumberId, to, name, lang = 'tr', vars = []) {
  const components = vars.length
    ? [{ type: 'body', parameters: vars.map((v) => ({ type: 'text', text: String(v) })) }]
    : undefined;
  return graph(`${GRAPH}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: { name, language: { code: lang }, ...(components && { components }) },
    }),
  });
}

export async function uploadMedia(phoneNumberId, filePath, mime) {
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', mime);
  form.append('file', new Blob([fs.readFileSync(filePath)], { type: mime }), path.basename(filePath));
  const data = await graph(`${GRAPH}/${phoneNumberId}/media`, { method: 'POST', body: form });
  return data.id;
}

export async function sendMedia(phoneNumberId, to, type, mediaId, caption, filename) {
  const payload = { id: mediaId };
  if (caption && type !== 'audio') payload.caption = caption;
  if (type === 'document' && filename) payload.filename = filename;
  return graph(`${GRAPH}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type, [type]: payload }),
  });
}

export async function downloadMedia(mediaId) {
  const meta = await graph(`${GRAPH}/${mediaId}`);
  const res = await fetch(meta.url, { headers: { Authorization: `Bearer ${TOKEN}` } });
  const buf = Buffer.from(await res.arrayBuffer());
  const ext = (meta.mime_type || '').split('/')[1]?.split(';')[0] || 'bin';
  const dir = path.join(MEDIA_DIR, new Date().toISOString().slice(0, 7));
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `${mediaId}.${ext}`);
  fs.writeFileSync(dest, buf);
  return { path: dest, mime: meta.mime_type, size: meta.file_size };
}

export async function markRead(phoneNumberId, wamid) {
  return graph(`${GRAPH}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: wamid }),
  });
}

export async function listTemplates(wabaId) {
  const data = await graph(`${GRAPH}/${wabaId}/message_templates?limit=200`);
  return data.data || [];
}

export async function listPhoneNumbers(wabaId) {
  const data = await graph(`${GRAPH}/${wabaId}/phone_numbers?limit=100`);
  return data.data || [];
}