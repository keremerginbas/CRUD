import { useRef } from "react";
import { gsap, useGsap } from "../lib/gsap.js";

/** Açılış: sayaç + tohum karıştırma, ardından perde yukarı kalkar */
export default function Loader({ seed, onDone }) {
  const num = useRef(null);
  const scope = useGsap(() => {
    const counter = { v: 0 };
    const tl = gsap.timeline({ onComplete: onDone });
    tl.to(counter, { v: 100, duration: 1.6, ease: "power2.inOut", onUpdate: () => { if (num.current) num.current.textContent = String(Math.round(counter.v)).padStart(3, "0"); } })
      .to(".ld-seed", { duration: 1.2, scrambleText: { text: seed, chars: "0123456789abcdef", speed: 0.4 } }, 0.2)
      .to(".ld-bar", { scaleX: 1, duration: 1.6, ease: "power2.inOut" }, 0)
      .to(".ld-inner", { yPercent: -30, opacity: 0, duration: 0.6, ease: "power3.in" })
      .to(scope.current, { clipPath: "inset(0 0 100% 0)", duration: 0.9, ease: "snap" }, "-=0.2");
  }, []);

  return (
    <div ref={scope} className="fixed inset-0 z-[200] grid place-items-center bg-ink" style={{ clipPath: "inset(0 0 0% 0)" }}>
      <div className="ld-inner flex w-[min(80vw,520px)] flex-col gap-6">
        <div className="flex items-end justify-between">
          <span ref={num} className="font-sans text-7xl font-light tabular-nums md:text-9xl">000</span>
          <span className="eyebrow pb-3">üretiliyor</span>
        </div>
        <div className="h-px w-full bg-paper/10"><div className="ld-bar h-px origin-left scale-x-0 bg-c1" /></div>
        <div className="flex justify-between font-mono text-xs text-mist">
          <span>tohum</span>
          <span className="ld-seed text-paper">··········</span>
        </div>
      </div>
    </div>
  );
}
