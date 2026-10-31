import { useEffect, useRef } from "react";
import { gsap, SplitText, useGsap } from "../lib/gsap.js";
import { useSeed } from "../lib/seed.jsx";
import FlowField from "../components/FlowField.jsx";
import Magnetic from "../components/Magnetic.jsx";

export default function Hero({ ready }) {
  const { seed, palette, regenerate, source } = useSeed();
  const seedRef = useRef(null);

  const scope = useGsap(() => {
    if (!ready) return;
    const split = new SplitText(".hero-title", { type: "lines,chars", linesClass: "split-line", charsClass: "will-change-transform" });
    gsap.from(split.chars, { yPercent: 110, rotate: 8, opacity: 0, duration: 1.1, ease: "seed", stagger: { each: 0.025, from: "start" } });
    gsap.from(".hero-fade", { y: 24, opacity: 0, duration: 1, ease: "seed", stagger: 0.08, delay: 0.5 });

    gsap.to(".hero-title", {
      yPercent: -35, opacity: 0.15, filter: "blur(6px)", ease: "none",
      scrollTrigger: { trigger: scope.current, start: "top top", end: "bottom top", scrub: true },
    });
    gsap.to(".hero-canvas", {
      scale: 1.15, ease: "none",
      scrollTrigger: { trigger: scope.current, start: "top top", end: "bottom top", scrub: true },
    });
    return () => split.revert();
  }, [ready]);

  const onRegenerate = () => {
    regenerate();
    gsap.fromTo(".hero-flash", { opacity: 0.6 }, { opacity: 0, duration: 0.8, ease: "power2.out" });
  };

  // tohum değişince karıştırma efekti
  // (metni React değil GSAP yönetir; çakışma olmasın diye span boş render edilir)
  useEffect(() => {
    const t = gsap.to(seedRef.current, { duration: 0.8, scrambleText: { text: seed, chars: "0123456789abcdef", speed: 0.5 } });
    return () => t.kill();
  }, [seed]);

  return (
    <section id="top" ref={scope} className="relative h-[100svh] min-h-[640px] overflow-hidden">
      <div className="hero-canvas absolute inset-0">
        <FlowField seed={seed} palette={palette} />
      </div>
      <div className="hero-flash pointer-events-none absolute inset-0 bg-paper opacity-0" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_30%,var(--color-ink)_95%)]" />

      <div className="relative z-10 flex h-full flex-col justify-end px-5 pb-8 md:px-10 md:pb-10">
        <p className="hero-fade eyebrow mb-6 max-w-sm">
          Generatif tasarım stüdyosu — kod, kaos ve biçimin kesiştiği yer.
        </p>
        <h1 className="hero-title max-w-[14ch] text-[clamp(3.2rem,11vw,11rem)] font-medium leading-[0.86] tracking-[-0.04em]">
          Her ziyaret <span className="font-serif font-normal italic text-c1">yeni</span> bir dünya.
        </h1>

        <div className="mt-10 grid items-end gap-6 border-t border-paper/15 pt-6 md:grid-cols-[1fr_auto_auto]">
          <div className="hero-fade flex flex-wrap items-center gap-x-8 gap-y-3 font-mono text-xs">
            <div>
              <div className="eyebrow mb-1">tohum · {source === "server" ? "sunucu" : "yerel"}</div>
              <span ref={seedRef} className="text-paper" aria-label={seed} />
            </div>
            <div>
              <div className="eyebrow mb-1">uyum</div>
              <span className="uppercase">{palette.name} · {palette.base}°</span>
            </div>
            <div className="flex gap-1.5" aria-label="palet">
              {palette.colors.map((c) => (
                <span key={c} className="h-6 w-6 rounded-full ring-1 ring-paper/20 transition-colors duration-700" style={{ background: c }} title={c} />
              ))}
            </div>
          </div>
          <div className="hero-fade hidden font-mono text-[11px] text-mist md:block">
            ↓ kaydır · imleci gezdir
          </div>
          <Magnetic className="hero-fade">
            <button onClick={onRegenerate} data-cursor="Üret" className="btn group bg-paper text-ink hover:bg-c1">
              <span className="inline-block transition-transform duration-500 group-hover:rotate-180">↻</span>
              Yeniden üret
            </button>
          </Magnetic>
        </div>
      </div>
    </section>
  );
}
