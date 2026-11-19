// Santral hatlarını içe aktarır: node src/import-lines.js hatlar.csv
// CSV sütunları: dahili,numara,etiket,danisman_email,tip[,baglanti]
//   danisman_email boşsa hat yeni eklenirken kimseye atanmaz, mevcut atama (ör. panelden yapılan) korunur
//   tip: personal (kişiye ait hat, varsayılan) | hunt (444 gibi karşılama hattı)
//   baglanti: santraldeki operatör bağlantısı (ör. d101, n850); dolu ise hattın bağlantısı olarak yazılır
//   Var olan hatta etiket boş bırakılırsa etiket ve tip değişmez (sadece bağlantı/kişi güncellenir)
import { readFileSync } from 'node:fs';
import { config } from './config.js';
import { openDb } from './db.js';
import { normalizePhone, TRUNK_NAME_RE } from './phone.js';

const file = process.argv[2];
if (!file) {
  console.error('Kullanım: node src/import-lines.js hatlar.csv');
  process.exit(1);
}

const db = openDb(config.dbPath);
const userByEmail = db.prepare('SELECT id, name FROM users WHERE email = ?');
const setExtension = db.prepare('UPDATE users SET extension = ? WHERE id = ?');
const existing = db.prepare('SELECT * FROM numbers WHERE did = ?');
const setTrunk = db.prepare('UPDATE numbers SET trunk = ? WHERE did = ?');
const setOwner = db.prepare('UPDATE numbers SET user_id = ? WHERE did = ?');
const upsertNumber = db.prepare(`INSERT INTO numbers (did, type, user_id, label) VALUES (?, ?, ?, ?)
  ON CONFLICT(did) DO UPDATE SET type = excluded.type, label = excluded.label,
    user_id = CASE WHEN excluded.type = 'hunt' THEN NULL ELSE COALESCE(excluded.user_id, numbers.user_id) END`);

const rows = readFileSync(file, 'utf8').split(/\r?\n/).slice(1).filter((l) => l.trim() && !l.startsWith('#'));
let assigned = 0;
for (const line of rows) {
  const [extension, phone, label, email, type = 'personal', trunk = ''] = line.split(',').map((c) => c.trim());
  const did = normalizePhone(phone);
  if (trunk && !TRUNK_NAME_RE.test(trunk)) {
    console.warn(`Atlandı (geçersiz bağlantı adı): ${line}`);
    continue;
  }
  // Var olan hat, etiketsiz satır: sadece bağlantı ve (verildiyse) kişi güncellenir
  if (!label && existing.get(did)) {
    if (trunk) setTrunk.run(trunk, did);
    const owner = email ? userByEmail.get(email.toLowerCase()) : null;
    if (owner) { setOwner.run(owner.id, did); assigned++; }
    continue;
  }
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
  if (trunk) setTrunk.run(trunk, did);
  if (user && type !== 'hunt') {
    if (extension) setExtension.run(extension, user.id);
    assigned++;
  }
}
console.log(`${rows.length} hat işlendi, ${assigned} tanesi danışmana atandı.`);
