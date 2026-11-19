// Hatların operatör bağlantısını toplu değiştirir: node --env-file=.env src/set-trunk.js <eski> [yeni]
//   yeni verilmezse bağlantı boşalır (santralin varsayılanı kullanılır). Ör. Netgsm santral bağlantısını kaldırırken:
//   node --env-file=.env src/set-trunk.js trunk
import { config } from './config.js';
import { openDb } from './db.js';
import { TRUNK_NAME_RE } from './phone.js';

const [from, to = null] = process.argv.slice(2);
if (!from || !TRUNK_NAME_RE.test(from) || (to && !TRUNK_NAME_RE.test(to))) {
  console.error('Kullanım: node src/set-trunk.js <eski bağlantı> [yeni bağlantı]');
  process.exit(1);
}
const db = openDb(config.dbPath);
const { changes } = db.prepare('UPDATE numbers SET trunk = ? WHERE trunk = ?').run(to, from);
console.log(`${changes} hat ${from} bağlantısından ${to ?? 'varsayılan bağlantıya'} alındı.`);
