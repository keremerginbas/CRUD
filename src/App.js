import { useEffect, useMemo, useState } from 'react';
import './App.css';
import { contact, groups, services, steps } from './data';

const slugify = (text) =>
  text
    .toLocaleLowerCase('tr')
    .replace(/[çğıöşüâ]/g, (c) => ({ ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a' }[c]))
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

const withSlugs = services.map((s) => ({ ...s, slug: slugify(s.name) }));

function Logo() {
  return (
    <a href="#top" className="logo" aria-label="XRE Partners ana sayfa">
      <span className="logo-mark">
        XRE<span className="logo-bar" />
      </span>
      <span className="logo-sub">PARTNERS</span>
    </a>
  );
}

function Header() {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <header className="header">
      <div className="container header-inner">
        <Logo />
        <button className="menu-toggle" aria-label="Menü" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span />
          <span />
          <span />
        </button>
        <nav className={`nav ${open ? 'nav-open' : ''}`}>
          <a href="#bakis" onClick={close}>Hakkımızda</a>
          <a href="#hizmetler" onClick={close}>Hizmetler</a>
          <a href="#yaklasim" onClick={close}>Yaklaşım</a>
          <a href="#iletisim" className="btn btn-small" onClick={close}>İletişim</a>
        </nav>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="hero" id="top">
      <div className="hero-text">
        <p className="eyebrow">Kurumsal Hizmetler</p>
        <h1>
          İşinizin her aşamasında, <span className="accent">aynı masadayız.</span>
        </h1>
        <span className="rule" />
        <p className="lead">
          Kuruluştan büyümeye; hukuk, finans, gayrimenkul, enerji ve teknoloji için bütüncül danışmanlık.
        </p>
        <div className="hero-actions">
          <a href="#hizmetler" className="btn">Hizmetleri keşfedin</a>
          <a href={contact.phoneHref} className="btn btn-ghost">{contact.phone}</a>
        </div>
      </div>
      <div className="hero-media">
        <img src={`${process.env.PUBLIC_URL}/hero.jpg`} alt="Gün batımında modern ofis binaları" />
        <div className="hero-card">
          <div>
            <strong>25</strong>
            <small>hizmet alanı</small>
          </div>
          <div>
            <b>TEK ÇATI</b>
            <p>Şirketinizin ihtiyacına göre bir araya gelen uzmanlıklar.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function Overview({ onPick }) {
  return (
    <section className="section" id="bakis">
      <div className="container">
        <p className="eyebrow">XRE Partners’a Bakış</p>
        <h2>
          Farklı uzmanlıklar.
          <br />
          Şirketiniz için ortak bir yön.
        </h2>
        <p className="section-lead">
          XRE Partners; şirketlerin kuruluş, yönetim, maliyet kontrolü, varlık değerlendirme ve büyüme ihtiyaçlarını
          ilgili uzmanlıklarla buluşturan bir danışmanlık çatısı olarak tasarlanmıştır.
        </p>
        <div className="groups">
          {groups.map((g) => {
            const count = services.filter((s) => s.group === g.id).length;
            return (
              <button key={g.id} className="group-card" onClick={() => onPick(g.id)}>
                <span className="group-count">{String(count).padStart(2, '0')}</span>
                <h3>{g.title}</h3>
                <p>{g.summary}</p>
                <span className="link">Hizmetleri gör →</span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function Services({ filter, setFilter, onOpen }) {
  const [query, setQuery] = useState('');
  const list = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('tr');
    return withSlugs.filter(
      (s) =>
        (filter === 'all' || s.group === filter) &&
        (!q || `${s.name} ${s.kicker} ${s.intro}`.toLocaleLowerCase('tr').includes(q))
    );
  }, [filter, query]);

  return (
    <section className="section section-alt" id="hizmetler">
      <div className="container">
        <p className="eyebrow">Hizmet Kataloğu</p>
        <h2>25 hizmet alanı, tek çatı.</h2>
        <div className="toolbar">
          <div className="chips" role="tablist">
            <button className={filter === 'all' ? 'chip active' : 'chip'} onClick={() => setFilter('all')}>
              Tümü
            </button>
            {groups.map((g) => (
              <button
                key={g.id}
                className={filter === g.id ? 'chip active' : 'chip'}
                onClick={() => setFilter(g.id)}
              >
                {g.title}
              </button>
            ))}
          </div>
          <input
            className="search"
            type="search"
            placeholder="Hizmet ara…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Hizmet ara"
          />
        </div>
        <div className="grid">
          {list.map((s) => (
            <a key={s.no} href={`#hizmet/${s.slug}`} className="card" onClick={(e) => { e.preventDefault(); onOpen(s.slug); }}>
              <span className="card-no">{s.no}</span>
              <span className="card-kicker">{s.kicker}</span>
              <h3>{s.name}</h3>
              <p>{s.headline}</p>
              <span className="link">Detaylar →</span>
            </a>
          ))}
          {list.length === 0 && <p className="empty">Aramanızla eşleşen hizmet bulunamadı.</p>}
        </div>
      </div>
    </section>
  );
}

function Approach() {
  return (
    <section className="section section-dark" id="yaklasim">
      <div className="container">
        <p className="eyebrow">Çalışma Modelimiz</p>
        <h2>Dört adımda bütüncül danışmanlık.</h2>
        <ol className="steps">
          {steps.map((step, i) => (
            <li key={step}>
              <span>{String(i + 1).padStart(2, '0')}</span>
              <b>{step}</b>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Contact() {
  return (
    <section className="section contact" id="iletisim">
      <div className="container contact-inner">
        <div>
          <p className="eyebrow">İletişim</p>
          <h2>
            Şirketinizin sonraki adımını <span className="accent">birlikte planlayalım.</span>
          </h2>
          <p className="section-lead">
            Hangi hizmete ihtiyaç duyduğunuzu paylaşın. İlgili uzmanlıkları bir araya getirerek çalışma kapsamını ve
            yol haritasını oluşturalım.
          </p>
        </div>
        <div className="contact-cards">
          <a href={contact.phoneHref} className="contact-card">
            <small>Telefon</small>
            <b>{contact.phone}</b>
          </a>
          <a href={contact.webHref} className="contact-card" target="_blank" rel="noreferrer">
            <small>Web</small>
            <b>{contact.web}</b>
          </a>
          <div className="contact-card">
            <small>Adres</small>
            <b>{contact.city}</b>
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <div className="container footer-inner">
        <Logo />
        <p>
          Kuruluş. Yönetim. Gelişim.
          <br />
          Şirketinize bütüncül bir bakış.
        </p>
        <small>© {new Date().getFullYear()} XRE Partners</small>
      </div>
    </footer>
  );
}

function ServiceModal({ service, onClose, onNav }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') onNav(1);
      if (e.key === 'ArrowLeft') onNav(-1);
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose, onNav]);

  const group = groups.find((g) => g.id === service.group);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <article className="modal" role="dialog" aria-modal="true" aria-label={service.name} onClick={(e) => e.stopPropagation()}>
        <aside className="modal-side">
          <span className="modal-no">{service.no}</span>
          <h3>{service.headline}</h3>
          <span className="rule" />
          {service.stat && (
            <div className="stat">
              <strong>{service.stat[0]}</strong>
              <small>{service.stat[1]}</small>
            </div>
          )}
          <small className="modal-group">{group?.title}</small>
        </aside>
        <div className="modal-body">
          <button className="modal-close" onClick={onClose} aria-label="Kapat">×</button>
          <p className="eyebrow">{service.kicker}</p>
          <h2>{service.name}</h2>
          <p className="section-lead">{service.intro}</p>
          <div className="items">
            {service.items.map(([title, text]) => (
              <div key={title} className="item">
                <h4>{title}</h4>
                <p>{text}</p>
              </div>
            ))}
          </div>
          {service.extra && <p className="extra">{service.extra}</p>}
          {service.highlight && <p className="highlight">{service.highlight}</p>}
          <a href={contact.phoneHref} className="cta">
            {service.cta} <span>→ {contact.phone}</span>
          </a>
          <p className="note">{service.note}</p>
          <div className="modal-nav">
            <button onClick={() => onNav(-1)}>← Önceki</button>
            <button onClick={() => onNav(1)}>Sonraki →</button>
          </div>
        </div>
      </article>
    </div>
  );
}

const readSlug = () => {
  const m = window.location.hash.match(/^#hizmet\/(.+)$/);
  return m ? decodeURIComponent(m[1]) : null;
};

export default function App() {
  const [filter, setFilter] = useState('all');
  const [slug, setSlug] = useState(readSlug);

  useEffect(() => {
    const onHash = () => setSlug(readSlug());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const open = (s) => {
    window.history.pushState(null, '', `#hizmet/${s}`);
    setSlug(s);
  };
  const close = () => {
    window.history.pushState(null, '', '#hizmetler');
    setSlug(null);
  };
  const nav = (dir) => {
    const i = withSlugs.findIndex((s) => s.slug === slug);
    const next = withSlugs[(i + dir + withSlugs.length) % withSlugs.length];
    window.history.replaceState(null, '', `#hizmet/${next.slug}`);
    setSlug(next.slug);
  };

  const pickGroup = (id) => {
    setFilter(id);
    document.getElementById('hizmetler')?.scrollIntoView({ behavior: 'smooth' });
  };

  const current = withSlugs.find((s) => s.slug === slug);

  return (
    <>
      <Header />
      <main>
        <Hero />
        <Overview onPick={pickGroup} />
        <Services filter={filter} setFilter={setFilter} onOpen={open} />
        <Approach />
        <Contact />
      </main>
      <Footer />
      {current && <ServiceModal service={current} onClose={close} onNav={nav} />}
    </>
  );
}
