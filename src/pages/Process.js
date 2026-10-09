import { Link } from 'react-router-dom';
import useReveal from '../hooks/useReveal';
import usePageTitle from '../hooks/usePageTitle';

const STEPS = [
  {
    num: 'Adım 01', title: 'Keşif & Referans',
    text: 'Markanızı, hedef kitlenizi ve rakiplerinizi dinliyoruz. Beğendiğiniz görsel yönü birlikte netleştirip projenin "brief"ini tek bir referans karesine indiriyoruz.',
    tools: ['Keşif Toplantısı', 'Pinterest', 'Moodboard'],
  },
  {
    num: 'Adım 02', title: 'Görsel Üretim',
    text: 'AI destekli görsel üretimle markanıza özgün, telifsiz ve tekrar edilemez görseller oluşturuyoruz. Şablon stok fotoğraflara veda.',
    tools: ['AI Görsel', 'Art Direction', '16:9 Çıktı'],
  },
  {
    num: 'Adım 03', title: 'Animasyon & Motion',
    text: 'Statik görseli yaşayan bir sahneye çeviriyoruz: video loop\'lar veya bu sitedeki gibi gerçek zamanlı WebGL animasyonları.',
    tools: ['Video AI', 'WebGL / Three.js', 'Seamless Loop'],
  },
  {
    num: 'Adım 04', title: 'Tasarım & Kod',
    text: 'Onaylanan yön koda dökülüyor. Hızlı, erişilebilir, her ekranda kusursuz ve arama motorlarının seveceği bir yapı kuruyoruz.',
    tools: ['HTML/CSS/JS', 'AI Builder', 'Responsive'],
  },
  {
    num: 'Adım 05', title: 'Cila & Test',
    text: 'Mikro etkileşimler, parallax, tipografi ayarı, hız optimizasyonu… "Neredeyse bitti" ile "yayınlanır" arasındaki farkı burada yaratıyoruz.',
    tools: ['UI Polish', 'Performans', 'Mobil Test'],
  },
  {
    num: 'Adım 06', title: 'Yayın & Büyüme',
    text: 'Alan adı bağlanır, site canlıya alınır. Sonrası mı? İçerik, reklam ve raporlamayla büyüme döngüsü başlar.',
    tools: ['Hosting', 'Domain', 'Analitik'],
  },
];

const SCENES = [
  { key: 'particles', title: 'Particle Field', text: 'Binlerce parçacık ışık çizgileriyle bağlanır. İmleç iter, tıklama halka halinde savurur.' },
  { key: 'waves', title: 'Wave Mesh', text: 'Sinüs gürültüsüyle dalgalanan okyanus. Tıkladığınız noktadan gerçek bir dalga halkası yayılır.' },
  { key: 'geometric', title: 'Constellation', text: 'Wireframe ikosahedron ve torus knot\'lar süzülür; şok dalgası hepsini merkezden dağıtır.' },
  { key: 'blobs', title: 'Metaballs', text: 'Raymarching ile eriyen organik küreler. İmleciniz bir blob — tıklayınca yeni bir blob doğar ve patlar.' },
  { key: 'galaxy', title: 'Galaxy', text: 'On binlerce yıldızlı sarmal galaksi. Tıklama çekirdeği parlatır; scroll içine dalar.' },
  { key: 'blackhole', title: 'Black Hole', text: 'Schwarzschild geodezikleriyle bükülen ışık: akresyon diski, foton halkası, doppler parlaması.' },
];

export default function Process() {
  usePageTitle('Süreç');
  useReveal();

  return (
    <div className="wrap">
      <section className="page-hero">
        <div className="breadcrumb" data-reveal>
          <Link to="/" data-hover>Ana Sayfa</Link> / Süreç
        </div>
        <div className="sec-tag" data-reveal>Süreç</div>
        <h1 data-reveal style={{ '--rd': '.06s' }}>Fikirden yayına<br /><b>6 adımda.</b></h1>
        <p className="lede" data-reveal style={{ '--rd': '.12s' }}>
          Her projede aynı disiplinli üretim hattını çalıştırıyoruz — AI
          araçları ve modern kod altyapısıyla, referanstan canlı yayına.
        </p>
      </section>

      <section className="block" style={{ paddingTop: 0 }}>
        <div className="process-list">
          {STEPS.map((step, i) => (
            <div className="step" key={step.num} data-reveal style={{ '--rd': `${i * 0.06}s` }}>
              <span className="step-dot"></span>
              <span className="step-num">{step.num}</span>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
              <div className="step-tools">
                {step.tools.map((t) => <span key={t}>{t}</span>)}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="block">
        <div className="sec-head">
          <div className="sec-tag" data-reveal>Canlı Demo</div>
          <h2 data-reveal style={{ '--rd': '.06s' }}>Bu sitenin arkasında<br /><b>altı evren dönüyor.</b></h2>
          <p className="sec-lede" data-reveal style={{ '--rd': '.12s' }}>
            Markanızın sitesine ekleyebileceğimiz gerçek zamanlı WebGL
            sahneleri — video yok, tamamı kod. Karta tıklayın, sağ alttaki
            panelden gezin ya da boş bir yere tıklayıp şok dalgasını deneyin.
          </p>
        </div>
        <div className="cards">
          {SCENES.map((s, i) => (
            <div className="card" data-goto={s.key} key={s.key} data-reveal style={{ '--rd': `${i * 0.05}s` }} data-hover>
              <h3><span>◆</span>{s.title}</h3>
              <p>{s.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="block">
        <div className="cta-band" data-reveal="zoom">
          <h2>Sürecimizi<br /><b>kendi projenizde görün.</b></h2>
          <p>Ücretsiz bir keşif görüşmesiyle başlayalım, yazılı kapsam ve teklifle devam edelim.</p>
          <div className="cta-row">
            <Link to="/iletisim" className="btn primary magnetic" data-hover>
              Keşif görüşmesi isteyin <span className="arr">→</span>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
