// Panelden kişi ve hat çıkarır: node --env-file=.env src/remove-staff.js proje-satis-cikar.csv
// CSV import-staff.js ile aynı biçimde: bitrix_id,ad_soyad,departman,hat,dahili,kullanici_adi,rol
//   kullanici_adi doluysa kullanıcı silinir; hat doluysa numara listeden çıkar (kullanıcısız satır sadece hattı çıkarır).
// Geçmiş aramalar silinmez, sadece kişi bağlantısı boşalır. Yönetici (admin) silinmez.
import { readFileSync } from 'node:fs';
import { config } from './config.js';
import { openDb } from './db.js';
import { normalizeLogin } from './auth.js';
import { normalizePhone } from './phone.js';

const file = process.argv[2];
if (!file) {
  console.error('Kullanım: node src/remove-staff.js proje-satis-cikar.csv');
  process.exit(1);
}
const db = openDb(config.dbPath);
const byEmail = db.prepare('SELECT id, role FROM users WHERE email = ?');
const delUser = db.prepare('DELETE FROM users WHERE id = ?');
const delNumber = db.prepare('DELETE FROM numbers WHERE did = ?');
const stats = { users: 0, numbers: 0, kept: 0 };

const rows = readFileSync(file, 'utf8').split(/\r?\n/).slice(1).filter((l) => l.trim() && !l.startsWith('#'));
db.exec('BEGIN');
for (const line of rows) {
  const [, , , phone, , email] = line.split(',').map((c) => c.trim());
  const did = normalizePhone(phone);
  if (did) stats.numbers += Number(delNumber.run(did).changes);
  const user = email ? byEmail.get(normalizeLogin(email)) : null;
  if (user?.role === 'admin') { stats.kept++; continue; }
  if (user) stats.users += Number(delUser.run(user.id).changes);
}
db.exec('COMMIT');
console.log(`${stats.users} kişi ve ${stats.numbers} hat panelden çıkarıldı${stats.kept ? `, ${stats.kept} yönetici korundu` : ''}.`);
