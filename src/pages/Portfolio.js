import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import useReveal from '../hooks/useReveal';
import usePageTitle from '../hooks/usePageTitle';

const FILTERS = [
  { key: 'all', label: 'Tümü' },
  { key: 'web', label: 'Web' },
  { key: 'sosyal', label: 'Sosyal Medya' },
  { key: 'eticaret', label: 'E-Ticaret' },
  { key: 'marka', label: 'Marka' },
];

const WORKS = [
  { cls: 'wt-1', cats: ['web'], cat: 'Web · 3D Deneyim', title: 'Nova Mimarlık — Portfolyo Sitesi' },
  { cls: 'wt-2', cats: ['sosyal'], cat: 'Sosyal Medya', title: 'Ferra Coffee — Instagram Yeniden Doğuşu' },
  { cls: 'wt-3', cats: ['eticaret'], cat: 'E-Ticaret', title: 'Loom Studio — Online Mağaza' },
  { cls: 'wt-4', cats: ['marka'], cat: 'Marka Kimliği', title: 'Atlas Fit — Sıfırdan Kimlik' },
  { cls: 'wt-5', cats: ['web', 'sosyal'], cat: 'Web + Sosyal', title: 'Mira Beauty — Lansman Kampanyası' },
  { cls: 'wt-6', cats: ['eticaret', 'sosyal'], cat: 'E-Ticaret + Ads', title: 'Kavella — Satış Odaklı Büyüme' },
];

export default function Portfolio() {
  usePageTitle('Projeler');
  const [filter, setFilter] = useState('all');
  useReveal([filter]);

  const visible = useMemo(
    () => WORKS.map((w) => ({ ...w, show: filter === 'all' || w.cats.includes(filter) })),
    [filter]
  );

  return (
    <div className="wrap">
      <section className="page-hero">
        <div className="breadcrumb" data-reveal>
          <Link to="/" data-hover>Ana Sayfa</Link> / Projeler
        </div>
        <div className="sec-tag" data-reveal>Seçili İşler</div>
        <h1 data-reveal style={{ '--rd': '.06s' }}>Konuşmayı bırakıp<br /><b>gösterelim.</b></h1>
        <p className="lede" data-reveal style={{ '--rd': '.12s' }}>
          Her sektöre aynı reçete olmaz. Aşağıdaki çalışmalar farklı
          ihtiyaçlara farklı çözümlerin örnekleri.
        </p>
      </section>

      <section className="block" style={{ paddingTop: 0 }}>
        <div className="filter-row" role="group" aria-label="Proje filtrele">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              className={`filter-btn${filter === f.key ? ' active' : ''}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="work-grid">
          {visible.map((w, i) => (
            <Link
              className={`work${w.show ? '' : ' hide'}`}
              key={w.title}
              to="/iletisim"
              data-reveal
              style={{ '--rd': `${(i % 3) * 0.08}s` }}
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
      </section>

      <section className="block">
        <div className="cta-band" data-reveal="zoom">
          <h2>Sıradaki vitrin,<br /><b>markanız olabilir.</b></h2>
          <p>Projenizi anlatın, size en yakın örneği referans alarak bir yol haritası çıkaralım.</p>
          <div className="cta-row">
            <Link to="/iletisim" className="btn primary magnetic" data-hover>
              Projemi anlatmak istiyorum <span className="arr">→</span>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
