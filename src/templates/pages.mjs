import site from '../site.config.mjs';
import { icon } from './icons.mjs';
import { esc, picture, video, waLink, abs } from './layout.mjs';
import {
  pageHero, sectionHead, serviceCard, postCard, faqList, ctaBand, shareBar, withToc, trDate, words,
} from './components.mjs';

// ---------------------------------------------------------------- ortak veriler
export const VALUES = [
  { icon: 'shield', name: 'Güvenilirlik', text: 'İş ilişkilerimizi dürüstlük, şeffaflık ve karşılıklı güven üzerine kurarız.' },
  { icon: 'star', name: 'Kalite', text: 'Hizmetlerimizin her aşamasında yüksek standartları hedefleriz.' },
  { icon: 'target', name: 'Sorumluluk', text: 'Üstlendiğimiz işleri titizlikle ve profesyonel bir anlayışla yürütürüz.' },
  { icon: 'smile', name: 'Müşteri Memnuniyeti', text: 'İhtiyaçları doğru anlayarak beklentilere uygun çözümler geliştiririz.' },
  { icon: 'trend', name: 'Sürekli Gelişim', text: 'Yenilikleri takip eder, gelişime ve verimliliğe önem veririz.' },
  { icon: 'leaf', name: 'Sürdürülebilirlik', text: 'Uzun vadeli başarıyı ve kalıcı iş birliklerini esas alırız.' },
];

export const GENERAL_FAQS = [
  { q: 'CMS Hafriyat hangi alanlarda hizmet veriyor?', a: 'CMS Hafriyat İnşaat Nakliyat Ltd. Şti. olarak hafriyat ve kazı işleri, iş makineleri operasyonları, inşaat ve taahhüt işleri, nakliye ve ihracat alanlarında hizmet veriyoruz. Her projeyi planlı çalışma, kaliteli hizmet ve karşılıklı güven ilkeleriyle yürütüyoruz.' },
  { q: 'Teklif almak için ne yapmam gerekiyor?', a: 'İletişim sayfamızdaki formu doldurabilir, 0533 500 37 79 numarasından bizi arayabilir veya WhatsApp üzerinden yazabilirsiniz. Projenizin konumu, kapsamı ve zamanlaması hakkında kısa bilgi paylaşmanız, size en doğru çözümü ve teklifi hazırlamamızı kolaylaştırır.' },
  { q: 'Ofisiniz nerede?', a: 'Ofisimiz Toros Mahallesi 78090 Sokak, Özcan Apartmanı Sitesi No: 10 A, Çukurova/Adana adresindedir. Ziyaret öncesinde 0533 500 37 79 numarasından veya WhatsApp üzerinden randevu almanızı öneririz; yol tarifi için iletişim sayfamızdaki haritayı kullanabilirsiniz.' },
  { q: 'Keşif için sahaya geliyor musunuz?', a: 'Evet. Doğru planlama ve sağlıklı fiyatlandırma için sahayı yerinde görmeyi önemsiyoruz. Keşif sırasında zemin yapısı, erişim yolları, çevredeki yapılar ve iş takvimi birlikte değerlendirilir; ardından size uygun bir çalışma planı sunulur.' },
  { q: 'Hafriyat ve inşaat izinleri konusunda destek veriyor musunuz?', a: 'İzin ve ruhsat süreçleri bulunduğunuz belediyeye ve projenin niteliğine göre değişir. Süreçte hangi belgelerin gerekebileceği, döküm sahası ve iş planı gibi konularda size yol gösteriyor, ilgili kurumlarla koordinasyonun planlanmasına destek oluyoruz.' },
  { q: 'Hangi iş makineleriyle çalışıyorsunuz?', a: 'Projenin ihtiyacına göre ekskavatör, kazıcı yükleyici, loder, dozer ve silindir gibi iş makineleri ile damperli kamyonlar planlanır. Makine seçimi; zemin yapısı, saha erişimi, iş hacmi ve süre hedefleri dikkate alınarak yapılır.' },
  { q: 'Nakliye hizmetiniz yalnızca hafriyat toprağı için mi?', a: 'Hayır. Hafriyat toprağının yanı sıra inşaat malzemeleri ve proje kapsamındaki yüklerin taşınması için de nakliye planlaması yapıyoruz. Güzergâh, yükleme düzeni ve teslim zamanı işin niteliğine göre birlikte belirlenir.' },
  { q: 'İş güvenliği konusunda nasıl bir yaklaşımınız var?', a: 'Sahada iş güvenliğini işin ayrılmaz bir parçası olarak görüyoruz. Çalışma alanının güvenli hale getirilmesi, makine operasyonlarının planlı yürütülmesi ve çevredeki yapı ile kişilerin korunması her projede öncelikli konularımız arasındadır.' },
  { q: 'Yapay zeka asistanınız ne işe yarıyor?', a: 'Sitemizdeki yapay zeka destekli asistan, hizmetlerimiz ve süreçlerimiz hakkındaki sorularınızı günün her saatinde yanıtlar. Kesin fiyat ve planlama için ise sizi WhatsApp veya telefon üzerinden ekibimize yönlendirir.' },
];

const WHY = [
  { icon: 'layers', title: 'Tek Noktadan Çözüm', text: 'Hafriyattan inşaata, nakliyeden ihracata uzanan faaliyet alanlarımızla süreçleri tek elden koordine ediyoruz.' },
  { icon: 'calendar', title: 'Planlı Çalışma', text: 'Keşif, planlama, uygulama ve teslim adımlarını önceden netleştiriyor, iş takvimine sadık kalmayı hedefliyoruz.' },
  { icon: 'shield', title: 'Güvenlik Önceliği', text: 'Saha güvenliği, çevre ve komşu yapıların korunması her operasyonun başında ele alınır.' },
  { icon: 'handshake', title: 'Kalıcı İş Ortaklığı', text: 'Başarıyı yalnızca bir işi bitirmek değil, güven kazanıp kalıcı ilişkiler kurmak olarak görüyoruz.' },
];

const crumb = (...items) => [{ name: 'Ana Sayfa', path: '/' }, ...items];

// ---------------------------------------------------------------- şema yardımcıları
export const ORG_ID = `${site.url}/#organizasyon`;
export function orgSchema() {
  const sameAs = Object.values(site.social).filter(Boolean);
  return {
    '@type': ['Organization', 'GeneralContractor', 'LocalBusiness'],
    '@id': ORG_ID,
    name: site.legalName,
    alternateName: ['CMS Hafriyat', 'CMS İnşaat Hafriyat'],
    url: `${site.url}/`,
    logo: { '@type': 'ImageObject', url: abs('/assets/brand/logo-1200.png'), width: 1200, height: 648 },
    image: abs('/assets/img/og/hafriyat.jpg'),
    email: site.email,
    telephone: site.phone,
    slogan: site.slogan,
    description: 'Hafriyat, iş makineleri, inşaat, nakliye ve ihracat alanlarında kalite ve güven odaklı hizmet veren firma.',
    areaServed: { '@type': 'Country', name: 'Türkiye' },
    knowsLanguage: 'tr',
    address: { '@type': 'PostalAddress', streetAddress: site.address.street, addressLocality: site.address.district, addressRegion: site.address.city, postalCode: site.address.postalCode, addressCountry: site.address.country },
    geo: { '@type': 'GeoCoordinates', latitude: site.geo.lat, longitude: site.geo.lng },
    hasMap: site.mapLink,
    contactPoint: [{ '@type': 'ContactPoint', telephone: site.phone, email: site.email, contactType: 'customer service', availableLanguage: ['Turkish'], areaServed: 'TR' }],
    ...(sameAs.length ? { sameAs } : {}),
  };
}
export function websiteSchema() {
  return { '@type': 'WebSite', '@id': `${site.url}/#website`, url: `${site.url}/`, name: site.name, inLanguage: 'tr-TR', publisher: { '@id': ORG_ID } };
}
export function crumbSchema(items) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: abs(it.path) })),
  };
}
export function webPageSchema(page, type = 'WebPage') {
  return {
    '@type': type, '@id': `${abs(page.path)}#sayfa`, url: abs(page.path), name: page.title, description: page.description,
    inLanguage: 'tr-TR', isPartOf: { '@id': `${site.url}/#website` }, publisher: { '@id': ORG_ID },
    primaryImageOfPage: page.ogImage ? abs(page.ogImage) : undefined,
  };
}
const faqSchema = (faqs) => ({
  '@type': 'FAQPage',
  mainEntity: faqs.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
});
const videoSchema = (scene, name, description) => ({
  '@type': 'VideoObject', name, description,
  thumbnailUrl: abs(`/assets/img/${scene}.webp`), contentUrl: abs(`/assets/video/${scene}.mp4`),
  uploadDate: '2026-10-19T09:00:00+03:00', duration: 'PT8S', publisher: { '@id': ORG_ID }, inLanguage: 'tr-TR',
});

// ---------------------------------------------------------------- ANA SAYFA
export function home({ services, posts }) {
  const slides = [
    { scene: 'hafriyat', kicker: 'Hafriyat & Kazı', title: 'Sağlam Projeler<br><span class="text-brand-400">Sağlam Zeminde</span> Başlar', text: 'Temel kazısından saha düzenlemesine kadar hafriyat işlerinizi planlı, güvenli ve çevreye duyarlı biçimde yürütüyoruz.' },
    { scene: 'insaat', kicker: 'İnşaat & Taahhüt', title: 'Güvenle Başlar,<br><span class="text-brand-400">Değerle Büyür</span>', text: 'İnşaat ve taahhüt işlerinde kalite, iş disiplini ve sorumluluk bilinciyle projelerinize değer katıyoruz.' },
    { scene: 'nakliye', kicker: 'Nakliye & Lojistik', title: 'Yükünüz<br><span class="text-brand-400">Zamanında</span> Yerinde', text: 'Hafriyat toprağı ve inşaat malzemelerinin taşınmasında planlı, düzenli ve güvenilir nakliye çözümleri sunuyoruz.' },
  ];
  const hero = `
<section class="hero" aria-label="Öne çıkan hizmetler" data-hero>
  ${slides.map((s, i) => `<div class="hero-slide${i === 0 ? ' is-active' : ''}" data-slide="${i}">
    ${i === 0 ? `<video class="hero-media" autoplay muted loop playsinline preload="auto" poster="/assets/img/${s.scene}.webp" aria-label="${s.kicker} videosu"><source src="/assets/video/${s.scene}.webm" type="video/webm"><source src="/assets/video/${s.scene}.mp4" type="video/mp4"></video>`
    : video(s.scene, `${s.kicker} videosu`, { cls: 'hero-media' })}
  </div>`).join('')}
  <div class="absolute inset-0 bg-gradient-to-r from-ink-950/90 via-ink-950/55 to-transparent pointer-events-none"></div>
  <div class="absolute inset-0 bg-gradient-to-t from-ink-950 via-transparent to-ink-950/40 pointer-events-none"></div>
  <div class="container-x relative h-full flex flex-col justify-center pt-24 pb-32">
    <h1 class="sr-only">CMS Hafriyat İnşaat Nakliyat: Hafriyat, İnşaat ve Nakliye Hizmetleri</h1>
    ${slides.map((s, i) => `<div class="hero-copy${i === 0 ? ' is-active' : ''}" data-copy="${i}" ${i ? 'aria-hidden="true"' : ''}>
      <p class="kicker">${s.kicker}</p>
      <p class="hero-title">${s.title}</p>
      <p class="mt-6 max-w-xl text-lg md:text-xl text-slate-200 leading-relaxed">${s.text}</p>
    </div>`).join('')}
    <div class="mt-10 flex flex-wrap gap-4 hero-actions">
      <a href="/iletisim/" class="btn-primary">${icon('mail', 'w-5 h-5')} Ücretsiz Keşif & Teklif</a>
      <a href="/hizmetler/" class="btn-ghost">Hizmetlerimizi Keşfet ${icon('arrow', 'w-5 h-5')}</a>
    </div>
  </div>
  <div class="absolute bottom-8 inset-x-0">
    <div class="container-x flex items-center justify-between gap-6">
      <div class="flex gap-3" role="tablist" aria-label="Slayt seçimi">
        ${slides.map((s, i) => `<button class="hero-dot${i === 0 ? ' is-active' : ''}" data-go="${i}" role="tab" aria-selected="${i === 0}" aria-label="${s.kicker}"><span></span></button>`).join('')}
      </div>
      <a href="#hizmetler" class="hidden md:flex items-center gap-3 text-sm uppercase tracking-widest text-slate-300 hover:text-white"><span class="scroll-cue" aria-hidden="true"></span> Aşağı Kaydır</a>
    </div>
  </div>
</section>`;

  const marquee = `<div class="bg-brand-500 text-ink-950 py-4 overflow-hidden" aria-hidden="true">
  <div class="marquee font-display text-2xl font-extrabold uppercase tracking-wide">
    ${[0, 1].map(() => `<div class="marquee__track">${['Hafriyat', 'Temel Kazısı', 'İş Makineleri', 'İnşaat & Taahhüt', 'Nakliye', 'Saha Düzenleme', 'İhracat', 'Toprak Taşıma'].map((t) => `<span>${t}</span><span class="opacity-40">✦</span>`).join('')}</div>`).join('')}
  </div>
</div>`;

  const stats = [
    { n: 5, s: '', label: 'Faaliyet Alanı' },
    { n: 6, s: '', label: 'Temel Değer' },
    { n: 7, s: '/24', label: 'Dijital Asistan Desteği' },
    { n: 100, s: '%', label: 'Sorumluluk Bilinci' },
  ];

  const svc = `<section id="hizmetler" class="section bg-slate-50">
  <div class="container-x">
    <div class="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
      ${sectionHead({ kicker: 'Hizmetlerimiz', title: 'Hafriyattan İhracata<br>Uçtan Uca Çözümler', text: 'Hafriyat ve iş makineleri operasyonlarından inşaat faaliyetlerine, nakliye hizmetlerinden ihracata kadar geniş bir alanda, planlı ve güvenilir hizmet sunuyoruz.' })}
      <a href="/hizmetler/" class="btn-dark shrink-0" data-reveal>Tüm Hizmetler ${icon('arrow', 'w-5 h-5')}</a>
    </div>
    <div class="mt-14 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">${services.map(serviceCard).join('')}
      <article class="service-card !bg-ink-950 text-white p-8 flex flex-col justify-between" data-reveal style="--d:.16s">
        <div><span class="grid place-items-center w-14 h-14 rounded-2xl bg-brand-500 text-ink-950">${icon('chat', 'w-7 h-7')}</span>
        <h3 class="mt-6 font-display text-3xl font-bold uppercase">Projenize Özel Çözüm</h3>
        <p class="mt-3 text-slate-300 leading-relaxed">İhtiyacınızı anlatın; keşif, planlama ve uygulama sürecini sizinle birlikte kurgulayalım.</p></div>
        <div class="mt-8 flex flex-wrap gap-3"><a href="/iletisim/" class="btn-primary !py-3">Teklif Al</a><a href="${waLink()}" target="_blank" rel="noopener" class="btn-wa !py-3">${icon('whatsapp', 'w-5 h-5')} Yaz</a></div>
      </article>
    </div>
  </div>
</section>`;

  const about = `<section class="section overflow-hidden">
  <div class="container-x grid gap-16 lg:grid-cols-2 items-center">
    <div class="relative" data-reveal="left">
      <div class="relative rounded-3xl overflow-hidden shadow-2xl aspect-[4/3]">${video('insaat', 'CMS Hafriyat inşaat sahası videosu', { cls: 'absolute inset-0 w-full h-full object-cover' })}</div>
      <div class="absolute -bottom-8 -right-4 md:-right-8 bg-brand-500 text-ink-950 rounded-2xl p-6 shadow-xl max-w-[15rem] float-y">
        <p class="font-display text-4xl font-extrabold leading-none">5</p><p class="mt-1 font-semibold">farklı alanda güvenilir hizmet</p>
      </div>
      <div class="absolute -top-6 -left-6 w-32 h-32 bg-[radial-gradient(circle,theme(colors.brand.500)_2px,transparent_2px)] [background-size:14px_14px] opacity-60 -z-10"></div>
    </div>
    <div>
      ${sectionHead({ kicker: 'Hakkımızda', title: 'Güven, Kalite ve<br>Güçlü İş Ortaklığı' })}
      <div class="mt-6 space-y-4 text-lg text-ink-600 leading-relaxed" data-reveal>
        <p><strong class="text-ink-900">CMS Hafriyat İnşaat Nakliyat Ltd. Şti.</strong>, hafriyat, inşaat, nakliye ve ihracat alanlarında faaliyet gösteren, kaliteyi ve güvenilirliği temel değerleri olarak benimseyen bir firmadır.</p>
        <p>Faaliyet gösterdiğimiz tüm sektörlerde müşteri memnuniyetini, iş disiplinini ve sürdürülebilir başarıyı ön planda tutarak projelere değer katmayı hedefliyoruz. Üstlendiğimiz her işi sorumluluk bilinciyle ele alıyoruz.</p>
      </div>
      <ul class="mt-8 grid sm:grid-cols-2 gap-4" data-reveal>
        ${['Planlı ve disiplinli çalışma', 'Kalite odaklı hizmet', 'Şeffaf iletişim', 'Sürdürülebilir iş birliği'].map((t) => `<li class="flex items-center gap-3 font-semibold text-ink-800"><span class="grid place-items-center w-8 h-8 rounded-full bg-brand-100 text-brand-700">${icon('check', 'w-4 h-4')}</span>${t}</li>`).join('')}
      </ul>
      <a href="/hakkimizda/" class="btn-dark mt-10" data-reveal>Firmamızı Tanıyın ${icon('arrow', 'w-5 h-5')}</a>
    </div>
  </div>
</section>`;

  const counters = `<section class="relative bg-ink-950 py-20 overflow-hidden" aria-label="Rakamlarla CMS Hafriyat">
  <div class="absolute inset-0 opacity-[0.07] bg-[linear-gradient(45deg,#fff_25%,transparent_25%,transparent_50%,#fff_50%,#fff_75%,transparent_75%)] [background-size:40px_40px]"></div>
  <div class="container-x relative grid grid-cols-2 lg:grid-cols-4 gap-10">
    ${stats.map((s, i) => `<div class="text-center" data-reveal style="--d:${i * 0.1}s">
      <p class="font-display text-6xl md:text-7xl font-extrabold text-brand-400"><span data-count="${s.n}">0</span>${s.s}</p>
      <p class="mt-2 text-slate-300 uppercase tracking-wider text-sm font-semibold">${s.label}</p></div>`).join('')}
  </div>
</section>`;

  const why = `<section class="section">
  <div class="container-x">
    ${sectionHead({ kicker: 'Neden CMS Hafriyat?', title: 'İşinizi Güvenle<br>Teslim Edebileceğiniz Ekip', center: true, text: 'Hafriyat ve iş makineleri operasyonlarından nakliyeye kadar her aşamada planlı çalışma, kaliteli hizmet ve karşılıklı güven ilkeleriyle hareket ediyoruz.' })}
    <div class="mt-16 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
      ${WHY.map((w, i) => `<div class="feature-card" data-reveal style="--d:${i * 0.08}s">
        <span class="feature-icon">${icon(w.icon, 'w-7 h-7')}</span>
        <h3 class="mt-6 text-xl font-bold text-ink-900">${w.title}</h3>
        <p class="mt-3 text-ink-600 leading-relaxed">${w.text}</p></div>`).join('')}
    </div>
  </div>
</section>`;

  const process = `<section class="section bg-slate-50">
  <div class="container-x">
    ${sectionHead({ kicker: 'Çalışma Sürecimiz', title: '4 Adımda Planlı ve Güvenli Uygulama', text: 'Her projede aynı disiplinle ilerliyoruz: sahayı tanıyor, planlıyor, uyguluyor ve temiz bir şekilde teslim ediyoruz.' })}
    <ol class="mt-16 grid gap-8 md:grid-cols-2 lg:grid-cols-4 process">
      ${[
        ['Keşif & Analiz', 'Sahayı yerinde inceliyor; zemin, erişim ve çevre koşullarını değerlendiriyoruz.'],
        ['Planlama', 'Makine, ekip, güzergâh ve iş takvimini projenize özel olarak planlıyoruz.'],
        ['Uygulama', 'İş güvenliği önlemleri eşliğinde operasyonu kontrollü biçimde yürütüyoruz.'],
        ['Teslim', 'Sahayı temiz ve düzenli şekilde bir sonraki aşamaya hazır teslim ediyoruz.'],
      ].map(([t, x], i) => `<li class="process-step" data-reveal style="--d:${i * 0.1}s"><span class="process-num">0${i + 1}</span><h3 class="mt-4 text-xl font-bold text-ink-900">${t}</h3><p class="mt-2 text-ink-600 leading-relaxed">${x}</p></li>`).join('')}
    </ol>
  </div>
</section>`;

  const showcase = `<section class="section bg-ink-950 text-white overflow-hidden">
  <div class="container-x">
    <div class="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
      ${sectionHead({ kicker: 'Yaptığımız İşler', title: 'Sahadan Kareler', dark: true, text: 'Hafriyat, inşaat, nakliye ve iş makineleri operasyonlarımızdan görüntüler.' })}
      <a href="/projeler/" class="btn-primary shrink-0" data-reveal>Tüm Çalışmalar ${icon('arrow', 'w-5 h-5')}</a>
    </div>
    <div class="mt-14 grid gap-6 md:grid-cols-6 md:grid-rows-2 md:h-[640px]">
      ${[['hafriyat', 'Hafriyat ve Kazı', 'md:col-span-4 md:row-span-1'], ['makine', 'İş Makineleri', 'md:col-span-2'], ['nakliye', 'Nakliye', 'md:col-span-2'], ['ihracat', 'İhracat Lojistiği', 'md:col-span-4']]
        .map(([s, t, c], i) => `<figure class="showcase ${c}" data-reveal style="--d:${i * 0.08}s">
        ${video(s, `${t} videosu`, { cls: 'absolute inset-0 w-full h-full object-cover' })}
        <figcaption class="absolute inset-x-0 bottom-0 p-6 bg-gradient-to-t from-ink-950/90 to-transparent"><span class="kicker !text-brand-300">CMS Hafriyat</span><span class="block mt-1 font-display text-2xl font-bold uppercase">${t}</span></figcaption>
      </figure>`).join('')}
    </div>
  </div>
</section>`;

  const values = `<section class="section">
  <div class="container-x grid gap-16 lg:grid-cols-[1fr_1.4fr]">
    <div class="lg:sticky lg:top-28 self-start">
      ${sectionHead({ kicker: 'Değerlerimiz', title: 'İşimize Yön Veren İlkeler', text: 'Bizim için başarı, yalnızca bir işi tamamlamak değil; iş ortaklarımızın güvenini kazanmak, kalıcı ilişkiler kurmak ve her projede sürdürülebilir değer oluşturmaktır.' })}
    </div>
    <div class="grid gap-5 sm:grid-cols-2">
      ${VALUES.map((v, i) => `<div class="value-card" data-reveal style="--d:${(i % 2) * 0.08}s">
        <span class="text-brand-600">${icon(v.icon, 'w-8 h-8')}</span>
        <h3 class="mt-4 text-xl font-bold text-ink-900">${v.name}</h3>
        <p class="mt-2 text-ink-600 leading-relaxed">${v.text}</p></div>`).join('')}
    </div>
  </div>
</section>`;

  const blog = `<section class="section bg-slate-50">
  <div class="container-x">
    <div class="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
      ${sectionHead({ kicker: 'Blog & Haberler', title: 'Rehberler ve Güncel Duyurular', text: 'Hafriyat, iş makineleri ve inşaat süreçleri hakkında bilgilendirici içerikler ile firmamızdan haberler.' })}
      <a href="/blog/" class="btn-dark shrink-0" data-reveal>Tüm Yazılar ${icon('arrow', 'w-5 h-5')}</a>
    </div>
    <div class="mt-14 grid gap-8 md:grid-cols-2 lg:grid-cols-3">${posts.slice(0, 3).map(postCard).join('')}</div>
  </div>
</section>`;

  const faq = `<section class="section">
  <div class="container-x grid gap-16 lg:grid-cols-[1fr_1.4fr]">
    <div>
      ${sectionHead({ kicker: 'Sıkça Sorulanlar', title: 'Merak Edilenler', text: 'Aklınıza takılan bir soru mu var? En sık sorulan soruları yanıtladık. Daha fazlası için <a href="/sss/" class="link">SSS sayfamıza</a> göz atabilir veya yapay zeka asistanımıza sorabilirsiniz.' })}
      <button class="btn-dark mt-8" data-open-chat data-reveal>${icon('bot', 'w-5 h-5')} Asistana Sor</button>
    </div>
    ${faqList(GENERAL_FAQS.slice(0, 5), { idPrefix: 'ana-sss' })}
  </div>
</section>`;

  return {
    path: '/',
    title: 'CMS Hafriyat | Adana Hafriyat, İnşaat ve Nakliye',
    description: 'Adana Çukurova merkezli CMS Hafriyat; hafriyat, iş makineleri, inşaat, nakliye ve ihracatta güvenilir hizmet. Keşif ve teklif için ulaşın.',
    keywords: 'Adana hafriyat, hafriyat firması, Çukurova hafriyat, inşaat firması Adana, müteahhit, iş makineleri, nakliye, CMS Hafriyat',
    h1: 'CMS Hafriyat İnşaat Nakliyat',
    ogImage: '/assets/img/og/hafriyat.jpg',
    preloadImage: '/assets/img/hafriyat.webp',
    crumbs: [{ name: 'Ana Sayfa', path: '/' }],
    schemaType: 'WebPage',
    extraSchema: [faqSchema(GENERAL_FAQS.slice(0, 5))],
    bodyClass: 'is-home',
    body: hero + marquee + svc + about + counters + why + process + showcase + values + blog + faq + ctaBand(),
  };
}

// ---------------------------------------------------------------- HAKKIMIZDA
export function about({ services }) {
  const body = `
${pageHero({ h1: 'Hakkımızda: Güven, Kalite ve Güçlü İş Ortaklığı', lead: 'Hafriyat, inşaat, nakliye ve ihracat alanlarında kaliteyi ve güvenilirliği temel değer olarak benimseyen bir firmayız.', scene: 'insaat', kicker: 'Kurumsal', crumbs: crumb({ name: 'Hakkımızda', path: '/hakkimizda/' }) })}
<section class="section">
  <div class="container-x grid gap-16 lg:grid-cols-[1.3fr_1fr] items-start">
    <div class="prose-cms" data-reveal>
      <h2>CMS Hafriyat İnşaat Nakliyat Ltd. Şti.</h2>
      <p><strong>CMS Hafriyat İnşaat Nakliyat Ltd. Şti.</strong>, <a href="/hizmetler/hafriyat/">hafriyat</a>, <a href="/hizmetler/insaat-taahhut/">inşaat</a>, <a href="/hizmetler/nakliye/">nakliye</a> ve <a href="/hizmetler/ihracat/">ihracat</a> alanlarında faaliyet gösteren, kaliteyi ve güvenilirliği temel değerleri olarak benimseyen bir firmadır.</p>
      <p>Faaliyet gösterdiğimiz tüm sektörlerde müşteri memnuniyetini, iş disiplinini ve sürdürülebilir başarıyı ön planda tutarak projelere değer katmayı hedefliyoruz. Sahip olduğumuz hizmet anlayışıyla, iş ortaklarımızın ihtiyaçlarına uygun, etkin ve güvenilir çözümler sunuyor; üstlendiğimiz her işi sorumluluk bilinciyle ele alıyoruz.</p>
      <p>Hafriyat ve <a href="/hizmetler/is-makineleri/">iş makineleri operasyonlarından</a> inşaat faaliyetlerine, nakliye hizmetlerinden ihracata kadar uzanan geniş faaliyet alanımızda; planlı çalışma, kaliteli hizmet ve karşılıklı güven ilkeleri doğrultusunda hareket ediyoruz. Sektörel gelişmeleri yakından takip ederek kendimizi sürekli geliştirmeyi ve hizmet standartlarımızı her geçen gün daha ileriye taşımayı amaçlıyoruz.</p>
      <blockquote>Bizim için başarı, yalnızca bir işi tamamlamak değil; iş ortaklarımızın güvenini kazanmak, kalıcı ilişkiler kurmak ve her projede sürdürülebilir değer oluşturmaktır.</blockquote>
    </div>
    <div class="relative rounded-3xl overflow-hidden shadow-2xl aspect-[4/5] lg:sticky lg:top-28" data-reveal="right">
      ${video('hafriyat', 'CMS Hafriyat hafriyat operasyonu videosu', { cls: 'absolute inset-0 w-full h-full object-cover' })}
      <div class="absolute inset-x-0 bottom-0 p-8 bg-gradient-to-t from-ink-950/90 to-transparent"><p class="font-display text-3xl font-extrabold uppercase text-white leading-none">Güvenle Başlar,<br><span class="text-brand-400">Değerle Büyür.</span></p></div>
    </div>
  </div>
</section>
<section class="section bg-ink-950 text-white">
  <div class="container-x grid gap-8 md:grid-cols-2">
    <article class="mv-card" data-reveal>
      <span class="feature-icon">${icon('target', 'w-7 h-7')}</span>
      <h2 class="mt-6 font-display text-4xl font-extrabold uppercase">Misyonumuz</h2>
      <p class="mt-4 text-lg text-slate-300 leading-relaxed">Faaliyet gösterdiğimiz tüm alanlarda kalite, güven ve profesyonellik ilkelerinden ödün vermeden müşterilerimize etkili çözümler sunmak; iş süreçlerini verimli, sorumlu ve müşteri odaklı bir yaklaşımla yürütmek.</p>
    </article>
    <article class="mv-card" data-reveal style="--d:.1s">
      <span class="feature-icon">${icon('eye', 'w-7 h-7')}</span>
      <h2 class="mt-6 font-display text-4xl font-extrabold uppercase">Vizyonumuz</h2>
      <p class="mt-4 text-lg text-slate-300 leading-relaxed">Hafriyat, inşaat, nakliye ve ihracat sektörlerinde güvenilirliği, hizmet kalitesi ve kurumsal yaklaşımıyla öne çıkan; sürekli gelişen, güçlü iş ortaklıkları kuran ve geleceğe değer katan bir firma olmak.</p>
    </article>
  </div>
</section>
<section class="section">
  <div class="container-x">
    ${sectionHead({ kicker: 'Değerlerimiz', title: 'Her İşte Aynı İlkeler', center: true, text: 'Kurumsal kültürümüzü oluşturan altı temel değer, sahadaki her kararımıza yön verir.' })}
    <div class="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      ${VALUES.map((v, i) => `<div class="value-card" data-reveal style="--d:${(i % 3) * 0.08}s"><span class="text-brand-600">${icon(v.icon, 'w-8 h-8')}</span><h3 class="mt-4 text-xl font-bold text-ink-900">${v.name}</h3><p class="mt-2 text-ink-600 leading-relaxed">${v.text}</p></div>`).join('')}
    </div>
  </div>
</section>
<section class="section bg-slate-50">
  <div class="container-x">
    ${sectionHead({ kicker: 'Faaliyet Alanlarımız', title: 'Geniş Hizmet Yelpazesi', text: 'Projelerinizin her aşamasında yanınızda olmak için beş ana alanda hizmet veriyoruz.' })}
    <div class="mt-14 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">${services.map(serviceCard).join('')}</div>
    <div class="mt-16 prose-cms max-w-3xl" data-reveal>
      <p>CMS Hafriyat İnşaat Nakliyat Ltd. Şti. olarak, güvene dayalı iş anlayışımız, çözüm odaklı yaklaşımımız ve kalite odaklı hizmetlerimizle bugün ve gelecekte iş ortaklarımız için değer üretmeye devam ediyoruz. Çalışmalarımızdan örnekleri <a href="/projeler/">yaptığımız işler</a> sayfasında inceleyebilir, sektörel rehberlerimize <a href="/blog/">blog</a> bölümümüzden ulaşabilirsiniz.</p>
    </div>
  </div>
</section>
${ctaBand({ title: 'Birlikte Değer Üretelim', scene: 'hafriyat' })}`;
  return {
    path: '/hakkimizda/',
    title: 'Hakkımızda | CMS Hafriyat İnşaat Nakliyat',
    description: 'CMS Hafriyat İnşaat Nakliyat Ltd. Şti. misyonu, vizyonu ve değerleri. Güven, kalite ve güçlü iş ortaklığıyla projelerinize değer katıyoruz.',
    keywords: 'CMS Hafriyat hakkında, hafriyat firması, inşaat nakliyat şirketi, misyon, vizyon, kurumsal değerler',
    h1: 'Hakkımızda', ogImage: '/assets/img/og/insaat.jpg',
    crumbs: crumb({ name: 'Hakkımızda', path: '/hakkimizda/' }),
    schemaType: 'AboutPage', body,
  };
}

// ---------------------------------------------------------------- HİZMETLER
export function servicesHub({ services }) {
  const body = `
${pageHero({ h1: 'Hizmetlerimiz', lead: 'Hafriyat, iş makineleri, inşaat ve taahhüt, nakliye ve ihracat alanlarında planlı, güvenilir ve kalite odaklı çözümler.', scene: 'makine', kicker: 'Uçtan Uca Çözümler', crumbs: crumb({ name: 'Hizmetlerimiz', path: '/hizmetler/' }) })}
<section class="section">
  <div class="container-x">
    ${sectionHead({ kicker: 'Faaliyet Alanlarımız', title: 'Projenizin Her Aşamasında Yanınızdayız', text: 'Her hizmetimizi keşif, planlama, uygulama ve teslim adımlarıyla aynı disiplinle yürütüyoruz. İhtiyacınıza uygun hizmeti seçerek detayları inceleyebilirsiniz.' })}
    <div class="mt-14 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">${services.map(serviceCard).join('')}</div>
  </div>
</section>
${services.map((s, i) => `<section class="section ${i % 2 ? 'bg-slate-50' : ''}" aria-labelledby="hz-${s.slug}">
  <div class="container-x grid gap-12 lg:grid-cols-2 items-center">
    <div class="relative rounded-3xl overflow-hidden shadow-xl aspect-video ${i % 2 ? 'lg:order-2' : ''}" data-reveal="${i % 2 ? 'right' : 'left'}">
      ${video(s.scene, `${s.name} videosu`, { cls: 'absolute inset-0 w-full h-full object-cover' })}
    </div>
    <div data-reveal>
      <p class="kicker">0${i + 1} — ${esc(s.name)}</p>
      <h2 id="hz-${s.slug}" class="mt-3 font-display text-4xl font-extrabold uppercase text-ink-900">${esc(s.h1)}</h2>
      <p class="mt-5 text-lg text-ink-600 leading-relaxed">${esc(s.lead)}</p>
      <ul class="mt-6 grid sm:grid-cols-2 gap-3">${s.highlights.map((h) => `<li class="flex items-center gap-2 font-medium text-ink-800"><span class="text-brand-600">${icon('check', 'w-5 h-5')}</span>${esc(h)}</li>`).join('')}</ul>
      <a href="/hizmetler/${s.slug}/" class="btn-dark mt-8">${esc(s.name)} Detayları ${icon('arrow', 'w-5 h-5')}</a>
    </div>
  </div>
</section>`).join('')}
${ctaBand()}`;
  return {
    path: '/hizmetler/',
    title: 'Hizmetlerimiz | Hafriyat, İnşaat ve Nakliye',
    description: 'Hafriyat, iş makineleri, inşaat ve taahhüt, nakliye ve ihracat hizmetlerimizi inceleyin. Planlı, güvenli ve kalite odaklı çözümler sunuyoruz.',
    keywords: 'hafriyat hizmetleri, iş makinesi kiralama, inşaat taahhüt, nakliye hizmeti, ihracat, kazı işleri',
    h1: 'Hizmetlerimiz', ogImage: '/assets/img/og/makine.jpg',
    crumbs: crumb({ name: 'Hizmetlerimiz', path: '/hizmetler/' }),
    schemaType: 'CollectionPage',
    extraSchema: [{ '@type': 'ItemList', itemListElement: services.map((s, i) => ({ '@type': 'ListItem', position: i + 1, url: abs(`/hizmetler/${s.slug}/`), name: s.h1 })) }],
    body,
  };
}

export function serviceDetail(s, { services, posts }) {
  const path = `/hizmetler/${s.slug}/`;
  const crumbs = crumb({ name: 'Hizmetlerimiz', path: '/hizmetler/' }, { name: s.name, path });
  const { html, toc } = withToc(s.sections);
  const related = s.related.map((r) => services.find((x) => x.slug === r)).filter(Boolean);
  const relPosts = posts.filter((p) => (p.relatedServices || []).includes(s.slug)).slice(0, 3);
  const body = `
${pageHero({ h1: s.h1, lead: s.lead, scene: s.scene, kicker: s.name, crumbs, meta: `<div class="mt-10 flex flex-wrap gap-4" data-reveal style="--d:.25s"><a href="/iletisim/" class="btn-primary">${icon('mail', 'w-5 h-5')} Teklif Al</a><a href="${waLink(`Merhaba, ${s.name} hizmeti hakkında bilgi almak istiyorum.`)}" target="_blank" rel="noopener" class="btn-wa">${icon('whatsapp', 'w-5 h-5')} WhatsApp</a></div>` })}
<section class="bg-brand-500">
  <div class="container-x grid grid-cols-2 lg:grid-cols-4">
    ${s.highlights.map((h, i) => `<div class="flex items-center gap-3 py-6 px-2 font-bold text-ink-950" data-reveal style="--d:${i * 0.06}s">${icon('check', 'w-6 h-6 shrink-0')} ${esc(h)}</div>`).join('')}
  </div>
</section>
<section class="section">
  <div class="container-x grid gap-14 lg:grid-cols-[1fr_340px]">
    <article class="prose-cms" data-reveal>
      ${html}
    </article>
    <aside class="space-y-6 lg:sticky lg:top-28 self-start" aria-label="Yan menü">
      <nav class="side-card" aria-label="İçindekiler"><p class="side-title">Bu Sayfada</p><ol class="space-y-2 text-sm">${toc.map((t) => `<li><a href="#${t.id}" class="toc-link">${esc(t.text)}</a></li>`).join('')}<li><a href="#surec" class="toc-link">Çalışma Süreci</a></li><li><a href="#sss" class="toc-link">Sıkça Sorulan Sorular</a></li></ol></nav>
      <nav class="side-card" aria-label="Diğer hizmetler"><p class="side-title">Hizmetlerimiz</p><ul class="space-y-1">${services.map((x) => `<li><a href="/hizmetler/${x.slug}/" class="side-link ${x.slug === s.slug ? 'is-active' : ''}"${x.slug === s.slug ? ' aria-current="page"' : ''}>${icon(x.icon, 'w-5 h-5')} ${esc(x.name)}</a></li>`).join('')}</ul></nav>
      <div class="side-card !bg-ink-950 text-white"><p class="side-title !text-brand-400">Hemen Ulaşın</p><p class="text-slate-300 text-sm">Keşif ve teklif için bize yazın ya da arayın.</p>
        <a href="tel:${site.phone}" class="mt-4 flex items-center gap-2 font-bold text-lg">${icon('phone', 'w-5 h-5 text-brand-400')} ${site.phoneDisplay}</a>
        <a href="${waLink(`Merhaba, ${s.name} hizmeti için teklif almak istiyorum.`)}" target="_blank" rel="noopener" class="btn-wa w-full justify-center mt-4">${icon('whatsapp', 'w-5 h-5')} WhatsApp'tan Yaz</a></div>
    </aside>
  </div>
</section>
<section id="surec" class="section bg-slate-50">
  <div class="container-x">
    ${sectionHead({ kicker: 'Çalışma Süreci', title: `${esc(s.name)} Sürecimiz Nasıl İşler?` })}
    <ol class="mt-14 grid gap-8 md:grid-cols-2 lg:grid-cols-4 process">
      ${s.process.map((p, i) => `<li class="process-step" data-reveal style="--d:${i * 0.1}s"><span class="process-num">0${i + 1}</span><h3 class="mt-4 text-xl font-bold text-ink-900">${esc(p.title)}</h3><p class="mt-2 text-ink-600 leading-relaxed">${esc(p.text)}</p></li>`).join('')}
    </ol>
  </div>
</section>
<section id="sss" class="section">
  <div class="container-x grid gap-14 lg:grid-cols-[1fr_1.4fr]">
    ${sectionHead({ kicker: 'SSS', title: `${esc(s.name)} Hakkında Sorular`, text: 'Daha fazla soru için <a href="/sss/" class="link">Sıkça Sorulan Sorular</a> sayfamızı ziyaret edebilirsiniz.' })}
    ${faqList(s.faqs, { idPrefix: `${s.slug}-sss` })}
  </div>
</section>
${relPosts.length ? `<section class="section bg-slate-50"><div class="container-x">${sectionHead({ kicker: 'İlgili Rehberler', title: 'Konuyla İlgili Yazılar' })}<div class="mt-12 grid gap-8 md:grid-cols-2 lg:grid-cols-3">${relPosts.map(postCard).join('')}</div></div></section>` : ''}
<section class="section"><div class="container-x">${sectionHead({ kicker: 'Diğer Hizmetler', title: 'Bunlar da İlginizi Çekebilir' })}<div class="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">${related.map(serviceCard).join('')}</div></div></section>
${ctaBand({ title: `${s.name} İçin Teklif Alın`, scene: s.scene })}`;
  return {
    path, title: s.title, description: s.description, keywords: s.keywords, h1: s.h1,
    ogImage: `/assets/img/og/${s.scene}.jpg`, crumbs, schemaType: 'WebPage',
    extraSchema: [
      { '@type': 'Service', name: s.h1, serviceType: s.name, description: s.description, provider: { '@id': ORG_ID }, areaServed: { '@type': 'Country', name: 'Türkiye' }, url: abs(path), image: abs(`/assets/img/${s.scene}.webp`) },
      faqSchema(s.faqs),
      videoSchema(s.scene, `${s.name} - CMS Hafriyat`, s.summary),
    ],
    body,
  };
}

// ---------------------------------------------------------------- PROJELER
export function projects({ services, projectList }) {
  const scenes = [
    ['hafriyat', 'Hafriyat ve Temel Kazısı', 'Ekskavatör ile kontrollü kazı ve damperli kamyona yükleme operasyonu.', 'hafriyat'],
    ['insaat', 'İnşaat ve Kaba Yapı', 'Kule vinç destekli betonarme karkas ve beton döküm çalışmaları.', 'insaat-taahhut'],
    ['nakliye', 'Hafriyat ve Malzeme Nakliyesi', 'Yüklü damperli kamyonlarla planlı ve güvenli taşıma.', 'nakliye'],
    ['makine', 'İş Makineleri Operasyonları', 'Loder ve dozer ile malzeme yükleme ve saha düzenleme.', 'is-makineleri'],
    ['ihracat', 'İhracat Lojistiği', 'Liman sahasında konteyner yükleme ve sevkiyat koordinasyonu.', 'ihracat'],
  ];
  const cats = [{ k: 'all', n: 'Tümü' }, ...services.map((s) => ({ k: s.slug, n: s.name }))];
  const real = projectList.length
    ? `<div class="mt-14 grid gap-8 md:grid-cols-2 lg:grid-cols-3">${projectList.map((p, i) => `<article class="post-card" data-reveal style="--d:${(i % 3) * 0.08}s" data-category="${p.service}">
        <div class="aspect-[4/3] overflow-hidden"><img src="${p.image}" alt="${esc(p.title)}" loading="lazy" class="w-full h-full object-cover" width="1200" height="900"></div>
        <div class="p-6"><p class="kicker">${esc(p.location || '')} ${p.year ? '· ' + p.year : ''}</p><h3 class="mt-2 text-xl font-bold">${esc(p.title)}</h3><p class="mt-2 text-ink-600">${esc(p.text || '')}</p></div></article>`).join('')}</div>`
    : `<div class="mt-12 rounded-3xl border-2 border-dashed border-slate-300 p-10 text-center" data-reveal><p class="text-lg text-ink-600 max-w-2xl mx-auto">Tamamlanan projelerimize ait fotoğraf ve detaylar çok yakında bu bölümde yayınlanacak. Devam eden çalışmalarımız hakkında bilgi almak için <a class="link" href="/iletisim/">bizimle iletişime geçin</a>.</p></div>`;
  const body = `
${pageHero({ h1: 'Yaptığımız İşler', lead: 'Hafriyat, inşaat, nakliye, iş makineleri ve ihracat alanlarındaki çalışmalarımızdan görüntüler ve proje örnekleri.', scene: 'hafriyat', kicker: 'Projeler & Saha', crumbs: crumb({ name: 'Yaptığımız İşler', path: '/projeler/' }) })}
<section class="section">
  <div class="container-x">
    ${sectionHead({ kicker: 'Faaliyet Videoları', title: 'Sahada Neler Yapıyoruz?', text: 'Her faaliyet alanımızda iş akışını kısa videolarla görün. İlgili hizmet sayfasından detaylı bilgiye ulaşabilirsiniz.' })}
    <div class="mt-10 flex flex-wrap gap-2" role="toolbar" aria-label="Kategori filtresi" data-filter-group="projects">
      ${cats.map((c, i) => `<button class="filter-btn${i === 0 ? ' is-active' : ''}" data-filter="${c.k}" aria-pressed="${i === 0}">${esc(c.n)}</button>`).join('')}
    </div>
    <div class="mt-10 grid gap-8 md:grid-cols-2" data-filter-target="projects">
      ${scenes.map(([sc, t, d, svc], i) => `<figure class="project-card group" data-reveal style="--d:${(i % 2) * 0.08}s" data-category="${svc}">
        <div class="relative aspect-video overflow-hidden rounded-2xl">${video(sc, t, { cls: 'absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-105' })}
          <span class="absolute top-4 left-4 px-3 py-1 rounded-full bg-ink-950/70 text-white text-xs font-semibold backdrop-blur">${icon('play', 'w-3 h-3 inline -mt-0.5')} Video</span></div>
        <figcaption class="pt-5"><h3 class="text-2xl font-display font-bold uppercase text-ink-900">${t}</h3><p class="mt-2 text-ink-600">${d}</p>
          <a href="/hizmetler/${svc}/" class="mt-3 inline-flex items-center gap-2 font-semibold text-brand-700">Hizmeti İncele ${icon('arrow', 'w-4 h-4')}</a></figcaption>
      </figure>`).join('')}
    </div>
  </div>
</section>
<section class="section bg-slate-50">
  <div class="container-x">
    ${sectionHead({ kicker: 'Proje Galerisi', title: 'Tamamlanan Projeler' })}
    ${real}
  </div>
</section>
${ctaBand({ title: 'Sıradaki Proje Sizinki Olsun', scene: 'insaat' })}`;
  return {
    path: '/projeler/',
    title: 'Yaptığımız İşler ve Projeler | CMS Hafriyat',
    description: 'Hafriyat, inşaat, nakliye, iş makineleri ve ihracat alanında yaptığımız işleri videolarla inceleyin. CMS Hafriyat sahada nasıl çalışıyor görün.',
    keywords: 'hafriyat projeleri, inşaat projeleri, yaptığımız işler, iş makineleri, nakliye, CMS Hafriyat referans',
    h1: 'Yaptığımız İşler', ogImage: '/assets/img/og/hafriyat.jpg',
    crumbs: crumb({ name: 'Yaptığımız İşler', path: '/projeler/' }),
    schemaType: 'CollectionPage',
    extraSchema: scenes.map(([sc, t, d]) => videoSchema(sc, `${t} - CMS Hafriyat`, d)),
    body,
  };
}

// ---------------------------------------------------------------- BLOG / HABERLER
function listing({ path, title, description, keywords, h1, lead, kicker, items, scene, crumbs, tabs }) {
  const body = `
${pageHero({ h1, lead, scene, kicker, crumbs })}
<section class="section">
  <div class="container-x">
    ${tabs}
    <div class="mt-10 grid gap-8 md:grid-cols-2 lg:grid-cols-3">${items.map(postCard).join('')}</div>
  </div>
</section>
${ctaBand({ scene: 'insaat' })}`;
  return {
    path, title, description, keywords, h1, crumbs, ogImage: `/assets/img/og/${scene}.jpg`, schemaType: 'CollectionPage',
    extraSchema: [{ '@type': 'ItemList', itemListElement: items.map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: abs(p.path), name: p.h1 })) }],
    body,
  };
}

const tabs = (active) => `<nav class="flex flex-wrap gap-2" aria-label="Yazı kategorileri">
  <a href="/blog/" class="filter-btn${active === 'blog' ? ' is-active' : ''}"${active === 'blog' ? ' aria-current="page"' : ''}>Blog & Rehberler</a>
  <a href="/haberler/" class="filter-btn${active === 'haber' ? ' is-active' : ''}"${active === 'haber' ? ' aria-current="page"' : ''}>Haberler & Duyurular</a>
</nav>`;

export function blogHub({ posts }) {
  return listing({
    path: '/blog/',
    title: 'Blog: Hafriyat ve İnşaat Rehberleri | CMS Hafriyat',
    description: 'Hafriyat süreci, iş makinesi seçimi, zemin etüdü ve inşaat planlaması üzerine uzman rehberler. CMS Hafriyat blogunda faydalı bilgiler sizi bekliyor.',
    keywords: 'hafriyat blog, inşaat rehberi, iş makinesi seçimi, zemin etüdü, hafriyat süreci, inşaat planlama',
    h1: 'Blog & Rehberler', kicker: 'Bilgi Merkezi',
    lead: 'Hafriyat, iş makineleri, nakliye ve inşaat süreçlerine dair pratik rehberler ve uzman önerileri.',
    items: posts.filter((p) => p.type === 'blog'), scene: 'makine',
    crumbs: crumb({ name: 'Blog', path: '/blog/' }), tabs: tabs('blog'),
  });
}

export function newsHub({ posts }) {
  return listing({
    path: '/haberler/',
    title: 'Haberler ve Duyurular | CMS Hafriyat',
    description: 'CMS Hafriyat İnşaat Nakliyat\'tan güncel haberler, kurumsal duyurular ve yenilikler. Firmamızdaki gelişmeleri bu sayfadan takip edebilirsiniz.',
    keywords: 'CMS Hafriyat haberler, duyurular, kurumsal haberler, hafriyat firması haberleri, inşaat haberleri',
    h1: 'Haberler & Duyurular', kicker: 'Kurumsal',
    lead: 'Firmamızdan güncel gelişmeler, duyurular ve kurumsal haberler.',
    items: posts.filter((p) => p.type === 'haber'), scene: 'ihracat',
    crumbs: crumb({ name: 'Blog', path: '/blog/' }, { name: 'Haberler', path: '/haberler/' }), tabs: tabs('haber'),
  });
}

export function postDetail(p, { services, posts }) {
  const hub = p.type === 'haber' ? { name: 'Haberler', path: '/haberler/' } : { name: 'Blog', path: '/blog/' };
  const crumbs = p.type === 'haber'
    ? crumb({ name: 'Blog', path: '/blog/' }, hub, { name: p.h1, path: p.path })
    : crumb(hub, { name: p.h1, path: p.path });
  const { html, toc } = withToc(p.body);
  const wc = words(p.body);
  const mins = Math.max(2, Math.round(wc / 200));
  const rel = (p.relatedServices || []).map((r) => services.find((s) => s.slug === r)).filter(Boolean);
  const more = posts.filter((x) => x.slug !== p.slug).sort((a, b) => (a.type === p.type ? -1 : 1) - (b.type === p.type ? -1 : 1)).slice(0, 3);
  const meta = `<div class="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-slate-300" data-reveal style="--d:.2s">
    <span class="px-3 py-1 rounded-full bg-brand-500 text-ink-950 font-bold">${esc(p.category)}</span>
    <span class="inline-flex items-center gap-2">${icon('calendar', 'w-4 h-4')} <time datetime="${p.date}">${trDate(p.date)}</time></span>
    <span class="inline-flex items-center gap-2">${icon('clock', 'w-4 h-4')} ${mins} dk okuma</span>
    <span>Yazar: ${esc(site.author)}</span></div>`;
  const body = `
${pageHero({ h1: p.h1, lead: p.excerpt, scene: p.slug, blog: true, crumbs, meta })}
<div class="section">
  <div class="container-x grid gap-14 lg:grid-cols-[1fr_320px]">
    <article class="min-w-0">
      <div class="prose-cms" data-reveal>${html}</div>
      ${p.faqs && p.faqs.length ? `<section class="mt-16" aria-labelledby="yazi-sss"><h2 id="yazi-sss" class="font-display text-3xl font-extrabold uppercase text-ink-900">Sıkça Sorulan Sorular</h2><div class="mt-6">${faqList(p.faqs, { idPrefix: `${p.slug}-sss` })}</div></section>` : ''}
      <div class="mt-12 pt-8 border-t border-slate-200">${shareBar(abs(p.path), p.h1)}</div>
    </article>
    <aside class="space-y-6 lg:sticky lg:top-28 self-start" aria-label="Yan menü">
      ${toc.length ? `<nav class="side-card" aria-label="İçindekiler"><p class="side-title">İçindekiler</p><ol class="space-y-2 text-sm">${toc.map((t) => `<li><a href="#${t.id}" class="toc-link">${esc(t.text)}</a></li>`).join('')}</ol></nav>` : ''}
      ${rel.length ? `<nav class="side-card" aria-label="İlgili hizmetler"><p class="side-title">İlgili Hizmetler</p><ul class="space-y-1">${rel.map((x) => `<li><a href="/hizmetler/${x.slug}/" class="side-link">${icon(x.icon, 'w-5 h-5')} ${esc(x.name)}</a></li>`).join('')}</ul></nav>` : ''}
      <div class="side-card !bg-ink-950 text-white"><p class="side-title !text-brand-400">Sorunuz mu Var?</p><p class="text-slate-300 text-sm">Uzman ekibimiz ya da yapay zeka asistanımız yardımcı olsun.</p>
        <button class="btn-primary w-full justify-center mt-4 !py-3" data-open-chat>${icon('bot', 'w-5 h-5')} Asistana Sor</button>
        <a href="${waLink()}" target="_blank" rel="noopener" class="btn-wa w-full justify-center mt-3 !py-3">${icon('whatsapp', 'w-5 h-5')} WhatsApp</a></div>
    </aside>
  </div>
</div>
<section class="section bg-slate-50"><div class="container-x">${sectionHead({ kicker: 'Okumaya Devam Edin', title: 'Diğer Yazılar' })}<div class="mt-12 grid gap-8 md:grid-cols-2 lg:grid-cols-3">${more.map(postCard).join('')}</div></div></section>
${ctaBand({ scene: p.scene })}`;
  const type = p.type === 'haber' ? 'NewsArticle' : 'BlogPosting';
  return {
    path: p.path, title: p.title, description: p.description, keywords: p.keywords, h1: p.h1,
    ogImage: `/assets/img/og/${p.scene}.jpg`, preloadImage: `/assets/img/blog/${p.slug}.webp`, crumbs, ogType: 'article',
    article: { published: `${p.date}T09:00:00+03:00`, modified: `${p.updated || p.date}T09:00:00+03:00`, section: p.category },
    schemaType: 'WebPage',
    extraSchema: [
      {
        '@type': type, '@id': `${abs(p.path)}#yazi`, headline: p.h1, description: p.description, image: [abs(`/assets/img/blog/${p.slug}.webp`)],
        datePublished: `${p.date}T09:00:00+03:00`, dateModified: `${p.updated || p.date}T09:00:00+03:00`,
        author: { '@type': 'Organization', name: site.author, url: `${site.url}/` }, publisher: { '@id': ORG_ID },
        mainEntityOfPage: { '@id': `${abs(p.path)}#sayfa` }, inLanguage: 'tr-TR', wordCount: wc, articleSection: p.category, keywords: p.keywords,
      },
      ...(p.faqs && p.faqs.length ? [faqSchema(p.faqs)] : []),
    ],
    body,
  };
}

// ---------------------------------------------------------------- İLETİŞİM
export function contact({ services }) {
  const body = `
${pageHero({ h1: 'İletişim ve Teklif Al', lead: 'Projeniz için keşif ve teklif talep edin. Formu doldurun, arayın ya da WhatsApp üzerinden hemen yazın.', scene: 'nakliye', kicker: 'Bize Ulaşın', crumbs: crumb({ name: 'İletişim', path: '/iletisim/' }) })}
<section class="section">
  <div class="container-x grid gap-14 lg:grid-cols-[1fr_1.3fr]">
    <div>
      ${sectionHead({ kicker: 'İletişim Kanalları', title: 'Size Nasıl Yardımcı Olabiliriz?', text: 'Hafriyat, iş makineleri, inşaat, nakliye veya ihracat ile ilgili tüm sorularınız için bize dilediğiniz kanaldan ulaşabilirsiniz.' })}
      <div class="mt-10 grid gap-4">
        <a href="tel:${site.phone}" class="contact-card" data-reveal><span class="feature-icon">${icon('phone', 'w-6 h-6')}</span><span><span class="block text-sm text-ink-500">Telefon</span><span class="block text-xl font-bold text-ink-900">${site.phoneDisplay}</span></span></a>
        <a href="${waLink()}" target="_blank" rel="noopener" class="contact-card" data-reveal style="--d:.06s"><span class="feature-icon !bg-[#25D366] !text-white">${icon('whatsapp', 'w-6 h-6')}</span><span><span class="block text-sm text-ink-500">WhatsApp</span><span class="block text-xl font-bold text-ink-900">Hemen Yazın</span></span></a>
        <a href="mailto:${site.email}" class="contact-card" data-reveal style="--d:.12s"><span class="feature-icon">${icon('mail', 'w-6 h-6')}</span><span class="min-w-0"><span class="block text-sm text-ink-500">E-posta</span><span class="block text-lg font-bold text-ink-900 break-all">${site.email}</span></span></a>
        <button data-open-chat class="contact-card text-left" data-reveal style="--d:.18s"><span class="feature-icon">${icon('bot', 'w-6 h-6')}</span><span><span class="block text-sm text-ink-500">Yapay Zeka Asistanı</span><span class="block text-xl font-bold text-ink-900">7/24 Soru Sorun</span></span></button>
        <a href="${site.mapLink}" target="_blank" rel="noopener" class="contact-card" data-reveal style="--d:.24s"><span class="feature-icon">${icon('pin', 'w-6 h-6')}</span><span><span class="block text-sm text-ink-500">Adres</span><address class="not-italic block font-bold text-ink-900 leading-snug">${esc(site.address.display)}</address></span></a>
      </div>
    </div>
    <div class="rounded-3xl bg-slate-50 p-6 md:p-10 shadow-sm ring-1 ring-slate-200" data-reveal="right">
      <h2 class="font-display text-3xl font-extrabold uppercase text-ink-900">Teklif Formu</h2>
      <p class="mt-2 text-ink-600">Formu doldurun, en kısa sürede size dönüş yapalım.</p>
      <form id="contact-form" class="mt-8 grid gap-5 sm:grid-cols-2" action="/api/contact.php" method="post" novalidate>
        <div class="sm:col-span-1"><label for="f-name" class="form-label">Ad Soyad *</label><input id="f-name" name="name" required autocomplete="name" class="form-input"></div>
        <div class="sm:col-span-1"><label for="f-phone" class="form-label">Telefon *</label><input id="f-phone" name="phone" type="tel" required autocomplete="tel" class="form-input" placeholder="05xx xxx xx xx"></div>
        <div class="sm:col-span-1"><label for="f-email" class="form-label">E-posta</label><input id="f-email" name="email" type="email" autocomplete="email" class="form-input"></div>
        <div class="sm:col-span-1"><label for="f-service" class="form-label">Hizmet</label><select id="f-service" name="service" class="form-input"><option value="">Seçiniz</option>${services.map((s) => `<option>${esc(s.name)}</option>`).join('')}<option>Diğer</option></select></div>
        <div class="sm:col-span-2"><label for="f-msg" class="form-label">Mesajınız *</label><textarea id="f-msg" name="message" rows="5" required class="form-input" placeholder="Projenizin konumu, kapsamı ve zamanlaması hakkında kısa bilgi..."></textarea></div>
        <div class="hidden" aria-hidden="true"><label>Web sitesi<input name="website" tabindex="-1" autocomplete="off"></label></div>
        <label class="sm:col-span-2 flex items-start gap-3 text-sm text-ink-600"><input type="checkbox" name="kvkk" required class="mt-1 w-4 h-4 accent-brand-500"> <span><a href="/kvkk/" class="link" target="_blank">KVKK Aydınlatma Metni</a>'ni okudum, kişisel verilerimin talebimin yanıtlanması amacıyla işlenmesini kabul ediyorum.</span></label>
        <div class="sm:col-span-2 flex flex-wrap items-center gap-4"><button class="btn-primary" type="submit">${icon('send', 'w-5 h-5')} Gönder</button><p id="form-status" class="text-sm font-semibold" role="status"></p></div>
      </form>
    </div>
  </div>
</section>
<section class="section bg-slate-50" aria-labelledby="harita-baslik">
  <div class="container-x">
    ${sectionHead({ kicker: 'Konum', title: '<span id="harita-baslik">Ofisimiz Adana Çukurova\'da</span>', text: `${esc(site.address.display)}` })}
    <div class="mt-10 overflow-hidden rounded-3xl shadow-xl ring-1 ring-slate-200 aspect-[4/3] md:aspect-[21/9]" data-reveal>
      <iframe src="${site.mapEmbed}" title="CMS Hafriyat ofis konumu - Google Haritalar" class="w-full h-full border-0" loading="lazy" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>
    </div>
    <div class="mt-6 flex flex-wrap gap-3"><a href="${site.mapLink}" target="_blank" rel="noopener" class="btn-dark">${icon('pin', 'w-5 h-5')} Yol Tarifi Al</a></div>
  </div>
</section>
<section class="section"><div class="container-x grid gap-14 lg:grid-cols-[1fr_1.4fr]">
  ${sectionHead({ kicker: 'SSS', title: 'İletişim Öncesi Merak Edilenler' })}
  ${faqList(GENERAL_FAQS.slice(1, 4), { idPrefix: 'iletisim-sss' })}
</div></section>`;
  return {
    path: '/iletisim/',
    title: 'İletişim ve Teklif Al | CMS Hafriyat',
    description: 'CMS Hafriyat iletişim: Toros Mah. Çukurova/Adana, 0533 500 37 79, WhatsApp ve e-posta. Hafriyat ve inşaat işleriniz için teklif alın.',
    keywords: 'CMS Hafriyat iletişim, Adana hafriyat, Çukurova hafriyat, hafriyat teklif, inşaat teklif al, hafriyat telefon',
    h1: 'İletişim', ogImage: '/assets/img/og/nakliye.jpg',
    crumbs: crumb({ name: 'İletişim', path: '/iletisim/' }), schemaType: 'ContactPage', body,
  };
}

// ---------------------------------------------------------------- SSS
export function faqPage({ services }) {
  const body = `
${pageHero({ h1: 'Sıkça Sorulan Sorular', lead: 'Hizmetlerimiz, çalışma sürecimiz ve teklif adımları hakkında en çok merak edilen soruların yanıtları.', scene: 'makine', kicker: 'Yardım Merkezi', crumbs: crumb({ name: 'SSS', path: '/sss/' }) })}
<section class="section"><div class="container-x grid gap-14 lg:grid-cols-[1fr_1.6fr]">
  <div>${sectionHead({ kicker: 'Genel Sorular', title: 'Merak Ettikleriniz', text: 'Aradığınız yanıtı bulamazsanız yapay zeka asistanımıza sorabilir veya WhatsApp üzerinden ekibimize yazabilirsiniz.' })}
    <div class="mt-8 flex flex-wrap gap-3"><button class="btn-dark" data-open-chat>${icon('bot', 'w-5 h-5')} Asistana Sor</button><a href="${waLink()}" target="_blank" rel="noopener" class="btn-wa">${icon('whatsapp', 'w-5 h-5')} WhatsApp</a></div></div>
  ${faqList(GENERAL_FAQS, { idPrefix: 'genel' })}
</div></section>
<section class="section bg-slate-50"><div class="container-x">
  ${sectionHead({ kicker: 'Hizmete Özel Sorular', title: 'Hizmet Sayfalarındaki Sorular', text: 'Her hizmetimize özel sorular ve yanıtlar ilgili sayfalarda yer alıyor.' })}
  <div class="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-5">${services.map((s, i) => `<a href="/hizmetler/${s.slug}/#sss" class="feature-card group" data-reveal style="--d:${i * 0.06}s"><span class="feature-icon">${icon(s.icon, 'w-6 h-6')}</span><span class="mt-5 block text-lg font-bold text-ink-900 group-hover:text-brand-700">${esc(s.name)} SSS</span><span class="mt-1 block text-sm text-ink-500">${s.faqs.length} soru</span></a>`).join('')}</div>
</div></section>
${ctaBand()}`;
  return {
    path: '/sss/',
    title: 'Sıkça Sorulan Sorular | CMS Hafriyat',
    description: 'Hafriyat, inşaat, iş makineleri ve nakliye hizmetlerimiz hakkında sıkça sorulan sorular ve yanıtları. Teklif ve keşif süreci hakkında bilgi alın.',
    keywords: 'hafriyat sss, sıkça sorulan sorular, hafriyat teklif, inşaat soruları, nakliye soruları, iş makinesi',
    h1: 'Sıkça Sorulan Sorular', ogImage: '/assets/img/og/makine.jpg',
    crumbs: crumb({ name: 'SSS', path: '/sss/' }), schemaType: 'FAQPage', faqMain: GENERAL_FAQS, body,
  };
}

// ---------------------------------------------------------------- KVKK
export function kvkk() {
  const body = `
${pageHero({ h1: 'KVKK Aydınlatma Metni', lead: '6698 sayılı Kişisel Verilerin Korunması Kanunu kapsamında kişisel verilerinizin işlenmesine ilişkin bilgilendirme.', scene: 'insaat', videoBg: false, crumbs: crumb({ name: 'KVKK', path: '/kvkk/' }) })}
<section class="section"><div class="container-x"><div class="prose-cms max-w-3xl">
  <h2>Veri Sorumlusu</h2>
  <p>Bu aydınlatma metni, veri sorumlusu sıfatıyla <strong>${esc(site.legalName)}</strong> tarafından, 6698 sayılı Kişisel Verilerin Korunması Kanunu ("KVKK") uyarınca hazırlanmıştır.</p>
  <h2>İşlenen Kişisel Veriler</h2>
  <p>İletişim formu, e-posta, telefon, WhatsApp veya yapay zeka asistanı aracılığıyla bizimle paylaştığınız ad-soyad, telefon numarası, e-posta adresi ve mesaj içeriğiniz işlenebilir.</p>
  <h2>İşleme Amaçları</h2>
  <ul><li>Teklif ve bilgi taleplerinizin yanıtlanması,</li><li>Hizmet süreçlerinin planlanması ve yürütülmesi,</li><li>Yasal yükümlülüklerin yerine getirilmesi.</li></ul>
  <h2>Hukuki Sebep ve Toplama Yöntemi</h2>
  <p>Kişisel verileriniz; web sitemizdeki formlar ve dijital iletişim kanalları aracılığıyla elektronik ortamda, KVKK'nın 5. maddesinde belirtilen açık rıza, bir sözleşmenin kurulması veya ifasıyla doğrudan ilgili olması ve meşru menfaat hukuki sebeplerine dayanılarak toplanmaktadır.</p>
  <h2>Aktarım</h2>
  <p>Kişisel verileriniz, yalnızca yukarıdaki amaçlarla sınırlı olarak ve mevzuata uygun şekilde; hizmet aldığımız barındırma, e-posta ve yapay zeka altyapı sağlayıcılarına aktarılabilir. Yapay zeka asistanına yazdığınız mesajlar yanıt üretilmesi amacıyla hizmet sağlayıcıya iletilir; bu nedenle asistana hassas kişisel veri paylaşmamanızı rica ederiz.</p>
  <h2>Haklarınız</h2>
  <p>KVKK'nın 11. maddesi kapsamında; kişisel verilerinizin işlenip işlenmediğini öğrenme, bilgi talep etme, düzeltilmesini veya silinmesini isteme ve diğer yasal haklarınızı kullanmak için <a href="mailto:${site.email}">${site.email}</a> adresine başvurabilirsiniz.</p>
  <h2>Çerezler</h2>
  <p>Web sitemiz reklam veya takip amaçlı çerez kullanmaz. Tarayıcınızın yerel depolama alanı yalnızca sohbet geçmişinin oturum süresince korunması gibi işlevsel amaçlarla kullanılır.</p>
</div></div></section>`;
  return {
    path: '/kvkk/',
    title: 'KVKK Aydınlatma Metni | CMS Hafriyat',
    description: 'CMS Hafriyat İnşaat Nakliyat Ltd. Şti. KVKK aydınlatma metni: kişisel verilerinizin hangi amaçla işlendiği ve haklarınız hakkında bilgi alın.',
    keywords: 'KVKK aydınlatma metni, kişisel veriler, gizlilik, CMS Hafriyat KVKK, veri sorumlusu',
    h1: 'KVKK Aydınlatma Metni', ogImage: '/assets/img/og/insaat.jpg',
    crumbs: crumb({ name: 'KVKK', path: '/kvkk/' }), schemaType: 'WebPage', body,
  };
}

// ---------------------------------------------------------------- 404
export function notFound() {
  const body = `<section class="relative min-h-[80vh] grid place-items-center bg-ink-950 text-white overflow-hidden">
  <div class="absolute inset-0 opacity-40">${video('hafriyat', 'Hafriyat videosu', { cls: 'w-full h-full object-cover' })}</div>
  <div class="relative text-center px-6 pt-24"><p class="font-display text-[9rem] leading-none font-extrabold text-brand-400">404</p>
    <h1 class="font-display text-4xl font-extrabold uppercase">Bu Sayfa Kazıda Kayboldu</h1>
    <p class="mt-4 text-slate-300 max-w-lg mx-auto">Aradığınız sayfa taşınmış veya kaldırılmış olabilir. Aşağıdaki bağlantılarla devam edebilirsiniz.</p>
    <div class="mt-8 flex flex-wrap justify-center gap-3"><a href="/" class="btn-primary">Ana Sayfa</a><a href="/hizmetler/" class="btn-ghost">Hizmetlerimiz</a><a href="/iletisim/" class="btn-ghost">İletişim</a></div></div>
</section>`;
  return {
    path: '/404.html', file: '404.html', noindex: true, skipSitemap: true,
    title: 'Sayfa Bulunamadı (404) | CMS Hafriyat',
    description: 'Aradığınız sayfa bulunamadı. CMS Hafriyat ana sayfası, hizmetlerimiz veya iletişim sayfası üzerinden aradığınız bilgiye kolayca ulaşabilirsiniz.',
    keywords: '404, sayfa bulunamadı, CMS Hafriyat',
    h1: 'Sayfa Bulunamadı', crumbs: [], schemaType: 'WebPage', body,
  };
}
