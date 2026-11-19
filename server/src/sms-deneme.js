// SMS ayarını dener: node --env-file=.env src/sms-deneme.js 05XXXXXXXXX [biçim: 0 | 10 | 90]
// Firmanın ham cevabını yazar (başarılı/başarısız ayrımını doğrulamak için)
import { config } from './config.js';
import { createSmsClient, formatSmsNumber } from './sms.js';
import { toLocalFormat } from './phone.js';

const number = toLocalFormat(process.argv[2] ?? '');
if (!/^05\d{9}$/.test(number)) { console.error('Kullanım: node --env-file=.env src/sms-deneme.js 05XXXXXXXXX'); process.exit(1); }
const sms = createSmsClient(config.sms);
if (!sms.enabled) { console.error('SMS ayarlı değil: deploy/sms-setup.sh'); process.exit(1); }
const format = process.argv[3] ?? config.sms.numberFormat;
console.log(`Numara bu biçimde gönderiliyor: ${formatSmsNumber(number, format)}`);
const r = await sms.send(number, 'XRE Santral deneme mesaji.', format);
console.log(r.ok ? '== Gönderildi' : '== GÖNDERİLEMEDİ', '\nFirmanın cevabı:', r.response);
process.exit(r.ok ? 0 : 1);
