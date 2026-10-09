import { Link } from 'react-router-dom';
import useReveal from '../hooks/useReveal';
import usePageTitle from '../hooks/usePageTitle';
import useRotator from '../hooks/useRotator';
import Counter from '../components/Counter';
import Testimonials from '../components/Testimonials';

const SERVICES_PREVIEW = [
  { num: '01', icon: '🌐', title: 'Web Tasarım & Geliştirme', text: 'Sadece güzel değil; hızlı, mobil uyumlu ve satışa yönlendiren siteler.' },
  { num: '02', icon: '📱', title: 'Sosyal Medya Yönetimi', text: 'Planlı, estetik ve etkileşim odaklı bir Instagram varlığı inşa ediyoruz.' },
  { num: '03', icon: '🎯', title: 'Performans Pazarlama', text: 'Meta ve Google tarafında dönüşüm odaklı, veriyle yönetilen kampanyalar.' },
];

const WORK_PREVIEW = [
  { cls: 'wt-1', cat: 'Web · 3D Deneyim', title: 'Nova Mimarlık — Portfolyo Sitesi' },
  { cls: 'wt-2', cat: 'Sosyal Medya', title: 'Ferra Coffee — Instagram Yeniden Doğuşu' },
  { cls: 'wt-3', cat: 'E-Ticaret', title: 'Loom Studio — Online Mağaza' },
];

export default function Home() {
  usePageTitle(null);
  useReveal();
  const rotatorWord = useRotator();

  return (
    <>
      <div className="wrap">
        <section className="hero" aria-label="Giriş">
          <div className="eyebrow" data-reveal>
            <span className="pulse"></span>
            Dijital Ajans · Yeni projelere açığız
          </div>
          <h1 data-reveal style={{ '--rd': '.08s' }}>
            Markanızı<br />
            <span className="rotator">{rotatorWord}</span><br />
            <b>dijital deneyimler.</b>
          </h1>
          <p className="lede" data-reveal style={{ '--rd': '.16s' }}>
            Exca Dijital olarak strateji, tasarım ve teknolojiyi tek çatı altında
            topluyoruz. Web sitenizden Instagram akışınıza, reklam
            kampanyanızdan marka kimliğinize kadar dijitaldeki her dokunuşunuzu
            biz tasarlıyoruz — bu sayfanın arkasında dönen 3B evren dahil.
          </p>
          <div className="cta-row" data-reveal style={{ '--rd': '.24s' }}>
            <Link to="/iletisim" className="btn primary magnetic" data-hover>
              Projenizi konuşalım <span className="arr">→</span>
            </Link>
            <Link to="/projeler" className="btn magnetic" data-hover>
              İşlerimize göz atın
            </Link>
          </div>
          <div className="hero-meta" data-reveal style={{ '--rd': '.32s' }}>
            <div className="hm-item">
              <span className="hm-num"><Counter target={50} suffix="+" /></span>
              <span className="hm-label">Tamamlanan Proje</span>
            </div>
            <div className="hm-item">
              <span className="hm-num"><Counter target={30} suffix="+" /></span>
              <span className="hm-label">Mutlu Müşteri</span>
            </div>
            <div className="hm-item">
              <span className="hm-num"><Counter target={98} suffix="%" /></span>
              <span className="hm-label">Memnuniyet</span>
            </div>
          </div>
          <div className="scroll-hint" aria-hidden="true">
            Kaydır
            <span className="line"></span>
          </div>
        </section>
      </div>

      <div className="marquee" aria-hidden="true">
        <div className="marquee-track">
          {Array.from({ length: 2 }).map((_, k) => (
            <span key={k}>
              <span>Web Tasarım <i>◆</i></span>
              <span>Sosyal Medya Yönetimi <i>◆</i></span>
              <span>Meta &amp; Google Ads <i>◆</i></span>
              <span>Marka Kimliği <i>◆</i></span>
              <span>E-Ticaret <i>◆</i></span>
              <span>İçerik &amp; Reels Üretimi <i>◆</i></span>
              <span>SEO <i>◆</i></span>
              <span>3D &amp; Motion <i>◆</i></span>
            </span>
          ))}
        </div>
      </div>

      <div className="wrap">
        <section className="block" aria-label="Hizmetler önizleme">
          <div className="sec-head">
            <div className="sec-tag" data-reveal>Hizmetler</div>
            <h2 data-reveal style={{ '--rd': '.06s' }}>Dijitalde ihtiyacınız olan<br /><b>her şey, tek yerde.</b></h2>
            <p className="sec-lede" data-reveal style={{ '--rd': '.12s' }}>
              Altı ana başlıkta uçtan uca çalışıyoruz — tüm kapsamı{' '}
              <Link to="/hizmetler" data-hover>Hizmetler</Link> sayfasında bulabilirsiniz.
            </p>
          </div>
          <div className="services-grid">
            {SERVICES_PREVIEW.map((s, i) => (
              <article className="svc" key={s.num} data-reveal style={{ '--rd': `${i * 0.08}s` }}>
                <span className="svc-num">{s.num}</span>
                <div className="svc-icon">{s.icon}</div>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </article>
            ))}
          </div>
          <div className="cta-row" style={{ marginTop: 40 }}>
            <Link to="/hizmetler" className="btn magnetic" data-hover>
              Tüm hizmetleri görün <span className="arr">→</span>
            </Link>
          </div>
        </section>
      </div>

      <div className="stats-band" data-reveal="zoom">
        <div className="wrap">
          <div className="stats-grid">
            <div className="stat">
              <div className="stat-num"><Counter target={50} />+</div>
              <div className="stat-label">Proje Teslimi</div>
            </div>
            <div className="stat">
              <div className="stat-num"><Counter target={30} />+</div>
              <div className="stat-label">Aktif Müşteri</div>
            </div>
            <div className="stat">
              <div className="stat-num"><Counter target={1200} />+</div>
              <div className="stat-label">Üretilen İçerik</div>
            </div>
            <div className="stat">
              <div className="stat-num"><Counter target={7} />/24</div>
              <div className="stat-label">İletişim Desteği</div>
            </div>
          </div>
        </div>
      </div>

      <div className="wrap">
        <section className="block" aria-label="Seçili işler önizleme">
          <div className="sec-head">
            <div className="sec-tag" data-reveal>Seçili İşler</div>
            <h2 data-reveal style={{ '--rd': '.06s' }}>Konuşmayı bırakıp<br /><b>gösterelim.</b></h2>
          </div>
          <div className="work-grid">
            {WORK_PREVIEW.map((w, i) => (
              <Link
                className="work"
                key={w.title}
                to="/projeler"
                data-reveal
                style={{ '--rd': `${i * 0.08}s` }}
                data-hover
              >
                <div className={`work-thumb ${w.cls}`}></div>
                <div className="work-info">
                  <div>
                    <span>{w.cat}</span>
                    <h3>{w.title}</h3>
                  </div>
                  <div className="work-arrow">↗</div>
                </div>
              </Link>
            ))}
          </div>
          <div className="cta-row" style={{ marginTop: 40 }}>
            <Link to="/projeler" className="btn magnetic" data-hover>
              Tüm projeleri görün <span className="arr">→</span>
            </Link>
          </div>
        </section>

        <section className="block" aria-label="Referanslar">
          <div className="sec-head" style={{ textAlign: 'center', marginLeft: 'auto', marginRight: 'auto' }}>
            <div className="sec-tag" data-reveal style={{ justifyContent: 'center' }}>Referanslar</div>
            <h2 data-reveal style={{ '--rd': '.06s' }}>Bizi en iyi<br /><b>müşterilerimiz anlatır.</b></h2>
          </div>
          <Testimonials />
        </section>

        <section className="block" id="cta">
          <div className="cta-band" data-reveal="zoom">
            <h2>Markanız için sıradaki adım:<br /><b>bir merhaba.</b></h2>
            <p>Projenizi anlatın, 24 saat içinde dönüş yapalım. Görüşme ücretsiz, kahve sizden sayılır. ☕</p>
            <div className="cta-row">
              <Link to="/iletisim" className="btn primary magnetic" data-hover>
                Teklif alın <span className="arr">→</span>
              </Link>
              <a
                href="https://www.instagram.com/excadijital/"
                target="_blank"
                rel="noopener noreferrer"
                className="btn magnetic"
                data-hover
              >
                Instagram&apos;dan yazın
              </a>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
