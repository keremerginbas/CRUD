// cPanel/Passenger dağıtım paketi: derlenmiş arayüz (dist) + sunucu + Python köprüsü + yalnızca çalışma zamanı paketleri.
// Kullanım: npm run build && node scripts/make-deploy.mjs  ->  deploy/parsel-sorgu-app/
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out=path.join(root,'deploy','parsel-sorgu-app');
const dist=path.join(root,'dist','index.html');
if(!fs.existsSync(dist)||/src=["']\/src\//.test(fs.readFileSync(dist,'utf8')))throw Error('Önce npm run build çalıştırın (dist yok veya derlenmemiş).');
fs.rmSync(out,{recursive:true,force:true});
const copy=(rel,filter)=>fs.cpSync(path.join(root,rel),path.join(out,rel),{recursive:true,filter:src=>!/__pycache__|\.pyc$|node_modules/.test(src)&&(!filter||filter(src))});
for(const rel of ['app.cjs','server','worker','db','dist','KURULUM_CPANEL.md'])copy(rel);
fs.mkdirSync(path.join(out,'data'),{recursive:true});
fs.writeFileSync(path.join(out,'data','.keep'),'SQLite veritabanı bu klasörde oluşur. Yedek alın, paylaşmayın.\n');
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const runtime=['express','cors','dotenv','mysql2'];
fs.writeFileSync(path.join(out,'package.json'),JSON.stringify({name:pkg.name,version:pkg.version,private:true,type:'module',
 engines:{node:'>=22.13'},scripts:{start:'node app.cjs'},dependencies:Object.fromEntries(runtime.map(n=>[n,pkg.dependencies[n]]))},null,2)+'\n');
fs.writeFileSync(path.join(out,'.env.example'),`# cPanel sunucu ayarları. Bu dosyayı .env olarak kopyalayıp doldurun. .env'i kimseyle paylaşmayın.
# Giriş şifresi (zorunlu; en az 12 karakter, tahmin edilemez olsun)
APP_PASSWORD=
# Oturum imzası için uzun rastgele değer (boşsa şifreden türetilir)
SESSION_SECRET=
# Uygulamanın yayın adresi alt dizini: https://xresoftware.com.tr/parsel-sorgu
BASE_PATH=/parsel-sorgu
TKGM_PARCEL_MODE=public
TKGM_TOKEN=
TKGM_COORDINATE_ENABLED=false
# Linux sunucuda Python
PYTHON_BIN=python3
# SQLite (Node 22.13+). MySQL için: DATABASE_URL=mysql://kullanici:sifre@localhost/veritabani
# SQLITE_PATH=./data/xre-parsel.sqlite
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini
AI_WEB_SEARCH=true
# Günlük AI analiz sınırı (0 = sınırsız)
AI_DAILY_LIMIT=50
# İlan5 eklentisinden otomatik ilan aktarımı için gizli anahtar (en az 16 karakter; boşsa kapalı)
XRE_INGEST_TOKEN=
`);
console.log('Hazır:',out);
