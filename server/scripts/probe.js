// Bir sitenin arama sayfasını açar, yakalanan JSON yanıtlarını data/probe-<site>/ altına
// kaydeder ve kaç bilet çıkarılabildiğini gösterir. Bir site sonuç vermiyorsa buradan
// başlayın: yanıtlardaki alan adlarına bakıp src/providers/heuristic.js'i güncelleyin.
//
// Kullanım: npm run probe -- <site> <bus|flight|train> <nereden> <nereye> <YYYY-AA-GG>
// Örnek:    npm run probe -- skyscanner flight IST ESB 2026-11-05
//           npm run probe -- tcdd train Ankara İstanbul 2026-11-05
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { captureJson, closeBrowser } from '../src/providers/browser.js';
import { extractTrips } from '../src/providers/heuristic.js';
import { buildUrl, loadSiteConfig, resolvePlace } from '../src/providers/sites.js';

const [site, mode, from, to, date] = process.argv.slice(2);
const config = loadSiteConfig();
const modeConfig = config[site]?.modes?.[mode];
if (!modeConfig || !from || !to || !date) {
  console.error('Kullanım: npm run probe -- <site> <bus|flight|train> <nereden> <nereye> <YYYY-AA-GG>');
  console.error(`Siteler: ${Object.keys(config).join(', ')}`);
  process.exit(1);
}

if (config[site].type === 'tcdd') {
  // TCDD'de arama adresi yok; adaptörün kendisi çalıştırılıp sonuç gösterilir.
  const { createTcddProvider } = await import('../src/providers/tcdd.js');
  try {
    const trips = await createTcddProvider(site, config[site]).search({ mode, from, to, date });
    console.table(trips.map((t) => ({ kalkis: t.departure, varis: t.arrival, tren: t.company, fiyat: t.price, bos: t.seatsAvailable, dolu: t.soldOut })));
  } finally {
    await closeBrowser();
  }
  process.exit(0);
}

const url = buildUrl(modeConfig.url, { from: resolvePlace(from, modeConfig), to: resolvePlace(to, modeConfig), date });
console.log(`Açılıyor: ${url}`);
const outDir = fileURLToPath(new URL(`../data/probe-${site}/`, import.meta.url));
mkdirSync(outDir, { recursive: true });

try {
  const { responses, title, finalUrl } = await captureJson(url);
  console.log(`Sayfa başlığı: ${title}\nSon adres: ${finalUrl}\nYakalanan JSON yanıtı: ${responses.length}`);
  responses.forEach((r, i) => {
    const trips = extractTrips(r.body, { provider: site, providerName: site, mode, from, to, date, url });
    const file = `${outDir}${String(i).padStart(2, '0')}.json`;
    writeFileSync(file, JSON.stringify({ url: r.url, status: r.status, body: r.body }, null, 2));
    console.log(`${trips.length ? '✔' : ' '} ${String(trips.length).padStart(3)} bilet  ${r.url.slice(0, 120)}`);
  });
  console.log(`Yanıtlar kaydedildi: ${outDir}`);
} finally {
  await closeBrowser();
}
