import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { generatePalette, randomSeed } from "./random.js";

const SeedContext = createContext(null);

function readUrlSeed() {
  const s = new URLSearchParams(window.location.search).get("seed");
  return s && /^[\w-]{1,32}$/.test(s) ? s : null;
}

function applyPalette(p) {
  const root = document.documentElement.style;
  p.colors.forEach((c, i) => root.setProperty(`--c${i + 1}`, c));
  root.setProperty("--ink", p.ink);
  root.setProperty("--paper", p.paper);
}

export function SeedProvider({ children }) {
  const [seed, setSeedState] = useState(() => readUrlSeed() || randomSeed());
  const [source, setSource] = useState("local");
  const palette = useMemo(() => generatePalette(seed), [seed]);

  useEffect(() => applyPalette(palette), [palette]);

  // URL'de tohum yoksa Node sunucusundan bir "günün tohumu" iste; sunucu yoksa yerel tohumda kal.
  useEffect(() => {
    if (readUrlSeed()) return;
    const ctrl = new AbortController();
    fetch("/api/seed", { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        if (d?.seed) { setSeedState(d.seed); setSource("server"); }
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, []);

  const setSeed = useCallback((s) => {
    setSeedState(s);
    setSource("local");
    const url = new URL(window.location.href);
    url.searchParams.set("seed", s);
    window.history.replaceState(null, "", url);
  }, []);

  const regenerate = useCallback(() => setSeed(randomSeed()), [setSeed]);

  const value = useMemo(() => ({ seed, palette, source, setSeed, regenerate }), [seed, palette, source, setSeed, regenerate]);
  return <SeedContext.Provider value={value}>{children}</SeedContext.Provider>;
}

export const useSeed = () => useContext(SeedContext);
