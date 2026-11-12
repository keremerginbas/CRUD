/* ------------------------------------------------------------------
   Giriş bölümündeki 3D dünya (Three.js)
   Kara parçaları noktalarla çizilir; etkinlik ve ofis şehirlerinden çıkan
   ışık çizgileri merkezde (Türkiye / Ankara) birleşir. Şehirler ve renkler
   sayfadaki <div class="globe" data-globe='{...}'> öğesinden okunur.
   WebGL yoksa sayfadaki SVG harita olduğu gibi kalır.
   ------------------------------------------------------------------ */
import {
  WebGLRenderer, Scene, PerspectiveCamera, Group, Vector3, Quaternion, Color,
  BufferGeometry, Float32BufferAttribute, Points, PointsMaterial, Mesh, SphereGeometry,
  MeshBasicMaterial, ShaderMaterial, BackSide, AdditiveBlending, CubicBezierCurve3, TubeGeometry, SRGBColorSpace,
} from "three";
import LAND from "./land.json";

const host = document.querySelector("[data-globe]");
if (host) start(host);

function rgbVar(name) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim().split(/\s+/).map(Number);
  return new Color().setRGB(v[0] / 255, v[1] / 255, v[2] / 255, SRGBColorSpace);
}

function toVec(lat, lon, r = 1) {
  const phi = (90 - lat) * Math.PI / 180;
  const theta = (lon + 180) * Math.PI / 180;
  return new Vector3(-r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
}

function start(el) {
  let renderer;
  try {
    renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
  } catch (e) {
    return; // WebGL yok: SVG harita kalır
  }
  const cfg = JSON.parse(el.getAttribute("data-globe"));
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const accent = rgbVar("--accent");
  const onDark = rgbVar("--on-dark");
  const ink = rgbVar("--ink");

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  el.appendChild(renderer.domElement);
  const scene = new Scene();
  const camera = new PerspectiveCamera(32, 1, 0.1, 50);
  camera.position.set(0, 0, 4.2);

  // pivot: kullanıcının sürüklemesi ve hafif salınım; globe: merkez şehri kameraya çeviren sabit dönüş
  const pivot = new Group();
  const globe = new Group();
  pivot.add(globe);
  scene.add(pivot);

  // Küre gövdesi (arka yüzdeki noktaları gizler)
  globe.add(new Mesh(new SphereGeometry(0.995, 64, 64), new MeshBasicMaterial({ color: rgbVar("--navy") })));

  // Atmosfer parıltısı
  const glow = new Mesh(
    new SphereGeometry(1.16, 64, 64),
    new ShaderMaterial({
      uniforms: { c: { value: accent } },
      vertexShader: "varying vec3 n; void main(){ n = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
      fragmentShader: "uniform vec3 c; varying vec3 n; void main(){ float i = pow(0.62 - dot(n, vec3(0.0,0.0,1.0)), 3.0); gl_FragColor = vec4(c, 1.0) * i * 0.55; }",
      side: BackSide, blending: AdditiveBlending, transparent: true, depthWrite: false,
    })
  );
  scene.add(glow);

  // Kara noktaları
  const pos = [];
  for (let i = 0; i < LAND.length; i += 2) {
    const v = toVec(LAND[i], LAND[i + 1], 1.003);
    pos.push(v.x, v.y, v.z);
  }
  const landGeo = new BufferGeometry();
  landGeo.setAttribute("position", new Float32BufferAttribute(pos, 3));
  globe.add(new Points(landGeo, new PointsMaterial({ color: onDark, size: 0.017, transparent: true, opacity: 0.7, sizeAttenuation: true })));

  // Merkez şehir kameraya baksın (biraz sağ ve yukarıda)
  const hubVec = toVec(cfg.hub.lat, cfg.hub.lon);
  const facing = new Vector3(0.48, 0.3, 1).normalize();
  globe.quaternion.copy(new Quaternion().setFromUnitVectors(hubVec.clone().normalize(), facing));

  // Şehirler, yaylar ve yay üzerinde akan ışıklar
  const arcs = [];
  const markers = [];
  const dotGeo = new SphereGeometry(1, 16, 16);
  function marker(v, size, color) {
    const m = new Mesh(dotGeo, new MeshBasicMaterial({ color, transparent: true }));
    m.position.copy(v);
    m.scale.setScalar(size);
    globe.add(m);
    return m;
  }
  const hubMarker = marker(hubVec.clone().multiplyScalar(1.004), 0.026, accent);
  const ring = new Mesh(new SphereGeometry(1, 24, 24), new MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.5 }));
  ring.position.copy(hubVec.clone().multiplyScalar(1.004));
  globe.add(ring);

  cfg.sources.forEach((s, i) => {
    const a = toVec(s.lat, s.lon, 1.004);
    const b = hubVec.clone().multiplyScalar(1.004);
    const dist = a.distanceTo(b);
    const lift = 1.06 + Math.min(0.42, dist * 0.3);
    const an = a.clone().normalize(), bn = b.clone().normalize();
    const c1 = new Vector3().copy(an).applyQuaternion(new Quaternion().slerpQuaternions(new Quaternion(), new Quaternion().setFromUnitVectors(an, bn), 0.25)).multiplyScalar(lift);
    const c2 = new Vector3().copy(an).applyQuaternion(new Quaternion().slerpQuaternions(new Quaternion(), new Quaternion().setFromUnitVectors(an, bn), 0.75)).multiplyScalar(lift);
    const curve = new CubicBezierCurve3(a, c1, c2, b);
    const office = s.kind !== "event";
    const tube = new Mesh(
      new TubeGeometry(curve, 96, office ? 0.0045 : 0.0032, 8, false),
      new MeshBasicMaterial({ color: accent, transparent: true, opacity: office ? 0.95 : 0.75 })
    );
    tube.geometry.setDrawRange(0, 0);
    globe.add(tube);
    const total = tube.geometry.index.count;
    const pulse = marker(a, 0.012, new Color(1, 1, 1));
    pulse.visible = false;
    const m = marker(a, office ? 0.017 : 0.012, office ? new Color(1, 1, 1) : onDark);
    markers.push({ v: a, label: s.label, m });
    arcs.push({ tube, total, curve, pulse, delay: 0.5 + i * 0.25, speed: 0.22 + (i % 3) * 0.05, offset: i * 0.37 });
  });
  markers.push({ v: hubVec, label: cfg.hub.label, hub: true, m: hubMarker });

  // Şehir etiketleri (HTML)
  const labels = markers.map((mk) => {
    const d = document.createElement("span");
    d.className = "globe-label" + (mk.hub ? " hub" : "");
    d.textContent = mk.label;
    d.setAttribute("aria-hidden", "true");
    el.appendChild(d);
    return { el: d, mk };
  });

  // Boyut
  let w = 1, h = 1;
  function resize() {
    const r = el.getBoundingClientRect();
    w = Math.max(1, r.width); h = Math.max(1, r.height);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(el);
  resize();

  // Sürükleyerek çevirme
  let dragX = 0, dragY = 0, velX = 0, velY = 0, dragging = false, lastX = 0, lastY = 0;
  const canvas = renderer.domElement;
  canvas.addEventListener("pointerdown", (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    velX = (e.clientX - lastX) * 0.006; velY = (e.clientY - lastY) * 0.004;
    dragX += velX; dragY = Math.max(-0.5, Math.min(0.5, dragY + velY));
    lastX = e.clientX; lastY = e.clientY;
  });
  const stop = () => { dragging = false; };
  canvas.addEventListener("pointerup", stop);
  canvas.addEventListener("pointercancel", stop);

  // Görünür değilse çizimi durdur
  let visible = true;
  new IntersectionObserver((en) => { visible = en[0].isIntersecting; }, { threshold: 0 }).observe(el);

  const tmp = new Vector3();
  const camDir = new Vector3();
  const t0 = performance.now();
  el.classList.add("ready");

  function frame(now) {
    requestAnimationFrame(frame);
    if (!visible || document.hidden) return;
    const t = (now - t0) / 1000;

    // Salınım + sürükleme (bırakınca yavaşça yerine döner)
    if (!dragging) { velX *= 0.92; dragX = dragX * 0.985 + velX; dragY *= 0.985; }
    const sway = reduced ? 0 : Math.sin(t * 0.18) * 0.22;
    pivot.rotation.y = sway + dragX;
    pivot.rotation.x = dragY;

    arcs.forEach((a) => {
      const p = reduced ? 1 : Math.min(1, Math.max(0, (t - a.delay) / 1.4));
      const eased = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      a.tube.geometry.setDrawRange(0, Math.floor(a.total * eased / 6) * 6);
      if (!reduced && p >= 1) {
        const k = ((t * a.speed + a.offset) % 1);
        a.curve.getPoint(k, a.pulse.position);
        a.pulse.visible = true;
        a.pulse.material.opacity = Math.sin(k * Math.PI);
      }
    });
    if (!reduced) {
      const k = (t * 0.6) % 1;
      ring.scale.setScalar(0.026 + k * 0.09);
      ring.material.opacity = 0.55 * (1 - k);
    } else {
      ring.visible = false;
    }

    renderer.render(scene, camera);

    // Etiketleri ekrana yerleştir; kürenin arkasındakileri gizle
    camDir.copy(camera.position).normalize();
    labels.forEach(({ el: d, mk }) => {
      mk.m.getWorldPosition(tmp);
      const front = tmp.clone().normalize().dot(camDir) > 0.18;
      tmp.project(camera);
      const x = (tmp.x * 0.5 + 0.5) * w;
      const y = (-tmp.y * 0.5 + 0.5) * h;
      d.style.transform = `translate(${(x + (mk.hub ? 14 : 10)).toFixed(1)}px, ${(y - 9).toFixed(1)}px)`;
      d.style.opacity = front ? "1" : "0";
    });
  }
  requestAnimationFrame(frame);
}
