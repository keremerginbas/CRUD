// Zamanlayıcıyı bir kez çalıştırır. cPanel'de Cron ile her dakika/5 dakikada bir çağrılır:
//   cd ~/sms-otomasyon/server && <node yolu> scripts/tick.js
const path = require('node:path');

try { process.loadEnvFile(path.join(__dirname, '..', '.env')); } catch { /* .env yoksa ortam değişkenleri */ }

const { openDb } = require('../src/db');
const { createScheduler } = require('../src/scheduler');
const { createProviderFromEnv } = require('../src/providers');

const scheduler = createScheduler({ db: openDb(), provider: createProviderFromEnv() });
scheduler.tick()
  .then((s) => { if (s.busy || s.sent || s.failed || s.skipped) console.log(new Date().toISOString(), s); })
  .catch((e) => { console.error('Zamanlayıcı hatası:', e); process.exitCode = 1; });
