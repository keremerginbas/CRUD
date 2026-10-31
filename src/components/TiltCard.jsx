import { useRef } from "react";
import { gsap } from "../lib/gsap.js";

/** ReactBits "Tilted Card" fikrinden: 3B eğim + parlama */
export default function TiltCard({ children, className = "", max = 10, ...rest }) {
  const ref = useRef(null);
  const glare = useRef(null);
  const move = (e) => {
    const r = ref.current.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    gsap.to(ref.current, { rotateY: px * max * 2, rotateX: -py * max * 2, scale: 1.02, duration: 0.5, ease: "power3" });
    gsap.to(glare.current, { opacity: 0.35, x: px * r.width, y: py * r.height, duration: 0.5 });
  };
  const leave = () => {
    gsap.to(ref.current, { rotateY: 0, rotateX: 0, scale: 1, duration: 0.9, ease: "elastic.out(1, 0.5)" });
    gsap.to(glare.current, { opacity: 0, duration: 0.5 });
  };
  return (
    <div className="[perspective:900px]">
      <div ref={ref} onPointerMove={move} onPointerLeave={leave} className={`relative overflow-hidden [transform-style:preserve-3d] ${className}`} {...rest}>
        {children}
        <div ref={glare} className="pointer-events-none absolute left-1/2 top-1/2 h-[140%] w-[140%] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-0 mix-blend-overlay" style={{ background: "radial-gradient(circle, white 0%, transparent 45%)" }} />
      </div>
    </div>
  );
}
