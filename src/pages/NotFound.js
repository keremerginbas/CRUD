import { Link } from 'react-router-dom';
import useReveal from '../hooks/useReveal';
import usePageTitle from '../hooks/usePageTitle';

export default function NotFound() {
  usePageTitle('404 — Sayfa Bulunamadı');
  useReveal();

  return (
    <div className="wrap">
      <section className="notfound">
        <div className="code" data-reveal="zoom">404</div>
        <h2 data-reveal>Bu sayfa <b>kaybolmuş</b> görünüyor.</h2>
        <p className="sec-lede" data-reveal style={{ '--rd': '.08s', textAlign: 'center', maxWidth: 480 }}>
          Aradığınız sayfa taşınmış veya hiç var olmamış olabilir. Ana sayfaya
          dönüp aradığınızı oradan bulabilirsiniz.
        </p>
        <div className="cta-row" data-reveal style={{ '--rd': '.16s', justifyContent: 'center' }}>
          <Link to="/" className="btn primary magnetic" data-hover>
            Ana sayfaya dön <span className="arr">→</span>
          </Link>
          <Link to="/iletisim" className="btn magnetic" data-hover>
            Bize ulaşın
          </Link>
        </div>
      </section>
    </div>
  );
}
