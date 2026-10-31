import { useState } from "react";
import { gsap, useGsap } from "../lib/gsap.js";
import { useSeed } from "../lib/seed.jsx";
import { ALGORITHMS } from "../lib/art.js";
import ArtCanvas from "../components/ArtCanvas.jsx";
import TiltCard from "../components/TiltCard.jsx";

const PARAMS = { density: 0.5, chaos: 0.5 };

function Card({ algo, index, seed, palette }) {
  const [variant, setVariant] = useState(0);
  const s = variant ? `${seed}~${variant}` : seed;
  return (
    <article className="gal-card w-[78vw] shrink-0 sm:w-[52vw] lg:w-[34vw]">
      <TiltCard className="aspect-[4/5] rounded-2xl ring-1 ring-paper/10" data-cursor="Yenile" onClick={() => setVariant((v) => v + 1)}>
        <ArtCanvas algo={algo} seed={s} palette={palette} params={PARAMS} />
        <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-between p-4 font-mono text-[11px] mix-blend-difference">
          <span>{String(index + 1).padStart(2, "0")} / {String(ALGORITHMS.length).padStart(2, "0")}</span>
          <span>#{s.slice(-6)}</span>
        </div>
      </TiltCard>
      <div className="mt-5 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-2xl font-medium tracking-tight">{algo.name}</h3>
          <p className="mt-1 text-sm text-mist">{algo.desc}</p>
        </div>
        <span className="eyebrow mt-2 shrink-0">tıkla ↻</span>
      </div>
    </article>
  );
}

export default function Gallery() {
  const { seed, palette } = useSeed();

  const scope = useGsap(() => {
    const mm = gsap.matchMedia();
    mm.add("(min-width: 768px)", () => {
      const track = scope.current.querySelector(".gal-track");
      const dist = () => track.scrollWidth - window.innerWidth;
      const tween = gsap.to(track, {
        x: () => -dist(), ease: "none",
        scrollTrigger: {
          trigger: scope.current, start: "top top", end: () => `+=${dist()}`,
          pin: true, scrub: 0.8, invalidateOnRefresh: true, anticipatePin: 1,
        },
      });
      // kartlar yatay kayarken hafif paralaks/döndürme
      gsap.utils.toArray(".gal-card").forEach((card, i) => {
        gsap.fromTo(card, { y: i % 2 ? 60 : -30, rotate: i % 2 ? 2 : -2 }, {
          y: i % 2 ? -30 : 40, rotate: 0, ease: "none",
          scrollTrigger: { trigger: card, containerAnimation: tween, start: "left right", end: "right left", scrub: true },
        });
      });
      gsap.to(".gal-progress", { scaleX: 1, ease: "none", scrollTrigger: { trigger: scope.current, start: "top top", end: () => `+=${dist()}`, scrub: true } });
    });
    return () => mm.revert();
  });

  return (
    <section id="galeri" ref={scope} className="relative overflow-hidden py-24 md:flex md:h-screen md:flex-col md:justify-center md:py-0">
      <div className="mb-10 flex items-end justify-between px-5 md:px-10">
        <div>
          <div className="eyebrow mb-4">(02) Galeri — {ALGORITHMS.length} algoritma, 1 tohum</div>
          <h2 className="text-giga font-medium leading-[0.9] tracking-[-0.04em]">
            Kurallar <span className="font-serif font-normal italic text-c2">resim</span> yapar.
          </h2>
        </div>
      </div>
      <div className="gal-track flex gap-6 overflow-x-auto px-5 pb-6 md:overflow-visible md:px-10 md:pb-0" data-lenis-prevent-touch>
        {ALGORITHMS.map((a, i) => (
          <Card key={a.id} algo={a} index={i} seed={seed} palette={palette} />
        ))}
        <div className="hidden w-[20vw] shrink-0 md:block" />
      </div>
      <div className="mx-10 mt-8 hidden h-px bg-paper/10 md:block"><div className="gal-progress h-px origin-left scale-x-0 bg-c2" /></div>
    </section>
  );
}

