import { useRef } from 'react';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import Aurora from './components/Aurora/Aurora';
import Particles from './components/Particles/Particles';
import SplitText from './components/SplitText/SplitText';
import './App.css';

gsap.registerPlugin(useGSAP);

function App() {
  const container = useRef(null);

  useGSAP(
    () => {
      gsap.to('.box', { rotation: 360, repeat: -1, duration: 3, ease: 'none' });
    },
    { scope: container }
  );

  return (
    <>
      <div className="bg-layer">
        <Aurora colorStops={['#5227FF', '#7cff67', '#5227FF']} amplitude={1} blend={0.5} speed={1} />
      </div>
      <div className="bg-layer">
        <Particles
          particleColors={['#ffffff', '#ff9ffc']}
          particleCount={200}
          particleSpread={10}
          speed={0.1}
          particleBaseSize={100}
          alphaParticles
        />
      </div>

      <main className="app" ref={container}>
        <SplitText
          text="Merhaba, GSAP!"
          tag="h1"
          className="hero-title"
          delay={60}
          duration={0.8}
          splitType="chars"
        />
        <div className="box" />
      </main>
    </>
  );
}

export default App;
