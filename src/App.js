import { useRef } from 'react';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
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
  );
}

export default App;
