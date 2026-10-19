#!/usr/bin/env node
// Statik site üretici: src/content + src/templates -> dist/
// SEO kurallarını doğrular (title ≤55, description 120–150, benzersizlik, kırık iç link) ve
// sitemap.xml, robots.txt, .htaccess, _headers, feed.xml, manifest üretir.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import site from '../src/site.config.mjs';
import { document, abs } from '../src/templates/layout.mjs';
import * as P from '../src/templates/pages.mjs';
import { words } from '../src/templates/components.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, process.env.OUT_DIR || 'dist');
const BASE = site.basePath;
const CHECK_ONLY = process.argv.includes('--check-only');
const VERSION = Date.now().toString(36);

async function loadDir(dir) {
  const full = path.join(ROOT, dir);
  const files = fs.readdirSync(full).filter((f) => f.endsWith('.mjs')).sort();
  return Promise.all(files.map(async (f) => (await import(pathToFileURL(path.join(full, f)).href)).default));
}

const services = (await loadDir('src/content/services')).sort((a, b) => a.order - b.order);
const posts = (await loadDir('src/content/posts'))
  .map((p) => ({ ...p, path: `/${p.type === 'haber' ? 'haberler' : 'blog'}/${p.slug}/` }))
  .sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug));
const projectList = (await import(pathToFileURL(path.join(ROOT, 'src/content/projects.mjs')).href)).default;
const ctx = { services, posts, projectList };

const pages = [
  P.home(ctx), P.about(ctx), P.servicesHub(ctx), ...services.map((s) => P.serviceDetail(s, ctx)),
  P.projects(ctx), P.blogHub(ctx), P.newsHub(ctx), ...posts.map((p) => P.postDetail(p, ctx)),
  P.contact(ctx), P.faqPage(ctx), P.kvkk(), P.notFound(),
];

// ---------------------------------------------------------------- doğrulama
const errors = [];
const seenT = new Map();
const seenD = new Map();
for (const pg of pages) {
  const t = pg.title.length;
  const d = pg.description.length;
  if (t > 55) errors.push(`${pg.path}: title ${t} karakter (>55): "${pg.title}"`);
  if (d < 120 || d > 150) errors.push(`${pg.path}: description ${d} karakter (120–150 olmalı)`);
  if (!pg.keywords) errors.push(`${pg.path}: keywords eksik`);
  if (seenT.has(pg.title)) errors.push(`${pg.path}: title tekrarı (${seenT.get(pg.title)})`);
  if (seenD.has(pg.description)) errors.push(`${pg.path}: description tekrarı (${seenD.get(pg.description)})`);
  seenT.set(pg.title, pg.path);
  seenD.set(pg.description, pg.path);
}

// ---------------------------------------------------------------- render
const latest = posts.slice(0, 3);
const outputs = pages.map((pg) => {
  const schema = [
    P.orgSchema(), P.websiteSchema(),
    { ...P.webPageSchema(pg, pg.schemaType), ...(pg.faqMain ? { mainEntity: pg.faqMain.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) } : {}) },
    ...(pg.crumbs && pg.crumbs.length > 1 ? [P.crumbSchema(pg.crumbs)] : []),
    ...(pg.extraSchema || []),
  ];
  const html = document({ page: { ...pg, schema, version: VERSION }, body: pg.body, services, latest });
  const file = pg.file || path.join(pg.path.replace(/^\//, ''), 'index.html');
  return { pg, file, html };
});

// kırık iç link kontrolü
const known = new Set(outputs.map((o) => o.pg.path));
['/sitemap.xml', '/feed.xml', '/api/contact.php'].forEach((p) => known.add(p));
for (const { pg, html } of outputs) {
  for (const m of html.matchAll(/href="(\/[^"#?]*)/g)) {
    const href = m[1];
    if (href.startsWith('/assets/') || /\.(ico|svg|png|webmanifest|xml)$/.test(href)) continue;
    if (!known.has(href)) errors.push(`${pg.path}: kırık iç link -> ${href}`);
  }
  const h1s = (html.match(/<h1[\s>]/g) || []).length;
  if (h1s !== 1) errors.push(`${pg.path}: ${h1s} adet h1 var (1 olmalı)`);
}

if (errors.length) {
  console.error('\n✖ SEO doğrulama hataları:\n  ' + errors.join('\n  '));
  process.exit(1);
}

// ---------------------------------------------------------------- rapor
let total = 0;
console.log('\nSayfa                                              Title  Desc  Kelime');
for (const { pg, html } of outputs) {
  const main = html.split('<main id="icerik">')[1].split('</main>')[0];
  const wc = words(main.replace(/<script[\s\S]*?<\/script>/g, ''));
  total += wc;
  console.log(`${pg.path.padEnd(50)} ${String(pg.title.length).padStart(5)} ${String(pg.description.length).padStart(5)} ${String(wc).padStart(7)}`);
}
console.log(`\n✔ ${outputs.length} sayfa doğrulandı · toplam ${total.toLocaleString('tr-TR')} kelime`);
if (CHECK_ONLY) process.exit(0);

// ---------------------------------------------------------------- yazma
const write = (rel, content) => {
  const f = path.join(DIST, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, content);
};
// Alt klasör önizlemesi: kök göreli adreslere taban yolu ekle
const withBase = (html) => (BASE ? html.replace(/(=")\/(?!\/)/g, `$1${BASE}/`).replace(/(\d+w, )\/(?!\/)/g, `$1${BASE}/`) : html);
// Artık üretilmeyen eski sayfaları temizle (ör. kaldırılan hizmetler)
const expected = new Set(outputs.map((o) => path.join(DIST, o.file)));
const sweep = (dir) => {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory() && !['assets', 'api'].includes(e.name)) {
      sweep(f);
      if (!fs.readdirSync(f).length) fs.rmdirSync(f);
    } else if (e.name === 'index.html' && !expected.has(f)) fs.unlinkSync(f);
  }
};
sweep(DIST);
for (const { file, html } of outputs) write(file, withBase(html));
// Önizleme klasörü ayrıysa üretilmiş medyayı (video, görsel, logo, ikon) dist'ten kopyala
if (DIST !== path.join(ROOT, 'dist')) {
  const SRC = path.join(ROOT, 'dist');
  for (const d of ['assets/img', 'assets/video', 'assets/brand']) fs.cpSync(path.join(SRC, d), path.join(DIST, d), { recursive: true });
  for (const f of ['favicon.ico', 'favicon.svg', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png']) fs.copyFileSync(path.join(SRC, f), path.join(DIST, f));
}

// statik dosyalar (js, api, fontlar)
const copyDir = (src, dst) => {
  if (!fs.existsSync(src)) return;
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else { fs.mkdirSync(dst, { recursive: true }); fs.copyFileSync(s, d); }
  }
};
copyDir(path.join(ROOT, 'src/static'), DIST);
const fontSrc = path.join(ROOT, 'node_modules/@fontsource');
for (const [pkg, weights] of [['inter', [400, 600, 700]], ['barlow-condensed', [600, 700, 800]]]) {
  for (const w of weights) {
    for (const sub of ['latin', 'latin-ext']) {
      const name = `${pkg}-${sub}-${w}-normal.woff2`;
      const from = path.join(fontSrc, pkg, 'files', name);
      if (fs.existsSync(from)) { fs.mkdirSync(path.join(DIST, 'assets/fonts'), { recursive: true }); fs.copyFileSync(from, path.join(DIST, 'assets/fonts', name)); }
    }
  }
}

const today = new Date().toISOString().slice(0, 10);
const lastmod = (pg) => (pg.article ? pg.article.modified.slice(0, 10) : today);
const prio = (p) => (p === '/' ? '1.0' : /^\/(hizmetler|hakkimizda|iletisim|projeler)\/$/.test(p) ? '0.9' : p.startsWith('/hizmetler/') ? '0.8' : /^\/(blog|haberler)\/$/.test(p) ? '0.7' : '0.6');

// sitemap.xml (görsel + video uzantılı)
const sm = outputs.filter((o) => !o.pg.skipSitemap).map(({ pg }) => {
  const img = pg.ogImage ? `\n    <image:image><image:loc>${abs(pg.ogImage)}</image:loc><image:title>${pg.h1.replace(/&/g, '&amp;')}</image:title></image:image>` : '';
  return `  <url>\n    <loc>${abs(pg.path)}</loc>\n    <lastmod>${lastmod(pg)}</lastmod>\n    <changefreq>${pg.path.startsWith('/blog/') || pg.path.startsWith('/haberler/') ? 'weekly' : 'monthly'}</changefreq>\n    <priority>${prio(pg.path)}</priority>${img}\n  </url>`;
});
write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${sm.join('\n')}\n</urlset>\n`);

write('robots.txt', site.preview ? `# Önizleme – dizine eklenmez\nUser-agent: *\nDisallow: /\n` : `# ${site.name}\nUser-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${site.url}/sitemap.xml\n`);

// RSS
const rssItems = posts.map((p) => `  <item>\n    <title>${p.h1.replace(/&/g, '&amp;')}</title>\n    <link>${abs(p.path)}</link>\n    <guid>${abs(p.path)}</guid>\n    <pubDate>${new Date(p.date + 'T09:00:00+03:00').toUTCString()}</pubDate>\n    <category>${p.category}</category>\n    <description>${p.description.replace(/&/g, '&amp;')}</description>\n  </item>`).join('\n');
write('feed.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n<channel>\n  <title>${site.name} Blog</title>\n  <link>${site.url}/blog/</link>\n  <atom:link href="${site.url}/feed.xml" rel="self" type="application/rss+xml"/>\n  <description>Hafriyat, inşaat ve nakliye rehberleri ile kurumsal haberler.</description>\n  <language>tr-TR</language>\n${rssItems}\n</channel>\n</rss>\n`);

write('manifest.webmanifest', JSON.stringify({
  name: site.legalName, short_name: site.name, lang: 'tr', start_url: `${BASE}/`, display: 'standalone',
  background_color: '#0f172a', theme_color: site.themeColor,
  icons: [{ src: `${BASE}/icon-192.png`, sizes: '192x192', type: 'image/png' }, { src: `${BASE}/icon-512.png`, sizes: '512x512', type: 'image/png' }],
}, null, 2));

// Sunucu başlıkları: X-Robots-Tag, güvenlik, önbellek (Apache/cPanel + Netlify/Cloudflare Pages)
const host = new URL(site.url).host.replace(/^www\./, '');
if (site.preview) write('.htaccess', `# ${site.name} – ÖNİZLEME (alt klasör, Google'a kapalı)
Options -Indexes
DirectoryIndex index.html index.php
ErrorDocument 404 ${BASE}/404.html
AddDefaultCharset UTF-8
AddType video/webm .webm
AddType application/manifest+json .webmanifest
AddType image/webp .webp
<IfModule mod_headers.c>
  Header always set X-Robots-Tag "noindex, nofollow"
</IfModule>
`);
else write('.htaccess', `# ${site.name} – Apache / cPanel yapılandırması
Options -Indexes
DirectoryIndex index.html index.php
ErrorDocument 404 /404.html
AddDefaultCharset UTF-8
AddType video/webm .webm
AddType application/manifest+json .webmanifest
AddType image/webp .webp

<IfModule mod_rewrite.c>
  RewriteEngine On
  # HTTPS + www'suz tek adres (canonical ile uyumlu)
  RewriteCond %{HTTPS} off [OR]
  RewriteCond %{HTTP_HOST} ^www\\. [NC]
  RewriteRule ^ https://${host}%{REQUEST_URI} [L,R=301]
  # /index.html -> / (yinelenen içerik önleme)
  RewriteCond %{THE_REQUEST} \\s/(.*/)?index\\.html[\\s?] [NC]
  RewriteRule ^(.*/)?index\\.html$ /$1 [L,R=301]
  # Sonda / olmayan klasör adreslerini yönlendir
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteCond %{REQUEST_URI} !(\\.[a-z0-9]+|/)$ [NC]
  RewriteRule ^(.*)$ /$1/ [L,R=301]
</IfModule>

<IfModule mod_headers.c>
  Header always set X-Robots-Tag "index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1"
  <FilesMatch "^404\\.html$">
    Header always set X-Robots-Tag "noindex, follow"
  </FilesMatch>
  Header always set X-Content-Type-Options "nosniff"
  Header always set Referrer-Policy "strict-origin-when-cross-origin"
  Header always set X-Frame-Options "SAMEORIGIN"
  Header always set Permissions-Policy "geolocation=(), camera=(), microphone=()"
  Header always set Strict-Transport-Security "max-age=31536000; includeSubDomains"
  Header always set Content-Language "tr"
  <FilesMatch "\\.(css|js|woff2|webp|jpg|png|svg|ico|mp4|webm)$">
    Header set Cache-Control "public, max-age=31536000, immutable"
  </FilesMatch>
  <FilesMatch "\\.(html|xml|txt)$">
    Header set Cache-Control "public, max-age=600, must-revalidate"
  </FilesMatch>
</IfModule>

<IfModule mod_deflate.c>
  AddOutputFilterByType DEFLATE text/html text/css application/javascript application/json image/svg+xml application/xml text/xml text/plain
</IfModule>
`);
write('api/.htaccess', `<IfModule mod_headers.c>\n  Header always set X-Robots-Tag "noindex, nofollow"\n</IfModule>\n<FilesMatch "^(config\\.php|config\\.sample\\.php)$">\n  Require all denied\n</FilesMatch>\n<IfModule mod_rewrite.c>\n  RewriteEngine On\n  RewriteRule ^data/ - [F,L]\n</IfModule>\n`);
if (!site.preview) write('_headers', `/*\n  X-Robots-Tag: index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  Content-Language: tr\n/404.html\n  X-Robots-Tag: noindex, follow\n/api/*\n  X-Robots-Tag: noindex, nofollow\n/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n`);

console.log(`✔ dist/ yazıldı (v${VERSION})`);
