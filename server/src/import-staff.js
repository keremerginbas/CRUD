// Personeli içe aktarır: node --env-file=.env src/import-staff.js personel.csv
// CSV sütunları: bitrix_id,ad_soyad,departman,hat,dahili,kullanici_adi,rol (kullanıcı adı ya da e-posta)
// Kullanıcı yoksa açılır (şifresi kimseye bilinmez; yönetici panelden "Şifre sıfırla" ile verir),
// varsa adı, departmanı, Bitrix kimliği ve dahilisi güncellenir. Hat kullanıcıya atanır.
import { readFileSync } from 'node:fs';
import { config } from './config.js';
import { openDb } from './db.js';
import { generatePassword, hashPassword, normalizeLogin } from './auth.js';
import { normalizePhone } from './phone.js';

const ROLES = ['admin', 'broker', 'asistan', 'danisman'];
const file = process.argv[2];
if (!file) {
  console.error('Kullanım: node src/import-staff.js personel.csv');
  process.exit(1);
}

const db = openDb(config.dbPath);
const q = {
  byEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
  insert: db.prepare(`INSERT INTO users (name, role, email, password_hash, phone, extension, department, bitrix_user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
  update: db.prepare(`UPDATE users SET name = ?, department = ?, bitrix_user_id = ?,
    extension = COALESCE(?, extension) WHERE id = ?`),
  number: db.prepare('SELECT * FROM numbers WHERE did = ?'),
  addNumber: db.prepare("INSERT INTO numbers (did, type, user_id, label) VALUES (?, 'personal', ?, ?)"),
  assign: db.prepare('UPDATE numbers SET user_id = ? WHERE did = ?'),
};

const stats = { created: 0, updated: 0, assigned: 0, skipped: 0 };
const rows = readFileSync(file, 'utf8').split(/\r?\n/).slice(1).filter((l) => l.trim() && !l.startsWith('#'));

for (const line of rows) {
  const [bitrixId, name, department, phone, extension, email, role = 'danisman'] = line.split(',').map((c) => c.trim());
  if (!email || !name) {
    console.warn(`Atlandı (ad veya kullanıcı adı yok): ${line}`);
    stats.skipped++;
    continue;
  }
  if (!ROLES.includes(role)) {
    console.warn(`Atlandı (geçersiz rol "${role}"): ${line}`);
    stats.skipped++;
    continue;
  }
  const did = normalizePhone(phone);
  const upperName = name.toLocaleUpperCase('tr-TR');
  let user = q.byEmail.get(normalizeLogin(email));
  if (user) {
    q.update.run(upperName, department || null, bitrixId ? Number(bitrixId) : null, extension || null, user.id);
    stats.updated++;
  } else {
    const { lastInsertRowid } = q.insert.run(upperName, role, normalizeLogin(email), hashPassword(generatePassword()),
      did, extension || null, department || null, bitrixId ? Number(bitrixId) : null);
    user = { id: Number(lastInsertRowid) };
    stats.created++;
  }
  if (did) {
    if (q.number.get(did)) q.assign.run(user.id, did);
    else q.addNumber.run(did, user.id, `Hat ${extension || did}`);
    stats.assigned++;
  }
}

console.log(`${stats.created} kullanıcı açıldı, ${stats.updated} güncellendi, ${stats.assigned} hat atandı, ${stats.skipped} satır atlandı.`);
if (stats.created) console.log('Yeni kullanıcıların şifresini web panelinde Ekip → "Şifre sıfırla" ile verin.');
