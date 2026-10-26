// package.json'daki her paketin BU klasörün node_modules'unda, doğru ana sürümle kurulu olduğunu doğrular.
// Eski sürüm klasörü üzerine açılan zip'lerde kalan node_modules'u yakalar. Eksik/uyumsuzsa çıkış kodu 1.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const wanted={...pkg.dependencies,...pkg.devDependencies};
const problems=[];
for(const [name,range] of Object.entries(wanted)){
 const file=path.join(root,'node_modules',...name.split('/'),'package.json');
 if(!fs.existsSync(file)){problems.push(`${name}: kurulu değil`);continue}
 const installed=JSON.parse(fs.readFileSync(file,'utf8')).version;
 const major=String(range).match(/\d+/)?.[0];
 if(major&&installed.split('.')[0]!==major)problems.push(`${name}: ${installed} kurulu, ${range} gerekli`);
}
if(problems.length){console.log('Paketler güncel değil:\n - '+problems.join('\n - '));process.exit(1)}
console.log('Paketler tamam.');
