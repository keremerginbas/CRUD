// Sunucudan şifre sıfırlar (yönetici panele giremiyorsa ya da kişiye SMS ulaşmıyorsa):
//   node --env-file=.env src/reset-password.js <kullanıcı adı>
// Rastgele geçici şifre üretir ve bir kez ekrana yazar; ad, rol ve diğer bilgiler değişmez.
import { config } from './config.js';
import { openDb } from './db.js';
import { generatePassword, hashPassword, normalizeLogin } from './auth.js';

const raw = process.argv[2];
if (!raw) { console.error('Kullanım: node --env-file=.env src/reset-password.js <kullanıcı adı>'); process.exit(1); }
const db = openDb(config.dbPath);
const login = normalizeLogin(raw);
const find = db.prepare('SELECT id, name, email, status FROM users WHERE email = ?');
const user = find.get(login) ?? (login.includes('@') ? find.get(login.split('@')[0]) : undefined);
if (!user) { console.error(`Kullanıcı bulunamadı: ${raw}`); process.exit(1); }
const password = generatePassword();
db.prepare('UPDATE users SET password_hash = ?, reset_code = NULL, reset_expires = NULL, reset_attempts = 0 WHERE id = ?')
  .run(hashPassword(password), user.id);
console.log(`Şifre sıfırlandı: ${user.name} (${user.email})${user.status === 'pending' ? ' — hesap henüz onaylanmadı' : ''}`);
console.log(`Geçici şifre: ${password}`);
