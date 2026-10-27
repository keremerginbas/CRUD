// Örnek veri: node src/seed.js  (varsayılan şifre: Sifre1234)
import { config } from './config.js';
import { openDb } from './db.js';
import { hashPassword } from './auth.js';

const db = openDb(config.dbPath);
const pw = hashPassword('Sifre1234');
const user = db.prepare(`INSERT OR IGNORE INTO users (name, role, email, password_hash, phone, forward_phone, extension)
  VALUES (?, ?, ?, ?, ?, ?, ?)`);
user.run('YÖNETİCİ', 'admin', 'admin@ornek.com', pw, '+905000000000', null, '1000');
user.run('DANIŞMAN BİR', 'danisman', 'danisman@ornek.com', pw, '+905000000001', '+905000000001', '1001');

const danisman = db.prepare('SELECT id FROM users WHERE email = ?').get('danisman@ornek.com');
const num = db.prepare('INSERT OR IGNORE INTO numbers (did, type, user_id, label) VALUES (?, ?, ?, ?)');
num.run('4442453', 'hunt', null, '444 24 53');
num.run('+908500000001', 'personal', danisman.id, 'Dijital hat');
num.run('+908500000002', 'listing', danisman.id, 'Örnek ilan 638');

const contact = db.prepare('INSERT INTO contacts (name, phone, type, owner_id) VALUES (?, ?, ?, ?)');
if (!db.prepare('SELECT COUNT(*) AS n FROM contacts').get().n) {
  contact.run('ÖRNEK ALICI', '+905550000001', 'ALICI', danisman.id);
  contact.run('ÖRNEK SATICI', '+905550000002', 'SATICI', danisman.id);
}
console.log('Örnek veri yüklendi.');
