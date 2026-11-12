/* ------------------------------------------------------------------
   Orphion ana sayfası: 3D kapsül alanı (Three.js)
   Kaydırma ilerlemesine göre dört bölüm:
     0 giriş   -> kapsüller havada süzülür
     1 düşüş   -> yerçekimine teslim olur, zemine çarpıp seker
     2 kalp    -> bir kalp şeklinde toplanır
     3 serbest -> kameraya doğru uçup kaybolur
   İmleç kapsülleri iter; hızlı hareket daha sert savurur.
   Yükleme ekranı sahne hazır olunca kapanır ve kapsüller içeri uçar.
   ------------------------------------------------------------------ */
import {
  WebGLRenderer, Scene, PerspectiveCamera, Color, Vector3, Group, Mesh, CapsuleGeometry,
  MeshPhysicalMaterial, MeshStandardMaterial, HemisphereLight, DirectionalLight, ACESFilmicToneMapping, MathUtils, Clock,
} from "three";

const host = document.querySelector("[data-capsules]");
const story = document.querySelector("[data-story]");
const loader = document.querySelector("[data-loader]");
const bg = document.querySelector("[data-story-bg]");
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Renk paletleri: giriş (marka) -> düşüş (turuncu) -> kalp (kırmızı/pembe)
const PAL = {
  hero: { white: "#FFFFFF", pearl: "#DCE6F5", navy: "#1E2A44", orange: "#FF914B", glass: "#A9C1EC" },
  drop: { white: "#FFFFFF", pearl: "#FFE2CC", navy: "#2B3654", orange: "#FF7A2E", glass: "#FFB98A" },
  heart: { white: "#FFFFFF", pearl: "#FFD3DA", navy: "#B81E45", orange: "#FF5470", glass: "#FF9DB0" },
};
const ROLES = ["white", "pearl", "navy", "orange", "glass"];
const toColors = (p) => Object.fromEntries(ROLES.map((r) => [r, new Color(p[r])]));
const palHero = toColors(PAL.hero), palDrop = toColors(PAL.drop), palHeart = toColors(PAL.heart);
const cur = toColors(PAL.hero);
// Kapsülün iki yarısının renk rolleri
const PAIRS = [["white", "navy"], ["white", "orange"], ["orange", "navy"], ["pearl", "white"], ["navy", "navy"],
  ["white", "orange"], ["pearl", "navy"], ["orange", "orange"]];

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

const control = { progress: 0, started: false };
const mouse = { x: 99, y: 99, down: false };

if (host && story) start();

function start() {
  let renderer;
  try {
    renderer = new WebGLRenderer({ antialias: (window.devicePixelRatio || 1) < 1.5, alpha: true, powerPreference: "high-performance" });
  } catch (e) {
    finishLoader(true);
    return; // WebGL yok: metinler ve arka plan yeterli
  }
  const canvas = renderer.domElement;
  host.appendChild(canvas);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  const scene = new Scene();
  const camera = new PerspectiveCamera(38, 1, 0.1, 100);
  camera.position.set(0, 0, 11);

  const hemi = new HemisphereLight(0xffffff, new Color(PAL.hero.navy), 1.5);
  scene.add(hemi);
  const key = new DirectionalLight(0xffffff, 1.5); key.position.set(-6, 10, 8); scene.add(key);
  const rim = new DirectionalLight(0xffffff, 1.2); rim.position.set(8, 7, -8); scene.add(rim);
  const front = new DirectionalLight(0xffffff, 0.45); front.position.set(0, 0, 11); scene.add(front);

  let vw = 10, vh = 6;
  function frustum() {
    vh = 2 * Math.tan(MathUtils.degToRad(camera.fov) / 2) * camera.position.z;
    vw = vh * (host.clientWidth / Math.max(1, host.clientHeight));
  }

  // İki renkli kapsül malzemesi: yerel y > 0 üst renk, altı alt renk
  function capsuleMaterial(glass) {
    if (glass) {
      // Kırılma (transmission) her karede sahneyi ikinci kez çizdirir; yarı saydam cam yeterli
      return new MeshPhysicalMaterial({
        color: 0xffffff, roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.05, transparent: true, opacity: 0.55, depthWrite: false,
      });
    }
    const m = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.32, metalness: 0, transparent: true });
    m.userData.top = { value: new Color() };
    m.userData.bottom = { value: new Color() };
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uTop = m.userData.top;
      sh.uniforms.uBottom = m.userData.bottom;
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nvarying float vLocalY;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvLocalY = position.y;");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying float vLocalY;\nuniform vec3 uTop;\nuniform vec3 uBottom;")
        .replace("vec4 diffuseColor = vec4( diffuse, opacity );",
          "vec4 diffuseColor = vec4( diffuse * mix( uBottom, uTop, smoothstep( -0.015, 0.015, vLocalY ) ), opacity );");
    };
    return m;
  }

  const mobile = window.innerWidth < 768;
  const count = mobile ? 34 : 64;
  const geo = new CapsuleGeometry(0.5, 1.0, 6, 16); // toplam boy 2, çap 1
  const bodies = [];
  for (let i = 0; i < count; i++) {
    const r = Math.random();
    const base = r < 0.3 ? 0.2 + Math.random() * 0.08 : r < 0.8 ? 0.3 + Math.random() * 0.12 : 0.46 + Math.random() * 0.14;
    const size = base * (window.innerWidth < 1024 ? 0.72 : 1);
    const glass = Math.random() < 0.16;
    const pair = PAIRS[i % PAIRS.length];
    const mat = capsuleMaterial(glass);
    const mesh = new Mesh(geo, mat);
    mesh.scale.setScalar(size);
    mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    const group = new Group();
    group.add(mesh);
    scene.add(group);
    const radius = size * 0.82; // çarpışma için yaklaşık küre
    bodies.push({
      id: i, size, radius, mass: Math.pow(radius, 3), glass, pair, mat, mesh, group,
      vis: radius, pos: new Vector3(), vel: new Vector3(), heart: new Vector3(),
    });
  }
  const meanR = bodies.reduce((s, b) => s + b.radius, 0) / bodies.length;
  let heartScale = 1;

  const inHeart = (x, y) => { const a = x * x + y * y - 1; return a * a * a - x * x * y * y * y <= 0; };
  function heartTargets() {
    const narrow = window.innerWidth < 1024;
    const S = narrow ? Math.min(vw * 0.3, vh * 0.15) : Math.min(vw * 0.26, vh * 0.23);
    const baseY = narrow ? vh * 0.04 : -vh * 0.09;
    const baseX = window.innerWidth >= 1024 ? -vw * 0.06 : 0;
    heartScale = Math.max(0.3, Math.min(1, (S * 0.45 / 2.3) / meanR));
    for (const b of bodies) {
      let x = 0, y = 0, n = 0;
      do { x = (Math.random() * 2 - 1) * 1.25; y = Math.random() * 2.55 - 1.4; n++; } while (!inHeart(x, y) && n < 60);
      b.heart.set(x * S + baseX, (y + 0.12) * S + baseY, (Math.random() - 0.5) * 0.35);
    }
  }
  function scatter(inward) {
    const R = Math.max(vw, vh) * 1.5;
    for (const b of bodies) {
      const a = Math.random() * Math.PI * 2;
      b.pos.set(Math.cos(a) * R * 1.25, Math.sin(a) * R * 0.85, (Math.random() - 0.5) * 4);
      b.group.position.copy(b.pos);
      if (inward) b.vel.copy(b.pos).multiplyScalar(-1).normalize().multiplyScalar(0.08 + Math.random() * 0.05);
      else b.vel.set(0, 0, 0);
    }
  }

  function resize() {
    const w = host.clientWidth, h = host.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
    frustum();
    heartTargets();
  }
  new ResizeObserver(resize).observe(host);
  resize();
  scatter(false);

  // Kaydırma ilerlemesi (bölüm cinsinden) ve arka plan aşaması
  function onScroll() {
    const h = window.innerHeight || 1;
    control.progress = Math.max(0, (window.scrollY - story.offsetTop) / h);
    if (bg) {
      const stage = control.progress > 1.55 ? 2 : control.progress > 0.7 ? 1 : 0;
      bg.setAttribute("data-stage", String(stage));
    }
    host.style.opacity = control.progress > 3.7 ? "0" : "1";
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
  onScroll();

  window.addEventListener("pointermove", (e) => {
    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
  }, { passive: true });
  window.addEventListener("pointerdown", () => { mouse.down = true; });
  window.addEventListener("pointerup", () => { mouse.down = false; });
  document.addEventListener("pointerleave", () => { mouse.x = 99; mouse.y = 99; });

  const proj = new Vector3(), mw = new Vector3(), prevMw = new Vector3();
  function mouseWorld() {
    proj.set(mouse.x, mouse.y, 0.5).unproject(camera);
    const dir = proj.sub(camera.position).normalize();
    mw.copy(camera.position).add(dir.multiplyScalar(-camera.position.z / dir.z));
  }

  const P = { rebound: -0.3, repel: 0.05, repelR: 4.2, attract: 0.0035, bounce: 0.02 };
  const d = new Vector3(), cd = new Vector3(), rv = new Vector3(), dp = new Vector3(), axis = new Vector3();
  const clock = new Clock();
  let begun = false, t0 = 0, readySent = false, visible = true;
  new IntersectionObserver((en) => { visible = en[0].isIntersecting; }).observe(story);

  function applyColors() {
    for (const b of bodies) {
      if (b.glass) {
        b.mat.color.copy(cur.glass);
      } else {
        b.mat.userData.top.value.copy(cur[b.pair[0]]);
        b.mat.userData.bottom.value.copy(cur[b.pair[1]]);
      }
    }
  }
  applyColors();

  function frame() {
    requestAnimationFrame(frame);
    const time = clock.getElapsedTime();
    if (control.started && !begun) { begun = true; t0 = time; scatter(true); }
    if (!begun) {
      renderer.render(scene, camera);
      if (!readySent) { readySent = true; sceneReady(); }
      return;
    }
    if (!visible || document.hidden || control.progress > 3.8) return;
    mouseWorld();

    const p = control.progress;
    const heroF = 1 - smoothstep(0.3, 0.8, p);
    const dropF = smoothstep(0.4, 0.95, p) * (1 - smoothstep(1.25, 1.75, p));
    const shapeF = smoothstep(1.4, 2.05, p) * (1 - smoothstep(2.55, 3.0, p));
    const flyF = smoothstep(2.7, 3.45, p);

    const bDrop = smoothstep(0.55, 1.05, p), bHeart = smoothstep(1.4, 1.95, p);
    for (const r of ROLES) cur[r].copy(palHero[r]).lerp(palDrop[r], bDrop).lerp(palHeart[r], bHeart);
    hemi.groundColor.copy(cur.navy);
    applyColors();

    const entT = easeOutCubic(clamp01((time - t0) / 2.2));
    const boost = lerp(7.5, 1, entT);
    const active = Math.abs(mouse.x) < 0.99 && Math.abs(mouse.y) < 0.99;
    let speed = active ? mw.distanceTo(prevMw) : 0;
    if (speed > 3) speed = 3;
    prevMw.copy(mw);

    let damping = 0.91;
    damping = lerp(damping, 0.992, dropF);
    damping = lerp(damping, 0.9, shapeF);
    damping = lerp(damping, 0.985, flyF);
    const cluster = Math.max(heroF, entT < 1 ? 1 : 0);
    const camZ = camera.position.z;

    for (const b of bodies) {
      if (heroF > 0.01) {
        b.vel.x += Math.sin(time * 0.4 + b.id * 1.5) * 0.0004 * b.radius * heroF;
        b.vel.y += Math.cos(time * 0.5 + b.id * 1.2) * 0.0004 * b.radius * heroF;
        b.vel.z += Math.sin(time * 0.35 + b.id) * 0.0001 * heroF;
      }
      const k = P.attract * boost * cluster;
      if (k > 0.00001) {
        // Küme sağa kayık durur; sol taraftaki başlık okunur kalsın
        const wide = window.innerWidth >= 1024;
        const cx = wide ? vw * 0.23 : 0;
        b.vel.x += (cx - b.pos.x) * k * (wide ? 1.1 : 0.38);
        b.vel.y += ((wide ? 0 : vh * 0.28) - b.pos.y) * k * 1.85;
        b.vel.z += (0 - b.pos.z) * k * 1.8;
      }
      if (dropF > 0.001) b.vel.y -= 0.011 * dropF;
      if (shapeF > 0.001) {
        const s = 0.06 * shapeF;
        b.vel.x += (b.heart.x - b.pos.x) * s;
        b.vel.y += (b.heart.y - b.pos.y) * s;
        b.vel.z += (b.heart.z - b.pos.z) * s;
      }
      if (flyF > 0.001) {
        const st = (b.id * 0.6180339887) % 1;
        const l = smoothstep(st * 0.55, st * 0.55 + 0.45, flyF);
        b.vel.z += 0.05 * l;
        b.vel.x += b.pos.x * 0.006 * l;
        b.vel.y += b.pos.y * 0.006 * l;
      }
      if (active) {
        d.subVectors(b.pos, mw);
        const dist = d.length();
        const R = mouse.down ? P.repelR * 1.4 : P.repelR;
        const F = mouse.down ? P.repel * 1.7 : P.repel;
        if (dist < R && dist > 0.0001) {
          const q = dist / R;
          const push = (1 - q * q * (3 - 2 * q)) * F * (1 + speed * 3.2);
          d.normalize(); d.z *= 0.12; d.normalize();
          b.vel.addScaledVector(d, push);
        }
      }
      b.vel.multiplyScalar(damping);
      b.pos.add(b.vel);
      b.mat.opacity = flyF > 0.001 ? 1 - smoothstep(camZ - 2.6, camZ - 0.3, b.pos.z) : 1;
      const target = b.radius * (1 - (1 - heartScale) * shapeF);
      b.vis += (target - b.vis) * 0.12;
      b.mesh.scale.setScalar(b.size * (b.vis / b.radius));
    }

    const collide = 0.28 * (1 - 0.93 * shapeF) * (1 - flyF);
    for (let step = 0; step < 2; step++) {
      for (let i = 0; i < bodies.length; i++) {
        for (let j = i + 1; j < bodies.length; j++) {
          const a = bodies[i], c = bodies[j];
          cd.subVectors(c.pos, a.pos);
          const dist = cd.length();
          const min = a.vis + c.vis;
          if (dist < min && dist > 0.001) {
            const ov = min - dist;
            cd.multiplyScalar(1 / dist);
            const tm = a.mass + c.mass;
            a.pos.addScaledVector(cd, -ov * (c.mass / tm) * collide);
            c.pos.addScaledVector(cd, ov * (a.mass / tm) * collide);
            rv.subVectors(c.vel, a.vel);
            const vn = rv.dot(cd);
            if (vn < -0.0001) {
              const imp = -(1 + P.bounce) * vn / (1 / a.mass + 1 / c.mass);
              a.vel.addScaledVector(cd, -imp / a.mass);
              c.vel.addScaledVector(cd, imp / c.mass);
            }
          }
        }
      }
    }

    const xB = vw / 2 - 0.2, topY = vh / 2 - 0.05, floorY = -vh / 2 + 0.05;
    const rest = 0.3 + 0.35 * dropF;
    const contain = flyF < 0.5, zContain = flyF < 0.02;
    for (const b of bodies) {
      const r = b.vis;
      if (contain) {
        if (b.pos.x < -xB - r) { b.pos.x = -xB - r; b.vel.x *= P.rebound; }
        else if (b.pos.x > xB + r) { b.pos.x = xB + r; b.vel.x *= P.rebound; }
        if (b.pos.y - r < floorY) {
          b.pos.y = floorY + r;
          if (b.vel.y < 0) b.vel.y = -b.vel.y * rest;
          if (dropF > 0.3) { b.vel.x *= 0.86; b.vel.z *= 0.86; }
        }
        if (b.pos.y + r > topY) { b.pos.y = topY - r; if (b.vel.y > 0) b.vel.y *= P.rebound; }
      }
      if (zContain) {
        if (b.pos.z < -2) { b.pos.z = -2; b.vel.z *= P.rebound; }
        else if (b.pos.z > 2) { b.pos.z = 2; b.vel.z *= P.rebound; }
      }
      dp.copy(b.pos).sub(b.group.position);
      if (dp.lengthSq() > 0.000001) {
        axis.set(dp.y, -dp.x, 0).normalize();
        b.group.rotateOnWorldAxis(axis, (dp.length() / b.radius) * 0.95);
      }
      b.group.position.copy(b.pos);
    }
    renderer.render(scene, camera);
    quality();
  }
  const quality = adaptiveQuality(renderer);
  requestAnimationFrame(frame);
}

/* ---------- Yükleme ekranı ---------- */
let sceneIsReady = false;
function sceneReady() { sceneIsReady = true; }

function finishLoader(immediate) {
  if (!loader) { control.started = true; return; }
  if (immediate || reduced) {
    loader.remove();
    control.started = true;
    document.documentElement.classList.add("intro-done");
    return;
  }
  loader.classList.add("leaving");
  setTimeout(() => {
    control.started = true;
    document.documentElement.classList.add("intro-done");
    loader.remove();
  }, 520);
}

if (loader && loader.isConnected) {
  const bar = loader.querySelector("[data-loader-bar]");
  const num = loader.querySelector("[data-loader-num]");
  const status = loader.querySelector("[data-loader-status]");
  let value = 0, last = performance.now(), done = false;
  if (reduced) {
    finishLoader(true);
  } else {
    const tick = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!sceneIsReady) value += (92 - value) * 1.7 * dt;
      else { value += (100 - value) * 6 * dt; if (value >= 99.4) value = 100; }
      bar.style.width = value.toFixed(2) + "%";
      num.textContent = String(Math.floor(value)).padStart(3, "0") + "%";
      if (value >= 100 && status.dataset.done) status.textContent = status.dataset.done;
      if (value >= 99.9 && sceneIsReady && !done) {
        done = true;
        setTimeout(() => finishLoader(false), 140);
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    // WebGL hiç hazır olmazsa (ör. çok yavaş cihaz) 6 saniyede yine de aç
    setTimeout(() => { sceneIsReady = true; }, 6000);
  }
} else if (!loader) {
  control.started = true;
}

// Yavaş cihazlarda çözünürlüğü düşür: son 60 karenin ortalaması 22 ms'yi geçerse piksel oranı 1'e iner
function adaptiveQuality(renderer) {
  let last = performance.now(), sum = 0, n = 0, lowered = false;
  return () => {
    const now = performance.now(), dt = now - last;
    last = now;
    if (lowered || dt > 200) return;
    sum += dt; n++;
    if (n === 60) {
      if (sum / n > 22 && renderer.getPixelRatio() > 1) { renderer.setPixelRatio(1); lowered = true; }
      sum = 0; n = 0;
    }
  };
}
