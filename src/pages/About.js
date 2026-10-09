import { Link } from 'react-router-dom';
import useReveal from '../hooks/useReveal';
import usePageTitle from '../hooks/usePageTitle';

const VALUES = [
  { icon: '✦', title: 'Estetik', text: 'Her piksel bir karar. Şablon değil, markaya özel tasarım dili.' },
  { icon: '⚡', title: 'Hız', text: 'Hızlı teslim, hızlı yüklenen site. Gecikme büyümenin düşmanıdır.' },
  { icon: '📊', title: 'Ölçülebilirlik', text: 'Her kampanya, her gönderi raporlanır. Tahmin değil, veri.' },
  { icon: '🤝', title: 'Şeffaflık', text: 'Reklam hesapları sizin adınıza; veri ve erişim hep sizde kalır.' },
];

const TEAM = [
  { initials: 'KO', role: 'Kurucu Ortak & Creative Director', text: 'Marka stratejisi, sanat yönetimi ve müşteri ilişkilerinin sahibi.' },
  { initials: 'TK', role: 'Tasarım & Kod', text: 'Web tasarımı, 3B/WebGL deneyimler ve performans optimizasyonu.' },
  { initials: 'SM', role: 'Sosyal Medya & İçerik', text: 'İçerik takvimi, Reels kurgusu ve topluluk yönetimi.' },
];

const TIMELINE = [
  { num: '01', title: 'Kuruluş', text: 'Exca Dijital, markaların dijitalde unutulmaz olması gerektiği inancıyla butik bir ekip olarak kuruldu.' },
  { num: '02', title: 'İlk Projeler', text: 'Web tasarım ve sosyal medya yönetimini tek çatı altında sunan uçtan uca bir hizmet modeli oluşturduk.' },
  { num: '03', title: '3D/WebGL Deneyimler', text: 'Şablon sitelerden ayrışmak isteyen markalar için gerçek zamanlı WebGL arka plan motorumuzu geliştirdik.' },
  { num: '04', title: 'Bugün', text: 'Web, sosyal medya, performans pazarlama, marka kimliği ve e-ticareti kapsayan tam kapsamlı bir dijital ekosistem sunuyoruz.' },
];

export default function About() {
  usePageTitle('Hakkımızda');
  useReveal();

  return (
    <div className="wrap">
      <section className="page-hero">
        <div className="breadcrumb" data-reveal>
          <Link to="/" data-hover>Ana Sayfa</Link> / Hakkımızda
        </div>
        <div className="sec-tag" data-reveal>Hakkımızda</div>
        <h1 data-reveal style={{ '--rd': '.06s' }}>Küçük ekip,<br /><b>büyük dokunuş.</b></h1>
        <p className="lede" data-reveal style={{ '--rd': '.12s' }}>
          Exca Dijital, markaların dijitalde görünür değil, unutulmaz olması
          gerektiğine inanan butik bir dijital ajans.
        </p>
      </section>

      <section className="block" style={{ paddingTop: 0 }}>
        <div className="about-grid">
          <div className="about-copy">
            <p data-reveal>
              Şablon site ve kopyala-yapıştır içerik çağında, her projeye
              sıfırdan düşünülmüş bir görsel dil ve strateji ile yaklaşıyoruz.
              <b> Estetik</b>, <b>hız</b> ve <b>ölçülebilir sonuç</b> işimizin
              merkezinde.
            </p>
            <div className="about-quote" data-reveal style={{ '--rd': '.1s' }}>
              "İyi tasarım fark edilir; harika tasarım hissedilir. Biz ikincisi
              için çalışıyoruz."
            </div>
            <p data-reveal style={{ '--rd': '.18s' }}>
              Bir işi teslim etmeden önce kendimize tek soru sorarız: "Bunu
              kendi markamız için yayınlar mıydık?" Cevap evet değilse,
              bitmemiştir. Bu yüzden her proje, kapsamı ne olursa olsun aynı
              titizlikle yürütülür.
            </p>
          </div>
          <div className="about-visual" data-reveal="right" style={{ '--rd': '.15s' }}>
            <div className="av-row">
              <span className="av-key">Odak</span>
              <span className="av-val">Tasarım + Performans</span>
            </div>
            <div className="av-row">
              <span className="av-key">Konum</span>
              <span className="av-val">Türkiye · Remote</span>
            </div>
            <div className="av-row">
              <span className="av-key">E-posta</span>
              <span className="av-val">kurumsal@excadijital.com.tr</span>
            </div>
            <div className="av-row">
              <span className="av-key">Instagram</span>
              <span className="av-val grad">@excadijital</span>
            </div>
            <div className="av-row">
              <span className="av-key">Durum</span>
              <span className="av-val" style={{ color: 'var(--c3)' }}>● Yeni projelere açık</span>
            </div>
          </div>
        </div>
      </section>

      <section className="block">
        <div className="sec-head">
          <div className="sec-tag" data-reveal>Değerlerimiz</div>
          <h2 data-reveal style={{ '--rd': '.06s' }}>Her projede<br /><b>aynı dört ilke.</b></h2>
        </div>
        <div className="value-grid">
          {VALUES.map((v, i) => (
            <div className="value-card" key={v.title} data-reveal style={{ '--rd': `${i * 0.06}s` }}>
              <div className="vi">{v.icon}</div>
              <h4>{v.title}</h4>
              <p>{v.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="block">
        <div className="sec-head">
          <div className="sec-tag" data-reveal>Ekip</div>
          <h2 data-reveal style={{ '--rd': '.06s' }}>Perde arkasında<br /><b>kim var?</b></h2>
          <p className="sec-lede" data-reveal style={{ '--rd': '.12s' }}>
            Butik yapımız sayesinde her projede doğrudan karar vericilerle
            çalışırsınız — aradan katman çıkmaz.
          </p>
        </div>
        <div className="team-grid">
          {TEAM.map((m, i) => (
            <div className="team-card" key={m.role} data-reveal style={{ '--rd': `${i * 0.08}s` }}>
              <div className="team-avatar">{m.initials}</div>
              <h3>{m.role}</h3>
              <p>{m.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="block">
        <div className="sec-head">
          <div className="sec-tag" data-reveal>Yolculuğumuz</div>
          <h2 data-reveal style={{ '--rd': '.06s' }}>Kısa bir<br /><b>zaman çizelgesi.</b></h2>
        </div>
        <div className="process-list">
          {TIMELINE.map((step, i) => (
            <div className="step" key={step.num} data-reveal style={{ '--rd': `${i * 0.06}s` }}>
              <span className="step-dot"></span>
              <span className="step-num">{step.num}</span>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="block">
        <div className="cta-band" data-reveal="zoom">
          <h2>Ekibimizle<br /><b>tanışmak ister misiniz?</b></h2>
          <p>Ücretsiz bir keşif görüşmesiyle başlayalım — projenizi dinleyip en doğru yol haritasını birlikte çizelim.</p>
          <div className="cta-row">
            <Link to="/iletisim" className="btn primary magnetic" data-hover>
              Görüşme ayarlayın <span className="arr">→</span>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
