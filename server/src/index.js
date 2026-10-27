import { config } from './config.js';
import { openDb } from './db.js';
import { createProvider } from './providers/index.js';
import { createApp } from './app.js';

const db = openDb(config.dbPath);
const provider = createProvider(config.pbx);
createApp({ db, provider, config }).listen(config.port, () => {
  console.log(`Santral sunucusu :${config.port} (sağlayıcı: ${provider.name})`);
});
