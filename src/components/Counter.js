import { useEffect, useRef, useState } from 'react';

/**
 * Görünür olduğunda 0'dan hedef sayıya animasyonlu sayan sayaç.
 * Orijinal şablondaki [data-count] sayaç mantığının React bileşeni hali.
 */
export default function Counter({ target, suffix = '', prefix = '' }) {
  const [value, setValue] = useState(0);
  const ref = useRef(null);
  const done = useRef(false);

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const el = ref.current;
    if (!el) return;

    const animate = () => {
      if (done.current) return;
      done.current = true;
      if (reduced) {
        setValue(target);
        return;
      }
      const dur = 1600;
      const t0 = performance.now();
      const tick = (now) => {
        const k = Math.min(1, (now - t0) / dur);
        const ease = 1 - Math.pow(1 - k, 3);
        setValue(Math.round(target * ease));
        if (k < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };

    if (!('IntersectionObserver' in window)) {
      animate();
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting) {
            animate();
            obs.unobserve(en.target);
          }
        });
      },
      { threshold: 0.6 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [target]);

  return (
    <span ref={ref}>
      {prefix}
      {value}
      {suffix}
    </span>
  );
}
