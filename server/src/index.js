const path = require('node:path');

// cPanel/Passenger uygulamayı "node src/index.js" ile başlatır; .env'i burada yükle.
try { process.loadEnvFile(path.join(__dirname, '..', '.env')); } catch { /* .env yoksa ortam değişkenleri kullanılır */ }

const { openDb } = require('./db');
const { createApp } = require('./app');
const { createScheduler } = require('./scheduler');
const { createProviderFromEnv } = require('./providers');
const { createBitrixClient, bitrixConfigFromEnv } = require('./bitrix');

const PORT = Number(process.env.PORT) || 4000;
// 0: süreç içi zamanlayıcı kapalı (cPanel'de zamanlayıcıyı cron çalıştırır: scripts/tick.js).
const INTERVAL_MS = process.env.SCHEDULER_INTERVAL_MS === undefined || process.env.SCHEDULER_INTERVAL_MS === ''
  ? 60 * 1000 : Number(process.env.SCHEDULER_INTERVAL_MS);

const db = openDb();
const provider = createProviderFromEnv();
const scheduler = createScheduler({ db, provider });
const bitrixConfig = bitrixConfigFromEnv();
const bitrix = bitrixConfig && { client: createBitrixClient(bitrixConfig), config: bitrixConfig };
const app = createApp({ db, scheduler, bitrix, provider });

const runTick = () => scheduler.tick()
  .then((s) => { if (s.sent || s.failed || s.skipped) console.log('Zamanlayıcı:', s); })
  .catch((e) => console.error('Zamanlayıcı hatası:', e));

app.listen(PORT, () => {
  console.log(`SMS otomasyon sunucusu http://localhost:${PORT} (sağlayıcı: ${provider.name}, Bitrix: ${bitrix ? 'bağlı' : 'yok'})`);
  if (INTERVAL_MS > 0) {
    runTick();
    setInterval(runTick, INTERVAL_MS);
  }
});
