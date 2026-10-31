import { useRef } from "react";
import { gsap } from "../lib/gsap.js";

/** Üzerine gelince ScrambleTextPlugin ile harfleri karıştıran bağlantı */
export default function ScrambleLink({ children, href = "#", className = "", ...rest }) {
  const ref = useRef(null);
  const onEnter = () => {
    gsap.to(ref.current, { duration: 0.6, scrambleText: { text: children, chars: "01<>/*+#", speed: 0.6, revealDelay: 0.1 }, overwrite: true });
  };
  return (
    <a href={href} onPointerEnter={onEnter} className={className} {...rest}>
      <span ref={ref}>{children}</span>
    </a>
  );
}
