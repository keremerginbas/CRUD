import { useState } from "react";
import { gsap, SplitText, useGsap } from "../lib/gsap.js";
import { useSeed } from "../lib/seed.jsx";
import Magnetic from "../components/Magnetic.jsx";

export default function Footer() {
  const { seed } = useSeed();
  const [copied, setCopied] = useState(false);

  const scope = useGsap(() => {
    const split = new SplitText(".ft-big", { type: "words,chars", wordsClass: "inline-block whitespace-nowrap" });
    gsap.from(split.chars, {
      yPercent: 100, opacity: 0, rotateX: -80, ease: "seed", duration: 1.2, stagger: 0.03,
      scrollTrigger: { trigger: ".ft-big", start: "top 85%" },
    });
    // imleç x konumuna göre harfler dalgalanır
    const chars = split.chars;
    const onMove = (e) => {
      chars.forEach((c) => {
        const r = c.getBoundingClientRect();
        const d = Math.abs(e.clientX - (r.left + r.width / 2));
        const f = Math.max(0, 1 - d / 260);
        gsap.to(c, { y: -f * 40, color: f > 0.4 ? "var(--color-c1)" : "var(--color-paper)", duration: 0.4, overwrite: "auto" });
      });
    };
    const el = scope.current;
    el.addEventListener("pointermove", onMove);
    return () => { el.removeEventListener("pointermove", onMove); split.revert(); };
  });

  const share = async () => {
    const url = new URL(window.location.href);
    url.searchParams.set("seed", seed);
    try { await navigator.clipboard.writeText(url.toString()); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* izin yok */ }
  };

  return (
    <footer id="iletisim" ref={scope} className="relative overflow-hidden border-t border-paper/10 px-5 pb-8 pt-32 md:px-10">
      <div className="eyebrow mb-8">(05) İletişim</div>
      <a href="mailto:merhaba@seed.studio" data-cursor="Yaz" className="block">
        <h2 className="ft-big text-[clamp(3.5rem,12.5vw,13rem)] font-medium leading-[0.85] tracking-[-0.05em] [perspective:600px]">Birlikte üretelim</h2>
      </a>
      <div className="mt-16 grid gap-10 md:grid-cols-3">
        <div>
          <div className="eyebrow mb-3">e-posta</div>
          <a href="mailto:merhaba@seed.studio" className="text-xl hover:text-c1">merhaba@seed.studio</a>
        </div>
        <div>
          <div className="eyebrow mb-3">bu versiyon</div>
          <p className="font-mono text-sm">{seed}</p>
          <Magnetic className="mt-4">
            <button onClick={share} className="btn border border-paper/20 hover:border-c1" data-cursor="Kopyala">
              {copied ? "✓ Kopyalandı" : "⧉ Bağlantıyı paylaş"}
            </button>
          </Magnetic>
        </div>
        <div className="md:text-right">
          <div className="eyebrow mb-3">yığın</div>
          <p className="text-sm text-mist">React · Tailwind CSS · GSAP · Lenis · Canvas 2D · Node.js / Express</p>
        </div>
      </div>
      <div className="mt-20 flex flex-wrap justify-between gap-4 border-t border-paper/10 pt-6 font-mono text-[11px] text-mist">
        <span>© {new Date().getFullYear()} SEED/STUDIO</span>
        <span>Bu sayfanın hiçbir karesi tekrar etmez.</span>
        <button onClick={() => window.__lenis?.scrollTo(0, { duration: 2 })} className="uppercase tracking-widest hover:text-paper">Başa dön ↑</button>
      </div>
    </footer>
  );
}
