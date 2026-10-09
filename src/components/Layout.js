import { useEffect, useRef } from 'react';
import Nav from './Nav';
import Footer from './Footer';
import { initBackground } from '../engine/backgroundEngine';

const SCENES = [
  { key: 'particles', label: 'Particles' },
  { key: 'waves', label: 'Waves' },
  { key: 'geometric', label: 'Shapes' },
  { key: 'blobs', label: 'Blobs' },
  { key: 'galaxy', label: 'Galaxy' },
  { key: 'blackhole', label: 'Black Hole' },
];
const THEME_DOTS = [
  { key: 'nebula', label: 'Nebula', grad: 'linear-gradient(135deg,#6C63FF,#FF6584,#43E97B)' },
  { key: 'synthwave', label: 'Synthwave', grad: 'linear-gradient(135deg,#05D9E8,#FF2A6D,#B537F2)' },
  { key: 'ocean', label: 'Ocean', grad: 'linear-gradient(135deg,#0FB9E8,#36F1CD,#4D7CFF)' },
  { key: 'sunset', label: 'Sunset', grad: 'linear-gradient(135deg,#FFB56B,#FF4E7A,#FFD166)' },
  { key: 'mono', label: 'Mono', grad: 'linear-gradient(135deg,#E8ECF5,#8E9AB8,#4A5578)' },
];

export default function Layout({ children }) {
  const bgRef = useRef(null);

  useEffect(() => {
    const cleanups = [];
    const reducedMQ = window.matchMedia('(prefers-reduced-motion: reduce)');
    const applyReduced = () => document.body.classList.toggle('reduced-motion', reducedMQ.matches);
    applyReduced();
    reducedMQ.addEventListener?.('change', applyReduced);
    cleanups.push(() => reducedMQ.removeEventListener?.('change', applyReduced));
    const reduced = reducedMQ.matches;
    const coarse = window.matchMedia('(pointer:coarse)').matches;

    // ---------- 0. Preloader + footer yılı ----------
    const t1 = setTimeout(() => document.getElementById('preloader')?.classList.add('done'), 350);
    const t2 = setTimeout(() => document.getElementById('preloader')?.classList.add('done'), 2500);
    cleanups.push(() => { clearTimeout(t1); clearTimeout(t2); });
    const yearEl = document.getElementById('year');
    if (yearEl) yearEl.textContent = new Date().getFullYear();

    // ---------- 1. 3D arka plan motoru ----------
    bgRef.current = null;
    try {
      bgRef.current = initBackground({
        scene: 'particles',
        theme: 'nebula',
        intensity: 0.7,
        interactive: true,
        bloom: true,
      });
    } catch (err) {
      // WebGL desteklenmiyorsa statik arka plana sorunsuzca düşülür
      console.warn('3D arka plan motoru başlatılamadı:', err);
    }
    const bg = bgRef.current;

    // ---------- 2. Özel imleç ----------
    if (!reduced && !coarse) {
      const dot = document.getElementById('cursorDot');
      const ring = document.getElementById('cursorRing');
      if (dot && ring) {
        let mx = window.innerWidth / 2, my = window.innerHeight / 2, rx = mx, ry = my;
        let raf;
        const onMove = (e) => {
          mx = e.clientX; my = e.clientY;
          dot.style.transform = `translate(calc(-50% + ${mx}px), calc(-50% + ${my}px))`;
        };
        const follow = () => {
          rx += (mx - rx) * 0.16; ry += (my - ry) * 0.16;
          ring.style.transform = `translate(calc(-50% + ${rx}px), calc(-50% + ${ry}px))`;
          raf = requestAnimationFrame(follow);
        };
        window.addEventListener('pointermove', onMove, { passive: true });
        raf = requestAnimationFrame(follow);
        const onOver = (e) => {
          if (e.target.closest('a, button, [data-hover], input, textarea, select'))
            document.body.classList.add('cursor-hover');
        };
        const onOut = (e) => {
          if (e.target.closest('a, button, [data-hover], input, textarea, select'))
            document.body.classList.remove('cursor-hover');
        };
        const onDown = () => document.body.classList.add('cursor-down');
        const onUp = () => document.body.classList.remove('cursor-down');
        document.addEventListener('pointerover', onOver);
        document.addEventListener('pointerout', onOut);
        window.addEventListener('pointerdown', onDown);
        window.addEventListener('pointerup', onUp);
        cleanups.push(() => {
          cancelAnimationFrame(raf);
          window.removeEventListener('pointermove', onMove);
          document.removeEventListener('pointerover', onOver);
          document.removeEventListener('pointerout', onOut);
          window.removeEventListener('pointerdown', onDown);
          window.removeEventListener('pointerup', onUp);
        });
      }
    }

    // ---------- 3. Manyetik butonlar (delege edilmiş, tüm sayfalarda çalışır) ----------
    if (!reduced && !coarse) {
      const onMagMove = (e) => {
        const el = e.target.closest('.magnetic');
        if (!el) return;
        const r = el.getBoundingClientRect();
        const x = (e.clientX - r.left - r.width / 2) * 0.25;
        const y = (e.clientY - r.top - r.height / 2) * 0.35;
        el.style.transform = `translate(${x}px,${y}px)`;
      };
      const onMagLeave = (e) => {
        const el = e.target.closest?.('.magnetic');
        if (el) el.style.transform = '';
      };
      document.addEventListener('pointermove', onMagMove, { passive: true });
      document.addEventListener('pointerout', onMagLeave, { passive: true });
      cleanups.push(() => {
        document.removeEventListener('pointermove', onMagMove);
        document.removeEventListener('pointerout', onMagLeave);
      });
    }

    // ---------- 4. Nav: scrolled / gizle-göster / progress / toTop ----------
    {
      const nav = document.getElementById('nav');
      const prog = document.getElementById('scrollProgress');
      const toTop = document.getElementById('toTop');
      let lastY = 0;
      const onScroll = () => {
        const y = window.scrollY;
        if (nav) {
          nav.classList.toggle('scrolled', y > 30);
          if (y > 500 && y > lastY + 6) nav.classList.add('hidden');
          else if (y < lastY - 4 || y < 200) nav.classList.remove('hidden');
        }
        if (prog) {
          const max = document.body.scrollHeight - window.innerHeight;
          prog.style.width = (max > 0 ? (y / max) * 100 : 0) + '%';
        }
        if (toTop) toTop.classList.toggle('show', y > 700);
        lastY = y;
      };
      window.addEventListener('scroll', onScroll, { passive: true });
      onScroll();
      const onToTop = () => window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
      toTop?.addEventListener('click', onToTop);
      cleanups.push(() => {
        window.removeEventListener('scroll', onScroll);
        toTop?.removeEventListener('click', onToTop);
      });
    }

    // ---------- 5. 3D panel: sahne / tema / bloom / tur ----------
    if (bg) {
      const sceneButtons = Array.from(document.querySelectorAll('.chip[data-scene]'));
      const themeButtons = Array.from(document.querySelectorAll('.dot[data-theme]'));
      const bloomBtn = document.getElementById('bloomBtn');
      const tourBtn = document.getElementById('tourBtn');
      let tourTimer = null;

      const stopTour = () => {
        if (tourTimer) { clearInterval(tourTimer); tourTimer = null; }
        tourBtn?.classList.remove('active');
      };
      const startTour = () => {
        stopTour();
        tourTimer = setInterval(() => { if (!document.hidden) bg.next(); }, 12000);
        tourBtn?.classList.add('active');
        bg.next();
      };

      const sceneHandlers = sceneButtons.map((btn) => {
        const h = () => { bg.setScene(btn.dataset.scene); stopTour(); };
        btn.addEventListener('click', h);
        return [btn, h];
      });
      const themeHandlers = themeButtons.map((btn) => {
        const h = () => bg.setTheme(btn.dataset.theme);
        btn.addEventListener('click', h);
        return [btn, h];
      });
      const onBloom = () => bg.setBloom(!bg.bloom);
      bloomBtn?.addEventListener('click', onBloom);
      const onTour = () => (tourTimer ? stopTour() : startTour());
      tourBtn?.addEventListener('click', onTour);

      cleanups.push(() => {
        sceneHandlers.forEach(([btn, h]) => btn.removeEventListener('click', h));
        themeHandlers.forEach(([btn, h]) => btn.removeEventListener('click', h));
        bloomBtn?.removeEventListener('click', onBloom);
        tourBtn?.removeEventListener('click', onTour);
        stopTour();
      });
    }

    // ---------- 6. "Sahnelere git" kartları (Süreç / Hakkımızda sayfalarından) ----------
    const onCardClick = (e) => {
      const card = e.target.closest('[data-goto]');
      if (!card || !bg) return;
      bg.setScene(card.dataset.goto);
      window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
    };
    document.addEventListener('click', onCardClick);
    cleanups.push(() => document.removeEventListener('click', onCardClick));

    return () => cleanups.forEach((fn) => fn());
  }, []);

  return (
    <>
      <div id="preloader" aria-hidden="true">
        <div className="pre-logo">EXCA<em>·</em>DİJİTAL</div>
        <div className="pre-bar"><i></i></div>
      </div>

      <div id="scrollProgress" aria-hidden="true"></div>
      <div id="cursorDot" aria-hidden="true"></div>
      <div id="cursorRing" aria-hidden="true"></div>
      <div id="toast" role="status" aria-live="polite"></div>

      <canvas id="bg-canvas" aria-hidden="true"></canvas>
      <div className="static-fallback" aria-hidden="true"></div>

      <Nav />

      <main id="top">{children}</main>

      <Footer />

      <button id="toTop" aria-label="Başa dön" data-hover>↑</button>

      <div className="panel" role="group" aria-label="3D arka plan ayarları">
        <div className="prow" role="group" aria-label="Sahne seçimi">
          <span className="lbl">Sahne</span>
          {SCENES.map((s, i) => (
            <button key={s.key} className={`chip${i === 0 ? ' active' : ''}`} data-scene={s.key}>
              {s.label}
            </button>
          ))}
        </div>
        <div className="prow" role="group" aria-label="Tema ve efektler">
          <span className="lbl">Tema</span>
          {THEME_DOTS.map((t, i) => (
            <button
              key={t.key}
              className={`dot${i === 0 ? ' active' : ''}`}
              data-theme={t.key}
              title={t.label}
              aria-label={`${t.label} teması`}
              style={{ background: t.grad }}
            />
          ))}
          <button className="chip active" id="bloomBtn" title="Bloom aç/kapat">✦ Bloom</button>
          <button className="chip" id="tourBtn" title="Sahneleri otomatik gez">▶ Tur</button>
          <span className="fps" id="fps">— fps</span>
        </div>
      </div>
    </>
  );
}
