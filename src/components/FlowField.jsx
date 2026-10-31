import { useEffect, useRef } from "react";
import { createNoise3D, createRng } from "../lib/random.js";
import { useLenis } from "../lib/lenis.jsx";
import { prefersReducedMotion } from "../lib/gsap.js";

/**
 * Canlı akış alanı: parçacıklar 3D simplex gürültünün yönünü izler,
 * fare onları iter, Lenis kaydırma hızı alanı "rüzgârla" büker.
 */
export default function FlowField({ seed, palette, className = "" }) {
  const canvasRef = useRef(null);
  const { scroll } = useLenis();
  const mouse = useRef({ x: -9999, y: -9999, active: false });

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const rng = createRng(`flow:${seed}`);
    const noise = createNoise3D(rng);
    const reduced = prefersReducedMotion();
    let w = 0, h = 0, dpr = 1, raf = 0, z = rng() * 10, visible = true;
    let particles = [];
    const scale = rng.range(0.0012, 0.0028);
    const curl = rng.range(1.5, 3.5);

    const spawn = (p = {}) => {
      p.x = rng() * w; p.y = rng() * h;
      p.px = p.x; p.py = p.y;
      p.life = rng.int(80, 260);
      p.speed = rng.range(0.6, 1.8);
      p.color = rng.chance(0.5) ? palette.colors[0] : rng.pick(palette.colors);
      p.width = rng.range(0.6, 2.2);
      return p;
    };

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const r = canvas.getBoundingClientRect();
      w = r.width; h = r.height;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = palette.ink;
      ctx.fillRect(0, 0, w, h);
      const count = Math.round(Math.min(1400, (w * h) / 900));
      particles = Array.from({ length: count }, () => spawn());
    };

    const step = () => {
      const v = scroll.current.velocity || 0;
      z += 0.0025 + Math.min(Math.abs(v), 60) * 0.0004;
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 0.07;
      ctx.fillStyle = palette.ink;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 0.9;
      ctx.lineCap = "round";
      const m = mouse.current;
      for (const p of particles) {
        const a = noise(p.x * scale, p.y * scale, z) * Math.PI * curl;
        let vx = Math.cos(a) * p.speed;
        let vy = Math.sin(a) * p.speed - v * 0.06;
        if (m.active) {
          const dx = p.x - m.x, dy = p.y - m.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < 26000) {
            const f = (1 - d2 / 26000) * 4;
            const d = Math.sqrt(d2) || 1;
            vx += (dx / d) * f + (-dy / d) * f * 0.6;
            vy += (dy / d) * f + (dx / d) * f * 0.6;
          }
        }
        p.px = p.x; p.py = p.y;
        p.x += vx; p.y += vy;
        p.life--;
        if (p.life < 0 || p.x < -5 || p.x > w + 5 || p.y < -5 || p.y > h + 5) { spawn(p); continue; }
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.width;
        ctx.beginPath(); ctx.moveTo(p.px, p.py); ctx.lineTo(p.x, p.y); ctx.stroke();
      }
    };

    const loop = () => {
      if (visible) step();
      raf = requestAnimationFrame(loop);
    };

    const onMove = (e) => {
      const r = canvas.getBoundingClientRect();
      mouse.current = { x: e.clientX - r.left, y: e.clientY - r.top, active: true };
    };
    const onLeave = () => (mouse.current.active = false);

    resize();
    if (reduced) { for (let i = 0; i < 160; i++) step(); }
    else loop();

    const io = new IntersectionObserver(([en]) => (visible = en.isIntersecting));
    io.observe(canvas);
    const ro = new ResizeObserver(() => resize());
    ro.observe(canvas);
    window.addEventListener("pointermove", onMove);
    document.addEventListener("pointerleave", onLeave);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect(); ro.disconnect();
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
    };
  }, [seed, palette, scroll]);

  return <canvas ref={canvasRef} className={`block h-full w-full ${className}`} aria-hidden="true" />;
}
