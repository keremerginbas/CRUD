import { useEffect, useRef, useState } from 'react';

const TESTIMONIALS = [
  {
    text:
      'Sitemiz yayına girdikten sonra ilk hafta gelen "bu siteyi kim yaptı?" mesajlarının sayısını kaybettik. Süreç boyunca her aşamada fikrimiz soruldu, hiçbir şey havada kalmadı.',
    name: 'A. Yılmaz',
    role: 'Mimarlık Ofisi Kurucusu',
  },
  {
    text:
      'Instagram hesabımız üç ayda hobi görünümünden marka görünümüne geçti. İçerik takvimi, tasarım dili, raporlama... hepsi saat gibi işliyor.',
    name: 'S. Demir',
    role: 'Kafe Zinciri Ortağı',
  },
  {
    text:
      'Reklam bütçemizi yarıya indirip satışları artırdık dersem abartmış olmam. Veriyle konuşan, ne yaptığını açıkça anlatan bir ekip.',
    name: 'M. Kaya',
    role: 'E-Ticaret Marka Sahibi',
  },
];

export default function Testimonials() {
  const [idx, setIdx] = useState(0);
  const timerRef = useRef(null);
  const wrapRef = useRef(null);

  const reduced =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const go = (i) => setIdx((i + TESTIMONIALS.length) % TESTIMONIALS.length);

  const restart = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (!reduced) {
      timerRef.current = setInterval(() => setIdx((v) => (v + 1) % TESTIMONIALS.length), 6500);
    }
  };

  useEffect(() => {
    restart();
    const wrap = wrapRef.current;
    const onEnter = () => { if (timerRef.current) clearInterval(timerRef.current); };
    const onLeave = () => restart();
    wrap?.addEventListener('pointerenter', onEnter);
    wrap?.addEventListener('pointerleave', onLeave);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      wrap?.removeEventListener('pointerenter', onEnter);
      wrap?.removeEventListener('pointerleave', onLeave);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="testi-wrap" ref={wrapRef} data-reveal="zoom">
      <div className="testi-viewport">
        <div className="testi-track" style={{ transform: `translateX(${-idx * 100}%)` }}>
          {TESTIMONIALS.map((t) => (
            <div className="testi" key={t.name}>
              <div className="testi-stars">★★★★★</div>
              <q>{t.text}</q>
              <div className="testi-who">
                <b>{t.name}</b>
                <span>{t.role}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="testi-nav">
        <button className="testi-arrow" aria-label="Önceki yorum" data-hover onClick={() => { go(idx - 1); restart(); }}>←</button>
        <div className="testi-dots" role="tablist" aria-label="Yorumlar">
          {TESTIMONIALS.map((t, i) => (
            <button
              key={t.name}
              className={`testi-dot${i === idx ? ' active' : ''}`}
              aria-label={`Yorum ${i + 1}`}
              onClick={() => { go(i); restart(); }}
            />
          ))}
        </div>
        <button className="testi-arrow" aria-label="Sonraki yorum" data-hover onClick={() => { go(idx + 1); restart(); }}>→</button>
      </div>
    </div>
  );
}
