import { useMemo, useRef, useState } from "react";
import { gsap, useGsap } from "../lib/gsap.js";
import { useSeed } from "../lib/seed.jsx";
import { ALGORITHMS } from "../lib/art.js";
import { randomSeed } from "../lib/random.js";
import ArtCanvas from "../components/ArtCanvas.jsx";
import Magnetic from "../components/Magnetic.jsx";

function Slider({ label, value, onChange }) {
  return (
    <label className="block">
      <div className="mb-3 flex justify-between font-mono text-[11px] uppercase tracking-widest">
        <span className="text-mist">{label}</span>
        <span className="tabular-nums">{Math.round(value * 100)}</span>
      </div>
      <input type="range" min="0" max="1" step="0.01" value={value} onChange={(e) => onChange(+e.target.value)} className="slider" />
    </label>
  );
}

export default function Lab() {
  const { seed, palette, setSeed } = useSeed();
  const [algoId, setAlgoId] = useState("flow");
  const [density, setDensity] = useState(0.5);
  const [chaos, setChaos] = useState(0.5);
  const [localSeed, setLocalSeed] = useState(null);
  const canvasRef = useRef(null);

  const algo = ALGORITHMS.find((a) => a.id === algoId);
  const activeSeed = localSeed || seed;
  const params = useMemo(() => ({ density, chaos }), [density, chaos]);

  const scope = useGsap(() => {
    gsap.from(".lab-reveal", {
      y: 60, opacity: 0, duration: 1.1, ease: "seed", stagger: 0.08,
      scrollTrigger: { trigger: scope.current, start: "top 70%" },
    });
  });

  const download = () => {
    const a = document.createElement("a");
    a.download = `seed-studio-${algo.id}-${activeSeed}.png`;
    a.href = canvasRef.current.toDataURL("image/png");
    a.click();
  };

  return (
    <section id="lab" ref={scope} className="relative px-5 py-32 md:px-10 md:py-40">
      <div className="lab-reveal mb-14 grid gap-6 md:grid-cols-[200px_1fr]">
        <div className="eyebrow">(03) Laboratuvar</div>
        <h2 className="text-giga font-medium leading-[0.9] tracking-[-0.04em]">
          Sen de <span className="shiny font-serif font-normal italic">üret.</span>
        </h2>
      </div>

      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <aside className="lab-reveal flex flex-col gap-8 rounded-2xl border border-paper/10 bg-paper/[0.03] p-6 backdrop-blur">
          <div>
            <div className="eyebrow mb-3">algoritma</div>
            <div className="flex flex-wrap gap-2">
              {ALGORITHMS.map((a) => (
                <button key={a.id} onClick={() => setAlgoId(a.id)}
                  className={`rounded-full border px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider transition-colors ${a.id === algoId ? "border-c1 bg-c1 text-ink" : "border-paper/15 hover:border-paper/50"}`}>
                  {a.name}
                </button>
              ))}
            </div>
          </div>
          <Slider label="Yoğunluk" value={density} onChange={setDensity} />
          <Slider label="Kaos" value={chaos} onChange={setChaos} />
          <div>
            <div className="eyebrow mb-3">tohum</div>
            <div className="flex gap-2">
              <input
                value={activeSeed}
                onChange={(e) => setLocalSeed(e.target.value.slice(0, 32) || null)}
                spellCheck={false}
                className="min-w-0 flex-1 rounded-full border border-paper/15 bg-transparent px-4 py-2 font-mono text-xs outline-none focus:border-c1"
                aria-label="Tohum"
              />
              <button onClick={() => setLocalSeed(randomSeed())} className="rounded-full border border-paper/15 px-3 font-mono text-xs hover:border-c1" data-cursor="Zar">⚄</button>
            </div>
          </div>
          <div className="mt-auto flex flex-wrap gap-3">
            <Magnetic>
              <button onClick={download} className="btn bg-c1 text-ink" data-cursor="PNG">↓ İndir</button>
            </Magnetic>
            <button onClick={() => { if (localSeed) setSeed(localSeed.replace(/[^\w-]/g, "") || seed); setLocalSeed(null); }}
              className="btn border border-paper/20 hover:border-paper" data-cursor="Uygula">
              Siteye uygula
            </button>
          </div>
        </aside>

        <div className="lab-reveal relative aspect-square overflow-hidden rounded-2xl ring-1 ring-paper/10 lg:aspect-auto lg:min-h-[640px]">
          <ArtCanvas algo={algo} seed={activeSeed} palette={palette} params={params} canvasRef={canvasRef} />
          <div className="pointer-events-none absolute bottom-0 left-0 right-0 flex justify-between p-4 font-mono text-[11px] mix-blend-difference">
            <span>{algo.name.toUpperCase()}</span>
            <span>d{Math.round(density * 100)} · k{Math.round(chaos * 100)} · {activeSeed}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
