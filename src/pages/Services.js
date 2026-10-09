import { Link } from 'react-router-dom';
import useReveal from '../hooks/useReveal';
import usePageTitle from '../hooks/usePageTitle';

const SERVICES = [
  {
    num: '01',
    icon: '🌐',
    tag: 'Dijital Vitriniz',
    title: 'Web Tasarım & Geliştirme',
    text:
      'Sadece güzel değil; hızlı, mobil uyumlu ve satışa yönlendiren siteler kuruyoruz. Bu sitenin kendisi gibi gerçek zamanlı 3B/WebGL animasyonlu deneyimler de kapsam dahilinde.',
    items: [
      'Kurumsal site & landing page',
      '3D / animasyonlu hero bölümleri',
      'Hız ve SEO temelli kurulum',
      'Yönetim paneli & eğitim',
      'Çok sayfalı kurumsal mimari',
      'Erişilebilirlik (WCAG) kontrolleri',
    ],
  },
  {
    num: '02',
    icon: '📱',
    tag: 'Marka Vitrini',
    title: 'Sosyal Medya Yönetimi',
    text:
      'Akışınız markanızın vitrini. Planlı, estetik ve etkileşim odaklı bir Instagram varlığı inşa ediyoruz; çekimden yayına kadar uçtan uca.',
    items: [
      'Aylık içerik takvimi',
      'Görsel tasarım & feed düzeni',
      'Reels kurgu ve senaryo',
      'Topluluk yönetimi & raporlama',
      'Profesyonel kamera çekimi',
      'Drone çekimi',
    ],
  },
  {
    num: '03',
    icon: '🎯',
    tag: 'Veriyle Büyüme',
    title: 'Performans Pazarlama',
    text:
      'Reklam bütçeniz tahminle değil, veriyle yönetilsin. Meta ve Google tarafında dönüşüm odaklı kampanyalar kurup şeffaf şekilde raporluyoruz.',
    items: [
      'Meta Ads (Instagram / Facebook)',
      'Google Ads & remarketing',
      'Hedef kitle & A/B testleri',
      'Şeffaf aylık performans raporu',
      'Reklam hesabı sizin adınıza açılır',
      'Dönüşüm takibi kurulumu',
    ],
  },
  {
    num: '04',
    icon: '✦',
    tag: 'Kurumsal Kimlik',
    title: 'Marka Kimliği',
    text:
      'Logo bir başlangıç; kimlik bir bütün. Renk, tipografi ve ses tonuyla tutarlı, her kanalda tanınan bir marka evreni kuruyoruz.',
    items: [
      'Logo & logotype tasarımı',
      'Renk paleti & tipografi sistemi',
      'Kurumsal kimlik kılavuzu',
      'Sosyal medya şablon seti',
      'Kartvizit & kurumsal evrak tasarımı',
      'Marka sesi & ton rehberi',
    ],
  },
  {
    num: '05',
    icon: '🛒',
    tag: 'Satış Odaklı',
    title: 'E-Ticaret',
    text:
      'Ürününüz iyi; vitrini de öyle olsun. Kurulumdan dönüşüm optimizasyonuna kadar satan mağazalar tasarlıyoruz.',
    items: [
      'Mağaza kurulumu & tema özelleştirme',
      'Ürün sayfası optimizasyonu',
      'Ödeme & kargo entegrasyonları',
      'Dönüşüm (CRO) iyileştirmeleri',
      'Sepet terk etme kurgusu',
      'Stok & sipariş süreci danışmanlığı',
    ],
  },
  {
    num: '06',
    icon: '🎬',
    tag: 'Durduran İçerik',
    title: 'İçerik & Motion',
    text:
      'Kaydırırken durduran içerikler: AI destekli görsel üretim, video kurgu ve 3B animasyon ile markanızı hareketlendiriyoruz.',
    items: [
      'Reels & kısa video kurgusu',
      'AI görsel & video üretimi',
      '3B sahne ve motion tasarım',
      'Ürün çekimi yönlendirmesi',
      'Marka tanıtım filmi kurgusu',
      'Animasyonlu sosyal şablonlar',
    ],
  },
];

export default function Services() {
  usePageTitle('Hizmetler');
  useReveal();

  return (
    <div className="wrap">
      <section className="page-hero">
        <div className="breadcrumb" data-reveal>
          <Link to="/" data-hover>Ana Sayfa</Link> / Hizmetler
        </div>
        <div className="sec-tag" data-reveal>Hizmetler</div>
        <h1 data-reveal style={{ '--rd': '.06s' }}>Dijitalde ihtiyacınız olan<br /><b>her şey, tek yerde.</b></h1>
        <p className="lede" data-reveal style={{ '--rd': '.12s' }}>
          Parça parça hizmet almak yerine, birbiriyle konuşan bir dijital
          ekosistem kurun. Altı ana başlıkta uçtan uca çalışıyoruz.
        </p>
      </section>

      <section className="block" style={{ paddingTop: 0 }}>
        <div className="services-grid">
          {SERVICES.map((s, i) => (
            <article className="svc" key={s.num} data-reveal style={{ '--rd': `${(i % 3) * 0.08}s` }}>
              <span className="svc-num">{s.num}</span>
              <div className="svc-icon">{s.icon}</div>
              <h3>{s.title}</h3>
              <p>{s.text}</p>
              <ul>
                {s.items.slice(0, 4).map((it) => <li key={it}>{it}</li>)}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section className="block">
        <div className="sec-head">
          <div className="sec-tag" data-reveal>Detaylı Kapsam</div>
          <h2 data-reveal style={{ '--rd': '.06s' }}>Her hizmetin<br /><b>tam kapsamı.</b></h2>
        </div>
        {SERVICES.map((s) => (
          <div className="service-detail" key={s.num} data-reveal>
            <div>
              <div className="sd-icon">{s.icon}</div>
              <span className="sd-tag">{s.tag}</span>
              <h3>{s.title}</h3>
              <p className="sec-lede" style={{ marginTop: 10 }}>{s.text}</p>
            </div>
            <ul className="sd-list">
              {s.items.map((it) => <li key={it}>{it}</li>)}
            </ul>
          </div>
        ))}
      </section>

      <section className="block">
        <div className="cta-band" data-reveal="zoom">
          <h2>Hangi hizmet size uygun,<br /><b>birlikte netleştirelim.</b></h2>
          <p>Ücretsiz keşif görüşmesinde ihtiyacınızı dinleyip doğru kapsamı ve paketi önerelim.</p>
          <div className="cta-row">
            <Link to="/paketler" className="btn magnetic" data-hover>Paketleri inceleyin</Link>
            <Link to="/iletisim" className="btn primary magnetic" data-hover>
              Teklif alın <span className="arr">→</span>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
