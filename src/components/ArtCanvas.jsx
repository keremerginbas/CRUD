import { useEffect, useRef } from "react";
import { createRng } from "../lib/random.js";
import { render } from "../lib/art.js";

/** Tek bir generatif eseri canvas'a çizer; seed/palet/param değişince yeniden üretir */
export default function ArtCanvas({ algo, seed, palette, params, className = "", canvasRef }) {
  const local = useRef(null);
  const ref = canvasRef || local;
  useEffect(() => {
    const canvas = ref.current;
    const draw = () => render(canvas, algo, createRng(`${algo.id}:${seed}`), palette, params);
    draw();
    let t;
    const ro = new ResizeObserver(() => { clearTimeout(t); t = setTimeout(draw, 120); });
    ro.observe(canvas);
    return () => { ro.disconnect(); clearTimeout(t); };
  }, [algo, seed, palette, params, ref]);
  return <canvas ref={ref} className={`block h-full w-full ${className}`} />;
}
