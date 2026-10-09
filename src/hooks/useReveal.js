import { useEffect } from 'react';

/**
 * [data-reveal] öğelerini sayfa her mount olduğunda gözlemler ve
 * görünür olduklarında .in sınıfını ekler (orijinal şablondaki
 * reveal animasyonunun React'e taşınmış hali).
 */
export default function useReveal(deps = []) {
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const els = Array.from(document.querySelectorAll('[data-reveal]'));
    if (!els.length) return;

    if (reduced || !('IntersectionObserver' in window)) {
      els.forEach((el) => el.classList.add('in'));
      return;
    }

    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting) {
            en.target.classList.add('in');
            obs.unobserve(en.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -6% 0px' }
    );
    els.forEach((el) => obs.observe(el));

    return () => obs.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
