// Tarayıcı telefonu (WebRTC) kullanıcılarının Asterisk ayarını üretir; pbx/sync-webrtc.sh çağırır.
// Şifresi olmayan kullanıcıya şifre üretir. Çıktı: pjsip_webrtc_users.conf içeriği (stdout)
import { randomBytes } from 'node:crypto';
import { config } from './config.js';
import { openDb } from './db.js';

const db = openDb(config.dbPath);
const setSecret = db.prepare('UPDATE users SET sip_secret = ? WHERE id = ?');
const users = db.prepare('SELECT id, name, sip_secret FROM users ORDER BY id').all();

const lines = ['; pbx/sync-webrtc.sh tarafından üretildi. Elle düzenlemeyin.'];
for (const u of users) {
  let secret = u.sip_secret;
  if (!secret) {
    secret = randomBytes(18).toString('hex');
    setSecret.run(secret, u.id);
  }
  const id = `u${u.id}`;
  const name = u.name.replace(/[^\p{L}\p{N} .-]/gu, '');
  lines.push('', `[${id}](xre-webrtc-endpoint)`, `auth=${id}`, `aors=${id}`, `callerid="${name}" <${id}>`,
    '', `[${id}](xre-webrtc-auth)`, `username=${id}`, `password=${secret}`,
    '', `[${id}](xre-webrtc-aor)`);
}
process.stdout.write(`${lines.join('\n')}\n`);
