import { useEffect, useRef } from "react";

/** ReactBits "Click Spark" fikrinden: her tıklamada palet renklerinde kıvılcım patlaması (tam ekran canvas) */
export default function ClickSpark({ palette }) {
  const ref = useRef(null);
  const colors = useRef(palette.colors);
  colors.current = palette.colors;

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas.getContext("2d");
    let sparks = [], raf = 0, running = false;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const loop = () => {
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      sparks = sparks.filter((s) => s.t < 1);
      for (const s of sparks) {
        s.t += 0.035;
        const e = 1 - Math.pow(1 - s.t, 3);
        const d = e * s.dist, len = (1 - e) * 14;
        ctx.strokeStyle = s.color; ctx.lineWidth = 2; ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(s.x + Math.cos(s.a) * d, s.y + Math.sin(s.a) * d);
        ctx.lineTo(s.x + Math.cos(s.a) * (d + len), s.y + Math.sin(s.a) * (d + len));
        ctx.stroke();
      }
      if (sparks.length) raf = requestAnimationFrame(loop);
      else running = false;
    };
    const click = (e) => {
      const n = 10, base = Math.random() * Math.PI;
      for (let i = 0; i < n; i++) {
        sparks.push({ x: e.clientX, y: e.clientY, a: base + (i / n) * Math.PI * 2, t: 0, dist: 28 + Math.random() * 26, color: colors.current[i % colors.current.length] });
      }
      if (!running) { running = true; raf = requestAnimationFrame(loop); }
    };
    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("pointerdown", click);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointerdown", click);
    };
  }, []);

  return <canvas ref={ref} className="pointer-events-none fixed inset-0 z-[99] h-screen w-screen" aria-hidden="true" />;
}
