import { createContext, useContext, useEffect, useRef, useState } from "react";
import Lenis from "lenis";
import "lenis/dist/lenis.css";
import { gsap, ScrollTrigger } from "./gsap.js";

const LenisContext = createContext({ lenis: null, scroll: { current: { velocity: 0, progress: 0, direction: 1 } } });

/**
 * Lenis + GSAP ScrollTrigger senkronu (Lenis README'deki resmi kurulum):
 * lenis.on('scroll', ScrollTrigger.update) + gsap.ticker -> lenis.raf
 * Hız/ilerleme değerleri re-render tetiklememek için ref'te tutulur; canvas'lar her karede okur.
 */
export function LenisProvider({ children }) {
  const [lenis, setLenis] = useState(null);
  const scroll = useRef({ velocity: 0, progress: 0, direction: 1, y: 0 });

  useEffect(() => {
    const instance = new Lenis({ lerp: 0.085, wheelMultiplier: 1, anchors: { offset: 0 } });
    instance.on("scroll", (e) => {
      scroll.current.velocity = e.velocity;
      scroll.current.progress = e.progress || 0;
      scroll.current.direction = e.direction || 1;
      scroll.current.y = e.scroll;
      ScrollTrigger.update();
    });
    const tick = (time) => instance.raf(time * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);
    setLenis(instance);
    window.__lenis = instance;
    return () => {
      gsap.ticker.remove(tick);
      instance.destroy();
      setLenis(null);
    };
  }, []);

  return <LenisContext.Provider value={{ lenis, scroll }}>{children}</LenisContext.Provider>;
}

export const useLenis = () => useContext(LenisContext);
