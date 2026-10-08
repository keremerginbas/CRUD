// PHP'deki icon('ad') çağrılarını tarar, Lucide ikonlarının SVG içeriğini app/icons.php'ye yazar.
// Böylece ikonlar sunucuda çizilir (sayfa açılırken titreme olmaz). JS'nin kullandığı ikonlar assets/vendor/lucide-icons.js'e yazılır.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const panel = join(root, '..');
// panel.js'in çizdiği ikonlar (bildirim, onay penceresi, yükleniyor)
const svgPath = (name) => join(root, 'node_modules', 'lucide-static', 'icons', `${name}.svg`);
const jsIcons = ['circle-check', 'circle-x', 'circle-help', 'loader-circle', 'triangle-alert', 'x'];
const names = new Set();
const walk = (dir) => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (['ui', 'vendor', 'tests', 'examples', 'n8n'].includes(f)) continue;
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.php')) {
      const src = readFileSync(p, 'utf8');
      if (!src.includes('icon(')) continue;
      // icon('ad') ve dizilerde/koşullarda geçen ikon adları ('layout-dashboard' gibi): Lucide'de karşılığı olan her tırnaklı ad
      for (const m of src.matchAll(/'([a-z][a-z0-9-]*)'/g)) if (existsSync(svgPath(m[1]))) names.add(m[1]);
    }
  }
};
walk(panel);
const inner = (name) => readFileSync(svgPath(name), 'utf8')
  .replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>[\s\S]*$/, '').replace(/\s*\n\s*/g, '').trim();
const entries = [...names].sort().map((name) => `    '${name}' => '${inner(name).replace(/'/g, "\\'")}',`);
mkdirSync(join(panel, 'assets', 'vendor'), { recursive: true });
writeFileSync(join(panel, 'assets', 'vendor', 'lucide-icons.js'),
  `/* Lucide ikonları (ISC lisansı), ui/scripts/icons.mjs ile üretilir. */\nwindow.LucideIcons=${JSON.stringify(Object.fromEntries(jsIcons.map((n) => [n, inner(n)])))};\n`);
writeFileSync(join(panel, 'app', 'icons.php'), `<?php
// Bu dosya ui/scripts/icons.mjs ile üretilir (Lucide, ISC lisansı). Elle düzenlemeyin; npm run build çalıştırın.
return [
${entries.join('\n')}
];
`);
console.log(`icons: PHP için ${names.size}, JS için ${jsIcons.length} ikon yazıldı`);
