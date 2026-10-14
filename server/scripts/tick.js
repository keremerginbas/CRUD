// Zamanlayıcıyı ve eski Bitrix kayıtları kuyruğunu bir kez çalıştırır. cPanel'de Cron ile her dakika çağrılır:
//   cd ~/sms-otomasyon/server && <node yolu> scripts/tick.js
const path = require('node:path');

try { process.loadEnvFile(path.join(__dirname, '..', '.env')); } catch { /* .env yoksa ortam değişkenleri */ }

const { openDb } = require('../src/db');
const { createScheduler } = require('../src/scheduler');
const { createProviderFromEnv } = require('../src/providers');
const { createBitrixSyncFromEnv } = require('../src/bitrix');
const { withLock } = require('../src/locks');

async function main() {
  const db = openDb();
  const bitrix = createBitrixSyncFromEnv(db);
  if (bitrix) {
    const b = await withLock(db, 'backfill_lock', 5 * 60 * 1000, () => bitrix.processBackfill());
    if (b.processed) console.log(new Date().toISOString(), 'toplu ekleme:', b);
  }
  const s = await createScheduler({ db, provider: createProviderFromEnv() }).tick();
  if (s.busy || s.sent || s.failed || s.skipped) console.log(new Date().toISOString(), s);
}

main().catch((e) => { console.error('Zamanlayıcı hatası:', e); process.exitCode = 1; });
