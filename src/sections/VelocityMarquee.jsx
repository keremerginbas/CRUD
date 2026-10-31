import { useEffect, useRef } from "react";
import { gsap } from "../lib/gsap.js";
import { useLenis } from "../lib/lenis.jsx";

/** ReactBits "Scroll Velocity" fikrinden: kaydırma hızıyla hızlanan, yönle dönen sonsuz şeritler */
function Row({ items, base = 1, reverse = false, className = "" }) {
  const track = useRef(null);
  const { scroll } = useLenis();
  useEffect(() => {
    let x = 0, dir = reverse ? -1 : 1, skew = 0;
    const el = track.current;
    const tick = (_, dt) => {
      const v = scroll.current.velocity || 0;
      if (Math.abs(v) > 0.5) dir = (v > 0 ? 1 : -1) * (reverse ? -1 : 1);
      const speed = (base + Math.min(Math.abs(v), 80) * 0.18) * dir * (dt / 16.67);
      const half = el.scrollWidth / 2;
      x -= speed;
      if (x <= -half) x += half;
      if (x > 0) x -= half;
      skew += (gsap.utils.clamp(-12, 12, v * -0.35) - skew) * 0.12;
      el.style.transform = `translate3d(${x}px,0,0) skewX(${skew}deg)`;
    };
    gsap.ticker.add(tick);
    return () => gsap.ticker.remove(tick);
  }, [base, reverse, scroll]);

  const content = [...items, ...items];
  return (
    <div className="overflow-hidden whitespace-nowrap">
      <div ref={track} className={`inline-flex will-change-transform ${className}`}>
        {content.map((t, i) => (
          <span key={i} className="flex items-center">
            <span className={i % 2 ? "text-stroke" : ""}>{t}</span>
            <span className="mx-[0.35em] inline-block h-[0.32em] w-[0.32em] rounded-full" style={{ background: `var(--color-c${(i % 4) + 1})` }} />
          </span>
        ))}
      </div>
    </div>
  );
}

export default function VelocityMarquee() {
  const words = ["Algoritma", "Gürültü", "Tohum", "Ritim", "Entropi", "Biçim"];
  return (
    <section aria-label="Kayan şerit" className="relative select-none border-y border-paper/10 py-8 text-[clamp(3rem,9vw,8.5rem)] font-medium leading-none tracking-tight md:py-12">
      <Row items={words} base={1.2} />
      <Row items={["generative", "design", "systems", "motion", "code", "chaos"]} base={1} reverse className="font-serif font-normal italic text-paper/70" />
    </section>
  );
}
