import { gsap, useGsap } from "../lib/gsap.js";

const STEPS = [
  { k: "Tohum", t: "Her şey bir sayıyla başlar.", d: "Rastgele ama tekrarlanabilir: aynı tohum, aynı dünyayı yeniden kurar. URL'yi paylaş, aynı sanatı gör.",
    path: "M20 100 a80 80 0 1 0 160 0 a80 80 0 1 0 -160 0 M100 60 a40 40 0 1 1 0 80 a40 40 0 1 1 0 -80" },
  { k: "Kural", t: "Sınırlar özgürlük üretir.", d: "Izgara, oran, yineleme. Biçimi doğrudan çizmek yerine biçimi doğuran kuralları tasarlarız.",
    path: "M20 20 H180 V180 H20 Z M20 100 H180 M100 20 V180 M60 20 V100 M140 100 V180" },
  { k: "Kaos", t: "Gürültü karakter verir.", d: "Simplex gürültü, olasılık ve fizik. Kontrollü kaos, makine kusursuzluğunu insanileştirir.",
    path: "M10 100 C40 20 60 180 90 100 S140 20 170 100 S190 160 195 120 M10 140 C40 80 70 190 100 140 S150 70 190 150" },
  { k: "Biçim", t: "Sistem nefes alır.", d: "Hareket, kaydırma ve etkileşimle birleşen kompozisyon — her ziyaretçiye kendi versiyonu.",
    path: "M100 20 L180 160 H20 Z M100 70 L140 140 H60 Z M100 20 V180" },
];

export default function Process() {
  const scope = useGsap(() => {
    const cards = gsap.utils.toArray(".pr-card");
    cards.forEach((card, i) => {
      // bir sonraki kart gelirken mevcut kart küçülür ve kararır (ReactBits "Scroll Stack" fikri)
      if (i < cards.length - 1) {
        gsap.to(card.querySelector(".pr-inner"), {
          scale: 0.9 - (cards.length - i) * 0.015, filter: "brightness(0.45)", ease: "none",
          scrollTrigger: { trigger: cards[i + 1], start: "top bottom", end: "top 15%", scrub: true },
        });
      }
      gsap.from(card.querySelectorAll(".pr-path"), {
        drawSVG: 0, duration: 1.8, ease: "power2.inOut", stagger: 0.2,
        scrollTrigger: { trigger: card, start: "top 70%" },
      });
    });
    // çizgi boyunca ilerleyen nokta (MotionPathPlugin)
    gsap.to(".pr-dot", {
      motionPath: { path: ".pr-line", align: ".pr-line", alignOrigin: [0.5, 0.5] }, ease: "none",
      scrollTrigger: { trigger: scope.current, start: "top center", end: "bottom center", scrub: 1 },
    });
  });

  return (
    <section id="surec" ref={scope} className="relative px-5 py-32 md:px-10">
      <div className="mb-16 grid gap-6 md:grid-cols-[200px_1fr]">
        <div className="eyebrow">(04) Süreç</div>
        <h2 className="text-giga font-medium leading-[0.9] tracking-[-0.04em]">
          Dört adımda <span className="font-serif font-normal italic text-c3">ortaya çıkış.</span>
        </h2>
      </div>

      <svg className="pointer-events-none absolute left-2 top-64 hidden h-[calc(100%-20rem)] w-10 md:left-6 md:block" viewBox="0 0 40 1000" preserveAspectRatio="none" aria-hidden="true">
        <path className="pr-line" d="M20 0 C40 120 0 240 20 360 S40 600 20 720 S0 900 20 1000" fill="none" stroke="currentColor" strokeOpacity="0.15" vectorEffect="non-scaling-stroke" />
        <circle className="pr-dot" r="5" fill="var(--color-c1)" />
      </svg>

      <div className="relative md:ml-[200px]">
        {STEPS.map((s, i) => (
          <div key={s.k} className="pr-card sticky pb-6" style={{ top: `calc(12vh + ${i * 18}px)` }}>
            <div className="pr-inner grid min-h-[60vh] origin-top gap-8 rounded-3xl border border-paper/10 bg-[color-mix(in_oklab,var(--color-ink)_88%,white)] p-8 md:grid-cols-[1fr_auto] md:p-14">
              <div className="flex flex-col justify-between gap-10">
                <div className="flex items-center gap-4 font-mono text-xs">
                  <span className="grid h-8 w-8 place-items-center rounded-full text-ink" style={{ background: `var(--color-c${i + 1})` }}>{i + 1}</span>
                  <span className="uppercase tracking-widest text-mist">{s.k}</span>
                </div>
                <div>
                  <h3 className="max-w-[16ch] text-[clamp(2rem,5vw,4.5rem)] font-medium leading-[0.95] tracking-[-0.03em]">{s.t}</h3>
                  <p className="mt-6 max-w-md text-mist">{s.d}</p>
                </div>
              </div>
              <svg viewBox="0 0 200 200" className="h-48 w-48 self-center md:h-72 md:w-72" aria-hidden="true">
                {s.path.split(" M").map((d, j) => (
                  <path key={j} className="pr-path" d={j ? `M${d}` : d} fill="none" stroke={`var(--color-c${i + 1})`} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                ))}
              </svg>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
