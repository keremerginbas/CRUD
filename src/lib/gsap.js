// GSAP — kullanıcının sağladığı gsap-public.zip içindeki ESM build'den (src/vendor/gsap)
import { gsap } from "../vendor/gsap/index.js";
import { ScrollTrigger } from "../vendor/gsap/ScrollTrigger.js";
import { SplitText } from "../vendor/gsap/SplitText.js";
import { ScrambleTextPlugin } from "../vendor/gsap/ScrambleTextPlugin.js";
import { DrawSVGPlugin } from "../vendor/gsap/DrawSVGPlugin.js";
import { MotionPathPlugin } from "../vendor/gsap/MotionPathPlugin.js";
import { CustomEase } from "../vendor/gsap/CustomEase.js";
import { Flip } from "../vendor/gsap/Flip.js";
import { useLayoutEffect, useRef } from "react";

gsap.registerPlugin(ScrollTrigger, SplitText, ScrambleTextPlugin, DrawSVGPlugin, MotionPathPlugin, CustomEase, Flip);

CustomEase.create("seed", "M0,0 C0.16,1 0.3,1 1,1");
CustomEase.create("snap", "M0,0 C0.7,0 0.2,1 1,1");

/**
 * React için küçük bir useGSAP eşdeğeri: gsap.context ile scope'lar,
 * unmount'ta (ve StrictMode çift çağrısında) her şeyi geri alır.
 */
export function useGsap(fn, deps = []) {
  const scope = useRef(null);
  useLayoutEffect(() => {
    const ctx = gsap.context(fn, scope);
    return () => ctx.revert();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return scope;
}

export const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export { gsap, ScrollTrigger, SplitText, Flip };
