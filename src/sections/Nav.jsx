import { useEffect, useRef } from "react";
import { gsap } from "../lib/gsap.js";
import { useLenis } from "../lib/lenis.jsx";
import ScrambleLink from "../components/ScrambleLink.jsx";

const LINKS = [
  ["Manifesto", "#manifesto"],
  ["Galeri", "#galeri"],
  ["Laboratuvar", "#lab"],
  ["Süreç", "#surec"],
];

export default function Nav() {
  const ref = useRef(null);
  const bar = useRef(null);
  const { lenis } = useLenis();

  useEffect(() => {
    if (!lenis) return;
    let hidden = false;
    const onScroll = ({ scroll, direction, progress }) => {
      gsap.set(bar.current, { scaleX: progress || 0 });
      const hide = scroll > 200 && direction === 1;
      if (hide !== hidden) {
        hidden = hide;
        gsap.to(ref.current, { yPercent: hide ? -110 : 0, duration: 0.5, ease: "power3.out" });
      }
    };
    lenis.on("scroll", onScroll);
    return () => lenis.off("scroll", onScroll);
  }, [lenis]);

  const go = (e, href) => {
    e.preventDefault();
    lenis?.scrollTo(href, { duration: 1.6 });
  };

  return (
    <header ref={ref} className="fixed inset-x-0 top-0 z-50 mix-blend-difference">
      <nav className="flex items-center justify-between px-5 py-5 md:px-10">
        <a href="#top" onClick={(e) => go(e, 0)} className="flex items-center gap-2 font-mono text-sm font-semibold tracking-tight" data-cursor="Başa">
          <span className="inline-block h-3 w-3 animate-[spin-slow_6s_linear_infinite] rounded-[3px] bg-c1" />
          SEED/STUDIO
        </a>
        <ul className="hidden gap-8 md:flex">
          {LINKS.map(([label, href]) => (
            <li key={href}>
              <ScrambleLink href={href} onClick={(e) => go(e, href)} className="font-mono text-xs uppercase tracking-widest">
                {label}
              </ScrambleLink>
            </li>
          ))}
        </ul>
        <a href="#iletisim" onClick={(e) => go(e, "#iletisim")} className="chip text-paper">
          <span className="h-1.5 w-1.5 rounded-full bg-c1" /> İletişim
        </a>
      </nav>
      <div ref={bar} className="h-px origin-left scale-x-0 bg-paper" />
    </header>
  );
}
