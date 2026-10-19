import site from '../site.config.mjs';
import { icon } from './icons.mjs';
import { esc, picture, video, breadcrumb, waLink } from './layout.mjs';

export const slugify = (s) =>
  s.toLocaleLowerCase('tr')
    .replace(/ı/g, 'i').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export const words = (html) => html.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;

const TR_MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
export const trDate = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${TR_MONTHS[m - 1]} ${y}`;
};

/** h2'lere id ekler, içindekiler listesini döndürür */
export function withToc(html) {
  const toc = [];
  const out = html.replace(/<h2>(.*?)<\/h2>/g, (_, inner) => {
    const id = slugify(inner);
    toc.push({ id, text: inner.replace(/<[^>]+>/g, '') });
    return `<h2 id="${id}">${inner}</h2>`;
  });
  return { html: out, toc };
}

export function pageHero({ h1, lead, scene, crumbs, kicker, videoBg = true, blog = false, meta = '' }) {
  return `
<section class="page-hero">
  <div class="absolute inset-0">
    ${videoBg && !blog ? video(scene, h1, { cls: 'hero-media' }) : picture(scene, h1, { cls: 'hero-media', eager: true, blog, hero: true })}
    <div class="absolute inset-0 bg-gradient-to-r from-ink-950/85 via-ink-950/60 to-ink-950/20"></div>
    <div class="absolute inset-0 bg-gradient-to-t from-ink-950/80 to-transparent"></div>
  </div>
  <div class="container-x relative pt-36 pb-16 md:pt-44 md:pb-24">
    ${breadcrumb(crumbs)}
    ${kicker ? `<p class="kicker mt-8" data-reveal>${esc(kicker)}</p>` : ''}
    <h1 class="mt-4 max-w-4xl font-display text-4xl sm:text-5xl md:text-6xl font-extrabold uppercase leading-[0.95] text-white text-balance" data-reveal="split">${esc(h1)}</h1>
    ${lead ? `<p class="mt-6 max-w-2xl text-lg md:text-xl text-slate-200 leading-relaxed" data-reveal style="--d:.15s">${esc(lead)}</p>` : ''}
    ${meta}
  </div>
</section>`;
}

export function sectionHead({ kicker, title, text, center = false, dark = false, as = 'h2' }) {
  return `<div class="${center ? 'text-center mx-auto' : ''} max-w-3xl" data-reveal>
    ${kicker ? `<p class="kicker">${esc(kicker)}</p>` : ''}
    <${as} class="mt-3 font-display text-3xl md:text-5xl font-extrabold uppercase leading-none ${dark ? 'text-white' : 'text-ink-900'} text-balance">${title}</${as}>
    ${text ? `<p class="mt-5 text-lg leading-relaxed ${dark ? 'text-slate-300' : 'text-ink-600'}">${text}</p>` : ''}
  </div>`;
}

export function serviceCard(s, i = 0) {
  return `<article class="service-card group" data-reveal style="--d:${(i % 3) * 0.08}s">
  <a href="/hizmetler/${s.slug}/" class="absolute inset-0 z-10" aria-label="${esc(s.name)} hizmeti detayları"></a>
  <div class="relative aspect-[16/10] overflow-hidden">
    ${picture(s.scene + '', s.h1, { cls: 'w-full h-full object-cover transition-transform duration-700 group-hover:scale-110' })}
    <div class="absolute inset-0 bg-gradient-to-t from-ink-950/80 via-transparent"></div>
    <span class="absolute left-5 bottom-5 grid place-items-center w-14 h-14 rounded-2xl bg-brand-500 text-ink-950 shadow-lg transition-transform duration-500 group-hover:-translate-y-1 group-hover:rotate-6">${icon(s.icon, 'w-7 h-7')}</span>
  </div>
  <div class="p-6">
    <h3 class="font-display text-2xl font-bold uppercase text-ink-900 group-hover:text-brand-600 transition-colors">${esc(s.name)}</h3>
    <p class="mt-3 text-ink-600 leading-relaxed">${esc(s.summary)}</p>
    <span class="mt-5 inline-flex items-center gap-2 font-semibold text-brand-700">Detaylı İncele ${icon('arrow', 'w-4 h-4 transition-transform group-hover:translate-x-1')}</span>
  </div>
</article>`;
}

export function postCard(p, i = 0) {
  return `<article class="post-card group" data-reveal style="--d:${(i % 3) * 0.08}s" data-category="${esc(p.type)}">
  <a href="${p.path}" class="absolute inset-0 z-10" aria-label="${esc(p.h1)}"></a>
  <div class="aspect-[16/9] overflow-hidden">${picture(p.slug, p.h1, { cls: 'w-full h-full object-cover transition-transform duration-700 group-hover:scale-105', blog: true })}</div>
  <div class="p-6 flex flex-col flex-1">
    <div class="flex items-center gap-3 text-xs font-semibold uppercase tracking-wider">
      <span class="px-2.5 py-1 rounded-full ${p.type === 'haber' ? 'bg-sky-100 text-sky-800' : 'bg-brand-100 text-brand-800'}">${esc(p.category)}</span>
      <time datetime="${p.date}" class="text-ink-500">${trDate(p.date)}</time>
    </div>
    <h3 class="mt-4 text-xl font-bold leading-snug text-ink-900 group-hover:text-brand-700 transition-colors">${esc(p.h1)}</h3>
    <p class="mt-3 text-ink-600 leading-relaxed line-clamp-3">${esc(p.excerpt)}</p>
    <span class="mt-auto pt-5 inline-flex items-center gap-2 text-sm font-semibold text-brand-700">Devamını Oku ${icon('arrow', 'w-4 h-4 transition-transform group-hover:translate-x-1')}</span>
  </div>
</article>`;
}

export function faqList(faqs, { idPrefix = 'sss' } = {}) {
  return `<div class="faq-list">${faqs
    .map((f, i) => `<details class="faq-item" data-reveal style="--d:${i * 0.05}s"${i === 0 ? ' open' : ''}>
      <summary id="${idPrefix}-${i + 1}"><span>${esc(f.q)}</span><span class="faq-icon" aria-hidden="true"></span></summary>
      <div class="faq-body"><p>${esc(f.a)}</p></div>
    </details>`)
    .join('')}</div>`;
}

export function ctaBand({ title = 'Projeniz İçin Hemen Teklif Alın', text = 'Hafriyat, temel kazı, altyapı, yol, dolgu ve nakliye ihtiyaçlarınız için ekibimizle görüşün; size uygun, planlı ve güvenilir çözümü birlikte belirleyelim.', scene = 'nakliye' } = {}) {
  return `<section class="relative overflow-hidden bg-ink-950 py-24" aria-label="Teklif çağrısı">
  <div class="absolute inset-0 opacity-40" data-parallax>${picture(scene, 'CMS Hafriyat saha çalışması', { cls: 'w-full h-[130%] object-cover' })}</div>
  <div class="absolute inset-0 bg-gradient-to-r from-ink-950 via-ink-950/90 to-ink-950/40"></div>
  <div class="container-x relative grid gap-10 lg:grid-cols-[1fr_auto] items-center">
    <div data-reveal>
      <p class="kicker">Güvenle Başlar, Değerle Büyür</p>
      <h2 class="mt-3 font-display text-4xl md:text-5xl font-extrabold uppercase text-white leading-none text-balance">${esc(title)}</h2>
      <p class="mt-5 max-w-2xl text-lg text-slate-300">${esc(text)}</p>
    </div>
    <div class="flex flex-wrap gap-4" data-reveal style="--d:.15s">
      <a href="/iletisim/" class="btn-primary">${icon('mail', 'w-5 h-5')} Teklif Formu</a>
      <a href="${waLink()}" class="btn-wa" target="_blank" rel="noopener">${icon('whatsapp', 'w-5 h-5')} WhatsApp</a>
      <a href="tel:${site.phone}" class="btn-ghost">${icon('phone', 'w-5 h-5')} ${site.phoneDisplay}</a>
    </div>
  </div>
</section>`;
}

export function shareBar(url, title) {
  const u = encodeURIComponent(url);
  const t = encodeURIComponent(title);
  return `<div class="flex flex-wrap items-center gap-3">
    <span class="text-sm font-semibold text-ink-600">Paylaş:</span>
    <a class="share-btn" href="https://wa.me/?text=${t}%20${u}" target="_blank" rel="noopener nofollow" aria-label="WhatsApp'ta paylaş">${icon('whatsapp', 'w-4 h-4')}</a>
    <a class="share-btn" href="https://www.linkedin.com/sharing/share-offsite/?url=${u}" target="_blank" rel="noopener nofollow" aria-label="LinkedIn'de paylaş">in</a>
    <a class="share-btn" href="https://x.com/intent/post?url=${u}&text=${t}" target="_blank" rel="noopener nofollow" aria-label="X'te paylaş">𝕏</a>
    <a class="share-btn" href="https://www.facebook.com/sharer/sharer.php?u=${u}" target="_blank" rel="noopener nofollow" aria-label="Facebook'ta paylaş">f</a>
    <button class="share-btn" data-copy="${esc(url)}" aria-label="Bağlantıyı kopyala">🔗</button>
  </div>`;
}
