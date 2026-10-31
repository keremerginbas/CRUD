import { gsap, SplitText, useGsap } from "../lib/gsap.js";

const TEXT =
  "Biz piksel çizmiyoruz. Kurallar yazıyoruz — sonra bir tohum ekip geri çekiliyoruz. Her yüklemede, her tıklamada, her kaydırmada site kendini yeniden kuruyor. Tasarım artık bir dosya değil; yaşayan bir sistem.";

export default function Manifesto() {
  const scope = useGsap(() => {
    const split = new SplitText(".mf-text", { type: "words" });
    gsap.fromTo(split.words, { opacity: 0.12, y: 6 }, {
      opacity: 1, y: 0, ease: "none", stagger: 0.1,
      scrollTrigger: { trigger: ".mf-text", start: "top 80%", end: "bottom 45%", scrub: 0.6 },
    });
    gsap.to(".mf-orb", {
      yPercent: -40, rotate: 180, ease: "none",
      scrollTrigger: { trigger: scope.current, start: "top bottom", end: "bottom top", scrub: true },
    });
    return () => split.revert();
  });

  return (
    <section id="manifesto" ref={scope} className="relative overflow-hidden px-5 py-32 md:px-10 md:py-48">
      <div className="mf-orb pointer-events-none absolute -right-40 top-20 h-[34rem] w-[34rem] rounded-full opacity-30 blur-3xl" style={{ background: "conic-gradient(from 0deg, var(--color-c1), var(--color-c2), var(--color-c3), var(--color-c1))" }} />
      <div className="relative grid gap-12 md:grid-cols-[200px_1fr]">
        <div className="eyebrow">(01) Manifesto</div>
        <p className="mf-text max-w-[22ch] text-[clamp(2rem,4.6vw,4.6rem)] font-light leading-[1.05] tracking-[-0.02em] md:max-w-[26ch]">
          {TEXT}
        </p>
      </div>
      <div className="relative mt-24 grid gap-px overflow-hidden rounded-2xl border border-paper/10 bg-paper/10 md:ml-[200px] md:grid-cols-3">
        {[
          ["∞", "olası kompozisyon", "Her tohum benzersiz bir palet, akış ve düzen üretir."],
          ["7", "generatif algoritma", "Akış alanı, sırtlar, bölünme, paketleme ve dahası."],
          ["60", "kare / saniye", "Lenis + GSAP ticker tek bir döngüde senkron."],
        ].map(([n, t, d]) => (
          <div key={t} className="bg-ink p-8">
            <div className="gradient-text text-6xl font-medium">{n}</div>
            <div className="mt-4 font-mono text-xs uppercase tracking-widest">{t}</div>
            <p className="mt-2 text-sm text-mist">{d}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
