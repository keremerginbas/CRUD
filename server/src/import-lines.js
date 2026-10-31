// Santral hatlarını içe aktarır: node src/import-lines.js hatlar.csv
// CSV sütunları: dahili,numara,etiket,danisman_email,tip
//   danisman_email boşsa hat kimseye atanmaz; dahili boş olabilir
//   tip: personal (kişiye ait hat, varsayılan) | hunt (444 gibi karşılama hattı)
import { readFileSync } from 'node:fs';
import { config } from './config.js';
import { openDb } from './db.js';
import { normalizePhone } from './phone.js';

const file = process.argv[2];
if (!file) {
  console.error('Kullanım: node src/import-lines.js hatlar.csv');
  process.exit(1);
}

const db = openDb(config.dbPath);
const userByEmail = db.prepare('SELECT id, name FROM users WHERE email = ?');
const setExtension = db.prepare('UPDATE users SET extension = ? WHERE id = ?');
const upsertNumber = db.prepare(`INSERT INTO numbers (did, type, user_id, label) VALUES (?, ?, ?, ?)
  ON CONFLICT(did) DO UPDATE SET type = excluded.type, user_id = excluded.user_id, label = excluded.label`);

const rows = readFileSync(file, 'utf8').split(/\r?\n/).slice(1).filter((l) => l.trim() && !l.startsWith('#'));
let assigned = 0;
for (const line of rows) {
  const [extension, phone, label, email, type = 'personal'] = line.split(',').map((c) => c.trim());
  const did = normalizePhone(phone);
  if (!['personal', 'hunt'].includes(type || 'personal')) {
    console.warn(`Atlandı (geçersiz tip): ${line}`);
    continue;
  }
  if (!did.startsWith('+90') && !(type === 'hunt' && did)) {
    console.warn(`Atlandı (geçersiz numara): ${line}`);
    continue;
  }
  const user = email ? userByEmail.get(email.toLowerCase()) : null;
  if (email && !user) console.warn(`Kullanıcı bulunamadı, hat atanmadan eklendi: ${email}`);
  upsertNumber.run(did, type || 'personal', type === 'hunt' ? null : user?.id ?? null, label || `Hat ${extension || did}`);
  if (user && type !== 'hunt') {
    if (extension) setExtension.run(extension, user.id);
    assigned++;
  }
}
console.log(`${rows.length} hat işlendi, ${assigned} tanesi danışmana atandı.`);
