const { openDb } = require('./db');
const { createApp } = require('./app');
const { createScheduler } = require('./scheduler');
const { createProviderFromEnv } = require('./providers');

const PORT = Number(process.env.PORT) || 4000;
const INTERVAL_MS = Number(process.env.SCHEDULER_INTERVAL_MS) || 60 * 1000;

const db = openDb();
const provider = createProviderFromEnv();
const scheduler = createScheduler({ db, provider });
const app = createApp({ db, scheduler });

const runTick = () => scheduler.tick()
  .then((s) => { if (s.sent || s.failed || s.skipped) console.log('Zamanlayıcı:', s); })
  .catch((e) => console.error('Zamanlayıcı hatası:', e));

app.listen(PORT, () => {
  console.log(`SMS otomasyon sunucusu http://localhost:${PORT} (sağlayıcı: ${provider.name})`);
  runTick();
  setInterval(runTick, INTERVAL_MS);
});
