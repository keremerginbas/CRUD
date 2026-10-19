import site from '../site.config.mjs';
import { icon } from './icons.mjs';

export const esc = (s = '') =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const abs = (path) => site.url + path;
export const waLink = (text = site.whatsappText) => `https://wa.me/${site.whatsapp}?text=${encodeURIComponent(text)}`;

const ROBOTS = 'index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1';

// ---------------------------------------------------------------- medya
export function picture(scene, alt, { cls = '', eager = false, blog = false } = {}) {
  const base = blog ? `/assets/img/blog/${scene}` : `/assets/img/${scene}`;
  return `<img src="${base}.webp" srcset="${base}-sm.webp 640w, ${base}.webp 1280w" sizes="(max-width: 768px) 100vw, 50vw"
    width="1280" height="720" alt="${esc(alt)}" class="${cls}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">`;
}

export function video(scene, label, { cls = '', lazy = true } = {}) {
  // Lazy: kaynaklar görünür olunca site.js tarafından yüklenir (data-src)
  const a = lazy ? 'data-src' : 'src';
  return `<video class="${cls}" ${lazy ? 'data-lazy-video' : 'autoplay'} muted loop playsinline preload="none"
    poster="/assets/img/${scene}.webp" aria-label="${esc(label)}">
    <source ${a}="/assets/video/${scene}.webm" type="video/webm">
    <source ${a}="/assets/video/${scene}.mp4" type="video/mp4">
  </video>`;
}

// ---------------------------------------------------------------- parçalar
export function breadcrumb(items) {
  if (!items || items.length < 2) return '';
  const lis = items
    .map((it, i) =>
      i === items.length - 1
        ? `<li aria-current="page" class="text-brand-300 truncate max-w-[16rem]">${esc(it.name)}</li>`
        : `<li><a href="${it.path}" class="hover:text-brand-300 transition-colors">${esc(it.name)}</a></li><li aria-hidden="true" class="opacity-50">/</li>`)
    .join('');
  return `<nav aria-label="Sayfa yolu" class="text-sm text-slate-300"><ol class="flex flex-wrap items-center gap-2">${lis}</ol></nav>`;
}

function header(current) {
  const links = site.nav
    .map((n) => {
      const active = n.href === '/' ? current === '/' : current.startsWith(n.href) ||
        (n.href === '/blog/' && current.startsWith('/haberler/'));
      return `<li><a href="${n.href}" class="nav-link ${active ? 'is-active' : ''}"${active ? ' aria-current="page"' : ''}>${n.label}</a></li>`;
    })
    .join('');
  const mobile = site.nav
    .map((n, i) => `<li style="--i:${i}"><a href="${n.href}" class="block py-3 text-2xl font-display font-bold uppercase tracking-wide text-white hover:text-brand-400">${n.label}</a></li>`)
    .join('');
  return `
<a href="#icerik" class="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:bg-brand-500 focus:text-ink-950 focus:px-4 focus:py-2 focus:rounded">İçeriğe geç</a>
<div id="scroll-progress" aria-hidden="true"></div>
<header id="site-header" class="site-header">
  <div class="container-x flex items-center justify-between h-20">
    <a href="/" class="shrink-0 flex items-center" aria-label="${esc(site.name)} - Ana Sayfa">
      <img src="/assets/brand/logo-light.svg" alt="CMS İnşaat Hafriyat logosu" width="111" height="60" class="h-12 md:h-14 w-auto" fetchpriority="high">
    </a>
    <nav aria-label="Ana menü" class="hidden lg:block">
      <ul class="flex items-center gap-1">${links}</ul>
    </nav>
    <div class="flex items-center gap-2">
      <a href="tel:${site.phone}" class="hidden md:inline-flex items-center gap-2 text-sm font-semibold text-white/90 hover:text-brand-300 px-3">${icon('phone', 'w-4 h-4')} ${site.phoneDisplay}</a>
      <a href="/iletisim/" class="btn-primary hidden sm:inline-flex !py-2.5 !px-5 text-sm">Teklif Al</a>
      <button id="menu-toggle" class="lg:hidden p-2 text-white" aria-label="Menüyü aç" aria-expanded="false" aria-controls="mobile-menu">${icon('menu', 'w-7 h-7')}</button>
    </div>
  </div>
</header>
<div id="mobile-menu" class="mobile-menu" hidden>
  <button id="menu-close" class="absolute top-6 right-5 p-2 text-white" aria-label="Menüyü kapat">${icon('x', 'w-8 h-8')}</button>
  <nav aria-label="Mobil menü" class="container-x pt-28"><ul>${mobile}</ul>
    <div class="mt-10 flex flex-col gap-3 text-slate-300">
      <a href="tel:${site.phone}" class="flex items-center gap-3">${icon('phone', 'w-5 h-5 text-brand-400')} ${site.phoneDisplay}</a>
      <a href="mailto:${site.email}" class="flex items-center gap-3">${icon('mail', 'w-5 h-5 text-brand-400')} ${site.email}</a>
    </div>
  </nav>
</div>`;
}

function footer(services, latest) {
  const nav = site.nav.map((n) => `<li><a href="${n.href}" class="footer-link">${n.label}</a></li>`).join('');
  const svc = services.map((s) => `<li><a href="/hizmetler/${s.slug}/" class="footer-link">${esc(s.name)}</a></li>`).join('');
  const posts = latest
    .map((p) => `<li><a href="${p.path}" class="footer-link line-clamp-2">${esc(p.h1)}</a></li>`)
    .join('');
  const year = new Date().getFullYear();
  return `
<footer class="relative bg-ink-950 text-slate-300 pt-20 pb-10 overflow-hidden" aria-labelledby="footer-baslik">
  <div class="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-brand-600 via-brand-400 to-brand-600"></div>
  <h2 id="footer-baslik" class="sr-only">Site alt bilgisi</h2>
  <div class="container-x grid gap-12 md:grid-cols-2 lg:grid-cols-5">
    <div class="lg:col-span-2">
      <a href="/" aria-label="${esc(site.name)} - Ana Sayfa"><img src="/assets/brand/logo-light.svg" alt="CMS İnşaat Hafriyat logosu" width="167" height="90" class="h-20 w-auto" loading="lazy"></a>
      <p class="mt-6 max-w-md leading-relaxed">${esc(site.legalName)}; hafriyat, iş makineleri, inşaat, nakliye ve ihracat alanlarında kalite ve güven odaklı hizmet sunar.</p>
      <p class="mt-4 font-display text-xl uppercase tracking-wide text-brand-400">${esc(site.slogan)}</p>
      <div class="mt-6 flex flex-wrap gap-3">
        <a href="${waLink()}" class="btn-wa" rel="noopener" target="_blank">${icon('whatsapp', 'w-5 h-5')} WhatsApp</a>
        <a href="tel:${site.phone}" class="btn-ghost">${icon('phone', 'w-5 h-5')} Hemen Ara</a>
      </div>
    </div>
    <div>
      <h3 class="footer-title">Kurumsal</h3>
      <ul class="space-y-2">${nav}<li><a href="/haberler/" class="footer-link">Haberler</a></li><li><a href="/sss/" class="footer-link">Sıkça Sorulan Sorular</a></li></ul>
    </div>
    <div>
      <h3 class="footer-title">Hizmetlerimiz</h3>
      <ul class="space-y-2">${svc}</ul>
    </div>
    <div>
      <h3 class="footer-title">İletişim</h3>
      <ul class="space-y-3">
        <li><a href="mailto:${site.email}" class="footer-link inline-flex items-center gap-2 break-all">${icon('mail', 'w-4 h-4 text-brand-400 shrink-0')} ${site.email}</a></li>
        <li><a href="tel:${site.phone}" class="footer-link inline-flex items-center gap-2">${icon('phone', 'w-4 h-4 text-brand-400')} ${site.phoneDisplay}</a></li>
        <li><a href="${waLink()}" class="footer-link inline-flex items-center gap-2" rel="noopener" target="_blank">${icon('whatsapp', 'w-4 h-4 text-brand-400')} WhatsApp Destek</a></li>
        <li><a href="${site.mapLink}" class="footer-link inline-flex items-start gap-2" rel="noopener" target="_blank">${icon('pin', 'w-4 h-4 text-brand-400 shrink-0 mt-1')} <address class="not-italic">${esc(site.address.display)}</address></a></li>
      </ul>
      <h3 class="footer-title mt-8">Son Yazılar</h3>
      <ul class="space-y-2 text-sm">${posts}</ul>
    </div>
  </div>
  <div class="container-x mt-16 pt-8 border-t border-white/10 flex flex-col md:flex-row gap-4 justify-between text-sm text-slate-400">
    <p>© ${year} ${esc(site.legalName)} Tüm hakları saklıdır.</p>
    <ul class="flex flex-wrap gap-x-6 gap-y-2">
      <li><a href="/kvkk/" class="hover:text-brand-300">KVKK Aydınlatma Metni</a></li>
      <li><a href="/sitemap.xml" class="hover:text-brand-300">Site Haritası</a></li>
    </ul>
  </div>
</footer>`;
}

function floating() {
  return `
<a href="${waLink()}" class="wa-float" target="_blank" rel="noopener" aria-label="WhatsApp ile yazın">
  ${icon('whatsapp', 'w-8 h-8')}<span class="wa-float__label">WhatsApp</span>
</a>
<button id="to-top" class="to-top" aria-label="Sayfanın başına dön">${icon('arrow', 'w-5 h-5 -rotate-90')}</button>
<div id="chatbot" class="chatbot" data-state="closed">
  <button id="chat-toggle" class="chat-toggle" aria-label="Yapay zeka asistanı ile sohbet et" aria-expanded="false" aria-controls="chat-panel">
    <span class="chat-toggle__pulse" aria-hidden="true"></span>${icon('bot', 'w-7 h-7')}
  </button>
  <section id="chat-panel" class="chat-panel" role="dialog" aria-label="CMS Hafriyat Asistan" hidden>
    <header class="chat-head">
      <div class="flex items-center gap-3">
        <span class="chat-avatar">${icon('bot', 'w-5 h-5')}</span>
        <div><p class="font-semibold text-white leading-tight">CMS Asistan</p><p class="text-xs text-emerald-300 flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-emerald-400 inline-block"></span>7/24 çevrimiçi</p></div>
      </div>
      <button id="chat-close" class="p-1 text-slate-300 hover:text-white" aria-label="Sohbeti kapat">${icon('x', 'w-5 h-5')}</button>
    </header>
    <div id="chat-log" class="chat-log" aria-live="polite"></div>
    <div id="chat-quick" class="chat-quick"></div>
    <form id="chat-form" class="chat-form" autocomplete="off">
      <label for="chat-input" class="sr-only">Mesajınız</label>
      <input id="chat-input" name="message" maxlength="600" placeholder="Sorunuzu yazın…" class="chat-input" required>
      <button class="chat-send" aria-label="Gönder">${icon('send', 'w-5 h-5')}</button>
    </form>
    <p class="chat-note">Yapay zeka yanıtları bilgilendirme amaçlıdır. Kesin teklif için <a href="${waLink()}" target="_blank" rel="noopener">WhatsApp</a>.</p>
  </section>
</div>`;
}

// ---------------------------------------------------------------- belge
export function document({ page, body, services, latest }) {
  const url = abs(page.path);
  const ogImage = abs(page.ogImage || '/assets/img/og/hafriyat.jpg');
  const jsonld = JSON.stringify({ '@context': 'https://schema.org', '@graph': page.schema || [] });
  const robots = page.noindex ? 'noindex, follow' : ROBOTS;
  return `<!doctype html>
<html lang="${site.lang}" dir="ltr">
<head>
<meta charset="utf-8">
<script>document.documentElement.classList.add('js')</script>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(page.title)}</title>
<meta name="description" content="${esc(page.description)}">
<meta name="keywords" content="${esc(page.keywords)}">
<meta name="robots" content="${robots}">
<meta name="googlebot" content="${robots}">
<meta name="bingbot" content="${robots}">
<link rel="canonical" href="${url}">
<link rel="alternate" hreflang="tr-TR" href="${url}">
<link rel="alternate" hreflang="x-default" href="${url}">
<meta name="author" content="${esc(page.author || site.author)}">
<meta name="publisher" content="${esc(site.publisher)}">
<meta name="copyright" content="${esc(site.legalName)}">
<meta name="language" content="Turkish">
<meta http-equiv="content-language" content="tr">
<meta name="format-detection" content="telephone=yes">
<meta name="theme-color" content="${site.themeColor}">
<meta property="og:locale" content="${site.locale}">
<meta property="og:type" content="${page.ogType || 'website'}">
<meta property="og:site_name" content="${esc(site.name)}">
<meta property="og:title" content="${esc(page.title)}">
<meta property="og:description" content="${esc(page.description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${ogImage}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(page.h1)}">
${page.article ? `<meta property="article:published_time" content="${page.article.published}">
<meta property="article:modified_time" content="${page.article.modified}">
<meta property="article:section" content="${esc(page.article.section)}">
<meta property="article:publisher" content="${site.url}/">` : ''}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(page.title)}">
<meta name="twitter:description" content="${esc(page.description)}">
<meta name="twitter:image" content="${ogImage}">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="alternate" type="application/rss+xml" title="${esc(site.name)} Blog" href="/feed.xml">
<link rel="preload" href="/assets/fonts/barlow-condensed-latin-800-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/inter-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
${page.preloadImage ? `<link rel="preload" as="image" href="${page.preloadImage}" fetchpriority="high">` : ''}
<link rel="stylesheet" href="/assets/css/site.css?v=${page.version}">
<script type="application/ld+json">${jsonld}</script>
</head>
<body class="bg-white text-ink-800 antialiased ${page.bodyClass || ''}">
${header(page.path)}
<main id="icerik">
${body}
</main>
${footer(services, latest)}
${floating()}
<script src="/assets/js/site.js?v=${page.version}" defer></script>
<script src="/assets/js/chat.js?v=${page.version}" defer></script>
</body>
</html>`;
}
