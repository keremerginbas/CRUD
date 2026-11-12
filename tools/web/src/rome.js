/* ------------------------------------------------------------------
   Rome ana sayfası: 3D ilaç şişesi ve kapsüller (Three.js)
   - Ortadaki Rome Pharma şişesi imlece doğru eğilir ve süzülür.
   - Etraftaki kapsüller derinliğe göre paralaks yapar, imleçten kaçar.
   - "İlaç Tedariki / Danışmanlık" kartları temayı değiştirir: arka plan
     yeşilden maviye geçer, şişe iki tur döner ve etiket rengi değişir,
     kapsüller merkeze çekilip yeni renkleriyle yeniden dağılır.
   - Arka planda küçük moleküller yükselir.
   ------------------------------------------------------------------ */
import {
  WebGLRenderer, Scene, PerspectiveCamera, Group, Mesh, Color, Vector3, LatheGeometry, Vector2,
  CylinderGeometry, CapsuleGeometry, TorusGeometry, MeshPhysicalMaterial, MeshStandardMaterial, CanvasTexture,
  SRGBColorSpace, ACESFilmicToneMapping, PMREMGenerator, HemisphereLight, DirectionalLight, Clock,
} from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

const hero = document.querySelector("[data-rome-hero]");
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const THEMES = {
  supply: { accent: "#2DCE98", pair: [["#FFFFFF", "#2DCE98"], ["#2DCE98", "#0F2A40"], ["#FFFFFF", "#0F2A40"], ["#BFF3DE", "#FFFFFF"]] },
  consult: { accent: "#38A8F5", pair: [["#FFFFFF", "#38A8F5"], ["#38A8F5", "#0F2A40"], ["#FFFFFF", "#0F2A40"], ["#CDEBFF", "#FFFFFF"]] },
};

const ease = {
  in2: (t) => t * t,
  outBack: (t, s = 1.4) => 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2),
  inOut: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
};
function tween(duration, onUpdate, easing = (t) => t) {
  return new Promise((resolve) => {
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / (duration * 1000));
      onUpdate(easing(t));
      if (t < 1) requestAnimationFrame(step); else resolve();
    };
    requestAnimationFrame(step);
  });
}

if (hero) init();

function init() {
  const host = hero.querySelector("[data-rome-scene]");
  bubbles(hero.querySelector("[data-bubbles]"));
  let renderer;
  try {
    renderer = new WebGLRenderer({ antialias: (window.devicePixelRatio || 1) < 1.5, alpha: true });
  } catch (e) {
    wireCards(null);
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  host.appendChild(renderer.domElement);

  const scene = new Scene();
  scene.environment = new PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  const camera = new PerspectiveCamera(30, 1, 0.1, 100);
  camera.position.set(0, 0, 12);
  scene.add(new HemisphereLight(0xffffff, 0x0f2a40, 0.6));
  const key = new DirectionalLight(0xffffff, 1.6); key.position.set(-4, 6, 6); scene.add(key);
  const rim = new DirectionalLight(0xffffff, 1.4); rim.position.set(5, 3, -4); scene.add(rim);

  /* ---------- Şişe ---------- */
  const bottle = new Group();
  const tilt = new Group();          // imlece eğilme + dönüş
  tilt.add(bottle);
  scene.add(tilt);
  const profile = [[0, -1.3], [0.62, -1.3], [0.72, -1.2], [0.75, -1.05], [0.75, 0.72], [0.72, 0.86], [0.56, 1.0],
    [0.4, 1.08], [0.38, 1.16], [0.38, 1.3], [0, 1.3]].map(([x, y]) => new Vector2(x, y));
  const glass = new Mesh(new LatheGeometry(profile, 48), new MeshPhysicalMaterial({
    color: "#B8661F", roughness: 0.12, metalness: 0, transparent: true, opacity: 0.86,
    clearcoat: 1, clearcoatRoughness: 0.05,
  }));
  bottle.add(glass);
  // İçteki kapsüller (şişenin içinde belli belirsiz görünür)
  const innerGeo = new CapsuleGeometry(0.11, 0.22, 6, 12);
  for (let i = 0; i < 22; i++) {
    const m = new Mesh(innerGeo, new MeshStandardMaterial({ color: i % 2 ? "#FFFFFF" : "#2DCE98", roughness: 0.4 }));
    const a = Math.random() * Math.PI * 2, r = Math.random() * 0.45;
    m.position.set(Math.cos(a) * r, -1.1 + Math.random() * 1.1, Math.sin(a) * r);
    m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    m.userData.inner = true;
    bottle.add(m);
  }
  // Kapak (beyaz, yivli)
  const cap = new Group();
  cap.add(new Mesh(new CylinderGeometry(0.46, 0.46, 0.5, 64), new MeshStandardMaterial({ color: "#F5F7FA", roughness: 0.35 })));
  for (let i = 0; i < 3; i++) {
    const ring = new Mesh(new TorusGeometry(0.462, 0.012, 8, 64), new MeshStandardMaterial({ color: "#D9DEE5", roughness: 0.5 }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = -0.15 + i * 0.15;
    cap.add(ring);
  }
  cap.position.y = 1.52;
  bottle.add(cap);
  // Etiket: Rome logosu tuval dokusu olarak
  const canvas = document.createElement("canvas");
  canvas.width = 1024; canvas.height = 420;
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 8;
  const label = new Mesh(new CylinderGeometry(0.757, 0.757, 1.18, 96, 1, true, -Math.PI * 0.62, Math.PI * 1.24),
    new MeshStandardMaterial({ map: tex, roughness: 0.55 }));
  label.position.y = -0.22;
  bottle.add(label);
  const logo = new Image();
  let accentNow = THEMES.supply.accent;
  function drawLabel(accent) {
    const g = canvas.getContext("2d");
    g.fillStyle = "#FFFFFF"; g.fillRect(0, 0, 1024, 420);
    g.fillStyle = accent; g.fillRect(0, 0, 1024, 46); g.fillRect(0, 374, 1024, 46);
    if (logo.complete && logo.naturalWidth) {
      const h = 250, w = h * logo.naturalWidth / logo.naturalHeight;
      g.drawImage(logo, 512 - w / 2, 70, w, h);
    }
    g.fillStyle = "#0F2A40";
    g.font = "600 30px 'Schibsted Grotesk', Arial, sans-serif";
    g.textAlign = "center";
    g.fillText(hero.dataset.labelLine || "", 512, 352);
    tex.needsUpdate = true;
  }
  logo.onload = () => drawLabel(accentNow);
  logo.src = hero.dataset.logo;
  drawLabel(accentNow);

  /* ---------- Kapsüller ---------- */
  const capsuleGeo = new CapsuleGeometry(0.5, 1.0, 6, 16);
  function twoTone() {
    const m = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0, transparent: true });
    m.userData.top = { value: new Color() };
    m.userData.bottom = { value: new Color() };
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uTop = m.userData.top;
      sh.uniforms.uBottom = m.userData.bottom;
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying float vLocalY;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvLocalY = position.y;");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying float vLocalY;\nuniform vec3 uTop;\nuniform vec3 uBottom;")
        .replace("vec4 diffuseColor = vec4( diffuse, opacity );",
          "vec4 diffuseColor = vec4( diffuse * mix( uBottom, uTop, smoothstep( -0.015, 0.015, vLocalY ) ), opacity );");
    };
    return m;
  }
  const narrow = () => window.innerWidth < 1024;
  // Ekranın kenarlarına dağılmış yerler (x, y: görünür alanın oranı; z: derinlik)
  // Masaüstünde sol sütundaki metinlerin üzerine gelmeyecek şekilde
  const SPOTS = narrow()
    ? [[-0.4, 0.42, 1.2], [0.4, 0.44, 1.6], [0.42, 0.12, -1.2], [-0.44, 0.1, -1.8], [0.3, 0.3, -2.6], [-0.2, 0.46, -2.2], [0.46, -0.3, -2.6], [-0.46, -0.42, -2.8]]
    : [[0.0, 0.42, 1.6], [0.08, -0.4, 2.2], [0.22, 0.3, 1.4], [0.42, -0.05, 1.0], [0.3, -0.42, -1.2], [0.46, 0.4, -1.8],
      [-0.05, 0.3, -2.6], [0.12, -0.2, -2.4], [0.36, 0.15, 0.3], [-0.48, 0.46, -2.8], [-0.46, -0.46, -2.5],
      [0.48, -0.46, 0.6], [0.18, 0.46, 2.4], [-0.2, -0.47, -3]];
  const pills = SPOTS.map((sp, i) => {
    const mat = twoTone();
    const mesh = new Mesh(capsuleGeo, mat);
    const g = new Group(); g.add(mesh); scene.add(g);
    mesh.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    return { g, mesh, mat, sp, pair: i % 4, off: new Vector3(), rep: new Vector3(), spin: Math.random() * 6,
      scale: (0.22 + (sp[2] + 3) * 0.035 + Math.random() * 0.06) * (narrow() ? 0.62 : 1), hidden: 1 };
  });
  function setPillColors(theme) {
    pills.forEach((p) => {
      const [a, b] = THEMES[theme].pair[p.pair];
      p.mat.userData.top.value.set(a);
      p.mat.userData.bottom.value.set(b);
    });
  }
  setPillColors("supply");

  /* ---------- Boyut ve yerleşim ---------- */
  let vw = 10, vh = 6, w = 1, h = 1;
  function resize() {
    w = host.clientWidth; h = host.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
    vh = 2 * Math.tan((camera.fov * Math.PI) / 360) * camera.position.z;
    vw = vh * camera.aspect;
    const s = narrow() ? 0.5 : 1;
    tilt.scale.setScalar(s * Math.min(1, vh / 6.2));
    tilt.position.set(narrow() ? 0 : vw * 0.04, narrow() ? vh * 0.27 : 0, 0);
  }
  new ResizeObserver(resize).observe(host);
  resize();

  /* ---------- İmleç ---------- */
  const mouse = { x: 0, y: 0, px: -9999, py: -9999 };
  const smooth = { x: 0, y: 0 };
  window.addEventListener("pointermove", (e) => {
    const r = host.getBoundingClientRect();
    mouse.x = (e.clientX - r.left) / r.width - 0.5;
    mouse.y = (e.clientY - r.top) / r.height - 0.5;
    mouse.px = e.clientX - r.left; mouse.py = e.clientY - r.top;
  }, { passive: true });

  let spin = 0, switching = false, visible = true;
  new IntersectionObserver((en) => { visible = en[0].isIntersecting; }).observe(hero);
  const clock = new Clock();
  const proj = new Vector3();

  function frame() {
    requestAnimationFrame(frame);
    if (!visible || document.hidden) return;
    const t = clock.getElapsedTime();
    smooth.x += (mouse.x - smooth.x) * 0.05;
    smooth.y += (mouse.y - smooth.y) * 0.05;

    tilt.rotation.set(smooth.y * 0.45, smooth.x * 0.9 + spin, -0.22 + smooth.x * 0.08);
    bottle.position.y = reduced ? 0 : Math.sin(t * 1.05) * 0.12;

    pills.forEach((p, i) => {
      const [fx, fy, z] = p.sp;
      const depth = (z + 3) / 5.6; // 0 uzak, 1 yakın
      const par = (depth - 0.4) * 1.6; // yakındakiler imleçle, uzaktakiler ters yönde kayar
      const bx = fx * vw * (narrow() ? 0.9 : 1), by = fy * vh;
      if (!switching) {
        // ekrandaki konuma göre imleçten kaçma
        proj.set(bx + p.off.x, by + p.off.y, z).project(camera);
        const sx = (proj.x * 0.5 + 0.5) * w, sy = (-proj.y * 0.5 + 0.5) * h;
        const dx = sx - mouse.px, dy = sy - mouse.py;
        const dist = Math.hypot(dx, dy);
        let tx = 0, ty = 0, boost = 1;
        if (dist < 320 && dist > 0.01) {
          const f = (320 - dist) / 320;
          tx = (dx / dist) * f * 1.4; ty = -(dy / dist) * f * 1.4; boost = 1 + f * 5;
        }
        p.rep.x += (tx - p.rep.x) * 0.1; p.rep.y += (ty - p.rep.y) * 0.1;
        p.spin += 0.004 * boost * (reduced ? 0 : 1);
      }
      const float = reduced ? 0 : Math.sin(t * (0.6 + (i % 5) * 0.12) + i) * 0.18;
      p.g.position.set(bx + p.off.x + p.rep.x + smooth.x * par, by + p.off.y + p.rep.y + float - smooth.y * par * 0.6, z);
      p.g.rotation.set(p.spin * 0.7, p.spin, Math.cos(t * 0.5 + i) * 0.2);
      p.mesh.scale.setScalar(p.scale * p.hidden);
    });
    renderer.render(scene, camera);
    quality();
  }
  const quality = adaptiveQuality(renderer);
  requestAnimationFrame(frame);

  /* ---------- Tema değişimi ---------- */
  async function switchTheme(theme) {
    if (switching) return;
    switching = true;
    const accent = THEMES[theme].accent;
    if (reduced) {
      accentNow = accent; drawLabel(accent); setPillColors(theme); recolorInner(theme);
      switching = false; return;
    }
    const start = pills.map((p) => p.off.clone().add(p.rep));
    // 1) şişe hızlanarak döner, kapsüller merkeze çekilir
    const spinStart = spin;
    const implode = tween(0.55, (k) => {
      pills.forEach((p, i) => {
        const [fx, fy] = p.sp;
        const bx = fx * vw, by = fy * vh;
        p.off.set(lerp(start[i].x, -bx + tilt.position.x, k), lerp(start[i].y, -by + tilt.position.y, k), 0);
        p.hidden = 1 - k * 0.92;
      });
    }, ease.in2);
    await tween(0.6, (k) => { spin = spinStart + k * Math.PI * 2; }, ease.in2);
    await implode;
    // 2) zirvede etiket ve renkler değişir
    accentNow = accent; drawLabel(accent); setPillColors(theme); recolorInner(theme);
    pills.forEach((p) => p.rep.set(0, 0, 0));
    // 3) şişe yerine oturur, kapsüller yeni yerlerine saçılır
    const targets = pills.map(() => new Vector3((Math.random() - 0.5) * 0.9, (Math.random() - 0.5) * 0.7, 0));
    const from = pills.map((p) => p.off.clone());
    const s2 = spin;
    await Promise.all([
      tween(1.5, (k) => { spin = s2 + k * Math.PI * 2; }, (x) => ease.outBack(x, 0.7)),
      tween(0.95, (k) => {
        pills.forEach((p, i) => { p.off.lerpVectors(from[i], targets[i], k); p.hidden = 0.08 + 0.92 * Math.min(1, k * 1.2); });
      }, (x) => ease.outBack(x, 1.5)),
    ]);
    spin = 0;
    pills.forEach((p) => { p.hidden = 1; });
    switching = false;
  }
  function recolorInner(theme) {
    let i = 0;
    bottle.children.forEach((c) => { if (c.userData.inner) { c.material.color.set(i++ % 2 ? "#FFFFFF" : THEMES[theme].accent); } });
  }
  wireCards(switchTheme);
}

function lerp(a, b, t) { return a + (b - a) * t; }

/* Kartlar: tema düğmeleri ve metin değişimi (WebGL olmasa da çalışır) */
function wireCards(switchTheme) {
  const cards = hero.querySelectorAll("[data-theme-card]");
  const swaps = hero.querySelectorAll("[data-swap]");
  const consultBg = hero.querySelector("[data-bg-consult]");
  cards.forEach((card) => {
    card.addEventListener("click", () => {
      const theme = card.dataset.themeCard;
      if (hero.dataset.theme === theme) return;
      hero.dataset.theme = theme;
      cards.forEach((c) => c.setAttribute("aria-pressed", c === card ? "true" : "false"));
      if (consultBg) consultBg.style.opacity = theme === "consult" ? "1" : "0";
      swaps.forEach((el) => {
        el.style.opacity = "0";
        el.style.transform = "translateY(10px)";
        setTimeout(() => {
          el.innerHTML = el.dataset[theme];
          el.style.opacity = "1";
          el.style.transform = "none";
        }, reduced ? 0 : 320);
      });
      if (switchTheme) switchTheme(theme);
    });
  });
}

/* Yükselen moleküller */
function bubbles(box) {
  if (!box || reduced) return;
  const make = () => {
    if (document.hidden || box.childElementCount > 40) return;
    const b = document.createElement("span");
    const size = 6 + Math.random() * 22;
    const dur = 5 + Math.random() * 6;
    b.className = "molecule";
    b.style.cssText = `width:${size}px;height:${size}px;left:${Math.random() * 100}%;opacity:${0.2 + Math.random() * 0.4};animation-duration:${dur}s`;
    box.appendChild(b);
    setTimeout(() => b.remove(), dur * 1000);
  };
  setInterval(make, 420);
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
