import { useState } from 'react';
import { NavLink, Link } from 'react-router-dom';

const NAV_ITEMS = [
  { to: '/hakkimizda', label: 'Hakkımızda' },
  { to: '/hizmetler', label: 'Hizmetler' },
  { to: '/projeler', label: 'Projeler' },
  { to: '/surec', label: 'Süreç' },
  { to: '/paketler', label: 'Paketler' },
  { to: '/sss', label: 'SSS' },
];

export default function Nav() {
  const [menuOpen, setMenuOpen] = useState(false);

  const toggleMenu = () => {
    const next = !menuOpen;
    setMenuOpen(next);
    document.body.classList.toggle('menu-open', next);
  };

  const closeMenu = () => {
    setMenuOpen(false);
    document.body.classList.remove('menu-open');
  };

  return (
    <>
      <nav id="nav" aria-label="Ana gezinme">
        <div className="nav-inner">
          <Link to="/" className="logo" data-hover onClick={closeMenu}>
            <span className="logo-mark">E</span>
            EXCA<em>·</em>DİJİTAL
          </Link>
          <div className="nav-links">
            {NAV_ITEMS.map((item) => (
              <NavLink key={item.to} to={item.to} data-hover>
                {item.label}
              </NavLink>
            ))}
          </div>
          <Link to="/iletisim" className="nav-cta" data-hover>
            Teklif Al
          </Link>
          <button
            id="hamburger"
            aria-label="Menüyü aç/kapat"
            aria-expanded={menuOpen}
            onClick={toggleMenu}
          >
            <span></span>
            <span></span>
            <span></span>
          </button>
        </div>
      </nav>

      <div id="mobileMenu" aria-hidden={!menuOpen}>
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.to} to={item.to} onClick={closeMenu}>
            {item.label}
          </NavLink>
        ))}
        <NavLink to="/iletisim" onClick={closeMenu}>
          İletişim
        </NavLink>
        <a
          href="https://www.instagram.com/excadijital/"
          target="_blank"
          rel="noopener noreferrer"
          className="mobile-menu-ig"
          onClick={closeMenu}
        >
          @excadijital ↗
        </a>
      </div>
    </>
  );
}
