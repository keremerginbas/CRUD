import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createAssistant } from './ai.js';
import { createAggregator } from './aggregator.js';
import { createApp } from './app.js';
import { createNotifier } from './notify.js';
import { closeBrowser } from './providers/browser.js';
import { createProviders } from './providers/index.js';
import { createStore } from './store.js';
import { createWatcher } from './watcher.js';

// OPENAI_API_KEY gibi ayarlar server/.env dosyasından okunur (git'e gönderilmez).
try {
  process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
}

const port = Number(process.env.PORT) || 4000;
const dataPath = process.env.DATA_FILE || fileURLToPath(new URL('../data/db.json', import.meta.url));

const providers = createProviders();
const aggregator = createAggregator(providers, { cacheTtlMs: Number(process.env.CACHE_TTL_SEC || 60) * 1000 });
const store = createStore(dataPath);
const watcher = createWatcher({ store, aggregator, notify: createNotifier() });
const assistant = createAssistant();
const app = createApp({ aggregator, watcher, store, assistant });

const server = app.listen(port, '0.0.0.0', () => {
  const lan = Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => `http://${i.address}:${port}`);
  console.log(`Bilet Radar sunucusu çalışıyor (${process.env.PROVIDERS || 'demo'} modu)`);
  console.log(assistant.enabled ? 'Yapay zekâ asistanı: açık (OpenAI)' : 'Yapay zekâ asistanı: OPENAI_API_KEY yok, kural tabanlı mod');
  console.log(`Telefondaki uygulamada Ayarlar → Sunucu adresi: ${lan[0] ?? `http://localhost:${port}`}`);
  watcher.start();
});

async function shutdown() {
  watcher.stop();
  server.close();
  await closeBrowser();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
