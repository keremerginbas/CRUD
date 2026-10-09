import { Link } from 'react-router-dom';

export default function Footer() {
  return (
    <footer>
      <div className="wrap">
        <div className="foot-grid">
          <div className="foot-brand">
            <Link to="/" className="logo" data-hover>
              <span className="logo-mark">E</span>
              EXCA<em>·</em>DİJİTAL
            </Link>
            <p>
              Strateji, tasarım ve teknolojiyi tek çatı altında toplayan butik
              dijital ajans. Markanızı büyüten deneyimler tasarlıyoruz.
            </p>
            <div className="foot-social">
              <a
                href="https://www.instagram.com/excadijital/"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Instagram"
                data-hover
              >
                ◎
              </a>
              <a href="mailto:kurumsal@excadijital.com.tr" aria-label="E-posta" data-hover>
                ✉
              </a>
              <a
                href="https://wa.me/905061288930"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="WhatsApp"
                data-hover
              >
                ✆
              </a>
            </div>
          </div>
          <div className="foot-col">
            <h4>Hizmetler</h4>
            <ul>
              <li>
                <Link to="/hizmetler" data-hover>Web Tasarım</Link>
              </li>
              <li>
                <Link to="/hizmetler" data-hover>Sosyal Medya</Link>
              </li>
              <li>
                <Link to="/hizmetler" data-hover>Performans Pazarlama</Link>
              </li>
              <li>
                <Link to="/hizmetler" data-hover>Marka Kimliği</Link>
              </li>
              <li>
                <Link to="/hizmetler" data-hover>E-Ticaret</Link>
              </li>
            </ul>
          </div>
          <div className="foot-col">
            <h4>Ajans</h4>
            <ul>
              <li>
                <Link to="/hakkimizda" data-hover>Hakkımızda</Link>
              </li>
              <li>
                <Link to="/projeler" data-hover>Projeler</Link>
              </li>
              <li>
                <Link to="/surec" data-hover>Süreç</Link>
              </li>
              <li>
                <Link to="/sss" data-hover>SSS</Link>
              </li>
              <li>
                <Link to="/iletisim" data-hover>İletişim</Link>
              </li>
            </ul>
          </div>
          <div className="foot-col">
            <h4>Sosyal</h4>
            <ul>
              <li>
                <a
                  href="https://www.instagram.com/excadijital/"
                  target="_blank"
                  rel="noopener noreferrer"
                  data-hover
                >
                  Instagram ↗
                </a>
              </li>
              <li>
                <a href="mailto:kurumsal@excadijital.com.tr" data-hover>
                  E-posta
                </a>
              </li>
              <li>
                <a href="https://wa.me/905061288930" target="_blank" rel="noopener noreferrer" data-hover>
                  WhatsApp ↗
                </a>
              </li>
            </ul>
          </div>
        </div>
        <div className="foot-bottom">
          <span>© <span id="year">2026</span> Exca Dijital. Tüm hakları saklıdır.</span>
          <span>Bu site gerçek zamanlı WebGL ile çalışır — video kullanılmaz. ✦</span>
        </div>
      </div>
    </footer>
  );
}
