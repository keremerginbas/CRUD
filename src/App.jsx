import { useEffect, useState } from "react";
import { ScrollTrigger } from "./lib/gsap.js";
import { useSeed } from "./lib/seed.jsx";
import Loader from "./components/Loader.jsx";
import Cursor from "./components/Cursor.jsx";
import ClickSpark from "./components/ClickSpark.jsx";
import Nav from "./sections/Nav.jsx";
import Hero from "./sections/Hero.jsx";
import VelocityMarquee from "./sections/VelocityMarquee.jsx";
import Manifesto from "./sections/Manifesto.jsx";
import Gallery from "./sections/Gallery.jsx";
import Lab from "./sections/Lab.jsx";
import Process from "./sections/Process.jsx";
import Footer from "./sections/Footer.jsx";
import { useLenis } from "./lib/lenis.jsx";

export default function App() {
  const { seed, palette } = useSeed();
  const { lenis } = useLenis();
  const [ready, setReady] = useState(false);

  // yükleme sırasında kaydırmayı kilitle
  useEffect(() => {
    if (!lenis) return;
    if (ready) { lenis.start(); ScrollTrigger.refresh(); }
    else lenis.stop();
  }, [lenis, ready]);

  // fontlar gelince ölçümleri tazele
  useEffect(() => { document.fonts?.ready.then(() => ScrollTrigger.refresh()); }, []);

  return (
    <>
      {!ready && <Loader seed={seed} onDone={() => setReady(true)} />}
      <Cursor />
      <ClickSpark palette={palette} />
      <div className="grain" aria-hidden="true" />
      <Nav />
      <main>
        <Hero ready={ready} />
        <VelocityMarquee />
        <Manifesto />
        <Gallery />
        <Lab />
        <Process />
      </main>
      <Footer />
    </>
  );
}
