import { useEffect, useRef } from "react";
import { gsap } from "../lib/gsap.js";

/** Özel imleç: hızla esneyen damla + [data-cursor="Etiket"] öğelerinde büyüyen etiket */
export default function Cursor() {
  const dot = useRef(null);
  const ring = useRef(null);
  const label = useRef(null);

  useEffect(() => {
    if (!window.matchMedia("(pointer: fine)").matches) return;
    const xDot = gsap.quickTo(dot.current, "x", { duration: 0.08 });
    const yDot = gsap.quickTo(dot.current, "y", { duration: 0.08 });
    const xRing = gsap.quickTo(ring.current, "x", { duration: 0.5, ease: "power3" });
    const yRing = gsap.quickTo(ring.current, "y", { duration: 0.5, ease: "power3" });
    let lx = 0, ly = 0;

    const move = (e) => {
      xDot(e.clientX); yDot(e.clientY);
      xRing(e.clientX); yRing(e.clientY);
      const vx = e.clientX - lx, vy = e.clientY - ly;
      lx = e.clientX; ly = e.clientY;
      const speed = Math.min(Math.hypot(vx, vy) / 60, 0.6);
      gsap.to(ring.current, { rotate: (Math.atan2(vy, vx) * 180) / Math.PI, scaleX: 1 + speed, scaleY: 1 - speed * 0.5, duration: 0.3, overwrite: "auto" });
    };
    const over = (e) => {
      const t = e.target.closest("[data-cursor], a, button, input");
      if (!t) return;
      const text = t.getAttribute("data-cursor") || "";
      label.current.textContent = text;
      gsap.to(ring.current, { width: text ? 96 : 56, height: text ? 96 : 56, backgroundColor: text ? "var(--color-c1)" : "transparent", duration: 0.35, ease: "back.out(2)" });
      gsap.to(label.current, { opacity: text ? 1 : 0, duration: 0.2 });
    };
    const out = (e) => {
      const t = e.target.closest("[data-cursor], a, button, input");
      if (!t || (e.relatedTarget && t.contains(e.relatedTarget))) return;
      gsap.to(ring.current, { width: 36, height: 36, backgroundColor: "transparent", duration: 0.35 });
      gsap.to(label.current, { opacity: 0, duration: 0.2 });
    };
    const down = () => gsap.to(ring.current, { scale: 0.7, duration: 0.15 });
    const up = () => gsap.to(ring.current, { scale: 1, duration: 0.4, ease: "elastic.out(1, 0.4)" });

    window.addEventListener("pointermove", move);
    document.addEventListener("pointerover", over);
    document.addEventListener("pointerout", out);
    window.addEventListener("pointerdown", down);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      document.removeEventListener("pointerover", over);
      document.removeEventListener("pointerout", out);
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("pointerup", up);
    };
  }, []);

  return (
    <div className="pointer-events-none fixed inset-0 z-[100] hidden [@media(pointer:fine)]:block" aria-hidden="true">
      <div ref={ring} className="absolute left-0 top-0 grid h-9 w-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-paper/60 mix-blend-difference">
        <span ref={label} className="font-mono text-[10px] uppercase tracking-widest text-ink opacity-0" />
      </div>
      <div ref={dot} className="absolute left-0 top-0 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-c1" />
    </div>
  );
}
