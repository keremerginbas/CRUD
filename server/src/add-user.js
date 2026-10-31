// Kullanıcı ekler veya şifresini sıfırlar; şifre rastgele üretilip ekrana bir kez yazılır.
// node src/add-user.js <eposta> "<Ad Soyad>" <admin|broker|asistan|danisman> <cep_telefonu> [dahili]
import { randomBytes } from 'node:crypto';
import { config } from './config.js';
import { openDb } from './db.js';
import { hashPassword } from './auth.js';
import { normalizePhone } from './phone.js';

const [email, name, role, phone, extension = null] = process.argv.slice(2);
if (!email || !name || !['admin', 'broker', 'asistan', 'danisman'].includes(role) || !normalizePhone(phone)) {
  console.error('Kullanım: node src/add-user.js <eposta> "<Ad Soyad>" <admin|broker|asistan|danisman> <cep_telefonu> [dahili]');
  process.exit(1);
}

const db = openDb(config.dbPath);
const password = randomBytes(9).toString('base64url');
const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
if (existing) {
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), existing.id);
  console.log(`Şifre sıfırlandı: ${email}`);
} else {
  db.prepare(`INSERT INTO users (name, role, email, password_hash, phone, forward_phone, extension)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(name.toLocaleUpperCase('tr-TR'), role, email.toLowerCase(),
    hashPassword(password), normalizePhone(phone), normalizePhone(phone), extension);
  console.log(`Kullanıcı eklendi: ${email} (${role})`);
}
console.log(`Geçici şifre: ${password}`);
