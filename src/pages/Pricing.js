import { Link } from 'react-router-dom';
import useReveal from '../hooks/useReveal';
import usePageTitle from '../hooks/usePageTitle';

const PLANS = [
  {
    name: 'Başlangıç',
    desc: 'Dijitale yeni adım atan veya vitrinini yenilemek isteyen markalar için.',
    items: [
      { text: 'Tek sayfalık modern web sitesi', ok: true },
      { text: 'Mobil uyumlu tasarım', ok: true },
      { text: 'Temel SEO kurulumu', ok: true },
      { text: 'İletişim formu & WhatsApp bağlantısı', ok: true },
      { text: '3D / animasyonlu sahne', ok: false },
      { text: 'Aylık içerik yönetimi', ok: false },
    ],
    featured: false,
  },
  {
    name: 'Büyüme',
    badge: 'En Çok Tercih Edilen',
    desc: 'Web + sosyal medyayı tek elden yürütmek isteyen, büyüme hedefli markalar için.',
    items: [
      { text: 'Çok sayfalı kurumsal site', ok: true },
      { text: '3D / animasyonlu hero bölümü', ok: true },
      { text: 'Aylık Instagram içerik yönetimi', ok: true },
      { text: 'Reels kurgu (aylık plan dahilinde)', ok: true },
      { text: 'Aylık performans raporu', ok: true },
      { text: 'Reklam bütçesi yönetimi', ok: false },
    ],
    featured: true,
  },
  {
    name: 'Pro',
    desc: 'Satışı ölçeklemek isteyen e-ticaret ve hizmet markaları için tam kapsam.',
    items: [
      { text: 'Büyüme paketindeki her şey', ok: true },
      { text: 'Meta & Google Ads yönetimi', ok: true },
      { text: 'E-ticaret / dönüşüm optimizasyonu', ok: true },
      { text: 'AI görsel & video üretim hattı', ok: true },
      { text: 'Öncelikli destek', ok: true },
      { text: 'Üç ayda bir strateji toplantısı', ok: true },
    ],
    featured: false,
  },
];

export default function Pricing() {
  usePageTitle('Paketler');
  useReveal();

  return (
    <div className="wrap">
      <section className="page-hero">
        <div className="breadcrumb" data-reveal>
          <Link to="/" data-hover>Ana Sayfa</Link> / Paketler
        </div>
        <div className="sec-tag" data-reveal>Paketler</div>
        <h1 data-reveal style={{ '--rd': '.06s' }}>Net kapsam,<br /><b>sürprizsiz fiyat.</b></h1>
        <p className="lede" data-reveal style={{ '--rd': '.12s' }}>
          Her bütçeye uyan üç başlangıç noktası. Fiyatlar proje kapsamına göre
          netleşir — teklif almak ücretsizdir.
        </p>
      </section>

      <section className="block" style={{ paddingTop: 0 }}>
        <div className="pricing-grid">
          {PLANS.map((p, i) => (
            <div className={`plan${p.featured ? ' featured' : ''}`} key={p.name} data-reveal style={{ '--rd': `${i * 0.08}s` }}>
              {p.badge && <span className="plan-badge">{p.badge}</span>}
              <span className="plan-name">{p.name}</span>
              <div className="plan-price">Teklif Alın</div>
              <p className="plan-desc">{p.desc}</p>
              <ul>
                {p.items.map((it) => (
                  <li key={it.text} className={it.ok ? '' : 'na'}>{it.text}</li>
                ))}
              </ul>
              <Link to="/iletisim" className={`btn ${p.featured ? 'primary' : 'ghost'}`} data-hover>
                Bu paketi sor {p.featured && <span className="arr">→</span>}
              </Link>
            </div>
          ))}
        </div>
      </section>

      <section className="block">
        <div className="sec-head" style={{ textAlign: 'center', marginLeft: 'auto', marginRight: 'auto' }}>
          <div className="sec-tag" data-reveal style={{ justifyContent: 'center' }}>Nasıl Çalışıyoruz</div>
          <h2 data-reveal style={{ '--rd': '.06s' }}>Fiyat neden<br /><b>"Teklif Alın" diyor?</b></h2>
          <p className="sec-lede" data-reveal style={{ '--rd': '.12s' }}>
            Her markanın kapsamı farklı. Sabit bir rakam yerine, keşif
            görüşmesinden sonra yazılı ve netleşmiş bir fiyat teklifi
            sunuyoruz — sürpriz ek ücret yok.
          </p>
        </div>
      </section>

      <section className="block">
        <div className="cta-band" data-reveal="zoom">
          <h2>Hangi paket size uygun,<br /><b>birlikte bulalım.</b></h2>
          <p>Ücretsiz keşif görüşmesi talep edin, 24 saat içinde dönüş yapalım.</p>
          <div className="cta-row">
            <Link to="/iletisim" className="btn primary magnetic" data-hover>
              Teklif alın <span className="arr">→</span>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
