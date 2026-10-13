import Fastify from 'fastify';
import fs from 'node:fs';
import rawBody from 'fastify-raw-body';
import websocket from '@fastify/websocket';
import fstatic from '@fastify/static';
import formbody from '@fastify/formbody';

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import crmRoutes from './routes/crm.js';
import webhookRoutes from './routes/webhook.js';
import messageRoutes from './routes/messages.js';

import { subscribe } from './services/realtime.js';
import { allowedChannels } from './services/auth.js';
import { verifyBitrixUser } from './services/session.js';

import { q as query } from './db/pool.js';


// ============================================================
// PATH
// ============================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


// ============================================================
// FASTIFY
// ============================================================

const app = Fastify({
  logger: true,
  trustProxy: true
});


// ============================================================
// PLUGINLER
// ============================================================

// Webhook tarafında raw body gerekiyorsa kullanılmaya devam edecek
await app.register(rawBody, {
  field: 'rawBody',
  global: false,
  encoding: false,
  runFirst: true
});

// Bitrix POST verilerini okuyabilmek için
await app.register(formbody);

// WebSocket
await app.register(websocket);


// ============================================================
// STATIC FRONTEND
// ============================================================

// public/index.html ve frontend dosyaları
await app.register(fstatic, {
  root: path.join(__dirname, '..', 'public')
});

// WhatsApp medya dosyaları
await app.register(fstatic, {
  root: process.env.MEDIA_DIR || path.join(__dirname, '..', 'media'),
  prefix: '/media/',
  decorateReply: false
});


// ============================================================
// BITRIX UYGULAMA ROOT
// ============================================================

/*
Bitrix yerel uygulamayı açarken:

POST https://wa.xrex.com.tr/

şeklinde istek gönderebiliyor.

Eski sunucuda POST / olmadığı için:

Route POST:/?... not found
404

hatası alıyorduk.
*/

app.post('/', async (req, reply) => {
  try {
    app.log.info({
      domain: req.body?.DOMAIN || null,
      placement: req.body?.PLACEMENT || null,
      hasAuth: !!req.body?.AUTH_ID
    }, 'BITRIX POST / istegi alindi');

    const auth = req.body?.AUTH_ID || '';
    const placement = req.body?.PLACEMENT || '';
    const options = req.body?.PLACEMENT_OPTIONS || '';

    const esc = v => String(v || '').replace(/"/g, '&quot;');

    let html = fs.readFileSync(
      path.join(__dirname, '..', 'public', 'index.html'), 'utf8'
    );

    // Bitrix POST verilerini sayfaya göm — arayüz bunları okuyacak
    html = html.replace('<body>', `<body>
<input type="hidden" name="AUTH_ID" value="${esc(auth)}">
<input type="hidden" name="PLACEMENT" value="${esc(placement)}">
<input type="hidden" name="PLACEMENT_OPTIONS" value="${esc(options)}">`);

    return reply.type('text/html').send(html);

  } catch (error) {
    app.log.error(error, 'Bitrix root uygulama acma hatasi');
    return reply.code(500).type('text/html')
      .send('<h1>XRE WhatsApp</h1><p>Uygulama yüklenirken bir hata oluştu.</p>');
  }
});


// ============================================================
// BITRIX POST TEST
// ============================================================

// İstersen tarayıcı/curl ile sunucunun yeni kodu çalıştırdığını
// kontrol etmek için kullanabiliriz.
app.post('/bitrix-test', async (req, reply) => {
  return reply
    .type('text/html')
    .send(`
      <!doctype html>
      <html lang="tr">
        <head>
          <meta charset="UTF-8">
          <title>XRE WhatsApp Test</title>
        </head>

        <body>
          <h1>XRE WhatsApp çalışıyor</h1>
          <p>POST isteği başarıyla alındı.</p>
        </body>
      </html>
    `);
});


// ============================================================
// PING (DB'siz) — sunucu ayakta mı, hızlı kontrol
// ============================================================

app.get('/ping', async () => ({ ok: true, zaman: new Date().toISOString() }));


// ============================================================
// HEALTH CHECK
// ============================================================

app.get('/health', async () => {
  const { rows } = await query(
    'SELECT COUNT(*) AS n FROM wa_channels'
  );

  return {
    ok: true,
    kanal_sayisi: rows[0].n,
    zaman: new Date().toISOString()
  };
});


// ============================================================
// WEBHOOK ROUTELARI
// ============================================================

await app.register(webhookRoutes);


// ============================================================
// KORUMALI API ROUTELARI
// ============================================================

await app.register(async (scoped) => {

  scoped.addHook('preHandler', async (req, reply) => {

    const user = await verifyBitrixUser(req);

    if (!user) {
      return reply
        .code(401)
        .send({
          error: 'UNAUTHORIZED'
        });
    }

    req.user = user;
  });


  // Mesaj API'leri
  await scoped.register(messageRoutes);

  // Bitrix CRM API'leri
  await scoped.register(crmRoutes);
});


// ============================================================
// WEBSOCKET
// ============================================================

app.get(
  '/ws',
  {
    websocket: true
  },
  async (socket, req) => {

    try {

      const user = await verifyBitrixUser(req);

      if (!user) {
        return socket.close();
      }

      const channels = await allowedChannels(user);

      subscribe(channels, socket);

    } catch (error) {

      app.log.error(
        error,
        'WebSocket baglanti hatasi'
      );

      socket.close();
    }
  }
);


// ============================================================
// SERVER START
// ============================================================

const port = Number(process.env.PORT) || 3000;

try {

  const address = await app.listen({
    port,
    host: '0.0.0.0'
  });

  app.log.info(
    `XRE WhatsApp calisiyor: ${address}`
  );

  app.log.info(
    'BITRIX POST / route aktif'
  );

} catch (error) {

  app.log.error(error);

  process.exit(1);
}